import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import { fmtTime } from '../common/time.js';
import {
  Activity, Channel, ChannelLink, Contact, EmailDigestEntry, Expense, Note, OutboxMessage, PriceWatch, ProfileFact, Reminder, Task,
  TravelLogEntry, User,
} from '../db/entities.js';
import { SheetsService } from '../google/sheets.service.js';
import { OpenAIMediaService } from '../integrations/openai-media.service.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Personal records for every agent. Postgres is the source of truth; each write is mirrored
 * (best-effort) to the user's Google Sheet tabs: Tasks, Expenses, Contacts, TravelLog, EmailDigest, ActivityLog.
 */
@Injectable()
export class RecordsService implements OnModuleInit {
  private readonly log = new Logger(RecordsService.name);

  constructor(
    private readonly db: DataSource,
    private readonly sheets: SheetsService,
    private readonly media: OpenAIMediaService,
    @InjectRepository(Task) readonly tasks: Repository<Task>,
    @InjectRepository(Reminder) readonly reminders: Repository<Reminder>,
    @InjectRepository(Expense) readonly expenses: Repository<Expense>,
    @InjectRepository(Contact) readonly contacts: Repository<Contact>,
    @InjectRepository(TravelLogEntry) readonly travel: Repository<TravelLogEntry>,
    @InjectRepository(Note) readonly notes: Repository<Note>,
    @InjectRepository(ProfileFact) readonly facts: Repository<ProfileFact>,
    @InjectRepository(PriceWatch) readonly watches: Repository<PriceWatch>,
    @InjectRepository(Activity) readonly activity: Repository<Activity>,
    @InjectRepository(EmailDigestEntry) readonly digest: Repository<EmailDigestEntry>,
    @InjectRepository(OutboxMessage) readonly outbox: Repository<OutboxMessage>,
    @InjectRepository(ChannelLink) readonly links: Repository<ChannelLink>,
  ) {}

  /** pgvector table for note embeddings (kept outside TypeORM so `synchronize` never touches it). */
  async onModuleInit() {
    await this.db.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.db.query(`CREATE TABLE IF NOT EXISTS note_embeddings (
      note_id uuid PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      user_id uuid NOT NULL,
      embedding vector(1536) NOT NULL)`);
    await this.db.query('CREATE INDEX IF NOT EXISTS note_embeddings_user ON note_embeddings(user_id)');
  }

  // ------------------------------------------------------------------ activity log
  async logActivity(userId: string, channel: string, agent: string, action: string, detail: string) {
    await this.activity.save(this.activity.create({ userId, channel, agent, action, detail: detail.slice(0, 2000) }));
    void this.sheets.append(userId, 'ActivityLog', [new Date().toISOString(), channel, agent, action, detail.slice(0, 500)]);
  }

  // ------------------------------------------------------------------ tasks
  async addTask(userId: string, o: { title: string; due?: string | null; priority?: Task['priority']; source?: string }) {
    const t = await this.tasks.save(this.tasks.create({ userId, title: o.title, due: o.due ? new Date(o.due) : null, priority: o.priority ?? 'normal', source: o.source ?? 'chat' }));
    void this.sheets.append(userId, 'Tasks', [t.createdAt.toISOString(), t.title, t.due?.toISOString() ?? '', t.priority, t.status, t.source]);
    return t;
  }

  listTasks(userId: string, status: 'open' | 'done' | 'all' = 'open') {
    return this.tasks.find({ where: { userId, ...(status === 'all' ? {} : { status }) }, order: { due: 'ASC', createdAt: 'DESC' }, take: 100 });
  }

  async completeTask(userId: string, id: string) {
    const t = await this.tasks.findOne({ where: { userId, id } });
    if (!t) return null;
    t.status = 'done';
    t.completedAt = new Date();
    await this.tasks.save(t);
    void this.sheets.append(userId, 'Tasks', [new Date().toISOString(), t.title, t.due?.toISOString() ?? '', t.priority, 'done', 'update']);
    return t;
  }

  async deleteTask(userId: string, id: string) {
    const r = await this.tasks.delete({ userId, id });
    return { deleted: !!r.affected };
  }

  // ------------------------------------------------------------------ reminders
  addReminder(userId: string, text: string, dueAt: Date) {
    return this.reminders.save(this.reminders.create({ userId, text, dueAt }));
  }

  listReminders(userId: string) {
    return this.reminders.find({ where: { userId, status: 'pending' }, order: { dueAt: 'ASC' }, take: 100 });
  }

  async cancelReminder(userId: string, id: string) {
    const r = await this.reminders.update({ userId, id, status: 'pending' }, { status: 'cancelled' });
    return { cancelled: !!r.affected };
  }

  dueReminders(now = new Date()) {
    return this.reminders.find({ where: { status: 'pending', dueAt: LessThanOrEqual(now) }, take: 200 });
  }

  // ------------------------------------------------------------------ expenses
  async addExpense(userId: string, o: { amount: number; category: string; note?: string; date?: string; currency?: string; source?: string }) {
    const e = await this.expenses.save(this.expenses.create({
      userId, amount: o.amount, category: o.category.toLowerCase(), note: o.note ?? '', date: o.date ?? today(), currency: o.currency ?? 'INR', source: o.source ?? 'chat',
    }));
    void this.sheets.append(userId, 'Expenses', [e.date, e.amount, e.currency, e.category, e.note, e.source]);
    return e;
  }

  async expenseSummary(userId: string, from: string, to: string) {
    const rows = await this.expenses.find({ where: { userId, date: Between(from, to) }, order: { date: 'DESC' } });
    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount;
    return {
      from, to, count: rows.length, totalINR: rows.reduce((t, r) => t + (r.currency === 'INR' ? r.amount : 0), 0),
      byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount })),
      recent: rows.slice(0, 10).map((r) => ({ id: r.id, date: r.date, amount: r.amount, currency: r.currency, category: r.category, note: r.note })),
    };
  }

  // ------------------------------------------------------------------ contacts & travel log
  async addContact(userId: string, o: { name: string; email?: string | null; phone?: string | null; notes?: string }) {
    const c = await this.contacts.save(this.contacts.create({ userId, name: o.name, email: o.email ?? null, phone: o.phone ?? null, notes: o.notes ?? '' }));
    void this.sheets.append(userId, 'Contacts', [c.name, c.email, c.phone, c.notes]);
    return c;
  }

  findContacts(userId: string, q: string) {
    return this.contacts
      .createQueryBuilder('c')
      .where('c.userId = :userId', { userId })
      .andWhere('(c.name ILIKE :q OR c.email ILIKE :q OR c.notes ILIKE :q)', { q: `%${q}%` })
      .take(10)
      .getMany();
  }

  async logTrip(userId: string, o: { trip: string; dates?: string; details?: string; estCost?: number | null; links?: string }) {
    const t = await this.travel.save(this.travel.create({ userId, trip: o.trip, dates: o.dates ?? '', details: o.details ?? '', estCost: o.estCost ?? null, links: o.links ?? '' }));
    void this.sheets.append(userId, 'TravelLog', [t.createdAt.toISOString(), t.trip, t.dates, t.details, t.estCost, t.links]);
    return t;
  }

  // ------------------------------------------------------------------ notes (semantic) & facts
  async addNote(userId: string, o: { title: string; content: string; tags?: string[] }) {
    const n = await this.notes.save(this.notes.create({ userId, title: o.title, content: o.content, tags: o.tags ?? [] }));
    try {
      const [vec] = await this.media.embed([`${n.title}\n${n.content}`]);
      await this.db.query('INSERT INTO note_embeddings (note_id, user_id, embedding) VALUES ($1, $2, $3::vector)', [n.id, userId, `[${vec.join(',')}]`]);
    } catch (e) {
      this.log.warn(`Embedding failed for note ${n.id}: ${(e as Error).message}`);
    }
    return n;
  }

  /** Semantic search (cosine distance via pgvector), with keyword fallback. */
  async searchNotes(userId: string, query: string, k = 5) {
    try {
      const [vec] = await this.media.embed([query]);
      const rows = await this.db.query(
        `SELECT n.id, n.title, n.content, n.tags, n."createdAt", 1 - (e.embedding <=> $2::vector) AS score
         FROM note_embeddings e JOIN notes n ON n.id = e.note_id
         WHERE e.user_id = $1 ORDER BY e.embedding <=> $2::vector LIMIT $3`,
        [userId, `[${vec.join(',')}]`, k],
      );
      if (rows.length) return rows.map((r: any) => ({ ...r, score: Number(Number(r.score).toFixed(3)) }));
    } catch (e) {
      this.log.warn(`Vector search failed: ${(e as Error).message}`);
    }
    return this.notes
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .andWhere('(n.title ILIKE :q OR n.content ILIKE :q)', { q: `%${query}%` })
      .orderBy('n.createdAt', 'DESC')
      .take(k)
      .getMany();
  }

  addFact(userId: string, fact: string) {
    return this.facts.save(this.facts.create({ userId, fact }));
  }

  listFacts(userId: string) {
    return this.facts.find({ where: { userId }, order: { createdAt: 'ASC' }, take: 50 });
  }

  async deleteFact(userId: string, id: string) {
    return { deleted: !!(await this.facts.delete({ userId, id })).affected };
  }

  // ------------------------------------------------------------------ price watches
  addWatch(userId: string, query: string, targetPrice: number) {
    return this.watches.save(this.watches.create({ userId, query, targetPrice }));
  }

  listWatches(userId: string) {
    return this.watches.find({ where: { userId, active: true }, order: { createdAt: 'DESC' } });
  }

  async stopWatch(userId: string, id: string) {
    return { stopped: !!(await this.watches.update({ userId, id }, { active: false })).affected };
  }

  // ------------------------------------------------------------------ email digest
  async addDigest(userId: string, o: { messageId: string; sender: string; subject: string; summary: string; category: string; urgency: 'high' | 'normal' | 'low' }) {
    const d = await this.digest.save(this.digest.create({ userId, ...o }));
    void this.sheets.append(userId, 'EmailDigest', [d.createdAt.toISOString(), d.sender, d.subject, d.summary, d.category, d.urgency]);
    return d;
  }

  // ------------------------------------------------------------------ outbox (proactive delivery)
  /** Queue a proactive message on the user's preferred channel (falls back to web notifications). */
  async notify(user: User, kind: string, text: string) {
    const links = await this.links.find({ where: { userId: user.id } });
    const pref = user.settings?.notifyChannel ?? 'telegram';
    const link = links.find((l) => l.channel === pref) ?? (pref === 'web' ? undefined : links[0]);
    const channel: Channel = link ? link.channel : 'web';
    return this.outbox.save(this.outbox.create({ userId: user.id, channel, externalId: link?.externalId ?? null, kind, text: text.slice(0, 4000) }));
  }

  /** Claim pending non-web messages for n8n to deliver. */
  async claimOutbox(limit = 50) {
    const pending = await this.outbox.find({ where: { status: 'pending', channel: In(['telegram', 'whatsapp']) }, order: { createdAt: 'ASC' }, take: limit });
    if (pending.length) await this.outbox.update({ id: In(pending.map((p) => p.id)) }, { status: 'sending' });
    return pending;
  }

  async ackOutbox(sent: string[], failed: { id: string; error: string }[] = []) {
    if (sent.length) await this.outbox.update({ id: In(sent) }, { status: 'sent', sentAt: new Date() });
    for (const f of failed) await this.outbox.update({ id: f.id }, { status: 'failed', error: f.error.slice(0, 500) });
  }

  webNotifications(userId: string) {
    return this.outbox.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 30 });
  }

  formatReminderList(rows: Reminder[], tz: string) {
    return rows.map((r) => `• ${r.text} — ${fmtTime(r.dueAt.toISOString(), tz)}`).join('\n');
  }
}
