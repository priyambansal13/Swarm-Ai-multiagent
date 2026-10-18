import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { z } from 'zod';
import { decrypt, encrypt, shortCode } from '../common/crypto.js';
import {
  Activity, DEFAULT_DESK, DEFAULT_ORG_SETTINGS, OrgInvite, OrgRole, OrgSettings, Organization, Thread, User,
} from '../db/entities.js';

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';

export const OrgUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  /** '' clears the org's own key (falls back to the server key) */
  openaiApiKey: z.string().trim().max(300).optional(),
  settings: z.object({
    assistantName: z.string().trim().min(1).max(40).optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    timezone: z.string().optional(),
    model: z.string().max(60).nullable().optional(),
    modelFast: z.string().max(60).nullable().optional(),
    desk: z.object({
      enabled: z.boolean().optional(),
      channels: z.array(z.enum(['telegram', 'whatsapp'])).optional(),
      whatsappPhoneNumberId: z.string().max(40).nullable().optional(),
      instructions: z.string().max(4000).optional(),
      greeting: z.string().max(500).optional(),
      escalateWhenUnsure: z.boolean().optional(),
      handoffMessage: z.string().max(500).optional(),
    }).optional(),
  }).optional(),
});

export const InviteSchema = z.object({
  role: z.enum(['admin', 'agent', 'member']),
  email: z.string().trim().toLowerCase().email().nullish(),
});

/** Public view of an organisation (no secrets). */
export const publicOrg = (o: Organization) => {
  const { openaiKeyEnc, ...settings } = withDefaults(o.settings);
  return { id: o.id, name: o.name, slug: o.slug, settings, hasOpenaiKey: !!openaiKeyEnc, createdAt: o.createdAt };
};

export const withDefaults = (s: Partial<OrgSettings> | null | undefined): OrgSettings => ({
  ...DEFAULT_ORG_SETTINGS, ...(s ?? {}), desk: { ...DEFAULT_DESK, ...(s?.desk ?? {}) },
});

/**
 * Organisations (tenants), members, roles and invites. Every user belongs to exactly one organisation:
 * personal records stay scoped by userId; shared data (knowledge base, agent registry, customer desk) by orgId.
 */
@Injectable()
export class OrgService implements OnApplicationBootstrap {
  private readonly log = new Logger(OrgService.name);
  private readonly cache = new Map<string, { org: Organization; at: number }>();

  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(OrgInvite) private readonly invites: Repository<OrgInvite>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Thread) private readonly threads: Repository<Thread>,
    @InjectRepository(Activity) private readonly activity: Repository<Activity>,
  ) {}

  /** Users created before multi-tenancy get their own organisation (as owner). */
  async onApplicationBootstrap() {
    const orphans = await this.users.find({ where: { orgId: IsNull() } });
    for (const u of orphans) {
      const org = await this.createOrg(`${u.name.split(' ')[0]}'s workspace`, u.timezone);
      await this.users.update({ id: u.id }, { orgId: org.id, role: 'owner' });
      this.log.log(`Created organisation "${org.name}" for ${u.email}`);
    }
  }

  async createOrg(name: string, timezone = 'Asia/Kolkata') {
    let slug = slugify(name);
    if (await this.orgs.exists({ where: { slug } })) slug = `${slug}-${shortCode(4).toLowerCase()}`;
    return this.orgs.save(this.orgs.create({ name, slug, settings: { ...DEFAULT_ORG_SETTINGS, timezone } }));
  }

  async get(orgId: string): Promise<Organization> {
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < 30_000) return hit.org;
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation not found');
    org.settings = withDefaults(org.settings);
    this.cache.set(orgId, { org, at: Date.now() });
    return org;
  }

  all() {
    return this.orgs.find({ order: { createdAt: 'ASC' } });
  }

  /** The org's own OpenAI key, if it has one. */
  apiKey(org: Organization): string | undefined {
    try {
      return org.settings.openaiKeyEnc ? decrypt(org.settings.openaiKeyEnc) : undefined;
    } catch {
      return undefined;
    }
  }

  async update(orgId: string, input: z.infer<typeof OrgUpdateSchema>) {
    const org = await this.get(orgId);
    if (input.settings?.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: input.settings.timezone });
      } catch {
        throw new BadRequestException(`Unknown timezone ${input.settings.timezone}`);
      }
    }
    const s = withDefaults(org.settings);
    const next: OrgSettings = { ...s, ...(input.settings ?? {}), desk: { ...s.desk, ...(input.settings?.desk ?? {}) } } as OrgSettings;
    if (input.openaiApiKey !== undefined) next.openaiKeyEnc = input.openaiApiKey ? encrypt(input.openaiApiKey) : null;
    await this.orgs.update({ id: orgId }, { name: input.name ?? org.name, settings: next });
    this.cache.delete(orgId);
    return publicOrg(await this.get(orgId));
  }

  // ------------------------------------------------------------------ members
  members(orgId: string) {
    return this.users.find({ where: { orgId }, order: { createdAt: 'ASC' } })
      .then((us) => us.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt })));
  }

  staff(orgId: string, roles: OrgRole[]) {
    return this.users.find({ where: { orgId, role: In(roles) } });
  }

  private async member(orgId: string, userId: string) {
    const u = await this.users.findOne({ where: { id: userId, orgId } });
    if (!u) throw new NotFoundException('Member not found');
    return u;
  }

  private async ensureAnotherOwner(orgId: string, userId: string) {
    const owners = await this.users.count({ where: { orgId, role: 'owner' } });
    const target = await this.member(orgId, userId);
    if (target.role === 'owner' && owners <= 1) throw new BadRequestException('An organisation needs at least one owner.');
  }

  async setRole(actor: User, userId: string, role: OrgRole) {
    if (role === 'owner' && actor.role !== 'owner') throw new ForbiddenException('Only an owner can make someone an owner.');
    const target = await this.member(actor.orgId, userId);
    if (target.role === 'owner' && actor.role !== 'owner') throw new ForbiddenException('Only an owner can change an owner.');
    if (role !== 'owner') await this.ensureAnotherOwner(actor.orgId, userId);
    await this.users.update({ id: userId }, { role });
    return { id: userId, role };
  }

  /** Removing a member moves them into a fresh personal organisation; their personal data stays theirs. */
  async remove(actor: User, userId: string) {
    if (userId === actor.id) throw new BadRequestException('You cannot remove yourself.');
    const target = await this.member(actor.orgId, userId);
    if (target.role === 'owner' && actor.role !== 'owner') throw new ForbiddenException('Only an owner can remove an owner.');
    await this.ensureAnotherOwner(actor.orgId, userId);
    const org = await this.createOrg(`${target.name.split(' ')[0]}'s workspace`, target.timezone);
    await this.users.update({ id: userId }, { orgId: org.id, role: 'owner' });
    return { removed: true };
  }

  // ------------------------------------------------------------------ invites
  async createInvite(actor: User, input: z.infer<typeof InviteSchema>) {
    await this.invites.delete({ expiresAt: LessThan(new Date()) });
    const inv = await this.invites.save(this.invites.create({
      code: shortCode(10), orgId: actor.orgId, role: input.role, email: input.email ?? null, createdBy: actor.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    }));
    return { ...inv, url: `${this.config.get('WEB_URL') ?? 'http://localhost:3200'}/signup?invite=${inv.code}` };
  }

  listInvites(orgId: string) {
    return this.invites.find({ where: { orgId, usedAt: IsNull() }, order: { createdAt: 'DESC' } });
  }

  async revokeInvite(orgId: string, code: string) {
    return { revoked: !!(await this.invites.delete({ orgId, code })).affected };
  }

  /** Valid, unused invite (for the sign-up page and for joining). */
  async invite(code: string) {
    const inv = await this.invites.findOne({ where: { code } });
    if (!inv || inv.usedAt || inv.expiresAt < new Date()) throw new BadRequestException('This invitation is invalid or has expired.');
    const org = await this.get(inv.orgId);
    return { inv, org };
  }

  /** Marks an invitation used — atomically, so one link can't create two accounts when used twice at once. */
  async claimInvite(code: string) {
    const r = await this.invites.update({ code, usedAt: IsNull(), expiresAt: MoreThan(new Date()) }, { usedAt: new Date() });
    if (!r.affected) throw new BadRequestException('This invitation is invalid or has expired.');
  }

  /** Gives an invitation back when the account could not be created after all. */
  async releaseInvite(code: string) {
    await this.invites.update({ code }, { usedAt: null as unknown as Date });
  }

  // ------------------------------------------------------------------ admin views
  /** Conversations of the org's members that wait for an approval. */
  async approvals(orgId: string) {
    const rows = await this.threads
      .createQueryBuilder('t')
      .innerJoin(User, 'u', 'u.id = t.userId')
      .where('u.orgId = :orgId', { orgId })
      .andWhere("t.status = 'awaiting_confirmation'")
      .select(['t.id AS id', 't.title AS title', 't.channel AS channel', 't.pending AS pending', 't.updatedAt AS "updatedAt"', 'u.name AS "userName"', 'u.email AS "userEmail"'])
      .orderBy('t.updatedAt', 'DESC')
      .limit(100)
      .getRawMany();
    return rows;
  }

  /** Audit log: every action of every member (approved actions, links, handoffs, rejections…). */
  audit(orgId: string, limit = 200) {
    return this.activity
      .createQueryBuilder('a')
      .innerJoin(User, 'u', 'u.id = a.userId')
      .where('u.orgId = :orgId', { orgId })
      .select(['a.id AS id', 'a.channel AS channel', 'a.agent AS agent', 'a.action AS action', 'a.detail AS detail', 'a.createdAt AS "createdAt"', 'u.name AS "userName"'])
      .orderBy('a.createdAt', 'DESC')
      .limit(Math.min(limit, 500))
      .getRawMany();
  }

  /** Usage for the admin overview (last 30 days). */
  async usage(orgId: string) {
    const q = (sql: string) => this.db.query(sql, [orgId]);
    const [[members], [threads], byAgent, [kb], desk, [outbox]] = await Promise.all([
      q('SELECT count(*)::int AS n FROM users WHERE "orgId" = $1'),
      q(`SELECT count(*)::int AS n FROM threads t JOIN users u ON u.id = t."userId" WHERE u."orgId" = $1 AND t."updatedAt" > now() - interval '30 days'`),
      q(`SELECT a.agent, count(*)::int AS n FROM activity a JOIN users u ON u.id = a."userId" WHERE u."orgId" = $1 AND a."createdAt" > now() - interval '30 days' GROUP BY a.agent ORDER BY n DESC`),
      q(`SELECT count(*)::int AS sources, coalesce(sum(chunks), 0)::int AS chunks FROM kb_sources WHERE "orgId" = $1`),
      q(`SELECT status, count(*)::int AS n FROM conversations WHERE "orgId" = $1 GROUP BY status`),
      q(`SELECT count(*)::int AS n FROM outbox o JOIN users u ON u.id = o."userId" WHERE u."orgId" = $1 AND o.status = 'sent' AND o."createdAt" > now() - interval '30 days'`),
    ]);
    return {
      members: members.n, conversations30d: threads.n, actions30d: byAgent, knowledge: kb,
      desk: Object.fromEntries(desk.map((r: any) => [r.status, r.n])), proactiveMessages30d: outbox.n,
    };
  }
}
