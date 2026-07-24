// Post-wedding "rate your vendors" prompt. ~7 days after the wedding the couple
// gets an email + an in-app notification asking them to rate the vendors they
// used, with a one-click star flow on /app/rate-vendors.
//
// "Vendors they used" = the couple's real category PICKS (couple_picks),
// resolved to a supplier, minus the two sentinel picks (self-organised / not
// needed) and minus the ones they've already reviewed. Picks are the cleanest
// "this was our vendor" signal we have; a couple that only priced a category in
// the budget without picking a supplier has no concrete vendor to rate.

import { isSentinelPick } from "@shared/picks";
import { db } from "../db";
import { listPicksForCouple } from "./couple_picks";
import { resolveSupplierBase } from "./resolve_supplier";

export interface VendorToReview {
  /** The supplier id to POST the review against (same id the pick stored, so the
   *  couple earns the Verified badge via engagement proof). */
  id: string;
  name: string;
  category: string;
}

/** Supplier ids this couple has already left a (non-deleted) review on. */
export function coupleReviewedSupplierIds(coupleId: number): Set<string> {
  const rows = db
    .prepare(
      "SELECT DISTINCT supplier_id FROM supplier_reviews WHERE couple_id = ? AND deleted_at IS NULL",
    )
    .all(coupleId) as { supplier_id: string }[];
  return new Set(rows.map((r) => r.supplier_id));
}

/** The real vendors this couple picked and hasn't reviewed yet — what the
 *  post-wedding prompt asks them to rate. Sentinel picks and unresolvable ids
 *  are dropped so the list is only things they can actually rate. */
export function listCoupleVendorsToReview(coupleId: number): VendorToReview[] {
  const reviewed = coupleReviewedSupplierIds(coupleId);
  const out: VendorToReview[] = [];
  const seen = new Set<string>();
  for (const p of listPicksForCouple(coupleId)) {
    if (isSentinelPick(p.supplier_id)) continue;
    if (reviewed.has(p.supplier_id) || seen.has(p.supplier_id)) continue;
    const base = resolveSupplierBase(p.supplier_id);
    if (!base) continue;
    seen.add(p.supplier_id);
    // Review target is the pick's own id (matches the engagement-proof lookup);
    // the resolved base only supplies the display name + category.
    out.push({ id: p.supplier_id, name: base.name, category: base.category });
  }
  return out;
}
