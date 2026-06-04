// Regression coverage for the "registration just serves the demo" bug.
//
// Launching the Shrek & Fiona demo leaves an "authed" throwaway session in
// localStorage (`weddly.token` + `weddly.demo_session = "1"`). Before the fix,
// <RedirectIfAuthed> saw that session as a signed-in user and bounced every
// visit to /signup or /login straight back to /app — the demo workspace. So a
// visitor who tried the demo and then went to register got the demo again and
// could never reach the form unless they used the in-overlay convert button.
//
// The fix: a *demo* session arriving at an auth form is intent to convert.
// The guard tears the demo down (clears the flag + logs out) and renders the
// form. A *real* session still redirects to /app.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RedirectIfAuthed } from "@/App";
import RegisterPage from "@/pages/RegisterPage";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/ToastProvider";

type FetchHandler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
const fetchCalls: { url: string; method: string }[] = [];

const DEMO_FLAG_KEY = "weddly.demo_session";
const TOKEN_KEY = "weddly.token";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(handler: FetchHandler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    fetchCalls.push({ url, method });
    return handler(url, init);
  }) as typeof fetch;
}

const DEMO_USER = {
  id: 99,
  email: "demo-abc123@demo.weddly.local",
  full_name: "Shrek",
  role: "owner",
  verified_email: true,
  status: "active",
  created_at: 0,
};

const REAL_USER = {
  id: 1,
  email: "real@x.com",
  full_name: "Real Person",
  role: "owner",
  verified_email: true,
  status: "active",
  created_at: 0,
};

/** Mirrors how App.tsx wraps the signup route: RedirectIfAuthed → RegisterPage,
 *  with a catch-all that proves a redirect to /app happened. */
function GuardedSignup({ initialEntries }: { initialEntries: string[] }) {
  const children: ReactNode = (
    <RedirectIfAuthed>
      <RegisterPage />
    </RedirectIfAuthed>
  );
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/signup" element={children} />
              <Route path="*" element={<div data-testid="redirect-target">redirected</div>} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchCalls.length = 0;
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    // ignore
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("RedirectIfAuthed + demo session", () => {
  it("renders the signup form (does NOT bounce to /app) when the live session is a demo", async () => {
    // Demo launch state: a token + the demo flag are both in localStorage.
    localStorage.setItem(TOKEN_KEY, "demo-token.sig");
    localStorage.setItem(DEMO_FLAG_KEY, "1");
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return jsonResponse(200, { user: DEMO_USER });
      // /api/auth/logout and anything else
      return jsonResponse(200, { ok: true });
    });

    render(<GuardedSignup initialEntries={["/signup"]} />);

    // The signup form renders — the visitor reaches registration instead of
    // being bounced into the demo workspace.
    await waitFor(() => {
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("redirect-target")).not.toBeInTheDocument();
  });

  it("tears the demo down: clears the demo flag and logs out", async () => {
    localStorage.setItem(TOKEN_KEY, "demo-token.sig");
    localStorage.setItem(DEMO_FLAG_KEY, "1");
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return jsonResponse(200, { user: DEMO_USER });
      return jsonResponse(200, { ok: true });
    });

    render(<GuardedSignup initialEntries={["/signup"]} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    });
    // The teardown fires logout and removes the demo flag so it can't leak
    // onto the real account the visitor is about to create.
    await waitFor(() => {
      expect(
        fetchCalls.some((c) => c.url.endsWith("/api/auth/logout") && c.method === "POST"),
      ).toBe(true);
    });
    expect(localStorage.getItem(DEMO_FLAG_KEY)).toBeNull();
  });

  it("still redirects a REAL signed-in session away from /signup to /app", async () => {
    // Real session: token present, but no demo flag.
    localStorage.setItem(TOKEN_KEY, "real-token.sig");
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return jsonResponse(200, { user: REAL_USER });
      return jsonResponse(200, { ok: true });
    });

    render(<GuardedSignup initialEntries={["/signup"]} />);

    // Real session bounces to /app — the catch-all marker takes over and the
    // signup form is never shown.
    await waitFor(() => {
      expect(screen.getByTestId("redirect-target")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument();
    // A real session is left intact — no logout was issued.
    expect(fetchCalls.some((c) => c.url.endsWith("/api/auth/logout"))).toBe(false);
  });
});
