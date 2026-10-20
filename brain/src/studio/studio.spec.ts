import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { SearchService } from '../integrations/search.service.js';
import type { WebReaderService } from '../integrations/web-reader.service.js';
import { tokenMatches } from './mcp.controller.js';
import { type Script, ScriptInputSchema, scriptToMarkdown, scriptToTeleprompter, StudioService, wordBudget } from './studio.service.js';

const script: Script = {
  topic: 'Monsoon 2026', platform: 'shorts', durationSec: 30, tone: 'energetic', language: 'English', wordCount: 75, createdAt: '2026-10-20',
  titles: ['Why this monsoon was | different', 'Second', 'Third'],
  hook: 'This year the rain broke a 50-year record.',
  beats: [{ time: '0:03-0:10', voiceover: 'Line one.', onScreenText: 'Record rain', visual: 'Flooded street b-roll' }],
  cta: 'Follow for more.', caption: 'The numbers behind the record monsoon.', hashtags: ['monsoon', '#shorts'],
  thumbnailIdeas: ['Umbrella in storm'], musicMood: 'Upbeat, 120 bpm',
  sources: [{ title: 'IMD bulletin', url: 'https://mausam.imd.gov.in/x', snippet: '' }],
};

describe('StoryForge script helpers', () => {
  it('budgets ~2.5 spoken words per second', () => {
    expect(wordBudget(30)).toBe(75);
    expect(wordBudget(60)).toBe(150);
  });

  it('renders markdown with a safe table, hashtags and sources', () => {
    const md = scriptToMarkdown(script);
    expect(md).toContain('# Why this monsoon was | different');
    expect(md).toContain('| 0:03-0:10 | Line one. | Record rain | Flooded street b-roll |');
    expect(md).toContain('#monsoon #shorts');
    expect(md).toContain('1. [IMD bulletin](https://mausam.imd.gov.in/x)');
    expect(md).toContain('YouTube Shorts');
  });

  it('teleprompter text is hook, beats and CTA only', () => {
    expect(scriptToTeleprompter(script)).toBe('This year the rain broke a 50-year record.\n\nLine one.\n\nFollow for more.\n');
  });

  it('validates script input and applies defaults', () => {
    expect(ScriptInputSchema.parse({ topic: 'AI news' })).toMatchObject({ platform: 'shorts', durationSec: 60, tone: 'energetic', language: 'English' });
    expect(() => ScriptInputSchema.parse({ topic: 'AI news', durationSec: 75 })).toThrow();
    expect(() => ScriptInputSchema.parse({ topic: 'x' })).toThrow();
  });
});

describe('StoryForge sources', () => {
  it('merges news and web results without duplicate URLs (keyless / SerpAPI path)', async () => {
    const search = {
      serpConfigured: false,
      news: vi.fn(async () => ({ results: [{ title: 'A', url: 'https://a', snippet: 'a' }, { title: 'B', url: 'https://b', snippet: 'b' }] })),
      web: vi.fn(async () => ({ provider: 'x', results: [{ title: 'B again', url: 'https://b', snippet: 'b' }, { title: 'C', url: 'https://c', snippet: 'c' }] })),
    } as unknown as SearchService;
    const config = { get: vi.fn(() => undefined) } as unknown as ConfigService;
    const studio = new StudioService(config, search, {} as WebReaderService);
    const r = await studio.sources('topic');
    expect(r.sources.map((s) => s.url)).toEqual(['https://a', 'https://b', 'https://c']);
    expect(r.provider).toContain('keyless');
  });
});

describe('MCP bearer token', () => {
  it('accepts only the exact configured token', () => {
    expect(tokenMatches('Bearer s3cret-token', 's3cret-token')).toBe(true);
    expect(tokenMatches('bearer s3cret-token', 's3cret-token')).toBe(true);
    expect(tokenMatches('Bearer wrong', 's3cret-token')).toBe(false);
    expect(tokenMatches(undefined, 's3cret-token')).toBe(false);
    expect(tokenMatches('Bearer anything', undefined)).toBe(false);
  });
});

describe('spoken word count', () => {
  it('counts hook, voice-over and CTA only', async () => {
    const { spokenWords } = await import('./studio.service.js');
    expect(spokenWords({ hook: 'one two', beats: [{ voiceover: 'three four five' }], cta: 'six' })).toBe(6);
  });
});
