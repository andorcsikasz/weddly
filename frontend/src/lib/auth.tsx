// Auth provider — single source of truth for the current user. Reads token
// from localStorage on mount, hydrates the user via /api/auth/me.

import type { User } from "@shared/types";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, getToken, setToken as persistToken } from "./api";
import { authApi } from "./endpoints";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, fullName: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Accept an external session (e.g. after invite-accept) without bouncing through /api/auth/me. */
  setSession: (token: string, user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me.user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Token already cleared inside apiFetch.
        setUser(null);
      } else {
        // Keep last known user on a flake; next call will retry.
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await authApi.login({ email, password });
    persistToken(session.token);
    setUser(session.user);
    return session.user;
  }, []);

  const register = useCallback(async (email: string, password: string, fullName: string) => {
    const session = await authApi.register({ email, password, full_name: fullName });
    persistToken(session.token);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore network failures on logout — we clear state anyway
    }
    persistToken(null);
    setUser(null);
  }, []);

  const setSession = useCallback((token: string, u: User) => {
    persistToken(token);
    setUser(u);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh, setSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
