import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { GoogleAuthService, SHEET_TABS } from './google-auth.service.js';

export type SheetTab = keyof typeof SHEET_TABS;

/**
 * Mirrors records into the user's own Google Sheet (one workbook per user, created on connect).
 * Postgres stays the source of truth; the sheet is a readable, shareable copy. Best-effort:
 * a Sheets failure never fails the user's request.
 */
@Injectable()
export class SheetsService {
  private readonly log = new Logger(SheetsService.name);
  constructor(private readonly auth: GoogleAuthService) {}

  async append(userId: string, tab: SheetTab, row: (string | number | null)[]) {
    try {
      const acc = await this.auth.account(userId);
      const client = await this.auth.clientFor(userId);
      if (!acc?.spreadsheetId || !client) return false;
      await google.sheets({ version: 'v4', auth: client }).spreadsheets.values.append({
        spreadsheetId: acc.spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row.map((v) => (v == null ? '' : v))] },
      });
      return true;
    } catch (e) {
      this.log.warn(`Sheets append (${tab}) failed for ${userId}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Read a tab as objects keyed by header (for "what's in my sheet" questions). */
  async read(userId: string, tab: SheetTab, max = 200) {
    const acc = await this.auth.account(userId);
    const client = await this.auth.requireClient(userId);
    if (!acc?.spreadsheetId) throw new Error('No SwarmAI workbook for this user yet.');
    const { data } = await google.sheets({ version: 'v4', auth: client }).spreadsheets.values.get({ spreadsheetId: acc.spreadsheetId, range: `${tab}!A1:Z${max + 1}` });
    const [headers = [], ...rows] = data.values ?? [];
    return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  }
}
