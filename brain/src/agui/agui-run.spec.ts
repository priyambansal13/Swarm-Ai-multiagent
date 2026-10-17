/** AG-UI contract test: brain event streams must pass the official @ag-ui/client verifier. Run: pnpm test */
import { verifyEvents } from '@ag-ui/client';
import { type BaseEvent, EventType } from '@ag-ui/core';
import { from, lastValueFrom, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { AguiRun } from './agui-run.js';

const verify = (events: BaseEvent[]) => lastValueFrom(from(events).pipe(verifyEvents(false), toArray()));
const newRun = () => {
  const events: BaseEvent[] = [];
  const run = new AguiRun((e) => events.push(e), 'web-t1', 'run-1');
  run.start();
  return { run, events };
};
const last = (e: BaseEvent[]) => e.at(-1) as BaseEvent & { outcome?: { type: string } };

describe('SwarmAI AG-UI stream', () => {
  it('master + parallel specialists with tool calls', async () => {
    const { run, events } = newRun();
    run.onEvent({ type: 'agent', agent: 'master', status: 'running' });
    run.onEvent({ type: 'tool', agent: 'master', callId: 'm1', tool: 'ask_finance_agent', phase: 'start', input: { task: 'log' } });
    run.onEvent({ type: 'tool', agent: 'master', callId: 'm2', tool: 'ask_reminders_agent', phase: 'start', input: { task: 'remind' } });
    run.onEvent({ type: 'agent', agent: 'finance', status: 'running' });
    run.onEvent({ type: 'agent', agent: 'reminders', status: 'running' });
    run.onEvent({ type: 'tool', agent: 'finance', callId: 'f1', tool: 'log_expense', phase: 'start', input: {} });
    run.onEvent({ type: 'tool', agent: 'reminders', callId: 'r1', tool: 'create_reminder', phase: 'start', input: {} });
    run.onEvent({ type: 'tool', agent: 'reminders', callId: 'r1', tool: 'create_reminder', phase: 'end', ok: true });
    run.onEvent({ type: 'tool', agent: 'finance', callId: 'f1', tool: 'log_expense', phase: 'end', ok: false });
    run.onEvent({ type: 'agent', agent: 'finance', status: 'done' });
    run.onEvent({ type: 'agent', agent: 'reminders', status: 'error', message: 'x' });
    run.onEvent({ type: 'tool', agent: 'master', callId: 'm1', tool: 'ask_finance_agent', phase: 'end', ok: true });
    run.onEvent({ type: 'tool', agent: 'master', callId: 'm2', tool: 'ask_reminders_agent', phase: 'end', ok: true });
    run.onEvent({ type: 'agent', agent: 'master', status: 'done' });
    await run.finish('Done', null, {});
    await expect(verify(events)).resolves.toHaveLength(events.length);
    expect(last(events).outcome?.type).toBe('success');
  });

  it('confirmation ends with an interrupt carrying the actions', async () => {
    const { run, events } = newRun();
    run.onEvent({ type: 'agent', agent: 'master', status: 'running' });
    run.onEvent({ type: 'agent', agent: 'records', status: 'running' });
    run.onEvent({ type: 'agent', agent: 'records', status: 'done' });
    run.onEvent({ type: 'agent', agent: 'master', status: 'done' });
    await run.finish('Needs confirmation', { interruptId: 'int-1', actions: [{ id: 'a1', agent: 'records', kind: 'task_delete', summary: 'Delete task “x”' }] }, {});
    await expect(verify(events)).resolves.toBeDefined();
    const o = last(events) as any;
    expect(o.outcome.type).toBe('interrupt');
    expect(o.outcome.interrupts[0].metadata.actions[0].kind).toBe('task_delete');
  });

  it('cancellation with an open step and tool call', async () => {
    const { run, events } = newRun();
    run.onEvent({ type: 'agent', agent: 'master', status: 'running' });
    run.onEvent({ type: 'tool', agent: 'master', callId: 'm1', tool: 'ask_research_agent', phase: 'start' });
    run.cancelled();
    await expect(verify(events)).resolves.toBeDefined();
    expect(last(events).outcome?.type).toBe('cancelled');
  });

  it('failure ends with RUN_ERROR', async () => {
    const { run, events } = newRun();
    run.onEvent({ type: 'agent', agent: 'master', status: 'running' });
    run.fail('boom');
    await expect(verify(events)).resolves.toBeDefined();
    expect(last(events).type).toBe(EventType.RUN_ERROR);
  });
});
