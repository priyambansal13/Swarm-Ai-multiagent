'use client';

import { HttpAgent, type AgentSubscriber, type RunAgentParameters } from '@ag-ui/client';
import { CircleAlert, MessageSquarePlus, PanelLeft, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/components/AuthProvider';
import { Logo } from '@/components/Logo';
import { api, API_URL, getToken } from '@/lib/api';
import type { AgentRuntime, Pending, SwarmUiState, Thread, ThreadDetail } from '@/lib/types';
import { AgentActivity, type ToolCall } from './AgentActivity';
import { ApprovalCard } from './ApprovalCard';
import { Composer, type OutAttachment } from './Composer';

interface Msg { role: 'user' | 'assistant'; content: string; streaming?: boolean; attachments?: string[] }

const CHIPS = [
  "What's on my calendar today?",
  'Log ₹250 for lunch',
  'Remind me in 1 hour to stretch',
  'Weather in Bengaluru tomorrow',
  'Find flights BLR→DEL next Friday',
  'Summarise my unread emails',
];

const CHANNEL_BADGE: Record<string, string> = { web: 'Web', telegram: 'Telegram', whatsapp: 'WhatsApp' };

const newThreadId = () => `web-${crypto.randomUUID()}`;

export function ChatApp() {
  const { me } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string>(() => params.get('t') ?? '');
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<Record<string, AgentRuntime>>({});
  const [tools, setTools] = useState<ToolCall[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const agentRef = useRef<HttpAgent | null>(null);
  /** Thread ids created in this tab that the server doesn't know yet (skip loading them). */
  const freshIds = useRef(new Set<string>());
  const stopping = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      setReadAloud(window.localStorage.getItem('swarm.readAloud') === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await api<Thread[]>('/threads'));
    } catch {
      /* shown elsewhere */
    }
  }, []);

  const agentFor = useCallback((id: string) => {
    if (agentRef.current?.threadId !== id) {
      agentRef.current = new HttpAgent({ url: `${API_URL}/api/agui`, headers: { Authorization: `Bearer ${getToken()}` }, threadId: id });
    }
    return agentRef.current;
  }, []);

  useEffect(() => {
    if (!threadId) {
      const id = newThreadId();
      freshIds.current.add(id);
      setThreadId(id);
    }
  }, [threadId]);

  // Load the selected conversation (messages + any pending approval).
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setError(null);
    setAgents({});
    setTools([]);
    agentFor(threadId);
    if (freshIds.current.has(threadId)) {
      setThread(null);
      setMessages([]);
      setPending(null);
      return;
    }
    api<ThreadDetail>(`/threads/${threadId}`)
      .then((t) => {
        if (cancelled) return;
        setThread(t);
        setMessages(t.messages);
        setPending(t.pending);
      })
      .catch(() => {
        if (cancelled) return;
        setThread(null);
        setMessages([]);
        setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, agentFor]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, agents, pending, busy]);

  const openThread = (id: string) => {
    if (busy) return;
    setThreadId(id);
    setDrawer(false);
    router.replace(`/?t=${encodeURIComponent(id)}`);
  };

  const newChat = () => {
    if (busy) return;
    const id = newThreadId();
    freshIds.current.add(id);
    setThreadId(id);
    setDrawer(false);
    router.replace('/');
  };

  const deleteThread = async (id: string) => {
    await api(`/threads/${id}`, { method: 'DELETE' }).catch(() => undefined);
    if (id === threadId) newChat();
    void loadThreads();
  };

  const speak = async (text: string) => {
    try {
      const blob = await api<Blob>('/voice/speak', { method: 'POST', json: { text: text.slice(0, 3500) } });
      audio.current?.pause();
      audio.current = new Audio(URL.createObjectURL(blob));
      await audio.current.play();
    } catch {
      /* autoplay or TTS failure — silent */
    }
  };

  const subscriber: AgentSubscriber = {
    onStateChanged: ({ state }) => {
      const s = state as SwarmUiState;
      if (s?.agents) setAgents({ ...s.agents });
    },
    onToolCallStartEvent: ({ event }) => {
      setTools((t) => [...t, { id: event.toolCallId, agent: String(event.metadata?.agent ?? ''), tool: event.toolCallName, status: 'running' }]);
    },
    onToolCallResultEvent: ({ event }) => {
      setTools((t) => t.map((x) => (x.id === event.toolCallId ? { ...x, status: event.metadata?.ok === false ? 'error' : 'ok', durationMs: event.metadata?.durationMs } : x)));
    },
    onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
      // The buffer handed to subscribers does not include this event's delta yet.
      const content = textMessageBuffer + event.delta;
      setMessages((m) => {
        const last = m.at(-1);
        if (last?.streaming) return [...m.slice(0, -1), { ...last, content }];
        return [...m, { role: 'assistant', content, streaming: true }];
      });
    },
    onTextMessageEndEvent: ({ textMessageBuffer }) => {
      setMessages((m) => m.map((x) => (x.streaming ? { ...x, streaming: false, content: textMessageBuffer.length >= x.content.length ? textMessageBuffer : x.content } : x)));
      if (readAloud && textMessageBuffer) void speak(textMessageBuffer);
    },
    onRunFinishedEvent: ({ event }) => {
      const o = event.outcome;
      if (o?.type === 'interrupt') {
        const i = o.interrupts[0];
        setPending({ interruptId: i.id, actions: (i.metadata?.actions ?? []) as Pending['actions'] });
      } else if (o?.type === 'cancelled') {
        setMessages((m) => [...m, { role: 'assistant', content: '⏹ Stopped.' }]);
      }
    },
    onRunErrorEvent: ({ event }) => {
      if (!stopping.current) setError(event.message);
    },
    onRunFailed: ({ error: e }) => {
      if (!stopping.current) setError(e.message);
    },
  };

  const run = async (params: RunAgentParameters, userText: string | null, attachments: OutAttachment[] = []) => {
    const agent = agentFor(threadId);
    setError(null);
    setBusy(true);
    stopping.current = false;
    setAgents({});
    setTools([]);
    // The server keeps the conversation; send only plain text history, not previous tool-call messages.
    agent.setMessages(agent.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content));
    if (userText !== null) {
      setMessages((m) => [...m, { role: 'user', content: userText, attachments: attachments.map((a) => a.name) }]);
      agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: userText || 'Please look at the attachment.' });
    }
    if (!params.resume) router.replace(`/?t=${encodeURIComponent(threadId)}`);
    try {
      await agent.runAgent(
        { ...params, ...(attachments.length ? { forwardedProps: { attachments: attachments.map(({ name, mime, data }) => ({ name, mime, data })) } } : {}) },
        subscriber,
      );
    } catch (e) {
      if (!stopping.current) setError((e as Error).message);
    } finally {
      setBusy(false);
      freshIds.current.delete(threadId);
      void loadThreads();
      api<ThreadDetail>(`/threads/${threadId}`).then((t) => setThread(t)).catch(() => undefined);
    }
  };

  const send = (text: string, attachments: OutAttachment[]) => {
    // AG-UI requires answering open interrupts: a new message dismisses the pending approval.
    const resume = pending ? [{ interruptId: pending.interruptId, status: 'cancelled' as const }] : undefined;
    setPending(null);
    void run(resume ? { resume } : {}, text, attachments);
  };

  const decide = (approved: boolean, actionIds?: string[]) => {
    if (!pending) return;
    const { interruptId } = pending;
    setPending(null);
    setMessages((m) => [...m, { role: 'user', content: approved ? (actionIds ? `✅ Approve ${actionIds.length} action(s)` : '✅ Approve') : '✖️ Reject' }]);
    void run({ resume: [{ interruptId, status: 'resolved', payload: { approved, ...(actionIds ? { actionIds } : {}) } }] }, null);
  };

  const stop = () => {
    stopping.current = true;
    agentRef.current?.abortRun();
    void api(`/threads/${threadId}/cancel`, { method: 'POST' }).catch(() => undefined);
    setBusy(false);
    setMessages((m) => [...m.filter((x) => !x.streaming), { role: 'assistant', content: '⏹ Stopped.' }]);
  };

  const toggleRead = () => {
    const v = !readAloud;
    setReadAloud(v);
    try {
      window.localStorage.setItem('swarm.readAloud', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const readOnly = thread && thread.channel !== 'web' ? `This conversation happens on ${CHANNEL_BADGE[thread.channel]} — reply there. You can read it here.` : null;
  const firstName = me?.user.name.split(' ')[0] ?? '';

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-3">
        <button onClick={newChat} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-bg disabled:opacity-50">
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </button>
        <button className="grid h-9 w-9 place-items-center rounded-lg text-muted md:hidden" onClick={() => setDrawer(false)} aria-label="Close conversations">
          <X className="h-5 w-5" />
        </button>
      </div>
      <ul className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {threads.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">No conversations yet.</li>}
        {threads.map((t) => (
          <li key={t.id} className="group relative">
            <button onClick={() => openThread(t.id)}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${t.id === threadId ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}>
              <span className="line-clamp-1 pr-6 font-medium">{t.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span className="rounded bg-surface-2 px-1.5 py-px">{CHANNEL_BADGE[t.channel]}</span>
                {t.status === 'awaiting_confirmation' && <span className="font-semibold text-accent-strong">needs approval</span>}
                <span>{new Date(t.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              </span>
            </button>
            <button onClick={() => deleteThread(t.id)} className="absolute right-2 top-2 hidden rounded p-1 text-muted hover:text-danger group-hover:block" aria-label={`Delete ${t.title}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-72 shrink-0 border-r border-line bg-surface md:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Conversations">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-surface shadow-xl">{sidebar}</div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 md:px-5">
          <button className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 md:hidden" onClick={() => setDrawer(true)} aria-label="Open conversations">
            <PanelLeft className="h-5 w-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{thread?.title ?? 'New conversation'}</h1>
          <button onClick={toggleRead} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${readAloud ? 'bg-teal-soft text-teal' : 'text-muted hover:bg-surface-2'}`} aria-pressed={readAloud}>
            {readAloud ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} Read aloud
          </button>
        </div>

        <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-5 md:px-6">
            {messages.length === 0 && !busy && (
              <div className="flex flex-col items-center gap-4 py-10 text-center">
                <Logo size={56} />
                <h2 className="font-display text-3xl font-semibold tracking-tight">Hi {firstName}, what should the swarm do?</h2>
                <p className="max-w-md text-sm text-muted">Email, calendar, research, travel, expenses, notes, reminders and shopping — type, attach a photo, or tap the mic.</p>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {CHIPS.map((c) => (
                    <button key={c} onClick={() => send(c, [])} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm hover:border-accent hover:bg-accent-soft">
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-bg">
                    {m.content}
                    {m.attachments?.length ? <div className="mt-1 text-xs opacity-75">📎 {m.attachments.join(', ')}</div> : null}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-2.5">
                  <div className="mt-1 shrink-0"><Logo size={22} /></div>
                  <div className="prose-chat min-w-0 max-w-[90%] rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-2.5 text-[15px] leading-relaxed">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                    {m.streaming && <span className="hive-pulse">▍</span>}
                  </div>
                </div>
              ),
            )}

            {(busy || Object.keys(agents).length > 0) && <AgentActivity agents={agents} tools={tools} busy={busy} />}
            {pending && !busy && <ApprovalCard pending={pending} busy={busy} onDecide={decide} />}
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-line bg-bg px-3 py-3 md:px-6">
          <div className="mx-auto max-w-3xl">
            <Composer busy={busy} disabled={readOnly} onSend={send} onStop={stop} />
          </div>
        </div>
      </section>
    </div>
  );
}
