import { Injectable } from '@nestjs/common';
import { fetchJson, qs } from '../common/http.js';
import { ImdWarningsService } from './imd-warnings.service.js';

const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
  55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers',
  81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Severe thunderstorm',
};

/** Weather anywhere (Open-Meteo, keyless) + official IMD district warnings for places in India. */
@Injectable()
export class WeatherService {
  constructor(private readonly imd: ImdWarningsService) {}

  async geocode(place: string) {
    const d = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${qs({ name: place.split(',')[0].trim(), count: 10, language: 'en' })}`, { ttlMs: 24 * 3600_000 });
    const hits: any[] = d?.results ?? [];
    // Country/state hints come only from text after the city ("Kochi, Kerala", "Paris, France").
    // Without a hint prefer an Indian match: "Kochi" → Kochi, Kerala rather than Kōchi, Japan.
    const extra = place.split(',').slice(1).join(',').toLowerCase().trim();
    const r =
      (extra && hits.find((x) => (x.country && extra.includes(x.country.toLowerCase())) || (x.admin1 && extra.includes(x.admin1.toLowerCase())))) ||
      hits.find((x) => x.country_code === 'IN') ||
      hits[0];
    return r ? { name: r.name, region: r.admin1 ?? null, country: r.country, countryCode: r.country_code, lat: r.latitude, lon: r.longitude, timezone: r.timezone } : null;
  }

  async forecast(place: string, days = 3) {
    const g = await this.geocode(place);
    if (!g) return { error: `Could not find "${place}"` };
    const d = await fetchJson(`https://api.open-meteo.com/v1/forecast?${qs({
      latitude: g.lat, longitude: g.lon, timezone: g.timezone ?? 'auto', forecast_days: Math.min(Math.max(days, 1), 14),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code,uv_index_max',
    })}`, { ttlMs: 20 * 60_000 });
    const daily = (d.daily?.time ?? []).map((t: string, i: number) => ({
      date: t, maxC: d.daily.temperature_2m_max[i], minC: d.daily.temperature_2m_min[i], rainChancePct: d.daily.precipitation_probability_max?.[i] ?? null,
      rainMm: d.daily.precipitation_sum?.[i] ?? 0, uvMax: d.daily.uv_index_max?.[i] ?? null, condition: WMO[d.daily.weather_code[i]] ?? `code ${d.daily.weather_code[i]}`,
    }));
    const imd = g.countryCode === 'IN' ? await this.imd.forLocation(g.lat, g.lon) : null;
    return {
      place: g,
      current: d.current ? { tempC: d.current.temperature_2m, feelsLikeC: d.current.apparent_temperature, humidity: d.current.relative_humidity_2m, windKmh: d.current.wind_speed_10m, condition: WMO[d.current.weather_code] ?? '' } : null,
      daily,
      imdWarnings: imd ? { district: imd.district, issuedOn: imd.issuedOn, days: imd.days.filter((x) => x.level !== 'green') } : null,
      source: 'Open-Meteo' + (imd ? ' + IMD district warnings' : ''),
    };
  }
}
