// Public landing-page counters, and the admin-set display offset that sits on
// top of each one.
//
// The four numbers the marketing surface quotes (onboarded couples, RSVPs
// collected, Pro vendors on board, businesses in the directory) are counted
// from live rows. `public_stat_boosts` adds a per-counter offset to the number
// the PUBLIC sees, edited at /app/admin/public-stats.
//
// A counter can also be WITHHELD entirely (`hidden`), which is a different
// answer from a boost of 0: a young number that reads worse than no number at
// all is taken off the public surface rather than padded into something it is
// not. A withheld counter leaves the server as `null`, so nothing downstream
// has to be trusted to skip rendering a figure it was handed.
//
// Three rules keep this honest internally, whatever the public page ends up
// saying:
//   - The boost is ADDITIVE and stored on its own, never folded into the
//     measured count. Nothing overwrites a real number, so the truth is always
//     one SELECT away and turning every boost back to 0 restores the measured
//     figures exactly.
//   - The admin surface always renders `real` and `shown` side by side. An
//     operator reading their own dashboard must never have to work out which
//     of the two they are looking at. Hiding changes what the PUBLIC gets, and
//     nothing about what admin is shown.
//   - A hidden counter is quoted NOWHERE public, not just dimmed on the band
//     it names. That is why the payload carries `null` rather than the number
//     plus a flag.
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
 *  public payload deliberately carries no way to tell the two apart — and a
 *  counter an admin has hidden is `null`, meaning "we are not saying". Every
 *  consumer has to handle that: a withheld counter is never rendered as 0. */
export interface PublicStats {
  /** Active, onboarded, non-demo workspaces. */
  couples: number | null;
  /** Guests who answered (yes / no / maybe) on a real, active workspace. */
  rsvps: number | null;
  /** Vendors with a real Weddly account: registered or claimed their listing.
   *  This is what the founding-round counter on the landing counts down. */
  vendors: number | null;
  /** Businesses live in the directory, whoever put them there. */
  listings: number | null;
  ts: number;
}

/** One admin row: the measured number, the offset, their sum, and whether the
 *  public is being shown it at all. */
export interface AdminPublicStatRow {
  key: PublicStatKey;
  /** Counted from live rows this second. Never written to. */
  real: number;
  /** The admin-set offset. 0 means the public sees the measured number. */
  boost: number;
  /** real + boost — what the public page renders while the counter is shown.
   *  Reported whether or not it is hidden, because admin always sees both. */
  shown: number;
  /** True = withheld from every public surface (the payload sends `null`). */
  hidden: boolean;
  updated_at: number | null;
}

export interface AdminPublicStatsView {
  items: AdminPublicStatRow[];
}

/** PATCH body: a partial map, so a form about one counter can't zero the rest.
 *  An absent key means "leave it alone"; a number replaces that offset.
 *
 *  Visibility rides the same body under its own `hidden` map (not a counter
 *  key, so the two can't collide) and is partial in exactly the same way — a
 *  body that says nothing about a counter's visibility must not reveal one an
 *  admin hid. */
export type AdminPublicStatsPatch = Partial<Record<PublicStatKey, number>> & {
  hidden?: Partial<Record<PublicStatKey, boolean>>;
};

/** Narrow an untrusted string to a counter key. */
export function isPublicStatKey(value: string): value is PublicStatKey {
  return (PUBLIC_STAT_KEYS as readonly string[]).includes(value);
}
