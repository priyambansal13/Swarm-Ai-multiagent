'use client';

import { Bell, CalendarDays, Check, ExternalLink, Loader2, Plus, ShoppingBag, Sparkles, Trash2, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime, fmtTime, inr } from '@/lib/api';
import type { Dashboard, Notification } from '@/lib/types';
import { useAuth } from './AuthProvider';

const Panel = ({ title, icon: Icon, children, action }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="rounded-2xl border border-line bg-surface p-4">
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-accent-strong" />
      <h2 className="font-display text-base font-semibold">{title}</h2>
      <div className="ml-auto">{action}</div>
    </div>
    {children}
  </section>
);

const KIND_LABEL: Record<string, string> = { brief: 'Morning brief', reminder: 'Reminder', triage: 'Inbox', meeting_prep: 'Meeting prep', followups: 'Follow-ups', price_drop: 'Price drop', weekly_review: 'Weekly review', handoff: 'Customer handoff' };

export function DashboardView() {
  const { me } = useAuth();
  const tz = me?.user.timezone;
  const [d, setD] = useState<Dashboard | null>(null);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [exp, setExp] = useState({ amount: '', category: 'food', note: '' });
  const [briefState, setBriefState] = useState<'idle' | 'running' | 'done'>('idle');

  const load = useCallback(async () => {
    try {
      const [dash, n] = await Promise.all([api<Dashboard>('/dashboard'), api<Notification[]>('/notifications')]);
      setD(dash);
      setNotes(n);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;
    void act(() => api('/records/tasks', { method: 'POST', json: { title: task.trim() } }).then(() => setTask('')));
  };
  const addExpense = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(exp.amount);
    if (!amount) return;
    void act(() => api('/records/expenses', { method: 'POST', json: { amount, category: exp.category, note: exp.note || undefined } }).then(() => setExp({ ...exp, amount: '', note: '' })));
  };
  const runBrief = async () => {
    setBriefState('running');
    try {
      await api('/automations/run/brief', { method: 'POST' });
      setBriefState('done');
      await load();
    } catch (e) {
      setError((e as Error).message);
      setBriefState('idle');
    }
  };

  const input = 'min-w-0 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent';
  const maxCat = Math.max(1, ...(d?.spend.byCategory.map((c) => c.amount) ?? [1]));

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Today</h1>
            <p className="text-sm text-muted">{d ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : '…'}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {d?.sheetUrl && (
              <a href={d.sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2">
                Open my Google Sheet <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button onClick={runBrief} disabled={briefState === 'running'} className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-[#1b1d1f] disabled:opacity-60">
              {briefState === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {briefState === 'done' ? 'Brief sent' : 'Send my brief now'}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Panel title="Agenda" icon={CalendarDays}>
              {!d ? <p className="text-sm text-muted">Loading…</p> : d.agenda === null ? (
                <p className="text-sm text-muted">Connect Google to see your calendar here. <Link href="/settings" className="font-medium text-teal underline">Settings</Link></p>
              ) : d.agenda.length === 0 ? <p className="text-sm text-muted">Nothing on your calendar today.</p> : (
                <ul className="divide-y divide-line">
                  {d.agenda.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-3 py-2 text-sm">
                      <span className="w-20 shrink-0 font-mono text-xs tabular-nums text-muted">{e.allDay ? 'All day' : fmtTime(e.start, tz)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{e.title}</span>
                        {e.location && <span className="text-muted"> · {e.location}</span>}
                      </span>
                      {e.meetLink && <a className="text-xs text-teal underline" href={e.meetLink} target="_blank" rel="noreferrer">Meet</a>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Tasks" icon={Check}>
              <form onSubmit={addTask} className="mb-3 flex gap-2">
                <input id="new-task" className={`${input} flex-1`} placeholder="Add a task…" value={task} onChange={(e) => setTask(e.target.value)} />
                <button className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-bg" aria-label="Add task"><Plus className="h-4 w-4" /></button>
              </form>
              {d?.tasks.length ? (
                <ul className="divide-y divide-line">
                  {d.tasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2.5 py-2 text-sm">
                      <button onClick={() => act(() => api(`/records/tasks/${t.id}`, { method: 'PATCH' }))} className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line hover:border-ok hover:bg-ok-soft" aria-label={`Complete ${t.title}`} />
                      <span className="min-w-0 flex-1">
                        {t.title}
                        {t.priority === 'high' && <span className="ml-1.5 rounded bg-danger-soft px-1.5 text-[11px] font-semibold text-danger">high</span>}
                      </span>
                      {t.due && <span className="shrink-0 text-xs text-muted">{fmtDateTime(t.due, tz)}</span>}
                      <button onClick={() => act(() => api(`/records/tasks/${t.id}`, { method: 'DELETE' }))} className="text-muted hover:text-danger" aria-label={`Delete ${t.title}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">No open tasks.</p>}
            </Panel>

            <Panel title="Spending this month" icon={Wallet} action={<span className="font-display text-lg font-semibold tabular-nums">{inr(d?.spend.totalINR)}</span>}>
              <form onSubmit={addExpense} className="mb-3 flex flex-wrap gap-2">
                <input id="exp-amount" inputMode="decimal" className={`${input} w-24`} placeholder="₹ amount" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} />
                <select id="exp-category" className={input} value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>
                  {['food', 'groceries', 'transport', 'travel', 'shopping', 'bills', 'health', 'entertainment', 'education', 'other'].map((c) => <option key={c}>{c}</option>)}
                </select>
                <input id="exp-note" className={`${input} flex-1`} placeholder="Note (optional)" value={exp.note} onChange={(e) => setExp({ ...exp, note: e.target.value })} />
                <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-bg">Log</button>
              </form>
              {d?.spend.byCategory.length ? (
                <ul className="space-y-2">
                  {d.spend.byCategory.map((c) => (
                    <li key={c.category} className="text-sm">
                      <div className="flex justify-between"><span className="capitalize">{c.category}</span><span className="tabular-nums">{inr(c.amount)}</span></div>
                      <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-accent" style={{ width: `${(c.amount / maxCat) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">No expenses yet this month.</p>}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Reminders" icon={Bell}>
              {d?.reminders.length ? (
                <ul className="divide-y divide-line">
                  {d.reminders.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1">{r.text}<span className="block text-xs text-muted">{fmtDateTime(r.dueAt, tz)}</span></span>
                      <button onClick={() => act(() => api(`/records/reminders/${r.id}`, { method: 'DELETE' }))} className="text-muted hover:text-danger" aria-label={`Cancel reminder ${r.text}`}><X className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">No upcoming reminders. Try “remind me at 6pm to call Mom” in chat.</p>}
            </Panel>

            <Panel title="Price watches" icon={ShoppingBag}>
              {d?.watches.length ? (
                <ul className="divide-y divide-line">
                  {d.watches.map((w) => (
                    <li key={w.id} className="flex items-start gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1">{w.query}
                        <span className="block text-xs text-muted">Target {inr(w.targetPrice)} · now {inr(w.lastPrice)}</span>
                      </span>
                      <button onClick={() => act(() => api(`/records/watches/${w.id}`, { method: 'DELETE' }))} className="text-muted hover:text-danger" aria-label={`Stop watching ${w.query}`}><X className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">Ask “watch the price of AirPods Pro under ₹18,000”.</p>}
            </Panel>

            <Panel title="Updates from your swarm" icon={Sparkles}>
              {notes.length ? (
                <ul className="space-y-2.5">
                  {notes.slice(0, 12).map((n) => (
                    <li key={n.id} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                      <div className="mb-0.5 flex items-center gap-2 text-[11px] text-muted">
                        <span className="font-semibold text-ink">{KIND_LABEL[n.kind] ?? n.kind}</span>
                        <span>{fmtDateTime(n.createdAt, tz)}</span>
                        <span className="ml-auto">{n.channel}{n.status === 'sent' ? ' ✓' : n.status === 'failed' ? ' ✕' : ''}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{n.text}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">Morning briefs, reminders and alerts will appear here.</p>}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
