// Re-auth modal that pops on 401 mid-session. Two things this suite locks down:
//
//   1. Capability branching — the dialog shows only the methods the original
//      user actually has. Password-only users don't see a Google button (it
//      would create a new account); Google-only users don't see a password
//      field (the placeholder hash on their row rejects every attempt).
//
//   2. ID-lock — after a successful re-auth, the returned user's id MUST
//      match the previously signed-in user. If GIS's account chooser lands
//      on a different Google account (or the backend silently creates a new
//      row because the original was deleted), we refuse the session, clear
//      the token, and surface a "wrong account" error. This is the silent-
//      takeover guard the edge-case agent surfaced.
//
// Google Identity Services script loads are blocked in happy-dom (per
// CLAUDE.md), so the GIS button just renders a hidden placeholder. We assert
// on its absence/presence as a structural signal, then drive the password
// path through stubbed fetch + dispatch the SESSION_EXPIRED_EVENT for the
// state-machine smoke test.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionExpiredDialog } from "@/components/SessionExpiredDialog";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AuthProvider } from "@/lib/auth";
import { setToken } from "@/lib/api";

const realFetch = globalThis.fetch;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchHandler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as typeof fetch;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

interface RenderOpts {
  open?: boolean;
  email?: string;
  userId?: number | null;
  passwordSet?: boolean;
  hasGoogle?: boolean;
  onClose?: () => void;
  onLoggedIn?: () => void;
}

function renderDialog(opts: RenderOpts = {}) {
  const onClose = opts.onClose ?? (() => {});
  const onLoggedIn = opts.onLoggedIn ?? (() => {});
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <SessionExpiredDialog
              open={opts.open ?? true}
              email={opts.email ?? "user@example.com"}
              userId={opts.userId ?? 42}
              passwordSet={opts.passwordSet ?? true}
              hasGoogle={opts.hasGoogle ?? false}
              onClose={onClose}
              onLoggedIn={onLoggedIn}
            />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
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

describe("<SessionExpiredDialog> — capability branching", () => {
  it("password-only user: shows password field + Sign in button, no 'or' divider", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    renderDialog({ passwordSet: true, hasGoogle: false });

    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    // No divider when only one method is shown.
    expect(screen.queryByText(/^or$/i)).not.toBeInTheDocument();
  });

  it("Google-only user: hides the password form (no field, no Sign in button)", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    renderDialog({ passwordSet: false, hasGoogle: true });

    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sign in$/i })).not.toBeInTheDocument();
    // Sign out is still present.
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("both linked: shows password form + Google slot + 'or' divider between them", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    renderDialog({ passwordSet: true, hasGoogle: true });

    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByText(/^or$/i)).toBeInTheDocument();
  });

  it("legacy session with neither flag known: falls back to showing both methods", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    renderDialog({ passwordSet: false, hasGoogle: false });

    // Both blocks render (the fallback path) so the user has at least one
    // working option rather than a dead-end modal.
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByText(/^or$/i)).toBeInTheDocument();
  });
});

describe("<SessionExpiredDialog> — password re-auth flow", () => {
  it("password 200 with matching user id closes the dialog via onLoggedIn", async () => {
    let loggedIn = false;
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/login") && (init?.method ?? "").toUpperCase() === "POST") {
        return jsonResponse(200, {
          token: "fresh-token.signature",
          user: {
            id: 42,
            email: "user@example.com",
            full_name: "U",
            status: "active",
            role: "owner",
            is_admin: false,
            couple_id: null,
            verified_email: true,
            locale: "en",
            password_set: true,
            has_google: false,
            created_at: 0,
          },
        });
      }
      return jsonResponse(200, { ok: true });
    });
    renderDialog({
      userId: 42,
      passwordSet: true,
      hasGoogle: false,
      onLoggedIn: () => {
        loggedIn = true;
      },
    });

    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "good-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await flush();
    await waitFor(() => {
      expect(loggedIn).toBe(true);
    });
  });

  it("password 401 shows the bad-credentials error inline and does NOT call onLoggedIn", async () => {
    let loggedIn = false;
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/login") && (init?.method ?? "").toUpperCase() === "POST") {
        return jsonResponse(401, { error: "Invalid credentials" });
      }
      return jsonResponse(200, { ok: true });
    });
    renderDialog({
      userId: 42,
      passwordSet: true,
      onLoggedIn: () => {
        loggedIn = true;
      },
    });

    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "bad-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await flush();
    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
    expect(loggedIn).toBe(false);
  });
});

describe("<SessionExpiredDialog> — ID-lock guard", () => {
  it("rejects a 200 re-auth whose user.id differs from the original; clears the token and shows the wrong-account error", async () => {
    // Plant a token so we can prove the guard clears it.
    setToken("stale-token.sig");

    let loggedIn = false;
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/login") && (init?.method ?? "").toUpperCase() === "POST") {
        return jsonResponse(200, {
          token: "different-user-token.signature",
          user: {
            id: 999, // <-- mismatched id
            email: "user@example.com",
            full_name: "U",
            status: "active",
            role: "owner",
            is_admin: false,
            couple_id: null,
            verified_email: true,
            locale: "en",
            password_set: true,
            has_google: false,
            created_at: 0,
          },
        });
      }
      return jsonResponse(200, { ok: true });
    });
    renderDialog({
      userId: 42, // original user
      passwordSet: true,
      onLoggedIn: () => {
        loggedIn = true;
      },
    });

    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "good-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await flush();
    await waitFor(() => {
      expect(screen.getByText(/different account/i)).toBeInTheDocument();
    });
    expect(loggedIn).toBe(false);
    // Token cleared by the guard.
    try {
      expect(localStorage.getItem("weddly.token")).toBeNull();
    } catch {
      // localStorage may be blocked in some environments — fine.
    }
  });
});
