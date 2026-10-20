import { All, Controller, Logger, NotFoundException, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DURATIONS, PLATFORMS, researchToText, scriptToMarkdown, StudioService, TONES } from './studio.service.js';

/** Constant-time comparison of a presented bearer token with the configured one. */
export function tokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  const given = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!given) return false;
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

/**
 * MCP server (Streamable HTTP, stateless) at /api/mcp — exposes StoryForge to AI agents such as Claude Desktop.
 * Tools: get_latest_info_mcp (real-time research) and get_video_script_mcp (short-form script).
 * Enabled only when MCP_SERVER_TOKEN is set; every request must send `Authorization: Bearer <MCP_SERVER_TOKEN>`.
 */
@ApiExcludeController()
@Controller('mcp')
export class McpController {
  private readonly log = new Logger(McpController.name);
  private readonly handler = createMcpHandler(() => this.server(), { onerror: (e) => this.log.warn(`MCP: ${e.message}`) });

  constructor(private readonly config: ConfigService, private readonly studio: StudioService) {}

  private server() {
    const s = new McpServer({ name: 'swarmai-storyforge', version: '1.0.0' });
    s.registerTool('get_latest_info_mcp', {
      title: 'Get latest info',
      description: 'Real-time research on a topic: searches the web and news, reads the top pages and returns a summary, key facts with sources and short-video angles.',
      inputSchema: z.object({ topic: z.string().min(2).max(200).describe('What to research, e.g. "Apple Vision Pro sales 2026"') }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ topic }) => {
      const r = await this.studio.research(topic);
      return { content: [{ type: 'text', text: researchToText(r) }] };
    });
    s.registerTool('get_video_script_mcp', {
      title: 'Get video script',
      description: 'Writes a short-form vertical video script (YouTube Shorts / Instagram Reels): titles, hook, timed beats with voice-over, on-screen text and visuals, CTA, caption, hashtags. Pass info_text from get_latest_info_mcp, or leave it out to research first.',
      inputSchema: z.object({
        topic: z.string().min(2).max(200),
        info_text: z.string().max(12_000).optional().describe('Research to base the script on (e.g. the output of get_latest_info_mcp)'),
        platform: z.enum(PLATFORMS).optional().describe('shorts (default), reels or both'),
        duration_seconds: z.number().int().optional().describe('30, 45, 60 (default) or 90'),
        tone: z.enum(TONES).optional(),
        language: z.string().max(30).optional().describe('Default English'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    }, async (a) => {
      const durationSec = (DURATIONS as readonly number[]).includes(a.duration_seconds ?? 60) ? (a.duration_seconds ?? 60) : 60;
      const script = await this.studio.script({
        topic: a.topic, research: a.info_text, platform: a.platform ?? 'shorts', durationSec, tone: a.tone ?? 'energetic', language: a.language ?? 'English',
      });
      return { content: [{ type: 'text', text: scriptToMarkdown(script) }] };
    });
    return s;
  }

  @All()
  async handle(@Req() req: Request, @Res() res: Response) {
    const expected = this.config.get<string>('MCP_SERVER_TOKEN');
    if (!expected) throw new NotFoundException('MCP server is disabled (set MCP_SERVER_TOKEN)');
    if (!tokenMatches(req.headers.authorization, expected)) throw new UnauthorizedException('Missing or wrong bearer token');

    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const web = await this.handler.fetch(new Request(url, { method: req.method, headers, signal: abort.signal }), {
      parsedBody: req.method === 'POST' ? req.body : undefined,
    });
    res.status(web.status);
    web.headers.forEach((v, k) => res.setHeader(k, v));
    if (!web.body) return res.end();
    const reader = web.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      /* client went away */
    }
    res.end();
  }
}
