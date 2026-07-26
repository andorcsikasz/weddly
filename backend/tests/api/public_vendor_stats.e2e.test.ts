// GET /api/public/vendor-stats — the live numbers behind the public /vendors
// recruitment page.
//
// Contract:
//   - Anonymous callers get { couples, inquiries_30d, offer }.
//   - `couples` uses the landing-page definition (active, onboarded, non-demo).
//   - `inquiries_30d` counts outreach messages that were actually SENT inside
//     the 30-day window. Queued rows never reached a vendor, and anything older
//     than the window is not "current demand", so neither counts.
//   - `offer` is the same value the activation grant would hand out, so the
//     scarcity line on the page can never promise a round that isn't live.
//
// The route caches for 60s, which outlives a test run, so the counter maths is
// asserted against the exported compute function and the HTTP layer is probed
// separately for the public contract (same split as public_stats.e2e.test.ts).

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { db, now } from "../../src/db";
import { computeVendorStats } from "../../src/routes/public_stats";
import { currentVendorOffer } from "../../src/domain/vendor_billing";
import { VENDOR_FOUNDING_CAP } from "@shared/vendor_billing";
import type { PublicVendorStats } from "@shared/vendor_billing";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Insert one outreach message with an explicit status + sent_at, under a
 *  campaign owned by `coupleId`. Returns nothing; the tests only count rows. */
function seedOutreach(coupleId: number, status: string, sentAt: number | null): void {
  const campaign = db
    .prepare(
      `INSERT INTO outreach_campaigns (couple_id, subject, body_template, created_at)
       VALUES (?, 'Ajánlatkérés', 'Szia!', ?) RETURNING id`,
    )
    .get(coupleId, now()) as { id: number };
  db.prepare(
    `INSERT INTO outreach_messages
       (campaign_id, supplier_id, supplier_email, sent_at, status, reply_token, created_at)
     VALUES (?, 'v1', 'vendor@weddly.test', ?, ?, ?, ?)`,
  ).run(campaign.id, sentAt, status, `tok-${Math.round(Math.random() * 1e9)}`, now());
}

describe("GET /api/public/vendor-stats", () => {
  test("is public and returns the three counters", async () => {
    wipeAll();
    const r = await req<PublicVendorStats>("GET", "/api/public/vendor-stats");
    expect(r.status).toBe(200);
    expect(typeof r.data.couples).toBe("number");
    expect(typeof r.data.inquiries_30d).toBe("number");
    expect(["founding", "early", "trial"]).toContain(r.data.offer.tier);
    expect(r.data.offer.spots_left).toBeLessThanOrEqual(r.data.offer.cap);
  });

  test("counts only inquiries actually sent inside the 30-day window", async () => {
    wipeAll();
    db.exec("DELETE FROM outreach_messages; DELETE FROM outreach_campaigns;");
    const { coupleId } = await bootstrapCouple("vendor-stats@weddly.test");
    const ts = now();

    expect(computeVendorStats(ts).inquiries_30d).toBe(0);

    seedOutreach(coupleId, "sent", ts - 2 * DAY_MS);
    seedOutreach(coupleId, "replied", ts - 29 * DAY_MS);
    // Excluded: never left the queue, bounced back, or fell out of the window.
    seedOutreach(coupleId, "queued", null);
    seedOutreach(coupleId, "bounced", ts - DAY_MS);
    seedOutreach(coupleId, "sent", ts - 40 * DAY_MS);

    expect(computeVendorStats(ts).inquiries_30d).toBe(2);
  });

  test("couples counter matches the onboarded, non-demo definition", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("vendor-stats-couples@weddly.test");
    expect(computeVendorStats(now()).couples).toBe(1);

    db.prepare("UPDATE couples SET is_demo = 1 WHERE id = ?").run(coupleId);
    expect(computeVendorStats(now()).couples).toBe(0);
  });

  test("offer mirrors the grant helper, so the page can't advertise a dead round", () => {
    wipeAll();
    const offer = computeVendorStats(now()).offer;
    expect(offer).toEqual(currentVendorOffer());
    // Fresh DB: no founding badges granted yet, so the first round is fully open.
    expect(offer.tier).toBe("founding");
    expect(offer.spots_left).toBe(VENDOR_FOUNDING_CAP);
  });
});
