'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime } from '@/lib/api';
import type { ApprovalRow, AuditRow, Usage } from '@/lib/types';
import { useAuth } from '../AuthProvider';
import { btnGhost, Card, Empty, inputCls, Notice, Pill } from '../ui';
import type { TabKey } from './AdminView';

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<T>(path).then(setData).catch((e) => setError((e as Error).message)), [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, load };
}

const Stat = ({ label, value, hint, onClick }: { label: string; value: React.ReactNode; hint?: string; onClick?: () => void }) => (
  <button onClick={onClick} disabled={!onClick} className="rounded-2xl border border-line bg-surface p-4 text-left transition enabled:hover:border-accent">
    <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
    <div className="mt-1 font-display text-3xl font-semibold">{value}</div>
    {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
  </button>
);

export function OverviewTab({ go }: { go: (k: TabKey) => void }) {
  const { me } = useAuth();
  const { data: u, error } = useLoad<Usage>('/admin/usage');
  const max = Math.max(1, ...(u?.actions30d.map((a) => a.n) ?? [1]));
  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Overview</h1>
      {error && <Notice tone="danger">{error}</Notice>}
      {u && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Members" value={u.members} onClick={() => go('members')} />
            <Stat label="Knowledge" value={u.knowledge.sources} hint={`${u.knowledge.chunks.toLocaleString()} passages`} onClick={() => go('knowledge')} />
            <Stat label="Waiting customers" value={u.desk.waiting ?? 0} hint={me?.org.deskEnabled ? `${u.desk.human ?? 0} with team · ${u.desk.bot ?? 0} with bot` : 'Customer desk is off'} onClick={() => go('desk')} />
            <Stat label="Conversations" value={u.conversations30d} hint={`${u.proactiveMessages30d} proactive messages · 30 days`} />
          </div>
          <Card title="Actions by agent (30 days)" desc="Approved actions, desk replies and other logged activity.">
            {!u.actions30d.length ? <Empty>No activity yet.</Empty> : (
              <ul className="space-y-1.5">
                {u.actions30d.map((a) => (
                  <li key={a.agent} className="flex items-center gap-3 text-sm">
                    <span className="w-28 truncate capitalize">{a.agent}</span>
                    <span className="h-2.5 rounded-full bg-teal" style={{ width: `${(a.n / max) * 70}%` }} />
                    <span className="text-muted">{a.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <Card title="Set up checklist">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li><button className="underline" onClick={() => go('org')}>Name and brand</button> your assistant, optionally with your own OpenAI key.</li>
          <li><button className="underline" onClick={() => go('members')}>Invite</button> your team — <b>agents</b> answer customers in the Inbox.</li>
          <li><button className="underline" onClick={() => go('knowledge')}>Add knowledge</button>: policies, price lists, FAQs, website pages.</li>
          <li><button className="underline" onClick={() => go('agents')}>Pick agents</button> or apply an industry pack.</li>
          <li><button className="underline" onClick={() => go('desk')}>Turn on the customer desk</button> and test it as a customer.</li>
        </ol>
      </Card>
    </>
  );
}

export function ApprovalsTab() {
  const { data, error, load } = useLoad<ApprovalRow[]>('/admin/approvals');
  return (
    <>
      <div className="flex items-center gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Approvals</h1>
        <button onClick={load} className={`${btnGhost} ml-auto`}><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>
      <p className="text-sm text-muted">Actions your members&apos; assistants proposed that are still waiting for the member to approve (emails, calendar changes, deletions, and tools you marked “needs approval”).</p>
      {error && <Notice tone="danger">{error}</Notice>}
      {data && !data.length && <Empty>Nothing is waiting for approval.</Empty>}
      <div className="space-y-3">
        {data?.map((a) => (
          <Card key={a.id}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <b>{a.userName}</b><span className="text-muted">{a.userEmail}</span><Pill>{a.channel}</Pill>
              <span className="ml-auto text-xs text-muted">{fmtDateTime(a.updatedAt)}</span>
            </div>
            <div className="mt-1 text-sm text-muted">“{a.title}”</div>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
              {a.pending?.actions.map((x) => <li key={x.id}><span className="font-medium">{x.agent}</span>: {x.summary}</li>)}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}

export function AuditTab() {
  const { data, error, load } = useLoad<AuditRow[]>('/admin/audit?limit=300');
  const [q, setQ] = useState('');
  const rows = (data ?? []).filter((r) => !q || `${r.userName} ${r.agent} ${r.action} ${r.detail} ${r.channel}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="flex items-center gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Audit log</h1>
        <button onClick={load} className={`${btnGhost} ml-auto`}><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>
      <input id="audit-filter" className={inputCls} placeholder="Filter by person, agent, action or text…" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      {data && !rows.length && <Empty>No entries.</Empty>}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr className="border-b border-line"><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Agent · action</th><th className="px-3 py-2">Detail</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{fmtDateTime(r.createdAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.userName}<div className="text-xs text-muted">{r.channel}</div></td>
                <td className="whitespace-nowrap px-3 py-2"><span className="font-medium">{r.agent}</span> · <span className={r.action.endsWith('_failed') || r.action === 'rejected' ? 'text-danger' : ''}>{r.action}</span></td>
                <td className="px-3 py-2 text-muted">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
