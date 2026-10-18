'use client';

import { Bot, Check, Loader2, RotateCcw, Send, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { DeskConversationDetail, DeskSettings, OrgAdmin } from '@/lib/types';
import { useAuth } from '../AuthProvider';
import { btnGhost, btnPrimary, Card, Field, inputCls, Notice, Pill, Toggle } from '../ui';

/** Talk to the desk bot as a customer would; staff replies from the Inbox show up here too. */
function Simulator() {
  const [conv, setConv] = useState<DeskConversationDetail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api<DeskConversationDetail | null>('/desk/simulate').then(setConv).catch(() => undefined), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  const n = conv?.messages.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [n]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    setText('');
    setConv((c) => (c ? { ...c, messages: [...c.messages, { id: 'tmp', role: 'customer', authorName: null, text: t, createdAt: new Date().toISOString() }] } : c));
    try {
      setConv((await api<{ conversation: DeskConversationDetail }>('/desk/simulate', { method: 'POST', json: { text: t } })).conversation);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    await api('/desk/simulate', { method: 'DELETE' });
    setConv(null);
  };

  return (
    <Card
      title="Test as a customer"
      desc="Works even while the desk is off. Ask about your business, ask for a person, then answer from the Inbox and hand back to the bot."
      action={<button onClick={reset} className={btnGhost}><RotateCcw className="h-4 w-4" /> Start over</button>}
    >
      <div className="flex h-[26rem] flex-col rounded-xl border border-line bg-bg">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-muted">
          {conv ? <Pill tone={conv.status === 'bot' ? 'teal' : conv.status === 'waiting' ? 'danger' : 'warn'}>{conv.status === 'bot' ? 'With bot' : conv.status === 'waiting' ? 'Waiting for a person' : conv.status === 'human' ? 'With team' : 'Closed'}</Pill> : 'New conversation'}
          {conv && conv.status !== 'bot' && <Link href={`/inbox?c=${conv.id}`} className="ml-auto font-medium text-teal underline">Open in Inbox →</Link>}
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {conv?.messages.map((m) =>
            m.role === 'system' ? (
              <p key={m.id} className="text-center text-[11px] text-muted">— {m.text} —</p>
            ) : (
              <div key={m.id} className={`flex ${m.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === 'customer' ? 'rounded-br-md bg-ink text-bg' : m.role === 'staff' ? 'rounded-tl-md bg-accent-soft' : 'rounded-tl-md border border-line bg-surface'}`}>
                  {m.role !== 'customer' && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-muted">{m.role === 'bot' ? <Bot className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}{m.role === 'bot' ? 'Assistant' : m.authorName ?? 'Team'}</div>}
                  {m.text}
                </div>
              </div>
            ),
          )}
          {busy && <p className="text-xs text-muted"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Assistant is typing…</p>}
          <div ref={bottom} />
        </div>
        {error && <div className="px-3 pb-2"><Notice tone="danger">{error}</Notice></div>}
        <form onSubmit={send} className="flex gap-2 border-t border-line p-2">
          <input id="sim-text" className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. What are your timings? / I want to talk to a person" />
          <button disabled={busy || !text.trim()} className={btnPrimary} aria-label="Send"><Send className="h-4 w-4" /></button>
        </form>
      </div>
    </Card>
  );
}

/** Customer desk settings (who answers unknown WhatsApp/Telegram senders) + simulator. */
export function DeskTab() {
  const { refresh } = useAuth();
  const [desk, setDesk] = useState<DeskSettings | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<OrgAdmin>('/admin/org').then((o) => setDesk(o.settings.desk)).catch((e) => setError((e as Error).message));
  }, []);

  const save = async () => {
    if (!desk) return;
    setState('saving');
    setError(null);
    try {
      const o = await api<OrgAdmin>('/admin/org', { method: 'PATCH', json: { settings: { desk } } });
      setDesk(o.settings.desk);
      await refresh();
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  };

  if (!desk) return error ? <Notice tone="danger">{error}</Notice> : <p className="text-sm text-muted">Loading…</p>;
  const set = <K extends keyof DeskSettings>(k: K, v: DeskSettings[K]) => setDesk({ ...desk, [k]: v });
  const channel = (c: 'whatsapp' | 'telegram', on: boolean) => set('channels', on ? [...new Set([...desk.channels, c])] : desk.channels.filter((x) => x !== c));

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Customer desk</h1>
      <p className="text-sm text-muted">
        People who message your WhatsApp number or Telegram bot <b>without being members</b> chat with your assistant. It answers from the
        knowledge base and hands the chat to your team (Inbox) when it&apos;s unsure, when the customer asks for a person, or for things only staff
        can do. Members who linked their phone in Settings keep reaching their personal assistant.
      </p>
      {error && <Notice tone="danger" onClose={() => setError(null)}>{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Settings">
          <Toggle id="desk-on" label="Customer desk on" hint="Answer unknown senders with this organisation's assistant" checked={desk.enabled} onChange={(v) => set('enabled', v)} />
          <div className="flex gap-6 py-1.5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={desk.channels.includes('whatsapp')} onChange={(e) => channel('whatsapp', e.target.checked)} /> WhatsApp</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={desk.channels.includes('telegram')} onChange={(e) => channel('telegram', e.target.checked)} /> Telegram</label>
          </div>
          <Toggle id="desk-unsure" label="Hand over when the answer isn't in the knowledge base" checked={desk.escalateWhenUnsure} onChange={(v) => set('escalateWhenUnsure', v)} />
          <div className="mt-3 space-y-3">
            <Field label="About your business" hint="Who you are, where, what you sell, tone of voice, what the bot must never do.">
              <textarea id="desk-instructions" rows={5} className={inputCls} value={desk.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="We are Acme Dental, a dental clinic in Baner, Pune. Be warm and brief. Never discuss other patients…" />
            </Field>
            <Field label="Greeting (first message)"><input id="desk-greeting" className={inputCls} value={desk.greeting} onChange={(e) => set('greeting', e.target.value)} placeholder="Hi! I'm Asha from Acme Dental 👋" /></Field>
            <Field label="Message when handing over"><input id="desk-handoff" className={inputCls} value={desk.handoffMessage} onChange={(e) => set('handoffMessage', e.target.value)} /></Field>
            <Field label="WhatsApp phone number ID (optional)" hint="Only when several organisations share this server: the Meta phone_number_id this desk answers on.">
              <input id="desk-phone" className={inputCls} value={desk.whatsappPhoneNumberId ?? ''} onChange={(e) => set('whatsappPhoneNumberId', e.target.value || null)} />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={save} disabled={state === 'saving'} className={btnPrimary}>
              {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'saved' ? <Check className="h-4 w-4" /> : null} {state === 'saved' ? 'Saved' : 'Save'}
            </button>
          </div>
        </Card>
        <Simulator />
      </div>
    </>
  );
}
