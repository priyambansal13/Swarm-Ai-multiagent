import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, CurrentUser, RoleGuard } from '../auth/guards.js';
import { parse } from '../common/validate.js';
import { ADMIN_ROLES, STAFF_ROLES, type ConversationStatus, type User } from '../db/entities.js';
import { DeskService } from './desk.service.js';

const Text = z.object({ text: z.string().trim().min(1).max(4000) });

@ApiTags('Customer desk (handoff inbox)')
@ApiBearerAuth()
@UseGuards(AuthGuard, RoleGuard(...STAFF_ROLES))
@Controller('desk')
export class DeskController {
  constructor(private readonly desk: DeskService) {}

  @Get('conversations')
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'waiting', 'human', 'bot', 'closed'] })
  @ApiOperation({ summary: 'Customer conversations (waiting for a person first)' })
  list(@CurrentUser() user: User, @Query('status') status?: ConversationStatus | 'open') {
    return this.desk.list(user.orgId, status || undefined);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Conversations and unread messages per status (for badges)' })
  counts(@CurrentUser() user: User) {
    return this.desk.counts(user.orgId);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'One conversation with its messages (marks it read)' })
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.desk.get(user.orgId, id);
  }

  @Post('conversations/:id/reply')
  @ApiBody({ schema: { example: { text: 'Hi, this is Asha from Acme — your refund is on its way.' } } })
  @ApiOperation({ summary: "Reply on the customer's WhatsApp/Telegram thread (takes over from the bot)" })
  reply(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.desk.reply(user, id, parse(Text, body).text);
  }

  @Post('conversations/:id/assign')
  @ApiBody({ schema: { example: { userId: null } } })
  @ApiOperation({ summary: 'Take over (no userId) or assign to a team member' })
  assign(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.desk.assign(user, id, parse(z.object({ userId: z.string().uuid().nullish() }), body ?? {}).userId ?? null);
  }

  @Post('conversations/:id/release')
  @ApiBody({ schema: { example: { message: 'You are back with our assistant — ask anything!' } } })
  @ApiOperation({ summary: 'Hand the conversation back to the bot' })
  release(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.desk.release(user, id, parse(z.object({ message: z.string().max(4000).nullish() }), body ?? {}).message);
  }

  @Post('conversations/:id/close')
  @ApiOperation({ summary: 'Close the conversation (it reopens with the bot when the customer writes again)' })
  close(@CurrentUser() user: User, @Param('id') id: string) {
    return this.desk.close(user, id);
  }

  // ------------------------------------------------------------------ simulator
  @Post('simulate')
  @UseGuards(RoleGuard(...ADMIN_ROLES))
  @ApiBody({ schema: { example: { text: 'What are your opening hours?' } } })
  @ApiOperation({ summary: 'Admin: talk to your desk bot as a customer would (no WhatsApp needed)' })
  simulate(@CurrentUser() user: User, @Body() body: unknown) {
    return this.desk.simulate(user, parse(Text, body).text);
  }

  @Get('simulate')
  @UseGuards(RoleGuard(...ADMIN_ROLES))
  @ApiOperation({ summary: 'Admin: the test conversation' })
  simulation(@CurrentUser() user: User) {
    return this.desk.simulation(user);
  }

  @Delete('simulate')
  @UseGuards(RoleGuard(...ADMIN_ROLES))
  @ApiOperation({ summary: 'Admin: start the test conversation again' })
  reset(@CurrentUser() user: User) {
    return this.desk.resetSimulation(user);
  }
}
