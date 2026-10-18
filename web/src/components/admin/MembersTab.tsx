'use client';

import { Copy, Link2, Trash2, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime } from '@/lib/api';
import type { Invite, Member, OrgRole } from '@/lib/types';
import { useAuth } from '../AuthProvider';
import { btnDark, btnGhost, Card, Field, inputCls, Notice } from '../ui';

const ROLES: { role: OrgRole; label: string; desc: string }[] = [
  { role: 'owner', label: 'Owner', desc: 'everything, incl. owners' },
  { role: 'admin', label: 'Admin', desc: 'admin console + inbox' },
  { role: 'agent', label: 'Agent', desc: 'customer inbox' },
  { role: 'member', label: 'Member', desc: 'own assistant only' },
];

export function MembersTab() {
  const { me } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [form, setForm] = useState<{ role: OrgRole; email: string }>({ role: 'agent', email: '' });
  const [created, setCreated] = useState<Invite | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([api<Member[]>('/admin/members'), api<Invite[]>('/admin/invites')]);
      setMembers(m);
      setInvites(i);
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'ok', text: ok });
      await load();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    }
  };

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => setCreated(await api<Invite>('/admin/invites', { method: 'POST', json: { role: form.role, email: form.email || null } })));
  };
  const link = (code: string) => `${window.location.origin}/signup?invite=${code}`;
  const copy = (code: string) => navigator.clipboard?.writeText(link(code)).then(() => setMsg({ tone: 'ok', text: 'Invitation link copied.' }));
  const isOwner = me?.user.role === 'owner';

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Members</h1>
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <Card title="Team" desc="Each member has their own private assistant (email, calendar, notes stay theirs). Roles decide who manages the organisation and who answers customers.">
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{m.name}{m.id === me?.user.id && <span className="font-normal text-muted"> (you)</span>}</div>
                <div className="text-xs text-muted">{m.email} · joined {fmtDateTime(m.createdAt)}</div>
              </div>
              <select
                aria-label={`Role of ${m.name}`} value={m.role} disabled={m.id === me?.user.id || (m.role === 'owner' && !isOwner)}
                onChange={(e) => run(() => api(`/admin/members/${m.id}`, { method: 'PATCH', json: { role: e.target.value } }), `${m.name} is now ${e.target.value}.`)}
                className="rounded-lg border border-line bg-bg px-2 py-1 text-sm disabled:opacity-60"
              >
                {ROLES.filter((r) => isOwner || r.role !== 'owner' || m.role === 'owner').map((r) => <option key={r.role} value={r.role}>{r.label} — {r.desc}</option>)}
              </select>
              {m.id !== me?.user.id && (
                <button onClick={() => confirm(`Remove ${m.name} from the organisation? They keep their personal data.`) && run(() => api(`/admin/members/${m.id}`, { method: 'DELETE' }), `${m.name} removed.`)} className={btnGhost} aria-label={`Remove ${m.name}`}>
                  <UserMinus className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Invite someone" desc="Single-use link, valid for 7 days. They sign up with it and join this organisation with the chosen role.">
        <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
          <Field label="Role">
            <select id="invite-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as OrgRole })} className={inputCls}>
              {ROLES.filter((r) => r.role !== 'owner').map((r) => <option key={r.role} value={r.role}>{r.label} — {r.desc}</option>)}
            </select>
          </Field>
          <div className="min-w-56 flex-1"><Field label="Email (optional — locks the link to it)"><input id="invite-email" type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field></div>
          <button className={btnDark}><Link2 className="h-4 w-4" /> Create link</button>
        </form>
        {created && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft p-3 text-sm">
            <code className="min-w-0 flex-1 break-all">{link(created.code)}</code>
            <button onClick={() => copy(created.code)} className={btnGhost}><Copy className="h-4 w-4" /> Copy</button>
          </div>
        )}
        {!!invites.length && (
          <ul className="mt-4 divide-y divide-line text-sm">
            {invites.map((i) => (
              <li key={i.code} className="flex flex-wrap items-center gap-2 py-2">
                <code className="text-xs">{i.code}</code>
                <span className="capitalize">{i.role}</span>
                {i.email && <span className="text-muted">{i.email}</span>}
                <span className="text-xs text-muted">expires {fmtDateTime(i.expiresAt)}</span>
                <span className="ml-auto flex gap-1">
                  <button onClick={() => copy(i.code)} className={btnGhost} aria-label="Copy link"><Copy className="h-4 w-4" /></button>
                  <button onClick={() => run(() => api(`/admin/invites/${i.code}`, { method: 'DELETE' }), 'Invitation revoked.')} className={btnGhost} aria-label="Revoke"><Trash2 className="h-4 w-4" /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
