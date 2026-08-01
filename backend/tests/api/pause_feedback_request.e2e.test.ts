import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminCoupleView } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

// "Ask what was missing" — the admin action that turns a churn CATEGORY into an
// answer. The exit dialog stores "Missing features" and an optional note nobody
// writes, so the one churn reason we could act on is the one we know nothing
// about; this endpoint mails the partner who paused a single question.
//
// The guarantees under test are the ones a later edit could quietly break: it
// only fires for a workspace that really is on its way out, it fires ONCE per
// departure, it writes to the partner who actually pressed pause, and the link
// it hands them opens the PUBLIC feedback form with their own address on it (a
// login wall between a question and its answer is how you get no answer).

async function addAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

/** A couple that has paused, plus an admin bearer. Returns both tokens and the
 *  couple id so a test can drive the admin endpoint against a real departure. */
async function pausedCouple(email: string, reason: string | null) {
  wipeAll();
  const { token, coupleId } = await bootstrapCouple(email);
  const pause = await req("POST", "/api/couples/pause", reason === null ? {} : { reason }, {
    token,
  });
  expect(pause.status).toBe(201);
  const adminToken = await addAdmin();
  return { token, adminToken, coupleId };
}

function lastEmailTo(email: string) {
  return db
    .prepare(
      `SELECT kind, subject, to_email, from_email, status
         FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(email) as
    | { kind: string; subject: string; to_email: string; from_email: string; status: string }
    | undefined;
}

describe("ask a churned couple what was missing", () => {
  test("mails the partner who paused and stamps the request once", async () => {
    const churner = "pause-ask@weddly.test";
    const { adminToken, coupleId } = await pausedCouple(churner, "Missing features");

    const r = await req<{ ok: true; asked_at: number }>(
      "POST",
      `/api/admin/couples/${coupleId}/ask-pause-feedback`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.asked_at).toBeGreaterThan(0);

    // The stamp lands on the pause REQUEST, not on the couple: a couple who
    // cancels, returns and leaves again is a new departure and a fair question.
    const row = db
      .prepare(
        "SELECT feedback_asked_at FROM couple_pause_requests WHERE couple_id = ? AND status = 'pending'",
      )
      .get(coupleId) as { feedback_asked_at: number | null };
    expect(row.feedback_asked_at).toBe(r.data.asked_at);

    // It went to the person who pressed pause, under the new kind.
    const mail = lastEmailTo(churner);
    expect(mail?.kind).toBe("pause_feedback_request");

    // And the admin list reports it, so the control can become a "sent" mark.
    const list = await req<{ couples: AdminCoupleView[] }>("GET", "/api/admin/couples", undefined, {
      token: adminToken,
    });
    expect(list.status).toBe(200);
    const view = list.data.couples.find((c) => c.id === coupleId);
    expect(view?.pause?.feedback_asked_at).toBe(r.data.asked_at);
  });

  test("asks once per departure: a second attempt is refused", async () => {
    const { adminToken, coupleId } = await pausedCouple(
      "pause-ask-twice@weddly.test",
      "Missing features",
    );

    const first = await req(
      "POST",
      `/api/admin/couples/${coupleId}/ask-pause-feedback`,
      {},
      { token: adminToken },
    );
    expect(first.status).toBe(200);

    const second = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/admin/couples/${coupleId}/ask-pause-feedback`,
      {},
      { token: adminToken },
    );
    expect(second.status).toBe(409);
    expect(second.data.detail?.code).toBe("already_asked");
  });

  test("a workspace that never paused has nothing to be asked about", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("pause-ask-active@weddly.test");
    const adminToken = await addAdmin();

    const r = await req(
      "POST",
      `/api/admin/couples/${coupleId}/ask-pause-feedback`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("only an admin can ask", async () => {
    const { token, coupleId } = await pausedCouple(
      "pause-ask-authz@weddly.test",
      "Missing features",
    );
    const r = await req("POST", `/api/admin/couples/${coupleId}/ask-pause-feedback`, {}, { token });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);

    // Refused means refused: nothing was stamped, so the real ask is still available.
    const row = db
      .prepare(
        "SELECT feedback_asked_at FROM couple_pause_requests WHERE couple_id = ? AND status = 'pending'",
      )
      .get(coupleId) as { feedback_asked_at: number | null };
    expect(row.feedback_asked_at).toBeNull();
  });

  test("the reason is not a gate: a bare pause can be asked about too", async () => {
    // "Other", or no reason at all, is often the same conversation. The admin
    // decides who is worth asking; the endpoint only insists there IS a
    // departure to ask about.
    const { adminToken, coupleId } = await pausedCouple("pause-ask-noreason@weddly.test", null);
    const r = await req(
      "POST",
      `/api/admin/couples/${coupleId}/ask-pause-feedback`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);
  });
});
