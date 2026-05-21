// Listing claim — the "this listing is mine" flow. Email-verification token
// is sent to listings.contact_email (proof of control of the business inbox).
// Consuming the token transactionally creates users(role='vendor') +
// vendor_accounts + flips listings.vendor_account_id, then issues a session.
//
// Edge cases the route surface relies on:
//   - Listing must exist and have a contact_email (otherwise no inbox to verify).
//   - Listing must not already be claimed (vendor_account_id is null).
//   - On complete, the email must not already belong to an existing users
//     row — we reject with a clear error rather than silently merging roles.
//     A future iteration can add role coexistence, but v1 keeps it simple.

import { randomBytes } from "node:crypto";
import {
  CLAIM_TOKEN_TTL_MS,
  type ListingClaim,
  type ListingClaimStatus,
} from "@shared/vendor_claim";
import { db, now } from "../db";

export interface ListingClaimRow {
  id: number;
  listing_id: string;
  email_sent_to: string;
  token: string;
  status: string;
  expires_at: number;
  verified_at: number | null;
  vendor_account_id: number | null;
  created_at: number;
}

function toClaimStatus(raw: string): ListingClaimStatus {
  if (raw === "verified" || raw === "expired" || raw === "cancelled") return raw;
  return "pending";
}

export function toListingClaim(row: ListingClaimRow): ListingClaim {
  return {
    id: row.id,
    listing_id: row.listing_id,
    email_sent_to: row.email_sent_to,
    status: toClaimStatus(row.status),
    expires_at: row.expires_at,
    verified_at: row.verified_at,
    vendor_account_id: row.vendor_account_id,
    created_at: row.created_at,
  };
}

/** Insert a fresh claim row + return its token. The same listing can have
 *  multiple pending tokens over time (a vendor re-requests because they lost
 *  the first email); each is independently consumable until any one is
 *  marked verified — see `markOtherPendingClaimsCancelled`. */
export function createClaim(listingId: string, emailSentTo: string): ListingClaimRow {
  const ts = now();
  const token = randomBytes(32).toString("hex");
  const expires = ts + CLAIM_TOKEN_TTL_MS;
  const r = db
    .prepare(
      `INSERT INTO listing_claims
         (listing_id, email_sent_to, token, status, expires_at, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .run(listingId, emailSentTo, token, expires, ts);
  return {
    id: Number(r.lastInsertRowid),
    listing_id: listingId,
    email_sent_to: emailSentTo,
    token,
    status: "pending",
    expires_at: expires,
    verified_at: null,
    vendor_account_id: null,
    created_at: ts,
  };
}

export function getClaimByToken(token: string): ListingClaimRow | null {
  return (
    (db.prepare("SELECT * FROM listing_claims WHERE token = ?").get(token) as
      | ListingClaimRow
      | undefined) ?? null
  );
}

/** Bring claim state into sync with the wall clock: pending rows past
 *  expires_at flip to 'expired'. Caller invokes this before reading state so
 *  the route never returns a "pending" claim that's actually stale. */
export function expireStaleClaim(row: ListingClaimRow): ListingClaimRow {
  if (row.status !== "pending") return row;
  if (row.expires_at >= now()) return row;
  db.prepare("UPDATE listing_claims SET status = 'expired' WHERE id = ?").run(row.id);
  return { ...row, status: "expired" };
}

/** Mark the claim as verified + record which vendor_account it materialised.
 *  Called inside the route's completion transaction. */
export function markClaimVerified(claimId: number, vendorAccountId: number): void {
  const ts = now();
  db.prepare(
    "UPDATE listing_claims SET status = 'verified', verified_at = ?, vendor_account_id = ? WHERE id = ?",
  ).run(ts, vendorAccountId, claimId);
}

/** Cancels any OTHER pending claim for the same listing once one was
 *  verified — multiple emails out, only one wins. Idempotent. */
export function markOtherPendingClaimsCancelled(listingId: string, winningClaimId: number): void {
  db.prepare(
    "UPDATE listing_claims SET status = 'cancelled' WHERE listing_id = ? AND status = 'pending' AND id != ?",
  ).run(listingId, winningClaimId);
}

/** Cancels EVERY pending claim for a listing — used when an external write
 *  (concurrent claim race lost, admin direct edit) makes any pending claim
 *  unfulfillable. Distinct from `markOtherPendingClaimsCancelled` because
 *  there's no winning claim to exclude. Idempotent. */
export function cancelAllPendingClaims(listingId: string): void {
  db.prepare(
    "UPDATE listing_claims SET status = 'cancelled' WHERE listing_id = ? AND status = 'pending'",
  ).run(listingId);
}
