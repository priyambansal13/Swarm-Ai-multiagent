import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fmtTime } from '../../common/time.js';
import { propose, RunContext } from '../context.js';
import { safe, Services } from './common.js';

const iso = z.string().describe('ISO 8601 date-time with offset, e.g. 2026-10-18T15:00:00+05:30');

export function emailTools(s: Services, ctx: RunContext) {
  const uid = ctx.user.id;
  return [
    tool(safe(async ({ query, max }: { query: string; max: number | null }) => s.gmail.search(uid, query, max ?? 10)), {
      name: 'gmail_search',
      description: 'Search the mailbox with Gmail syntax (e.g. "is:unread newer_than:2d", "from:asha subject:invoice"). Returns id, from, subject, date, snippet.',
      schema: z.object({ query: z.string(), max: z.number().int().nullable() }),
    }),
    tool(safe(async ({ id }: { id: string }) => s.gmail.read(uid, id)), {
      name: 'gmail_read',
      description: 'Read one email (headers + plain-text body) by id.',
      schema: z.object({ id: z.string() }),
    }),
    tool(safe(async (a: { to: string; subject: string; body: string; cc: string | null }) => s.gmail.createDraft(uid, { ...a, cc: a.cc ?? undefined })), {
      name: 'gmail_create_draft',
      description: 'Save a draft in Gmail (safe — nothing is sent). Prefer this when the user wants to review before sending.',
      schema: z.object({ to: z.string(), subject: z.string(), body: z.string(), cc: z.string().nullable() }),
    }),
    tool(safe(async (a: { to: string; subject: string; body: string; cc: string | null }) =>
      propose(ctx, 'email', 'gmail_send', `Send email to ${a.to}${a.cc ? ` (cc ${a.cc})` : ''} — “${a.subject}”: ${a.body.slice(0, 160)}${a.body.length > 160 ? '…' : ''}`, a)), {
      name: 'gmail_send',
      description: 'Propose sending a new email. The system asks the user to confirm — call it as soon as the email is ready.',
      schema: z.object({ to: z.string(), subject: z.string(), body: z.string(), cc: z.string().nullable() }),
    }),
    tool(safe(async (a: { messageId: string; body: string; replyAll: boolean; replyingTo: string }) =>
      propose(ctx, 'email', 'gmail_reply', `Reply to ${a.replyingTo}: ${a.body.slice(0, 160)}${a.body.length > 160 ? '…' : ''}`, a)), {
      name: 'gmail_reply',
      description: 'Propose a reply to an email by id (same thread). The system asks the user to confirm.',
      schema: z.object({ messageId: z.string(), body: z.string(), replyAll: z.boolean(), replyingTo: z.string().describe('Sender name/address, for the confirmation text') }),
    }),
    tool(safe(async (a: { ids: string[]; description: string }) => propose(ctx, 'email', 'gmail_archive', `Archive ${a.ids.length} email(s): ${a.description}`, a)), {
      name: 'gmail_archive',
      description: 'Propose archiving emails (remove from inbox). The system asks the user to confirm.',
      schema: z.object({ ids: z.array(z.string()), description: z.string() }),
    }),
    tool(safe(async ({ name }: { name: string }) => s.records.findContacts(uid, name)), {
      name: 'find_contact',
      description: "Look up a person's email/phone in the user's saved contacts.",
      schema: z.object({ name: z.string() }),
    }),
  ];
}

export function calendarTools(s: Services, ctx: RunContext) {
  const uid = ctx.user.id;
  const tz = ctx.user.timezone;
  return [
    tool(safe(async ({ from, to, query }: { from: string; to: string; query: string | null }) =>
      (await s.calendar.list(uid, from, to, query ?? undefined)).map((e) => ({ ...e, when: e.allDay ? `${e.start} (all day)` : fmtTime(e.start, tz) }))), {
      name: 'calendar_list',
      description: 'List events between two date-times (optionally matching text).',
      schema: z.object({ from: iso, to: iso, query: z.string().nullable() }),
    }),
    tool(safe(async ({ from, to, durationMinutes }: { from: string; to: string; durationMinutes: number }) => s.calendar.freeSlots(uid, from, to, durationMinutes, tz)), {
      name: 'calendar_free_slots',
      description: 'Find free slots of a given length on weekdays between 09:00 and 19:00 local time.',
      schema: z.object({ from: iso, to: iso, durationMinutes: z.number().int() }),
    }),
    tool(safe(async (a: { title: string; start: string; end: string; attendees: string[] | null; location: string | null; description: string | null; addMeet: boolean }) =>
      propose(ctx, 'calendar', 'calendar_create', `Create “${a.title}” ${fmtTime(a.start, tz)}–${new Date(a.end).toLocaleTimeString('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}${a.attendees?.length ? ` with ${a.attendees.join(', ')}` : ''}${a.addMeet ? ' + Google Meet' : ''}`, a)), {
      name: 'calendar_create',
      description: 'Propose creating an event (invites attendees). The system asks the user to confirm.',
      schema: z.object({ title: z.string(), start: iso, end: iso, attendees: z.array(z.string()).nullable(), location: z.string().nullable(), description: z.string().nullable(), addMeet: z.boolean() }),
    }),
    tool(safe(async (a: { eventId: string; currentTitle: string; title: string | null; start: string | null; end: string | null; location: string | null }) =>
      propose(ctx, 'calendar', 'calendar_update', `Update “${a.currentTitle}”${a.start ? ` → ${fmtTime(a.start, tz)}` : ''}${a.title ? ` (rename to “${a.title}”)` : ''}${a.location ? ` @ ${a.location}` : ''}`, a)), {
      name: 'calendar_update',
      description: 'Propose moving/renaming/relocating an event by id. The system asks the user to confirm.',
      schema: z.object({ eventId: z.string(), currentTitle: z.string(), title: z.string().nullable(), start: iso.nullable(), end: iso.nullable(), location: z.string().nullable() }),
    }),
    tool(safe(async (a: { eventId: string; title: string; when: string }) => propose(ctx, 'calendar', 'calendar_delete', `Cancel “${a.title}” (${a.when})`, a)), {
      name: 'calendar_delete',
      description: 'Propose cancelling an event by id (notifies attendees). The system asks the user to confirm.',
      schema: z.object({ eventId: z.string(), title: z.string(), when: z.string() }),
    }),
    tool(safe(async ({ name }: { name: string }) => s.records.findContacts(uid, name)), {
      name: 'find_contact',
      description: "Look up a person's email in the user's saved contacts (for invitations).",
      schema: z.object({ name: z.string() }),
    }),
  ];
}
