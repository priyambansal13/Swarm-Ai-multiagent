import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatOpenAI } from '@langchain/openai';
import { DataSource, In, Repository } from 'typeorm';
import { AgentRegistryService } from '../agents/registry.service.js';
import type { RunContext } from '../agents/context.js';
import { SwarmGraphService } from '../agents/graph.service.js';
import {
  Channel, Conversation, ConversationMessage, ConversationStatus, DEFAULT_SETTINGS, Organization, STAFF_ROLES, User,
} from '../db/entities.js';
import type { Attachment } from '../integrations/openai-media.service.js';
import { N8nChannelsService } from '../integrations/n8n-channels.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { OrgService, withDefaults } from '../orgs/org.service.js';
import { RecordsService } from '../records/records.service.js';

/** "I want to talk to a person", "agent", "human please", "insaan se baat karni hai"… */
export const WANTS_HUMAN =
  /(\b(talk|speak|chat|connect)\b.{0,30}\b(human|person|someone|somebody|agent|representative|staff|team|manager|executive)\b)|^\s*(human|agent|operator|representative|real person|customer care)\b[\s.!?]*(please|pls)?[\s.!?]*$|insaan|kisi se baat/i;

const NIL = '00000000-0000-0000-0000-000000000000';

export interface DeskInbound {
  channel: Channel;
  externalId: string;
  displayName?: string | null;
  text: string;
  attachments?: Attachment[];
  isVoice?: boolean;
}

/**
 * Customer desk with human handoff (P7). People who are not members of the organisation talk to its bot on
 * WhatsApp/Telegram. The bot answers from the knowledge base and escalates (customer asks, is unhappy, needs
 * staff, or the answer is unknown). Staff see the conversation in the web inbox, reply on the same thread, and
 * hand it back to the bot, which then resumes with the staff replies as context.
 */
@Injectable()
export class DeskService {
  private readonly log = new Logger(DeskService.name);
  private readonly busy = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
    @InjectRepository(Conversation) private readonly convs: Repository<Conversation>,
    @InjectRepository(ConversationMessage) private readonly msgs: Repository<ConversationMessage>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly orgs: OrgService,
    private readonly registry: AgentRegistryService,
    private readonly knowledge: KnowledgeService,
    private readonly graph: SwarmGraphService,
    private readonly channels: N8nChannelsService,
    private readonly records: RecordsService,
  ) {}

  /** The organisation whose desk answers unknown senders on this channel (and WhatsApp number). */
  async orgFor(channel: 'telegram' | 'whatsapp', to?: string | null): Promise<Organization | null> {
    const candidates = (await this.orgs.all())
      .map((o) => Object.assign(o, { settings: withDefaults(o.settings) }))
      .filter((o) => o.settings.desk.enabled && o.settings.desk.channels.includes(channel));
    const phone = (o: Organization) => o.settings.desk.whatsappPhoneNumberId;
    if (channel === 'whatsapp' && to) return candidates.find((o) => phone(o) === to) ?? candidates.find((o) => !phone(o)) ?? null;
    return candidates[0] ?? null;
  }

  private addMessage(conversationId: string, role: ConversationMessage['role'], text: string, author?: User) {
    return this.msgs.save(this.msgs.create({ conversationId, role, text: text.slice(0, 8000), authorId: author?.id ?? null, authorName: author?.name ?? null }));
  }

  // ------------------------------------------------------------------ customer side
  /** Handles one customer message. Returns the reply to send ('' = stay quiet, a person is handling it). */
  async inbound(org: Organization, m: DeskInbound): Promise<string> {
    org = await this.orgs.get(org.id);
    const desk = org.settings.desk;
    let conv = await this.convs.findOne({ where: { orgId: org.id, channel: m.channel, externalId: m.externalId } });
    const isNew = !conv;
    conv ??= this.convs.create({ orgId: org.id, channel: m.channel, externalId: m.externalId, status: 'bot' });
    if (m.displayName) conv.displayName = m.displayName;
    conv.lastMessageAt = new Date();
    if (conv.status === 'closed') conv.status = 'bot';
    const files = m.attachments?.length ? ` [sent ${m.attachments.map((a) => a.name).join(', ')}]` : '';
    if (conv.status !== 'bot') {
      conv.unread += 1;
      conv = await this.convs.save(conv);
      await this.addMessage(conv.id, 'customer', `${m.isVoice ? '🎙️ ' : ''}${m.text}${files}`);
      return '';
    }
    conv = await this.convs.save(conv);
    await this.addMessage(conv.id, 'customer', `${m.isVoice ? '🎙️ ' : ''}${m.text}${files}`);

    if (WANTS_HUMAN.test(m.text)) {
      await this.escalate(org, conv, 'Customer asked for a person', await this.summarise(org, conv.id));
      return desk.handoffMessage;
    }
    if (this.busy.has(conv.id)) return '⏳ One moment, still working on your previous message…';
    this.busy.add(conv.id);
    try {
      const ctx = await this.context(org, conv, m.attachments ?? []);
      const result = await this.graph.run(`desk-${conv.id}`, ctx, await this.withStaffContext(conv.id, m.text));
      let reply = result.reply.trim() || 'Sorry, I could not find an answer to that.';
      if (isNew && desk.greeting) reply = `${desk.greeting}\n\n${reply}`;
      await this.addMessage(conv.id, 'bot', reply);
      if (ctx.escalation) await this.escalate(org, conv, ctx.escalation.reason, ctx.escalation.summary);
      return reply;
    } catch (e) {
      this.log.error(`desk ${conv.id}: ${(e as Error).message}`);
      await this.escalate(org, conv, `Bot error: ${(e as Error).message.slice(0, 120)}`, await this.summarise(org, conv.id).catch(() => ''));
      return desk.handoffMessage;
    } finally {
      this.busy.delete(conv.id);
    }
  }

  /** Stand-in context: no personal data, only customer-safe agents and tools. */
  private async context(org: Organization, conv: Conversation, attachments: Attachment[]): Promise<RunContext> {
    const user = {
      id: NIL, orgId: org.id, role: 'member', name: conv.displayName || 'Customer', email: '', timezone: org.settings.timezone,
      settings: { ...DEFAULT_SETTINGS }, passwordHash: '', createdAt: new Date(),
    } as User;
    const [agents, kbSources] = await Promise.all([this.registry.forRun(org.id, 'customer'), this.knowledge.countReady(org.id)]);
    return {
      user, org, mode: 'customer', agents, apiKey: this.orgs.apiKey(org), kbSources, escalation: null,
      runId: randomUUID(), threadId: `desk-${conv.id}`, channel: conv.channel, googleConnected: false, links: {},
      attachments, facts: [], pending: [], emit: () => {},
    };
  }

  /** Staff replies since the bot last spoke, so the bot can continue where the person left off. */
  private async withStaffContext(conversationId: string, text: string) {
    const recent = await this.msgs.find({ where: { conversationId }, order: { createdAt: 'DESC' }, take: 30 });
    const staff: ConversationMessage[] = [];
    for (const r of recent.slice(1)) {
      if (r.role === 'bot') break;
      if (r.role === 'staff') staff.unshift(r);
    }
    if (!staff.length) return text;
    return `[While you were away, our team replied to the customer in this chat:\n${staff.map((s) => `- ${s.authorName ?? 'Team'}: ${s.text}`).join('\n')}]\n\n${text}`;
  }

  private async summarise(org: Organization, conversationId: string) {
    const recent = (await this.msgs.find({ where: { conversationId }, order: { createdAt: 'DESC' }, take: 20 })).reverse();
    const transcript = recent.map((r) => `${r.role}: ${r.text}`).join('\n').slice(-6000);
    try {
      const key = this.orgs.apiKey(org);
      const llm = new ChatOpenAI({ model: org.settings.modelFast || this.config.get('OPENAI_MODEL_FAST') || 'gpt-4.1-mini', maxRetries: 1, timeout: 30_000, ...(key ? { apiKey: key } : {}) });
      const res = await llm.invoke(`Summarise this customer chat for a support team member in 2–4 short lines: who the customer is, what they want, what the bot already answered, what is still open.\n\n${transcript}`);
      return typeof res.content === 'string' ? res.content : transcript.slice(-500);
    } catch {
      return transcript.slice(-500);
    }
  }

  /** Bot stops answering; the assignee (or every owner/admin/agent) is notified on their notify channel. */
  private async escalate(org: Organization, conv: Conversation, reason: string, summary: string) {
    await this.convs.update({ id: conv.id }, { status: 'waiting', reason: reason.slice(0, 500), summary: summary.slice(0, 2000), unread: 1 });
    await this.addMessage(conv.id, 'system', `Handed to the team — ${reason}`);
    if (conv.channel === 'web') return; // simulator
    const staff = conv.assignedTo ? await this.users.find({ where: { id: conv.assignedTo } }) : await this.orgs.staff(org.id, STAFF_ROLES);
    const web = this.config.get<string>('WEB_URL') ?? 'http://localhost:3200';
    const who = conv.displayName ?? conv.externalId;
    for (const u of staff) {
      await this.records.notify(u, 'handoff', `🙋 ${who} (${conv.channel}) needs a person — ${reason}\n\n${summary}\n\nReply in the inbox: ${web}/inbox?c=${conv.id}`);
    }
    this.log.log(`Escalated conversation ${conv.id}: ${reason}`);
  }

  // ------------------------------------------------------------------ staff inbox
  async list(orgId: string, status?: ConversationStatus | 'open') {
    const where = status === 'open' ? `AND c.status IN ('waiting', 'human')` : status ? 'AND c.status = $2' : '';
    return this.db.query(
      `SELECT c.*, u.name AS "assigneeName", m.text AS "lastText", m.role AS "lastRole"
       FROM conversations c
       LEFT JOIN users u ON u.id = c."assignedTo"
       LEFT JOIN LATERAL (SELECT text, role FROM conversation_messages WHERE "conversationId" = c.id ORDER BY "createdAt" DESC LIMIT 1) m ON true
       WHERE c."orgId" = $1 ${where}
       ORDER BY (c.status = 'waiting') DESC, c."lastMessageAt" DESC LIMIT 200`,
      status && status !== 'open' ? [orgId, status] : [orgId],
    );
  }

  async counts(orgId: string) {
    const rows: { status: string; n: number; unread: number }[] = await this.db.query(
      'SELECT status, count(*)::int AS n, coalesce(sum(unread), 0)::int AS unread FROM conversations WHERE "orgId" = $1 AND channel <> \'web\' GROUP BY status', [orgId]);
    return Object.fromEntries(rows.map((r) => [r.status, { count: r.n, unread: r.unread }]));
  }

  private async conv(orgId: string, id: string) {
    const c = await this.convs.findOne({ where: { orgId, id } });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  async get(orgId: string, id: string, markRead = true) {
    const c = await this.conv(orgId, id);
    if (c.unread && markRead) await this.convs.update({ id }, { unread: 0 });
    const messages = (await this.msgs.find({ where: { conversationId: id }, order: { createdAt: 'DESC' }, take: 300 })).reverse();
    const assignee = c.assignedTo ? await this.users.findOne({ where: { id: c.assignedTo } }) : null;
    return { ...c, unread: markRead ? 0 : c.unread, assigneeName: assignee?.name ?? null, messages };
  }

  /** Staff reply on the customer's own WhatsApp/Telegram thread; the bot stays paused. */
  async reply(staff: User, id: string, text: string) {
    const c = await this.conv(staff.orgId, id);
    if (c.channel !== 'web') {
      try {
        await this.channels.send(c.channel, c.externalId, text);
      } catch (e) {
        throw new BadRequestException(`Could not send on ${c.channel}: ${(e as Error).message}`);
      }
    }
    const msg = await this.addMessage(c.id, 'staff', text, staff);
    await this.convs.update({ id }, { status: 'human', assignedTo: c.assignedTo ?? staff.id, unread: 0, lastMessageAt: new Date() });
    await this.records.logActivity(staff.id, c.channel, 'desk', 'staff_reply', `${c.displayName ?? c.externalId}: ${text.slice(0, 300)}`);
    return msg;
  }

  async assign(staff: User, id: string, userId: string | null) {
    const c = await this.conv(staff.orgId, id);
    const assignee = userId ? await this.users.findOne({ where: { id: userId, orgId: staff.orgId, role: In(STAFF_ROLES) } }) : staff;
    if (!assignee) throw new BadRequestException('That person is not an owner, admin or agent of this organisation.');
    await this.convs.update({ id }, { assignedTo: assignee.id, status: c.status === 'closed' ? 'closed' : 'human' });
    await this.addMessage(id, 'system', `${assignee.name} is handling this conversation${assignee.id !== staff.id ? ` (assigned by ${staff.name})` : ''}`);
    await this.records.logActivity(staff.id, c.channel, 'desk', 'assign', `${c.displayName ?? c.externalId} → ${assignee.name}`);
    return this.get(staff.orgId, id);
  }

  /** Hand the conversation back to the bot (optionally telling the customer). */
  async release(staff: User, id: string, message?: string | null) {
    const c = await this.conv(staff.orgId, id);
    if (message?.trim()) await this.reply(staff, id, message.trim());
    await this.convs.update({ id }, { status: 'bot', assignedTo: null, reason: null });
    await this.addMessage(id, 'system', `Handed back to the assistant by ${staff.name}`);
    await this.records.logActivity(staff.id, c.channel, 'desk', 'release', c.displayName ?? c.externalId);
    return this.get(staff.orgId, id);
  }

  async close(staff: User, id: string) {
    const c = await this.conv(staff.orgId, id);
    await this.convs.update({ id }, { status: 'closed', unread: 0 });
    await this.addMessage(id, 'system', `Closed by ${staff.name}`);
    await this.records.logActivity(staff.id, c.channel, 'desk', 'close', c.displayName ?? c.externalId);
    return this.get(staff.orgId, id);
  }

  // ------------------------------------------------------------------ simulator (admin console "test as a customer")
  private simId = (u: User) => `sim-${u.id}`;

  async simulate(admin: User, text: string) {
    const org = await this.orgs.get(admin.orgId);
    const reply = await this.inbound(org, { channel: 'web', externalId: this.simId(admin), displayName: `${admin.name} (test)`, text });
    return { reply, conversation: await this.simulation(admin) };
  }

  async simulation(admin: User) {
    const c = await this.convs.findOne({ where: { orgId: admin.orgId, channel: 'web', externalId: this.simId(admin) } });
    return c ? this.get(admin.orgId, c.id, false) : null;
  }

  async resetSimulation(admin: User) {
    const c = await this.convs.findOne({ where: { orgId: admin.orgId, channel: 'web', externalId: this.simId(admin) } });
    if (c) {
      await this.msgs.delete({ conversationId: c.id });
      await this.convs.delete({ id: c.id });
      await this.graph.deleteHistory(`desk-${c.id}`);
    }
    return { reset: true };
  }
}
