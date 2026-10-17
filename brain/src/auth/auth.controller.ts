import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from '../common/validate.js';
import { ChannelLink, User } from '../db/entities.js';
import { GoogleAuthService } from '../google/google-auth.service.js';
import { AuthService, LoginSchema, publicUser, SettingsSchema, SignupSchema } from './auth.service.js';
import { AuthGuard, CurrentUser } from './guards.js';

@ApiTags('Auth')
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleAuthService,
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

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Current user, settings and connected integrations' })
  async me(@CurrentUser() user: User) {
    const [google, links] = await Promise.all([this.google.account(user.id), this.links.find({ where: { userId: user.id } })]);
    return {
      user: publicUser(user),
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
