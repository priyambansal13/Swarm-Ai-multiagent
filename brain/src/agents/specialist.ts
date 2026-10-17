import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';
import type { Emit } from './context.js';

const text = (m: BaseMessage) => (typeof m.content === 'string' ? m.content : (m.content as any[]).map((c) => c.text ?? '').join(''));

/**
 * Tool-calling loop (LLM ⇄ tools). Parallel tool calls run concurrently; every call is emitted
 * for live UIs. Returns the model's final text answer.
 */
export async function runToolLoop(o: {
  agent: string;
  model: ChatOpenAI;
  tools: StructuredToolInterface[];
  system: string;
  input: string | BaseMessage[];
  emit: Emit;
  signal?: AbortSignal;
  maxSteps?: number;
}): Promise<string> {
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const llm = o.tools.length ? o.model.bindTools(o.tools) : o.model;
  const messages: BaseMessage[] = [new SystemMessage(o.system), ...(typeof o.input === 'string' ? [new HumanMessage(o.input)] : o.input)];

  for (let step = 0; step < (o.maxSteps ?? 6); step++) {
    o.signal?.throwIfAborted();
    const ai = (await llm.invoke(messages, { signal: o.signal })) as AIMessage;
    messages.push(ai);
    const calls = ai.tool_calls ?? [];
    if (!calls.length) return text(ai);
    const results = await Promise.all(
      calls.map(async (call) => {
        const started = Date.now();
        const callId = call.id ?? `${o.agent}-${call.name}-${started}`;
        o.emit({ type: 'tool', agent: o.agent, callId, tool: call.name, phase: 'start', input: call.args });
        let content: string;
        let ok = true;
        try {
          const t = byName.get(call.name);
          content = t ? String(await t.invoke(call.args)) : JSON.stringify({ error: `Unknown tool ${call.name}` });
          ok = !!t && !content.startsWith('{"error"');
        } catch (e) {
          if (o.signal?.aborted) throw e;
          ok = false;
          content = JSON.stringify({ error: (e as Error).message });
        }
        o.emit({ type: 'tool', agent: o.agent, callId, tool: call.name, phase: 'end', ok, durationMs: Date.now() - started, preview: content.slice(0, 280) });
        return new ToolMessage({ content, tool_call_id: callId, name: call.name });
      }),
    );
    messages.push(...results);
  }
  // Out of steps: ask for a final answer without tools.
  o.signal?.throwIfAborted();
  const final = (await o.model.invoke([...messages, new HumanMessage('Give your final answer now based on the results above.')], { signal: o.signal })) as AIMessage;
  return text(final);
}

export { text as messageText };
