import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Yatra AI (our LangGraph travel planner) as a tool: full India trip plans. */
@Injectable()
export class YatraService {
  constructor(private readonly config: ConfigService) {}

  get configured() {
    return !!this.config.get('YATRA_API_URL');
  }

  async plan(request: string, signal?: AbortSignal) {
    if (!this.configured) return { error: 'Yatra AI is not configured (YATRA_API_URL).' };
    const res = await fetch(`${this.config.get('YATRA_API_URL')}/api/trips/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: request }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(240_000)]) : AbortSignal.timeout(240_000),
    });
    if (!res.ok) return { error: `Yatra AI returned HTTP ${res.status}` };
    const d: any = await res.json();
    const p = d.trip?.plan;
    const web = this.config.get('YATRA_WEB_URL') || 'http://localhost:3100';
    return {
      title: p?.title, summary: p?.summary, totalINR: p?.budget?.totalINR, perPersonINR: p?.budget?.perPersonINR,
      days: p?.itinerary?.days?.map((x: any) => `Day ${x.day} (${x.date}): ${x.theme}`) ?? [],
      stay: p?.accommodation?.recommendedOption ?? null,
      transport: p?.transport?.recommendation ?? null,
      planUrl: d.tripId ? `${web}/trips/${d.tripId}` : null,
    };
  }
}
