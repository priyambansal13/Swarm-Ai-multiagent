'use client';

import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Pending } from '@/lib/types';

const AGENT: Record<string, string> = { email: 'Email', calendar: 'Calendar', records: 'Records', finance: 'Finance' };

/** Human-in-the-loop approval for an AG-UI interrupt (sending email, calendar changes, deletions…). */
export function ApprovalCard({ pending, busy, onDecide }: { pending: Pending; busy: boolean; onDecide: (approved: boolean, actionIds?: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>(pending.actions.map((a) => a.id));
  useEffect(() => setSelected(pending.actions.map((a) => a.id)), [pending]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="rounded-2xl border-2 border-accent bg-accent-soft p-4" role="group" aria-label="Actions waiting for your approval">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-5 w-5 text-accent-strong" /> Needs your OK before anything is sent or changed
      </div>
      <ul className="space-y-1.5">
        {pending.actions.map((a) => (
          <li key={a.id}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-surface px-3 py-2 text-sm">
              <input id={`act-${a.id}`} type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="min-w-0 flex-1 break-words">
                <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-px text-[11px] font-semibold text-muted">{AGENT[a.agent] ?? a.agent}</span>
                {a.summary}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button disabled={busy} onClick={() => onDecide(false)} className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-50">
          Reject
        </button>
        <button disabled={busy || selected.length === 0} onClick={() => onDecide(true, selected.length === pending.actions.length ? undefined : selected)}
          className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50">
          Approve {selected.length === pending.actions.length ? (pending.actions.length > 1 ? 'all' : '') : `${selected.length} of ${pending.actions.length}`}
        </button>
      </div>
    </div>
  );
}
