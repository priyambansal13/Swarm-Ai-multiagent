import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type Channel = 'web' | 'telegram' | 'whatsapp';
export type LinkedChannel = 'telegram' | 'whatsapp';

export interface UserSettings {
  /** Morning brief time HH:mm in the user's timezone */
  briefTime: string;
  briefEnabled: boolean;
  /** Where proactive messages go (brief, reminders, alerts) */
  notifyChannel: Channel;
  /** Reply with a voice note when the user sent a voice note */
  voiceReplies: boolean;
  newsTopics: string[];
  homeCity: string | null;
  triageEnabled: boolean;
  meetingPrepEnabled: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  briefTime: '08:00',
  briefEnabled: true,
  notifyChannel: 'telegram',
  voiceReplies: true,
  newsTopics: [],
  homeCity: null,
  triageEnabled: true,
  meetingPrepEnabled: true,
};

// ------------------------------------------------------------------ organisations (multi-tenancy)

export type OrgRole = 'owner' | 'admin' | 'agent' | 'member';
export const STAFF_ROLES: OrgRole[] = ['owner', 'admin', 'agent'];
export const ADMIN_ROLES: OrgRole[] = ['owner', 'admin'];

/** Customer desk: unknown senders on the org's WhatsApp/Telegram talk to the org's bot, with human handoff. */
export interface DeskSettings {
  enabled: boolean;
  channels: LinkedChannel[];
  /** Meta phone_number_id this org answers on (blank = any number of this server) */
  whatsappPhoneNumberId: string | null;
  /** Business context for the customer-facing assistant ("We are Acme Dental, Pune…") */
  instructions: string;
  greeting: string;
  /** Hand over to a person when the knowledge base has no answer */
  escalateWhenUnsure: boolean;
  /** Sent to the customer when a person takes over */
  handoffMessage: string;
}

export interface OrgSettings {
  assistantName: string;
  accentColor: string | null;
  timezone: string;
  /** Chat models for this org (blank = server defaults) */
  model: string | null;
  modelFast: string | null;
  /** AES-GCM encrypted OpenAI key of the org (blank = server key) */
  openaiKeyEnc: string | null;
  desk: DeskSettings;
}

export const DEFAULT_DESK: DeskSettings = {
  enabled: false,
  channels: ['whatsapp', 'telegram'],
  whatsappPhoneNumberId: null,
  instructions: '',
  greeting: '',
  escalateWhenUnsure: true,
  handoffMessage: "I've passed this to our team — a person will reply here shortly.",
};

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  assistantName: 'SwarmAI',
  accentColor: null,
  timezone: 'Asia/Kolkata',
  model: null,
  modelFast: null,
  openaiKeyEnc: null,
  desk: DEFAULT_DESK,
};

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar' }) name: string;
  @Index({ unique: true }) @Column({ type: 'varchar' }) slug: string;
  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_ORG_SETTINGS).replace(/'/g, "''")}'` }) settings: OrgSettings;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

/** One-time invitation to join an organisation with a role. */
@Entity('org_invites')
export class OrgInvite {
  @PrimaryColumn({ type: 'varchar' }) code: string;
  @Index() @Column({ type: 'uuid' }) orgId: string;
  @Column({ type: 'varchar' }) role: OrgRole;
  @Column({ type: 'varchar', nullable: true }) email: string | null;
  @Column({ type: 'uuid' }) createdBy: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) usedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** Each user belongs to one organisation; personal data stays scoped by userId, shared data by orgId. */
  @Index() @Column({ type: 'uuid', nullable: true }) orgId: string;
  @Column({ type: 'varchar', default: 'owner' }) role: OrgRole;
  @Index({ unique: true }) @Column({ type: 'varchar' }) email: string;
  @Column({ type: 'varchar' }) name: string;
  @Column({ type: 'varchar' }) passwordHash: string;
  @Column({ type: 'varchar', default: 'Asia/Kolkata' }) timezone: string;
  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_SETTINGS)}'` }) settings: UserSettings;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

/** A Telegram chat or WhatsApp number linked to a user (one bot / one number serves everyone). */
@Entity('channel_links')
@Index(['channel', 'externalId'], { unique: true })
export class ChannelLink {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) channel: LinkedChannel;
  @Column({ type: 'varchar' }) externalId: string;
  @Column({ type: 'varchar', nullable: true }) displayName: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('link_codes')
export class LinkCode {
  @PrimaryColumn({ type: 'varchar' }) code: string;
  @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) channel: LinkedChannel;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
}

@Entity('google_accounts')
export class GoogleAccount {
  @PrimaryColumn({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) email: string;
  /** AES-256-GCM encrypted refresh token */
  @Column({ type: 'text' }) refreshTokenEnc: string;
  @Column({ type: 'text' }) scopes: string;
  @Column({ type: 'varchar', nullable: true }) spreadsheetId: string | null;
  @Column({ type: 'varchar', nullable: true }) spreadsheetUrl: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) connectedAt: Date;
}

export interface PendingActionView {
  id: string;
  agent: string;
  kind: string;
  summary: string;
}

@Entity('threads')
export class Thread {
  @PrimaryColumn({ type: 'varchar' }) id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) channel: Channel;
  @Column({ type: 'varchar', default: 'New conversation' }) title: string;
  @Column({ type: 'varchar', default: 'idle' }) status: 'idle' | 'running' | 'awaiting_confirmation';
  @Column({ type: 'jsonb', nullable: true }) pending: { interruptId: string; actions: PendingActionView[] } | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('notes')
export class Note {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) title: string;
  @Column({ type: 'text' }) content: string;
  @Column({ type: 'jsonb', default: () => "'[]'" }) tags: string[];
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

/** Long-term personal facts ("I'm vegetarian", "my manager is Asha") injected into every conversation. */
@Entity('profile_facts')
export class ProfileFact {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'text' }) fact: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) title: string;
  @Column({ type: 'timestamptz', nullable: true }) due: Date | null;
  @Column({ type: 'varchar', default: 'normal' }) priority: 'low' | 'normal' | 'high';
  @Column({ type: 'varchar', default: 'open' }) status: 'open' | 'done';
  @Column({ type: 'varchar', default: 'chat' }) source: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
}

@Entity('reminders')
export class Reminder {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'text' }) text: string;
  @Index() @Column({ type: 'timestamptz' }) dueAt: Date;
  @Column({ type: 'varchar', default: 'pending' }) status: 'pending' | 'sent' | 'cancelled';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'date' }) date: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: { to: (v: number) => v, from: (v: string) => Number(v) } }) amount: number;
  @Column({ type: 'varchar', default: 'INR' }) currency: string;
  @Column({ type: 'varchar' }) category: string;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'varchar', default: 'chat' }) source: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('contacts')
export class Contact {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) name: string;
  @Column({ type: 'varchar', nullable: true }) email: string | null;
  @Column({ type: 'varchar', nullable: true }) phone: string | null;
  @Column({ type: 'text', default: '' }) notes: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('travel_log')
export class TravelLogEntry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) trip: string;
  @Column({ type: 'varchar', default: '' }) dates: string;
  @Column({ type: 'text', default: '' }) details: string;
  @Column({ type: 'numeric', nullable: true, transformer: { to: (v: number | null) => v, from: (v: string | null) => (v == null ? null : Number(v)) } }) estCost: number | null;
  @Column({ type: 'text', default: '' }) links: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('email_digest')
export class EmailDigestEntry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) messageId: string;
  @Column({ type: 'varchar' }) sender: string;
  @Column({ type: 'varchar' }) subject: string;
  @Column({ type: 'text' }) summary: string;
  @Column({ type: 'varchar' }) category: string;
  @Column({ type: 'varchar' }) urgency: 'high' | 'normal' | 'low';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('price_watches')
export class PriceWatch {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) query: string;
  @Column({ type: 'numeric', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } }) targetPrice: number;
  @Column({ type: 'numeric', nullable: true, transformer: { to: (v: number | null) => v, from: (v: string | null) => (v == null ? null : Number(v)) } }) lastPrice: number | null;
  @Column({ type: 'text', nullable: true }) bestLink: string | null;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ type: 'timestamptz', nullable: true }) lastCheckedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('activity')
export class Activity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) channel: string;
  @Column({ type: 'varchar' }) agent: string;
  @Column({ type: 'varchar' }) action: string;
  @Column({ type: 'text' }) detail: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

/** Proactive messages waiting for delivery by n8n (reminders, briefs, alerts) — outbox pattern. */
@Entity('outbox')
export class OutboxMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) channel: Channel;
  @Column({ type: 'varchar', nullable: true }) externalId: string | null;
  @Column({ type: 'varchar' }) kind: string;
  @Column({ type: 'text' }) text: string;
  @Index() @Column({ type: 'varchar', default: 'pending' }) status: 'pending' | 'sending' | 'sent' | 'failed' | 'read';
  @Column({ type: 'text', nullable: true }) error: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) sentAt: Date | null;
}

/** Per-user bookkeeping for scheduled jobs (last run, processed ids). */
@Entity('automation_state')
export class AutomationState {
  @PrimaryColumn({ type: 'uuid' }) userId: string;
  @PrimaryColumn({ type: 'varchar' }) job: string;
  @Column({ type: 'timestamptz', nullable: true }) lastRunAt: Date | null;
  @Column({ type: 'jsonb', default: () => "'{}'" }) data: Record<string, any>;
}

// ------------------------------------------------------------------ config-driven agents

export type AgentAudience = 'staff' | 'customer' | 'both';

/**
 * Per-org agent registry row. For a built-in agent it overrides the code defaults (null = keep default);
 * a custom agent is defined entirely here, using tools from the shared tool catalogue.
 */
@Entity('agent_configs')
@Index(['orgId', 'agentId'], { unique: true })
export class AgentConfig {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) orgId: string;
  @Column({ type: 'varchar' }) agentId: string;
  @Column({ type: 'varchar', default: 'builtin' }) kind: 'builtin' | 'custom';
  @Column({ type: 'boolean', default: true }) enabled: boolean;
  @Column({ type: 'varchar', nullable: true }) label: string | null;
  @Column({ type: 'text', nullable: true }) description: string | null;
  /** Replaces the agent's prompt (custom agents: required) */
  @Column({ type: 'text', nullable: true }) prompt: string | null;
  /** Appended to the prompt — the safe way to tune a built-in agent */
  @Column({ type: 'text', default: '' }) extraInstructions: string;
  @Column({ type: 'varchar', nullable: true }) model: string | null;
  /** Tool names from the catalogue (null = the built-in agent's own tools) */
  @Column({ type: 'jsonb', nullable: true }) tools: string[] | null;
  /** Extra tools that must be approved by the user before they run */
  @Column({ type: 'jsonb', default: () => "'[]'" }) approvalTools: string[];
  @Column({ type: 'varchar', nullable: true }) audience: AgentAudience | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

// ------------------------------------------------------------------ knowledge base (chunks + vectors live in kb_chunks, raw SQL)

@Entity('kb_sources')
export class KbSource {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) orgId: string;
  @Column({ type: 'varchar' }) name: string;
  @Column({ type: 'varchar' }) type: 'file' | 'url' | 'text';
  @Column({ type: 'text', nullable: true }) url: string | null;
  @Column({ type: 'varchar', nullable: true }) mime: string | null;
  @Column({ type: 'varchar', default: 'processing' }) status: 'processing' | 'ready' | 'error';
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'int', default: 0 }) chunks: number;
  @Column({ type: 'int', default: 0 }) chars: number;
  @Column({ type: 'uuid' }) createdBy: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) syncedAt: Date | null;
}

// ------------------------------------------------------------------ customer desk (human handoff)

export type ConversationStatus = 'bot' | 'waiting' | 'human' | 'closed';

/** A customer chatting with an organisation's WhatsApp/Telegram desk. */
@Entity('conversations')
@Index(['orgId', 'channel', 'externalId'], { unique: true })
export class Conversation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) orgId: string;
  /** 'web' = the admin console's "test as a customer" simulator */
  @Column({ type: 'varchar' }) channel: Channel;
  @Column({ type: 'varchar' }) externalId: string;
  @Column({ type: 'varchar', nullable: true }) displayName: string | null;
  @Index() @Column({ type: 'varchar', default: 'bot' }) status: ConversationStatus;
  @Column({ type: 'uuid', nullable: true }) assignedTo: string | null;
  @Column({ type: 'text', nullable: true }) reason: string | null;
  @Column({ type: 'text', nullable: true }) summary: string | null;
  @Column({ type: 'int', default: 0 }) unread: number;
  @Column({ type: 'timestamptz', default: () => 'now()' }) lastMessageAt: Date;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('conversation_messages')
export class ConversationMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) conversationId: string;
  @Column({ type: 'varchar' }) role: 'customer' | 'bot' | 'staff' | 'system';
  @Column({ type: 'uuid', nullable: true }) authorId: string | null;
  @Column({ type: 'varchar', nullable: true }) authorName: string | null;
  @Column({ type: 'text' }) text: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const ENTITIES = [
  Organization, OrgInvite, AgentConfig, KbSource, Conversation, ConversationMessage,
  User, ChannelLink, LinkCode, GoogleAccount, Thread, Note, ProfileFact, Task, Reminder, Expense, Contact,
  TravelLogEntry, EmailDigestEntry, PriceWatch, Activity, OutboxMessage, AutomationState,
];
