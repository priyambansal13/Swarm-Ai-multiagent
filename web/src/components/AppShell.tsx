'use client';

import { Brain, Headset, LayoutDashboard, LogOut, MessageSquare, Settings, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isAdmin, isStaff } from '@/lib/types';
import { useAuth } from './AuthProvider';
import { Logo } from './Logo';

const BASE_NAV = [
  { href: '/', label: 'Chat', icon: MessageSquare },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/memory', label: 'Memory', icon: Brain },
];
const INBOX = { href: '/inbox', label: 'Inbox', icon: Headset };
const ADMIN = { href: '/admin', label: 'Admin', icon: ShieldCheck };
const SETTINGS = { href: '/settings', label: 'Settings', icon: Settings };

/** Customer chats waiting for a person (staff only), refreshed every 20 s. */
function useWaiting(enabled: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => api<Record<string, { count: number }>>('/desk/counts').then((c) => alive && setN(c.waiting?.count ?? 0)).catch(() => undefined);
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled]);
  return n;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, loading, signOut } = useAuth();
  const pathname = usePathname();
  const bare = pathname.startsWith('/login') || pathname.startsWith('/signup');
  const role = me?.user.role;
  const waiting = useWaiting(!!me && isStaff(role) && !!me.org.deskEnabled);
  const NAV = [...BASE_NAV, ...(isStaff(role) ? [INBOX] : []), ...(isAdmin(role) ? [ADMIN] : []), SETTINGS];
  const badge = (href: string) => (href === '/inbox' && waiting ? <span className="ml-0.5 rounded-full bg-danger px-1.5 text-[10px] font-bold leading-4 text-white">{waiting}</span> : null);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  if (bare) return <>{children}</>;
  if (loading || !me) {
    return <div className="grid h-dvh place-items-center text-sm text-muted"><span className="hive-pulse">Loading SwarmAI…</span></div>;
  }

  return (
    <div className="flex h-dvh flex-col" style={me.org.accentColor ? ({ '--accent': me.org.accentColor } as React.CSSProperties) : undefined}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-5">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-lg font-semibold tracking-tight">{me.org.assistantName || 'SwarmAI'}</span>
        </Link>
        <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
                <Icon className="h-4 w-4" /> {label}{badge(href)}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-right text-sm leading-tight text-muted sm:block">{me.user.name}<span className="block text-[11px]">{me.org.name} · {role}</span></span>
          <button onClick={signOut} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink" aria-label="Sign out">
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      <nav style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }} className="grid shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? 'text-accent-strong' : 'text-muted'}`}>
              <span className="relative"><Icon className="h-5 w-5" />{waiting > 0 && href === '/inbox' && <span className="absolute -right-2 -top-1 rounded-full bg-danger px-1 text-[9px] font-bold leading-3 text-white">{waiting}</span>}</span> {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
