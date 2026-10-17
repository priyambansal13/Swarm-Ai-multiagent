import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatOpenAI } from '@langchain/openai';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { z } from 'zod';
import { dayRange, fmtTime, partsInTz } from '../common/time.js';
import { AutomationState, GoogleAccount, Task, User } from '../db/entities.js';
import { CalendarService } from '../google/calendar.service.js';
import { GmailService } from '../google/gmail.service.js';
import { GoogleAuthService } from '../google/google-auth.service.js';
import { SearchService } from '../integrations/search.service.js';
import { WeatherService } from '../integrations/weather.service.js';
import { RecordsService } from '../records/records.service.js';

type Job = 'brief' | 'triage' | 'meeting_prep' | 'followups' | 'price_watch' | 'weekly_review';

const TriageSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    category: z.enum(['action', 'fyi', 'bill', 'newsletter', 'personal', 'promotion']),
    urgency: z.enum(['high', 'normal', 'low']),
    summary: z.string().describe('One line: who wants what, by when'),
    actionItem: z.string().nullable().describe('A to-do for the user, or null'),
    actionDue: z.string().nullable().describe('ISO date if a deadline is stated, else null'),
    billAmountINR: z.number().nullable(),
  })),
});

/**
 * Proactive flows. n8n calls `tick()` every minute (Schedule Trigger → HTTP); this decides which jobs are
 * due per user, runs heavy ones in the background, and returns queued messages for n8n to deliver.
 */
@Injectable()
export class AutomationsService {
  private readonly log = new Logger(AutomationsService.name);
  private readonly busy = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AutomationState) private readonly state: Repository<AutomationState>,
    @InjectRepository(GoogleAccount) private readonly google: Repository<GoogleAccount>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly googleAuth: GoogleAuthService,
    private readonly records: RecordsService,
    private readonly gmail: GmailService,
    private readonly calendar: CalendarService,
    private readonly weather: WeatherService,
    private readonly search: SearchService,
  ) {}

  private llm() {
    return new ChatOpenAI({ model: this.config.get<string>('OPENAI_MODEL_FAST') || 'gpt-4.1-mini', maxRetries: 2, timeout: 90_000 });
  }

  // ------------------------------------------------------------------ tick
  async tick(now = new Date()) {
    const due = await this.deliverReminders(now);
    const users = await this.users.find();
    const googleIds = new Set((await this.google.find()).map((g) => g.userId));
    let started = 0;
    for (const user of users) {
      const hasGoogle = googleIds.has(user.id) && this.googleAuth.configured;
      for (const job of this.dueJobs(user, now, hasGoogle)) {
        if (await this.claim(user.id, job, now)) {
          started++;
          void this.runJob(user, job, hasGoogle);
        }
      }
    }
    const deliveries = (await this.records.claimOutbox()).map((m) => ({ id: m.id, channel: m.channel, chatId: m.externalId, kind: m.kind, text: m.text }));
    return { at: now.toISOString(), remindersQueued: due, jobsStarted: started, deliveries };
  }

  async runNow(user: User, job: Job) {
    const hasGoogle = !!(await this.google.findOne({ where: { userId: user.id } })) && this.googleAuth.configured;
    await this.runJob(user, job, hasGoogle);
    return { ran: job };
  }

  private dueJobs(user: User, now: Date, hasGoogle: boolean): Job[] {
    const s = user.settings;
    const { hour, minute, weekday } = partsInTz(now, user.timezone);
    const hm = hour * 60 + minute;
    const [bh, bm] = (s.briefTime ?? '08:00').split(':').map(Number);
    const jobs: Job[] = [];
    if (s.briefEnabled && hm >= bh * 60 + bm && hm < bh * 60 + bm + 30) jobs.push('brief');
    if (hasGoogle && s.triageEnabled) jobs.push('triage');
    if (hasGoogle && s.meetingPrepEnabled) jobs.push('meeting_prep');
    if (hasGoogle && hour === 18) jobs.push('followups');
    if (this.search.serpConfigured && hour === 9) jobs.push('price_watch');
    if (weekday === 'Sun' && hour === 19) jobs.push('weekly_review');
    return jobs;
  }

  /** Minimum gap per job, so each runs at most once per window. */
  private static readonly GAP_MIN: Record<Job, number> = { brief: 20 * 60, triage: 30, meeting_prep: 10, followups: 20 * 60, price_watch: 20 * 60, weekly_review: 6 * 24 * 60 };

  private async claim(userId: string, job: Job, now: Date) {
    const key = `${userId}:${job}`;
    if (this.busy.has(key)) return false;
    const st = await this.state.findOne({ where: { userId, job } });
    if (st?.lastRunAt && now.getTime() - st.lastRunAt.getTime() < AutomationsService.GAP_MIN[job] * 60_000) return false;
    await this.state.save(this.state.create({ userId, job, lastRunAt: now, data: st?.data ?? {} }));
    return true;
  }

  private async runJob(user: User, job: Job, hasGoogle: boolean) {
    const key = `${user.id}:${job}`;
    this.busy.add(key);
    try {
      switch (job) {
        case 'brief': return await this.morningBrief(user, hasGoogle);
        case 'triage': return await this.inboxTriage(user);
        case 'meeting_prep': return await this.meetingPrep(user);
        case 'followups': return await this.followUps(user);
        case 'price_watch': return await this.priceWatch(user);
        case 'weekly_review': return await this.weeklyReview(user, hasGoogle);
      }
    } catch (e) {
      this.log.warn(`${job} failed for ${user.email}: ${(e as Error).message}`);
      await this.records.logActivity(user.id, 'automation', job, 'failed', (e as Error).message);
    } finally {
      this.busy.delete(key);
    }
  }

  private async jobData(userId: string, job: Job) {
    return (await this.state.findOne({ where: { userId, job } }))?.data ?? {};
  }

  private async saveJobData(userId: string, job: Job, data: Record<string, any>) {
    await this.state.update({ userId, job }, { data });
  }

  // ------------------------------------------------------------------ reminders
  private async deliverReminders(now: Date) {
    const due = await this.records.dueReminders(now);
    for (const r of due) {
      const user = await this.users.findOneBy({ id: r.userId });
      if (user) await this.records.notify(user, 'reminder', `⏰ Reminder: ${r.text}`);
      await this.records.reminders.update({ id: r.id }, { status: 'sent' });
    }
    return due.length;
  }

  // ------------------------------------------------------------------ morning brief
  async morningBrief(user: User, hasGoogle: boolean) {
    const tz = user.timezone;
    const today = dayRange(tz);
    const parts: Record<string, unknown> = { date: today.date, name: user.name.split(' ')[0] };
    if (hasGoogle) {
      const [events, mail] = await Promise.all([
        this.calendar.list(user.id, today.start, today.end).catch(() => []),
        this.gmail.search(user.id, 'is:unread is:important newer_than:1d', 8).catch(() => []),
      ]);
      parts.agenda = events.map((e) => `${e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' })} ${e.title}${e.location ? ` @ ${e.location}` : ''}`);
      parts.importantUnread = mail.map((m) => `${m.from.replace(/<.*>/, '').trim()}: ${m.subject}`);
    }
    const open = await this.records.listTasks(user.id, 'open');
    parts.tasksDueToday = open.filter((t) => t.due && t.due.toISOString() <= today.end).map((t) => t.title);
    parts.reminders = (await this.records.listReminders(user.id)).filter((r) => r.dueAt.toISOString() <= today.end).map((r) => `${fmtTime(r.dueAt.toISOString(), tz)} ${r.text}`);
    if (user.settings.homeCity) {
      const w: any = await this.weather.forecast(user.settings.homeCity, 1).catch(() => null);
      if (w?.daily?.[0]) parts.weather = { city: user.settings.homeCity, ...w.daily[0], imdWarnings: w.imdWarnings?.days ?? [] };
    }
    if (user.settings.newsTopics?.length) {
      parts.news = (await Promise.all(user.settings.newsTopics.slice(0, 3).map((t) => this.search.news(t, 2).then((n) => n.results.map((r: any) => r.title)).catch(() => [])))).flat();
    }
    const msg = await this.llm().invoke([
      ['system', 'Write a friendly morning brief for a chat app: greeting, then short sections only for data that exists (📅 agenda, 📧 important mail, ✅ tasks, ⏰ reminders, 🌤 weather incl. any IMD alert, 📰 news). Plain text, max 15 lines.'],
      ['human', JSON.stringify(parts)],
    ]);
    await this.records.notify(user, 'brief', String(msg.content));
    await this.records.logActivity(user.id, 'automation', 'brief', 'sent', 'Morning brief');
  }

  // ------------------------------------------------------------------ inbox triage
  async inboxTriage(user: User) {
    const data = await this.jobData(user.id, 'triage');
    const seen = new Set<string>(data.seen ?? []);
    const mails = (await this.gmail.search(user.id, 'in:inbox newer_than:1d -category:promotions -category:social', 20)).filter((m) => !seen.has(m.id));
    if (!mails.length) return;
    const triage = await this.llm().withStructuredOutput(TriageSchema, { name: 'triage' }).invoke([
      ['system', `Triage these emails for ${user.name}. "high" urgency only for time-sensitive requests from real people, security alerts, or bills due within 3 days.`],
      ['human', JSON.stringify(mails.map((m) => ({ id: m.id, from: m.from, subject: m.subject, snippet: m.snippet })))],
    ]);
    const urgent: string[] = [];
    for (const item of triage.items) {
      const m = mails.find((x) => x.id === item.id);
      if (!m) continue;
      await this.records.addDigest(user.id, { messageId: m.id, sender: m.from, subject: m.subject, summary: item.summary, category: item.category, urgency: item.urgency });
      if (item.actionItem) await this.records.addTask(user.id, { title: item.actionItem, due: item.actionDue, priority: item.urgency === 'high' ? 'high' : 'normal', source: 'email' });
      if (item.urgency === 'high') urgent.push(`• ${item.summary}${item.billAmountINR ? ` (₹${item.billAmountINR})` : ''}`);
    }
    if (urgent.length) await this.records.notify(user, 'triage', `📬 Urgent email${urgent.length > 1 ? 's' : ''}:\n${urgent.join('\n')}`);
    await this.saveJobData(user.id, 'triage', { seen: [...mails.map((m) => m.id), ...seen].slice(0, 500) });
  }

  // ------------------------------------------------------------------ meeting prep
  async meetingPrep(user: User) {
    const now = Date.now();
    const events = await this.calendar.list(user.id, new Date(now + 20 * 60_000).toISOString(), new Date(now + 45 * 60_000).toISOString());
    const data = await this.jobData(user.id, 'meeting_prep');
    const done = new Set<string>(data.done ?? []);
    for (const e of events.filter((x) => !x.allDay && !done.has(x.id))) {
      const external = e.attendees.slice(0, 5);
      const threads = external.length ? await this.gmail.search(user.id, `{${external.map((a) => `from:${a} to:${a}`).join(' ')}} newer_than:30d`, 6).catch(() => []) : [];
      const msg = await this.llm().invoke([
        ['system', 'Write a short meeting-prep note for a chat app (max 8 lines): when/where/link, who is attending, what recent emails with them were about, 1–2 suggested talking points.'],
        ['human', JSON.stringify({ event: e, when: fmtTime(e.start, user.timezone), recentEmails: threads.map((t) => `${t.from}: ${t.subject} — ${t.snippet}`) })],
      ]);
      await this.records.notify(user, 'meeting_prep', `🗓 Up next: ${e.title}\n${String(msg.content)}`);
      done.add(e.id);
    }
    await this.saveJobData(user.id, 'meeting_prep', { done: [...done].slice(-200) });
  }

  // ------------------------------------------------------------------ follow-ups
  async followUps(user: User) {
    const me = (await this.gmail.myAddress(user.id)).toLowerCase();
    const sent = await this.gmail.search(user.id, 'in:sent newer_than:7d older_than:3d', 15);
    const waiting: string[] = [];
    for (const m of sent) {
      if (/noreply|no-reply/i.test(m.to)) continue;
      const thread = await this.gmail.thread(user.id, m.threadId);
      const lastMsg = thread.at(-1);
      if (lastMsg && lastMsg.from.toLowerCase().includes(me)) waiting.push(`• ${m.to.replace(/<.*>/, '').trim()} — “${m.subject}” (sent ${m.date.slice(0, 16)})`);
      if (waiting.length >= 5) break;
    }
    if (waiting.length) await this.records.notify(user, 'followups', `🔁 No reply yet (3+ days):\n${waiting.join('\n')}\nWant me to draft polite follow-ups?`);
  }

  // ------------------------------------------------------------------ price watch
  async priceWatch(user: User) {
    for (const w of await this.records.listWatches(user.id)) {
      const best = await this.search.lowestPrice(w.query).catch(() => null);
      await this.records.watches.update({ id: w.id }, { lastCheckedAt: new Date(), ...(best ? { lastPrice: best.price, bestLink: best.url } : {}) });
      if (best && best.price <= w.targetPrice && (w.lastPrice == null || best.price < w.lastPrice)) {
        await this.records.notify(user, 'price_drop', `🛒 Price drop: ${w.query} is ₹${best.price.toLocaleString('en-IN')} at ${best.store} (target ₹${w.targetPrice.toLocaleString('en-IN')})\n${best.url ?? ''}`);
      }
    }
  }

  // ------------------------------------------------------------------ weekly review
  async weeklyReview(user: User, hasGoogle: boolean) {
    const tz = user.timezone;
    const from = dayRange(tz, -6).date;
    const to = dayRange(tz).date;
    const spend = await this.records.expenseSummary(user.id, from, to);
    const done = await this.tasks.count({ where: { userId: user.id, status: 'done', completedAt: MoreThanOrEqual(new Date(Date.now() - 7 * 86_400_000)) } });
    const open = await this.records.listTasks(user.id, 'open');
    const nextWeek = hasGoogle ? await this.calendar.list(user.id, dayRange(tz, 1).start, dayRange(tz, 7).end, undefined, 50).catch(() => []) : [];
    const msg = await this.llm().invoke([
      ['system', 'Write a weekly review for a chat app (max 12 lines): spending (total + top 3 categories), tasks done vs open (name up to 3 overdue), next week\'s calendar load (busiest day), one encouraging suggestion.'],
      ['human', JSON.stringify({ spend, tasksDone: done, openTasks: open.slice(0, 10).map((t) => ({ title: t.title, due: t.due })), nextWeekEvents: nextWeek.map((e) => ({ title: e.title, start: e.start })) })],
    ]);
    await this.records.notify(user, 'weekly_review', `📊 Weekly review\n${String(msg.content)}`);
  }
}
