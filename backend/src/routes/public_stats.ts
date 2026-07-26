// Public landing-page counters.
//
//   GET /api/public/stats — { couples, rsvps, ts }
//   GET /api/public/vendor-stats — { visits_28d, inquiries_30d, offer }
//
// The second one feeds the public /vendors recruitment page. Its whole reason
// to exist: every number that page quotes (how much traffic flows through
// Weddly, how much inquiry volume is flowing, how many spots the current free
// round has left) is read from live rows instead of being typed into the copy,
// so the pitch cannot drift away from the truth. The page self-hides any
// counter it considers too small to show.
//
// `couples` is the number of real, onboarded, active workspaces (demo rows
// stamped with `is_demo = 1` are excluded so the visible number reflects
// actual signups, not throwaway Shrek & Fiona demos). `rsvps` is the number
// of guest rows with a non-pending status whose couple is also real + active.
//
// Cached in-process for 60s. The landing page is the highest-traffic public
// route in the app, and these two COUNT(*)s walk the full guests table — at a
// few thousand rows it's cheap, but caching keeps the cost flat regardless of
// landing traffic.

import type { PublicVendorStats } from "@shared/vendor_billing";
import { db, now } from "../db";
import { currentVendorOffer } from "../domain/vendor_billing";
import { json, type Router } from "../lib/http";

interface PublicStats {
  couples: number;
  rsvps: number;
}

let cache: { ts: number; value: PublicStats } | null = null;
let vendorCache: { ts: number; value: PublicVendorStats } | null = null;
const TTL_MS = 60_000;

/** Window the vendor-facing demand counter looks back over. */
const INQUIRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Window the public-traffic counter looks back over. */
const VISIT_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

/** Public page-view growth events that count as a Weddly-hosted page visit.
 *  All three fire for anonymous visitors on public URLs (no auth, no PII). */
const VISIT_KINDS = ["wedding_site.view", "rsvp.page.view", "guest.portal.view"] as const;

function computeStats(): PublicStats {
  const couples = db
    .prepare(
      `SELECT COUNT(*) AS n FROM couples
       WHERE status = 'active' AND is_demo = 0 AND onboarded_at IS NOT NULL`,
    )
    .get() as { n: number };

  const rsvps = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM guests g
       JOIN couples c ON c.id = g.couple_id
       WHERE g.rsvp_status != 'pending'
         AND c.is_demo = 0
         AND c.status = 'active'`,
    )
    .get() as { n: number };

  return { couples: couples.n, rsvps: rsvps.n };
}

/** Vendor-facing counters. `visits_28d` sums the public page-view growth events
 *  (wedding-site + RSVP-page + guest-portal) over the last 28 days — the honest
 *  "traffic flowing through Weddly" number, all real anonymous visitors on
 *  Weddly-hosted pages. `inquiries_30d` counts outreach messages that actually
 *  went out, which is the honest read of "couples are writing to vendors" —
 *  queued or bounced rows never reached anyone. The offer comes straight from
 *  the same helper the activation grant uses, so the public scarcity line and
 *  the slot a signup would actually receive can't disagree. */
export function computeVendorStats(ts: number): PublicVendorStats {
  const placeholders = VISIT_KINDS.map(() => "?").join(", ");
  const visits = db
    .prepare(
      `SELECT COUNT(*) AS n FROM growth_events
        WHERE kind IN (${placeholders}) AND created_at >= ?`,
    )
    .get(...VISIT_KINDS, ts - VISIT_WINDOW_MS) as { n: number };

  const inquiries = db
    .prepare(
      `SELECT COUNT(*) AS n FROM outreach_messages
        WHERE status IN ('sent', 'replied') AND sent_at IS NOT NULL AND sent_at >= ?`,
    )
    .get(ts - INQUIRY_WINDOW_MS) as { n: number };

  return { visits_28d: visits.n, inquiries_30d: inquiries.n, offer: currentVendorOffer() };
}

export function registerPublicStatsRoutes(router: Router) {
  router.get("/api/public/vendor-stats", () => {
    const ts = Date.now();
    if (!vendorCache || ts - vendorCache.ts > TTL_MS) {
      vendorCache = { ts, value: computeVendorStats(ts) };
    }
    return json(vendorCache.value, { headers: { "Cache-Control": "public, max-age=60" } });
  });

  router.get("/api/public/stats", () => {
    const ts = Date.now();
    if (!cache || ts - cache.ts > TTL_MS) {
      cache = { ts, value: computeStats() };
    }
    return json(
      { ...cache.value, ts: now() },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  });
}
