// Received-gifts ledger, a private, couple-only tracking table for gifts that
// have actually arrived ("Mosógép, from the Kovács family, thank-you note sent").
// Distinct from the wishlist (what the couple WANTS, surfaced to guests): this
// is what they GOT, never published anywhere. Each row optionally allocates the
// gift to a whole household OR a single guest from the list, plus a free-text
// gift name + note.
//
// No money moves here either, it's a thank-you-tracking scratchpad. The editor
// renders it as an auto-growing spreadsheet (always two trailing empty rows), so
// rows are created/updated/deleted as the couple fills the grid.

import type { Currency } from "./currency";
import { minorUnitFactor } from "./currency";
import type { UnixMs } from "./types";

export const RECEIVED_GIFT_MAX_TITLE_LEN = 200;
export const RECEIVED_GIFT_MAX_NOTE_LEN = 1000;

export const RECEIVED_GIFT_CATEGORIES = ["gift", "money", "experience", "voucher"] as const;
export type ReceivedGiftCategory = (typeof RECEIVED_GIFT_CATEGORIES)[number];

/** Couple-facing received-gift row, returned by `/api/received-gifts`.
 *  `updated_at` is echoed back in `If-Match` for optimistic concurrency,
 *  mirroring WishlistItem / ScheduleEvent. */
export interface ReceivedGift {
  id: number;
  couple_id: number;
  /** Household this gift is attributed to (FK into the couple's households),
   *  or null. The common case: a gift comes from a whole household / family,
   *  not one person. Mutually exclusive with `guest_id`. */
  household_id: number | null;
  /** Guest this gift is attributed to (FK into the couple's guest list), or
   *  null when unallocated / attributed to a whole household instead. Mutually
   *  exclusive with `household_id`. The display name is resolved client-side
   *  from the loaded guest / household lists. */
  guest_id: number | null;
  /** Free-text gift name ("Mosógép"). May be empty when the row carries only a
   *  guest + note; a fully-empty row is never persisted. */
  title: string;
  /** Free-text note (thank-you sent?, where it's stored, …). Null when unset. */
  note: string | null;
  /** Gift category — defaults to "gift". "money" unlocks the amount_minor field. */
  category: ReceivedGiftCategory;
  /** Integer minor-unit amount (e.g. HUF whole forints, EUR cents). Only
   *  meaningful when category === "money"; null otherwise. */
  amount_minor: number | null;
  sort_order: number;
  created_at: UnixMs;
  updated_at: UnixMs;
}

/** Create body for POST /api/received-gifts; PATCH uses Partial<…>.
 *  Hand-validated on the backend boundary (no Zod). At least one of
 *  guest_id / title / note must be meaningful, else the row is rejected
 *  (the grid only persists a row once it gains content). */
/** What the budget page reports about the gifts that have arrived. Derived,
 *  never stored: the ledger rows are the only fact. */
export interface ReceivedGiftSummary {
  /** Cash received, in WHOLE units of the couple's currency — the same unit
   *  every other money figure on the budget page uses, so it can be summed
   *  and compared against spend without a second conversion. */
  money_total: number;
  /** How many rows contributed to `money_total`. */
  money_count: number;
  /** Rows recorded as a physical gift / experience / voucher. COUNTED, never
   *  valued: a blender is not cash and must not reduce what the couple still
   *  has to pay. Surfaced as a note beside the total so a couple with twenty
   *  presents and no cash doesn't read the ledger as empty. */
  other_count: number;
}

/** The single definition of "how much money came in". Both the wishlist ledger
 *  and the budget page read it, so the two surfaces cannot disagree about the
 *  headline number — they did for as long as the budget kept its own table.
 *
 *  This is also the ONLY place minor units become whole ones. `amount_minor` is
 *  hundredths in a EUR workspace and whole forint in a HUF one, so any caller
 *  summing the column itself is right in Hungary and wrong by 100x everywhere
 *  else. */
export function summarizeReceivedGifts(
  gifts: readonly Pick<ReceivedGift, "category" | "amount_minor">[],
  currency: Currency,
): ReceivedGiftSummary {
  const factor = minorUnitFactor(currency);
  let minorTotal = 0;
  let moneyCount = 0;
  let otherCount = 0;
  for (const g of gifts) {
    // A row only counts as cash when it is BOTH typed as money and carries an
    // amount. The editor nulls the amount when the type changes away from
    // money, so a valued non-money row means legacy data, not a new shape.
    if (g.category === "money" && g.amount_minor !== null && g.amount_minor > 0) {
      minorTotal += g.amount_minor;
      moneyCount += 1;
    } else {
      otherCount += 1;
    }
  }
  return {
    money_total: Math.round(minorTotal / factor),
    money_count: moneyCount,
    other_count: otherCount,
  };
}

export interface UpsertReceivedGiftInput {
  /** Allocate to a whole household. Mutually exclusive with `guest_id` (the
   *  boundary clears the other when one is set). */
  household_id?: number | null;
  guest_id?: number | null;
  title?: string;
  note?: string | null;
  category?: ReceivedGiftCategory;
  amount_minor?: number | null;
  sort_order?: number;
}
