// The session probe (`GET /api/auth/me`) must not race itself.
//
// Under StrictMode the auth provider's effect runs twice, so two probes went out
// with the same bearer token. The first rotates a legacy browser's token, and the
// second, still carrying the old one, was refused. That 401 cleared the session
// and bounced a signed-in user to the login page. Callers that ask while a probe
// is in flight now share it, so exactly one request goes out.

import { afterEach, describe, expect, it } from "bun:test";
import { probeMe } from "@/lib/auth";
import { setToken } from "@/lib/api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  setToken(null);
  localStorage.clear();
});

describe("session probe", () => {
  it("shares one in-flight /api/auth/me between concurrent callers", async () => {
    let probes = 0;
    globalThis.fetch = (async () => {
      probes += 1;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(
        JSON.stringify({
          user: { id: 1, email: "couple@example.com", role: "owner", locale: "en" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([probeMe(), probeMe()]);
    expect(probes).toBe(1);
    expect(a.user.email).toBe("couple@example.com");
    expect(b).toBe(a);

    // Once the probe has settled, the next caller gets a fresh request.
    await probeMe();
    expect(probes).toBe(2);
  });
});
