// Referral reward system. A couple shares their unique invite link; when the
// referred party qualifies (both partners joined for a couple, account
// activated for a vendor) the referrer gets free time added to their plan.
//
// Reward amounts:
//   couple referral → 1 calendar month (30 days)
//   vendor referral → 2 calendar months (60 days)
//
// The referral_grants table is the idempotency ledger — a UNIQUE constraint on
// (referral_type, referred_id) means a duplicate trigger is a no-op.

import { db, now } from "../db";
import { getCoupleById, type CoupleRow } from "./couples";

const COUPLE_BONUS_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const VENDOR_BONUS_MS = 1000 * 60 * 60 * 24 * 60; // 60 days

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // unambiguous chars

function randomCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("");
}

export function getOrCreateReferralCode(coupleId: number): string {
  const row = db.prepare("SELECT referral_code FROM couples WHERE id = ?").get(coupleId) as
    | { referral_code: string | null }
    | undefined;
  if (row?.referral_code) return row.referral_code;

  // Generate until unique (collision probability ~2^-38 per attempt — loop
  // will virtually always terminate on the first iteration).
  let code: string;
  for (;;) {
    code = randomCode();
    const conflict = db.prepare("SELECT 1 FROM couples WHERE referral_code = ?").get(code);
    if (!conflict) break;
  }
  db.prepare("UPDATE couples SET referral_code = ?, updated_at = ? WHERE id = ?").run(
    code,
    now(),
    coupleId,
  );
  return code;
}

export function lookupCoupleByRefCode(code: string): CoupleRow | null {
  if (!code || code.length !== 8) return null;
  return (
    (db.prepare("SELECT * FROM couples WHERE referral_code = ?").get(code) as
      | CoupleRow
      | undefined) ?? null
  );
}

/** Extend the referrer's free period. Works on trialing, founding, and even
 *  lapsed (none/canceled) couples — lapsed ones get a fresh trial-length
 *  window equal to the bonus, which is the fairest UX. Paying couples are
 *  skipped (they have access already; the bonus can't stack). */
function applyBonusToCouple(coupleId: number, bonusMs: number, nowMs: number): void {
  const couple = getCoupleById(coupleId);
  if (!couple || couple.is_demo) return;

  const status = couple.subscription_status as string;
  if (status === "active" || status === "past_due") return; // already paying

  const ts = nowMs;
  if (status === "founding") {
    const current = (couple as unknown as { founding_until: number | null }).founding_until ?? ts;
    db.prepare("UPDATE couples SET founding_until = ?, updated_at = ? WHERE id = ?").run(
      current + bonusMs,
      ts,
      coupleId,
    );
  } else if (status === "trialing") {
    const current = (couple as unknown as { trial_ends_at: number | null }).trial_ends_at ?? ts;
    db.prepare("UPDATE couples SET trial_ends_at = ?, updated_at = ? WHERE id = ?").run(
      current + bonusMs,
      ts,
      coupleId,
    );
  } else {
    // none | canceled — restart a trial from now with the bonus duration
    db.prepare(
      `UPDATE couples
          SET subscription_status = 'trialing', trial_ends_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(ts + bonusMs, ts, coupleId);
  }
}

function insertGrant(
  referrerCoupleId: number,
  type: "couple" | "vendor",
  referredId: number,
  bonusMs: number,
  nowMs: number,
): boolean {
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO referral_grants
         (referrer_couple_id, referral_type, referred_id, bonus_ms, granted_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(referrerCoupleId, type, referredId, bonusMs, nowMs);
  return r.changes > 0;
}

/** Called when both partners of `referredCoupleId` have joined. If that couple
 *  was referred by another couple, grant the referrer 1 month free. */
export function maybeGrantCoupleReferral(referredCoupleId: number, nowMs: number = now()): void {
  const row = db
    .prepare("SELECT referred_by_couple_id FROM couples WHERE id = ?")
    .get(referredCoupleId) as { referred_by_couple_id: number | null } | undefined;
  const referrerCoupleId = row?.referred_by_couple_id;
  if (!referrerCoupleId) return;
  // Guard: a couple cannot reward itself (database constraint prevents this
  // via the onboarding guard, but be defensive when called directly in tests).
  if (referrerCoupleId === referredCoupleId) return;

  const granted = insertGrant(referrerCoupleId, "couple", referredCoupleId, COUPLE_BONUS_MS, nowMs);
  if (granted) applyBonusToCouple(referrerCoupleId, COUPLE_BONUS_MS, nowMs);
}

/** Called when a vendor activates via the onboarding token. If their waitlist
 *  entry was referred by a couple, grant that couple 2 months free. */
export function maybeGrantVendorReferral(waitlistId: number | null, nowMs: number = now()): void {
  if (!waitlistId) return;
  const row = db
    .prepare("SELECT referred_by_couple_id FROM vendor_waitlist WHERE id = ?")
    .get(waitlistId) as { referred_by_couple_id: number | null } | undefined;
  const referrerCoupleId = row?.referred_by_couple_id;
  if (!referrerCoupleId) return;

  const granted = insertGrant(referrerCoupleId, "vendor", waitlistId, VENDOR_BONUS_MS, nowMs);
  if (granted) applyBonusToCouple(referrerCoupleId, VENDOR_BONUS_MS, nowMs);
}

export interface ReferralInfo {
  code: string;
  stats: {
    couple_refs: number;
    vendor_refs: number;
    bonus_months: number;
  };
}

export function getReferralInfo(coupleId: number): ReferralInfo {
  const code = getOrCreateReferralCode(coupleId);

  const coupleRefs = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM referral_grants WHERE referrer_couple_id = ? AND referral_type = 'couple'",
      )
      .get(coupleId) as { n: number }
  ).n;

  const vendorRefs = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM referral_grants WHERE referrer_couple_id = ? AND referral_type = 'vendor'",
      )
      .get(coupleId) as { n: number }
  ).n;

  const totalBonusMs = (
    db
      .prepare(
        "SELECT COALESCE(SUM(bonus_ms), 0) AS total FROM referral_grants WHERE referrer_couple_id = ?",
      )
      .get(coupleId) as { total: number }
  ).total;

  const bonusMonths = Math.round(totalBonusMs / (1000 * 60 * 60 * 24 * 30));

  return {
    code,
    stats: { couple_refs: coupleRefs, vendor_refs: vendorRefs, bonus_months: bonusMonths },
  };
}
