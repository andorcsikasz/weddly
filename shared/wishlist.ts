// Wishlist / gift-registry — the couple authors a list of things they'd love
// (a bigger group gift several guests can chip in on, smaller gifts, or
// personal gestures like a handwritten letter) and confirmed guests see it on
// the guest page. Lives in its own module — same rationale as schedule.ts: a
// self-contained CRUD aggregate that would only bloat types.ts.
//
// No money ever moves in-app. `target_amount_minor` is purely the couple's
// informational "this is roughly what it costs" — never a ledger, never a
// per-guest pledge. The only guest interaction is a soft, non-binding "I'd
// like to help" tap on `group_gift` items so the couple can see who is
// coordinating; it carries no amount and is idempotent per household.

import type { UnixMs } from "./types";

/** What kind of wish this is. Drives both the guest-side rendering and which
 *  items surface the "I'd like to help" tap:
 *  - `item`       a regular gift (small or large), buy-it-yourself
 *  - `group_gift` a bigger gift several guests coordinate on — the only kind
 *                 that shows the non-money interest tap + chip-in count
 *  - `personal`   a non-object gesture (a letter, a song, a toast) */
export type WishlistKind = "item" | "group_gift" | "personal";

export const WISHLIST_KINDS: readonly WishlistKind[] = ["item", "group_gift", "personal"];

export const WISHLIST_MAX_TITLE_LEN = 200;
export const WISHLIST_MAX_DESC_LEN = 2000;
export const WISHLIST_MAX_URL_LEN = 2048;

/** Couple-facing wishlist item, returned by `/api/wishlist`. `updated_at` is
 *  the value the PATCH endpoint expects back in `If-Match` for optimistic
 *  concurrency (mirrors ScheduleEvent). */
export interface WishlistItem {
  id: number;
  couple_id: number;
  title: string;
  description: string | null;
  kind: WishlistKind;
  /** Integer minor units in the couple's native currency (HUF has no minor
   *  unit, so this is whole forint; EUR/USD are cents). Informational only —
   *  display via Intl.NumberFormat with `maximumFractionDigits: 0`. Null when
   *  the couple didn't attach a rough price. */
  target_amount_minor: number | null;
  /** Couple-pasted http(s) link to an external product / registry page. Null
   *  when unset. Validated http(s) + length on the boundary. */
  url: string | null;
  /** Preview image for the linked product, resolved server-side from the
   *  page's og:image when the couple sets `url` (see lib/link_preview.ts).
   *  Null when there's no link or the fetch found no usable image. Rendered
   *  as the row/card thumbnail on both the editor and the guest page. */
  image_url: string | null;
  sort_order: number;
  created_at: UnixMs;
  updated_at: UnixMs;
}

/** Create body for POST /api/wishlist; PATCH /api/wishlist/:id uses
 *  Partial<UpsertWishlistItemInput>. Hand-validated on the backend boundary
 *  (no Zod) against the WISHLIST_MAX_* constants + WISHLIST_KINDS. */
export interface UpsertWishlistItemInput {
  title: string;
  description?: string | null;
  kind?: WishlistKind;
  target_amount_minor?: number | null;
  url?: string | null;
  /** Usually omitted — the server resolves the preview image from `url`. May
   *  be passed explicitly (e.g. the editor echoing back a fetched preview, or
   *  null to clear it). */
  image_url?: string | null;
  sort_order?: number;
}

/** Guest-facing wishlist item embedded in the public-wedding response at the
 *  `confirmed` tier. Strips couple_id/sort_order/timestamps and folds in the
 *  soft interest signal. `interest_count` / `viewer_has_interest` are only
 *  meaningful for `kind === "group_gift"` (0 / false otherwise). */
export interface WishlistEntry {
  id: number;
  title: string;
  description: string | null;
  kind: WishlistKind;
  target_amount_minor: number | null;
  url: string | null;
  /** Preview image resolved from `url` (og:image), or null. */
  image_url: string | null;
  /** How many households have tapped "I'd like to help" on this group gift. */
  interest_count: number;
  /** Whether the requesting household (the one whose code resolved the tier)
   *  has already tapped in — drives the toggle's "You're in" state. */
  viewer_has_interest: boolean;
}

/** Response shape of the toggle endpoint
 *  (POST /api/public/wedding/:slug/:code/wishlist/:itemId/interest). */
export interface WishlistInterestToggleResult {
  interest_count: number;
  viewer_has_interest: boolean;
}

/** Response of GET /api/wishlist/link-preview?url=… — the couple-side editor
 *  calls it when a product URL is entered to pull the og:image (and title)
 *  for the row/card thumbnail. Both fields are null when the page exposed no
 *  usable metadata; the endpoint never errors on an unreachable URL. */
export interface WishlistLinkPreview {
  image_url: string | null;
  title: string | null;
}
