// Public landing-page counters, and the admin-set display offset that sits on
// top of each one.
//
// The four numbers the marketing surface quotes (onboarded couples, RSVPs
// collected, Pro vendors on board, businesses in the directory) are counted
// from live rows. `public_stat_boosts` adds a per-counter offset to the number
// the PUBLIC sees, edited at /app/admin/public-stats.
//
// Two rules keep this honest internally, whatever the public page ends up
// saying:
//   - The boost is ADDITIVE and stored on its own, never folded into the
//     measured count. Nothing overwrites a real number, so the truth is always
//     one SELECT away and turning every boost back to 0 restores the measured
//     figures exactly.
//   - The admin surface always renders `real` and `shown` side by side. An
//     operator reading their own dashboard must never have to work out which
//     of the two they are looking at.
//
// Everything analytics-facing (/app/admin/analytics, the financial planner,
// every campaign counter) reads its own queries and is deliberately NOT routed
// through this module: a presentation offset that leaked into the numbers the
// business is steered by would be a self-inflicted wound.

/** The counters an admin can offset. Order is the admin page's row order. */
export const PUBLIC_STAT_KEYS = ["couples", "rsvps", "vendors", "listings"] as const;

export type PublicStatKey = (typeof PUBLIC_STAT_KEYS)[number];

/** Upper bound on a single offset. Not a policy about what is reasonable, just
 *  a guard so a slipped keypress can't store a 12-digit number that overflows
 *  the count-up animation and the layout with it. */
export const MAX_STAT_BOOST = 1_000_000;

/** What GET /api/public/stats serves. Every field is already boosted — the
 *  public payload deliberately carries no way to tell the two apart. */
export interface PublicStats {
  /** Active, onboarded, non-demo workspaces. */
  couples: number;
  /** Guests who answered (yes / no / maybe) on a real, active workspace. */
  rsvps: number;
  /** Vendors with a real Weddly account: registered or claimed their listing.
   *  This is what the founding-round counter on the landing counts down. */
  vendors: number;
  /** Businesses live in the directory, whoever put them there. */
  listings: number;
  ts: number;
}

/** One admin row: the measured number, the offset, and their sum. */
export interface AdminPublicStatRow {
  key: PublicStatKey;
  /** Counted from live rows this second. Never written to. */
  real: number;
  /** The admin-set offset. 0 means the public sees the measured number. */
  boost: number;
  /** real + boost — exactly what the public page renders. */
  shown: number;
  updated_at: number | null;
}

export interface AdminPublicStatsView {
  items: AdminPublicStatRow[];
}

/** PATCH body: a partial map, so a form about one counter can't zero the rest.
 *  An absent key means "leave it alone"; a number replaces that offset. */
export type AdminPublicStatsPatch = Partial<Record<PublicStatKey, number>>;

/** Narrow an untrusted string to a counter key. */
export function isPublicStatKey(value: string): value is PublicStatKey {
  return (PUBLIC_STAT_KEYS as readonly string[]).includes(value);
}
