'use client';

import { Activity, Bot, Building2, ClipboardCheck, Headset, LayoutGrid, Library, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAdmin } from '@/lib/types';
import { useAuth } from '../AuthProvider';
import { AgentsTab } from './AgentsTab';
import { ApprovalsTab, AuditTab, OverviewTab } from './ActivityTabs';
import { DeskTab } from './DeskTab';
import { KnowledgeTab } from './KnowledgeTab';
import { MembersTab } from './MembersTab';
import { OrgTab } from './OrgTab';

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid, View: OverviewTab },
  { key: 'org', label: 'Organisation', icon: Building2, View: OrgTab },
  { key: 'members', label: 'Members', icon: Users, View: MembersTab },
  { key: 'agents', label: 'Agents', icon: Bot, View: AgentsTab },
  { key: 'knowledge', label: 'Knowledge', icon: Library, View: KnowledgeTab },
  { key: 'desk', label: 'Customer desk', icon: Headset, View: DeskTab },
  { key: 'approvals', label: 'Approvals', icon: ClipboardCheck, View: ApprovalsTab },
  { key: 'audit', label: 'Audit log', icon: Activity, View: AuditTab },
] as const;

export type TabKey = (typeof TABS)[number]['key'];

/** Admin console (owners and admins): organisation, members, agents, knowledge, customer desk, approvals, audit, usage. */
export function AdminView() {
  const { me } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as TabKey;
  const go = (k: TabKey) => router.replace(`/admin?tab=${k}`);
  if (!me) return null;
  if (!isAdmin(me.user.role)) return <p className="p-8 text-sm text-muted">The admin console is for owners and admins of {me.org.name}.</p>;
  const { View } = TABS.find((t) => t.key === tab)!;
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav aria-label="Admin" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-2 scroll-thin md:w-56 md:flex-col md:border-b-0 md:border-r md:px-3 md:py-5">
        <div className="hidden px-2 pb-3 md:block">
          <div className="font-display text-lg font-semibold leading-tight">{me.org.name}</div>
          <div className="text-xs text-muted">Admin console</div>
        </div>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => go(key)} className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === key ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </nav>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
          <View go={go} />
        </div>
      </div>
    </div>
  );
}
