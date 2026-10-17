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

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
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

export const ENTITIES = [
  User, ChannelLink, LinkCode, GoogleAccount, Thread, Note, ProfileFact, Task, Reminder, Expense, Contact,
  TravelLogEntry, EmailDigestEntry, PriceWatch, Activity, OutboxMessage, AutomationState,
];
