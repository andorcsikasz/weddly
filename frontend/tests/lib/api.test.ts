import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { ADMIN_REAUTH_REQUIRED_EVENT, ApiError, apiFetch } from "@/lib/api";

const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  // Each test installs its own fetch mock; reset the storage that api.ts reads
  // for the bearer token so the Authorization header doesn't bleed across tests.
  try {
    localStorage.removeItem("weddly.token");
  } catch {
    // localStorage might not exist in some runners
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("apiFetch retry", () => {
  it("retries a GET on 5xx and returns the eventual success body", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      if (calls < 3) return jsonResponse(503, { error: "boom" });
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;

    const result = await apiFetch<{ ok: boolean }>("GET", "/x");
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("does NOT retry a PATCH by default — surfaces the first 5xx", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return jsonResponse(503, { error: "boom" });
    }) as unknown as typeof fetch;

    await expect(apiFetch("PATCH", "/x", { v: 1 })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it("retries a PATCH when the caller opts in via retry: true", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      if (calls < 2) return jsonResponse(502, { error: "bad gateway" });
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;

    const result = await apiFetch<{ ok: boolean }>("PATCH", "/x", { v: 1 }, { retry: true });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("never retries a 4xx — caller error is permanent", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return jsonResponse(422, { error: "bad input" });
    }) as unknown as typeof fetch;

    await expect(apiFetch("GET", "/x")).rejects.toMatchObject({
      status: 422,
      code: "client_error",
    });
    expect(calls).toBe(1);
  });

  it("never retries a 401 — session-expired must surface immediately", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return jsonResponse(401, { error: "expired" });
    }) as unknown as typeof fetch;

    await expect(apiFetch("GET", "/x")).rejects.toMatchObject({ code: "session_expired" });
    expect(calls).toBe(1);
  });

  it("surfaces the typed admin re-auth event without treating the session as expired", async () => {
    let events = 0;
    const onReauth = () => events++;
    window.addEventListener(ADMIN_REAUTH_REQUIRED_EVENT, onReauth);
    globalThis.fetch = mock(async () =>
      jsonResponse(403, {
        error: "Re-authentication required for admin access",
        detail: { code: "admin_reauth_required", reason: "stale" },
      }),
    ) as unknown as typeof fetch;

    try {
      await expect(apiFetch("GET", "/api/admin/users")).rejects.toMatchObject({
        status: 403,
        code: "admin_reauth_required",
      });
      expect(events).toBe(1);
    } finally {
      window.removeEventListener(ADMIN_REAUTH_REQUIRED_EVENT, onReauth);
    }
  });

  it("does not retry when the caller's signal aborted", async () => {
    let calls = 0;
    const controller = new AbortController();
    globalThis.fetch = mock(async () => {
      calls++;
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;

    await expect(
      apiFetch("GET", "/x", undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "aborted",
    });
    expect(calls).toBe(1);
  });
});
