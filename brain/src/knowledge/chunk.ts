export interface Page {
  /** 1-based page number (PDFs), null for single-page sources */
  page: number | null;
  text: string;
}

export interface Chunk {
  idx: number;
  page: number | null;
  content: string;
}

const clean = (t: string) => t.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Splits pages into overlapping chunks of about `size` characters, on paragraph → sentence → word boundaries.
 * Chunks never span pages, so every chunk can be cited with its page number.
 */
export function chunkPages(pages: Page[], size = 1200, overlap = 150): Chunk[] {
  const out: Chunk[] = [];
  for (const p of pages) {
    const pieces = splitToPieces(clean(p.text), size);
    let cur = '';
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 1 > size) {
        out.push({ idx: out.length, page: p.page, content: cur });
        cur = `${tail(cur, overlap)}${piece}`;
      } else {
        cur = cur ? `${cur}\n${piece}` : piece;
      }
    }
    if (cur.trim()) out.push({ idx: out.length, page: p.page, content: cur.trim() });
  }
  return out;
}

/** Paragraphs, with over-long paragraphs split into sentences (and over-long sentences into words). */
function splitToPieces(text: string, size: number): string[] {
  const res: string[] = [];
  for (const para of text.split(/\n\s*\n|\n(?=[-•*\d]+[.)]?\s)/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= size) {
      res.push(p);
      continue;
    }
    for (const s of p.split(/(?<=[.!?।])\s+/)) {
      if (s.length <= size) res.push(s);
      else for (let i = 0; i < s.length; i += size) res.push(s.slice(i, i + size));
    }
  }
  return res;
}

/** Last ~n characters starting at a word boundary (overlap between chunks). */
function tail(s: string, n: number) {
  if (n <= 0 || s.length <= n) return '';
  const t = s.slice(-n);
  const sp = t.indexOf(' ');
  return `${sp >= 0 ? t.slice(sp + 1) : t} `;
}
