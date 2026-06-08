import "../setup";

import { describe, expect, test } from "bun:test";
import type { NotificationFeed } from "@shared/notifications";
import { db } from "../../src/db";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

const PAST_DUE = "2020-01-01"; // always overdue relative to "today"

interface RegisterResp {
  token: string;
  user: { id: number; email: string };
}

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
  const reg = await req<RegisterResp>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Partner B",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
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

describe("notifications: read watermark", () => {
  test("opening the bell zeroes unread but keeps the items visible", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("notif-seen@weddly.test");
    await createOverdueTask(token, "Tortát megrendelni");

    const before = await feed(token);
    expect(before.data.unread).toBeGreaterThanOrEqual(1);

    const seen = await req("POST", "/api/notifications/seen", {}, { token });
    expect(seen.status).toBe(200);

    const after = await feed(token);
    expect(after.data.unread).toBe(0);
    // Items stay visible (still actionable), just marked read.
    expect(after.data.items.length).toBe(before.data.items.length);
    expect(after.data.items.every((i) => i.read)).toBe(true);
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

    // B also sees the "partner added a to-do" event; A does not (hidden from
    // its own actor).
    expect(bBefore.data.items.some((i) => i.kind === "partner_task_added")).toBe(true);
    expect(aBefore.data.items.some((i) => i.kind === "partner_task_added")).toBe(false);

    // A opens the bell.
    await req("POST", "/api/notifications/seen", {}, { token: aToken });

    const aAfter = await feed(aToken);
    const bAfter = await feed(bToken);
    expect(aAfter.data.unread).toBe(0);
    // B's badge is untouched — the watermark is per user.
    expect(bAfter.data.unread).toBeGreaterThanOrEqual(1);
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
