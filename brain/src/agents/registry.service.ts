import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { AgentAudience, AgentConfig, DeskSettings } from '../db/entities.js';
import { OrgService } from '../orgs/org.service.js';
import { AGENTS, CONFIRM_RULE } from './agents.js';
import { propose, type RunContext } from './context.js';
import type { Services } from './tools/common.js';

/** Tools that always ask the user before acting (they call propose() themselves). */
const CONFIRMED = new Set(['gmail_send', 'gmail_reply', 'gmail_archive', 'calendar_create', 'calendar_update', 'calendar_delete', 'delete_task', 'log_receipt_expense']);
/** Tools that never touch a member's personal data — the only ones customer-desk agents can use. */
export const CUSTOMER_SAFE = new Set([
  'kb_search', 'kb_list_sources', 'web_search', 'news_search', 'read_url', 'get_weather', 'search_flights', 'search_hotels',
  'plan_india_trip', 'search_products', 'analyze_attachments',
]);
const GOOGLE_GROUPS = new Set(AGENTS.filter((a) => a.needsGoogle).map((a) => a.id));

export interface CatalogTool {
  /** Unique id (the tool name, or group:name when two agents share a name) */
  id: string;
  name: string;
  description: string;
  /** Built-in agent the tool comes from */
  group: string;
  needsGoogle: boolean;
  alwaysConfirmed: boolean;
  customerSafe: boolean;
}

export interface ResolvedAgent {
  id: string;
  kind: 'builtin' | 'custom';
  label: string;
  description: string;
  /** Final prompt (base or replacement + org instructions) */
  prompt: string;
  enabled: boolean;
  audience: AgentAudience;
  model: string | null;
  toolIds: string[];
  approvalTools: string[];
  needsGoogle: boolean;
  /** The org has a configuration row for it */
  customized: boolean;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  org?: { assistantName?: string; desk?: Partial<DeskSettings> };
  agents: (Partial<z.infer<typeof AgentConfigSchema>> & { agentId: string; kind?: 'builtin' | 'custom' })[];
}

const ID = /^[a-z][a-z0-9_]{1,30}$/;
export const AgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  label: z.string().trim().min(1).max(40).nullable().default(null),
  description: z.string().trim().max(400).nullable().default(null),
  prompt: z.string().trim().max(8000).nullable().default(null),
  extraInstructions: z.string().max(4000).default(''),
  model: z.string().trim().max(60).nullable().default(null),
  tools: z.array(z.string()).max(40).nullable().default(null),
  approvalTools: z.array(z.string()).max(40).default([]),
  audience: z.enum(['staff', 'customer', 'both']).nullable().default(null),
});
export const CustomAgentSchema = AgentConfigSchema.extend({
  agentId: z.string().regex(ID, 'lowercase letters, digits and _ (2–31 chars, starting with a letter)'),
  label: z.string().trim().min(1).max(40),
  description: z.string().trim().min(5).max(400),
  prompt: z.string().trim().min(10).max(8000),
  tools: z.array(z.string()).min(1).max(40),
});

const PACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packs');
const stubCtx = { user: { id: '', timezone: 'Asia/Kolkata', settings: {} }, org: { id: '' }, attachments: [], pending: [], emit: () => {} } as unknown as RunContext;

/**
 * Config-driven agents. Built-in agents are defined in code (agents.ts); each organisation can switch them
 * on/off, tune their prompt, model, tools, audience and approval rules, and add custom agents built from the
 * shared tool catalogue. Industry packs (packs/*.json) are just bundles of this configuration.
 */
@Injectable()
export class AgentRegistryService {
  private readonly cache = new Map<string, { agents: ResolvedAgent[]; at: number }>();
  private catalogCache: CatalogTool[] | null = null;

  constructor(
    @InjectRepository(AgentConfig) private readonly configs: Repository<AgentConfig>,
    private readonly orgs: OrgService,
  ) {}

  // ------------------------------------------------------------------ tool catalogue
  /** Every tool of every built-in agent, with a unique id. */
  catalog(): CatalogTool[] {
    if (this.catalogCache) return this.catalogCache;
    const raw = AGENTS.flatMap((a) => a.tools({} as Services, stubCtx).map((t) => ({ t, group: a.id })));
    const seen = new Map<string, number>();
    for (const { t } of raw) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
    const out: CatalogTool[] = [];
    const ids = new Set<string>();
    for (const { t, group } of raw) {
      const id = seen.get(t.name)! > 1 ? `${group}:${t.name}` : t.name;
      if (ids.has(id)) continue;
      ids.add(id);
      out.push({
        id, name: t.name, description: t.description, group, needsGoogle: GOOGLE_GROUPS.has(group),
        alwaysConfirmed: CONFIRMED.has(t.name), customerSafe: CUSTOMER_SAFE.has(t.name),
      });
    }
    return (this.catalogCache = out);
  }

  private defaultToolIds(agentId: string) {
    return this.catalog().filter((t) => t.group === agentId).map((t) => t.id);
  }

  /** Live tool instances for one run, keyed by catalogue id. */
  private instances(s: Services, ctx: RunContext) {
    const byId = new Map(this.catalog().map((c) => [`${c.group}|${c.name}`, c.id]));
    const map = new Map<string, StructuredToolInterface>();
    for (const a of AGENTS) {
      for (const t of a.tools(s, ctx)) {
        const id = byId.get(`${a.id}|${t.name}`);
        if (id && !map.has(id)) map.set(id, t);
      }
    }
    return map;
  }

  /** Tools an agent gets in this run: its selection, filtered for customers, approval rules applied. */
  tools(agent: ResolvedAgent, s: Services, ctx: RunContext): StructuredToolInterface[] {
    const live = this.instances(s, ctx);
    const out = new Map<string, StructuredToolInterface>();
    for (const id of agent.toolIds) {
      const t = live.get(id);
      if (!t || out.has(t.name)) continue;
      const needsApproval = agent.approvalTools.includes(id) && !CONFIRMED.has(t.name);
      if (ctx.mode === 'customer' && (!CUSTOMER_SAFE.has(t.name) || needsApproval)) continue;
      out.set(t.name, needsApproval ? this.approvalWrapper(agent, id, t, ctx) : t);
    }
    return [...out.values()];
  }

  /** Same schema as the real tool, but only proposes; the real tool runs after the user approves. */
  private approvalWrapper(agent: ResolvedAgent, id: string, t: StructuredToolInterface, ctx: RunContext) {
    return tool(
      async (input: Record<string, unknown>) => {
        const brief = Object.entries(input ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
        return JSON.stringify(propose(ctx, agent.id, 'tool_call', `${agent.label} → ${t.name.replace(/_/g, ' ')}${brief ? ` (${brief.slice(0, 160)})` : ''}`, { tool: id, input }));
      },
      { name: t.name, description: `${t.description} Requires the user's approval.`, schema: t.schema as any },
    );
  }

  /** Runs an approved `tool_call` action. */
  async runApproved(s: Services, ctx: RunContext, toolId: string, input: unknown) {
    const t = this.instances(s, ctx).get(toolId);
    if (!t) throw new Error(`Tool ${toolId} is not available`);
    return String(await t.invoke(input as any));
  }

  // ------------------------------------------------------------------ resolution
  async resolve(orgId: string): Promise<ResolvedAgent[]> {
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < 30_000) return hit.agents;
    const rows = await this.configs.find({ where: { orgId } });
    const agents: ResolvedAgent[] = AGENTS.map((spec) => {
      const c = rows.find((r) => r.agentId === spec.id && r.kind === 'builtin');
      return this.merge({
        id: spec.id, kind: 'builtin', label: spec.label, description: spec.description, prompt: spec.prompt,
        audience: spec.audience ?? 'staff', toolIds: this.defaultToolIds(spec.id),
      }, c);
    });
    for (const c of rows.filter((r) => r.kind === 'custom')) {
      agents.push(this.merge({ id: c.agentId, kind: 'custom', label: c.label ?? c.agentId, description: c.description ?? '', prompt: c.prompt ?? '', audience: 'staff', toolIds: [] }, c));
    }
    this.cache.set(orgId, { agents, at: Date.now() });
    return agents;
  }

  private merge(base: Pick<ResolvedAgent, 'id' | 'kind' | 'label' | 'description' | 'prompt' | 'audience' | 'toolIds'>, c?: AgentConfig): ResolvedAgent {
    const toolIds = c?.tools ?? base.toolIds;
    const approvalTools = c?.approvalTools ?? [];
    const cat = new Map(this.catalog().map((t) => [t.id, t]));
    let prompt = c?.prompt || base.prompt;
    if (base.kind === 'custom' && toolIds.some((id) => cat.get(id)?.alwaysConfirmed || approvalTools.includes(id))) prompt += ` ${CONFIRM_RULE}`;
    if (c?.extraInstructions?.trim()) prompt += `\nOrganisation instructions (follow them): ${c.extraInstructions.trim()}`;
    return {
      ...base,
      label: c?.label || base.label,
      description: c?.description || base.description,
      prompt,
      enabled: c?.enabled ?? true,
      audience: c?.audience ?? base.audience,
      model: c?.model ?? null,
      toolIds,
      approvalTools,
      needsGoogle: toolIds.some((id) => cat.get(id)?.needsGoogle),
      customized: !!c,
    };
  }

  /** Agents usable in a run of the given mode. */
  async forRun(orgId: string, mode: 'personal' | 'customer') {
    const all = await this.resolve(orgId);
    return all.filter((a) => a.enabled && (mode === 'customer' ? a.audience !== 'staff' : a.audience !== 'customer'));
  }

  // ------------------------------------------------------------------ admin
  async adminView(orgId: string) {
    const [agents, rows] = await Promise.all([this.resolve(orgId), this.configs.find({ where: { orgId } })]);
    return {
      agents: agents.map((a) => ({ ...a, config: rows.find((r) => r.agentId === a.id) ?? null, defaultTools: a.kind === 'builtin' ? this.defaultToolIds(a.id) : null })),
      catalog: this.catalog(),
    };
  }

  private validateTools(ids: (string[] | null | undefined)[]) {
    const known = new Set(this.catalog().map((t) => t.id));
    const bad = ids.flatMap((l) => l ?? []).filter((id) => !known.has(id));
    if (bad.length) throw new BadRequestException(`Unknown tools: ${bad.join(', ')}`);
  }

  async upsert(orgId: string, agentId: string, input: z.infer<typeof AgentConfigSchema>, kind?: 'builtin' | 'custom') {
    const builtin = AGENTS.some((a) => a.id === agentId);
    const existing = await this.configs.findOne({ where: { orgId, agentId } });
    if (!builtin && !existing && kind !== 'custom') throw new NotFoundException(`No agent "${agentId}"`);
    if (kind === 'custom' && (builtin || existing)) throw new BadRequestException(`An agent with id "${agentId}" already exists.`);
    this.validateTools([input.tools, input.approvalTools]);
    const row = existing ?? this.configs.create({ orgId, agentId, kind: builtin ? 'builtin' : 'custom' });
    Object.assign(row, input);
    if (row.kind === 'custom' && (!row.prompt || !row.tools?.length)) throw new BadRequestException('A custom agent needs a prompt and at least one tool.');
    await this.configs.save(row);
    this.cache.delete(orgId);
    return row;
  }

  /** Custom agent: delete. Built-in agent: back to the code defaults. */
  async reset(orgId: string, agentId: string) {
    await this.configs.delete({ orgId, agentId });
    this.cache.delete(orgId);
    return { reset: true };
  }

  // ------------------------------------------------------------------ packs
  packs(): Pack[] {
    if (!existsSync(PACKS_DIR)) return [];
    return readdirSync(PACKS_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(PACKS_DIR, f), 'utf8')) as Pack);
  }

  /** Applies a pack: org desk settings + agent configurations (existing rows for the same agents are replaced). */
  async applyPack(orgId: string, packId: string) {
    const pack = this.packs().find((p) => p.id === packId);
    if (!pack) throw new NotFoundException(`No pack "${packId}"`);
    for (const a of pack.agents) {
      const { agentId, kind, ...rest } = a;
      const input = (kind === 'custom' ? CustomAgentSchema.omit({ agentId: true }) : AgentConfigSchema).parse(rest);
      await this.configs.delete({ orgId, agentId });
      this.cache.delete(orgId);
      await this.upsert(orgId, agentId, input, kind === 'custom' ? 'custom' : undefined);
    }
    if (pack.org) await this.orgs.update(orgId, { settings: { ...(pack.org.assistantName ? { assistantName: pack.org.assistantName } : {}), desk: pack.org.desk } });
    return { applied: pack.id, agents: pack.agents.map((a) => a.agentId) };
  }
}
