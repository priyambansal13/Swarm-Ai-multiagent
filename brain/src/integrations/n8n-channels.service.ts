import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * Outbound messaging through n8n over MCP. The n8n workflow "SwarmAI – Channel tools (MCP)" exposes
 * `send_telegram_message` and `send_whatsapp_message`; channel credentials live only in n8n.
 * The brain fills in the chat id from the user's linked channel — the LLM never chooses recipients.
 */
@Injectable()
export class N8nChannelsService implements OnModuleDestroy {
  private readonly log = new Logger(N8nChannelsService.name);
  private client: MultiServerMCPClient | null = null;
  private tools: Map<string, DynamicStructuredTool> | null = null;

  constructor(private readonly config: ConfigService) {}

  get configured() {
    return !!this.config.get('N8N_MCP_URL');
  }

  private async load() {
    if (this.tools) return this.tools;
    this.client = new MultiServerMCPClient({
      mcpServers: {
        n8n: {
          transport: 'http',
          url: this.config.get<string>('N8N_MCP_URL')!,
          headers: { Authorization: `Bearer ${this.config.get('N8N_MCP_TOKEN') ?? ''}` },
        },
      },
      throwOnLoadError: true,
      prefixToolNameWithServerName: false,
    } as any);
    const tools = (await this.client.getTools()) as DynamicStructuredTool[];
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.log.log(`n8n MCP tools: ${[...this.tools.keys()].join(', ') || '(none)'}`);
    return this.tools;
  }

  async listTools(): Promise<string[]> {
    if (!this.configured) return [];
    return [...(await this.load()).keys()];
  }

  async send(channel: 'telegram' | 'whatsapp', chatId: string, text: string): Promise<string> {
    if (!this.configured) throw new Error('n8n MCP is not configured (N8N_MCP_URL).');
    const name = channel === 'telegram' ? 'send_telegram_message' : 'send_whatsapp_message';
    try {
      const tool = (await this.load()).get(name);
      if (!tool) throw new Error(`n8n MCP server does not expose ${name}`);
      const out = await tool.invoke({ chatId, text: text.slice(0, 4000) });
      return typeof out === 'string' ? out : JSON.stringify(out);
    } catch (e) {
      this.tools = null; // reconnect next time
      throw e;
    }
  }

  async onModuleDestroy() {
    await this.client?.close().catch(() => undefined);
  }
}
