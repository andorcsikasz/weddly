// Vendor onboarding token — persistence for the accepted-waitlist → account
// bridge. Token generation + lifecycle mirror listing_claims (the proven
// email-token pattern), but the consume step creates a fresh vendor account
// rather than claiming an existing listing (see routes/vendor_onboarding.ts).

import { randomBytes } from "node:crypto";
import { VENDOR_ONBOARDING_TOKEN_TTL_MS } from "@shared/vendor_onboarding";
import { db, now } from "../db";

export interface VendorOnboardingRow {
  id: number;
  waitlist_id: number | null;
  business_name: string;
  email: string;
  category: string | null;
  locale: string | null;
  token: string;
  status: string;
  expires_at: number;
  completed_at: number | null;
  vendor_account_id: number | null;
  created_at: number;
}

/** Cancel any still-pending token for a waitlist entry, then mint a fresh one.
 *  Re-accepting (or an admin resend) supersedes the old link so there's only
 *  one live token per accepted vendor. Returns the new row (incl. its token). */
export function createOnboardingToken(input: {
  waitlistId: number | null;
  businessName: string;
  email: string;
  category: string | null;
  locale: string | null;
}): VendorOnboardingRow {
  const ts = now();
  const token = randomBytes(32).toString("hex");
  const expires = ts + VENDOR_ONBOARDING_TOKEN_TTL_MS;
  const email = input.email.trim().toLowerCase();

  const mint = db.transaction((): VendorOnboardingRow => {
    if (input.waitlistId != null) {
      db.prepare(
        "UPDATE vendor_onboarding SET status = 'cancelled' WHERE waitlist_id = ? AND status = 'pending'",
      ).run(input.waitlistId);
    }
    const r = db
      .prepare(
        `INSERT INTO vendor_onboarding
           (waitlist_id, business_name, email, category, locale, token, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        input.waitlistId,
        input.businessName,
        email,
        input.category,
        input.locale,
        token,
        expires,
        ts,
      );
    return {
      id: Number(r.lastInsertRowid),
      waitlist_id: input.waitlistId,
      business_name: input.businessName,
      email,
      category: input.category,
      locale: input.locale,
      token,
      status: "pending",
      expires_at: expires,
      completed_at: null,
      vendor_account_id: null,
      created_at: ts,
    };
  });
  return mint();
}

export function getOnboardingByToken(token: string): VendorOnboardingRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_onboarding WHERE token = ?").get(token) as
      | VendorOnboardingRow
      | undefined) ?? null
  );
}

/** Sync state with the wall clock: a pending row past its expiry flips to
 *  'expired' so the route never serves a stale-but-pending token. */
export function expireStaleOnboarding(row: VendorOnboardingRow): VendorOnboardingRow {
  if (row.status !== "pending") return row;
  if (row.expires_at >= now()) return row;
  db.prepare("UPDATE vendor_onboarding SET status = 'expired' WHERE id = ?").run(row.id);
  return { ...row, status: "expired" };
}

/** Mark the token consumed + record which vendor_account it materialised.
 *  Called inside the route's completion transaction. */
export function markOnboardingCompleted(id: number, vendorAccountId: number): void {
  db.prepare(
    "UPDATE vendor_onboarding SET status = 'completed', completed_at = ?, vendor_account_id = ? WHERE id = ?",
  ).run(now(), vendorAccountId, id);
}
