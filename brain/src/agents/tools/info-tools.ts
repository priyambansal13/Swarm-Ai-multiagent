import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RunContext } from '../context.js';
import { safe, Services } from './common.js';

export function researchTools(s: Services) {
  return [
    tool(safe(async ({ query }: { query: string }) => s.search.web(query)), {
      name: 'web_search', description: 'Search the web. Returns titles, URLs and snippets.', schema: z.object({ query: z.string() }),
    }),
    tool(safe(async ({ query }: { query: string }) => s.search.news(query)), {
      name: 'news_search', description: 'Recent news (India edition by default).', schema: z.object({ query: z.string() }),
    }),
    tool(safe(async ({ url }: { url: string }) => s.web.read(url)), {
      name: 'read_url', description: 'Read a public web page and return its text.', schema: z.object({ url: z.string() }),
    }),
  ];
}

export function travelTools(s: Services, ctx: RunContext) {
  return [
    tool(safe(async (a: { from: string; to: string; date: string; returnDate: string | null; adults: number | null; travelClass: 'economy' | 'premium' | 'business' | 'first' | null }) =>
      s.search.flights({ ...a, returnDate: a.returnDate ?? undefined, adults: a.adults ?? 1, travelClass: a.travelClass ?? 'economy' })), {
      name: 'search_flights',
      description: 'Live flight options and prices (INR). Use IATA airport codes (BLR, DEL, BOM, GOI…).',
      schema: z.object({ from: z.string(), to: z.string(), date: z.string().describe('YYYY-MM-DD'), returnDate: z.string().nullable(), adults: z.number().int().nullable(), travelClass: z.enum(['economy', 'premium', 'business', 'first']).nullable() }),
    }),
    tool(safe(async (a: { location: string; checkIn: string; checkOut: string; adults: number | null; maxPricePerNight: number | null }) =>
      s.search.hotels({ location: a.location, checkIn: a.checkIn, checkOut: a.checkOut, adults: a.adults ?? 2, maxPrice: a.maxPricePerNight ?? undefined })), {
      name: 'search_hotels',
      description: 'Live hotel options with nightly prices (INR) and ratings.',
      schema: z.object({ location: z.string(), checkIn: z.string(), checkOut: z.string(), adults: z.number().int().nullable(), maxPricePerNight: z.number().nullable() }),
    }),
    tool(safe(async ({ place, days }: { place: string; days: number | null }) => {
      const f: any = await s.weather.forecast(place, Math.max(days ?? 3, 3));
      // Label days relative to the user's "today" so the model never mixes up today/tomorrow.
      const today = new Date().toLocaleDateString('en-CA', { timeZone: ctx.user.timezone });
      const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: ctx.user.timezone });
      for (const d of f.daily ?? []) d.label = d.date === today ? 'today' : d.date === tomorrow ? 'tomorrow' : d.date;
      return f;
    }), {
      name: 'get_weather', description: 'Weather forecast for a place (plus official IMD warnings for Indian districts).', schema: z.object({ place: z.string(), days: z.number().int().nullable() }),
    }),
    tool(safe(async ({ request }: { request: string }) => s.yatra.plan(request, ctx.signal)), {
      name: 'plan_india_trip',
      description: 'Full day-wise trip plan for destinations in India via the Yatra AI planner (takes ~1 minute). Include origin, destination, dates, travellers, budget, interests.',
      schema: z.object({ request: z.string() }),
    }),
    tool(safe(async (a: { trip: string; dates: string; details: string; estCost: number | null; links: string }) => s.records.logTrip(ctx.user.id, a)), {
      name: 'log_trip', description: "Save a trip (chosen flights/hotels, dates, cost, links) to the user's TravelLog.",
      schema: z.object({ trip: z.string(), dates: z.string(), details: z.string(), estCost: z.number().nullable(), links: z.string() }),
    }),
  ];
}

export function shoppingTools(s: Services, ctx: RunContext) {
  const uid = ctx.user.id;
  return [
    tool(safe(async ({ query }: { query: string }) => s.search.shopping(query)), {
      name: 'search_products', description: 'Compare prices for a product across Indian online stores.', schema: z.object({ query: z.string() }),
    }),
    tool(safe(async ({ query, targetPriceINR }: { query: string; targetPriceINR: number }) => s.records.addWatch(uid, query, targetPriceINR)), {
      name: 'create_price_watch', description: 'Watch a product daily and alert the user when its lowest price drops below the target.',
      schema: z.object({ query: z.string().describe('Specific product name/model'), targetPriceINR: z.number() }),
    }),
    tool(safe(async () => s.records.listWatches(uid)), { name: 'list_price_watches', description: 'Active price watches.', schema: z.object({}) }),
    tool(safe(async ({ id }: { id: string }) => s.records.stopWatch(uid, id)), {
      name: 'stop_price_watch', description: 'Stop a price watch by id.', schema: z.object({ id: z.string() }),
    }),
  ];
}

export function documentTools(s: Services, ctx: RunContext) {
  return [
    tool(safe(async ({ instruction }: { instruction: string }) => {
      if (!ctx.attachments.length) return { error: 'No attachment in this message.' };
      const images = ctx.attachments.filter((a) => a.mime.startsWith('image/'));
      const texts = ctx.attachments.filter((a) => /^text\/|json|csv|xml/.test(a.mime));
      const parts: string[] = [];
      if (images.length) parts.push(await s.media.vision(instruction, images));
      for (const t of texts) parts.push(`--- ${t.name} ---\n${Buffer.from(t.data, 'base64').toString('utf8').slice(0, 12000)}`);
      const unsupported = ctx.attachments.filter((a) => !images.includes(a) && !texts.includes(a)).map((a) => `${a.name} (${a.mime})`);
      return { analysis: parts.join('\n\n'), unsupported };
    }), {
      name: 'analyze_attachments',
      description: 'Read the images / text files the user attached and answer the instruction (summary, extraction, translation…).',
      schema: z.object({ instruction: z.string() }),
    }),
  ];
}
