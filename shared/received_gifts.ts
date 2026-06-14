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
