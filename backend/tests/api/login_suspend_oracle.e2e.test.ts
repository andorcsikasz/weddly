// Login must not reveal that an account is suspended BEFORE the password check:
// a distinct 403 "suspended" vs 401 "invalid" would let an attacker enumerate
// suspended addresses without knowing the password. See routes/auth.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { registerAndVerify, req, wipeAll } from "../helpers";

describe("login: suspension is not an enumeration oracle", () => {
  test("wrong password on a suspended account → generic 401; correct password → 403 suspended", async () => {
    wipeAll();
    const email = "suspended-oracle@weddly.test";
    const reg = await registerAndVerify({ email, password: "supersafe123", full_name: "Sus" });
    expect(reg.status).toBe(201);
    db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run(email);

    // A caller without the password sees the same 401 as any bad login.
    const wrong = await req("POST", "/api/auth/login", { email, password: "wrong-password" });
    expect(wrong.status).toBe(401);

    // The real owner (correct password) still learns the account is suspended.
    const right = await req("POST", "/api/auth/login", { email, password: "supersafe123" });
    expect(right.status).toBe(403);
  });
});
