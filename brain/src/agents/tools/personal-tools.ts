import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fmtTime } from '../../common/time.js';
import { SHEET_TABS } from '../../google/google-auth.service.js';
import { propose, RunContext } from '../context.js';
import { safe, Services } from './common.js';

export function recordsTools(s: Services, ctx: RunContext) {
  const uid = ctx.user.id;
  return [
    tool(safe(async (a: { title: string; due: string | null; priority: 'low' | 'normal' | 'high' | null }) => s.records.addTask(uid, { title: a.title, due: a.due, priority: a.priority ?? 'normal' })), {
      name: 'add_task', description: 'Add a to-do.', schema: z.object({ title: z.string(), due: z.string().nullable().describe('ISO date-time or null'), priority: z.enum(['low', 'normal', 'high']).nullable() }),
    }),
    tool(safe(async ({ status }: { status: 'open' | 'done' | 'all' | null }) =>
      (await s.records.listTasks(uid, status ?? 'open')).map((t) => ({ id: t.id, title: t.title, due: t.due ? fmtTime(t.due.toISOString(), ctx.user.timezone) : null, priority: t.priority, status: t.status }))), {
      name: 'list_tasks', description: 'List to-dos.', schema: z.object({ status: z.enum(['open', 'done', 'all']).nullable() }),
    }),
    tool(safe(async ({ id }: { id: string }) => (await s.records.completeTask(uid, id)) ?? { error: 'Task not found' }), {
      name: 'complete_task', description: 'Mark a to-do as done.', schema: z.object({ id: z.string() }),
    }),
    tool(safe(async ({ id, title }: { id: string | null; title: string | null }) => {
      const open = await s.records.listTasks(uid, 'all');
      const q = (title ?? '').toLowerCase();
      const matches = id ? open.filter((t) => t.id === id) : open.filter((t) => t.title.toLowerCase().includes(q) || q.includes(t.title.toLowerCase()));
      if (!matches.length) return { error: `No task matches ${id ?? `"${title}"`}`, tasks: open.slice(0, 10).map((t) => ({ id: t.id, title: t.title })) };
      if (matches.length > 1) return { error: 'Several tasks match — call again with the id', matches: matches.map((t) => ({ id: t.id, title: t.title })) };
      return propose(ctx, 'records', 'task_delete', `Delete task “${matches[0].title}”`, { id: matches[0].id });
    }), {
      name: 'delete_task',
      description: 'Propose deleting a to-do (by id or by words from its title). The system then asks the user to confirm — call this immediately when the user asks to delete.',
      schema: z.object({ id: z.string().nullable(), title: z.string().nullable() }),
    }),
    tool(safe(async (a: { name: string; email: string | null; phone: string | null; notes: string | null }) => s.records.addContact(uid, { ...a, notes: a.notes ?? '' })), {
      name: 'add_contact', description: 'Save a contact.', schema: z.object({ name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), notes: z.string().nullable() }),
    }),
    tool(safe(async ({ query }: { query: string }) => s.records.findContacts(uid, query)), {
      name: 'find_contact', description: 'Search saved contacts.', schema: z.object({ query: z.string() }),
    }),
    tool(safe(async ({ tab }: { tab: string }) => s.sheets.read(uid, tab as any)), {
      name: 'read_my_sheet', description: `Read a tab of the user's SwarmAI Google Sheet (${Object.keys(SHEET_TABS).join(', ')}) — includes rows the user typed manually.`,
      schema: z.object({ tab: z.enum(Object.keys(SHEET_TABS) as [string, ...string[]]) }),
    }),
  ];
}

export function financeTools(s: Services, ctx: RunContext) {
  const uid = ctx.user.id;
  return [
    tool(safe(async (a: { amount: number; category: string; note: string | null; date: string | null; currency: string | null }) =>
      s.records.addExpense(uid, { amount: a.amount, category: a.category, note: a.note ?? '', date: a.date ?? undefined, currency: a.currency ?? 'INR' })), {
      name: 'log_expense',
      description: 'Log an expense the user stated explicitly (e.g. "spent ₹450 on lunch"). Categories: food, groceries, transport, travel, shopping, bills, health, entertainment, education, other.',
      schema: z.object({ amount: z.number(), category: z.string(), note: z.string().nullable(), date: z.string().nullable().describe('YYYY-MM-DD, default today'), currency: z.string().nullable() }),
    }),
    tool(safe(async ({ from, to }: { from: string; to: string }) => s.records.expenseSummary(uid, from, to)), {
      name: 'expense_summary', description: 'Totals by category and recent expenses for a date range.', schema: z.object({ from: z.string(), to: z.string() }),
    }),
    tool(safe(async () => {
      const images = ctx.attachments.filter((a) => a.mime.startsWith('image/'));
      if (!images.length) return { error: 'No receipt image attached.' };
      const json = await s.media.vision(
        'Extract this receipt/bill as JSON: {"merchant": string, "date": "YYYY-MM-DD"|null, "total": number, "currency": "INR"|..., "category": one of food,groceries,transport,travel,shopping,bills,health,entertainment,education,other, "items": [{"name": string, "amount": number}]}. Use the grand total.',
        images, true,
      );
      return JSON.parse(json);
    }), {
      name: 'read_receipt', description: 'Read the attached receipt/bill photo and extract merchant, date, total and category.', schema: z.object({}),
    }),
    tool(safe(async (a: { amount: number; category: string; merchant: string; date: string | null; currency: string | null }) =>
      propose(ctx, 'finance', 'expense_from_receipt', `Log ${a.currency ?? 'INR'} ${a.amount} at ${a.merchant} (${a.category}${a.date ? `, ${a.date}` : ''})`, a)), {
      name: 'log_receipt_expense', description: 'Propose logging the expense read from a receipt — the system asks the user to check the amount and confirm. Call it right after read_receipt.',
      schema: z.object({ amount: z.number(), category: z.string(), merchant: z.string(), date: z.string().nullable(), currency: z.string().nullable() }),
    }),
  ];
}

export function notesTools(s: Services, ctx: RunContext) {
  const uid = ctx.user.id;
  return [
    tool(safe(async (a: { title: string; content: string; tags: string[] | null }) => s.records.addNote(uid, { ...a, tags: a.tags ?? [] })), {
      name: 'save_note', description: 'Save a note (ideas, info to remember, meeting notes).', schema: z.object({ title: z.string(), content: z.string(), tags: z.array(z.string()).nullable() }),
    }),
    tool(safe(async ({ query }: { query: string }) => s.records.searchNotes(uid, query)), {
      name: 'search_notes', description: "Semantic search over the user's notes.", schema: z.object({ query: z.string() }),
    }),
    tool(safe(async ({ fact }: { fact: string }) => s.records.addFact(uid, fact)), {
      name: 'remember_fact', description: 'Remember a lasting personal fact or preference (diet, family, work, home city…). Used in every future conversation.', schema: z.object({ fact: z.string() }),
    }),
    tool(safe(async () => s.records.listFacts(uid)), { name: 'list_facts', description: 'What the assistant remembers about the user.', schema: z.object({}) }),
    tool(safe(async ({ id }: { id: string }) => s.records.deleteFact(uid, id)), { name: 'forget_fact', description: 'Forget a remembered fact by id.', schema: z.object({ id: z.string() }) }),
  ];
}

export function reminderTools(s: Services, ctx: RunContext) {
  const uid = ctx.user.id;
  const tz = ctx.user.timezone;
  return [
    tool(safe(async ({ text, at }: { text: string; at: string }) => {
      const due = new Date(at);
      if (Number.isNaN(due.getTime())) return { error: 'Invalid date-time' };
      if (due.getTime() < Date.now() - 60_000) return { error: 'That time is in the past' };
      const r = await s.records.addReminder(uid, text, due);
      return { id: r.id, text: r.text, when: fmtTime(r.dueAt.toISOString(), tz) };
    }), {
      name: 'create_reminder', description: 'Remind the user at a time (delivered on their preferred channel).',
      schema: z.object({ text: z.string(), at: z.string().describe('ISO 8601 with offset, computed from "now" in the user timezone') }),
    }),
    tool(safe(async () => (await s.records.listReminders(uid)).map((r) => ({ id: r.id, text: r.text, when: fmtTime(r.dueAt.toISOString(), tz) }))), {
      name: 'list_reminders', description: 'Upcoming reminders.', schema: z.object({}),
    }),
    tool(safe(async ({ id }: { id: string }) => s.records.cancelReminder(uid, id)), { name: 'cancel_reminder', description: 'Cancel a reminder by id.', schema: z.object({ id: z.string() }) }),
  ];
}
