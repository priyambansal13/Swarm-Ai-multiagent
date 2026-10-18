'use client';

import { FileText, Globe, Loader2, RefreshCw, Search, Trash2, Type, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fileToBase64, fmtDateTime } from '@/lib/api';
import type { KbHit, KbSource } from '@/lib/types';
import { btnDark, btnGhost, Card, Empty, Field, inputCls, Notice, Pill } from '../ui';

const ICON = { file: FileText, url: Globe, text: Type };
const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.html,.htm,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*';

/** Knowledge base: documents, web pages and pasted text that agents search and cite. */
export function KnowledgeTab() {
  const [sources, setSources] = useState<KbSource[] | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState({ name: '', text: '' });
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<KbSource[]>('/admin/knowledge').then(setSources).catch((e) => setMsg({ tone: 'danger', text: (e as Error).message })), []);
  useEffect(() => {
    void load();
  }, [load]);
  // Poll while something is being processed.
  const processing = sources?.some((s) => s.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [processing, load]);

  const run = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'ok', text: ok });
      await load();
      return true;
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      if (f.size > 15_000_000) {
        setMsg({ tone: 'danger', text: `${f.name} is larger than 15 MB.` });
        continue;
      }
      await run('file', async () => api('/admin/knowledge/file', { method: 'POST', json: { name: f.name, mime: f.type || 'application/octet-stream', data: await fileToBase64(f) } }), `Processing ${f.name}…`);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setBusy('search');
    try {
      setHits(await api<KbHit[]>('/admin/knowledge/search', { method: 'POST', json: { query } }));
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Knowledge</h1>
      <p className="text-sm text-muted">
        Documents and pages the <b>Knowledge</b> agent searches for members and for customers on the desk. Answers cite the source and page.
        Scanned PDFs (images only) need OCR first.
      </p>
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Upload files" desc="PDF, Word (.docx), text, Markdown, CSV, HTML — up to 15 MB each.">
          <input ref={fileRef} id="kb-file" type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => upload(e.target.files)} />
          <label htmlFor="kb-file" className={`${btnDark} cursor-pointer`}>{busy === 'file' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose files</label>
        </Card>
        <Card title="Add a web page" desc="Public page or PDF link. Re-sync later to pick up changes.">
          <form onSubmit={(e) => { e.preventDefault(); void run('url', () => api('/admin/knowledge/url', { method: 'POST', json: { url } }), 'Fetching the page…').then((ok) => ok && setUrl('')); }} className="flex gap-2">
            <input id="kb-url" type="url" required className={inputCls} placeholder="https://…/faq" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button disabled={busy === 'url'} className={btnDark} aria-label="Add page">{busy === 'url' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}</button>
          </form>
        </Card>
        <Card title="Test a question" desc="See which passages the agent would find.">
          <form onSubmit={search} className="flex gap-2">
            <input id="kb-q" className={inputCls} placeholder="refund for damaged item" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button disabled={busy === 'search'} className={btnDark} aria-label="Search">{busy === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</button>
          </form>
        </Card>
      </div>
      {hits && (
        <Card title={`Results for “${query}”`} action={<button onClick={() => setHits(null)} className={btnGhost}>Clear</button>}>
          {!hits.length ? <Empty>Nothing relevant — the agent would say it isn&apos;t in the knowledge base.</Empty> : (
            <ol className="space-y-2">
              {hits.map((h) => (
                <li key={h.n} className="rounded-xl border border-line p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <b className="text-ink">{h.source}</b>{h.page && <span>p. {h.page}</span>}<Pill tone={h.score > 0.45 ? 'ok' : h.score > 0.3 ? 'warn' : 'muted'}>match {Math.round(h.score * 100)}%</Pill>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap">{h.text}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
      <Card title="Paste text" desc="FAQ answers, opening hours, price lists, policies…">
        <form onSubmit={(e) => { e.preventDefault(); void run('text', () => api('/admin/knowledge/text', { method: 'POST', json: text }), `“${text.name}” added.`).then((ok) => ok && setText({ name: '', text: '' })); }} className="space-y-3">
          <Field label="Title"><input id="kb-text-name" required className={inputCls} value={text.name} onChange={(e) => setText({ ...text, name: e.target.value })} placeholder="Opening hours & fees" /></Field>
          <textarea id="kb-text" required rows={5} className={inputCls} value={text.text} onChange={(e) => setText({ ...text, text: e.target.value })} placeholder="Mon–Sat 9 am – 7 pm…" />
          <button disabled={busy === 'text'} className={btnDark}>{busy === 'text' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Type className="h-4 w-4" />} Add text</button>
        </form>
      </Card>
      <Card title={`Sources${sources ? ` (${sources.length})` : ''}`}>
        {!sources ? <p className="text-sm text-muted">Loading…</p> : !sources.length ? <Empty>No knowledge yet — upload your first document.</Empty> : (
          <ul className="divide-y divide-line">
            {sources.map((s) => {
              const Icon = ICON[s.type];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Icon className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">{s.name}</a> : s.name}</div>
                    <div className="text-xs text-muted">
                      {s.status === 'ready' ? `${s.chunks} passages · ${s.chars.toLocaleString()} characters · updated ${fmtDateTime(s.syncedAt ?? s.createdAt)}` : s.status === 'error' ? <span className="text-danger">{s.error}</span> : 'Reading and indexing…'}
                    </div>
                  </div>
                  <Pill tone={s.status === 'ready' ? 'ok' : s.status === 'error' ? 'danger' : 'warn'}>{s.status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}{s.status}</Pill>
                  {s.type === 'url' && <button onClick={() => run(`sync-${s.id}`, () => api(`/admin/knowledge/${s.id}/resync`, { method: 'POST' }))} className={btnGhost} aria-label={`Re-sync ${s.name}`}><RefreshCw className={`h-4 w-4 ${busy === `sync-${s.id}` ? 'animate-spin' : ''}`} /></button>}
                  <button onClick={() => confirm(`Delete “${s.name}” from the knowledge base?`) && run(`del-${s.id}`, () => api(`/admin/knowledge/${s.id}`, { method: 'DELETE' }))} className={btnGhost} aria-label={`Delete ${s.name}`}><Trash2 className="h-4 w-4" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
