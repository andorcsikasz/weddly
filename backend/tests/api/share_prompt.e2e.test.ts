import "../setup";

import { describe, expect, test } from "bun:test";
import type { AuthSession, User } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

// The one-shot latch behind the automatic "share Weddly" prompt. The frontend
// keeps a localStorage mirror, but this column is what makes the prompt fire
// once per ACCOUNT rather than once per browser.

describe("POST /api/auth/share-prompt-seen", () => {
  test("a fresh account has never been prompted", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("share-fresh@weddly.test");
    const me = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token });
    expect(me.status).toBe(200);
    expect(me.data.user.share_prompt_seen_at).toBeNull();
  });

  test("stamps the latch and echoes the updated user", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("share-stamp@weddly.test");

    const before = Date.now();
    const r = await req<{ user: User }>("POST", "/api/auth/share-prompt-seen", {}, { token });
    expect(r.status).toBe(200);

    const stamped = r.data.user.share_prompt_seen_at;
    expect(stamped).not.toBeNull();
    expect(stamped as number).toBeGreaterThanOrEqual(before - 1000);

    // And it survives to the next /me — this is the whole point of the column.
    const me = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token });
    expect(me.data.user.share_prompt_seen_at).toBe(stamped);
  });

  test("is write-once — a second call does not move the timestamp", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("share-once@weddly.test");

    const first = await req<{ user: User }>("POST", "/api/auth/share-prompt-seen", {}, { token });
    const stamped = first.data.user.share_prompt_seen_at;
    expect(stamped).not.toBeNull();

    // Two racing tabs (or a retry after a flaky network) must not re-stamp:
    // the timestamp answers "when did we FIRST ask", not "when did we last try".
    await new Promise((r) => setTimeout(r, 15));
    const second = await req<{ user: User }>("POST", "/api/auth/share-prompt-seen", {}, { token });
    expect(second.status).toBe(200);
    expect(second.data.user.share_prompt_seen_at).toBe(stamped);
  });

  test("requires a session", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/share-prompt-seen", {});
    expect(r.status).toBe(401);
  });

  test("is scoped to the calling user", async () => {
    wipeAll();
    const a = await bootstrapCouple("share-scope-a@weddly.test");
    const b = await registerAndVerify({
      email: "share-scope-b@weddly.test",
      password: "supersafe123",
      full_name: "Second Person",
    });
    const bToken = (b.data as AuthSession).token;

    await req("POST", "/api/auth/share-prompt-seen", {}, { token: a.token });

    const bMe = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token: bToken });
    expect(bMe.data.user.share_prompt_seen_at).toBeNull();
  });
});

describe("POST /api/growth/event — share.weddly", () => {
  test("accepts the share funnel kind with its step payload", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("share-growth@weddly.test");

    const r = await req<{ recorded: number }>(
      "POST",
      "/api/growth/event",
      {
        kind: "share.weddly",
        payload: {
          event: "weddly_share_completed",
          source: "automatic_popup",
          language: "hu",
          message_variant: "warm",
          share_method: "native_share",
          user_session_number: 3,
          meaningful_actions_completed: 5,
        },
      },
      { token },
    );
    expect(r.status).toBe(200);

    const row = db
      .prepare("SELECT kind, payload_json FROM growth_events WHERE kind = 'share.weddly'")
      .get() as { kind: string; payload_json: string | null } | undefined;
    expect(row?.kind).toBe("share.weddly");
    const payload = JSON.parse(row?.payload_json ?? "{}") as Record<string, unknown>;
    expect(payload.event).toBe("weddly_share_completed");
    expect(payload.message_variant).toBe("warm");
  });

  test("still rejects a kind outside the frontend allowlist", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("share-growth-deny@weddly.test");
    const r = await req("POST", "/api/growth/event", { kind: "signup.completed" }, { token });
    expect(r.status).toBe(400);
  });
});
