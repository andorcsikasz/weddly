// Public landing-page counters.
//
//   GET /api/public/stats — { couples, rsvps, ts }
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

import { db, now } from "../db";
import { json, type Router } from "../lib/http";

interface PublicStats {
  couples: number;
  rsvps: number;
}

let cache: { ts: number; value: PublicStats } | null = null;
const TTL_MS = 60_000;

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

export function registerPublicStatsRoutes(router: Router) {
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
