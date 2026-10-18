import type { CalendarService } from '../../google/calendar.service.js';
import type { GmailService } from '../../google/gmail.service.js';
import type { SheetsService } from '../../google/sheets.service.js';
import type { N8nChannelsService } from '../../integrations/n8n-channels.service.js';
import type { OpenAIMediaService } from '../../integrations/openai-media.service.js';
import type { SearchService } from '../../integrations/search.service.js';
import type { WeatherService } from '../../integrations/weather.service.js';
import type { WebReaderService } from '../../integrations/web-reader.service.js';
import type { YatraService } from '../../integrations/yatra.service.js';
import type { KnowledgeService } from '../../knowledge/knowledge.service.js';
import type { RecordsService } from '../../records/records.service.js';

export interface Services {
  gmail: GmailService;
  calendar: CalendarService;
  sheets: SheetsService;
  search: SearchService;
  web: WebReaderService;
  weather: WeatherService;
  yatra: YatraService;
  media: OpenAIMediaService;
  records: RecordsService;
  channels: N8nChannelsService;
  knowledge: KnowledgeService;
}

const MAX = 7000;
export const out = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > MAX ? `${s.slice(0, MAX)}…(truncated)` : s;
};

/** Tool body wrapper: errors become data for the LLM instead of crashing the run. */
export const safe = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try {
    return out(await fn(a));
  } catch (e) {
    return out({ error: (e as Error).message });
  }
};
