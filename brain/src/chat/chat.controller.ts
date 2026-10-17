import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/guards.js';
import { parse } from '../common/validate.js';
import type { User } from '../db/entities.js';
import { ChatService } from './chat.service.js';

const Attachment = z.object({ name: z.string().max(200), mime: z.string().max(100), data: z.string().max(14_000_000) });
const ChatSchema = z.object({ threadId: z.string().max(80).optional(), text: z.string().trim().max(4000).default(''), attachments: z.array(Attachment).max(4).optional() });
const ConfirmSchema = z.object({ approved: z.boolean(), actionIds: z.array(z.string()).optional() });

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Send a message and wait for the reply (synchronous; the web app streams via /api/agui)' })
  @ApiBody({ schema: { example: { text: 'Remind me in 30 minutes to call Mom', threadId: null } } })
  async send(@CurrentUser() user: User, @Body() body: unknown) {
    const b = parse(ChatSchema, body);
    const { thread, result } = await this.chat.send(user, { threadId: b.threadId, channel: 'web', text: b.text || 'Please look at the attachment.', attachments: b.attachments });
    return { threadId: thread.id, reply: result.reply, pending: thread.pending };
  }

  @Get('threads')
  @ApiOperation({ summary: 'Your conversations (web, telegram, whatsapp)' })
  threads(@CurrentUser() user: User) {
    return this.chat.listThreads(user);
  }

  @Get('threads/:id')
  @ApiOperation({ summary: 'Conversation with its messages and any pending confirmation' })
  thread(@CurrentUser() user: User, @Param('id') id: string) {
    return this.chat.getThread(user, id);
  }

  @Delete('threads/:id')
  @ApiOperation({ summary: 'Delete a conversation' })
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.chat.deleteThread(user, id);
  }

  @Post('threads/:id/cancel')
  @ApiOperation({ summary: 'Stop the agents working on this conversation' })
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return { cancelled: this.chat.cancel(user, id) };
  }

  @Post('threads/:id/confirm')
  @ApiOperation({ summary: 'Approve or reject pending actions (send email, calendar changes…)' })
  @ApiBody({ schema: { example: { approved: true, actionIds: ['a1b2c3d4'] } } })
  async confirm(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(ConfirmSchema, body);
    const { thread, result } = await this.chat.confirm(user, id, b);
    return { threadId: thread.id, reply: result.reply, pending: thread.pending };
  }
}
