import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { AGENTS } from '../agents/agents.js';
import { GoogleAuthService } from '../google/google-auth.service.js';
import { N8nChannelsService } from '../integrations/n8n-channels.service.js';
import { SearchService } from '../integrations/search.service.js';
import { YatraService } from '../integrations/yatra.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService, private readonly db: DataSource, private readonly google: GoogleAuthService,
    private readonly search: SearchService, private readonly yatra: YatraService, private readonly n8n: N8nChannelsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Service status and configured integrations' })
  async health() {
    let database = 'up';
    try {
      await this.db.query('SELECT 1');
    } catch {
      database = 'down';
    }
    let n8nMcp: string;
    try {
      n8nMcp = this.n8n.configured ? `connected (${(await this.n8n.listTools()).join(', ') || 'no tools'})` : 'not configured';
    } catch (e) {
      n8nMcp = `unreachable: ${(e as Error).message.slice(0, 120)}`;
    }
    return {
      status: database === 'up' && this.config.get('OPENAI_API_KEY') ? 'ok' : 'degraded',
      database,
      llm: { model: this.config.get('OPENAI_MODEL') || 'gpt-4.1', fastModel: this.config.get('OPENAI_MODEL_FAST') || 'gpt-4.1-mini', configured: !!this.config.get('OPENAI_API_KEY') },
      agents: AGENTS.map((a) => a.id),
      integrations: {
        google: this.google.configured ? 'OAuth configured (per-user connect)' : 'not configured (GOOGLE_CLIENT_ID/SECRET)',
        search: this.search.serpConfigured ? 'SerpAPI' : 'keyless fallback (Wikipedia + Google News RSS); flights/hotels/shopping need SERPAPI_KEY',
        yatra: this.yatra.configured ? this.config.get('YATRA_API_URL') : 'not configured',
        n8nMcp,
        weather: 'Open-Meteo + IMD district warnings',
      },
    };
  }
}
