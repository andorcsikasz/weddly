// Auth provider — single source of truth for the current user. Reads token
// from localStorage on mount, hydrates the user via /api/auth/me.

import type { User } from "@shared/types";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { SessionExpiredDialog } from "../components/SessionExpiredDialog";
import { ApiError, getToken, SESSION_EXPIRED_EVENT, setToken as persistToken } from "./api";
import { authApi } from "./endpoints";
import { useT } from "./i18n";

const LOCALE_STORAGE_KEY = "weddly.locale";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Accept an external session (e.g. after invite-accept) without bouncing through /api/auth/me. */
  setSession: (token: string, user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // True when an /api/* call returned 401 mid-session — pops the re-login
  // modal so the user can resume without losing typed state.
  const [sessionExpired, setSessionExpired] = useState(false);
  const { setLocale: setI18nLocale } = useT();

  // Sync the server-stored `user.locale` into the in-memory i18n state
  // exactly once per login — but only if this device hasn't explicitly
  // chosen a locale yet (empty localStorage). The local choice trumps the
  // server preference on the device where the user made it. Server-stored
  // locale wins on fresh devices where there's nothing to override.
  useEffect(() => {
    if (!user?.locale) return;
    let hasLocalChoice = false;
    try {
      hasLocalChoice = window.localStorage.getItem(LOCALE_STORAGE_KEY) !== null;
    } catch {
      // localStorage blocked — fall through and apply the server pref.
    }
    if (!hasLocalChoice) {
      setI18nLocale(user.locale);
    }
  }, [user?.locale, setI18nLocale]);

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
        // The /me probe was the one that 401'd. There's nothing in flight to
        // preserve here — just clear the user and let the regular auth
        // redirect (RequireAuth) move them to /login.
        persistToken(null);
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

  // Listen for fetch-layer 401s. We only open the modal if a user is
  // currently signed in — otherwise the regular login form is already
  // sufficient and we'd just stack two prompts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onExpired() {
      // Re-check the latest user via closure trick: setState callback form.
      setUser((cur) => {
        if (cur) setSessionExpired(true);
        return cur;
      });
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await authApi.login({ email, password });
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
    setSessionExpired(false);
    // Tell Google Identity Services the user explicitly signed out so the
    // next visit to /login doesn't auto_select them back in via One Tap.
    // Safe to call when GSI was never loaded — the optional chain no-ops.
    const gsi = (
      window as unknown as {
        google?: { accounts?: { id?: { disableAutoSelect?: () => void } } };
      }
    ).google?.accounts?.id;
    gsi?.disableAutoSelect?.();
  }, []);

  const setSession = useCallback((token: string, u: User) => {
    persistToken(token);
    setUser(u);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, setSession }}>
      {children}
      <SessionExpiredDialog
        open={sessionExpired}
        email={user?.email ?? ""}
        onClose={() => setSessionExpired(false)}
        onLoggedIn={() => setSessionExpired(false)}
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
