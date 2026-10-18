import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RunContext } from '../context.js';
import { safe, Services } from './common.js';

export function knowledgeTools(s: Services, ctx: RunContext) {
  const orgId = ctx.org.id;
  return [
    tool(safe(async ({ query }: { query: string }) => {
      const hits = await s.knowledge.search(orgId, query, 6);
      return hits.length
        ? { results: hits.map(({ sourceId: _s, ...h }) => h) }
        : { results: [], note: 'Nothing relevant in the knowledge base for this query.' };
    }), {
      name: 'kb_search',
      description: "Search the organisation's knowledge base (uploaded documents, web pages, FAQs, policies). Returns numbered passages with source name, page and URL.",
      schema: z.object({ query: z.string().describe('A specific question or keywords') }),
    }),
    tool(safe(async () => (await s.knowledge.list(orgId)).filter((x) => x.status === 'ready').map((x) => ({ name: x.name, type: x.type, url: x.url, updated: x.syncedAt }))), {
      name: 'kb_list_sources', description: 'List the documents and pages in the knowledge base.', schema: z.object({}),
    }),
  ];
}
