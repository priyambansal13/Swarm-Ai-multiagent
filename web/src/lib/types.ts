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

export interface User { id: string; email: string; name: string; timezone: string; settings: UserSettings }

export interface ChannelLink { id: string; channel: 'telegram' | 'whatsapp'; externalId: string; displayName: string | null; createdAt: string }

export interface Me {
  user: User;
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
