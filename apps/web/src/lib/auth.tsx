import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, post, session } from './api';

export interface Me {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  emailVerifiedAt: string | null;
  complexes: { id: string; name: string; type: string; role: string }[];
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
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
  const [complexId, setComplexId] = useState<string | null>(session.complex);

  const reload = useCallback(async () => {
    if (!session.access) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const m = await get<Me>('/me');
      setMe(m);
      if (!m.complexes.some((c) => c.id === session.complex) && m.complexes[0]) {
        session.setComplex(m.complexes[0].id);
        setComplexId(m.complexes[0].id);
      }
    } catch {
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
export const can = (role: string | undefined, action: 'manage' | 'finWrite' | 'finRead') =>
  !!role &&
  {
    manage: ['OWNER', 'ADMIN'],
    finWrite: ['OWNER', 'ADMIN', 'ACCOUNTANT'],
    finRead: ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'],
  }[action].includes(role);
