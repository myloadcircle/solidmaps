'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@/shared/types';
import { api, getToken, setToken } from './api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getToken();
    if (!stored) {
      setLoading(false);
      return;
    }
    setTokenState(stored);
    api
      .getUser()
      .then(setUser)
      .catch(() => {
        setToken(null);
        setTokenState(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string) => {
    const res = await api.issueToken(email);
    setToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
