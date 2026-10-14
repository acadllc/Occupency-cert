import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getBackend, type Backend } from './backend';
import type { SessionInfo } from './auth';

interface SessionState {
  backend: Backend | null;
  session: SessionInfo | null;
  authorized: boolean | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionState>({ backend: null, session: null, authorized: null, loading: true, refresh: async () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const b = await getBackend();
    setBackend(b);
    const s = await b.auth.session();
    setSession(s);
    // server-side allow-list check (RLS function); never a client-side flag
    setAuthorized(s && !s.needsMfa ? await b.api.isAppUser() : null);
    setLoading(false);
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;
    refresh().then(async () => {
      const b = await getBackend();
      unsub = b.auth.onChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          window.location.hash = '#/reset-password';
        }
        void refresh();
      });
    });
    return () => unsub?.();
  }, []);

  return <Ctx.Provider value={{ backend, session, authorized, loading, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

export function useApi() {
  const { backend } = useSession();
  if (!backend) throw new Error('backend not ready');
  return backend.api;
}
