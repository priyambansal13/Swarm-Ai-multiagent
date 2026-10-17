import { Injectable } from '@nestjs/common';
import { CalendarService } from '../google/calendar.service.js';
import { GmailService } from '../google/gmail.service.js';
import { RecordsService } from '../records/records.service.js';
import type { User } from '../db/entities.js';
import type { PendingAction } from './context.js';

/** Executes confirmed side effects. Only called after the user approved the action. */
@Injectable()
export class ActionExecutor {
  constructor(
    private readonly gmail: GmailService,
    private readonly calendar: CalendarService,
    private readonly records: RecordsService,
  ) {}

  async execute(user: User, a: PendingAction, channel: string): Promise<{ ok: boolean; message: string }> {
    const uid = user.id;
    const tz = user.timezone;
    try {
      let message: string;
      switch (a.kind) {
        case 'gmail_send':
          await this.gmail.send(uid, { to: a.args.to, cc: a.args.cc ?? undefined, subject: a.args.subject, body: a.args.body });
          message = `Email sent to ${a.args.to}.`;
          break;
        case 'gmail_reply':
          await this.gmail.reply(uid, a.args.messageId, a.args.body, !!a.args.replyAll);
          message = `Reply sent to ${a.args.replyingTo}.`;
          break;
        case 'gmail_archive':
          await this.gmail.archive(uid, a.args.ids);
          message = `Archived ${a.args.ids.length} email(s).`;
          break;
        case 'calendar_create': {
          const e = await this.calendar.create(uid, { ...a.args, tz, attendees: a.args.attendees ?? undefined, location: a.args.location ?? undefined, description: a.args.description ?? undefined } as any);
          message = `Event “${e.title}” created${e.meetLink ? ` (Meet: ${e.meetLink})` : ''}.`;
          break;
        }
        case 'calendar_update': {
          const e = await this.calendar.update(uid, a.args.eventId, { tz, title: a.args.title ?? undefined, start: a.args.start ?? undefined, end: a.args.end ?? undefined, location: a.args.location ?? undefined });
          message = `Event “${e.title}” updated.`;
          break;
        }
        case 'calendar_delete':
          await this.calendar.remove(uid, a.args.eventId);
          message = `Event “${a.args.title}” cancelled.`;
          break;
        case 'task_delete':
          await this.records.deleteTask(uid, a.args.id);
          message = 'Task deleted.';
          break;
        case 'expense_from_receipt':
          await this.records.addExpense(uid, { amount: a.args.amount, category: a.args.category, note: a.args.merchant, date: a.args.date ?? undefined, currency: a.args.currency ?? 'INR', source: 'receipt' });
          message = `Logged ${a.args.currency ?? 'INR'} ${a.args.amount} at ${a.args.merchant}.`;
          break;
        default:
          throw new Error(`Unknown action ${(a as PendingAction).kind}`);
      }
      await this.records.logActivity(uid, channel, a.agent, a.kind, a.summary);
      return { ok: true, message };
    } catch (e) {
      await this.records.logActivity(uid, channel, a.agent, `${a.kind}_failed`, `${a.summary} — ${(e as Error).message}`);
      return { ok: false, message: `Could not ${a.summary.charAt(0).toLowerCase()}${a.summary.slice(1)}: ${(e as Error).message}` };
    }
  }
}
