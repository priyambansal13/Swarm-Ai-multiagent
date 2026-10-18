'use client';

import { Check, KeyRound, Loader2, Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { OrgAdmin, Pack } from '@/lib/types';
import { useAuth } from '../AuthProvider';
import { btnDark, btnGhost, btnPrimary, Card, Field, inputCls, Notice } from '../ui';

export function OrgTab() {
  const { refresh } = useAuth();
  const [org, setOrg] = useState<OrgAdmin | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [form, setForm] = useState({ name: '', assistantName: '', accentColor: '', timezone: '', model: '', modelFast: '' });
  const [key, setKey] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  const fill = (o: OrgAdmin) => {
    setOrg(o);
    setForm({ name: o.name, assistantName: o.settings.assistantName, accentColor: o.settings.accentColor ?? '', timezone: o.settings.timezone, model: o.settings.model ?? '', modelFast: o.settings.modelFast ?? '' });
  };
  useEffect(() => {
    api<OrgAdmin>('/admin/org').then(fill).catch((e) => setMsg({ tone: 'danger', text: (e as Error).message }));
    api<Pack[]>('/admin/packs').then(setPacks).catch(() => undefined);
  }, []);

  const save = async (extra: Record<string, unknown> = {}) => {
    setState('saving');
    setMsg(null);
    try {
      fill(await api<OrgAdmin>('/admin/org', {
        method: 'PATCH',
        json: {
          name: form.name,
          settings: { assistantName: form.assistantName, accentColor: form.accentColor || null, timezone: form.timezone, model: form.model || null, modelFast: form.modelFast || null },
          ...extra,
        },
      }));
      await refresh();
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
      setState('idle');
    }
  };

  const setApiKey = async (value: string) => {
    await save({ openaiApiKey: value });
    setKey('');
    setMsg({ tone: 'ok', text: value ? 'Organisation OpenAI key saved (encrypted).' : 'Organisation key removed — using the server key.' });
  };

  const apply = async (p: Pack) => {
    if (!confirm(`Apply “${p.name}”? It replaces the configuration of: ${p.agents.join(', ')} and updates customer-desk settings.`)) return;
    setApplying(p.id);
    try {
      await api(`/admin/packs/${p.id}/apply`, { method: 'POST' });
      fill(await api<OrgAdmin>('/admin/org'));
      await refresh();
      setMsg({ tone: 'ok', text: `“${p.name}” applied — review Agents and Customer desk.` });
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setApplying(null);
    }
  };

  if (!org) return msg ? <Notice tone="danger">{msg.text}</Notice> : <p className="text-sm text-muted">Loading…</p>;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Organisation</h1>
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <Card title="Name & branding" desc="Members see the assistant name and accent colour in the app; customers see the assistant name on WhatsApp/Telegram.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Organisation name"><input id="org-name" className={inputCls} value={form.name} onChange={set('name')} /></Field>
          <Field label="Assistant name"><input id="org-assistant" className={inputCls} value={form.assistantName} onChange={set('assistantName')} placeholder="SwarmAI" /></Field>
          <Field label="Accent colour" hint="Blank = default honey colour">
            <div className="flex items-center gap-2">
              <input id="org-color" type="color" className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-bg" value={form.accentColor || '#d48a06'} onChange={set('accentColor')} />
              <input className={inputCls} value={form.accentColor} onChange={set('accentColor')} placeholder="#d48a06" />
            </div>
          </Field>
          <Field label="Timezone" hint="Used by the customer desk"><input id="org-tz" className={inputCls} value={form.timezone} onChange={set('timezone')} placeholder="Asia/Kolkata" /></Field>
        </div>
      </Card>
      <Card title="AI models & key" desc="Leave blank to use the server defaults. With an organisation key, this organisation's usage is billed to its own OpenAI account.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Main model (master agent)"><input id="org-model" className={inputCls} value={form.model} onChange={set('model')} placeholder="gpt-4.1" /></Field>
          <Field label="Fast model (specialists)"><input id="org-model-fast" className={inputCls} value={form.modelFast} onChange={set('modelFast')} placeholder="gpt-4.1-mini" /></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-60 flex-1">
            <Field label={`OpenAI API key — ${org.hasOpenaiKey ? 'organisation key set' : 'using the server key'}`}>
              <input id="org-key" type="password" autoComplete="off" className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" />
            </Field>
          </div>
          <button onClick={() => setApiKey(key.trim())} disabled={!key.trim()} className={btnDark}><KeyRound className="h-4 w-4" /> Save key</button>
          {org.hasOpenaiKey && <button onClick={() => setApiKey('')} className={btnGhost}>Remove key</button>}
        </div>
      </Card>
      <div className="flex justify-end">
        <button onClick={() => save()} disabled={state === 'saving'} className={btnPrimary}>
          {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'saved' ? <Check className="h-4 w-4" /> : null}
          {state === 'saved' ? 'Saved' : 'Save'}
        </button>
      </div>
      <Card title="Industry packs" desc="Ready-made configurations: agents, prompts and customer-desk settings. Applying a pack only changes the agents it lists.">
        <div className="grid gap-3 sm:grid-cols-2">
          {packs.map((p) => (
            <div key={p.id} className="flex flex-col rounded-xl border border-line p-4">
              <div className="flex items-center gap-2 font-semibold"><Package className="h-4 w-4 text-accent-strong" /> {p.name}</div>
              <p className="mt-1 flex-1 text-sm text-muted">{p.description}</p>
              <div className="mt-2 text-xs text-muted">Agents: {p.agents.join(', ')}</div>
              <button onClick={() => apply(p)} disabled={!!applying} className={`${btnDark} mt-3 self-start`}>{applying === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Apply</button>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
