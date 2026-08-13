import "../setup";

import { describe, expect, test } from "bun:test";
import { registerAndVerify, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT}`;

describe("browser session cookie", () => {
  test("login issues an HttpOnly cookie that authenticates requests and logout clears it", async () => {
    wipeAll();
    await registerAndVerify({
      email: "cookie-session@test.test",
      password: "supersafe123",
      full_name: "Cookie Session",
    });

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "cookie-session@test.test", password: "supersafe123" }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("weddly_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = setCookie.split(";")[0] ?? "";
    await login.arrayBuffer();

    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(
      "cookie-session@test.test",
    );

    const logout = await fetch(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    await logout.arrayBuffer();

    const revoked = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(revoked.status).toBe(401);
    await revoked.arrayBuffer();
  });

  test("legacy browser bearer migration rotates the token and rejects mixed credentials", async () => {
    wipeAll();
    const registered = await registerAndVerify({
      email: "legacy-cookie@test.test",
      password: "supersafe123",
      full_name: "Legacy Cookie",
    });
    const legacyBearer = registered.data.token;

    const migration = await fetch(`${BASE}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${legacyBearer}`,
        "X-Weddly-Session-Migration": "cookie-v1",
      },
    });
    expect(migration.status).toBe(200);
    expect(migration.headers.get("x-weddly-session-migrated")).toBe("1");
    const setCookie = migration.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("weddly_session=");
    expect(setCookie).toContain("HttpOnly");
    const cookie = setCookie.split(";")[0] ?? "";
    await migration.arrayBuffer();

    const replay = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${legacyBearer}` },
    });
    expect(replay.status).toBe(401);
    await replay.arrayBuffer();

    const cookieOnly = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(cookieOnly.status).toBe(200);
    await cookieOnly.arrayBuffer();

    const mixed = await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: cookie, Authorization: `Bearer ${legacyBearer}` },
    });
    expect(mixed.status).toBe(400);
    expect(((await mixed.json()) as { detail?: { code?: string } }).detail?.code).toBe(
      "mixed_auth_credentials",
    );
  });
});
