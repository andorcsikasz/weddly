// Guest-communication composer API. Couple-scoped invite / major-update /
// pre-wedding-info broadcasts, the per-head envelope tip, the per-guest invite
// channel marks on the guests route, and the scheduled-send worker sweep.
//
// Mirrors the harness used by the other per-domain files: `import "../setup"`
// boots a hermetic server (email is a no-op that still records into email_log),
// `bootstrapCouple` mints a verified, onboarded couple + bearer, and `req`
// fetches against the test server. `guest_messages` isn't in `wipeAll`, so each
// block clears it explicitly the way photo_albums clears its film tables.

import "../setup";

import type { EnvelopeTip, Guest, GuestMessage } from "@shared/types";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, req, wipeAll } from "../helpers";

/** guest_messages isn't covered by wipeAll (newer table); clear it so a
 *  scheduled/sent row from one block can't bleed into another or get picked up
 *  by the cross-couple worker sweep. */
function wipeGuestMessages(): void {
  try {
    db.exec("DELETE FROM guest_messages");
  } catch {
    // Table may not exist on a very old schema; ignore.
  }
}

/** Create a guest in its own fresh household (so it gets a check-in `code`,
 *  which the invite template needs) and return the new guest id. */
async function createGuest(
  token: string,
  opts: { name: string; email: string; rsvp?: "pending" | "yes" | "maybe" | "no" },
): Promise<number> {
  const r = await req<{ guest: Guest }>(
    "POST",
    "/api/guests",
    {
      full_name: opts.name,
      email: opts.email,
      rsvp_status: opts.rsvp ?? "pending",
      household_id: null,
      new_household_label: opts.name,
    },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.guest.id;
}

function emailLogCount(coupleId: number, kind: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM email_log WHERE couple_id = ? AND kind = ?")
    .get(coupleId, kind) as { n: number };
  return row.n;
}

// ── Channel marking (guests route) ─────────────────────────────────────────────

describe("guest invite channel marking", () => {
  let token: string;
  let guestId: number;

  beforeAll(async () => {
    wipeAll();
    wipeGuestMessages();
    ({ token } = await bootstrapCouple("channels@weddly.test"));
    guestId = await createGuest(token, { name: "Ada Channel", email: "ada.channel@guest.test" });
  });

  afterAll(() => wipeGuestMessages());

  // PATCH /api/guests/:id requires full_name (the update contract), so the
  // composer resends the guest name alongside the channel toggle.
  const NAME = "Ada Channel";

  test("invited_online stamps invited_online_at and syncs the legacy invited_at", async () => {
    const r = await req<{ guest: Guest }>(
      "PATCH",
      `/api/guests/${guestId}`,
      { full_name: NAME, invited_online: true },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.guest.invited_online_at).not.toBeNull();
    expect(r.data.guest.invited_at).not.toBeNull();
    // Online-only: the physical channel stays untouched.
    expect(r.data.guest.invited_physical_at).toBeNull();
  });

  test("invited_physical stamps invited_physical_at and syncs invitation_delivered_at", async () => {
    const r = await req<{ guest: Guest }>(
      "PATCH",
      `/api/guests/${guestId}`,
      { full_name: NAME, invited_physical: true },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.guest.invited_physical_at).not.toBeNull();
    expect(r.data.guest.invitation_delivered_at).not.toBeNull();
  });

  test("setting a channel false clears its stamp", async () => {
    const off = await req<{ guest: Guest }>(
      "PATCH",
      `/api/guests/${guestId}`,
      { full_name: NAME, invited_online: false, invited_physical: false },
      { token },
    );
    expect(off.status).toBe(200);
    expect(off.data.guest.invited_online_at).toBeNull();
    expect(off.data.guest.invited_physical_at).toBeNull();

    // Read back via GET /api/guests to confirm it persisted.
    const list = await req<{ guests: Guest[] }>("GET", "/api/guests", undefined, { token });
    const fresh = list.data.guests.find((g) => g.id === guestId);
    expect(fresh?.invited_online_at ?? null).toBeNull();
    expect(fresh?.invited_physical_at ?? null).toBeNull();
  });
});

// ── Envelope tip ────────────────────────────────────────────────────────────────

describe("envelope tip", () => {
  let token: string;
  let coupleId: number;

  beforeAll(async () => {
    wipeAll();
    wipeGuestMessages();
    ({ token, coupleId } = await bootstrapCouple("envelope@weddly.test"));
    // Onboarding seeds default budget lines + the two partner guest rows (which
    // also count as rsvp=yes non-supplier heads); clear both so the per-head
    // math is deterministic for this couple.
    db.prepare("DELETE FROM budget_lines WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM guests WHERE couple_id = ?").run(coupleId);
    // 1,000,000 planned over 2 confirmed (rsvp yes) guests → auto = 500,000.
    const line = await req(
      "POST",
      "/api/budget/lines",
      { category: "venue", label: "Venue", planned_huf: 1_000_000 },
      { token },
    );
    expect(line.status).toBe(201);
    await createGuest(token, { name: "Yes One", email: "yes1@guest.test", rsvp: "yes" });
    await createGuest(token, { name: "Yes Two", email: "yes2@guest.test", rsvp: "yes" });
    // A pending guest must NOT count toward the per-head divisor.
    await createGuest(token, {
      name: "Pending One",
      email: "pending1@guest.test",
      rsvp: "pending",
    });
  });

  afterAll(() => wipeGuestMessages());

  test("GET computes auto = planned budget ÷ confirmed guests", async () => {
    const r = await req<EnvelopeTip>("GET", "/api/guest-messages/envelope-tip", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.auto).toBe(500_000);
    expect(r.data.override).toBeNull();
    expect(r.data.effective).toBe(500_000);
    // The amount is computed for everyone, but the tip itself is OPT-IN: a
    // couple who has never touched the switch is off, even though the column
    // still defaults to 1. Telling guests what to put in an envelope is not
    // something to do on their behalf.
    expect(r.data.enabled).toBe(false);
  });

  test("the switch is what makes the flag mean anything, in both directions", async () => {
    // Straight from untouched to ON, then back OFF: the second one must stick
    // rather than falling back to the default.
    const on = await req<EnvelopeTip>(
      "PATCH",
      "/api/guest-messages/envelope-tip",
      { enabled: true },
      { token },
    );
    expect(on.data.enabled).toBe(true);

    const off = await req<EnvelopeTip>(
      "PATCH",
      "/api/guest-messages/envelope-tip",
      { enabled: false },
      { token },
    );
    expect(off.data.enabled).toBe(false);
    const get = await req<EnvelopeTip>("GET", "/api/guest-messages/envelope-tip", undefined, {
      token,
    });
    expect(get.data.enabled).toBe(false);
  });

  test("PATCH persists override + enabled; effective = override ?? auto", async () => {
    const patch = await req<EnvelopeTip>(
      "PATCH",
      "/api/guest-messages/envelope-tip",
      { override: 12_345, enabled: false },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.override).toBe(12_345);
    expect(patch.data.effective).toBe(12_345);
    expect(patch.data.enabled).toBe(false);

    const get = await req<EnvelopeTip>("GET", "/api/guest-messages/envelope-tip", undefined, {
      token,
    });
    expect(get.data.override).toBe(12_345);
    expect(get.data.effective).toBe(12_345);
    expect(get.data.enabled).toBe(false);
    // auto is still computed alongside the override.
    expect(get.data.auto).toBe(500_000);
  });

  test("clearing the override falls back to auto", async () => {
    const patch = await req<EnvelopeTip>(
      "PATCH",
      "/api/guest-messages/envelope-tip",
      { override: null, enabled: true },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.override).toBeNull();
    expect(patch.data.effective).toBe(500_000);
    expect(patch.data.enabled).toBe(true);
  });
});

// ── Send now ────────────────────────────────────────────────────────────────────

describe("send now", () => {
  let token: string;
  let coupleId: number;

  beforeAll(async () => {
    wipeAll();
    wipeGuestMessages();
    ({ token, coupleId } = await bootstrapCouple("sendnow@weddly.test"));
    // 3 eligible (non-supplier, e-mailed, in a household with a code) guests.
    await createGuest(token, { name: "Guest A", email: "a@send.test", rsvp: "yes" });
    await createGuest(token, { name: "Guest B", email: "b@send.test", rsvp: "yes" });
    await createGuest(token, { name: "Guest C", email: "c@send.test", rsvp: "yes" });
  });

  afterAll(() => wipeGuestMessages());

  const cases: Array<{ template: GuestMessage["template"]; kind: string }> = [
    { template: "invite", kind: "guest_invite" },
    { template: "major_update", kind: "guest_major_update" },
    { template: "pre_wedding_info", kind: "guest_pre_wedding_info" },
  ];

  for (const c of cases) {
    test(`POST template=${c.template} sends immediately to all eligible guests`, async () => {
      const before = emailLogCount(coupleId, c.kind);
      const r = await req<{ message: GuestMessage }>(
        "POST",
        "/api/guest-messages",
        {
          template: c.template,
          audience: "all",
          subject: "Hello guests",
          body: "Paragraph one.\n\nParagraph two.",
          include_envelope_tip: c.template === "pre_wedding_info",
        },
        { token },
      );
      expect(r.status).toBe(201);
      expect(r.data.message.status).toBe("sent");
      expect(r.data.message.sent_at).not.toBeNull();
      expect(r.data.message.scheduled_at).toBeNull();
      expect(r.data.message.recipient_count).toBe(3);

      const after = emailLogCount(coupleId, c.kind);
      expect(after - before).toBe(3);
    });
  }

  test("GET lists the sent broadcasts newest-first", async () => {
    const r = await req<{ messages: GuestMessage[] }>("GET", "/api/guest-messages", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.messages.length).toBe(3);
    expect(r.data.messages.every((m) => m.status === "sent")).toBe(true);
    // Newest-first ordering by created_at.
    for (let i = 1; i < r.data.messages.length; i++) {
      expect(r.data.messages[i - 1]!.created_at).toBeGreaterThanOrEqual(
        r.data.messages[i]!.created_at,
      );
    }
  });

  test("invalid template / audience is rejected with 400", async () => {
    const badTemplate = await req(
      "POST",
      "/api/guest-messages",
      { template: "nope", audience: "all" },
      { token },
    );
    expect(badTemplate.status).toBe(400);
    const badAudience = await req(
      "POST",
      "/api/guest-messages",
      { template: "invite", audience: "everyone" },
      { token },
    );
    expect(badAudience.status).toBe(400);
  });
});

// ── Audience targeting ────────────────────────────────────────────────────────

describe("audience targeting", () => {
  let token: string;

  beforeAll(async () => {
    wipeAll();
    wipeGuestMessages();
    ({ token } = await bootstrapCouple("audience@weddly.test"));
    // 2 confirmed (yes), 1 pending, 1 maybe (counts as pending audience).
    await createGuest(token, { name: "Conf 1", email: "conf1@aud.test", rsvp: "yes" });
    await createGuest(token, { name: "Conf 2", email: "conf2@aud.test", rsvp: "yes" });
    await createGuest(token, { name: "Pend 1", email: "pend1@aud.test", rsvp: "pending" });
    await createGuest(token, { name: "Maybe 1", email: "maybe1@aud.test", rsvp: "maybe" });
  });

  afterAll(() => wipeGuestMessages());

  test("confirmed audience targets only rsvp=yes guests", async () => {
    const r = await req<{ message: GuestMessage }>(
      "POST",
      "/api/guest-messages",
      { template: "major_update", audience: "confirmed", subject: "Confirmed only" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.message.recipient_count).toBe(2);
  });

  test("pending audience targets pending + maybe guests", async () => {
    const r = await req<{ message: GuestMessage }>(
      "POST",
      "/api/guest-messages",
      { template: "major_update", audience: "pending", subject: "Pending only" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.message.recipient_count).toBe(2);
  });

  test("all audience targets every eligible guest", async () => {
    const r = await req<{ message: GuestMessage }>(
      "POST",
      "/api/guest-messages",
      { template: "major_update", audience: "all", subject: "Everyone" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.message.recipient_count).toBe(4);
  });
});

// ── Scheduling + worker sweep ───────────────────────────────────────────────────

describe("scheduled send + worker sweep", () => {
  let token: string;
  let coupleId: number;

  beforeAll(async () => {
    wipeAll();
    wipeGuestMessages();
    ({ token, coupleId } = await bootstrapCouple("scheduled@weddly.test"));
    await createGuest(token, { name: "Sched A", email: "sa@sched.test", rsvp: "yes" });
    await createGuest(token, { name: "Sched B", email: "sb@sched.test", rsvp: "yes" });
  });

  afterAll(() => wipeGuestMessages());

  test("a future scheduled_at queues the broadcast without sending", async () => {
    const future = Date.now() + 1000 * 60 * 60 * 24; // +1 day
    const before = emailLogCount(coupleId, "guest_major_update");
    const r = await req<{ message: GuestMessage }>(
      "POST",
      "/api/guest-messages",
      {
        template: "major_update",
        audience: "all",
        subject: "Later",
        body: "See you soon.",
        scheduled_at: future,
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.message.status).toBe("scheduled");
    expect(r.data.message.sent_at).toBeNull();
    expect(r.data.message.scheduled_at).toBe(future);
    // recipient_count is the current eligible estimate, but nothing was sent.
    expect(r.data.message.recipient_count).toBe(2);
    expect(emailLogCount(coupleId, "guest_major_update")).toBe(before);
  });

  test("the worker sweep sends a scheduled broadcast once its time passes", async () => {
    // Backdate the scheduled row so the sweep picks it up (POST refuses a past
    // scheduled_at, so we move time on the row directly — the established
    // db-update + runEmailSweep pattern from the worker tests).
    const before = emailLogCount(coupleId, "guest_major_update");
    db.prepare(
      "UPDATE guest_messages SET scheduled_at = ? WHERE couple_id = ? AND status = 'scheduled'",
    ).run(Date.now() - 1000, coupleId);

    const result = runEmailSweep();
    expect(result.scheduledGuestMessages).toBeGreaterThanOrEqual(1);

    const list = await req<{ messages: GuestMessage[] }>("GET", "/api/guest-messages", undefined, {
      token,
    });
    const swept = list.data.messages[0]!;
    expect(swept.status).toBe("sent");
    expect(swept.sent_at).not.toBeNull();
    expect(swept.recipient_count).toBe(2);
    expect(emailLogCount(coupleId, "guest_major_update") - before).toBe(2);
  });
});

// ── Delete ──────────────────────────────────────────────────────────────────────

describe("delete broadcast", () => {
  let token: string;

  beforeAll(async () => {
    wipeAll();
    wipeGuestMessages();
    ({ token } = await bootstrapCouple("delete@weddly.test"));
    await createGuest(token, { name: "Del A", email: "da@del.test", rsvp: "yes" });
  });

  afterAll(() => wipeGuestMessages());

  test("a scheduled broadcast can be deleted", async () => {
    const future = Date.now() + 1000 * 60 * 60 * 24;
    const created = await req<{ message: GuestMessage }>(
      "POST",
      "/api/guest-messages",
      { template: "major_update", audience: "all", subject: "Cancel me", scheduled_at: future },
      { token },
    );
    expect(created.status).toBe(201);
    const id = created.data.message.id;

    const del = await req("DELETE", `/api/guest-messages/${id}`, undefined, { token });
    expect(del.status).toBe(200);

    const list = await req<{ messages: GuestMessage[] }>("GET", "/api/guest-messages", undefined, {
      token,
    });
    expect(list.data.messages.find((m) => m.id === id)).toBeUndefined();
  });

  test("a sent broadcast cannot be deleted (409)", async () => {
    const sent = await req<{ message: GuestMessage }>(
      "POST",
      "/api/guest-messages",
      { template: "major_update", audience: "all", subject: "Already out" },
      { token },
    );
    expect(sent.status).toBe(201);
    expect(sent.data.message.status).toBe("sent");

    const del = await req("DELETE", `/api/guest-messages/${sent.data.message.id}`, undefined, {
      token,
    });
    expect(del.status).toBe(409);
  });

  test("deleting a missing id is 404", async () => {
    const del = await req("DELETE", "/api/guest-messages/99999999", undefined, { token });
    expect(del.status).toBe(404);
  });
});

// ── Couple isolation ────────────────────────────────────────────────────────────

describe("couple isolation", () => {
  let tokenA: string;
  let tokenB: string;
  let messageIdA: number;

  beforeAll(async () => {
    wipeAll();
    wipeGuestMessages();
    ({ token: tokenA } = await bootstrapCouple("iso-a@weddly.test"));
    ({ token: tokenB } = await bootstrapCouple("iso-b@weddly.test"));
    await createGuest(tokenA, { name: "A guest", email: "ag@iso.test", rsvp: "yes" });

    const future = Date.now() + 1000 * 60 * 60 * 24;
    const created = await req<{ message: GuestMessage }>(
      "POST",
      "/api/guest-messages",
      { template: "major_update", audience: "all", subject: "A's message", scheduled_at: future },
      { token: tokenA },
    );
    expect(created.status).toBe(201);
    messageIdA = created.data.message.id;
  });

  afterAll(() => wipeGuestMessages());

  test("couple B does not see couple A's broadcasts", async () => {
    const r = await req<{ messages: GuestMessage[] }>("GET", "/api/guest-messages", undefined, {
      token: tokenB,
    });
    expect(r.status).toBe(200);
    expect(r.data.messages.find((m) => m.id === messageIdA)).toBeUndefined();
  });

  test("couple B cannot delete couple A's broadcast (404, not 409)", async () => {
    const del = await req("DELETE", `/api/guest-messages/${messageIdA}`, undefined, {
      token: tokenB,
    });
    expect(del.status).toBe(404);

    // And it's still there for couple A.
    const list = await req<{ messages: GuestMessage[] }>("GET", "/api/guest-messages", undefined, {
      token: tokenA,
    });
    expect(list.data.messages.find((m) => m.id === messageIdA)?.status).toBe("scheduled");
  });
});
