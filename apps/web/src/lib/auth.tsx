import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, get, OFFLINE_MESSAGE, post, session } from './api';

export interface Me {
  id: string;
  email: string | null;
  username: string | null;
  fullName: string;
  phone: string | null;
  isSuperAdmin: boolean;
  emailVerifiedAt: string | null;
  complexes: { id: string; name: string; type: string; role: string; status: string; unitCode: string | null; logoVersion: string | null }[];
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  /** La API no responde por estar fuera del horario de servicio. */
  offline: boolean;
  complex: Me['complexes'][number] | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: Record<string, string>) => Promise<void>;
  logout: () => void;
  selectComplex: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

type Tokens = { accessToken: string; refreshToken: string };

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [complexId, setComplexId] = useState<string | null>(session.complex);

  const reload = useCallback(async () => {
    if (!session.access) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const m = await get<Me>('/me');
      setOffline(false);
      setMe(m);
      if (!m.complexes.some((c) => c.id === session.complex) && m.complexes[0]) {
        const first = m.complexes.find((c) => c.status === 'ACTIVE') ?? m.complexes[0];
        session.setComplex(first.id);
        setComplexId(first.id);
      }
    } catch (e) {
      setOffline(e instanceof ApiError && e.message === OFFLINE_MESSAGE);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value: AuthCtx = {
    me,
    loading,
    offline,
    complex: me?.complexes.find((c) => c.id === complexId) ?? null,
    async login(email, password) {
      session.setTokens(await post<Tokens>('/auth/login', { email, password }));
      await reload();
    },
    async register(data) {
      session.setTokens(await post<Tokens>('/auth/register', data));
      await reload();
    },
    logout() {
      session.clear();
      qc.clear();
      setMe(null);
    },
    selectComplex(id) {
      session.setComplex(id);
      setComplexId(id);
      qc.clear();
    },
    reload,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Permisos en UI (la API es la que realmente los hace cumplir). */
export const can = (role: string | undefined, action: 'manage' | 'finWrite' | 'finRead' | 'internal' | 'resident') =>
  !!role &&
  {
    manage: ['OWNER', 'ADMIN'],
    finWrite: ['OWNER', 'ADMIN', 'ACCOUNTANT'],
    finRead: ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'],
    internal: ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER'],
    resident: ['RESIDENT'],
  }[action].includes(role);
