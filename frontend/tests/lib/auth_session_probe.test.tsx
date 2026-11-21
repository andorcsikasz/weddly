// The session probe (`GET /api/auth/me`) must not race itself.
//
// Under StrictMode the auth provider's effect runs twice, so two probes went out
// with the same bearer token. The first rotates a legacy browser's token, and the
// second, still carrying the old one, was refused. That 401 cleared the session
// and bounced a signed-in user to the login page. Concurrent callers now share one
// request, so exactly one probe is sent and the user stays signed in.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { setToken } from "@/lib/api";

const realFetch = globalThis.fetch;

function Who() {
  const { user } = useAuth();
  return <p>{user ? `signed-in:${user.email}` : "signed-out"}</p>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("weddly.locale", "en");
  localStorage.setItem("weddly.session", "1");
  setToken("legacy-token");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("session probe", () => {
  it("sends one /api/auth/me under StrictMode and keeps the user signed in", async () => {
    let probes = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/auth/me")) {
        probes += 1;
        // A rotated token: any probe after the first is refused.
        if (probes > 1) {
          return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
        }
        return new Response(
          JSON.stringify({
            user: { id: 1, email: "couple@example.com", role: "owner", locale: "en" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    render(
      <StrictMode>
        <AuthProvider>
          <Who />
        </AuthProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText("signed-in:couple@example.com")).toBeTruthy());
    expect(probes).toBe(1);
  });
});
