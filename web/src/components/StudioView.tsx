'use client';

import { Check, Clapperboard, Clock, Copy, Download, Film, Hash, History, Image as ImageIcon, Loader2, Megaphone, Music2, Plug, Search, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, API_URL } from '@/lib/api';
import { isAdmin, type StudioOptions, type StudioPlatform, type StudioResearch, type StudioScriptResponse } from '@/lib/types';
import { useAuth } from './AuthProvider';

/** Studio tab — StoryForge: topic → real-time research → short-form video script (Shorts / Reels). Dark "studio" look. */

const PLATFORMS: { id: StudioPlatform; label: string }[] = [
  { id: 'shorts', label: 'YouTube Shorts' },
  { id: 'reels', label: 'Instagram Reels' },
  { id: 'both', label: 'Both' },
];
const DURATIONS = [30, 45, 60, 90];
const TONES = ['energetic', 'informative', 'storytelling', 'funny', 'inspirational'];
const LANGUAGES = ['English', 'Hindi', 'Hinglish', 'Tamil', 'Telugu', 'Marathi', 'Bengali', 'Spanish'];
const HISTORY_KEY = 'swarm.studio.history';

interface Saved { id: string; at: string; topic: string; result: StudioScriptResponse }

const loadHistory = (): Saved[] => {
  try {
    return JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]') as Saved[];
  } catch {
    return [];
  }
};
const saveHistory = (h: Saved[]) => {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 8)));
  } catch {
    /* storage unavailable — history is a convenience only */
  }
};

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'script';

const panel = 'rounded-2xl border border-white/10 bg-white/[0.04] p-5';
const label = 'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400';
const seg = (on: boolean) => `rounded-lg px-3 py-1.5 text-sm font-medium transition ${on ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`;
const field = 'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-400';

function CopyBtn({ text, label: l = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined)}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />} {done ? 'Copied' : l}
    </button>
  );
}

export function StudioView() {
  const { me } = useAuth();
  const [opts, setOpts] = useState<StudioOptions | null>(null);
  const [topic, setTopic] = useState('');
  const [angle, setAngle] = useState('');
  const [platform, setPlatform] = useState<StudioPlatform>('shorts');
  const [duration, setDuration] = useState(60);
  const [tone, setTone] = useState('energetic');
  const [language, setLanguage] = useState('English');
  const [audience, setAudience] = useState('');
  const [busy, setBusy] = useState<null | 'research' | 'script'>(null);
  const [error, setError] = useState<string | null>(null);
  const [research, setResearch] = useState<StudioResearch | null>(null);
  const [result, setResult] = useState<StudioScriptResponse | null>(null);
  // Mounted only in the browser (AppShell renders children after sign-in), so localStorage is available here.
  const [history, setHistory] = useState<Saved[]>(() => (typeof window === 'undefined' ? [] : loadHistory()));

  useEffect(() => {
    api<StudioOptions>('/studio/options').then(setOpts).catch(() => undefined);
  }, []);

  const doResearch = async () => {
    const r = await api<StudioResearch>('/studio/research', { method: 'POST', json: { topic: topic.trim() } });
    setResearch(r);
    return r;
  };

  const run = async (withScript: boolean) => {
    if (topic.trim().length < 2) return setError('Enter a topic first.');
    setError(null);
    setResult(null);
    try {
      setBusy('research');
      const r = research && research.topic === topic.trim() ? research : await doResearch();
      if (!withScript) return;
      await writeScript(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const writeScript = async (r: StudioResearch) => {
    setBusy('script');
    setError(null);
    try {
      const researchText = [r.summary, '', 'Key facts:', ...r.keyFacts.map((f) => `- ${f.fact} [${f.source}]`)].join('\n');
      const res = await api<StudioScriptResponse>('/studio/script', {
        method: 'POST',
        json: { topic: r.topic, research: researchText, angle: angle.trim() || undefined, platform, durationSec: duration, tone, language, audience: audience.trim() || undefined, sources: r.sources },
      });
      setResult(res);
      const h = [{ id: `${Date.now()}`, at: new Date().toISOString(), topic: r.topic, result: res }, ...loadHistory()];
      saveHistory(h);
      setHistory(h.slice(0, 8));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const s = result?.script;
  const mcpUrl = `${API_URL}/api/mcp`;

  return (
    <div className="scroll-thin h-full overflow-y-auto bg-[#0a0d14] text-slate-100">
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_20%_0%,rgba(251,191,36,0.18),transparent),radial-gradient(50%_80%_at_90%_10%,rgba(45,212,191,0.12),transparent)]" />
        <div className="relative mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
          {/* hero */}
          <header className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20"><Clapperboard className="h-6 w-6" /></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">StoryForge · YouTube content agent</p>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">From a topic to a ready-to-shoot script</h1>
              </div>
            </div>
            {opts && <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300"><Search className="mr-1 inline h-3 w-3" />{opts.searchProvider} · OpenAI</span>}
          </header>

          {/* form */}
          <form className={`${panel} space-y-4`} onSubmit={(e) => { e.preventDefault(); void run(true); }}>
            <div>
              <label htmlFor="studio-topic" className={label}>Topic</label>
              <input id="studio-topic" className={`${field} py-3 text-base`} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. ISRO Gaganyaan latest update · Why UPI is growing so fast · Best budget phones this month" maxLength={200} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <span className={label}>Platform</span>
                <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-slate-950/60 p-1">
                  {PLATFORMS.map((p) => <button key={p.id} type="button" className={seg(platform === p.id)} onClick={() => setPlatform(p.id)}>{p.label}</button>)}
                </div>
              </div>
              <div>
                <span className={label}>Length</span>
                <div className="inline-flex gap-1 rounded-xl border border-white/10 bg-slate-950/60 p-1">
                  {DURATIONS.map((d) => <button key={d} type="button" className={seg(duration === d)} onClick={() => setDuration(d)}>{d}s</button>)}
                </div>
              </div>
              <div>
                <label htmlFor="studio-tone" className={label}>Tone</label>
                <select id="studio-tone" className={field} value={tone} onChange={(e) => setTone(e.target.value)}>
                  {TONES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="studio-lang" className={label}>Language</label>
                <select id="studio-lang" className={field} value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="studio-angle" className={label}>Angle <span className="normal-case tracking-normal text-slate-500">(optional)</span></label>
                <input id="studio-angle" className={field} value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="Pick one from the research, or write your own" maxLength={200} />
              </div>
              <div>
                <label htmlFor="studio-audience" className={label}>Audience <span className="normal-case tracking-normal text-slate-500">(optional)</span></label>
                <input id="studio-audience" className={field} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. college students in India" maxLength={120} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="submit" disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:brightness-105 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Research + write script
              </button>
              <button type="button" disabled={!!busy} onClick={() => void run(false)} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-60">
                <Search className="h-4 w-4" /> Research only
              </button>
              {busy && (
                <span className="text-sm text-slate-400">
                  {busy === 'research' ? 'Searching the web and reading the latest sources…' : 'Writing your script…'}
                </span>
              )}
            </div>
            {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          </form>

          {/* research */}
          {research && (
            <section className={panel}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-semibold text-white">Research</h2>
                <span className="rounded-full bg-teal-400/15 px-2.5 py-0.5 text-xs font-medium text-teal-200">{research.freshness}</span>
                <span className="text-xs text-slate-500">{research.sources.length} sources · {research.provider}</span>
                <div className="ml-auto flex gap-1">
                  <CopyBtn text={[research.summary, '', ...research.keyFacts.map((f) => `- ${f.fact}`)].join('\n')} />
                  {!s && <button type="button" disabled={!!busy} onClick={() => void writeScript(research)} className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-950 disabled:opacity-60"><Sparkles className="h-3.5 w-3.5" /> Write script</button>}
                </div>
              </div>
              <p className="text-[15px] leading-relaxed text-slate-200">{research.summary}</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <span className={label}>Key facts</span>
                  <ul className="space-y-1.5 text-sm text-slate-300">
                    {research.keyFacts.map((f, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span>{f.fact} {research.sources[f.source - 1] && <a href={research.sources[f.source - 1].url} target="_blank" rel="noreferrer" className="text-xs text-teal-300 hover:underline">[{f.source}]</a>}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className={label}>Video angles <span className="normal-case tracking-normal text-slate-500">— click to use</span></span>
                  <div className="flex flex-wrap gap-2">
                    {research.angles.map((a) => (
                      <button key={a} type="button" onClick={() => setAngle(a)} className={`rounded-xl border px-3 py-1.5 text-left text-sm transition ${angle === a ? 'border-amber-400 bg-amber-400/15 text-amber-100' : 'border-white/10 text-slate-300 hover:border-white/25'}`}>{a}</button>
                    ))}
                  </div>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-slate-400">Sources</summary>
                    <ol className="mt-2 space-y-1 text-sm">
                      {research.sources.map((x, i) => (
                        <li key={x.url} className="truncate"><span className="text-slate-500">{i + 1}.</span> <a href={x.url} target="_blank" rel="noreferrer" className="text-teal-300 hover:underline">{x.title}</a>{x.date && <span className="text-xs text-slate-500"> · {x.date}</span>}</li>
                      ))}
                    </ol>
                  </details>
                </div>
              </div>
            </section>
          )}

          {/* script */}
          {s && result && (
            <section className={`${panel} border-amber-400/20`}>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-semibold text-white"><Film className="mr-1.5 inline h-5 w-5 text-amber-300" />Script</h2>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-slate-300">{PLATFORMS.find((p) => p.id === s.platform)?.label} · {s.durationSec}s · {s.tone} · {s.language}</span>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-slate-300">{s.wordCount} words · target {Math.round(s.durationSec * 2.5)}</span>
                <div className="ml-auto flex flex-wrap gap-1">
                  <CopyBtn text={result.markdown} label="Copy all" />
                  <button type="button" onClick={() => download(`${slug(s.topic)}-script.md`, result.markdown, 'text/markdown')} className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-950"><Download className="h-3.5 w-3.5" /> Script (.md)</button>
                  <button type="button" onClick={() => download(`${slug(s.topic)}-teleprompter.txt`, result.teleprompter, 'text/plain')} className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10"><Download className="h-3.5 w-3.5" /> Teleprompter (.txt)</button>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[1fr_17rem]">
                <div className="space-y-4">
                  <div>
                    <span className={label}>Title options</span>
                    <ol className="space-y-1">
                      {s.titles.map((t, i) => <li key={i} className="flex items-center gap-2 text-sm text-slate-200"><span className="text-slate-500">{i + 1}.</span><span className="flex-1">{t}</span><CopyBtn text={t} label="" /></li>)}
                    </ol>
                  </div>
                  <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">Hook · first 3 seconds</span>
                    <p className="mt-1 text-lg font-semibold text-white">{s.hook}</p>
                  </div>
                  <ol className="space-y-2">
                    {s.beats.map((b, i) => (
                      <li key={i} className="grid gap-2 rounded-xl border border-white/10 bg-slate-950/40 p-3 sm:grid-cols-[7.5rem_1fr]">
                        <span className="inline-flex h-fit w-fit items-center gap-1 whitespace-nowrap rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs text-slate-300"><Clock className="h-3 w-3" />{b.time}</span>
                        <div className="space-y-1.5">
                          <p className="text-[15px] text-slate-100">{b.voiceover}</p>
                          <div className="flex flex-wrap gap-2 text-xs">
                            <span className="rounded-md bg-teal-400/15 px-2 py-0.5 font-semibold text-teal-200">“{b.onScreenText}”</span>
                            <span className="italic text-slate-400">{b.visual}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <p className="flex items-start gap-2 rounded-xl border border-white/10 p-3 text-sm text-slate-200"><Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />{s.cta}</p>
                </div>

                <aside className="space-y-4">
                  <div>
                    <div className="flex items-center"><span className={label}>Caption</span><span className="ml-auto"><CopyBtn text={`${s.caption}\n\n${s.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`} /></span></div>
                    <p className="text-sm text-slate-300">{s.caption}</p>
                    <p className="mt-2 flex flex-wrap gap-1 text-xs"><Hash className="h-3.5 w-3.5 text-slate-500" />{s.hashtags.map((h) => <span key={h} className="text-teal-300">{h.startsWith('#') ? h : `#${h}`}</span>)}</p>
                  </div>
                  <div>
                    <span className={label}><ImageIcon className="mr-1 inline h-3 w-3" />Thumbnail ideas</span>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-slate-300">{s.thumbnailIdeas.map((t) => <li key={t}>{t}</li>)}</ul>
                  </div>
                  <div>
                    <span className={label}><Music2 className="mr-1 inline h-3 w-3" />Music</span>
                    <p className="text-sm text-slate-300">{s.musicMood}</p>
                  </div>
                  {s.sources.length > 0 && (
                    <div>
                      <span className={label}>Sources</span>
                      <ol className="space-y-1 text-xs">{s.sources.slice(0, 6).map((x, i) => <li key={x.url} className="truncate"><a href={x.url} target="_blank" rel="noreferrer" className="text-teal-300 hover:underline">{i + 1}. {x.title}</a></li>)}</ol>
                    </div>
                  )}
                </aside>
              </div>
            </section>
          )}

          {/* history + MCP */}
          <div className="grid gap-5 md:grid-cols-2">
            <section className={panel}>
              <div className="mb-2 flex items-center gap-2">
                <History className="h-4 w-4 text-slate-400" /><h2 className="text-sm font-semibold text-white">Recent scripts</h2>
                {history.length > 0 && <button type="button" onClick={() => { saveHistory([]); setHistory([]); }} className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"><Trash2 className="h-3 w-3" /> Clear</button>}
              </div>
              {history.length === 0 ? <p className="text-sm text-slate-500">Scripts you create are kept here, on this device.</p> : (
                <ul className="space-y-1">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => { setResult(h.result); setResearch(null); setTopic(h.topic); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-white/5">
                        <Film className="h-3.5 w-3.5 shrink-0 text-amber-300" /><span className="flex-1 truncate">{h.result.script.titles[0] ?? h.topic}</span>
                        <span className="text-xs text-slate-500">{new Date(h.at).toLocaleDateString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {isAdmin(me?.user.role) && (
              <section className={panel}>
                <div className="mb-2 flex items-center gap-2"><Plug className="h-4 w-4 text-slate-400" /><h2 className="text-sm font-semibold text-white">Use from AI agents (MCP)</h2></div>
                <p className="text-sm text-slate-400">Tools <code className="text-amber-200">get_latest_info_mcp</code> and <code className="text-amber-200">get_video_script_mcp</code> for Claude Desktop and other MCP clients. Needs <code>MCP_SERVER_TOKEN</code> on the server.</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-300">{JSON.stringify({ mcpServers: { storyforge: { command: 'npx', args: ['-y', 'mcp-remote', mcpUrl, '--header', 'Authorization:Bearer ${MCP_TOKEN}'], env: { MCP_TOKEN: '<MCP_SERVER_TOKEN>' } } } }, null, 2)}</pre>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
