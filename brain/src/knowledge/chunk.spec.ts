import { describe, expect, it } from 'vitest';
import { chunkPages } from './chunk.js';

describe('chunkPages', () => {
  it('keeps short pages whole and remembers page numbers', () => {
    const c = chunkPages([{ page: 1, text: 'Refunds within 7 days.' }, { page: 2, text: 'Shipping is free above ₹999.' }]);
    expect(c).toEqual([
      { idx: 0, page: 1, content: 'Refunds within 7 days.' },
      { idx: 1, page: 2, content: 'Shipping is free above ₹999.' },
    ]);
  });

  it('splits long text into overlapping chunks within the size limit', () => {
    const para = (n: number) => `Paragraph ${n}. ${'word '.repeat(60).trim()}.`;
    const text = Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n');
    const c = chunkPages([{ page: null, text }], 800, 100);
    expect(c.length).toBeGreaterThan(2);
    for (const ch of c) expect(ch.content.length).toBeLessThanOrEqual(900);
    expect(c.map((x) => x.idx)).toEqual(c.map((_, i) => i));
    expect(c.at(-1)!.content).toContain('Paragraph 11.');
  });

  it('breaks a single huge sentence', () => {
    const c = chunkPages([{ page: 3, text: 'x'.repeat(5000) }], 1000, 0);
    expect(c.length).toBe(5);
    expect(c.every((x) => x.page === 3)).toBe(true);
  });
});
