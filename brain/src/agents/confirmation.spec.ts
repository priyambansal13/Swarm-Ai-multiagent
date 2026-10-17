/** Side-effect tools must only PROPOSE — never call Gmail/Calendar/records directly. */
import { describe, expect, it, vi } from 'vitest';
import type { RunContext } from './context.js';
import { calendarTools, emailTools } from './tools/google-tools.js';
import { financeTools, recordsTools } from './tools/personal-tools.js';

const ctx = (): RunContext => ({
  user: { id: 'u1', name: 'Priya', email: 'p@x.com', timezone: 'Asia/Kolkata', settings: {} } as any,
  runId: 'r', threadId: 't', channel: 'web', googleConnected: true, links: {}, attachments: [], facts: [], pending: [], emit: () => {},
});
const services = () => {
  const forbidden = () => vi.fn(() => { throw new Error('side effect executed without confirmation'); });
  return {
    gmail: { send: forbidden(), reply: forbidden(), archive: forbidden() },
    calendar: { create: forbidden(), update: forbidden(), remove: forbidden() },
    records: {
      listTasks: vi.fn(async () => [{ id: 't1', title: 'Renew passport' }]),
      deleteTask: forbidden(), addExpense: forbidden(),
    },
  } as any;
};
const byName = (tools: any[], name: string) => tools.find((t) => t.name === name);

describe('confirmation guarantee', () => {
  it.each([
    ['gmail_send', emailTools, { to: 'a@x.com', subject: 'Hi', body: 'Friday works', cc: null }],
    ['gmail_reply', emailTools, { messageId: 'm1', body: 'Sure', replyAll: false, replyingTo: 'Asha' }],
    ['gmail_archive', emailTools, { ids: ['m1'], description: 'newsletters' }],
    ['calendar_create', calendarTools, { title: 'Sync', start: '2026-10-20T10:00:00+05:30', end: '2026-10-20T10:30:00+05:30', attendees: null, location: null, description: null, addMeet: false }],
    ['calendar_update', calendarTools, { eventId: 'e1', currentTitle: 'Sync', title: null, start: '2026-10-21T10:00:00+05:30', end: null, location: null }],
    ['calendar_delete', calendarTools, { eventId: 'e1', title: 'Sync', when: 'Tue 10:00' }],
    ['delete_task', recordsTools, { id: null, title: 'passport' }],
    ['log_receipt_expense', financeTools, { amount: 420, category: 'food', merchant: 'Cafe', date: null, currency: 'INR' }],
  ])('%s proposes instead of executing', async (name, factory: any, args) => {
    const c = ctx();
    const s = services();
    const out = JSON.parse(await byName(factory(s, c), name).invoke(args));
    expect(out.status).toBe('PENDING_USER_CONFIRMATION');
    expect(c.pending).toHaveLength(1);
    expect(c.pending[0].summary.length).toBeGreaterThan(5);
  });
});
