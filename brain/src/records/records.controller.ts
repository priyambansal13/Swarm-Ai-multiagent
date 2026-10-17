import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/guards.js';
import { dayRange } from '../common/time.js';
import { parse } from '../common/validate.js';
import type { User } from '../db/entities.js';
import { CalendarService } from '../google/calendar.service.js';
import { GoogleAuthService } from '../google/google-auth.service.js';
import { RecordsService } from './records.service.js';

const KINDS = ['tasks', 'reminders', 'expenses', 'contacts', 'notes', 'facts', 'watches', 'travel', 'activity', 'digest'] as const;

@ApiTags('Records')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class RecordsController {
  constructor(private readonly records: RecordsService, private readonly calendar: CalendarService, private readonly google: GoogleAuthService) {}

  @Get('dashboard')
  @ApiOperation({ summary: "Today's agenda (if Google is connected), open tasks, reminders, this month's spending, watches" })
  async dashboard(@CurrentUser() user: User) {
    const tz = user.timezone;
    const today = dayRange(tz);
    const monthStart = `${today.date.slice(0, 8)}01`;
    const [tasks, reminders, spend, watches, google] = await Promise.all([
      this.records.listTasks(user.id, 'open'),
      this.records.listReminders(user.id),
      this.records.expenseSummary(user.id, monthStart, today.date),
      this.records.listWatches(user.id),
      this.google.account(user.id),
    ]);
    const agenda = google && this.google.configured ? await this.calendar.list(user.id, today.start, today.end).catch(() => null) : null;
    return { date: today.date, agenda, tasks: tasks.slice(0, 20), reminders: reminders.slice(0, 10), spend, watches, sheetUrl: google?.spreadsheetUrl ?? null };
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Proactive messages (briefs, reminders, alerts) — also shown in the web app' })
  notifications(@CurrentUser() user: User) {
    return this.records.webNotifications(user.id);
  }

  @Get('records/:kind')
  @ApiParam({ name: 'kind', enum: KINDS })
  @ApiOperation({ summary: 'List records of one kind' })
  async list(@CurrentUser() user: User, @Param('kind') kind: string, @Query('from') from?: string, @Query('to') to?: string) {
    const uid = user.id;
    switch (kind) {
      case 'tasks': return this.records.listTasks(uid, 'all');
      case 'reminders': return this.records.listReminders(uid);
      case 'expenses': {
        const today = dayRange(user.timezone).date;
        return this.records.expenseSummary(uid, from ?? `${today.slice(0, 8)}01`, to ?? today);
      }
      case 'contacts': return this.records.contacts.find({ where: { userId: uid }, order: { name: 'ASC' } });
      case 'notes': return this.records.notes.find({ where: { userId: uid }, order: { createdAt: 'DESC' }, take: 100 });
      case 'facts': return this.records.listFacts(uid);
      case 'watches': return this.records.listWatches(uid);
      case 'travel': return this.records.travel.find({ where: { userId: uid }, order: { createdAt: 'DESC' } });
      case 'activity': return this.records.activity.find({ where: { userId: uid }, order: { createdAt: 'DESC' }, take: 100 });
      case 'digest': return this.records.digest.find({ where: { userId: uid }, order: { createdAt: 'DESC' }, take: 100 });
      default: throw new BadRequestException(`Unknown kind ${kind}`);
    }
  }

  @Post('records/tasks')
  @ApiOperation({ summary: 'Add a task' })
  addTask(@CurrentUser() user: User, @Body() body: unknown) {
    const b = parse(z.object({ title: z.string().min(1).max(300), due: z.string().nullish(), priority: z.enum(['low', 'normal', 'high']).optional() }), body);
    return this.records.addTask(user.id, { ...b, source: 'web' });
  }

  @Patch('records/tasks/:id')
  @ApiOperation({ summary: 'Mark a task done' })
  completeTask(@CurrentUser() user: User, @Param('id') id: string) {
    return this.records.completeTask(user.id, id);
  }

  @Post('records/expenses')
  @ApiOperation({ summary: 'Log an expense' })
  addExpense(@CurrentUser() user: User, @Body() body: unknown) {
    const b = parse(z.object({ amount: z.number().positive(), category: z.string().min(1).max(40), note: z.string().max(300).optional(), date: z.string().optional() }), body);
    return this.records.addExpense(user.id, { ...b, source: 'web' });
  }

  @Delete('records/:kind/:id')
  @ApiOperation({ summary: 'Delete a task / cancel a reminder / stop a watch / forget a fact' })
  async remove(@CurrentUser() user: User, @Param('kind') kind: string, @Param('id') id: string) {
    switch (kind) {
      case 'tasks': return this.records.deleteTask(user.id, id);
      case 'reminders': return this.records.cancelReminder(user.id, id);
      case 'watches': return this.records.stopWatch(user.id, id);
      case 'facts': return this.records.deleteFact(user.id, id);
      default: throw new BadRequestException(`Cannot delete ${kind}`);
    }
  }
}
