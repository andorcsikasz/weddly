// Address-level email suppression.
//
// `email_preferences.lifecycle_opt_out` cannot serve this: it is keyed by
// users.id, and most suppressed addresses have no users row at all (cold
// outreach to a directory listing). Rows in `email_optouts` are permanent
// tombstones, so a re-run of any campaign cannot resurrect an address.
//
// Two ways in:
//   1. The recipient clicks unsubscribe (footer link or the RFC 8058
//      List-Unsubscribe header) — routes/email_track.ts.
//   2. DO_NOT_CONTACT below, for people who told us in writing. Seeded at
//      boot, idempotently, so the tombstone exists in every environment
//      without anyone having to run SQL against the production volume.
//
// Lives in domain/emails rather than domain/vendor_campaign (where these
// helpers started) because `send.ts` — the chokepoint for ALL outbound mail —
// now consults them. Importing a campaign module from the dispatcher would
// have closed an import cycle: every campaign imports the dispatcher.

import { db, now } from "../../db";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isOptedOut(email: string): boolean {
  const row = db
    .prepare("SELECT 1 AS x FROM email_optouts WHERE email = ?")
    .get(normalizeEmail(email)) as { x: number } | undefined;
  return row != null;
}

/** Idempotent. Returns true when this call created the tombstone, so the
 *  route can tell a first opt-out from a re-click without a second query. */
export function addOptOut(email: string, reason: string): boolean {
  const r = db
    .prepare("INSERT OR IGNORE INTO email_optouts (email, reason, created_at) VALUES (?, ?, ?)")
    .run(normalizeEmail(email), reason, now());
  return r.changes === 1;
}

/**
 * Businesses that have asked us, in writing, never to be contacted again.
 *
 * This is the "not a partner" list. It suppresses mail only — the directory
 * listing itself is untouched, because a curated entry is a factual record of
 * a real venue, not a partnership claim. An admin-facing flag that writes the
 * same tombstone is the follow-up; until then this array is the record, and it
 * carries the date and the reason so nobody has to guess later why an address
 * stopped receiving mail.
 *
 * Keep the note short and factual. Never add an address here that has not
 * actually asked.
 */
export const DO_NOT_CONTACT: ReadonlyArray<{ email: string; note: string }> = [
  {
    // Replied to the vendor claim-invite campaign on 2026-07-25: runs the
    // business privately, takes no third-party bookings, wants no outreach.
    email: "info@finca-monasterio.com",
    note: "Finca Monasterio (ES) — owner request, 2026-07-25",
  },
];

/** Boot seed. `INSERT OR IGNORE`, so it is safe on every start and cannot
 *  clobber a reason recorded by an earlier unsubscribe click. */
export function seedDoNotContact(): void {
  for (const entry of DO_NOT_CONTACT) {
    addOptOut(entry.email, "do_not_contact");
  }
}
