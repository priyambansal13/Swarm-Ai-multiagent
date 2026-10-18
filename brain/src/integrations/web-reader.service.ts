import { Injectable } from '@nestjs/common';
import { isIP } from 'node:net';

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|172\.(1[6-9]|2\d|3[01])\.)/i;

/** Readable text from an HTML page (scripts, navigation and tags removed). */
export function htmlToText(raw: string) {
  return raw
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export const htmlTitle = (raw: string) => raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;

/** Fetches public web pages: "summarise this link" and knowledge-base URLs. Private network addresses are refused. */
@Injectable()
export class WebReaderService {
  /** Raw download (HTML, text or PDF) up to `maxBytes`. */
  async fetch(url: string, maxBytes = 15_000_000) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links can be read');
    if (PRIVATE.test(u.hostname) || (isIP(u.hostname) && PRIVATE.test(u.hostname))) throw new Error('Private network addresses are not allowed');
    const res = await fetch(u, {
      signal: AbortSignal.timeout(30_000), redirect: 'follow',
      headers: { 'User-Agent': 'SwarmAI/1.0 (assistant)', Accept: 'text/html,text/plain,application/pdf;q=0.9,*/*;q=0.5' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) throw new Error(`File too large (${Math.round(body.length / 1e6)} MB)`);
    return { url: res.url, mime, body };
  }

  async read(url: string) {
    const { url: finalUrl, mime, body } = await this.fetch(url, 4_000_000);
    if (!/text|html|json|xml/.test(mime)) throw new Error(`Unsupported content type ${mime}`);
    const raw = body.toString('utf8').slice(0, 2_000_000);
    const text = htmlToText(raw);
    return { url: finalUrl, title: htmlTitle(raw) ?? new URL(finalUrl).hostname, text: text.slice(0, 9000), truncated: text.length > 9000 };
  }
}
