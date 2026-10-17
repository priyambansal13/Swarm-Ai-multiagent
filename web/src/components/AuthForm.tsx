'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { Logo } from './Logo';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const { signIn } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      const res = await api<{ token: string }>(`/auth/${mode}`, {
        method: 'POST',
        json: mode === 'signup' ? { ...f, timezone } : { email: f.email, password: f.password },
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
          <h1 className="font-display text-3xl font-semibold tracking-tight">{mode === 'login' ? 'Welcome back' : 'Meet your swarm'}</h1>
          <p className="text-sm text-muted">Ten specialist agents for email, calendar, research, travel, money, notes and reminders — on web, Telegram and WhatsApp.</p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          {mode === 'signup' && (
            <label className="block text-sm font-medium">Name
              <input id="name" required autoComplete="name" className={`${input} mt-1`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </label>
          )}
          <label className="block text-sm font-medium">Email
            <input id="email" type="email" required autoComplete="email" className={`${input} mt-1`} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          <label className="block text-sm font-medium">Password
            <input id="password" type="password" required minLength={mode === 'signup' ? 8 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className={`${input} mt-1`} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </label>
          {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-accent py-2.5 font-semibold text-[#1b1d1f] transition hover:brightness-105 disabled:opacity-60">
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          {mode === 'login' ? <>New here? <Link className="font-medium text-teal underline" href="/signup">Create an account</Link></> : <>Have an account? <Link className="font-medium text-teal underline" href="/login">Sign in</Link></>}
        </p>
      </div>
    </div>
  );
}
