import "../setup";

import type { NotificationFeed } from "@shared/notifications";
import { promptsForGroup } from "@shared/planning_prompts";
import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

const DAY_MS = 86_400_000;

/** Insert a planning task row directly with controlled timestamps so the
 *  computed reminders (which key off created_at / updated_at age) are
 *  deterministic without waiting real calendar days. */
function insertTask(
  coupleId: number,
  fields: {
    title: string;
    done?: number;
    due_date?: string | null;
    seed_key?: string | null;
    decision_status?: string | null;
    created_at: number;
    updated_at?: number;
  },
): void {
  db.prepare(
    `INSERT INTO planning_items
       (couple_id, kind, title, done, due_date, seed_key, decision_status, position, created_at, updated_at)
     VALUES (?, 'task', ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    coupleId,
    fields.title,
    fields.done ?? 0,
    fields.due_date ?? null,
    fields.seed_key ?? null,
    fields.decision_status ?? null,
    fields.created_at,
    fields.updated_at ?? fields.created_at,
  );
}

const PAST_DUE = "2020-01-01"; // always overdue relative to "today"

async function createOverdueTask(token: string, title: string): Promise<void> {
  const r = await req(
    "POST",
    "/api/planning",
    { kind: "task", title, due_date: PAST_DUE, start_date: PAST_DUE },
    { token },
  );
  expect(r.status).toBe(201);
}

function feed(token: string): Promise<{ status: number; data: NotificationFeed }> {
  return req<NotificationFeed>("GET", "/api/notifications", undefined, { token });
}

/** Register + verify partner B and accept the couple's pending invite. */
async function addPartnerB(ownerToken: string, email: string): Promise<string> {
  const inv = await req<{ invite: { token: string } }>(
    "POST",
    "/api/couples/invites",
    { invited_email: email },
    { token: ownerToken },
  );
  expect(inv.status).toBe(201);
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Bea Nagy",
  });
  expect(reg.status).toBe(201);
  const accept = await req(
    "POST",
    `/api/invites/${inv.data.invite.token}/accept`,
    {},
    { token: reg.data.token },
  );
  expect(accept.status).toBe(200);
  return reg.data.token;
}

describe("notifications: computed timeline half", () => {
  test("an overdue task surfaces as a live timeline item and is never stored", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-tl@weddly.test");
    await createOverdueTask(token, "Helyszínt foglalni");

    const r = await feed(token);
    expect(r.status).toBe(200);
    expect(r.data.overdue).toBe(1);
    const tl = r.data.items.find((i) => i.kind === "timeline_overdue");
    expect(tl).toBeDefined();
    expect(tl?.data.taskTitle).toBe("Helyszínt foglalni");
    expect(tl?.link).toBe("/app/timeline");
    expect(r.data.unread).toBeGreaterThanOrEqual(1);

    // The timeline nudge is computed, NOT written to couple_notifications.
    const stored = db
      .prepare(
        "SELECT COUNT(*) AS n FROM couple_notifications WHERE couple_id = ? AND kind LIKE 'timeline_o%'",
      )
      .get(coupleId) as { n: number };
    expect(stored.n).toBe(0);
  });

  test("completing the task removes its nudge with no worker run or stored write", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("notif-done@weddly.test");
    await createOverdueTask(token, "Fotóst lefoglalni");

    // Find the task id and mark it done.
    const list = await req<{ items: { id: number; title: string }[] }>(
      "GET",
      "/api/planning",
      undefined,
      { token },
    );
    const taskId = list.data.items.find((i) => i.title === "Fotóst lefoglalni")?.id;
    expect(taskId).toBeDefined();
    const patch = await req("PATCH", `/api/planning/${taskId}`, { done: true }, { token });
    expect(patch.status).toBe(200);

    const r = await feed(token);
    expect(r.data.overdue).toBe(0);
    expect(r.data.items.some((i) => i.kind === "timeline_overdue")).toBe(false);
  });
});

describe("notifications: badge vs history split", () => {
  test("opening the bell zeroes the badge but keeps an unclicked item in the new list", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("notif-seen@weddly.test");
    await createOverdueTask(token, "Tortát megrendelni");

    const before = await feed(token);
    expect(before.data.unread).toBeGreaterThanOrEqual(1);

    const seen = await req("POST", "/api/notifications/seen", {}, { token });
    expect(seen.status).toBe(200);

    const after = await feed(token);
    // Badge cleared…
    expect(after.data.unread).toBe(0);
    expect(after.data.items.length).toBe(before.data.items.length);
    // …but the unclicked item is NOT read: it stays in the "new" list until the
    // user actually clicks it (the whole point of the fix).
    const tl = after.data.items.find((i) => i.kind === "timeline_overdue");
    expect(tl?.read).toBe(false);
  });

  test("clicking one item marks only that one read; the rest stay new", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("notif-read@weddly.test");
    await createOverdueTask(token, "Tortát megrendelni");
    await createOverdueTask(token, "Fotóst lefoglalni");

    const before = await feed(token);
    const overdue = before.data.items.filter((i) => i.kind === "timeline_overdue");
    expect(overdue.length).toBe(2);
    const target = overdue[0];

    const mark = await req("POST", "/api/notifications/read", { id: target?.id }, { token });
    expect(mark.status).toBe(200);

    const after = await feed(token);
    // The clicked one moved to history…
    expect(after.data.items.find((i) => i.id === target?.id)?.read).toBe(true);
    // …the other overdue item is untouched.
    const others = after.data.items.filter(
      (i) => i.kind === "timeline_overdue" && i.id !== target?.id,
    );
    expect(others.length).toBe(1);
    expect(others.every((i) => !i.read)).toBe(true);
  });

  test("markRead is idempotent and rejects an empty id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("notif-read-bad@weddly.test");
    await createOverdueTask(token, "Tortát megrendelni");
    const before = await feed(token);
    const id = before.data.items.find((i) => i.kind === "timeline_overdue")?.id;

    // Twice is fine (ON CONFLICT DO NOTHING).
    expect((await req("POST", "/api/notifications/read", { id }, { token })).status).toBe(200);
    expect((await req("POST", "/api/notifications/read", { id }, { token })).status).toBe(200);
    // Empty id is a 400.
    expect((await req("POST", "/api/notifications/read", { id: "" }, { token })).status).toBe(400);
  });
});

describe("notifications: couple-vs-user isolation", () => {
  test("partner A opening the bell does NOT clear partner B's badge", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("notif-iso-a@weddly.test");
    const bToken = await addPartnerB(aToken, "notif-iso-b@weddly.test");

    // A creates an overdue task — both partners should now have unread items.
    await createOverdueTask(aToken, "Zenekart lefoglalni");

    const aBefore = await feed(aToken);
    const bBefore = await feed(bToken);
    expect(aBefore.data.unread).toBeGreaterThanOrEqual(1);
    expect(bBefore.data.unread).toBeGreaterThanOrEqual(1);

    // B sees the "partner added a to-do" event as a fresh notification. A (the
    // actor) also sees it in the full couple history, but flagged as its own
    // action and pre-read, so it never counts toward A's unread badge.
    expect(bBefore.data.items.some((i) => i.kind === "partner_task_added")).toBe(true);
    const aOwn = aBefore.data.items.find((i) => i.kind === "partner_task_added");
    expect(aOwn?.is_own_action).toBe(true);

    // A opens the bell.
    await req("POST", "/api/notifications/seen", {}, { token: aToken });

    const aAfter = await feed(aToken);
    const bAfter = await feed(bToken);
    expect(aAfter.data.unread).toBe(0);
    // B's badge is untouched — the watermark is per user.
    expect(bAfter.data.unread).toBeGreaterThanOrEqual(1);
  });
});

describe("notifications: stale dateless to-do reminder", () => {
  test("a dateless, not-done task parked 7+ days surfaces a gentle nudge", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-stale@weddly.test");
    insertTask(coupleId, { title: "Köszönőajándék ötlet", created_at: Date.now() - 8 * DAY_MS });

    const r = await feed(token);
    const stale = r.data.items.find((i) => i.kind === "planning_stale_task");
    expect(stale).toBeDefined();
    expect(stale?.data.taskTitle).toBe("Köszönőajándék ötlet");
    expect(stale?.link).toBe("/app/planning");

    // Computed — never written to couple_notifications.
    const stored = db
      .prepare(
        "SELECT COUNT(*) AS n FROM couple_notifications WHERE couple_id = ? AND kind = 'planning_stale_task'",
      )
      .get(coupleId) as { n: number };
    expect(stored.n).toBe(0);
  });

  test("does NOT fire for a fresh task, a done task, a dated task, or a decision prompt", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-stale-neg@weddly.test");
    const old = Date.now() - 30 * DAY_MS;
    insertTask(coupleId, { title: "Friss feladat", created_at: Date.now() - 2 * DAY_MS }); // too fresh
    insertTask(coupleId, { title: "Kész feladat", done: 1, created_at: old }); // done
    insertTask(coupleId, { title: "Dátumos feladat", due_date: "2099-01-01", created_at: old }); // dated
    insertTask(coupleId, {
      title: "Döntés prompt",
      seed_key: "x_seed",
      decision_status: "open",
      created_at: old,
    }); // decision prompt, excluded

    const r = await feed(token);
    expect(r.data.items.some((i) => i.kind === "planning_stale_task")).toBe(false);
  });

  test("caps the stale nudges at 3 even when more qualify", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-stale-cap@weddly.test");
    const old = Date.now() - 10 * DAY_MS;
    for (let i = 0; i < 6; i++) insertTask(coupleId, { title: `Ötlet ${i}`, created_at: old });

    const r = await feed(token);
    const stale = r.data.items.filter((i) => i.kind === "planning_stale_task");
    expect(stale.length).toBe(3);
  });
});

describe("notifications: stalled decisions category reminder", () => {
  function seedOpenPrompts(
    coupleId: number,
    count: number,
    ageDays: number,
    group: "guests" | "food_drink" = "guests",
  ): void {
    const seeds = promptsForGroup(group).slice(0, count);
    expect(seeds.length).toBe(count); // guard: the group has enough seeds
    const ts = Date.now() - ageDays * DAY_MS;
    for (const s of seeds) {
      insertTask(coupleId, {
        title: s.title.hu,
        seed_key: s.seed_key,
        decision_status: "open",
        created_at: ts,
        updated_at: ts,
      });
    }
  }

  test("10+ open prompts in a group untouched 14+ days fires one nudge with the count", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-dec@weddly.test");
    seedOpenPrompts(coupleId, 12, 20);

    const r = await feed(token);
    const dec = r.data.items.filter((i) => i.kind === "planning_decisions_stale");
    expect(dec.length).toBe(1);
    expect(dec[0]?.data.count).toBe(12);
    expect(dec[0]?.data.group).toBe("guests");
    expect(dec[0]?.data.groups).toBe(1);
    expect(dec[0]?.link).toBe("/app/planning");
  });

  test("several stalled themes collapse into ONE row, not one per theme", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-dec-many@weddly.test");
    seedOpenPrompts(coupleId, 12, 20, "guests");
    seedOpenPrompts(coupleId, 11, 30, "food_drink");

    const r = await feed(token);
    const dec = r.data.items.filter((i) => i.kind === "planning_decisions_stale");
    // The bell used to carry one near-identical row per theme, which buried
    // every other kind of notification under a single feature.
    expect(dec.length).toBe(1);
    expect(dec[0]?.data.count).toBe(23); // the total across both themes
    expect(dec[0]?.data.groups).toBe(2);
    // Named theme = the biggest one, so the label can still say something.
    expect(dec[0]?.data.group).toBe("guests");
    // Dated from the EARLIEST crossing (the 30-day-old theme), so a newly
    // stalling theme can't bounce the row back to the top of the feed.
    const olderCrossing = Date.now() - (30 - 14) * DAY_MS;
    expect(dec[0]?.created_at).toBeLessThanOrEqual(olderCrossing + 60_000);
  });

  test("does NOT fire under the count threshold", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-dec-few@weddly.test");
    seedOpenPrompts(coupleId, 9, 20);

    const r = await feed(token);
    expect(r.data.items.some((i) => i.kind === "planning_decisions_stale")).toBe(false);
  });

  test("does NOT fire when the category was touched recently", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-dec-fresh@weddly.test");
    seedOpenPrompts(coupleId, 12, 3); // 3 days old < 14-day threshold

    const r = await feed(token);
    expect(r.data.items.some((i) => i.kind === "planning_decisions_stale")).toBe(false);
  });
});

describe("notifications: M3 email escalation", () => {
  function escalationCount(coupleId: number): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM email_log
           WHERE kind = 'timeline_escalation'
             AND user_id IN (SELECT id FROM users WHERE couple_id = ?)`,
      )
      .get(coupleId) as { n: number };
    return row.n;
  }

  test("emails an overdue couple once, then respects the weekly cooldown", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-esc@weddly.test");
    // Default escalation is 'overdue'; make it explicit for clarity.
    await req("PATCH", "/api/couples/current", { timeline_email_escalation: "overdue" }, { token });
    await createOverdueTask(token, "Karikagyűrűket beszerezni");

    runEmailSweep();
    expect(escalationCount(coupleId)).toBe(1);

    // A second sweep in the same week must NOT re-send.
    runEmailSweep();
    expect(escalationCount(coupleId)).toBe(1);
  });

  test("'off' silences the email entirely", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notif-esc-off@weddly.test");
    await req("PATCH", "/api/couples/current", { timeline_email_escalation: "off" }, { token });
    await createOverdueTask(token, "Meghívókat megrendelni");

    runEmailSweep();
    expect(escalationCount(coupleId)).toBe(0);
  });
});
