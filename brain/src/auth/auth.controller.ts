import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from '../common/validate.js';
import { ChannelLink, User } from '../db/entities.js';
import { GoogleAuthService } from '../google/google-auth.service.js';
import { OrgService, publicOrg } from '../orgs/org.service.js';
import { AuthService, LoginSchema, publicUser, SettingsSchema, SignupSchema } from './auth.service.js';
import { AuthGuard, CurrentUser } from './guards.js';

@ApiTags('Auth')
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleAuthService,
    private readonly orgs: OrgService,
    @InjectRepository(ChannelLink) private readonly links: Repository<ChannelLink>,
  ) {}

  @Post('auth/signup')
  @ApiOperation({ summary: 'Create an account' })
  @ApiBody({ schema: { example: { email: 'priya@example.com', password: 'a-long-password', name: 'Priya', timezone: 'Asia/Kolkata' } } })
  signup(@Body() body: unknown) {
    return this.auth.signup(parse(SignupSchema, body));
  }

  @Post('auth/login')
  @ApiOperation({ summary: 'Sign in — returns a bearer token' })
  @ApiBody({ schema: { example: { email: 'priya@example.com', password: 'a-long-password' } } })
  login(@Body() body: unknown) {
    return this.auth.login(parse(LoginSchema, body));
  }

  @Get('auth/invite/:code')
  @ApiOperation({ summary: 'Organisation and role of an invitation (for the sign-up page)' })
  async invite(@Param('code') code: string) {
    const { inv, org } = await this.orgs.invite(code);
    return { orgName: org.name, role: inv.role, email: inv.email };
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Current user, settings and connected integrations' })
  async me(@CurrentUser() user: User) {
    const [google, links, org] = await Promise.all([this.google.account(user.id), this.links.find({ where: { userId: user.id } }), this.orgs.get(user.orgId)]);
    const o = publicOrg(org);
    return {
      user: publicUser(user),
      org: { id: o.id, name: o.name, slug: o.slug, assistantName: o.settings.assistantName, accentColor: o.settings.accentColor, deskEnabled: o.settings.desk.enabled },
      integrations: {
        googleAvailable: this.google.configured,
        google: google ? { email: google.email, spreadsheetUrl: google.spreadsheetUrl, connectedAt: google.connectedAt } : null,
        telegram: links.find((l) => l.channel === 'telegram') ?? null,
        whatsapp: links.find((l) => l.channel === 'whatsapp') ?? null,
      },
    };
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Update name, timezone and assistant settings (brief time, notify channel, voice replies, news topics, home city…)' })
  update(@CurrentUser() user: User, @Body() body: unknown) {
    return this.auth.updateSettings(user, parse(SettingsSchema, body));
  }
}
