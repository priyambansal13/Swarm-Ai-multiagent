import { Body, Controller, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { BaseEvent } from '@ag-ui/core';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { EventEncoder } from '@ag-ui/encoder';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/guards.js';
import { ChatService, RunCancelledError } from '../chat/chat.service.js';
import type { User } from '../db/entities.js';
import type { Attachment } from '../integrations/openai-media.service.js';
import { AguiRun } from './agui-run.js';

/**
 * AG-UI endpoint for the web app: POST RunAgentInput → SSE stream.
 * Attachments ride in `forwardedProps.attachments` ([{name, mime, data(base64)}]).
 * Confirmations: RUN_FINISHED outcome "interrupt" → next run sends resume [{interruptId, status, payload:{approved, actionIds?}}].
 */
@ApiTags('AG-UI')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('agui')
export class AguiController {
  private readonly log = new Logger(AguiController.name);
  constructor(private readonly chat: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Chat with the agents over AG-UI (Server-Sent Events)', description: 'Streams RUN/STEP/TOOL_CALL/STATE/TEXT events. Swagger cannot render streams — use an AG-UI client or curl -N.' })
  @ApiBody({ schema: { type: 'object', description: 'AG-UI RunAgentInput', example: { threadId: 'web-1234', runId: 'run-1', state: {}, tools: [], context: [], messages: [{ id: 'm1', role: 'user', content: 'What is on my calendar today?' }] } } })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'AG-UI event stream' })
  async run(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const parsed = RunAgentInputSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid RunAgentInput', issues: parsed.error.issues.slice(0, 5) });
      return;
    }
    const input = parsed.data;
    const resume = input.resume?.[0];
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const content = lastUser && 'content' in lastUser ? lastUser.content : undefined;
    const text = (typeof content === 'string' ? content : (content ?? []).map((p: any) => (p.type === 'text' ? p.text : '')).join('\n')).trim();
    const attachments = ((input.forwardedProps as any)?.attachments ?? []) as Attachment[];
    if (!resume && !text && !attachments.length) {
      res.status(400).json({ error: 'Send a user message, attachments, or resume entries' });
      return;
    }

    const encoder = new EventEncoder({ accept: req.headers.accept });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const abort = new AbortController();
    let finished = false;
    let closed = false;
    res.on('close', () => {
      closed = true;
      if (!finished) abort.abort();
    });
    const send = (e: BaseEvent) => !closed && res.write(encoder.encode(e));
    const keepalive = setInterval(() => !closed && res.write(': keepalive\n\n'), 15_000);
    const run = new AguiRun(send, input.threadId, input.runId);
    run.start();
    try {
      const emit = (e: Parameters<AguiRun['onEvent']>[0]) => run.onEvent(e);
      let out;
      if (resume?.status === 'resolved') {
        const p = (resume.payload ?? {}) as { approved?: boolean; actionIds?: string[] };
        out = await this.chat.confirm(user, input.threadId, { approved: !!p.approved, actionIds: p.actionIds }, emit, abort.signal);
      } else if (resume?.status === 'cancelled' && !text) {
        out = await this.chat.confirm(user, input.threadId, { approved: false }, emit, abort.signal);
      } else {
        out = await this.chat.send(user, { threadId: input.threadId, channel: 'web', text: text || 'Please look at the attachment.', attachments }, emit, abort.signal);
      }
      finished = true;
      await run.finish(out.result.reply, out.thread.pending, { threadId: out.thread.id, title: out.thread.title });
    } catch (e) {
      finished = true;
      if (e instanceof RunCancelledError) run.cancelled();
      else {
        this.log.error(`AG-UI run failed: ${(e as Error).message}`);
        run.fail((e as Error).message);
      }
    } finally {
      clearInterval(keepalive);
      if (!closed) res.end();
    }
  }
}
