import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { google } from 'googleapis';
import { Repository } from 'typeorm';
import { decrypt, encrypt, signToken, verifyToken } from '../common/crypto.js';
import { GoogleAccount } from '../db/entities.js';

/** Gmail read/compose/send/archive, Calendar read/write, and files this app creates (the user's SwarmAI sheet). */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
];

const SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.modify': 'Gmail',
  'https://www.googleapis.com/auth/calendar': 'Calendar',
  'https://www.googleapis.com/auth/drive.file': 'Sheets/Drive',
};

export const SHEET_TABS: Record<string, string[]> = {
  Tasks: ['Created', 'Task', 'Due', 'Priority', 'Status', 'Source'],
  Expenses: ['Date', 'Amount', 'Currency', 'Category', 'Note', 'Source'],
  Contacts: ['Name', 'Email', 'Phone', 'Notes'],
  TravelLog: ['Logged', 'Trip', 'Dates', 'Details', 'Est. cost (INR)', 'Links'],
  EmailDigest: ['Received', 'From', 'Subject', 'Summary', 'Category', 'Urgency'],
  ActivityLog: ['Timestamp', 'Channel', 'Agent', 'Action', 'Detail'],
};

type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

/** Per-user Google OAuth: each user connects their own account; refresh tokens are encrypted at rest. */
@Injectable()
export class GoogleAuthService {
  private readonly log = new Logger(GoogleAuthService.name);
  private readonly clients = new Map<string, OAuthClient>();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GoogleAccount) private readonly accounts: Repository<GoogleAccount>,
  ) {}

  get configured() {
    return !!(this.config.get('GOOGLE_CLIENT_ID') && this.config.get('GOOGLE_CLIENT_SECRET'));
  }

  private redirectUri() {
    return this.config.get<string>('GOOGLE_REDIRECT_URI') || `${this.config.get('PUBLIC_API_URL') || 'http://localhost:4200'}/api/google/callback`;
  }

  private newClient(): OAuthClient {
    return new google.auth.OAuth2(this.config.get('GOOGLE_CLIENT_ID'), this.config.get('GOOGLE_CLIENT_SECRET'), this.redirectUri());
  }

  authUrl(userId: string): string {
    if (!this.configured) throw new BadRequestException('Google OAuth is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
    return this.newClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_SCOPES,
      state: signToken({ sub: userId, purpose: 'google' }, 600),
    });
  }

  /** OAuth callback: store the refresh token and create the user's SwarmAI workbook. Returns problems to show the user. */
  async handleCallback(code: string, state: string): Promise<{ account: GoogleAccount; problems: string[] }> {
    const payload = verifyToken<{ sub: string; purpose: string }>(state);
    if (!payload || payload.purpose !== 'google') throw new BadRequestException('Invalid or expired OAuth state');
    const client = this.newClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new BadRequestException('Google did not return a refresh token — remove the app at myaccount.google.com/permissions and connect again.');
    client.setCredentials(tokens);
    const info = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    const existing = await this.accounts.findOne({ where: { userId: payload.sub } });
    const account = await this.accounts.save(this.accounts.create({
      userId: payload.sub,
      email: info.data.email ?? 'unknown',
      refreshTokenEnc: encrypt(tokens.refresh_token),
      scopes: tokens.scope ?? GOOGLE_SCOPES.join(' '),
      spreadsheetId: existing?.spreadsheetId ?? null,
      spreadsheetUrl: existing?.spreadsheetUrl ?? null,
    }));
    this.clients.delete(payload.sub);
    const problems: string[] = [];
    const granted = account.scopes.split(' ');
    const missing = GOOGLE_SCOPES.filter((sc) => sc.startsWith('https://') && !granted.includes(sc)).map((sc) => SCOPE_LABELS[sc] ?? sc);
    if (missing.length) problems.push(`${missing.join(', ')} permission not granted — disconnect, connect again and tick every box`);
    if (!account.spreadsheetId) {
      try {
        const sheet = await google.sheets({ version: 'v4', auth: client }).spreadsheets.create({
          requestBody: {
            properties: { title: `SwarmAI — ${account.email}` },
            sheets: Object.keys(SHEET_TABS).map((title) => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
          },
        });
        account.spreadsheetId = sheet.data.spreadsheetId ?? null;
        account.spreadsheetUrl = sheet.data.spreadsheetUrl ?? null;
        await google.sheets({ version: 'v4', auth: client }).spreadsheets.values.batchUpdate({
          spreadsheetId: account.spreadsheetId!,
          requestBody: {
            valueInputOption: 'RAW',
            data: Object.entries(SHEET_TABS).map(([tab, headers]) => ({ range: `${tab}!A1`, values: [headers] })),
          },
        });
        await this.accounts.save(account);
      } catch (e) {
        const msg = (e as Error).message;
        this.log.warn(`Could not create workbook for ${account.email}: ${msg}`);
        problems.push(/has not been used|is disabled/.test(msg)
          ? 'Google Sheets API is disabled in your Google Cloud project — enable it, then disconnect and connect again'
          : `Could not create your SwarmAI sheet: ${msg.slice(0, 160)}`);
      }
    }
    return { account, problems };
  }

  account(userId: string) {
    return this.accounts.findOne({ where: { userId } });
  }

  async disconnect(userId: string) {
    const acc = await this.account(userId);
    if (acc) {
      try {
        await this.newClient().revokeToken(decrypt(acc.refreshTokenEnc));
      } catch {
        /* already revoked */
      }
      await this.accounts.delete({ userId });
    }
    this.clients.delete(userId);
  }

  /** Authorised OAuth client for a user, or null when Google isn't connected. */
  async clientFor(userId: string): Promise<OAuthClient | null> {
    const cached = this.clients.get(userId);
    if (cached) return cached;
    const acc = await this.account(userId);
    if (!acc || !this.configured) return null;
    const client = this.newClient();
    client.setCredentials({ refresh_token: decrypt(acc.refreshTokenEnc) });
    this.clients.set(userId, client);
    return client;
  }

  async requireClient(userId: string): Promise<OAuthClient> {
    const c = await this.clientFor(userId);
    if (!c) throw new Error('Google is not connected for this user. Ask them to connect Google in Settings.');
    return c;
  }
}
