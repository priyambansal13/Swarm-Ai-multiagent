import { randomUUID } from 'node:crypto';
import { type BaseEvent, EventType } from '@ag-ui/core';
import { AGENT_LABELS } from '../agents/agents.js';
import type { AgentEvent } from '../agents/context.js';

export interface AgentRuntime { label: string; status: 'running' | 'done' | 'error'; durationMs: number | null; tools: number }

/** Shared AG-UI state streamed to the web app. */
export interface SwarmUiState {
  threadId: string;
  status: 'running' | 'done' | 'awaiting_confirmation' | 'cancelled' | 'error';
  agents: Record<string, AgentRuntime>;
  pending: { interruptId: string; actions: { id: string; agent: string; kind: string; summary: string }[] } | null;
}

export type RunOutcome =
  | { type: 'success' }
  | { type: 'cancelled' }
  | { type: 'interrupt'; interrupts: { id: string; reason: string; message?: string; responseSchema?: Record<string, any>; metadata?: Record<string, any> }[] };

/**
 * Maps brain progress events onto AG-UI: agents → STEP_STARTED/FINISHED, tool calls → TOOL_CALL_*,
 * agent board → STATE_SNAPSHOT/DELTA, reply → TEXT_MESSAGE_*, confirmations → RUN_FINISHED outcome "interrupt".
 */
export class AguiRun {
  private readonly state: SwarmUiState;
  private readonly openSteps = new Set<string>();

  constructor(private readonly send: (e: BaseEvent) => void, private readonly threadId: string, private readonly runId: string) {
    this.state = { threadId, status: 'running', agents: {}, pending: null };
  }

  start() {
    this.send({ type: EventType.RUN_STARTED, threadId: this.threadId, runId: this.runId } as BaseEvent);
    this.send({ type: EventType.STATE_SNAPSHOT, snapshot: this.state } as BaseEvent);
  }

  onEvent(e: AgentEvent) {
    if (e.type === 'agent') {
      if (e.status === 'running' && !this.openSteps.has(e.agent)) {
        this.openSteps.add(e.agent);
        this.send({ type: EventType.STEP_STARTED, stepName: e.agent } as BaseEvent);
      }
      const prev = this.state.agents[e.agent];
      const rt: AgentRuntime = { label: AGENT_LABELS[e.agent] ?? e.agent, status: e.status, durationMs: e.durationMs ?? prev?.durationMs ?? null, tools: prev?.tools ?? 0 };
      this.state.agents[e.agent] = rt;
      this.send({ type: EventType.STATE_DELTA, delta: [{ op: 'add', path: `/agents/${e.agent}`, value: rt }] } as BaseEvent);
      if (e.status !== 'running' && this.openSteps.delete(e.agent)) this.send({ type: EventType.STEP_FINISHED, stepName: e.agent } as BaseEvent);
      return;
    }
    const meta = { agent: e.agent };
    if (e.phase === 'start') {
      this.send({ type: EventType.TOOL_CALL_START, toolCallId: e.callId, toolCallName: e.tool, metadata: meta } as BaseEvent);
      this.send({ type: EventType.TOOL_CALL_ARGS, toolCallId: e.callId, delta: JSON.stringify(e.input ?? {}), metadata: meta } as BaseEvent);
      this.send({ type: EventType.TOOL_CALL_END, toolCallId: e.callId, metadata: meta } as BaseEvent);
      const rt = this.state.agents[e.agent];
      if (rt) {
        rt.tools += 1;
        this.send({ type: EventType.STATE_DELTA, delta: [{ op: 'replace', path: `/agents/${e.agent}/tools`, value: rt.tools }] } as BaseEvent);
      }
    } else {
      this.send({
        type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId: e.callId, role: 'tool', content: e.preview ?? '',
        metadata: { ...meta, ok: e.ok ?? true, durationMs: e.durationMs ?? 0 },
      } as BaseEvent);
    }
  }

  private closeSteps() {
    for (const s of this.openSteps) this.send({ type: EventType.STEP_FINISHED, stepName: s } as BaseEvent);
    this.openSteps.clear();
  }

  async finish(reply: string, pending: SwarmUiState['pending'], result: Record<string, unknown>) {
    this.closeSteps();
    Object.assign(this.state, { status: pending ? 'awaiting_confirmation' : 'done', pending });
    this.send({ type: EventType.STATE_SNAPSHOT, snapshot: this.state } as BaseEvent);
    if (reply) {
      const messageId = randomUUID();
      this.send({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent);
      for (const chunk of reply.match(/\S+\s*/g) ?? [reply]) {
        this.send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: chunk } as BaseEvent);
        await new Promise((r) => setTimeout(r, 8));
      }
      this.send({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
    }
    const outcome: RunOutcome = pending
      ? {
          type: 'interrupt',
          interrupts: [{
            id: pending.interruptId, reason: 'confirm_actions',
            message: `Confirm ${pending.actions.length} action(s)?`,
            responseSchema: { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' }, actionIds: { type: 'array', items: { type: 'string' } } } },
            metadata: { actions: pending.actions },
          }],
        }
      : { type: 'success' };
    this.send({ type: EventType.RUN_FINISHED, threadId: this.threadId, runId: this.runId, result, outcome } as BaseEvent);
  }

  cancelled() {
    this.closeSteps();
    this.state.status = 'cancelled';
    this.send({ type: EventType.STATE_DELTA, delta: [{ op: 'replace', path: '/status', value: 'cancelled' }] } as BaseEvent);
    this.send({ type: EventType.RUN_FINISHED, threadId: this.threadId, runId: this.runId, outcome: { type: 'cancelled' } } as BaseEvent);
  }

  fail(message: string) {
    this.send({ type: EventType.RUN_ERROR, message } as BaseEvent);
  }
}
