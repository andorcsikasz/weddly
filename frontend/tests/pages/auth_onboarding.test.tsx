// Pure component tests for the auth + onboarding surfaces. We stub
// globalThis.fetch per-test so nothing reaches the network — each scenario
// pins one or two HTTP shapes and asserts on the rendered DOM the user sees.
//
// The provider stack (MemoryRouter → I18n → Toast → Auth) mirrors what App.tsx
// wraps every page in. AuthProvider issues an /api/auth/me probe on mount when
// a token is present in localStorage; we wipe localStorage before each test so
// every render starts unauthenticated.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import LoginPage from "@/pages/LoginPage";
import OnboardingWizard from "@/pages/OnboardingWizard";
import RegisterPage from "@/pages/RegisterPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/ToastProvider";

// ---------------------------------------------------------------------------
// Test infra
// ---------------------------------------------------------------------------

type FetchHandler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
const fetchCalls: { url: string; method: string; body: unknown }[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Install a request-router fetch mock. The handler picks a response based on
 *  method+path. Anything unmatched returns a 200 `{ok:true}` so a stray probe
 *  (e.g. AuthProvider's /api/auth/me) doesn't blow up the test. */
function installFetch(handler: FetchHandler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    fetchCalls.push({ url, method, body: parsedBody });
    return handler(url, init);
  }) as typeof fetch;
}

function ProviderStack({
  initialEntries,
  path,
  children,
}: {
  initialEntries: string[];
  path: string;
  children: ReactNode;
}) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path={path} element={children} />
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
  // Force EN locale so test assertions read deterministically.
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

/** Wait one microtask + macrotask so React flushes effects + state updates
 *  triggered by mocked-fetch promise resolutions. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ---------------------------------------------------------------------------
// <LoginPage>
// ---------------------------------------------------------------------------

describe("<LoginPage>", () => {
  it("renders email + password fields, submit button, and the forgot link", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/login"]} path="/login">
        <LoginPage />
      </ProviderStack>,
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /forgot your password/i })).toBeInTheDocument();
  });

  it("renders the Google sign-in slot (hidden when VITE_GOOGLE_CLIENT_ID is unset, but the form keeps an 'or' divider)", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/login"]} path="/login">
        <LoginPage />
      </ProviderStack>,
    );
    // The divider between Google + email is always present even when the
    // Google button hides itself for missing VITE_GOOGLE_CLIENT_ID — proves the
    // page wires both auth options into the same column.
    expect(screen.getByText(/^or$/i)).toBeInTheDocument();
  });

  it("shows a bad-credentials message after a 401 from /api/auth/login", async () => {
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/login") && (init?.method ?? "").toUpperCase() === "POST") {
        return jsonResponse(401, { error: "Invalid credentials" });
      }
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/login"]} path="/login">
        <LoginPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "wrong@x.com" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "bad-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      // Multiple `role="alert"` elements live in the tree (ToastProvider's
      // live region is one), so we match the inline field error by its text.
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
  });

  it("navigates away from /login after a successful 200 login", async () => {
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/login") && (init?.method ?? "").toUpperCase() === "POST") {
        return jsonResponse(200, {
          token: "test-token.signature",
          user: {
            id: 1,
            email: "ok@x.com",
            full_name: "OK",
            role: "user",
            verified_email: true,
            status: "active",
            created_at: 0,
          },
        });
      }
      // /api/auth/me — the refresh after setToken fires this once the
      // navigation routes the user onto /app; return same user shape.
      return jsonResponse(200, {
        user: {
          id: 1,
          email: "ok@x.com",
          full_name: "OK",
          role: "user",
          verified_email: true,
          status: "active",
          created_at: 0,
        },
      });
    });
    render(
      <ProviderStack initialEntries={["/login"]} path="/login">
        <LoginPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ok@x.com" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "good-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await flush();
    // After navigate("/app"), the catch-all route takes over with our marker.
    await waitFor(() => {
      expect(screen.getByTestId("redirect-target")).toBeInTheDocument();
    });
  });

  it("posts the typed credentials to /api/auth/login (trimmed email)", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/login")) return jsonResponse(401, { error: "no" });
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/login"]} path="/login">
        <LoginPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "  spaced@x.com  " } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "abcdefgh" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await flush();
    const loginCall = fetchCalls.find((c) => c.url.endsWith("/api/auth/login"));
    expect(loginCall).toBeDefined();
    expect((loginCall?.body as { email: string }).email).toBe("spaced@x.com");
  });
});

// ---------------------------------------------------------------------------
// <RegisterPage>
// ---------------------------------------------------------------------------

describe("<RegisterPage>", () => {
  it("renders all the required fields (full name, email, password, confirm)", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/signup"]} path="/signup">
        <RegisterPage />
      </ProviderStack>,
    );
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password\b/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("renders inline clickwrap consent microcopy that names both Privacy + Terms", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/signup"]} path="/signup">
        <RegisterPage />
      </ProviderStack>,
    );
    expect(screen.getByRole("link", { name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /terms of use/i })).toBeInTheDocument();
  });

  it("submits privacy_version + terms_version in the registration payload", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/register")) {
        return jsonResponse(200, {
          token: "t.sig",
          user: {
            id: 2,
            email: "new@x.com",
            full_name: "New User",
            role: "user",
            verified_email: false,
            status: "active",
            created_at: 0,
          },
        });
      }
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/signup"]} path="/signup">
        <RegisterPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "new@x.com" } });
    fireEvent.change(screen.getByLabelText(/^password\b/i), { target: { value: "longpass1" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "longpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await flush();
    const call = fetchCalls.find((c) => c.url.endsWith("/api/auth/register"));
    expect(call).toBeDefined();
    const body = call?.body as Record<string, string>;
    expect(body.email).toBe("new@x.com");
    expect(body.full_name).toBe("New User");
    expect(typeof body.privacy_version).toBe("string");
    expect(typeof body.terms_version).toBe("string");
    // noUncheckedIndexedAccess: the typeof assertions above prove these
    // exist; assert non-null explicitly so tsc binds the `.length` access.
    expect(body.privacy_version!.length).toBeGreaterThan(0);
    expect(body.terms_version!.length).toBeGreaterThan(0);
  });

  it("shows a duplicate-email error message on 409", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/register")) {
        return jsonResponse(409, { error: "Email already exists" });
      }
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/signup"]} path="/signup">
        <RegisterPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "dup@x.com" } });
    fireEvent.change(screen.getByLabelText(/^password\b/i), { target: { value: "longpass1" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "longpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByText(/already registered/i)).toBeInTheDocument();
    });
  });

  it("blocks the form (shows mismatch error) when passwords don't match — no network call", async () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/signup"]} path="/signup">
        <RegisterPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Mismatch" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "m@x.com" } });
    fireEvent.change(screen.getByLabelText(/^password\b/i), { target: { value: "longpass1" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "otherpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await flush();
    // The form-level alert appears after submit; the confirm field also shows
    // its own inline mismatch hint, hence "at least one".
    const alerts = screen.getAllByText(/don't match/i);
    expect(alerts.length).toBeGreaterThan(0);
    expect(fetchCalls.some((c) => c.url.endsWith("/api/auth/register"))).toBe(false);
  });

  it("shows the 'check your inbox' interstitial after a successful register", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/register")) {
        return jsonResponse(200, {
          token: "t.sig",
          user: {
            id: 3,
            email: "verify-me@x.com",
            full_name: "Verify Me",
            role: "user",
            verified_email: false,
            status: "active",
            created_at: 0,
          },
        });
      }
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/signup"]} path="/signup">
        <RegisterPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Verify Me" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "verify-me@x.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password\b/i), { target: { value: "longpass1" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "longpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
    });
    expect(screen.getByText("verify-me@x.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue to planning/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// <ForgotPasswordPage>
// ---------------------------------------------------------------------------

describe("<ForgotPasswordPage>", () => {
  it("renders the email field and the 'send reset link' submit button", () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/forgot-password"]} path="/forgot-password">
        <ForgotPasswordPage />
      </ProviderStack>,
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });

  it("calls POST /api/auth/forgot with the typed email", async () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/forgot-password"]} path="/forgot-password">
        <ForgotPasswordPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "lost@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await flush();
    const call = fetchCalls.find((c) => c.url.endsWith("/api/auth/forgot"));
    expect(call).toBeDefined();
    expect(call?.method).toBe("POST");
    expect((call?.body as { email: string }).email).toBe("lost@x.com");
  });

  it("shows the no-enumeration confirmation copy after a successful submit", async () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/forgot-password"]} path="/forgot-password">
        <ForgotPasswordPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "lost@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      // The exact "if an account exists for {email}" copy proves the page
      // never confirms whether the address is registered.
      expect(screen.getByText(/if an account exists for/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// <ResetPasswordPage>
// ---------------------------------------------------------------------------

describe("<ResetPasswordPage>", () => {
  it("posts the URL :token and new password to /api/auth/reset", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/reset")) return jsonResponse(200, { ok: true });
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack
        initialEntries={["/reset-password/the-secret-token"]}
        path="/reset-password/:token"
      >
        <ResetPasswordPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "freshpass1" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "freshpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await flush();
    const call = fetchCalls.find((c) => c.url.endsWith("/api/auth/reset"));
    expect(call).toBeDefined();
    const body = call?.body as { token: string; password: string };
    expect(body.token).toBe("the-secret-token");
    expect(body.password).toBe("freshpass1");
  });

  it("shows the 'invalid or expired link' message on a 400 from /reset", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/reset"))
        return jsonResponse(400, { error: "Invalid or expired token" });
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/reset-password/bad-token"]} path="/reset-password/:token">
        <ResetPasswordPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "freshpass1" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "freshpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    });
  });

  it("shows the 'password updated' confirmation on success", async () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/reset-password/good-token"]} path="/reset-password/:token">
        <ResetPasswordPage />
      </ProviderStack>,
    );
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "freshpass1" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "freshpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await waitFor(() => {
      expect(screen.getByText(/password updated/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// <VerifyEmailPage>
// ---------------------------------------------------------------------------

describe("<VerifyEmailPage>", () => {
  it("calls POST /api/auth/verify/:token on mount", async () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/verify-email/some-token-xyz"]} path="/verify-email/:token">
        <VerifyEmailPage />
      </ProviderStack>,
    );
    await flush();
    const call = fetchCalls.find((c) => c.url.includes("/api/auth/verify/"));
    expect(call).toBeDefined();
    expect(call?.method).toBe("POST");
    expect(call?.url).toContain("some-token-xyz");
  });

  it("renders the 'email confirmed' message after a successful verify", async () => {
    installFetch(() => jsonResponse(200, { ok: true }));
    render(
      <ProviderStack initialEntries={["/verify-email/good-token"]} path="/verify-email/:token">
        <VerifyEmailPage />
      </ProviderStack>,
    );
    await waitFor(() => {
      expect(screen.getByText(/email confirmed/i)).toBeInTheDocument();
    });
    // Unauthenticated, so the CTA is back-to-sign-in (not back-to-app).
    expect(screen.getByRole("link", { name: /back to sign in/i })).toBeInTheDocument();
  });

  it("renders the 'invalid or expired' message when verify fails", async () => {
    installFetch((url) => {
      if (url.includes("/api/auth/verify/")) return jsonResponse(400, { error: "Token expired" });
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/verify-email/expired-token"]} path="/verify-email/:token">
        <VerifyEmailPage />
      </ProviderStack>,
    );
    await waitFor(() => {
      expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// <OnboardingWizard>
// ---------------------------------------------------------------------------

/** Default fetch handler for OnboardingWizard: 200s the couple-lookup (so the
 *  wizard renders instead of the "welcome existing" card) and lets the caller
 *  override per-test. */
function installWizardFetch(extra?: FetchHandler) {
  installFetch((url, init) => {
    if (url.endsWith("/api/couples/current") && (init?.method ?? "GET").toUpperCase() === "GET") {
      return jsonResponse(200, { couple: null });
    }
    if (extra) {
      return extra(url, init);
    }
    return jsonResponse(200, { ok: true });
  });
}

describe("<OnboardingWizard>", () => {
  it("renders step 1 (bride + groom name) once the couple lookup resolves", async () => {
    installWizardFetch();
    render(
      <ProviderStack initialEntries={["/onboarding"]} path="/onboarding">
        <OnboardingWizard />
      </ProviderStack>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/bride/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/groom/i)).toBeInTheDocument();
  });

  it("disables the Next button until both bride + groom names are filled", async () => {
    installWizardFetch();
    render(
      <ProviderStack initialEntries={["/onboarding"]} path="/onboarding">
        <OnboardingWizard />
      </ProviderStack>,
    );
    await waitFor(() => screen.getByLabelText(/bride/i));
    const nextBtn = screen.getByRole("button", { name: /^next$/i }) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/bride/i), { target: { value: "Anna" } });
    expect(nextBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/groom/i), { target: { value: "Ben" } });
    expect(nextBtn.disabled).toBe(false);
  });

  it("advances forward + back through steps", async () => {
    installWizardFetch();
    render(
      <ProviderStack initialEntries={["/onboarding"]} path="/onboarding">
        <OnboardingWizard />
      </ProviderStack>,
    );
    await waitFor(() => screen.getByLabelText(/bride/i));
    fireEvent.change(screen.getByLabelText(/bride/i), { target: { value: "Anna" } });
    fireEvent.change(screen.getByLabelText(/groom/i), { target: { value: "Ben" } });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    // Step 2 — the date question heading appears.
    await waitFor(() => {
      expect(screen.getByText(/how fixed is the date/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/bride/i)).toBeInTheDocument();
    });
  });

  it("persists the draft across re-renders via localStorage", async () => {
    installWizardFetch();
    const { unmount } = render(
      <ProviderStack initialEntries={["/onboarding"]} path="/onboarding">
        <OnboardingWizard />
      </ProviderStack>,
    );
    await waitFor(() => screen.getByLabelText(/bride/i));
    fireEvent.change(screen.getByLabelText(/bride/i), { target: { value: "Persisted" } });
    fireEvent.change(screen.getByLabelText(/groom/i), { target: { value: "Draft" } });
    // The autosave runs in a useEffect after every render — flush effects.
    await flush();
    const raw = localStorage.getItem("weddly.onboarding_draft");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}");
    expect(parsed.bride_name).toBe("Persisted");
    expect(parsed.groom_name).toBe("Draft");
    unmount();

    // Mount a fresh wizard — the draft should rehydrate.
    installWizardFetch();
    render(
      <ProviderStack initialEntries={["/onboarding"]} path="/onboarding">
        <OnboardingWizard />
      </ProviderStack>,
    );
    await waitFor(() => screen.getByLabelText(/bride/i));
    expect((screen.getByLabelText(/bride/i) as HTMLInputElement).value).toBe("Persisted");
    expect((screen.getByLabelText(/groom/i) as HTMLInputElement).value).toBe("Draft");
  });

  it("hides the wizard form and shows the 'already set up' welcome card when a couple exists", async () => {
    // The couple-lookup returns an existing couple — partner-B flow.
    installFetch((url) => {
      if (url.endsWith("/api/couples/current")) {
        return jsonResponse(200, {
          couple: {
            id: 7,
            display_name: "Anna & Ben",
            bride_name: "Anna",
            groom_name: "Ben",
            wedding_date_goal: {
              kind: "tbd",
              exact_date: null,
              target_year: null,
              target_month: null,
              target_season: null,
            },
            guest_count_goal: { kind: "tbd", exact: null, min: null, max: null },
            budget_goal: { kind: "tbd", exact_huf: null, min_huf: null, max_huf: null },
            currency: "HUF",
            style_tags: [],
          },
        });
      }
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/onboarding"]} path="/onboarding">
        <OnboardingWizard />
      </ProviderStack>,
    );
    // The welcome card uses the couple's display_name in the title.
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Anna & Ben/);
    });
    // The wizard's bride input must NOT be present in this branch.
    expect(screen.queryByLabelText(/^bride$/i)).not.toBeInTheDocument();
  });

  it("shows the retry banner (without clearing draft) when /api/couples/onboard fails", async () => {
    // To exercise the submit failure path without manually clicking through
    // the full wizard, we seed the draft so loadDraft() jumps straight to a
    // valid state, then click Next three times (0→1→2→3) to reach the final
    // step where the Next button is replaced by "Let's go!".
    localStorage.setItem(
      "weddly.onboarding_draft",
      JSON.stringify({
        bride_name: "Anna",
        groom_name: "Ben",
        ceremony_kind: null,
        date_kind: "tbd",
        date_exact: "",
        date_year: "2027",
        date_month: "6",
        date_season: "summer",
        guest_kind: "tbd",
        guest_exact: "",
        guest_min: "60",
        guest_max: "100",
        budget_kind: "tbd",
        budget_exact: "",
        budget_min: "4000000",
        budget_max: "6000000",
        currency: "HUF",
        style_tags: [],
      }),
    );

    installWizardFetch((url) => {
      if (url.endsWith("/api/couples/onboard")) {
        return jsonResponse(500, { error: "boom" });
      }
      return jsonResponse(200, { ok: true });
    });
    render(
      <ProviderStack initialEntries={["/onboarding"]} path="/onboarding">
        <OnboardingWizard />
      </ProviderStack>,
    );
    await waitFor(() => screen.getByLabelText(/bride/i));
    // Click Next three times: 0→1→2→3 (each step is tbd-valid). Step 3 is
    // the final step where the Next button is replaced by the Finish button.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
      // Allow re-render before next click.
      await flush();
    }
    // Final step — finish button labeled "Let's go!".
    const finishBtn = screen.getByRole("button", { name: /let's go!/i });
    fireEvent.click(finishBtn);
    await waitFor(() => {
      // The error banner copy includes "couldn't save just now". The page also
      // has a ToastProvider live region with `role="alert"`, so we match by
      // text content rather than role.
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    // Draft is preserved on failure — never cleared until success.
    const draft = JSON.parse(localStorage.getItem("weddly.onboarding_draft") ?? "{}");
    expect(draft.bride_name).toBe("Anna");
  });
});
