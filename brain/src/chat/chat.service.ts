import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Emit, RunContext } from '../agents/context.js';
import { ConfirmDecision, RunCancelledError, SwarmGraphService, TurnResult } from '../agents/graph.service.js';
import { Channel, ChannelLink, Thread, User } from '../db/entities.js';
import { GoogleAuthService } from '../google/google-auth.service.js';
import type { Attachment } from '../integrations/openai-media.service.js';
import { RecordsService } from '../records/records.service.js';

export { RunCancelledError };

export interface ChatInput {
  threadId?: string;
  channel: Channel;
  text: string;
  attachments?: Attachment[];
}

/** Runs conversation turns for every channel (web/AG-UI, REST, Telegram, WhatsApp). One run per thread at a time. */
@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);
  private readonly running = new Map<string, AbortController>();

  constructor(
    @InjectRepository(Thread) private readonly threads: Repository<Thread>,
    @InjectRepository(ChannelLink) private readonly links: Repository<ChannelLink>,
    private readonly google: GoogleAuthService,
    private readonly records: RecordsService,
    private readonly graph: SwarmGraphService,
  ) {}

  isRunning(threadId: string) {
    return this.running.has(threadId);
  }

  async ensureThread(user: User, channel: Channel, threadId?: string): Promise<Thread> {
    const id = threadId ?? `web-${randomUUID()}`;
    const existing = await this.threads.findOne({ where: { id } });
    if (existing) {
      if (existing.userId !== user.id) throw new NotFoundException('Conversation not found');
      return existing;
    }
    return this.threads.save(this.threads.create({ id, userId: user.id, channel }));
  }

  private async context(user: User, thread: Thread, attachments: Attachment[], emit: Emit, signal: AbortSignal): Promise<RunContext> {
    const [links, facts, google] = await Promise.all([
      this.links.find({ where: { userId: user.id } }),
      this.records.listFacts(user.id),
      this.google.account(user.id),
    ]);
    return {
      user, runId: randomUUID(), threadId: thread.id, channel: thread.channel,
      googleConnected: !!google && this.google.configured,
      links: Object.fromEntries(links.map((l) => [l.channel, l.externalId])),
      attachments, facts: facts.map((f) => f.fact), pending: [], emit, signal,
    };
  }

  private async lockAndRun(thread: Thread, external: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<TurnResult>) {
    if (this.running.has(thread.id)) throw new ConflictException('Still working on the previous request in this conversation.');
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    external?.addEventListener('abort', onAbort, { once: true });
    this.running.set(thread.id, ctrl);
    await this.threads.update({ id: thread.id }, { status: 'running' });
    try {
      const result = await fn(ctrl.signal);
      await this.threads.update({ id: thread.id }, {
        status: result.interrupt ? 'awaiting_confirmation' : 'idle',
        pending: result.interrupt ? { interruptId: result.interrupt.id, actions: result.interrupt.actions } : null,
      });
      return result;
    } catch (e) {
      // A cancelled or failed run keeps any earlier pending confirmation untouched only if nothing new started.
      await this.threads.update({ id: thread.id }, { status: thread.pending ? 'awaiting_confirmation' : 'idle' });
      throw e;
    } finally {
      external?.removeEventListener('abort', onAbort);
      this.running.delete(thread.id);
    }
  }

  /** New user message. A message sent while a confirmation is pending supersedes it. */
  async send(user: User, input: ChatInput, emit: Emit = () => {}, signal?: AbortSignal) {
    const thread = await this.ensureThread(user, input.channel, input.threadId);
    if (thread.title === 'New conversation' && input.text) {
      await this.threads.update({ id: thread.id }, { title: input.text.replace(/\s+/g, ' ').slice(0, 60) });
    }
    if (thread.pending) thread.pending = null;
    const result = await this.lockAndRun(thread, signal, async (s) => {
      const ctx = await this.context(user, thread, input.attachments ?? [], emit, s);
      return this.graph.run(thread.id, ctx, input.text);
    });
    return { thread: await this.threads.findOneByOrFail({ id: thread.id }), result };
  }

  /** Approve / reject the pending actions of a thread. */
  async confirm(user: User, threadId: string, decision: ConfirmDecision, emit: Emit = () => {}, signal?: AbortSignal) {
    const thread = await this.ensureThread(user, 'web', threadId);
    if (thread.status !== 'awaiting_confirmation') throw new ConflictException('Nothing is waiting for confirmation in this conversation.');
    const result = await this.lockAndRun(thread, signal, async (s) => {
      const ctx = await this.context(user, thread, [], emit, s);
      return this.graph.resume(thread.id, ctx, decision);
    });
    return { thread: await this.threads.findOneByOrFail({ id: thread.id }), result };
  }

  cancel(user: User, threadId: string) {
    const ctrl = this.running.get(threadId);
    if (!ctrl) return false;
    ctrl.abort();
    return true;
  }

  listThreads(user: User, channel?: Channel) {
    return this.threads.find({ where: { userId: user.id, ...(channel ? { channel } : {}) }, order: { updatedAt: 'DESC' }, take: 50 });
  }

  async getThread(user: User, threadId: string) {
    const thread = await this.threads.findOne({ where: { id: threadId, userId: user.id } });
    if (!thread) throw new NotFoundException('Conversation not found');
    return { ...thread, messages: await this.graph.history(threadId) };
  }

  async deleteThread(user: User, threadId: string) {
    this.cancel(user, threadId);
    const { affected } = await this.threads.delete({ id: threadId, userId: user.id });
    if (affected) await this.graph.deleteHistory(threadId);
    return { deleted: true };
  }
}
