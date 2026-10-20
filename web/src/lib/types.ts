export type Channel = 'web' | 'telegram' | 'whatsapp';

export interface UserSettings {
  briefTime: string;
  briefEnabled: boolean;
  notifyChannel: Channel;
  voiceReplies: boolean;
  newsTopics: string[];
  homeCity: string | null;
  triageEnabled: boolean;
  meetingPrepEnabled: boolean;
}

export type OrgRole = 'owner' | 'admin' | 'agent' | 'member';
export const isStaff = (r?: OrgRole) => r === 'owner' || r === 'admin' || r === 'agent';
export const isAdmin = (r?: OrgRole) => r === 'owner' || r === 'admin';

export interface User { id: string; email: string; name: string; timezone: string; settings: UserSettings; orgId: string; role: OrgRole }

export interface ChannelLink { id: string; channel: 'telegram' | 'whatsapp'; externalId: string; displayName: string | null; createdAt: string }

export interface Me {
  user: User;
  org: { id: string; name: string; slug: string; assistantName: string; accentColor: string | null; deskEnabled: boolean };
  integrations: {
    googleAvailable: boolean;
    google: { email: string; spreadsheetUrl: string | null; connectedAt: string } | null;
    telegram: ChannelLink | null;
    whatsapp: ChannelLink | null;
  };
}

export interface PendingAction { id: string; agent: string; kind: string; summary: string }
export interface Pending { interruptId: string; actions: PendingAction[] }

export interface Thread {
  id: string; userId: string; channel: Channel; title: string; status: 'idle' | 'running' | 'awaiting_confirmation';
  pending: Pending | null; createdAt: string; updatedAt: string;
}
export interface ThreadDetail extends Thread { messages: { role: 'user' | 'assistant'; content: string }[] }

export interface AgentRuntime { label: string; status: 'running' | 'done' | 'error'; durationMs: number | null; tools: number }
export interface SwarmUiState {
  threadId: string;
  status: 'running' | 'done' | 'awaiting_confirmation' | 'cancelled' | 'error';
  agents: Record<string, AgentRuntime>;
  pending: Pending | null;
}

export interface Task { id: string; title: string; due: string | null; priority: 'low' | 'normal' | 'high'; status: 'open' | 'done'; source: string; createdAt: string }
export interface Reminder { id: string; text: string; dueAt: string; status: string }
export interface SpendSummary { from: string; to: string; count: number; totalINR: number; byCategory: { category: string; amount: number }[]; recent: { id: string; date: string; amount: number; currency: string; category: string; note: string }[] }
export interface PriceWatch { id: string; query: string; targetPrice: number; lastPrice: number | null; bestLink: string | null; lastCheckedAt: string | null }
export interface CalendarEvent { id: string; title: string; start: string; end: string; allDay: boolean; location: string | null; attendees: string[]; meetLink: string | null; htmlLink: string | null }
export interface Dashboard { date: string; agenda: CalendarEvent[] | null; tasks: Task[]; reminders: Reminder[]; spend: SpendSummary; watches: PriceWatch[]; sheetUrl: string | null }
export interface Notification { id: string; channel: Channel; kind: string; text: string; status: string; createdAt: string; sentAt: string | null }

// ------------------------------------------------------------------ organisation & admin console
export interface DeskSettings {
  enabled: boolean;
  channels: ('telegram' | 'whatsapp')[];
  whatsappPhoneNumberId: string | null;
  instructions: string;
  greeting: string;
  escalateWhenUnsure: boolean;
  handoffMessage: string;
}
export interface OrgSettings { assistantName: string; accentColor: string | null; timezone: string; model: string | null; modelFast: string | null; desk: DeskSettings }
export interface OrgAdmin { id: string; name: string; slug: string; settings: OrgSettings; hasOpenaiKey: boolean; createdAt: string }
export interface Member { id: string; name: string; email: string; role: OrgRole; createdAt: string }
export interface Invite { code: string; role: OrgRole; email: string | null; expiresAt: string; createdAt: string; url?: string }
export interface Usage {
  members: number; conversations30d: number; actions30d: { agent: string; n: number }[];
  knowledge: { sources: number; chunks: number }; desk: Record<string, number>; proactiveMessages30d: number;
}
export interface ApprovalRow { id: string; title: string; channel: Channel; pending: Pending | null; updatedAt: string; userName: string; userEmail: string }
export interface AuditRow { id: string; channel: string; agent: string; action: string; detail: string; createdAt: string; userName: string }

export type Audience = 'staff' | 'customer' | 'both';
export interface CatalogTool { id: string; name: string; description: string; group: string; needsGoogle: boolean; alwaysConfirmed: boolean; customerSafe: boolean }
export interface AgentConfigRow {
  enabled: boolean; label: string | null; description: string | null; prompt: string | null; extraInstructions: string;
  model: string | null; tools: string[] | null; approvalTools: string[]; audience: Audience | null;
}
export interface AgentView {
  id: string; kind: 'builtin' | 'custom'; label: string; description: string; prompt: string; enabled: boolean; audience: Audience;
  model: string | null; toolIds: string[]; approvalTools: string[]; needsGoogle: boolean; customized: boolean;
  config: AgentConfigRow | null; defaultTools: string[] | null;
}
export interface Pack { id: string; name: string; description: string; agents: string[] }

export interface KbSource {
  id: string; name: string; type: 'file' | 'url' | 'text'; url: string | null; mime: string | null;
  status: 'processing' | 'ready' | 'error'; error: string | null; chunks: number; chars: number; createdAt: string; syncedAt: string | null;
}
export interface KbHit { n: number; source: string; page: number | null; url: string | null; score: number; text: string }

// ------------------------------------------------------------------ customer desk (handoff inbox)
export type ConversationStatus = 'bot' | 'waiting' | 'human' | 'closed';
export interface DeskConversation {
  id: string; channel: Channel; externalId: string; displayName: string | null; status: ConversationStatus;
  assignedTo: string | null; assigneeName: string | null; reason: string | null; summary: string | null; unread: number;
  lastMessageAt: string; lastText?: string | null; lastRole?: string | null;
}
export interface DeskMessage { id: string; role: 'customer' | 'bot' | 'staff' | 'system'; authorName: string | null; text: string; createdAt: string }
export interface DeskConversationDetail extends DeskConversation { messages: DeskMessage[] }

// ------------------------------------------------------------------ Studio (StoryForge)
export type StudioPlatform = 'shorts' | 'reels' | 'both';
export interface StudioSource { title: string; url: string; snippet: string; date?: string | null }
export interface StudioResearch {
  topic: string; summary: string; keyFacts: { fact: string; source: number }[]; angles: string[]; freshness: string;
  sources: StudioSource[]; provider: string; createdAt: string;
}
export interface StudioBeat { time: string; voiceover: string; onScreenText: string; visual: string }
export interface StudioScript {
  topic: string; platform: StudioPlatform; durationSec: number; tone: string; language: string; wordCount: number; createdAt: string;
  titles: string[]; hook: string; beats: StudioBeat[]; cta: string; caption: string; hashtags: string[]; thumbnailIdeas: string[];
  musicMood: string; sources: StudioSource[];
}
export interface StudioScriptResponse { script: StudioScript; markdown: string; teleprompter: string }
export interface StudioOptions { platforms: StudioPlatform[]; durations: number[]; tones: string[]; searchProvider: string }
