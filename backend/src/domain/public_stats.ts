// The four public landing counters and the admin-set presentation on each.
//
// `computePublicStatsReal` is the measured half: four COUNT(*)s against live
// rows, with demo workspaces excluded everywhere so the landing never
// advertises throwaway Shrek-&-Fiona traffic as real signups. `getStatSettings`
// is the presentation half: the number an admin has chosen to add on top
// before the payload leaves the server, and whether the counter is being
// published at all.
//
// The two are kept apart on purpose (see shared/public_stats.ts). Nothing here
// ever writes a measured number, so setting every boost back to 0 restores the
// counted figures exactly, the admin surface can always show both, and hiding
// a counter withholds it from the public without losing anything.

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

/** How one counter is presented: the offset added to the measured number, and
 *  whether the public is shown it at all. */
export interface PublicStatSetting {
  boost: number;
  hidden: boolean;
  /** When the row was last touched — the admin table's only metadata. */
  updated_at: number | null;
}

/** Every counter's presentation, defaulting to "published, no offset" for a
 *  key with no row yet. A missing row and a zeroed one mean the same thing,
 *  which is what makes deleting the table a full reset. */
export function getStatSettings(): Record<PublicStatKey, PublicStatSetting> {
  const rows = db
    .prepare(`SELECT key, amount, hidden, updated_at FROM public_stat_boosts`)
    .all() as {
    key: string;
    amount: number;
    hidden: number;
    updated_at: number;
  }[];
  const settings = Object.fromEntries(
    PUBLIC_STAT_KEYS.map((k) => [k, { boost: 0, hidden: false, updated_at: null }]),
  ) as Record<PublicStatKey, PublicStatSetting>;
  for (const row of rows) {
    if ((PUBLIC_STAT_KEYS as readonly string[]).includes(row.key)) {
      settings[row.key as PublicStatKey] = {
        boost: row.amount,
        hidden: row.hidden === 1,
        updated_at: row.updated_at,
      };
    }
  }
  return settings;
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

/** Apply a partial patch. Absent keys (and an absent `hidden` entry for a key
 *  the body does name) are left alone; the returned array describes what
 *  actually changed, which is what the audit note records. The row carries
 *  both facts, so each write re-states the half the patch was silent about
 *  from the CURRENT value rather than from a default. */
export function setStatSettings(patch: AdminPublicStatsPatch, adminUserId: number): string[] {
  const ts = now();
  const changed: string[] = [];
  const current = getStatSettings();
  const write = db.prepare(
    `INSERT INTO public_stat_boosts (key, amount, hidden, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       amount = excluded.amount,
       hidden = excluded.hidden,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  );
  const tx = db.transaction(() => {
    for (const key of PUBLIC_STAT_KEYS) {
      const boost = patch[key] ?? current[key].boost;
      const hidden = patch.hidden?.[key] ?? current[key].hidden;
      if (boost === current[key].boost && hidden === current[key].hidden) continue;
      write.run(key, boost, hidden ? 1 : 0, ts, adminUserId);
      if (boost !== current[key].boost) changed.push(`${key}=${boost}`);
      if (hidden !== current[key].hidden) changed.push(`${key}:${hidden ? "hidden" : "shown"}`);
    }
  });
  tx();
  return changed;
}
