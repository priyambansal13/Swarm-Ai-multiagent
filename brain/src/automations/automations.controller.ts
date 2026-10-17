import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, CurrentUser, N8nGuard } from '../auth/guards.js';
import { parse } from '../common/validate.js';
import type { User } from '../db/entities.js';
import { RecordsService } from '../records/records.service.js';
import { AutomationsService } from './automations.service.js';

const JOBS = ['brief', 'triage', 'meeting_prep', 'followups', 'price_watch', 'weekly_review'] as const;

@ApiTags('Automations')
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService, private readonly records: RecordsService) {}

  @Post('tick')
  @UseGuards(N8nGuard)
  @ApiHeader({ name: 'X-Swarm-Key', description: 'Shared secret (SWARM_N8N_TOKEN)' })
  @ApiOperation({ summary: '[n8n scheduler, every minute] Run due jobs and return messages to deliver' })
  tick() {
    return this.automations.tick();
  }

  @Post('ack')
  @UseGuards(N8nGuard)
  @ApiHeader({ name: 'X-Swarm-Key', description: 'Shared secret (SWARM_N8N_TOKEN)' })
  @ApiOperation({ summary: '[n8n] Report delivered / failed outbox messages' })
  @ApiBody({ schema: { example: { sent: ['uuid-1'], failed: [{ id: 'uuid-2', error: 'chat not found' }] } } })
  async ack(@Body() body: unknown) {
    const b = parse(z.object({ sent: z.array(z.string()).default([]), failed: z.array(z.object({ id: z.string(), error: z.string() })).default([]) }), body);
    await this.records.ackOutbox(b.sent, b.failed);
    return { ok: true };
  }

  @Post('run/:job')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @ApiParam({ name: 'job', enum: JOBS })
  @ApiOperation({ summary: 'Run one of your automations now (e.g. get the morning brief immediately)' })
  run(@CurrentUser() user: User, @Param('job') job: (typeof JOBS)[number]) {
    return this.automations.runNow(user, job);
  }
}
