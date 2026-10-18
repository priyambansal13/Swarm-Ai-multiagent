'use client';

import { ArrowLeft, Bot, CheckCheck, Hand, Headset, Loader2, MessageCircle, Monitor, Send, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ConversationStatus, DeskConversation, DeskConversationDetail } from '@/lib/types';
import { useAuth } from './AuthProvider';
import { ago, btnGhost, Empty, Notice, Pill } from './ui';

const FILTERS: { key: ConversationStatus | 'open' | ''; label: string }[] = [
  { key: 'open', label: 'Needs a person' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'human', label: 'With team' },
  { key: 'bot', label: 'With bot' },
  { key: 'closed', label: 'Closed' },
  { key: '', label: 'All' },
];

const STATUS: Record<ConversationStatus, { label: string; tone: 'danger' | 'warn' | 'teal' | 'muted' }> = {
  waiting: { label: 'Waiting for a person', tone: 'danger' },
  human: { label: 'With team', tone: 'warn' },
  bot: { label: 'With bot', tone: 'teal' },
  closed: { label: 'Closed', tone: 'muted' },
};

const ChannelIcon = ({ channel }: { channel: string }) =>
  channel === 'whatsapp' ? <MessageCircle className="h-4 w-4 text-ok" aria-label="WhatsApp" /> : channel === 'telegram' ? <Send className="h-4 w-4 text-teal" aria-label="Telegram" /> : <Monitor className="h-4 w-4 text-muted" aria-label="Test chat" />;

/**
 * Staff inbox for the customer desk: conversations the bot handed over, replies on the customer's own
 * WhatsApp/Telegram thread, and hand-back to the bot.
 */
export function InboxView() {
  const { me } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const [filter, setFilter] = useState<ConversationStatus | 'open' | ''>('open');
  const [list, setList] = useState<DeskConversation[] | null>(null);
  const [selected, setSelected] = useState<string | null>(params.get('c'));
  const [conv, setConv] = useState<DeskConversationDetail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      setList(await api<DeskConversation[]>(`/desk/conversations${filter ? `?status=${filter}` : ''}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);

  const loadConv = useCallback(async (id: string) => {
    try {
      setConv(await api<DeskConversationDetail>(`/desk/conversations/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadList();
    const t = setInterval(loadList, 5000);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    void loadConv(selected);
    const t = setInterval(() => loadConv(selected), 4000);
    return () => clearInterval(t);
  }, [selected, loadConv]);

  // The open conversation (stale data from a previously selected one is never shown).
  const current = conv && conv.id === selected ? conv : null;
  const count = current?.messages.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [count, selected]);

  const open = (id: string | null) => {
    setSelected(id);
    setText('');
    router.replace(id ? `/inbox?c=${id}` : '/inbox');
  };

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'messages' in r) setConv(r as DeskConversationDetail);
      else if (selected) await loadConv(selected);
      await loadList();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || !current) return;
    if (await act('reply', () => api(`/desk/conversations/${current.id}/reply`, { method: 'POST', json: { text: t } }))) setText('');
  };

  if (!me?.org.deskEnabled && list && !list.length) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center">
        <h1 className="font-display text-2xl font-semibold">Customer inbox</h1>
        <p className="mt-2 text-sm text-muted">
          The customer desk is off. When it&apos;s on, people who message your WhatsApp or Telegram (without being members) chat with
          your assistant, and conversations it hands over appear here.
        </p>
        {(me?.user.role === 'owner' || me?.user.role === 'admin') && <Link href="/admin?tab=desk" className="mt-4 inline-block font-medium text-teal underline">Set up the customer desk →</Link>}
      </div>
    );
  }

  const listPane = (
    <div className={`flex min-h-0 flex-col border-line md:w-[22rem] md:border-r ${selected ? 'hidden md:flex' : 'flex'} flex-1 md:flex-none`}>
      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 scroll-thin">
        {FILTERS.map((f) => (
          <button key={f.key || 'all'} onClick={() => setFilter(f.key)} className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold ${filter === f.key ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-2'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!list ? (
          <p className="p-4 text-sm text-muted"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>
        ) : !list.length ? (
          <div className="p-4"><Empty>No conversations here.</Empty></div>
        ) : (
          list.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className={`flex w-full gap-3 border-b border-line px-4 py-3 text-left transition hover:bg-surface-2 ${selected === c.id ? 'bg-surface-2' : ''}`}>
              <ChannelIcon channel={c.channel} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{c.displayName ?? c.externalId}</span>
                  {c.unread > 0 && <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold leading-4 text-white">{c.unread}</span>}
                  <span className="ml-auto shrink-0 text-[11px] text-muted">{ago(c.lastMessageAt)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill>
                  {c.assigneeName && <span className="truncate text-[11px] text-muted">· {c.assigneeName}</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{c.status === 'waiting' && c.reason ? `⚑ ${c.reason}` : c.lastText}</p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );

  const detail = current && (
    <div className={`flex min-h-0 flex-1 flex-col ${selected ? 'flex' : 'hidden md:flex'}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <button onClick={() => open(null)} className={`${btnGhost} md:hidden`} aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
        <ChannelIcon channel={current.channel} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{current.displayName ?? current.externalId}</div>
          <div className="text-xs text-muted">{current.channel === 'web' ? 'Test chat (admin simulator)' : `${current.channel} · ${current.externalId}`}{current.assigneeName ? ` · handled by ${current.assigneeName}` : ''}</div>
        </div>
        <Pill tone={STATUS[current.status].tone}>{STATUS[current.status].label}</Pill>
        <div className="ml-auto flex flex-wrap gap-1">
          {current.status !== 'human' && current.status !== 'closed' && (
            <button onClick={() => act('assign', () => api(`/desk/conversations/${current.id}/assign`, { method: 'POST', json: {} }))} disabled={!!busy} className={btnGhost}><Hand className="h-4 w-4" /> Take over</button>
          )}
          {current.status !== 'bot' && (
            <button onClick={() => act('release', () => api(`/desk/conversations/${current.id}/release`, { method: 'POST', json: {} }))} disabled={!!busy} className={btnGhost}><Bot className="h-4 w-4" /> Hand back to bot</button>
          )}
          {current.status !== 'closed' && (
            <button onClick={() => act('close', () => api(`/desk/conversations/${current.id}/close`, { method: 'POST' }))} disabled={!!busy} className={btnGhost}><CheckCheck className="h-4 w-4" /> Close</button>
          )}
        </div>
      </div>
      {current.summary && current.status !== 'bot' && (
        <div className="border-b border-line bg-accent-soft px-4 py-2.5 text-sm">
          <div className="font-semibold">⚑ {current.reason ?? 'Handed over'}</div>
          <p className="whitespace-pre-wrap text-[13px]">{current.summary}</p>
        </div>
      )}
      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {current.messages.map((m) =>
          m.role === 'system' ? (
            <p key={m.id} className="text-center text-[11px] text-muted">— {m.text} · {ago(m.createdAt)} —</p>
          ) : (
            <div key={m.id} className={`flex ${m.role === 'customer' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[14px] ${m.role === 'customer' ? 'rounded-tl-md border border-line bg-surface' : m.role === 'staff' ? 'rounded-tr-md bg-ink text-bg' : 'rounded-tr-md bg-teal-soft'}`}>
                <div className={`mb-0.5 flex items-center gap-1 text-[11px] font-semibold ${m.role === 'staff' ? 'text-bg/70' : 'text-muted'}`}>
                  {m.role === 'customer' ? <UserRound className="h-3 w-3" /> : m.role === 'bot' ? <Bot className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
                  {m.role === 'customer' ? current.displayName ?? 'Customer' : m.role === 'bot' ? 'Assistant' : m.authorName ?? 'Team'} · {ago(m.createdAt)}
                </div>
                <div className="whitespace-pre-wrap">{m.text}</div>
              </div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      {error && <div className="px-4 pb-2"><Notice tone="danger" onClose={() => setError(null)}>{error}</Notice></div>}
      <form onSubmit={send} className="flex items-end gap-2 border-t border-line bg-surface px-3 py-2.5">
        <textarea
          id="desk-reply" rows={2} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={current.status === 'bot' ? 'Reply as a person (this pauses the bot)…' : `Reply on ${current.channel === 'web' ? 'the test chat' : current.channel}…`}
          className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button disabled={!text.trim() || busy === 'reply'} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-[#1b1d1f] disabled:opacity-50">
          {busy === 'reply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {listPane}
      {detail ?? (
        <div className="hidden flex-1 place-items-center p-8 text-center text-sm text-muted md:grid">
          <div>
            <Headset className="mx-auto mb-2 h-6 w-6 opacity-40" />
            Pick a conversation. Chats the assistant hands over appear under <b>Needs a person</b>; you&apos;re also notified on your
            notify channel (Settings).
          </div>
        </div>
      )}
    </div>
  );
}
