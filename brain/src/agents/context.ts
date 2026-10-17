import { randomUUID } from 'node:crypto';
import type { Channel, User } from '../db/entities.js';
import type { Attachment } from '../integrations/openai-media.service.js';

/** Progress events streamed to UIs (AG-UI steps/tool calls) and stored in run traces. */
export type AgentEvent =
  | { type: 'agent'; agent: string; status: 'running' | 'done' | 'error'; message?: string; durationMs?: number }
  | { type: 'tool'; agent: string; callId: string; tool: string; phase: 'start' | 'end'; input?: unknown; preview?: string; ok?: boolean; durationMs?: number };
export type Emit = (e: AgentEvent) => void;

/** Side effects that always require the user's confirmation before they run. */
export type ActionKind =
  | 'gmail_send' | 'gmail_reply' | 'gmail_archive'
  | 'calendar_create' | 'calendar_update' | 'calendar_delete'
  | 'task_delete' | 'expense_from_receipt';

export interface PendingAction {
  id: string;
  agent: string;
  kind: ActionKind;
  /** One line the user sees, e.g. "Send email to asha@x.com — 'Friday works'" */
  summary: string;
  args: Record<string, any>;
}

/** Everything an agent run needs; built per run so tools are scoped to one user. */
export interface RunContext {
  user: User;
  runId: string;
  threadId: string;
  channel: Channel;
  googleConnected: boolean;
  /** externalId of linked channels */
  links: Partial<Record<'telegram' | 'whatsapp', string>>;
  attachments: Attachment[];
  facts: string[];
  pending: PendingAction[];
  emit: Emit;
  signal?: AbortSignal;
}

/** Records a side effect for confirmation instead of performing it. */
export function propose(ctx: RunContext, agent: string, kind: ActionKind, summary: string, args: Record<string, any>) {
  const action: PendingAction = { id: randomUUID().slice(0, 8), agent, kind, summary, args };
  ctx.pending.push(action);
  return {
    status: 'PENDING_USER_CONFIRMATION',
    actionId: action.id,
    summary,
    note: 'Not executed yet. Tell the user what will happen; it runs only after they confirm.',
  };
}
