'use client';

import { Check, ExternalLink, Link2, Loader2, MessageCircle, Send, Unlink, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, API_URL, getToken } from '@/lib/api';
import type { Channel, Me, UserSettings } from '@/lib/types';
import { useAuth } from './AuthProvider';

interface LinkCode { code: string; expiresInMinutes: number; instructions: string; deepLink: string | null }

const Section = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-line bg-surface p-5">
    <h2 className="font-display text-lg font-semibold">{title}</h2>
    {desc && <p className="mb-4 mt-0.5 text-sm text-muted">{desc}</p>}
    {!desc && <div className="mb-3" />}
    {children}
  </section>
);

const Toggle = ({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm">
    {label}
    <span className="relative inline-flex">
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="h-6 w-11 rounded-full bg-surface-2 ring-1 ring-line transition peer-checked:bg-teal peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow transition peer-checked:translate-x-5" />
    </span>
  </label>
);

export function SettingsView() {
  const { me, refresh } = useAuth();
  const params = useSearchParams();
  const [name, setName] = useState(me?.user.name ?? '');
  const [timezone, setTimezone] = useState(me?.user.timezone ?? 'Asia/Kolkata');
  const [s, setS] = useState<UserSettings | null>(me?.user.settings ?? null);
  const [topic, setTopic] = useState('');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<Partial<Record<'telegram' | 'whatsapp', LinkCode>>>({});
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const googleParam = params.get('google');

  useEffect(() => {
    if (me) {
      setName(me.user.name);
      setTimezone(me.user.timezone);
      setS(me.user.settings);
    }
  }, [me]);

  useEffect(() => () => {
    if (poll.current) clearInterval(poll.current);
  }, []);

  if (!me || !s) return null;
  const set = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) => setS({ ...s, [k]: v });

  const save = async () => {
    setSaved('saving');
    setError(null);
    try {
      await api('/me', { method: 'PATCH', json: { name, timezone, settings: s } });
      await refresh();
      setSaved('saved');
      setTimeout(() => setSaved('idle'), 2000);
    } catch (e) {
      setError((e as Error).message);
      setSaved('idle');
    }
  };

  const link = async (channel: 'telegram' | 'whatsapp') => {
    setError(null);
    try {
      const c = await api<LinkCode>('/channels/link-code', { method: 'POST', json: { channel } });
      setCodes((x) => ({ ...x, [channel]: c }));
      if (poll.current) clearInterval(poll.current);
      const started = Date.now();
      poll.current = setInterval(async () => {
        const m: Me | null = await refresh();
        if (m?.integrations[channel] || Date.now() - started > c.expiresInMinutes * 60_000) {
          if (poll.current) clearInterval(poll.current);
          if (m?.integrations[channel]) setCodes((x) => ({ ...x, [channel]: undefined }));
        }
      }, 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unlink = async (channel: 'telegram' | 'whatsapp') => {
    await api(`/channels/${channel}`, { method: 'DELETE' }).catch((e) => setError((e as Error).message));
    await refresh();
  };

  const disconnectGoogle = async () => {
    await api('/google/disconnect', { method: 'POST' }).catch((e) => setError((e as Error).message));
    await refresh();
  };

  const input = 'w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent';
  const g = me.integrations.google;
  const channelRow = (channel: 'telegram' | 'whatsapp', label: string, Icon: typeof Send) => {
    const linked = me.integrations[channel];
    const code = codes[channel];
    return (
      <div className="rounded-xl border border-line p-3.5">
        <div className="flex items-center gap-2.5">
          <Icon className="h-5 w-5 text-teal" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{label}</div>
            <div className="text-xs text-muted">{linked ? `Linked${linked.displayName ? ` · ${linked.displayName}` : ''}` : 'Not linked'}</div>
          </div>
          {linked ? (
            <button onClick={() => unlink(channel)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-danger"><Unlink className="h-4 w-4" /> Unlink</button>
          ) : (
            <button onClick={() => link(channel)} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-bg"><Link2 className="h-4 w-4" /> Link</button>
          )}
        </div>
        {code && !linked && (
          <div className="mt-3 rounded-xl bg-accent-soft p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-2xl font-bold tracking-[0.25em]">{code.code}</span>
              <button onClick={() => setCodes((x) => ({ ...x, [channel]: undefined }))} aria-label="Hide code"><X className="h-4 w-4 text-muted" /></button>
            </div>
            <p className="mt-1">{code.instructions}</p>
            {code.deepLink && <a href={code.deepLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-teal underline">Open {label} <ExternalLink className="h-3.5 w-3.5" /></a>}
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Waiting for your message… (expires in {code.expiresInMinutes} min)</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
        {googleParam && (
          <p role="status" className={`rounded-xl px-3 py-2 text-sm ${googleParam === 'connected' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
            {googleParam === 'connected'
              ? 'Google connected — your SwarmAI sheet has been created.'
              : googleParam === 'partial'
                ? `Google connected, but: ${params.get('detail') ?? 'some permissions are missing'}`
                : `Google connection failed: ${googleParam}`}
          </p>
        )}
        {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <Section title="Google" desc="Gmail, Google Calendar and your SwarmAI Google Sheet (Tasks, Expenses, Contacts, TravelLog, EmailDigest, ActivityLog).">
          {!me.integrations.googleAvailable ? (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">Google sign-in isn't configured on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Everything else works without it.</p>
          ) : g ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Check className="h-5 w-5 text-ok" />
              <span className="min-w-0 flex-1">Connected as <b>{g.email}</b></span>
              {g.spreadsheetUrl && <a href={g.spreadsheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-teal underline">My SwarmAI sheet <ExternalLink className="h-3.5 w-3.5" /></a>}
              <button onClick={disconnectGoogle} className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-danger">Disconnect</button>
            </div>
          ) : (
            <button onClick={() => { window.location.href = `${API_URL}/api/google/connect?token=${encodeURIComponent(getToken() ?? '')}`; }}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-bg">Connect Google</button>
          )}
        </Section>

        <Section title="Telegram & WhatsApp" desc="Chat with the same assistant from your phone — text, voice notes and photos. Reminders and briefs arrive there too.">
          <div className="grid gap-3 sm:grid-cols-2">
            {channelRow('telegram', 'Telegram', Send)}
            {channelRow('whatsapp', 'WhatsApp', MessageCircle)}
          </div>
        </Section>

        <Section title="Profile">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">Name<input id="set-name" className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="text-sm font-medium">Timezone<input id="set-tz" className={`${input} mt-1`} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Kolkata" /></label>
            <label className="text-sm font-medium">Home city<input id="set-city" className={`${input} mt-1`} value={s.homeCity ?? ''} onChange={(e) => set('homeCity', e.target.value || null)} placeholder="Used for weather in your brief" /></label>
          </div>
        </Section>

        <Section title="Proactive assistant" desc="What your swarm does on its own.">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <Toggle id="brief" label="Morning brief" checked={s.briefEnabled} onChange={(v) => set('briefEnabled', v)} />
              <label className="flex items-center justify-between py-1.5 text-sm">Brief time
                <input id="brief-time" type="time" className="rounded-lg border border-line bg-bg px-2 py-1 text-sm" value={s.briefTime} onChange={(e) => set('briefTime', e.target.value)} />
              </label>
              <label className="flex items-center justify-between py-1.5 text-sm">Send updates to
                <select id="notify" className="rounded-lg border border-line bg-bg px-2 py-1 text-sm" value={s.notifyChannel} onChange={(e) => set('notifyChannel', e.target.value as Channel)}>
                  <option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option><option value="web">Web only</option>
                </select>
              </label>
            </div>
            <div>
              <Toggle id="triage" label="Inbox triage & urgent alerts" checked={s.triageEnabled} onChange={(v) => set('triageEnabled', v)} />
              <Toggle id="prep" label="Meeting prep notes" checked={s.meetingPrepEnabled} onChange={(v) => set('meetingPrepEnabled', v)} />
              <Toggle id="voice" label="Reply to voice notes with voice" checked={s.voiceReplies} onChange={(v) => set('voiceReplies', v)} />
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-sm font-medium">News topics for your brief</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {s.newsTopics.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium">
                  {t}<button onClick={() => set('newsTopics', s.newsTopics.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <form onSubmit={(e) => { e.preventDefault(); const v = topic.trim(); if (v && !s.newsTopics.includes(v) && s.newsTopics.length < 10) set('newsTopics', [...s.newsTopics, v]); setTopic(''); }}>
                <input id="topic" className="w-40 rounded-full border border-line bg-bg px-3 py-1 text-xs outline-none focus:border-accent" placeholder="+ add topic, Enter" value={topic} onChange={(e) => setTopic(e.target.value)} />
              </form>
            </div>
          </div>
        </Section>

        <div className="sticky bottom-0 flex justify-end bg-gradient-to-t from-bg pt-2 pb-1">
          <button onClick={save} disabled={saved === 'saving'} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-[#1b1d1f] shadow-sm disabled:opacity-60">
            {saved === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : saved === 'saved' ? <Check className="h-4 w-4" /> : null}
            {saved === 'saved' ? 'Saved' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
