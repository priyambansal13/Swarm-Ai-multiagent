import { Injectable } from '@nestjs/common';
import { isIP } from 'node:net';

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|172\.(1[6-9]|2\d|3[01])\.)/i;

/** Fetches a public web page and returns readable text (for "summarise this link"). */
@Injectable()
export class WebReaderService {
  async read(url: string) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links can be read');
    if (PRIVATE.test(u.hostname) || (isIP(u.hostname) && PRIVATE.test(u.hostname))) throw new Error('Private network addresses are not allowed');
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'SwarmAI/1.0 (personal assistant)', Accept: 'text/html,text/plain' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text|html|json|xml/.test(type)) throw new Error(`Unsupported content type ${type}`);
    const raw = (await res.text()).slice(0, 2_000_000);
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? u.hostname;
    const text = raw
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return { url: res.url, title, text: text.slice(0, 9000), truncated: text.length > 9000 };
  }
}
