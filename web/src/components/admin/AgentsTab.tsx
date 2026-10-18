'use client';

import { ChevronDown, ChevronUp, Loader2, Plus, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { AgentView, Audience, CatalogTool } from '@/lib/types';
import { btnDark, btnGhost, btnPrimary, Card, Field, inputCls, Notice, Pill, Toggle } from '../ui';

const AUDIENCE: Record<Audience, string> = { staff: 'Members only', customer: 'Customers only (desk)', both: 'Members and customers' };

interface Draft {
  enabled: boolean;
  label: string;
  description: string;
  replacePrompt: boolean;
  prompt: string;
  extraInstructions: string;
  model: string;
  tools: string[];
  approvalTools: string[];
  audience: Audience;
}

const draftOf = (a: AgentView): Draft => ({
  enabled: a.enabled,
  label: a.config?.label ?? (a.kind === 'custom' ? a.label : ''),
  description: a.config?.description ?? (a.kind === 'custom' ? a.description : ''),
  replacePrompt: a.kind === 'custom' || !!a.config?.prompt,
  prompt: a.config?.prompt ?? '',
  extraInstructions: a.config?.extraInstructions ?? '',
  model: a.model ?? '',
  tools: a.toolIds,
  approvalTools: a.approvalTools,
  audience: a.audience,
});

const same = (x: string[], y: string[] | null) => !!y && x.length === y.length && x.every((v) => y.includes(v));

function ToolPicker({ catalog, draft, setDraft }: { catalog: CatalogTool[]; draft: Draft; setDraft: (d: Draft) => void }) {
  const groups = useMemo(() => [...new Set(catalog.map((t) => t.group))], [catalog]);
  const toggle = (list: 'tools' | 'approvalTools', id: string, on: boolean) => {
    const next = on ? [...new Set([...draft[list], id])] : draft[list].filter((x) => x !== id);
    setDraft({ ...draft, [list]: next, ...(list === 'tools' && !on ? { approvalTools: draft.approvalTools.filter((x) => x !== id) } : {}) });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((g) => (
        <fieldset key={g} className="rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{g}</legend>
          {catalog.filter((t) => t.group === g).map((t) => {
            const on = draft.tools.includes(t.id);
            return (
              <div key={t.id} className="flex items-start gap-2 py-1 text-sm">
                <input id={`tool-${t.id}`} type="checkbox" className="mt-1" checked={on} onChange={(e) => toggle('tools', t.id, e.target.checked)} />
                <label htmlFor={`tool-${t.id}`} className="min-w-0 flex-1" title={t.description}>
                  <span className="font-mono text-[13px]">{t.name}</span>
                  {t.alwaysConfirmed && <span className="ml-1 text-[11px] text-accent-strong">always asks</span>}
                  {!t.customerSafe && draft.audience !== 'staff' && <span className="ml-1 text-[11px] text-muted">· members only</span>}
                  <span className="block truncate text-xs text-muted">{t.description}</span>
                </label>
                {on && !t.alwaysConfirmed && (
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted" title="Ask the user before this tool runs">
                    <input type="checkbox" checked={draft.approvalTools.includes(t.id)} onChange={(e) => toggle('approvalTools', t.id, e.target.checked)} /> approval
                  </label>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function AgentEditor({ agent, catalog, onSaved }: { agent: AgentView; catalog: CatalogTool[]; onSaved: (msg: string) => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(agent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const custom = agent.kind === 'custom';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/agents/${agent.id}`, {
        method: 'PUT',
        json: {
          enabled: d.enabled,
          label: d.label.trim() || null,
          description: d.description.trim() || null,
          prompt: d.replacePrompt && d.prompt.trim() ? d.prompt.trim() : null,
          extraInstructions: d.extraInstructions,
          model: d.model.trim() || null,
          tools: !custom && same(d.tools, agent.defaultTools) ? null : d.tools,
          approvalTools: d.approvalTools,
          audience: d.audience,
        },
      });
      onSaved(`${d.label || agent.label} saved.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm(custom ? `Delete the custom agent “${agent.label}”?` : `Reset “${agent.label}” to its built-in defaults?`)) return;
    try {
      await api(`/admin/agents/${agent.id}`, { method: 'DELETE' });
      onSaved(custom ? `${agent.label} deleted.` : `${agent.label} reset to defaults.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><input className={inputCls} value={d.label} placeholder={agent.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></Field>
        <Field label="Who can use it">
          <select className={inputCls} value={d.audience} onChange={(e) => setD({ ...d, audience: e.target.value as Audience })}>
            {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Model" hint="Blank = organisation default"><input className={inputCls} value={d.model} placeholder="gpt-4.1-mini" onChange={(e) => setD({ ...d, model: e.target.value })} /></Field>
      </div>
      <Field label="Description (how the master agent decides to use it)">
        <input className={inputCls} value={d.description} placeholder={agent.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </Field>
      <Field label="Extra instructions" hint="Added to the agent's prompt — the safe way to tune a built-in agent (tone, language, house rules).">
        <textarea rows={3} className={inputCls} value={d.extraInstructions} onChange={(e) => setD({ ...d, extraInstructions: e.target.value })} placeholder="e.g. Always reply in Hindi. Mention our helpline 1800-123-456 when relevant." />
      </Field>
      {!custom && <Toggle id={`replace-${agent.id}`} label="Replace the built-in prompt" hint="Advanced — the default prompt is shown below" checked={d.replacePrompt} onChange={(v) => setD({ ...d, replacePrompt: v, prompt: v && !d.prompt ? agent.prompt : d.prompt })} />}
      {d.replacePrompt ? (
        <textarea rows={6} className={`${inputCls} font-mono text-[13px]`} value={d.prompt} onChange={(e) => setD({ ...d, prompt: e.target.value })} />
      ) : (
        <details className="text-sm"><summary className="cursor-pointer text-muted">Current prompt</summary><p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-2 p-3 font-mono text-[12px]">{agent.prompt}</p></details>
      )}
      <div>
        <div className="mb-2 text-sm font-medium">Tools <span className="font-normal text-muted">— tick “approval” to ask the user before a tool runs</span></div>
        <ToolPicker catalog={catalog} draft={d} setDraft={setD} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
        {(custom || agent.customized) && (
          <button onClick={reset} className={btnGhost}>{custom ? <><Trash2 className="h-4 w-4" /> Delete agent</> : <><RotateCcw className="h-4 w-4" /> Reset to defaults</>}</button>
        )}
      </div>
    </div>
  );
}

function NewAgent({ catalog, onCreated }: { catalog: CatalogTool[]; onCreated: (msg: string) => void }) {
  const [d, setD] = useState<Draft & { agentId: string }>({
    agentId: '', enabled: true, label: '', description: '', replacePrompt: true, prompt: '', extraInstructions: '', model: '', tools: [], approvalTools: [], audience: 'staff',
  });
  const [error, setError] = useState<string | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/agents', {
        method: 'POST',
        json: { agentId: d.agentId, label: d.label, description: d.description, prompt: d.prompt, extraInstructions: d.extraInstructions, model: d.model || null, tools: d.tools, approvalTools: d.approvalTools, audience: d.audience, enabled: true },
      });
      onCreated(`Agent “${d.label}” created.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form onSubmit={create} className="space-y-3">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Id" hint="lowercase, e.g. order_help"><input required pattern="[a-z][a-z0-9_]{1,30}" className={inputCls} value={d.agentId} onChange={(e) => setD({ ...d, agentId: e.target.value })} /></Field>
        <Field label="Name"><input required className={inputCls} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></Field>
        <Field label="Who can use it">
          <select className={inputCls} value={d.audience} onChange={(e) => setD({ ...d, audience: e.target.value as Audience })}>
            {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description (when should the master use it?)"><input required minLength={5} className={inputCls} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
      <Field label="Prompt"><textarea required minLength={10} rows={5} className={inputCls} value={d.prompt} onChange={(e) => setD({ ...d, prompt: e.target.value })} placeholder="You are the … agent. Use … to … Always …" /></Field>
      <ToolPicker catalog={catalog} draft={d} setDraft={(x) => setD({ ...d, ...x })} />
      <button disabled={!d.tools.length} className={btnDark}><Plus className="h-4 w-4" /> Create agent</button>
    </form>
  );
}

/** Config-driven agents: switch built-ins on/off, tune them, set approval rules, add custom agents. */
export function AgentsTab() {
  const [data, setData] = useState<{ agents: AgentView[]; catalog: CatalogTool[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const load = useCallback(() => api<{ agents: AgentView[]; catalog: CatalogTool[] }>('/admin/agents').then(setData).catch((e) => setMsg({ tone: 'danger', text: (e as Error).message })), []);
  useEffect(() => {
    void load();
  }, [load]);
  const done = (text: string) => {
    setMsg({ tone: 'ok', text });
    setOpen(null);
    setCreating(false);
    void load();
  };
  const toggle = async (a: AgentView, enabled: boolean) => {
    try {
      await api(`/admin/agents/${a.id}`, { method: 'PUT', json: { ...(a.config ?? {}), enabled } });
      await load();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Agents</h1>
        <button onClick={() => setCreating((v) => !v)} className={`${btnDark} ml-auto`}><Plus className="h-4 w-4" /> Custom agent</button>
      </div>
      <p className="text-sm text-muted">The master agent delegates to these specialists. Changes apply to everyone in the organisation within about 30 seconds.</p>
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {creating && data && <Card title="New custom agent" desc="Combine tools from the catalogue with your own prompt. Customer-facing agents only get tools that never touch members' personal data."><NewAgent catalog={data.catalog} onCreated={done} /></Card>}
      {!data ? <p className="text-sm text-muted">Loading…</p> : data.agents.map((a) => (
        <Card key={a.id}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{a.label}</span>
                {a.kind === 'custom' && <Pill tone="teal">custom</Pill>}
                {a.customized && a.kind === 'builtin' && <Pill tone="warn">customised</Pill>}
                <Pill>{AUDIENCE[a.audience]}</Pill>
                {a.needsGoogle && <Pill>needs Google</Pill>}
                {!!a.approvalTools.length && <Pill tone="warn"><ShieldAlert className="h-3 w-3" /> {a.approvalTools.length} need approval</Pill>}
              </div>
              <p className="mt-0.5 text-sm text-muted">{a.description}</p>
              <p className="mt-0.5 text-xs text-muted">{a.toolIds.length} tools{a.model ? ` · ${a.model}` : ''}</p>
            </div>
            <Toggle id={`agent-${a.id}`} label={<span className="sr-only">Enabled</span>} checked={a.enabled} onChange={(v) => toggle(a, v)} />
            <button onClick={() => setOpen(open === a.id ? null : a.id)} className={btnGhost} aria-expanded={open === a.id}>
              Configure {open === a.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          {open === a.id && <AgentEditor key={a.id + JSON.stringify(a.config)} agent={a} catalog={data.catalog} onSaved={done} />}
        </Card>
      ))}
    </>
  );
}
