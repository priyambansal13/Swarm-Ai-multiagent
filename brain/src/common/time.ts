/** Time helpers that respect each user's IANA timezone (default Asia/Kolkata). */
export const DEFAULT_TZ = 'Asia/Kolkata';

/** "2026-10-17 15:42 (Sat), Asia/Kolkata" — given to agents as "now". */
export function nowInTz(tz = DEFAULT_TZ, d = new Date()): string {
  const s = d.toLocaleString('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  return `${s} (${tz})`;
}

/** Parts of a date in a timezone. */
export function partsInTz(d: Date, tz = DEFAULT_TZ) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday as string };
}

/** Offset of a timezone at a given instant, e.g. "+05:30". */
export function tzOffset(tz = DEFAULT_TZ, d = new Date()): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = name.replace('GMT', '');
  return m === '' ? '+00:00' : m;
}

/** Start/end of "today" in the user's timezone as ISO strings. */
export function dayRange(tz = DEFAULT_TZ, offsetDays = 0, d = new Date()) {
  const { date } = partsInTz(new Date(d.getTime() + offsetDays * 86_400_000), tz);
  const off = tzOffset(tz, d);
  return { start: new Date(`${date}T00:00:00${off}`).toISOString(), end: new Date(`${date}T23:59:59${off}`).toISOString(), date };
}

export const fmtTime = (iso: string, tz = DEFAULT_TZ) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
