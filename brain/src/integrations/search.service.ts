import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchJson, fetchText, qs } from '../common/http.js';

const SERP = 'https://serpapi.com/search.json';
const decode = (s: string) =>
  s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, '').trim();

/**
 * Search for the Research, Travel and Shopping agents.
 * SerpAPI (Google, News, Shopping, Flights, Hotels) when SERPAPI_KEY is set; keyless fallbacks otherwise
 * (Wikipedia + Google News India RSS; deep links for flights/hotels/shopping).
 */
@Injectable()
export class SearchService {
  private readonly log = new Logger(SearchService.name);
  constructor(private readonly config: ConfigService) {}

  get serpConfigured() {
    return !!this.config.get('SERPAPI_KEY');
  }

  private serp(params: Record<string, string | number | undefined>) {
    return fetchJson(`${SERP}?${qs({ ...params, api_key: this.config.get('SERPAPI_KEY'), hl: 'en', gl: 'in' })}`, { ttlMs: 30 * 60_000, timeoutMs: 25_000 });
  }

  async web(query: string, num = 8) {
    if (this.serpConfigured) {
      try {
        const d = await this.serp({ engine: 'google', q: query, num });
        return {
          provider: 'Google via SerpAPI',
          answer: d.answer_box?.answer ?? d.answer_box?.snippet ?? d.knowledge_graph?.description ?? null,
          results: (d.organic_results ?? []).slice(0, num).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '' })),
        };
      } catch (e) {
        this.log.warn(`SerpAPI google failed: ${(e as Error).message}`);
      }
    }
    const [wiki, news] = await Promise.all([this.wikipedia(query).catch(() => []), this.news(query, 4).then((n) => n.results).catch(() => [])]);
    return { provider: 'Wikipedia + Google News RSS (SerpAPI not configured)', answer: null, results: [...wiki, ...news] };
  }

  private async wikipedia(query: string) {
    const d = await fetchJson(`https://en.wikipedia.org/w/api.php?${qs({ action: 'query', list: 'search', srsearch: query, srlimit: 5, format: 'json' })}`, { ttlMs: 3600_000 });
    return (d?.query?.search ?? []).map((r: any) => ({
      title: r.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      snippet: decode(r.snippet ?? ''),
    }));
  }

  async news(query: string, num = 8) {
    if (this.serpConfigured) {
      try {
        const d = await this.serp({ engine: 'google_news', q: query });
        return {
          provider: 'Google News via SerpAPI',
          results: (d.news_results ?? []).slice(0, num).map((r: any) => ({ title: r.title, url: r.link, snippet: r.source?.name ?? '', date: r.date ?? null })),
        };
      } catch (e) {
        this.log.warn(`SerpAPI news failed: ${(e as Error).message}`);
      }
    }
    const xml = await fetchText(`https://news.google.com/rss/search?${qs({ q: `${query} when:7d`, hl: 'en-IN', gl: 'IN', ceid: 'IN:en' })}`, { ttlMs: 30 * 60_000, headers: { Accept: 'application/rss+xml' } });
    const results = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, num).map(([, it]) => ({
      title: decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
      url: decode(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ''),
      snippet: decode(it.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? ''),
      date: it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? null,
    }));
    return { provider: 'Google News India RSS', results };
  }

  async shopping(query: string, num = 8) {
    if (!this.serpConfigured) {
      return { error: 'Product price search needs SERPAPI_KEY.', searchUrl: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}` };
    }
    const d = await this.serp({ engine: 'google_shopping', q: query });
    const results = (d.shopping_results ?? []).slice(0, num).map((r: any) => ({
      title: r.title, price: r.extracted_price ?? null, priceText: r.price ?? null, store: r.source ?? null,
      url: r.product_link ?? r.link ?? null, rating: r.rating ?? null,
    }));
    return { provider: 'Google Shopping via SerpAPI', results };
  }

  /** Cheapest price for a product query (price watch). */
  async lowestPrice(query: string) {
    const r = await this.shopping(query, 20);
    if (!('results' in r)) return null;
    const priced = (r.results as any[]).filter((x) => typeof x.price === 'number').sort((a, b) => a.price - b.price);
    return priced[0] ?? null;
  }

  async flights(o: { from: string; to: string; date: string; returnDate?: string; adults?: number; travelClass?: 'economy' | 'premium' | 'business' | 'first' }) {
    const link = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${o.from} to ${o.to} on ${o.date}${o.returnDate ? ` returning ${o.returnDate}` : ''}`)}`;
    if (!this.serpConfigured) return { error: 'Live flight search needs SERPAPI_KEY.', googleFlightsUrl: link };
    const d = await this.serp({
      engine: 'google_flights', departure_id: o.from.toUpperCase(), arrival_id: o.to.toUpperCase(), outbound_date: o.date,
      return_date: o.returnDate, type: o.returnDate ? 1 : 2, adults: o.adults ?? 1, currency: 'INR',
      travel_class: { economy: 1, premium: 2, business: 3, first: 4 }[o.travelClass ?? 'economy'],
    });
    const options = [...(d.best_flights ?? []), ...(d.other_flights ?? [])].slice(0, 8).map((f: any) => ({
      price: f.price ?? null,
      totalDurationMin: f.total_duration ?? null,
      stops: Math.max(0, (f.flights?.length ?? 1) - 1),
      legs: (f.flights ?? []).map((l: any) => ({
        airline: l.airline, flight: l.flight_number, from: l.departure_airport?.id, departs: l.departure_airport?.time,
        to: l.arrival_airport?.id, arrives: l.arrival_airport?.time, durationMin: l.duration,
      })),
    }));
    return { provider: 'Google Flights via SerpAPI', currency: 'INR', priceInsights: d.price_insights ?? null, options, googleFlightsUrl: link };
  }

  async hotels(o: { location: string; checkIn: string; checkOut: string; adults?: number; maxPrice?: number }) {
    const link = `https://www.google.com/travel/hotels?q=${encodeURIComponent(`hotels in ${o.location}`)}`;
    if (!this.serpConfigured) return { error: 'Live hotel search needs SERPAPI_KEY.', googleHotelsUrl: link };
    const d = await this.serp({
      engine: 'google_hotels', q: o.location, check_in_date: o.checkIn, check_out_date: o.checkOut, adults: o.adults ?? 2,
      currency: 'INR', max_price: o.maxPrice,
    });
    const properties = (d.properties ?? []).slice(0, 10).map((p: any) => ({
      name: p.name, pricePerNight: p.rate_per_night?.extracted_lowest ?? null, total: p.total_rate?.extracted_lowest ?? null,
      rating: p.overall_rating ?? null, reviews: p.reviews ?? null, type: p.type ?? null, url: p.link ?? null,
      amenities: (p.amenities ?? []).slice(0, 6),
    }));
    return { provider: 'Google Hotels via SerpAPI', currency: 'INR', properties, googleHotelsUrl: link };
  }
}
