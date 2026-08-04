// Public landing-page counters.
//
//   GET /api/public/stats — { couples, rsvps, vendors, listings, ts }
//   GET /api/public/vendor-stats — { visits_28d, inquiries_30d, offer }
//
// The second one feeds the public /vendors recruitment page. Its whole reason
// to exist: every number that page quotes (how much traffic flows through
// Weddly, how much inquiry volume is flowing, how many spots the current free
// round has left) is read from live rows instead of being typed into the copy,
// so the pitch cannot drift away from the truth. The page self-hides any
// counter it considers too small to show.
//
// The first one is measured the same way (see `computePublicStatsReal` in
// domain/public_stats.ts: onboarded non-demo workspaces, answered RSVPs on
// those workspaces, vendor accounts, active directory listings) and then has
// the admin-set display offset from `public_stat_boosts` ADDED before it goes
// out. Nothing measured is ever overwritten, so zeroing every offset restores
// the counted numbers exactly, and /app/admin/public-stats shows both.
//
// Cached in-process for 60s. The landing page is the highest-traffic public
// route in the app, and these COUNT(*)s walk the full guests + listings
// tables — at a few thousand rows it's cheap, but caching keeps the cost flat
// regardless of landing traffic. `resetPublicStatsCache` is what makes an
// admin edit visible immediately rather than up to a minute later; without it
// an operator would type a number, reload the landing, see the old one and
// reasonably conclude the save had failed.

import type { PublicStats } from "@shared/public_stats";
import type { PublicVendorStats } from "@shared/vendor_billing";
import { db, now } from "../db";
import { computePublicStatsReal, getStatBoosts } from "../domain/public_stats";
import { currentVendorOffer } from "../domain/vendor_billing";
import { json, type Router } from "../lib/http";

type CountedStats = Omit<PublicStats, "ts">;

let cache: { ts: number; value: CountedStats } | null = null;
let vendorCache: { ts: number; value: PublicVendorStats } | null = null;
const TTL_MS = 60_000;

/** Drop the 60s cache. Called by the admin write path so a saved offset is on
 *  the landing page by the time the operator reloads it. */
export function resetPublicStatsCache() {
  cache = null;
}

/** Window the vendor-facing demand counter looks back over. */
const INQUIRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Window the public-traffic counter looks back over. */
const VISIT_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

/** Public page-view growth events that count as a Weddly-hosted page visit.
 *  All three fire for anonymous visitors on public URLs (no auth, no PII). */
const VISIT_KINDS = ["wedding_site.view", "rsvp.page.view", "guest.portal.view"] as const;

/** Measured counts + the admin offset on each. The public payload carries no
 *  way to tell the two apart, which is the whole point of the offset; the
 *  admin surface is where they are separated again. */
function computeStats(): CountedStats {
  const real = computePublicStatsReal();
  const boost = getStatBoosts();
  return {
    couples: real.couples + boost.couples,
    rsvps: real.rsvps + boost.rsvps,
    vendors: real.vendors + boost.vendors,
    listings: real.listings + boost.listings,
  };
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
