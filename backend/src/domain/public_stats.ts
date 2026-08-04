// The four public landing counters and the admin-set offset on each.
//
// `computePublicStatsReal` is the measured half: four COUNT(*)s against live
// rows, with demo workspaces excluded everywhere so the landing never
// advertises throwaway Shrek-&-Fiona traffic as real signups. `getStatBoosts`
// is the presentation half: the number an admin has chosen to add on top
// before the payload leaves the server.
//
// The two are kept apart on purpose (see shared/public_stats.ts). Nothing here
// ever writes a measured number, so setting every boost back to 0 restores the
// counted figures exactly, and the admin surface can always show both.

import {
  MAX_STAT_BOOST,
  type AdminPublicStatsPatch,
  type PublicStatKey,
  PUBLIC_STAT_KEYS,
} from "@shared/public_stats";
import { db, now } from "../db";

/** The measured counts, before any offset. */
export type RealPublicStats = Record<PublicStatKey, number>;

/** Counted fresh on every call (the route caches the RESULT for 60s, which is
 *  what keeps the landing's cost flat regardless of traffic). */
export function computePublicStatsReal(): RealPublicStats {
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

  // A vendor with a real Weddly account: registered here, or claimed the
  // listing we already had for them. This is the number the founding-round
  // counter on the landing counts down from VENDOR_FOUNDING_CAP, so it has to
  // be the same population the free window is actually granted to.
  const vendors = db.prepare(`SELECT COUNT(*) AS n FROM vendor_accounts`).get() as { n: number };

  // Businesses live in the directory, whoever put them there: curated,
  // community-submitted and claimed alike. `status = 'active'` drops the
  // pending queue and anything an admin has hidden.
  const listings = db
    .prepare(`SELECT COUNT(*) AS n FROM listings WHERE status = 'active'`)
    .get() as { n: number };

  return { couples: couples.n, rsvps: rsvps.n, vendors: vendors.n, listings: listings.n };
}

/** Every counter's offset, defaulting to 0 for a key with no row yet. */
export function getStatBoosts(): Record<PublicStatKey, number> {
  const rows = db.prepare(`SELECT key, amount FROM public_stat_boosts`).all() as {
    key: string;
    amount: number;
  }[];
  const boosts = Object.fromEntries(PUBLIC_STAT_KEYS.map((k) => [k, 0])) as Record<
    PublicStatKey,
    number
  >;
  for (const row of rows) {
    if ((PUBLIC_STAT_KEYS as readonly string[]).includes(row.key)) {
      boosts[row.key as PublicStatKey] = row.amount;
    }
  }
  return boosts;
}

/** When each offset was last touched — the admin table's only metadata. */
export function getStatBoostTimestamps(): Partial<Record<PublicStatKey, number>> {
  const rows = db.prepare(`SELECT key, updated_at FROM public_stat_boosts`).all() as {
    key: string;
    updated_at: number;
  }[];
  const out: Partial<Record<PublicStatKey, number>> = {};
  for (const row of rows) {
    if ((PUBLIC_STAT_KEYS as readonly string[]).includes(row.key)) {
      out[row.key as PublicStatKey] = row.updated_at;
    }
  }
  return out;
}

/** Clamp an untrusted offset into [0, MAX_STAT_BOOST]. A negative offset is
 *  refused rather than clamped by the caller: subtracting from a measured
 *  count would hide real signups from our own dashboard, which is a different
 *  (and worse) thing than padding the marketing page. */
export function normalizeBoost(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n < 0 || n > MAX_STAT_BOOST) return null;
  return n;
}

/** Apply a partial patch. Absent keys are left alone; the returned array names
 *  the keys that actually changed, which is what the audit note records. */
export function setStatBoosts(patch: AdminPublicStatsPatch, adminUserId: number): PublicStatKey[] {
  const ts = now();
  const changed: PublicStatKey[] = [];
  const current = getStatBoosts();
  const write = db.prepare(
    `INSERT INTO public_stat_boosts (key, amount, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       amount = excluded.amount,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  );
  const tx = db.transaction(() => {
    for (const key of PUBLIC_STAT_KEYS) {
      const next = patch[key];
      if (next === undefined) continue;
      if (next === current[key]) continue;
      write.run(key, next, ts, adminUserId);
      changed.push(key);
    }
  });
  tx();
  return changed;
}
