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
});
