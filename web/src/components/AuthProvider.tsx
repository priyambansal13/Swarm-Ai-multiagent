'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '@/lib/api';
import type { Me } from '@/lib/types';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<AuthCtx>({ me: null, loading: true, refresh: async () => null, signIn: async () => {}, signOut: () => {} });
export const useAuth = () => useContext(Ctx);

const PUBLIC = ['/login', '/signup'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      return null;
    }
    try {
      const m = await api<Me>('/me');
      setMe(m);
      return m;
    } catch {
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
    if (!me && !isPublic) router.replace('/login');
    if (me && isPublic) router.replace('/');
  }, [loading, me, pathname, router]);

  const signIn = async (token: string) => {
    setToken(token);
    await refresh();
  };
  const signOut = () => {
    setToken(null);
    setMe(null);
    router.replace('/login');
  };

  return <Ctx.Provider value={{ me, loading, refresh, signIn, signOut }}>{children}</Ctx.Provider>;
}
