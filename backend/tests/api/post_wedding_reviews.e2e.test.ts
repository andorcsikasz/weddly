// Post-wedding "rate your vendors" prompt: the vendors-to-review endpoint and
// the T+7 followup sweep that (when the couple picked vendors) sends the
// rate-vendors email + in-app notification instead of the generic NPS.
//
// Covers (major-change rule: new endpoint + new email/notification + sweep
// branch): the endpoint returns only real, unreviewed picks (sentinels and
// already-reviewed dropped); the T+7 sweep fires the review_vendors
// notification when there are vendors and is idempotent; a couple with no
// concrete vendor gets the NPS, not the rate-vendors prompt.

import "../setup";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, req, wipeAll } from "../helpers";

/** UTC-midnight `YYYY-MM-DD` for `offsetDays` from today — matches the worker's
 *  startOfDayUtc + ymd, so a wedding_date set to t7Ago() lands exactly on the
 *  T+7 followup target. */
function ymdOffset(offsetDays: number): string {
  const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  return new Date(today + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
const t7Ago = () => ymdOffset(-7);

function setWeddingDate(coupleId: number, ymd: string) {
  db.prepare("UPDATE couples SET wedding_date = ? WHERE id = ?").run(ymd, coupleId);
}
function addPick(coupleId: number, category: string, supplierId: string) {
  db.prepare(
    "INSERT OR REPLACE INTO couple_picks (couple_id, category, supplier_id, picked_by_user_id, picked_at) VALUES (?, ?, ?, NULL, ?)",
  ).run(coupleId, category, supplierId, Date.now());
}
function reviewNotifs(coupleId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM couple_notifications WHERE couple_id = ? AND kind = 'review_vendors'",
      )
      .get(coupleId) as { n: number }
  ).n;
}

// An existing curated vendor id that resolveSupplierBase resolves.
const REAL_VENDOR = "normafa-rendezvenyhaz";

describe("post-wedding rate-vendors", () => {
  beforeEach(() => wipeAll());
  afterEach(() => {
    db.prepare("DELETE FROM couple_notifications").run();
  });

  test("vendors-to-review lists only real, unreviewed picks", async () => {
    const { token, coupleId } = await bootstrapCouple("rate-a@weddly.test");
    addPick(coupleId, "venue", REAL_VENDOR);
    addPick(coupleId, "florist", "not-needed"); // sentinel → excluded

    const r = await req<{ vendors: Array<{ id: string; name: string; category: string }> }>(
      "GET",
      "/api/couples/current/vendors-to-review",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.vendors.map((v) => v.id)).toEqual([REAL_VENDOR]);
    expect(r.data.vendors[0]?.category).toBe("venue");

    // Once the couple reviews it, it drops off the list.
    const rev = await req(
      "POST",
      `/api/suppliers/${REAL_VENDOR}/reviews`,
      { rating: 5 },
      { token },
    );
    expect(rev.status).toBe(201);
    const after = await req<{ vendors: unknown[] }>(
      "GET",
      "/api/couples/current/vendors-to-review",
      undefined,
      { token },
    );
    expect(after.data.vendors).toHaveLength(0);
  });

  test("T+7 sweep sends the review_vendors notification when picks exist, idempotently", async () => {
    const { coupleId } = await bootstrapCouple("rate-b@weddly.test");
    setWeddingDate(coupleId, t7Ago());
    addPick(coupleId, "venue", REAL_VENDOR);

    expect(reviewNotifs(coupleId)).toBe(0);
    runEmailSweep();
    expect(reviewNotifs(coupleId)).toBe(1);
    // Second sweep the same day must not double-notify (markDispatched guard).
    runEmailSweep();
    expect(reviewNotifs(coupleId)).toBe(1);
  });

  test("T+7 sweep skips the rate-vendors prompt when the couple picked no vendor", async () => {
    const { coupleId } = await bootstrapCouple("rate-c@weddly.test");
    setWeddingDate(coupleId, t7Ago());
    // Only a sentinel pick — nothing concrete to rate.
    addPick(coupleId, "florist", "not-needed");

    runEmailSweep();
    expect(reviewNotifs(coupleId)).toBe(0);
  });
});
