import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { z } from 'zod';
import { shortCode } from '../common/crypto.js';
import { ChannelLink, LinkCode, LinkedChannel, User } from '../db/entities.js';
import { OpenAIMediaService } from '../integrations/openai-media.service.js';
import { RecordsService } from '../records/records.service.js';
import { ChatService, RunCancelledError } from '../chat/chat.service.js';
import { DeskService } from '../desk/desk.service.js';
import type { Attachment } from '../integrations/openai-media.service.js';

const Media = z.object({ data: z.string(), mime: z.string(), name: z.string().optional() });
export const InboundSchema = z.object({
  channel: z.enum(['telegram', 'whatsapp']),
  externalId: z.string().min(3).max(64),
  /** Receiving number/bot (WhatsApp phone_number_id) — picks the organisation's customer desk */
  to: z.string().max(64).nullish(),
  displayName: z.string().max(120).nullish(),
  messageId: z.string().nullish(),
  text: z.string().max(4000).nullish(),
  audio: Media.nullish(),
  image: Media.nullish(),
  document: Media.nullish(),
});
export type Inbound = z.infer<typeof InboundSchema>;

export interface OutboundReply {
  reply: string;
  /** base64 MP3 voice reply (when the user sent a voice note and voice replies are on) */
  voice: string | null;
  userId: string | null;
}

const YES = /^\s*(yes|y|yeah|yep|ok|okay|confirm|approve|go ahead|do it|haan|ha|haan ji|theek hai|👍|✅)\s*[.!]*\s*$/i;
const NO = /^\s*(no|n|nope|cancel|stop|reject|don'?t|nahi|nahin|mat karo|👎|❌)\s*[.!]*\s*$/i;

/**
 * Inbound messages from n8n (one Telegram bot / one WhatsApp number for all users).
 * Linked chats talk to their member's personal assistant. Other senders reach the customer desk of the
 * organisation that enabled it for this channel/number; without one they are asked to link with a code.
 */
@Injectable()
export class ChannelsService {
  private readonly log = new Logger(ChannelsService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ChannelLink) private readonly links: Repository<ChannelLink>,
    @InjectRepository(LinkCode) private readonly codes: Repository<LinkCode>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly chat: ChatService,
    private readonly media: OpenAIMediaService,
    private readonly records: RecordsService,
    private readonly desk: DeskService,
  ) {}

  async createLinkCode(user: User, channel: LinkedChannel) {
    await this.codes.delete({ expiresAt: LessThan(new Date()) });
    const code = shortCode(6);
    await this.codes.save(this.codes.create({ code, userId: user.id, channel, expiresAt: new Date(Date.now() + 15 * 60_000) }));
    const bot = this.config.get<string>('TELEGRAM_BOT_USERNAME');
    const wa = this.config.get<string>('WHATSAPP_DISPLAY_NUMBER')?.replace(/\D/g, '');
    return {
      code,
      expiresInMinutes: 15,
      instructions: channel === 'telegram'
        ? `Open the SwarmAI bot on Telegram and send: /start ${code}`
        : `Send this message to the SwarmAI WhatsApp number: LINK ${code}`,
      deepLink: channel === 'telegram' ? (bot ? `https://t.me/${bot}?start=${code}` : null) : wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`LINK ${code}`)}` : null,
    };
  }

  listLinks(user: User) {
    return this.links.find({ where: { userId: user.id } });
  }

  async unlink(user: User, channel: LinkedChannel) {
    await this.links.delete({ userId: user.id, channel });
    return { unlinked: true };
  }

  private async tryLink(msg: Inbound): Promise<string | null> {
    const m = msg.text?.trim().match(/^(?:\/start\s+|link\s+)([A-Z0-9]{6})$/i);
    if (!m) return null;
    const code = await this.codes.findOne({ where: { code: m[1].toUpperCase() } });
    if (!code || code.expiresAt < new Date() || code.channel !== msg.channel) return '⚠️ That code is invalid or expired. Generate a new one in SwarmAI → Settings.';
    await this.links.delete({ channel: msg.channel, externalId: msg.externalId });
    await this.links.delete({ userId: code.userId, channel: msg.channel });
    await this.links.save(this.links.create({ userId: code.userId, channel: msg.channel, externalId: msg.externalId, displayName: msg.displayName ?? null }));
    await this.codes.delete({ code: code.code });
    const user = await this.users.findOneByOrFail({ id: code.userId });
    await this.records.logActivity(user.id, msg.channel, 'system', 'link_channel', `Linked ${msg.channel} ${msg.displayName ?? msg.externalId}`);
    return `✅ Linked to ${user.name}'s SwarmAI. Ask me anything — e.g. "what's on my calendar today?" or send a voice note.`;
  }

  async inbound(msg: Inbound): Promise<OutboundReply> {
    const linked = await this.tryLink(msg);
    if (linked) return { reply: linked, voice: null, userId: null };

    const link = await this.links.findOne({ where: { channel: msg.channel, externalId: msg.externalId } });
    if (!link) {
      const org = await this.desk.orgFor(msg.channel, msg.to);
      if (org) return this.customer(org, msg);
      const web = this.config.get('WEB_URL') ?? 'http://localhost:3200';
      return { reply: `👋 This is SwarmAI, a personal assistant. To use it, sign in at ${web}, open Settings → Link ${msg.channel === 'telegram' ? 'Telegram' : 'WhatsApp'}, and send the code here.`, voice: null, userId: null };
    }
    const user = await this.users.findOneByOrFail({ id: link.userId });
    const threadId = `${msg.channel}-${user.id}`;

    const prepared = await this.prepare(msg);
    if ('error' in prepared) return { reply: prepared.error, voice: null, userId: user.id };
    const { text, isVoice, attachments } = prepared;

    if (this.chat.isRunning(threadId)) return { reply: '⏳ Still working on your previous request…', voice: null, userId: user.id };

    let reply: string;
    try {
      const thread = await this.chat.ensureThread(user, msg.channel, threadId);
      if (thread.status === 'awaiting_confirmation' && (YES.test(text) || NO.test(text))) {
        reply = (await this.chat.confirm(user, threadId, { approved: YES.test(text) })).result.reply;
      } else {
        reply = (await this.chat.send(user, { threadId, channel: msg.channel, text, attachments })).result.reply;
      }
    } catch (e) {
      reply = e instanceof RunCancelledError ? '⏹ Stopped.' : `⚠️ Something went wrong: ${(e as Error).message}`;
      this.log.error(`inbound ${msg.channel} for ${user.id}: ${(e as Error).message}`);
    }
    if (isVoice) reply = `🎙️ “${text.slice(0, 200)}”\n\n${reply}`;

    const voice = isVoice && user.settings?.voiceReplies !== false ? await this.speak(reply.replace(/^🎙️ “[^”]*”\n\n/, '')) : null;
    return { reply: reply.slice(0, 4000), voice, userId: user.id };
  }

  /** A customer of an organisation (not a member): the org's desk bot, or silence while staff handle it. */
  private async customer(org: Parameters<DeskService['inbound']>[0], msg: Inbound): Promise<OutboundReply> {
    const prepared = await this.prepare(msg);
    if ('error' in prepared) return { reply: prepared.error, voice: null, userId: null };
    const reply = await this.desk.inbound(org, { channel: msg.channel, externalId: msg.externalId, displayName: msg.displayName, ...prepared });
    const voice = reply && prepared.isVoice ? await this.speak(reply) : null;
    return { reply: reply.slice(0, 4000), voice, userId: null };
  }

  /** Voice note → text; photos/documents → attachments. */
  private async prepare(msg: Inbound): Promise<{ text: string; isVoice: boolean; attachments: Attachment[] } | { error: string }> {
    let text = msg.text?.trim() ?? '';
    const isVoice = !!msg.audio;
    if (msg.audio) {
      try {
        text = await this.media.transcribe(Buffer.from(msg.audio.data, 'base64'), msg.audio.mime);
      } catch (e) {
        return { error: `⚠️ I couldn't understand that voice note (${(e as Error).message}).` };
      }
    }
    const attachments = [msg.image, msg.document].filter(Boolean).map((a, i) => ({ name: a!.name ?? `attachment-${i + 1}`, mime: a!.mime, data: a!.data }));
    if (!text && attachments.length) text = 'Please look at the attachment.';
    if (!text) return { error: 'Send me a message, a voice note or a photo.' };
    return { text, isVoice, attachments };
  }

  private async speak(text: string) {
    try {
      return (await this.media.speak(text.replace(/[*_`#>]/g, ''))).toString('base64');
    } catch (e) {
      this.log.warn(`TTS failed: ${(e as Error).message}`);
      return null;
    }
  }
}
