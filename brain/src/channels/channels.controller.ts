import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, CurrentUser, N8nGuard } from '../auth/guards.js';
import { parse } from '../common/validate.js';
import type { User } from '../db/entities.js';
import { ChannelsService, InboundSchema } from './channels.service.js';

@ApiTags('Channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post('inbound')
  @UseGuards(N8nGuard)
  @ApiHeader({ name: 'X-Swarm-Key', description: 'Shared secret (SWARM_N8N_TOKEN)' })
  @ApiOperation({ summary: '[n8n] Incoming Telegram / WhatsApp message (text, voice, photo, document) → reply (+ optional voice MP3)' })
  @ApiBody({ schema: { example: { channel: 'telegram', externalId: '123456789', displayName: 'Priya', text: 'What is on my calendar today?' } } })
  inbound(@Body() body: unknown) {
    return this.channels.inbound(parse(InboundSchema, body));
  }

  @Post('link-code')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'One-time code to link your Telegram chat or WhatsApp number' })
  @ApiBody({ schema: { example: { channel: 'telegram' } } })
  linkCode(@CurrentUser() user: User, @Body() body: unknown) {
    return this.channels.createLinkCode(user, parse(z.object({ channel: z.enum(['telegram', 'whatsapp']) }), body).channel);
  }

  @Get('links')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Linked channels' })
  links(@CurrentUser() user: User) {
    return this.channels.listLinks(user);
  }

  @Delete(':channel')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Unlink Telegram or WhatsApp' })
  unlink(@CurrentUser() user: User, @Param('channel') channel: 'telegram' | 'whatsapp') {
    return this.channels.unlink(user, channel);
  }
}
