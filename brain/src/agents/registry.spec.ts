import { describe, expect, it, vi } from 'vitest';
import { AgentRegistryService } from './registry.service.js';

const repo = (rows: any[]) => ({ find: vi.fn(async () => rows), findOne: vi.fn(async () => null), save: vi.fn(async (r: any) => r), create: vi.fn((r: any) => r), delete: vi.fn() });
const services = { knowledge: { search: vi.fn(async () => []) }, search: { web: vi.fn(async () => []) }, records: {} } as any;
const ctx = (mode: 'personal' | 'customer') => ({
  user: { id: 'u1', timezone: 'Asia/Kolkata', settings: {} }, org: { id: 'o1', settings: {} }, mode, attachments: [], pending: [] as any[], emit: () => {},
}) as any;

describe('agent registry', () => {
  it('catalogue has unique ids and marks confirmed and customer-safe tools', () => {
    const r = new AgentRegistryService(repo([]) as any, {} as any);
    const cat = r.catalog();
    expect(new Set(cat.map((t) => t.id)).size).toBe(cat.length);
    expect(cat.find((t) => t.name === 'gmail_send')?.alwaysConfirmed).toBe(true);
    expect(cat.find((t) => t.name === 'kb_search')?.customerSafe).toBe(true);
    expect(cat.find((t) => t.name === 'add_task')?.customerSafe).toBe(false);
  });

  it('merges org config over built-ins and adds custom agents', async () => {
    const r = new AgentRegistryService(repo([
      { agentId: 'shopping', kind: 'builtin', enabled: false, approvalTools: [] },
      { agentId: 'research', kind: 'builtin', enabled: true, extraInstructions: 'Prefer Indian sources.', approvalTools: [], audience: 'staff' },
      { agentId: 'faq', kind: 'custom', enabled: true, label: 'FAQ', description: 'FAQs', prompt: 'Answer FAQs.', tools: ['kb_search', 'add_task'], approvalTools: [], audience: 'both' },
    ]) as any, {} as any);
    const personal = await r.forRun('o1', 'personal');
    expect(personal.some((a) => a.id === 'shopping')).toBe(false);
    expect(personal.find((a) => a.id === 'research')!.prompt).toContain('Prefer Indian sources.');
    const customer = await r.forRun('o1', 'customer');
    expect(customer.map((a) => a.id).sort()).toEqual(['faq', 'knowledge']);
    // Customer runs never get personal-data tools, even if configured.
    const faq = customer.find((a) => a.id === 'faq')!;
    expect(r.tools(faq, services, ctx('customer')).map((t) => t.name)).toEqual(['kb_search']);
    expect(r.tools(faq, services, ctx('personal')).map((t) => t.name)).toEqual(['kb_search', 'add_task']);
  });

  it('approval tools propose instead of running', async () => {
    const r = new AgentRegistryService(repo([{ agentId: 'records', kind: 'builtin', enabled: true, approvalTools: ['add_task'] }]) as any, {} as any);
    const records = (await r.forRun('o1', 'personal')).find((a) => a.id === 'records')!;
    const c = ctx('personal');
    const add = r.tools(records, { records: { addTask: vi.fn(() => { throw new Error('ran without approval'); }) } } as any, c).find((t) => t.name === 'add_task')!;
    const out = JSON.parse(await add.invoke({ title: 'Call the CA', due: null, priority: null }));
    expect(out.status).toBe('PENDING_USER_CONFIRMATION');
    expect(c.pending[0]).toMatchObject({ kind: 'tool_call', args: { tool: 'add_task' } });
  });
});
