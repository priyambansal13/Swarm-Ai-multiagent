import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { fetchJson } from '../common/http.js';
import { SearchService } from '../integrations/search.service.js';
import { WebReaderService } from '../integrations/web-reader.service.js';

/**
 * StoryForge — the Studio tab and the MCP server: topic → real-time research → short-form video script
 * (YouTube Shorts / Instagram Reels).
 *
 * Search uses free sources only: Tavily (free tier, when TAVILY_API_KEY is set), SerpAPI (free plan, when
 * SERPAPI_KEY is set), otherwise keyless Wikipedia + Google News RSS; the top pages are read for detail.
 * The summary and the script come from OpenAI (the organisation's fast model and own key when it has one).
 */

export const PLATFORMS = ['shorts', 'reels', 'both'] as const;
export const DURATIONS = [30, 45, 60, 90] as const;
export const TONES = ['energetic', 'informative', 'storytelling', 'funny', 'inspirational'] as const;

export const ResearchInputSchema = z.object({
  topic: z.string().trim().min(2).max(200),
});

export const ScriptInputSchema = z.object({
  topic: z.string().trim().min(2).max(200),
  /** Research text to base the script on; when missing, research runs first. */
  research: z.string().trim().max(12_000).optional(),
  angle: z.string().trim().max(200).optional(),
  platform: z.enum(PLATFORMS).default('shorts'),
  durationSec: z.coerce.number().refine((n) => (DURATIONS as readonly number[]).includes(n), 'Use 30, 45, 60 or 90').default(60),
  tone: z.enum(TONES).default('energetic'),
  language: z.string().trim().min(2).max(30).default('English'),
  audience: z.string().trim().max(120).optional(),
  /** Sources of the research (listed at the end of the downloaded script). */
  sources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(1000), snippet: z.string().max(800).default(''), date: z.string().nullish() })).max(12).optional(),
});
export type ScriptInput = z.infer<typeof ScriptInputSchema>;

export interface Source { title: string; url: string; snippet: string; date?: string | null }

const ResearchOut = z.object({
  summary: z.string().describe('4-6 sentence overview of the latest, most relevant information. Only from the sources.'),
  keyFacts: z.array(z.object({
    fact: z.string().describe('One concrete, checkable fact: number, date, name, quote.'),
    source: z.number().int().describe('1-based index of the source it comes from'),
  })).describe('5-8 key facts'),
  angles: z.array(z.string()).describe('3-5 punchy angles for a short video about this topic'),
  freshness: z.string().describe('How recent the information is, e.g. "News from the last 3 days" or "Background, no recent news found"'),
});
export type Research = z.infer<typeof ResearchOut> & { topic: string; sources: Source[]; provider: string; createdAt: string };

const ScriptOut = z.object({
  titles: z.array(z.string()).describe('3 title options, under 60 characters, curiosity-driven, no clickbait lies'),
  hook: z.string().describe('The first line spoken in the first 2-3 seconds — must stop the scroll'),
  beats: z.array(z.object({
    time: z.string().describe('Time range like 0:00-0:03'),
    voiceover: z.string().describe('Exactly what to say'),
    onScreenText: z.string().describe('Short caption/overlay text (max ~6 words)'),
    visual: z.string().describe('What to show: b-roll, screen recording, face-to-camera, graphic'),
  })).describe('The script, beat by beat, covering the whole duration'),
  cta: z.string().describe('Closing call to action'),
  caption: z.string().describe('Post caption for the platform, 1-3 sentences'),
  hashtags: z.array(z.string()).describe('5-10 relevant hashtags including #shorts or #reels where it fits'),
  thumbnailIdeas: z.array(z.string()).describe('2-3 thumbnail / cover ideas'),
  musicMood: z.string().describe('Background music mood and tempo'),
});
export type Script = z.infer<typeof ScriptOut> & {
  topic: string; platform: ScriptInput['platform']; durationSec: number; tone: string; language: string;
  wordCount: number; sources: Source[]; createdAt: string;
};

/** Spoken words that fit a duration at a natural short-video pace (~2.5 words/second). */
export const wordBudget = (durationSec: number) => Math.round(durationSec * 2.5);

/** Words actually spoken: hook + every beat's voice-over + CTA. */
export const spokenWords = (s: { hook: string; beats: { voiceover: string }[]; cta: string }) =>
  [s.hook, ...s.beats.map((b) => b.voiceover), s.cta].join(' ').split(/\s+/).filter(Boolean).length;

const PLATFORM_LABEL: Record<ScriptInput['platform'], string> = { shorts: 'YouTube Shorts', reels: 'Instagram Reels', both: 'YouTube Shorts and Instagram Reels' };

/** Markdown version of a script — used for downloads and for the MCP tool's text output. */
export function scriptToMarkdown(s: Script): string {
  const lines = [
    `# ${s.titles[0] ?? s.topic}`,
    '',
    `**Topic:** ${s.topic} · **Platform:** ${PLATFORM_LABEL[s.platform]} · **Length:** ${s.durationSec}s · **Tone:** ${s.tone} · **Language:** ${s.language} · ~${s.wordCount} words`,
    '',
    '## Title options',
    ...s.titles.map((t, i) => `${i + 1}. ${t}`),
    '',
    '## Hook (first 3 seconds)',
    `> ${s.hook}`,
    '',
    '## Script',
    '| Time | Voice-over | On-screen text | Visual |',
    '|---|---|---|---|',
    ...s.beats.map((b) => `| ${b.time} | ${cell(b.voiceover)} | ${cell(b.onScreenText)} | ${cell(b.visual)} |`),
    '',
    `**Call to action:** ${s.cta}`,
    '',
    '## Caption',
    s.caption,
    '',
    s.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' '),
    '',
    '## Thumbnail ideas',
    ...s.thumbnailIdeas.map((t) => `- ${t}`),
    '',
    `**Music:** ${s.musicMood}`,
  ];
  if (s.sources.length) lines.push('', '## Sources', ...s.sources.map((x, i) => `${i + 1}. [${x.title}](${x.url})`));
  return lines.join('\n') + '\n';
}
const cell = (t: string) => t.replace(/\|/g, '/').replace(/\n+/g, ' ');

/** Plain voice-over only — for a teleprompter. */
export const scriptToTeleprompter = (s: Script) => [s.hook, ...s.beats.map((b) => b.voiceover), s.cta].filter(Boolean).join('\n\n') + '\n';

/** Research as plain text (input for the script step and the MCP tool's output). */
export function researchToText(r: Research): string {
  return [
    `Topic: ${r.topic}`,
    `Freshness: ${r.freshness}`,
    '',
    r.summary,
    '',
    'Key facts:',
    ...r.keyFacts.map((f) => `- ${f.fact} [${f.source}]`),
    '',
    'Sources:',
    ...r.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`),
  ].join('\n');
}

export interface LlmOptions { apiKey?: string; model?: string | null }

@Injectable()
export class StudioService {
  private readonly log = new Logger(StudioService.name);
  constructor(private readonly config: ConfigService, private readonly search: SearchService, private readonly reader: WebReaderService) {}

  private llm(o: LlmOptions = {}) {
    return new ChatOpenAI({
      model: o.model || this.config.get<string>('OPENAI_MODEL_FAST') || 'gpt-4.1-mini',
      temperature: 0.7, maxRetries: 1, timeout: 90_000,
      ...(o.apiKey ? { apiKey: o.apiKey } : {}),
    });
  }

  get searchProvider() {
    return this.config.get('TAVILY_API_KEY') ? 'Tavily (free tier)' : this.search.serpConfigured ? 'Google via SerpAPI (free plan)' : 'Wikipedia + Google News (keyless)';
  }

  /** Real-time sources for a topic: news first, then web; deduplicated by URL. */
  async sources(topic: string): Promise<{ provider: string; sources: Source[] }> {
    const tavily = this.config.get<string>('TAVILY_API_KEY');
    if (tavily) {
      try {
        const d = await fetchJson('https://api.tavily.com/search', {
          method: 'POST', timeoutMs: 25_000, ttlMs: 15 * 60_000,
          headers: { Authorization: `Bearer ${tavily}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: topic, search_depth: 'basic', max_results: 8, include_answer: false }),
        });
        const sources = ((d as any).results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: String(r.content ?? '').slice(0, 600), date: r.published_date ?? null }));
        if (sources.length) return { provider: 'Tavily (free tier)', sources };
      } catch (e) {
        this.log.warn(`Tavily failed, falling back: ${(e as Error).message}`);
      }
    }
    const [news, web] = await Promise.all([
      this.search.news(topic, 6).catch(() => ({ results: [] as Source[] })),
      this.search.web(topic, 6).catch(() => ({ provider: 'none', results: [] as Source[] })),
    ]);
    const seen = new Set<string>();
    const sources = [...(news.results as Source[]), ...(web.results as Source[])].filter((s) => s.url && !seen.has(s.url) && seen.add(s.url)).slice(0, 10);
    return { provider: this.search.serpConfigured ? 'Google + Google News via SerpAPI (free plan)' : 'Wikipedia + Google News (keyless)', sources };
  }

  async research(topic: string, o: LlmOptions = {}): Promise<Research> {
    const { provider, sources } = await this.sources(topic);
    if (!sources.length) throw new Error(`No sources found for "${topic}". Try a broader or differently worded topic.`);
    // Read the top pages for detail (best effort, keyless).
    const pages = await Promise.all(sources.slice(0, 3).map((s) => this.reader.read(s.url).then((p) => p.text.slice(0, 3500)).catch(() => '')));
    const material = sources.map((s, i) => `[${i + 1}] ${s.title}${s.date ? ` (${s.date})` : ''}\n${s.url}\n${s.snippet}${pages[i] ? `\nPage extract: ${pages[i]}` : ''}`).join('\n\n');
    const out = await this.llm(o).withStructuredOutput(ResearchOut, { name: 'research' }).invoke([
      ['system', 'You are a research assistant for short-form video creators. Use ONLY the numbered sources. Prefer the newest information. Never invent numbers, dates or quotes. Today is ' + new Date().toISOString().slice(0, 10) + '.'],
      ['human', `Topic: ${topic}\n\nSources:\n${material}`],
    ]);
    return { ...out, keyFacts: out.keyFacts.filter((f) => f.source >= 1 && f.source <= sources.length), topic, sources, provider, createdAt: new Date().toISOString() };
  }

  async script(input: ScriptInput, o: LlmOptions = {}): Promise<Script> {
    let sources: Source[] = input.sources ?? [];
    let research = input.research;
    if (!research) {
      const r = await this.research(input.topic, o);
      research = researchToText(r);
      sources = r.sources;
    }
    const words = wordBudget(input.durationSec);
    const out = await this.llm(o).withStructuredOutput(ScriptOut, { name: 'video_script' }).invoke([
      ['system', [
        `You write viral but accurate short-form video scripts for ${PLATFORM_LABEL[input.platform]} (vertical 9:16).`,
        `Length: ${input.durationSec} seconds = ${Math.round(words * 0.9)}-${words} spoken words in total across hook + all voice-over + CTA (count them). Fill the whole duration with substance; no filler.`,
        `Tone: ${input.tone}. Language: ${input.language} (write the voice-over, on-screen text, caption and titles in it; hashtags may be English).`,
        input.audience ? `Audience: ${input.audience}.` : '',
        'Structure: a hook in the first 2-3 s, 4-8 beats with exact time ranges that add up to the full length, a CTA at the end.',
        'Use only facts from the research; keep numbers and names exact; no made-up claims. Short sentences, one idea per beat.',
      ].filter(Boolean).join('\n')],
      ['human', `Topic: ${input.topic}${input.angle ? `\nAngle: ${input.angle}` : ''}\n\nResearch:\n${research}`],
    ]);
    let final = out;
    // Models drift from the spoken length (long for short videos, short for long ones): one correction pass when the
    // draft is more than 15 % over or 20 % under the word budget.
    const draft = spokenWords(out);
    if (draft > words * 1.15 || draft < words * 0.8) {
      const lo = Math.round(words * 0.9);
      try {
        final = await this.llm(o).withStructuredOutput(ScriptOut, { name: 'video_script' }).invoke([
          ['system', [
            `Rewrite this ${input.durationSec}-second video script so the spoken words (hook + all voice-over + CTA) total between ${lo} and ${words} — it has ${draft} now.`,
            draft > words ? 'Cut filler words; merge or drop the weakest beat if needed.' : 'Add substance from the research (facts, numbers, context) to the beats; you may add a beat. Never pad with filler.',
            'Keep the structure, time ranges covering the full length, facts, tone and language. Keep titles, caption, hashtags, thumbnails and music.',
          ].join(' ')],
          ['human', `Research:\n${research}\n\nScript:\n${JSON.stringify(out)}`],
        ]);
      } catch (e) {
        this.log.warn(`Length correction failed, keeping the first draft: ${(e as Error).message}`);
      }
    }
    const wordCount = spokenWords(final);
    return {
      ...final, topic: input.topic, platform: input.platform, durationSec: input.durationSec, tone: input.tone, language: input.language,
      wordCount, sources, createdAt: new Date().toISOString(),
    };
  }
}
