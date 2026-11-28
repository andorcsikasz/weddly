// A chosen vendor offer, written into the couple's budget as a breakdown.
//
// The split itself is `shared/offer_budget.ts` (pure, shared with the compare
// page's preview). This module is the part that touches rows, and the rules it
// holds are the reason it is not a loop inside the route:
//
//   - **Idempotent per offer.** The lines carry `vendor_offer_id`, so applying
//     twice REPLACES this offer's lines instead of stacking a second set, and
//     un-choosing the offer removes exactly them.
//   - **Money already recorded is never destroyed.** A line with an actual or a
//     paid amount is the couple's bookkeeping. Re-applying refuses (409) rather
//     than deleting it; un-choosing detaches it (the line stays, minus the
//     back-reference) rather than blocking the status change.
//   - **The quote replaces the estimate it was an estimate of.** A budget starts
//     with a guess per category ("Venue 1,100,000"). Adding the real venue lines
//     beside it would count the category twice, so the couple names the
//     estimate lines to retire and only plain, money-free, supplier-free lines
//     inside the touched categories can be retired this way.
//   - **Per-guest categories are stored at the BASELINE headcount.** The budget
//     rescales catering and drinks with the slider relative to the baseline, so
//     the stored amount is `amount × baseline / guests` and displays as the
//     offer's own figure when the slider sits at the offer's headcount.
//   - **No silent currency conversion and no writes into a frozen category.**
//     Both are refused with a named code so the UI can say what to change.

import type { BudgetCategory } from "@shared/types";
import {
  type ApplyOfferToBudgetInput,
  type ApplyOfferToBudgetResult,
  OFFER_BUDGET_CATEGORIES,
  offerBudgetBreakdown,
  storedPlannedAmount,
} from "@shared/offer_budget";
import type { VendorOfferPayload } from "@shared/vendor_offers";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

const VALID = new Set<string>(OFFER_BUDGET_CATEGORIES);

export interface OfferRow {
  id: number;
  couple_id: number;
  vendor_name: string;
  status: string;
  currency: string;
  payload: string;
}

interface LineMoney {
  id: number;
  actual_huf: number;
  paid_huf: number;
}

function frozenSet(json: string | null | undefined): Set<BudgetCategory> {
  const out = new Set<BudgetCategory>();
  if (!json) return out;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      for (const v of parsed)
        if (typeof v === "string" && VALID.has(v)) out.add(v as BudgetCategory);
    }
  } catch {
    // An unreadable column means nothing is frozen, same as the budget route.
  }
  return out;
}

function intIn(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`);
  }
  return v;
}

/** How many budget lines this offer owns, for the "In your budget" state. */
export function budgetLineCounts(coupleId: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT vendor_offer_id AS id, COUNT(*) AS n FROM budget_lines
        WHERE couple_id = ? AND vendor_offer_id IS NOT NULL GROUP BY vendor_offer_id`,
    )
    .all(coupleId) as { id: number; n: number }[];
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** Take this offer's lines off the budget. A line with recorded money is kept
 *  and detached; everything else is deleted. Returns how many were deleted. */
export function releaseOfferBudgetLines(coupleId: number, offerId: number): number {
  const lines = db
    .prepare(
      "SELECT id, actual_huf, paid_huf FROM budget_lines WHERE couple_id = ? AND vendor_offer_id = ?",
    )
    .all(coupleId, offerId) as LineMoney[];
  let deleted = 0;
  const ts = now();
  for (const l of lines) {
    if (l.actual_huf > 0 || l.paid_huf > 0) {
      db.prepare("UPDATE budget_lines SET vendor_offer_id = NULL, updated_at = ? WHERE id = ?").run(
        ts,
        l.id,
      );
    } else {
      db.prepare("DELETE FROM budget_lines WHERE id = ?").run(l.id);
      deleted += 1;
    }
  }
  return deleted;
}

export function applyOfferToBudget(
  couple: { id: number; currency: string | null; frozen_categories_json?: string | null },
  offer: OfferRow,
  body: Partial<ApplyOfferToBudgetInput>,
): ApplyOfferToBudgetResult {
  if (offer.status !== "chosen") {
    throw new HttpError(409, "Only the chosen offer can be added to the budget", {
      code: "offer_not_chosen",
    });
  }
  if (couple.currency && couple.currency !== offer.currency) {
    throw new HttpError(409, "This offer is in a different currency than your budget", {
      code: "currency_mismatch",
      offer_currency: offer.currency,
      budget_currency: couple.currency,
    });
  }

  const guests = intIn(body.guests, "guests", 1, 5000);
  const baseline = intIn(body.baseline ?? body.guests, "baseline", 1, 5000);
  const payload = JSON.parse(offer.payload) as VendorOfferPayload;

  const include: number[] = [];
  for (const i of body.include_optional ?? []) {
    const it = payload.line_items[i];
    if (!Number.isInteger(i) || !it?.optional) {
      throw new HttpError(400, `include_optional[${i}] is not an optional line item`);
    }
    include.push(i);
  }

  const overrides: Record<number, BudgetCategory> = {};
  for (const [k, v] of Object.entries(body.categories ?? {})) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx >= payload.line_items.length) {
      throw new HttpError(400, `categories[${k}] is not a line item`);
    }
    if (typeof v !== "string" || !VALID.has(v)) {
      throw new HttpError(400, `categories[${k}] is not a budget category`);
    }
    overrides[idx] = v as BudgetCategory;
  }

  const breakdown = offerBudgetBreakdown(payload, {
    guests,
    includeOptional: include,
    overrides,
  });
  if (breakdown.rows.length === 0) {
    throw new HttpError(409, "This offer has no amounts to add", { code: "nothing_to_add" });
  }

  const frozen = frozenSet(couple.frozen_categories_json);
  const touched = new Set(breakdown.rows.map((r) => r.category));
  const blocked = [...touched].filter((c) => frozen.has(c));
  if (blocked.length > 0) {
    throw new HttpError(409, "A category this offer touches is frozen", {
      code: "frozen",
      categories: blocked,
    });
  }

  // The couple's own estimate lines the quote replaces. Only plain lines inside
  // a touched category: no supplier link, no offer link, no recorded money.
  const retire: number[] = [];
  for (const id of body.retire_line_ids ?? []) {
    if (!Number.isInteger(id)) throw new HttpError(400, "retire_line_ids must be whole numbers");
    const row = db
      .prepare(
        `SELECT category, actual_huf, paid_huf, couple_supplier_id, listing_id, vendor_offer_id
           FROM budget_lines WHERE id = ? AND couple_id = ?`,
      )
      .get(id, couple.id) as
      | {
          category: string;
          actual_huf: number;
          paid_huf: number;
          couple_supplier_id: string | null;
          listing_id: string | null;
          vendor_offer_id: number | null;
        }
      | undefined;
    if (
      !row ||
      !touched.has(row.category as BudgetCategory) ||
      row.actual_huf > 0 ||
      row.paid_huf > 0 ||
      row.couple_supplier_id ||
      row.listing_id ||
      row.vendor_offer_id
    ) {
      throw new HttpError(409, `Line ${id} cannot be replaced by this offer`, {
        code: "line_not_replaceable",
        line_id: id,
      });
    }
    retire.push(id);
  }

  const mine = db
    .prepare(
      "SELECT id, actual_huf, paid_huf FROM budget_lines WHERE couple_id = ? AND vendor_offer_id = ?",
    )
    .all(couple.id, offer.id) as LineMoney[];
  if (mine.some((l) => l.actual_huf > 0 || l.paid_huf > 0)) {
    throw new HttpError(409, "Some lines from this offer already have money recorded", {
      code: "offer_lines_in_use",
    });
  }

  const ids: number[] = [];
  const ts = now();
  db.transaction(() => {
    for (const l of mine) db.prepare("DELETE FROM budget_lines WHERE id = ?").run(l.id);
    for (const id of retire) db.prepare("DELETE FROM budget_lines WHERE id = ?").run(id);
    for (const row of breakdown.rows) {
      const planned = storedPlannedAmount(row, guests, baseline, frozen);
      const label = `${offer.vendor_name} · ${row.label}`.slice(0, 200);
      const res = db
        .prepare(
          `INSERT INTO budget_lines
             (couple_id, category, label, planned_huf, actual_huf, paid_huf, supplier_id,
              notes, per_guest, icon, vendor_offer_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, NULL, ?, ?, ?)`,
        )
        .run(couple.id, row.category, label, planned, offer.id, ts, ts);
      ids.push(Number(res.lastInsertRowid));
    }
  })();

  return { line_ids: ids, retired_line_ids: retire, total: breakdown.total };
}
