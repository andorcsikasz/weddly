import "../setup";

import { describe, expect, test } from "bun:test";
import type { AuthSession, User } from "@shared/types";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

// `users.visited_nav` is what makes the sidebar's "not opened yet" dot survive a
// new device: the rail mutes every destination the couple has never landed on,
// and this union-only latch is how a visit clears it.

describe("POST /api/auth/nav-visited", () => {
  test("a fresh account has explored nothing", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("nav-fresh@weddly.test");
    const me = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token });
    expect(me.status).toBe(200);
    expect(me.data.user.visited_nav).toEqual([]);
  });

  test("records a destination and echoes the updated user", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("nav-record@weddly.test");

    const r = await req<{ user: User }>(
      "POST",
      "/api/auth/nav-visited",
      { path: "/app/seating" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.user.visited_nav).toEqual(["/app/seating"]);

    // Survives to the next /me — a second device must not re-nudge.
    const me = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token });
    expect(me.data.user.visited_nav).toEqual(["/app/seating"]);
  });

  test("is union-only — repeats and additions never drop what is there", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("nav-union@weddly.test");

    await req("POST", "/api/auth/nav-visited", { path: "/app/guests" }, { token });
    // Two tabs landing on the same page must not duplicate the entry.
    await req("POST", "/api/auth/nav-visited", { path: "/app/guests" }, { token });
    const r = await req<{ user: User }>(
      "POST",
      "/api/auth/nav-visited",
      { path: "/app/budget" },
      { token },
    );

    expect(r.data.user.visited_nav).toEqual(["/app/guests", "/app/budget"]);
  });

  test("refuses anything that is not a workspace nav path", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("nav-guard@weddly.test");

    for (const path of ["/admin", "https://evil.example/app", "/app/../etc", "", "/app/GUESTS"]) {
      const r = await req("POST", "/api/auth/nav-visited", { path }, { token });
      expect(r.status).toBe(400);
    }
    const missing = await req("POST", "/api/auth/nav-visited", {}, { token });
    expect(missing.status).toBe(400);

    const me = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token });
    expect(me.data.user.visited_nav).toEqual([]);
  });

  test("requires a session", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/nav-visited", { path: "/app/guests" });
    expect(r.status).toBe(401);
  });

  test("is scoped to the calling user", async () => {
    wipeAll();
    const a = await bootstrapCouple("nav-scope-a@weddly.test");
    const b = await registerAndVerify({
      email: "nav-scope-b@weddly.test",
      password: "supersafe123",
      full_name: "Second Person",
    });
    const bToken = (b.data as AuthSession).token;

    await req("POST", "/api/auth/nav-visited", { path: "/app/moodboard" }, { token: a.token });

    const bMe = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token: bToken });
    expect(bMe.data.user.visited_nav).toEqual([]);
  });
});
