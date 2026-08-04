// A business asked, in writing, to be taken off Weddly entirely.
//
// This is deliberately NOT "hide the listing", and it is not "suppress the
// mail" either. Those two already existed and each solved half of it, in
// different tables, reachable from different admin buttons, with nothing tying
// them together: an admin who hid a listing left the address live for the next
// campaign, and an admin who added a DO_NOT_CONTACT entry left the card on the
// public directory. A business that writes in has asked for BOTH, so this
// module is the single action that does both and records why.
//
// The effects stay in their existing homes rather than being re-implemented
// here:
//   * the address tombstone in `email_optouts` (addOptOut), which `sendKind`
//     consults for every non-transactional mail, so one row closes every cold
//     path at once: the claim campaign, the review campaign, personal invites,
//     the planner batch and couple outreach.
//   * the delisting in `curated_supplier_overrides` for a curated slug, or
//     `community_suppliers.status` + `listings.status` for a DB-backed row.
//     Curated entries are re-upserted from source on every boot, which is
//     exactly why the override table exists: the suppression outlives the
//     redeploy that re-ships the code entry.
//
// `vendor_removal_requests` is the reason, the date and the person. What it
// buys over reading the two effect tables is INTENT: a hide is a moderation
// call an admin may reverse tomorrow, while this is a standing instruction from
// the business itself, and the row is what tells a later admin (or a future
// re-import) which of the two they are looking at.

import { addOptOut, normalizeEmail } from "./emails/optouts";
import { setCuratedOverride } from "./curated_overrides";
import { setStatus } from "./community_suppliers";
import { addAuditLog } from "../lib/audit";
import { db, now } from "../db";

export type RemovalVia = "email" | "feedback" | "phone" | "other";

const VALID_VIA: ReadonlySet<string> = new Set<RemovalVia>(["email", "feedback", "phone", "other"]);

export function isRemovalVia(raw: unknown): raw is RemovalVia {
  return typeof raw === "string" && VALID_VIA.has(raw);
}

export interface VendorRemovalRequest {
  listing_id: string;
  email: string;
  requested_via: RemovalVia;
  note: string | null;
  flagged_by_user_id: number | null;
  mail_sent_at: number | null;
  created_at: number;
}

export function getRemovalRequest(listingId: string): VendorRemovalRequest | null {
  const row = db
    .prepare("SELECT * FROM vendor_removal_requests WHERE listing_id = ?")
    .get(listingId) as VendorRemovalRequest | undefined;
  return row ?? null;
}

/** Every listing id currently under a removal request. One scan; the set is
 *  tiny by nature and the admin catalogue needs it per page render. */
export function removalRequestedIds(): Set<string> {
  const rows = db.prepare("SELECT listing_id FROM vendor_removal_requests").all() as Array<{
    listing_id: string;
  }>;
  return new Set(rows.map((r) => r.listing_id));
}

export interface RecordRemovalInput {
  /** Curated slug, or a `listings.id`. */
  listingId: string;
  /** The address that asked. Tombstoned, and the address the confirmation goes
   *  to. Normalised on the way in so the tombstone and the lookup agree. */
  email: string;
  /** `community_suppliers.id` when this is a DB-backed row, so the community
   *  status moves with it. Null for a curated slug, which has no such row. */
  communityId: number | null;
  adminUserId: number;
  via: RemovalVia;
  note: string | null;
}

/** Record the request and apply BOTH effects, in one transaction.
 *
 *  Order matters on failure, not on success: the tombstone and the delisting
 *  commit together, so there is no window where the listing is down but the
 *  address is still live for the next campaign sweep (or the reverse). The
 *  confirmation mail is deliberately NOT sent from in here — a mail failure
 *  must never roll back the suppression, and the caller sends it after the
 *  commit, then stamps `mail_sent_at`. */
export function recordRemovalRequest(input: RecordRemovalInput): VendorRemovalRequest {
  const email = normalizeEmail(input.email);
  const ts = now();

  const tx = db.transaction(() => {
    // 1. Close every cold-outreach path for the address. Permanent: the row is
    //    a tombstone and no campaign re-run can resurrect it.
    addOptOut(email, "removal_request");

    // 2. Take the card off the public directory. Which lever depends on where
    //    the listing lives, and a curated slug needs the override table rather
    //    than a status column because the boot upsert would rewrite the row.
    if (input.communityId !== null) {
      setStatus(
        input.communityId,
        "hidden",
        input.adminUserId,
        "Removal requested by the business",
      );
      db.prepare("UPDATE listings SET status = 'hidden', updated_at = ? WHERE id = ?").run(
        ts,
        input.listingId,
      );
    } else {
      setCuratedOverride(
        input.listingId,
        "hidden",
        input.adminUserId,
        "Removal requested by the business",
      );
    }

    // 3. The record of WHY, which is the part neither effect table carries.
    db.prepare(
      `INSERT INTO vendor_removal_requests
         (listing_id, email, requested_via, note, flagged_by_user_id, mail_sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(listing_id) DO UPDATE SET
         email = excluded.email,
         requested_via = excluded.requested_via,
         note = excluded.note,
         flagged_by_user_id = excluded.flagged_by_user_id`,
    ).run(input.listingId, email, input.via, input.note, input.adminUserId, ts);
  });
  tx();

  addAuditLog({
    actor_user_id: input.adminUserId,
    couple_id: null,
    action: "supplier.removal_requested",
    target_kind: "listing",
    target_id: null,
    after: {
      listing_id: input.listingId,
      email,
      requested_via: input.via,
      note: input.note,
    },
  });

  return getRemovalRequest(input.listingId) as VendorRemovalRequest;
}

/** Stamp that the confirmation reached them. Separate from the record above so
 *  a mail failure leaves the suppression intact and the stamp simply absent,
 *  which is what lets the admin UI say "removed, not yet confirmed to them"
 *  rather than claiming a mail that never left. */
export function markRemovalMailSent(listingId: string): void {
  db.prepare("UPDATE vendor_removal_requests SET mail_sent_at = ? WHERE listing_id = ?").run(
    now(),
    listingId,
  );
}

/** Undo. Clears the record and restores visibility, and DELIBERATELY leaves the
 *  `email_optouts` tombstone in place: a business that once asked never to be
 *  written to has not withdrawn that by an admin clicking the wrong row, and an
 *  opt-out is the one thing in this flow that should only ever be reversed by
 *  the recipient. Restoring the listing is the reversible half; the promise not
 *  to email them is not ours to take back. */
export function clearRemovalRequest(listingId: string): boolean {
  const r = db.prepare("DELETE FROM vendor_removal_requests WHERE listing_id = ?").run(listingId);
  return r.changes === 1;
}
