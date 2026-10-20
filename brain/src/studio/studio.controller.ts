import { BadGatewayException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, CurrentUser } from '../auth/guards.js';
import { parse } from '../common/validate.js';
import type { User } from '../db/entities.js';
import { OrgService } from '../orgs/org.service.js';
import { DURATIONS, PLATFORMS, ResearchInputSchema, ScriptInputSchema, scriptToMarkdown, scriptToTeleprompter, StudioService, TONES } from './studio.service.js';

/** Studio tab (StoryForge): topic → real-time research → short-form video script. */
@ApiTags('Studio (StoryForge)')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('studio')
export class StudioController {
  constructor(private readonly studio: StudioService, private readonly orgs: OrgService) {}

  /** The organisation's own OpenAI key and fast model, when it has them. */
  private async llm(user: User) {
    const org = await this.orgs.get(user.orgId);
    return { apiKey: this.orgs.apiKey(org), model: org.settings.modelFast };
  }

  @Get('options')
  @ApiOperation({ summary: 'Platforms, lengths, tones and the active search provider' })
  options() {
    return { platforms: PLATFORMS, durations: DURATIONS, tones: TONES, searchProvider: this.studio.searchProvider };
  }

  @Post('research')
  @ApiOperation({ summary: 'Real-time research: latest sources + LLM summary, key facts and video angles' })
  @ApiBody({ schema: { example: { topic: 'ISRO Gaganyaan mission update' } } })
  async research(@CurrentUser() user: User, @Body() body: unknown) {
    const { topic } = parse(ResearchInputSchema, body);
    return this.wrap(async () => this.studio.research(topic, await this.llm(user)));
  }

  @Post('script')
  @ApiOperation({ summary: 'Short-form video script (Shorts / Reels); runs research first when none is given' })
  @ApiBody({ schema: { example: { topic: 'ISRO Gaganyaan mission update', platform: 'shorts', durationSec: 60, tone: 'energetic', language: 'English' } } })
  async script(@CurrentUser() user: User, @Body() body: unknown) {
    const input = parse(ScriptInputSchema, body);
    return this.wrap(async () => {
      const script = await this.studio.script(input, await this.llm(user));
      return { script, markdown: scriptToMarkdown(script), teleprompter: scriptToTeleprompter(script) };
    });
  }

  /** Search/LLM failures become a readable 502 instead of a generic 500. */
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw new BadGatewayException((e as Error).message);
    }
  }
}
