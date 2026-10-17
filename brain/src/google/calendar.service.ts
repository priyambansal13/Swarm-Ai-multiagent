import { Injectable } from '@nestjs/common';
import { calendar_v3, google } from 'googleapis';
import { tzOffset } from '../common/time.js';
import { GoogleAuthService } from './google-auth.service.js';

export interface EventSummary {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  attendees: string[];
  meetLink: string | null;
  htmlLink: string | null;
}

/** Google Calendar (primary calendar) for one user. */
@Injectable()
export class CalendarService {
  constructor(private readonly auth: GoogleAuthService) {}

  private async cal(userId: string) {
    return google.calendar({ version: 'v3', auth: await this.auth.requireClient(userId) });
  }

  private summarise(e: calendar_v3.Schema$Event): EventSummary {
    return {
      id: e.id!,
      title: e.summary ?? '(no title)',
      start: e.start?.dateTime ?? e.start?.date ?? '',
      end: e.end?.dateTime ?? e.end?.date ?? '',
      allDay: !e.start?.dateTime,
      location: e.location ?? null,
      attendees: (e.attendees ?? []).filter((a) => !a.self).map((a) => a.email!).filter(Boolean),
      meetLink: e.hangoutLink ?? null,
      htmlLink: e.htmlLink ?? null,
    };
  }

  async list(userId: string, timeMin: string, timeMax: string, q?: string, max = 25): Promise<EventSummary[]> {
    const c = await this.cal(userId);
    const { data } = await c.events.list({ calendarId: 'primary', timeMin, timeMax, q, singleEvents: true, orderBy: 'startTime', maxResults: max });
    return (data.items ?? []).filter((e) => e.status !== 'cancelled').map((e) => this.summarise(e));
  }

  /** Free slots of `durationMin` between `from` and `to`, within working hours (local time). */
  async freeSlots(userId: string, from: string, to: string, durationMin: number, tz: string, dayStart = 9, dayEnd = 19, max = 8) {
    const c = await this.cal(userId);
    const { data } = await c.freebusy.query({ requestBody: { timeMin: from, timeMax: to, timeZone: tz, items: [{ id: 'primary' }] } });
    const busy = (data.calendars?.primary?.busy ?? []).map((b) => [new Date(b.start!).getTime(), new Date(b.end!).getTime()] as const);
    const slots: { start: string; end: string }[] = [];
    const step = 15 * 60_000;
    const dur = durationMin * 60_000;
    for (let t = Math.ceil(new Date(from).getTime() / step) * step; t + dur <= new Date(to).getTime() && slots.length < max; t += step) {
      const local = new Date(t).toLocaleString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' });
      const [, hh, mm] = local.match(/(\d{2}):(\d{2})/) ?? [];
      const mins = Number(hh) * 60 + Number(mm);
      if (/Sat|Sun/.test(local) || mins < dayStart * 60 || mins + durationMin > dayEnd * 60) continue;
      if (busy.some(([s, e]) => t < e && t + dur > s)) continue;
      slots.push({ start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() });
      t += dur - step; // don't offer overlapping slots
    }
    return { timezone: tz, offset: tzOffset(tz), slots };
  }

  async create(userId: string, o: { title: string; start: string; end: string; tz: string; attendees?: string[]; location?: string; description?: string; addMeet?: boolean }) {
    const c = await this.cal(userId);
    const { data } = await c.events.insert({
      calendarId: 'primary',
      sendUpdates: o.attendees?.length ? 'all' : 'none',
      conferenceDataVersion: o.addMeet ? 1 : 0,
      requestBody: {
        summary: o.title,
        location: o.location,
        description: o.description,
        start: { dateTime: o.start, timeZone: o.tz },
        end: { dateTime: o.end, timeZone: o.tz },
        attendees: o.attendees?.map((email) => ({ email })),
        ...(o.addMeet ? { conferenceData: { createRequest: { requestId: `swarm-${Date.now()}` } } } : {}),
      },
    });
    return this.summarise(data);
  }

  async update(userId: string, eventId: string, patch: { title?: string; start?: string; end?: string; tz: string; location?: string; description?: string }) {
    const c = await this.cal(userId);
    const { data } = await c.events.patch({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
      requestBody: {
        ...(patch.title ? { summary: patch.title } : {}),
        ...(patch.location ? { location: patch.location } : {}),
        ...(patch.description ? { description: patch.description } : {}),
        ...(patch.start ? { start: { dateTime: patch.start, timeZone: patch.tz } } : {}),
        ...(patch.end ? { end: { dateTime: patch.end, timeZone: patch.tz } } : {}),
      },
    });
    return this.summarise(data);
  }

  async remove(userId: string, eventId: string) {
    const c = await this.cal(userId);
    await c.events.delete({ calendarId: 'primary', eventId, sendUpdates: 'all' });
    return { deleted: eventId };
  }
}
