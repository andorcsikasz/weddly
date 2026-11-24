import { describe, expect, test } from "bun:test";
import "../setup";
import { createHmac } from "node:crypto";
import { CONFIG } from "../../src/config";
import {
  calendarErrorForStore,
  decryptToken,
  encryptToken,
  FAKE_REVOKED_REFRESH_MARKER,
  GCAL_REAUTH_REQUIRED,
  GoogleReauthRequiredError,
  refreshAccessToken,
} from "../../src/lib/google_calendar";
import {
  newPkcePair,
  OAUTH_BINDING_COOKIE,
  oauthBindingClearCookie,
  oauthBindingSetCookie,
  pkceChallengeFor,
  readOAuthBinding,
  signOAuthState,
  verifyOAuthState,
} from "../../src/lib/oauth_state";

// Pure unit tests for the Google Calendar OAuth plumbing. The end-to-end flow
// lives in tests/api/google_calendar.e2e.test.ts; these pin each piece on its
// own so a regression names the broken part.

/** Mint a state signed with the real key but with an arbitrary expiry, so the
 *  expiry branch can be exercised without sleeping for ten minutes. */
function forgeState(kind: string, userId: number, expMs: number): string {
  const payload = Buffer.from(`${kind}.${userId}.${expMs}`).toString("base64url");
  const sig = createHmac("sha256", CONFIG.jwtSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function requestWithCookie(cookie: string | null): Request {
  return new Request("http://localhost/api/google-calendar/callback", {
    headers: cookie === null ? {} : { cookie },
  });
}

describe("oauth state: signed, expiring, flow-typed", () => {
  test("a freshly minted state verifies back to its flow and user", () => {
    const decoded = verifyOAuthState(signOAuthState("couple", 42));
    expect(decoded).toEqual({ kind: "couple", userId: 42 });
    expect(verifyOAuthState(signOAuthState("vendor", 7))).toEqual({ kind: "vendor", userId: 7 });
  });

  test("a tampered signature is rejected", () => {
    const state = signOAuthState("couple", 42);
    const flipped = `${state.slice(0, -1)}${state.endsWith("A") ? "B" : "A"}`;
    expect(verifyOAuthState(flipped)).toBeNull();
  });

  test("a payload edited to name another user is rejected (the signature covers it)", () => {
    const state = signOAuthState("couple", 42);
    const [, sig] = state.split(/\.(?=[^.]*$)/) as [string, string];
    const forged = Buffer.from(`couple.99.${Date.now() + 60_000}`).toString("base64url");
    expect(verifyOAuthState(`${forged}.${sig}`)).toBeNull();
  });

  test("an expired state is rejected even with a valid signature", () => {
    expect(verifyOAuthState(forgeState("couple", 42, Date.now() - 1000))).toBeNull();
    expect(verifyOAuthState(forgeState("couple", 42, Date.now() + 60_000))).not.toBeNull();
  });

  test("an unknown flow kind is rejected even when correctly signed", () => {
    expect(verifyOAuthState(forgeState("admin", 42, Date.now() + 60_000))).toBeNull();
  });

  test("malformed input is rejected rather than thrown", () => {
    expect(verifyOAuthState("")).toBeNull();
    expect(verifyOAuthState("no-dot-here")).toBeNull();
  });
});

describe("PKCE (RFC 7636)", () => {
  test("matches the RFC 7636 appendix B test vector", () => {
    expect(pkceChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  test("a generated pair has a 43-char url-safe verifier whose challenge derives from it", () => {
    const { verifier, challenge } = newPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(pkceChallengeFor(verifier));
    expect(newPkcePair().verifier).not.toBe(verifier);
  });
});

describe("binding cookie: the callback must come from the browser that started the flow", () => {
  const state = signOAuthState("couple", 1);
  const { verifier } = newPkcePair();

  test("the set-cookie is httpOnly, Lax, scoped to the callback path, and short-lived", () => {
    const cookie = oauthBindingSetCookie(state, verifier);
    expect(cookie.startsWith(`${OAUTH_BINDING_COOKIE}=`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/google-calendar/callback");
    expect(cookie).toContain("Max-Age=600");
  });

  test("reads back the verifier when the state matches", () => {
    const pair = oauthBindingSetCookie(state, verifier).split(";")[0] as string;
    expect(readOAuthBinding(requestWithCookie(pair), state)).toBe(verifier);
  });

  test("finds the binding among unrelated cookies", () => {
    const pair = oauthBindingSetCookie(state, verifier).split(";")[0] as string;
    const header = `session=abc; theme=dark; ${pair}; other=1`;
    expect(readOAuthBinding(requestWithCookie(header), state)).toBe(verifier);
  });

  test("refuses a cookie set for a different state", () => {
    const pair = oauthBindingSetCookie(signOAuthState("couple", 2), verifier).split(
      ";",
    )[0] as string;
    expect(readOAuthBinding(requestWithCookie(pair), state)).toBeNull();
  });

  test("refuses when there is no cookie, or a malformed one", () => {
    expect(readOAuthBinding(requestWithCookie(null), state)).toBeNull();
    expect(
      readOAuthBinding(requestWithCookie(`${OAUTH_BINDING_COOKIE}=${state}`), state),
    ).toBeNull();
    expect(
      readOAuthBinding(requestWithCookie(`${OAUTH_BINDING_COOKIE}=${state}~`), state),
    ).toBeNull();
  });

  test("the clear cookie expires the binding immediately", () => {
    expect(oauthBindingClearCookie()).toContain("Max-Age=0");
  });
});

describe("token encryption at rest", () => {
  test("round-trips a token and never stores it in the clear", () => {
    const token = "1//refresh-token-example-value";
    const enc = encryptToken(token);
    expect(enc).not.toContain(token);
    expect(decryptToken(enc)).toBe(token);
  });

  test("each encryption uses a fresh IV, so equal tokens do not produce equal ciphertext", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  test("a tampered ciphertext decrypts to null rather than to garbage", () => {
    const enc = encryptToken("secret");
    const parts = enc.split(":");
    const ct = parts[parts.length - 1] as string;
    const bytes = Buffer.from(ct, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    parts[parts.length - 1] = bytes.toString("base64");
    expect(decryptToken(parts.join(":"))).toBeNull();
  });

  test("null in, null out (a connection may have no refresh token)", () => {
    expect(decryptToken(null)).toBeNull();
  });
});

describe("invalid_grant: a refused refresh token is a reconnect, not a retry", () => {
  test("a refused refresh token throws the typed reauth error", async () => {
    const refused = refreshAccessToken(`fake-refresh-${FAKE_REVOKED_REFRESH_MARKER}`);
    await expect(refused).rejects.toBeInstanceOf(GoogleReauthRequiredError);
  });

  test("the reauth error is stored as the reconnect sentinel, not the raw message", async () => {
    try {
      await refreshAccessToken(`fake-refresh-${FAKE_REVOKED_REFRESH_MARKER}`);
      throw new Error("expected a refused refresh");
    } catch (e) {
      expect(calendarErrorForStore(e)).toBe(GCAL_REAUTH_REQUIRED);
    }
  });

  test("an ordinary failure is NOT treated as a dead grant (it stays retryable)", () => {
    expect(calendarErrorForStore(new Error("google token refresh 503: busy"))).not.toBe(
      GCAL_REAUTH_REQUIRED,
    );
  });

  test("a healthy refresh token still refreshes", async () => {
    const t = await refreshAccessToken("fake-refresh-healthy");
    expect(t.accessToken.length).toBeGreaterThan(0);
    expect(t.expiresInSec).toBeGreaterThan(0);
  });
});
