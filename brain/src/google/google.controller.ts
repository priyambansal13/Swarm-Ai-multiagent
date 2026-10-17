import { Controller, Get, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/guards.js';
import type { User } from '../db/entities.js';
import { GoogleAuthService } from './google-auth.service.js';

@ApiTags('Google')
@Controller('google')
export class GoogleController {
  private readonly log = new Logger(GoogleController.name);
  constructor(private readonly google: GoogleAuthService, private readonly config: ConfigService) {}

  private web() {
    return this.config.get<string>('WEB_URL') ?? 'http://localhost:3200';
  }

  @Get('connect')
  @UseGuards(AuthGuard)
  @ApiQuery({ name: 'token', description: 'Bearer token (browser redirects cannot send headers)' })
  @ApiOperation({ summary: 'Start Google OAuth (Gmail, Calendar, Sheets) — open in the browser' })
  connect(@CurrentUser() user: User, @Res() res: Response) {
    res.redirect(this.google.authUrl(user.id));
  }

  @Get('callback')
  @ApiOperation({ summary: 'Google OAuth redirect URI' })
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string | undefined, @Res() res: Response) {
    if (error) return res.redirect(`${this.web()}/settings?google=${encodeURIComponent(error)}`);
    try {
      const { problems } = await this.google.handleCallback(code, state);
      res.redirect(`${this.web()}/settings?google=${problems.length ? `partial&detail=${encodeURIComponent(problems.join(' · '))}` : 'connected'}`);
    } catch (e) {
      this.log.warn(`Google callback failed: ${(e as Error).message}`);
      res.redirect(`${this.web()}/settings?google=${encodeURIComponent((e as Error).message)}`);
    }
  }

  @Post('disconnect')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Disconnect Google and revoke access' })
  async disconnect(@CurrentUser() user: User) {
    await this.google.disconnect(user.id);
    return { disconnected: true };
  }
}
