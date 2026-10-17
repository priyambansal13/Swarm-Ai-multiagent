import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { Annotation, Command, END, interrupt, messagesStateReducer, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { nowInTz } from '../common/time.js';
import { CalendarService } from '../google/calendar.service.js';
import { GmailService } from '../google/gmail.service.js';
import { SheetsService } from '../google/sheets.service.js';
import { N8nChannelsService } from '../integrations/n8n-channels.service.js';
import { OpenAIMediaService } from '../integrations/openai-media.service.js';
import { SearchService } from '../integrations/search.service.js';
import { WeatherService } from '../integrations/weather.service.js';
import { WebReaderService } from '../integrations/web-reader.service.js';
import { YatraService } from '../integrations/yatra.service.js';
import { RecordsService } from '../records/records.service.js';
import { ActionExecutor } from './actions.js';
import { AGENTS, AgentSpec } from './agents.js';
import type { PendingAction, RunContext } from './context.js';
import { messageText, runToolLoop } from './specialist.js';
import type { Services } from './tools/common.js';

const last = <T>() => Annotation<T>({ reducer: (_p: T, n: T) => n, default: () => null as T });

export const SwarmState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  runId: last<string>(),
  pendingActions: last<PendingAction[] | null>(),
});
type S = typeof SwarmState.State;

export interface ConfirmDecision {
  approved: boolean;
  /** Approve only some actions (default: all) */
  actionIds?: string[];
}

export interface TurnResult {
  reply: string;
  interrupt: { id: string; actions: { id: string; agent: string; kind: string; summary: string }[] } | null;
}

export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

const isAbort = (e: unknown, signal?: AbortSignal) => !!signal?.aborted || (e as Error)?.name === 'AbortError';

/**
 * SwarmAI brain — LangGraph graph per conversation thread:
 *
 *   START → master ──(no side effects)──────────────────────────► END
 *              └──(pending actions)──► confirm: interrupt() ──► execute approved → END
 *
 * The master agent delegates to 10 specialist agents exposed as tools ("agents as tools"); it can call
 * several at once and they run in parallel. Specialists can only *propose* side effects; `confirm`
 * pauses the graph until the user answers (any channel), then executes what was approved.
 */
@Injectable()
export class SwarmGraphService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SwarmGraphService.name);
  private checkpointer!: PostgresSaver;
  private graph!: ReturnType<SwarmGraphService['build']>;
  private readonly contexts = new Map<string, RunContext>();
  private readonly services: Services;

  constructor(
    private readonly config: ConfigService,
    private readonly executor: ActionExecutor,
    gmail: GmailService, calendar: CalendarService, sheets: SheetsService, search: SearchService, web: WebReaderService,
    weather: WeatherService, yatra: YatraService, media: OpenAIMediaService, records: RecordsService, channels: N8nChannelsService,
  ) {
    this.services = { gmail, calendar, sheets, search, web, weather, yatra, media, records, channels };
  }

  async onModuleInit() {
    this.checkpointer = PostgresSaver.fromConnString(this.config.getOrThrow<string>('DATABASE_URL'));
    await this.checkpointer.setup();
    this.graph = this.build();
    this.log.log(`Swarm graph ready: master + ${AGENTS.length} specialist agents`);
  }

  async onModuleDestroy() {
    await this.checkpointer?.end();
  }

  private model(fast = false) {
    const name = fast
      ? this.config.get<string>('OPENAI_MODEL_FAST') || 'gpt-4.1-mini'
      : this.config.get<string>('OPENAI_MODEL') || 'gpt-4.1';
    return new ChatOpenAI({ model: name, maxRetries: 2, timeout: 120_000 });
  }

  private build() {
    return new StateGraph(SwarmState)
      .addNode('master', (s: S, c: LangGraphRunnableConfig) => this.master(s, c.signal))
      .addNode('confirm', (s: S) => this.confirm(s))
      .addEdge(START, 'master')
      .addConditionalEdges('master', (s: S) => (s.pendingActions?.length ? 'confirm' : END), ['confirm', END])
      .addEdge('confirm', END)
      .compile({ checkpointer: this.checkpointer });
  }

  // ------------------------------------------------------------------ prompts
  private contextBlock(ctx: RunContext) {
    return [
      `Now: ${nowInTz(ctx.user.timezone)}`,
      `User: ${ctx.user.name} <${ctx.user.email}>, timezone ${ctx.user.timezone}${ctx.user.settings?.homeCity ? `, home city ${ctx.user.settings.homeCity}` : ''}`,
      ctx.facts.length ? `Known facts about the user:\n${ctx.facts.map((f) => `- ${f}`).join('\n')}` : 'Known facts about the user: none yet',
    ].join('\n');
  }

  private masterPrompt(ctx: RunContext) {
    const style =
      ctx.channel === 'web'
        ? 'Format with short markdown (bold, bullets, links). No tables wider than 4 columns.'
        : `This reply goes to ${ctx.channel}: plain text, short paragraphs, emojis sparingly, no markdown tables or headings.`;
    return `You are SwarmAI, ${ctx.user.name.split(' ')[0]}'s personal assistant. You coordinate specialist agents (tools named ask_*_agent).
${this.contextBlock(ctx)}
Integrations: Google (Gmail/Calendar/Sheets) ${ctx.googleConnected ? 'connected' : 'NOT connected — for email/calendar requests tell the user to connect Google in Settings'}; linked phone channels: ${Object.keys(ctx.links).join(', ') || 'none'}.
Current channel: ${ctx.channel}.${ctx.attachments.length ? `\nThe user attached: ${ctx.attachments.map((a) => `${a.name} (${a.mime})`).join(', ')} — use the documents or finance agent to read them.` : ''}

Rules:
- Act only on the latest user message. Earlier messages are context and were already handled — never redo their actions.
- Do the work: delegate every request to the right agent with a complete, self-contained task (dates, names, amounts, the user's wording). Call independent agents in the same turn so they run in parallel.
- Adding or logging things (tasks, expenses, notes, reminders, facts, contacts, price watches, trip logs) happens immediately — just delegate it and report the result.
- Sending email, calendar changes and deletions: delegate them fully (e.g. "delete task <id>", "send this email"). The system turns those into a confirmation request automatically. Never ask for confirmation yourself and never say something "needs confirmation" unless an agent returned PENDING_USER_CONFIRMATION; in that case say what will happen once the user confirms (it is NOT done yet).
  Example: user "delete the passport task" → call ask_records_agent("Delete the task about renewing the passport") — do not reply "please confirm".
- Answer only small talk, simple maths and questions about this conversation yourself. For any factual question — dates of festivals and holidays (they follow the lunar calendar and change every year), events, schedules, prices, news, people, sports, laws, "latest" anything — delegate to the research agent even if you think you know: your own knowledge can be outdated or wrong. Never state such a fact without a source.
- Only if a request is ambiguous in a way that matters (which meeting? which email?), ask one short question instead of guessing.
- Reply in the user's language (English, Hindi or Hinglish). ${style}`;
  }

  private specialistPrompt(spec: AgentSpec, ctx: RunContext) {
    return `${spec.prompt}\n${this.contextBlock(ctx)}\nReturn a concise result for the master agent (facts, ids, links). Do not ask the user questions; if information is missing, say exactly what is missing.`;
  }

  // ------------------------------------------------------------------ agents as tools
  private agentTools(ctx: RunContext) {
    const fast = this.model(true);
    const agentTools = AGENTS.map((spec) =>
      tool(
        async ({ task }: { task: string }) => {
          if (spec.needsGoogle && !ctx.googleConnected) {
            return `The ${spec.label} agent needs Google. The user has not connected Google yet — ask them to open Settings → Connect Google.`;
          }
          const started = Date.now();
          ctx.emit({ type: 'agent', agent: spec.id, status: 'running' });
          this.log.log(`→ ${spec.id} agent: ${task.slice(0, 160)}`);
          const emit: typeof ctx.emit = (ev) => {
            if (ev.type === 'tool' && ev.phase === 'start') this.log.log(`  ${spec.id}.${ev.tool} ${JSON.stringify(ev.input).slice(0, 160)}`);
            ctx.emit(ev);
          };
          try {
            const answer = await runToolLoop({
              agent: spec.id, model: fast, tools: spec.tools(this.services, ctx), system: this.specialistPrompt(spec, ctx),
              input: task, emit, signal: ctx.signal, maxSteps: 6,
            });
            ctx.emit({ type: 'agent', agent: spec.id, status: 'done', durationMs: Date.now() - started });
            return answer;
          } catch (e) {
            if (isAbort(e, ctx.signal)) throw e;
            ctx.emit({ type: 'agent', agent: spec.id, status: 'error', message: (e as Error).message, durationMs: Date.now() - started });
            return `The ${spec.label} agent failed: ${(e as Error).message}`;
          }
        },
        {
          name: `ask_${spec.id}_agent`,
          description: `${spec.label} agent — ${spec.description}`,
          schema: z.object({ task: z.string().describe('Complete, self-contained instruction for this agent') }),
        },
      ),
    );
    const sendToPhone = tool(
      async ({ channel, text }: { channel: 'telegram' | 'whatsapp'; text: string }) => {
        const chatId = ctx.links[channel];
        if (!chatId) return `The user has not linked ${channel}. They can link it in Settings.`;
        try {
          await this.services.channels.send(channel, chatId, text);
          await this.services.records.logActivity(ctx.user.id, ctx.channel, 'master', `send_${channel}`, text.slice(0, 200));
          return `Sent to the user's ${channel}.`;
        } catch (e) {
          return `Could not send via ${channel}: ${(e as Error).message}`;
        }
      },
      {
        name: 'send_to_my_phone',
        description: "Send a message to the user's own linked Telegram or WhatsApp (e.g. 'send this itinerary to my WhatsApp').",
        schema: z.object({ channel: z.enum(['telegram', 'whatsapp']), text: z.string() }),
      },
    );
    return [...agentTools, sendToPhone];
  }

  // ------------------------------------------------------------------ nodes
  private async master(s: S, signal?: AbortSignal) {
    const ctx = this.contexts.get(s.runId)!;
    ctx.signal = signal ?? ctx.signal;
    const started = Date.now();
    ctx.emit({ type: 'agent', agent: 'master', status: 'running' });
    // Earlier turns are context only — they were already handled. Mark the newest message explicitly so the
    // model never repeats earlier actions (e.g. logging an expense twice).
    const history = s.messages.slice(-24, -1);
    const latest = s.messages.at(-1)!;
    const input = [
      ...history,
      new HumanMessage(`[Latest message — act only on this; everything above was already handled]\n${messageText(latest)}`),
    ];
    let reply = await runToolLoop({
      agent: 'master', model: this.model(), tools: this.agentTools(ctx), system: this.masterPrompt(ctx),
      input, emit: ctx.emit, signal: ctx.signal, maxSteps: 6,
    });
    if (ctx.pending.length) {
      // The system adds the confirmation prompt; drop any the model wrote itself.
      reply = reply.replace(/^.*(approve or reject below|reply yes to confirm|needs your confirmation).*$/gim, '').replace(/\n{3,}/g, '\n\n');
      const list = ctx.pending.map((p, i) => `${i + 1}. ${p.summary}`).join('\n');
      const ask = ctx.channel === 'web' ? 'Approve or reject below.' : 'Reply YES to confirm or NO to cancel.';
      reply = `${reply.trim()}\n\n${ctx.channel === 'web' ? '**Needs your confirmation:**' : 'Needs your confirmation:'}\n${list}\n\n${ask}`;
    }
    ctx.emit({ type: 'agent', agent: 'master', status: 'done', durationMs: Date.now() - started });
    return { messages: [new AIMessage(reply)], pendingActions: ctx.pending.length ? [...ctx.pending] : null };
  }

  private async confirm(s: S) {
    const actions = s.pendingActions ?? [];
    const decision = interrupt({ kind: 'confirm_actions', actions: actions.map(({ args: _a, ...v }) => v) }) as ConfirmDecision;
    const ctx = this.contexts.get(s.runId)!;
    if (!decision?.approved) {
      await this.services.records.logActivity(ctx.user.id, ctx.channel, 'master', 'rejected', actions.map((a) => a.summary).join(' | '));
      return { messages: [new AIMessage('Okay — cancelled. Nothing was sent or changed.')], pendingActions: null };
    }
    const chosen = decision.actionIds?.length ? actions.filter((a) => decision.actionIds!.includes(a.id)) : actions;
    ctx.emit({ type: 'agent', agent: 'executor', status: 'running' });
    const results: string[] = [];
    for (const a of chosen) {
      const callId = `exec-${a.id}`;
      ctx.emit({ type: 'tool', agent: 'executor', callId, tool: a.kind, phase: 'start', input: a.args });
      const r = await this.executor.execute(ctx.user, a, ctx.channel);
      ctx.emit({ type: 'tool', agent: 'executor', callId, tool: a.kind, phase: 'end', ok: r.ok, preview: r.message });
      results.push(`${r.ok ? '✅' : '⚠️'} ${r.message}`);
    }
    const skipped = actions.length - chosen.length;
    ctx.emit({ type: 'agent', agent: 'executor', status: 'done' });
    return { messages: [new AIMessage(`${results.join('\n')}${skipped ? `\n(${skipped} not approved — skipped)` : ''}`)], pendingActions: null };
  }

  // ------------------------------------------------------------------ public API
  private config_(threadId: string, runId: string, signal?: AbortSignal) {
    return { configurable: { thread_id: threadId }, recursionLimit: 25, signal, runName: 'swarm-ai', metadata: { threadId, runId } };
  }

  async run(threadId: string, ctx: RunContext, userText: string): Promise<TurnResult> {
    this.contexts.set(ctx.runId, ctx);
    try {
      const note = ctx.attachments.length ? `\n[attached: ${ctx.attachments.map((a) => `${a.name} (${a.mime})`).join(', ')}]` : '';
      const final = await this.graph.invoke(
        { messages: [new HumanMessage(`${userText}${note}`)], runId: ctx.runId, pendingActions: null },
        this.config_(threadId, ctx.runId, ctx.signal),
      );
      return this.toResult(final as any);
    } catch (e) {
      if (isAbort(e, ctx.signal)) throw new RunCancelledError();
      throw e;
    } finally {
      this.contexts.delete(ctx.runId);
    }
  }

  /** Removes a conversation's saved messages and state (LangGraph checkpoints). */
  deleteHistory(threadId: string) {
    return this.checkpointer.deleteThread(threadId);
  }

  /** Answers a pending confirmation. `ctx.runId` is replaced by the paused run's id. */
  async resume(threadId: string, ctx: RunContext, decision: ConfirmDecision): Promise<TurnResult> {
    const snapshot = await this.graph.getState({ configurable: { thread_id: threadId } });
    if (!snapshot.tasks.some((t) => t.interrupts?.length)) throw new Error('Nothing is waiting for confirmation in this conversation.');
    ctx.runId = (snapshot.values as S).runId;
    this.contexts.set(ctx.runId, ctx);
    try {
      const final = await this.graph.invoke(new Command({ resume: decision }) as any, this.config_(threadId, ctx.runId, ctx.signal));
      return this.toResult(final as any);
    } catch (e) {
      if (isAbort(e, ctx.signal)) throw new RunCancelledError();
      throw e;
    } finally {
      this.contexts.delete(ctx.runId);
    }
  }

  private toResult(final: S & { __interrupt__?: { id: string; value: any }[] }): TurnResult {
    const lastAi = [...final.messages].reverse().find((m) => m.getType() === 'ai');
    const intr = final.__interrupt__?.[0];
    return {
      reply: lastAi ? messageText(lastAi) : '',
      interrupt: intr ? { id: intr.id, actions: intr.value?.actions ?? [] } : null,
    };
  }

  /** Conversation transcript for the UI. */
  async history(threadId: string) {
    const snap = await this.graph.getState({ configurable: { thread_id: threadId } });
    const msgs = ((snap.values as S)?.messages ?? []) as BaseMessage[];
    return msgs
      .filter((m) => m.getType() === 'human' || m.getType() === 'ai')
      .map((m) => ({ role: m.getType() === 'human' ? 'user' : 'assistant', content: messageText(m) }));
  }
}
