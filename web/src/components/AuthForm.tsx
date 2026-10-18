'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { Logo } from './Logo';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const { signIn } = useAuth();
  const invite = useSearchParams().get('invite');
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', email: '', password: '', orgName: '' });
  const [joining, setJoining] = useState<{ orgName: string; role: string; email: string | null } | null>(null);
  const [inviteOnly, setInviteOnly] = useState(false);

  useEffect(() => {
    if (mode !== 'signup' || invite) return;
    api<{ open: boolean }>('/auth/signup-policy').then((p) => setInviteOnly(!p.open)).catch(() => undefined);
  }, [mode, invite]);

  useEffect(() => {
    if (mode !== 'signup' || !invite) return;
    api<{ orgName: string; role: string; email: string | null }>(`/auth/invite/${encodeURIComponent(invite)}`)
      .then((j) => {
        setJoining(j);
        if (j.email) setF((x) => ({ ...x, email: j.email! }));
      })
      .catch((e) => setError((e as Error).message));
  }, [mode, invite]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      const res = await api<{ token: string }>(`/auth/${mode}`, {
        method: 'POST',
        json: mode === 'signup'
          ? { name: f.name, email: f.email, password: f.password, timezone, ...(invite ? { invite } : f.orgName.trim() ? { orgName: f.orgName.trim() } : {}) }
          : { email: f.email, password: f.password },
      });
      await signIn(res.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-accent';
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size={48} />
          <h1 className="font-display text-3xl font-semibold tracking-tight">{mode === 'login' ? 'Welcome back' : joining ? `Join ${joining.orgName}` : 'Meet your swarm'}</h1>
          {joining && <p className="rounded-full bg-accent-soft px-3 py-1 text-sm font-medium">You&apos;re invited as <b>{joining.role}</b></p>}
          <p className="text-sm text-muted">Ten specialist agents for email, calendar, research, travel, money, notes and reminders — on web, Telegram and WhatsApp.</p>
        </div>
        {inviteOnly ? (
          <div role="status" className="space-y-2 rounded-2xl border border-line bg-surface p-5 text-sm shadow-sm">
            <p className="font-semibold">Sign-up is by invitation only</p>
            <p className="text-muted">Ask an admin of your organisation for an invite link, then open it to create your account.</p>
          </div>
        ) : (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          {mode === 'signup' && (
            <label className="block text-sm font-medium">Name
              <input id="name" required autoComplete="name" className={`${input} mt-1`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </label>
          )}
          {mode === 'signup' && !invite && (
            <label className="block text-sm font-medium">Organisation <span className="font-normal text-muted">(optional)</span>
              <input id="org-name" autoComplete="organization" placeholder="e.g. Acme Dental — or leave blank for a personal workspace" className={`${input} mt-1`} value={f.orgName} onChange={(e) => setF({ ...f, orgName: e.target.value })} />
            </label>
          )}
          <label className="block text-sm font-medium">Email
            <input id="email" type="email" required readOnly={!!joining?.email} autoComplete="email" className={`${input} mt-1`} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          <label className="block text-sm font-medium">Password
            <input id="password" type="password" required minLength={mode === 'signup' ? 8 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className={`${input} mt-1`} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </label>
          {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-accent py-2.5 font-semibold text-[#1b1d1f] transition hover:brightness-105 disabled:opacity-60">
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        )}
        <p className="mt-4 text-center text-sm text-muted">
          {mode === 'login' ? <>New here? <Link className="font-medium text-teal underline" href="/signup">Create an account</Link></> : <>Have an account? <Link className="font-medium text-teal underline" href="/login">Sign in</Link></>}
        </p>
      </div>
    </div>
  );
}
