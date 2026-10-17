'use client';

import { Check, CircleAlert, Loader2 } from 'lucide-react';
import type { AgentRuntime } from '@/lib/types';

export interface ToolCall {
  id: string;
  agent: string;
  tool: string;
  status: 'running' | 'ok' | 'error';
  durationMs?: number;
}

/** Live view of which agents are working and which tools they call (AG-UI shared state + TOOL_CALL events). */
export function AgentActivity({ agents, tools, busy }: { agents: Record<string, AgentRuntime>; tools: ToolCall[]; busy: boolean }) {
  const list = Object.entries(agents);
  if (!list.length && !busy) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface px-3.5 py-3 text-sm" aria-live="polite">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {busy && <span className="h-2 w-2 rounded-full bg-teal hive-pulse" />} Agents at work
      </div>
      <div className="flex flex-wrap gap-1.5">
        {list.length === 0 && <span className="text-muted">Starting…</span>}
        {list.map(([id, a]) => (
          <span key={id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            a.status === 'running' ? 'border-teal bg-teal-soft text-teal' : a.status === 'error' ? 'border-danger bg-danger-soft text-danger' : 'border-line bg-surface-2 text-ink'
          }`}>
            {a.status === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : a.status === 'error' ? <CircleAlert className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            {a.label}
            {a.tools > 0 && <span className="text-muted">· {a.tools}</span>}
            {a.durationMs != null && a.status !== 'running' && <span className="text-muted">· {(a.durationMs / 1000).toFixed(1)}s</span>}
          </span>
        ))}
      </div>
      {tools.length > 0 && (
        <ul className="scroll-thin mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11.5px] text-muted">
          {tools.slice(-8).map((t) => (
            <li key={t.id} className="flex items-center gap-1.5">
              <span className={t.status === 'running' ? 'text-teal' : t.status === 'error' ? 'text-danger' : 'text-ok'}>{t.status === 'running' ? '…' : t.status === 'error' ? '✕' : '✓'}</span>
              <span className="text-ink">{t.agent}</span>›<span>{t.tool}</span>
              {t.durationMs != null && <span>{(t.durationMs / 1000).toFixed(1)}s</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
