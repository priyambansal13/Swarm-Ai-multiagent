'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime, inr } from '@/lib/api';
import { useAuth } from './AuthProvider';

const TABS = [
  { id: 'facts', label: 'About me' },
  { id: 'notes', label: 'Notes' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'travel', label: 'Travel log' },
  { id: 'digest', label: 'Email digest' },
  { id: 'activity', label: 'Activity log' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type Row = Record<string, any>;

export function MemoryView() {
  const { me } = useAuth();
  const tz = me?.user.timezone;
  const [tab, setTab] = useState<TabId>('facts');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (t: TabId) => {
    setRows(null);
    setError(null);
    try {
      setRows(await api<Row[]>(`/records/${t}`));
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const forget = async (id: string) => {
    await api(`/records/facts/${id}`, { method: 'DELETE' }).catch((e) => setError((e as Error).message));
    void load('facts');
  };

  const empty: Record<TabId, string> = {
    facts: 'Nothing yet. Tell the assistant things like “remember I’m vegetarian”.',
    notes: 'No notes. Try “save a note: gift ideas for Mom — silk saree, Kindle”.',
    contacts: 'No contacts. Try “save Asha’s email asha@example.com”.',
    travel: 'No trips logged yet.',
    digest: 'Email triage summaries appear here once Google is connected.',
    activity: 'Every action the assistant takes is logged here.',
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Memory</h1>
        <p className="mb-4 text-sm text-muted">What your swarm knows and has done. Everything here is also searchable from chat.</p>
        <div className="scroll-thin mb-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.id ? 'bg-ink text-bg' : 'text-muted hover:bg-surface-2'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {!rows ? <p className="text-sm text-muted">Loading…</p> : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{empty[tab]}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
                {tab === 'facts' && (
                  <div className="flex items-center gap-3">
                    <span className="flex-1">{r.fact}</span>
                    <button onClick={() => forget(r.id)} className="text-muted hover:text-danger" aria-label={`Forget: ${r.fact}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
                {tab === 'notes' && (
                  <>
                    <div className="font-semibold">{r.title}</div>
                    <p className="mt-0.5 whitespace-pre-wrap text-muted">{r.content}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1 text-[11px] text-muted">
                      {(r.tags ?? []).map((t: string) => <span key={t} className="rounded bg-surface-2 px-1.5">#{t}</span>)}
                      <span>{fmtDateTime(r.createdAt, tz)}</span>
                    </div>
                  </>
                )}
                {tab === 'contacts' && (
                  <div className="flex flex-wrap gap-x-4">
                    <span className="font-semibold">{r.name}</span>
                    {r.email && <span className="text-muted">{r.email}</span>}
                    {r.phone && <span className="text-muted">{r.phone}</span>}
                    {r.notes && <span className="w-full text-muted">{r.notes}</span>}
                  </div>
                )}
                {tab === 'travel' && (
                  <>
                    <div className="flex justify-between gap-2"><span className="font-semibold">{r.trip}</span><span className="tabular-nums">{inr(r.estCost)}</span></div>
                    <div className="text-xs text-muted">{r.dates}</div>
                    {r.details && <p className="mt-1">{r.details}</p>}
                  </>
                )}
                {tab === 'digest' && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 text-[11px] font-semibold ${r.urgency === 'high' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted'}`}>{r.urgency}</span>
                      <span className="rounded bg-surface-2 px-1.5 text-[11px] text-muted">{r.category}</span>
                      <span className="truncate font-semibold">{r.subject}</span>
                    </div>
                    <p className="mt-0.5 text-muted">{r.sender}</p>
                    <p className="mt-1">{r.summary}</p>
                  </>
                )}
                {tab === 'activity' && (
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-mono text-xs text-muted">{fmtDateTime(r.createdAt, tz)}</span>
                    <span className="rounded bg-surface-2 px-1.5 text-[11px]">{r.channel}</span>
                    <span className="font-semibold">{r.agent} · {r.action}</span>
                    <span className="w-full text-muted">{r.detail}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
