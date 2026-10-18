import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { z } from 'zod';
import { KbSource, User } from '../db/entities.js';
import { OpenAIMediaService } from '../integrations/openai-media.service.js';
import { htmlTitle, htmlToText, WebReaderService } from '../integrations/web-reader.service.js';
import { OrgService } from '../orgs/org.service.js';
import { chunkPages, Page } from './chunk.js';

export const KbFileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mime: z.string().max(120),
  /** base64, no data: prefix */
  data: z.string().min(1),
});
export const KbUrlSchema = z.object({ url: z.string().url(), name: z.string().trim().max(200).optional() });
export const KbTextSchema = z.object({ name: z.string().trim().min(1).max(200), text: z.string().min(1).max(500_000) });

const MAX_CHARS = 2_000_000;

export interface KbHit {
  n: number;
  source: string;
  sourceId: string;
  page: number | null;
  url: string | null;
  score: number;
  text: string;
}

/**
 * Organisation knowledge base (RAG): PDFs, Word files, text/Markdown/CSV, web pages and pasted text are split
 * into page-aware chunks, embedded (text-embedding-3-small) and stored in pgvector; agents search them and cite
 * "[source, p. N]". Vectors live in `kb_chunks` (raw SQL, like note embeddings) so TypeORM never touches them.
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly log = new Logger(KnowledgeService.name);

  constructor(
    private readonly db: DataSource,
    private readonly media: OpenAIMediaService,
    private readonly web: WebReaderService,
    private readonly orgs: OrgService,
    @InjectRepository(KbSource) private readonly sources: Repository<KbSource>,
  ) {}

  async onModuleInit() {
    await this.db.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.db.query(`CREATE TABLE IF NOT EXISTS kb_chunks (
      id bigserial PRIMARY KEY,
      source_id uuid NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
      org_id uuid NOT NULL,
      idx int NOT NULL,
      page int,
      content text NOT NULL,
      embedding vector(1536) NOT NULL)`);
    await this.db.query('CREATE INDEX IF NOT EXISTS kb_chunks_org ON kb_chunks(org_id)');
    await this.db.query('CREATE INDEX IF NOT EXISTS kb_chunks_source ON kb_chunks(source_id)');
    await this.db.query('CREATE INDEX IF NOT EXISTS kb_chunks_vec ON kb_chunks USING hnsw (embedding vector_cosine_ops)');
    // Sources left half-processed by a restart.
    await this.sources.update({ status: 'processing' }, { status: 'error', error: 'Interrupted — re-upload or re-sync' });
  }

  list(orgId: string) {
    return this.sources.find({ where: { orgId }, order: { createdAt: 'DESC' } });
  }

  countReady(orgId: string) {
    return this.sources.count({ where: { orgId, status: 'ready' } });
  }

  private async source(orgId: string, id: string) {
    const s = await this.sources.findOne({ where: { orgId, id } });
    if (!s) throw new NotFoundException('Knowledge source not found');
    return s;
  }

  // ------------------------------------------------------------------ add sources (processed in the background)
  async addFile(user: User, input: z.infer<typeof KbFileSchema>) {
    const body = Buffer.from(input.data, 'base64');
    if (body.length > 15_000_000) throw new BadRequestException('Files up to 15 MB are supported.');
    const mime = input.mime || 'application/octet-stream';
    if (!this.supported(mime, input.name)) throw new BadRequestException(`Unsupported file type ${mime}. Use PDF, Word (.docx), text, Markdown, CSV or HTML.`);
    const src = await this.sources.save(this.sources.create({ orgId: user.orgId, name: input.name, type: 'file', mime, createdBy: user.id }));
    void this.process(src, async () => this.extract(body, mime, input.name));
    return src;
  }

  async addUrl(user: User, input: z.infer<typeof KbUrlSchema>) {
    const src = await this.sources.save(this.sources.create({ orgId: user.orgId, name: input.name || input.url, type: 'url', url: input.url, createdBy: user.id }));
    void this.process(src, () => this.fromUrl(src));
    return src;
  }

  async addText(user: User, input: z.infer<typeof KbTextSchema>) {
    const src = await this.sources.save(this.sources.create({ orgId: user.orgId, name: input.name, type: 'text', mime: 'text/plain', createdBy: user.id }));
    await this.process(src, async () => [{ page: null, text: input.text }]);
    return this.source(user.orgId, src.id);
  }

  /** Re-fetch a web page source and rebuild its chunks. */
  async resync(orgId: string, id: string) {
    const src = await this.source(orgId, id);
    if (src.type !== 'url') throw new BadRequestException('Only web page sources can be re-synced — upload the file again instead.');
    await this.sources.update({ id }, { status: 'processing', error: null });
    void this.process(src, () => this.fromUrl(src));
    return { ...src, status: 'processing' };
  }

  async remove(orgId: string, id: string) {
    await this.source(orgId, id);
    await this.sources.delete({ orgId, id }); // chunks cascade
    return { deleted: true };
  }

  // ------------------------------------------------------------------ search
  async search(orgId: string, query: string, k = 6): Promise<KbHit[]> {
    const org = await this.orgs.get(orgId);
    const [vec] = await this.media.embed([query], this.orgs.apiKey(org));
    const rows = await this.db.query(
      `SELECT c.content, c.page, s.id AS "sourceId", s.name, s.url, 1 - (c.embedding <=> $2::vector) AS score
       FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
       WHERE c.org_id = $1 AND s.status = 'ready'
       ORDER BY c.embedding <=> $2::vector LIMIT $3`,
      [orgId, `[${vec.join(',')}]`, k],
    );
    return rows
      .map((r: any, i: number) => ({ n: i + 1, source: r.name, sourceId: r.sourceId, page: r.page, url: r.url, score: Number(Number(r.score).toFixed(3)), text: r.content }))
      .filter((h: KbHit) => h.score >= 0.2);
  }

  /** Text of one chunk range for a source (used by previews). */
  async preview(orgId: string, id: string) {
    await this.source(orgId, id);
    return this.db.query('SELECT idx, page, left(content, 400) AS content FROM kb_chunks WHERE source_id = $1 AND org_id = $2 ORDER BY idx LIMIT 5', [id, orgId]);
  }

  // ------------------------------------------------------------------ ingestion
  private supported(mime: string, name: string) {
    return /pdf|officedocument\.wordprocessingml|text\/|json|csv|xml|html|markdown/.test(mime) || /\.(pdf|docx|txt|md|csv|html?|json)$/i.test(name);
  }

  private async fromUrl(src: KbSource): Promise<Page[]> {
    const { url, mime, body } = await this.web.fetch(src.url!);
    if (src.name === src.url && /html/.test(mime)) {
      const title = htmlTitle(body.toString('utf8').slice(0, 200_000));
      if (title) await this.sources.update({ id: src.id }, { name: title.slice(0, 200) });
    }
    return this.extract(body, mime, url);
  }

  private async extract(body: Buffer, mime: string, name: string): Promise<Page[]> {
    if (/pdf/.test(mime) || /\.pdf$/i.test(name)) {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(body));
      const { text } = await extractText(pdf, { mergePages: false });
      return (text as string[]).map((t, i) => ({ page: i + 1, text: t }));
    }
    if (/wordprocessingml/.test(mime) || /\.docx$/i.test(name)) {
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.extractRawText({ buffer: body });
      return [{ page: null, text: value }];
    }
    const raw = body.toString('utf8');
    return [{ page: null, text: /html/.test(mime) || /\.html?$/i.test(name) ? htmlToText(raw) : raw }];
  }

  /** Extract → chunk → embed → store; the source row tracks progress and errors. */
  private async process(src: KbSource, load: () => Promise<Page[]>) {
    try {
      const pages = await load();
      const chars = pages.reduce((n, p) => n + p.text.length, 0);
      if (chars < 20) throw new Error('No readable text found (scanned PDFs need OCR first).');
      if (chars > MAX_CHARS) throw new Error(`Too much text (${chars.toLocaleString()} characters; limit ${MAX_CHARS.toLocaleString()}).`);
      const chunks = chunkPages(pages);
      const org = await this.orgs.get(src.orgId);
      const vectors = await this.media.embed(chunks.map((c) => `${src.name}\n${c.content}`), this.orgs.apiKey(org));
      await this.db.transaction(async (m) => {
        await m.query('DELETE FROM kb_chunks WHERE source_id = $1', [src.id]);
        for (let i = 0; i < chunks.length; i += 200) {
          const part = chunks.slice(i, i + 200);
          const params: unknown[] = [];
          const values = part.map((c, j) => {
            params.push(src.id, src.orgId, c.idx, c.page, c.content, `[${vectors[i + j].join(',')}]`);
            const b = j * 6;
            return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::vector)`;
          });
          await m.query(`INSERT INTO kb_chunks (source_id, org_id, idx, page, content, embedding) VALUES ${values.join(', ')}`, params);
        }
      });
      await this.sources.update({ id: src.id }, { status: 'ready', error: null, chunks: chunks.length, chars, syncedAt: new Date() });
      this.log.log(`Knowledge "${src.name}": ${chunks.length} chunks`);
    } catch (e) {
      this.log.warn(`Knowledge "${src.name}" failed: ${(e as Error).message}`);
      await this.sources.update({ id: src.id }, { status: 'error', error: (e as Error).message.slice(0, 500) });
    }
  }
}
