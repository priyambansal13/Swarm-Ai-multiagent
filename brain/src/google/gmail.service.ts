import { Injectable } from '@nestjs/common';
import { google, gmail_v1 } from 'googleapis';
import { GoogleAuthService } from './google-auth.service.js';

export interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  labels: string[];
}

const header = (m: gmail_v1.Schema$Message, name: string) =>
  m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

function bodyText(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts ?? []) {
    const t = bodyText(p);
    if (t) return t;
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  return '';
}

/** Gmail for one user (search, read, draft, send, reply, archive). */
@Injectable()
export class GmailService {
  constructor(private readonly auth: GoogleAuthService) {}

  private async gmail(userId: string) {
    return google.gmail({ version: 'v1', auth: await this.auth.requireClient(userId) });
  }

  private summarise(m: gmail_v1.Schema$Message): MailSummary {
    return {
      id: m.id!, threadId: m.threadId!, from: header(m, 'From'), to: header(m, 'To'), subject: header(m, 'Subject'),
      date: header(m, 'Date'), snippet: m.snippet ?? '', unread: !!m.labelIds?.includes('UNREAD'), labels: m.labelIds ?? [],
    };
  }

  /** Gmail search syntax, e.g. "is:unread newer_than:2d from:asha". */
  async search(userId: string, q: string, max = 10): Promise<MailSummary[]> {
    const g = await this.gmail(userId);
    const list = await g.users.messages.list({ userId: 'me', q, maxResults: Math.min(max, 25) });
    const ids = (list.data.messages ?? []).map((m) => m.id!);
    const msgs = await Promise.all(ids.map((id) => g.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] })));
    return msgs.map((r) => this.summarise(r.data));
  }

  async read(userId: string, id: string) {
    const g = await this.gmail(userId);
    const { data } = await g.users.messages.get({ userId: 'me', id, format: 'full' });
    return { ...this.summarise(data), cc: header(data, 'Cc'), messageIdHeader: header(data, 'Message-ID'), body: bodyText(data.payload).trim().slice(0, 8000) };
  }

  private raw(o: { to: string; cc?: string; subject: string; body: string; inReplyTo?: string; references?: string }) {
    const lines = [
      `To: ${o.to}`,
      ...(o.cc ? [`Cc: ${o.cc}`] : []),
      `Subject: ${encodeHeader(o.subject)}`,
      ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`, `References: ${o.references ?? o.inReplyTo}`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      o.body,
    ];
    return Buffer.from(lines.join('\r\n')).toString('base64url');
  }

  async createDraft(userId: string, o: { to: string; cc?: string; subject: string; body: string }) {
    const g = await this.gmail(userId);
    const { data } = await g.users.drafts.create({ userId: 'me', requestBody: { message: { raw: this.raw(o) } } });
    return { draftId: data.id, messageId: data.message?.id };
  }

  async send(userId: string, o: { to: string; cc?: string; subject: string; body: string }) {
    const g = await this.gmail(userId);
    const { data } = await g.users.messages.send({ userId: 'me', requestBody: { raw: this.raw(o) } });
    return { id: data.id, threadId: data.threadId };
  }

  /** Reply in the same thread (reply-all keeps Cc). */
  async reply(userId: string, messageId: string, body: string, replyAll = false) {
    const orig = await this.read(userId, messageId);
    const g = await this.gmail(userId);
    const subject = /^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`;
    const { data } = await g.users.messages.send({
      userId: 'me',
      requestBody: {
        threadId: orig.threadId,
        raw: this.raw({ to: orig.from, cc: replyAll ? orig.cc || undefined : undefined, subject, body, inReplyTo: orig.messageIdHeader }),
      },
    });
    return { id: data.id, threadId: data.threadId };
  }

  async archive(userId: string, ids: string[]) {
    const g = await this.gmail(userId);
    await g.users.messages.batchModify({ userId: 'me', requestBody: { ids, removeLabelIds: ['INBOX'] } });
    return { archived: ids.length };
  }

  /** Messages in a thread (used by follow-up detection). */
  async thread(userId: string, threadId: string) {
    const g = await this.gmail(userId);
    const { data } = await g.users.threads.get({ userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
    return (data.messages ?? []).map((m) => this.summarise(m));
  }

  async myAddress(userId: string) {
    const g = await this.gmail(userId);
    return (await g.users.getProfile({ userId: 'me' })).data.emailAddress ?? '';
  }
}
