// Wishlist / gift-registry — the couple authors a list of things they'd love
// (gifts guests can buy or chip in on) plus a separate set of personal
// "requests" (a gesture like a handwritten letter or a childhood photo). Both
// surface to confirmed guests on the guest page. Lives in its own module — same
// rationale as schedule.ts: a self-contained CRUD aggregate that would only
// bloat types.ts.
//
// No money ever moves in-app. `target_amount_minor` is purely the couple's
// informational "this is roughly what it costs" — never a ledger, never a
// per-guest pledge. The only guest interaction is a soft, non-binding "I'd
// like to help" tap on `gift` items so the couple can see who is coordinating;
// it carries an optional, non-binding pledge amount and is idempotent per
// household.

import type { Currency, UnixMs } from "./types";

/** What kind of wish this is. Two buckets, rendered as two separate sections:
 *  - `gift`     something concrete the couple would love — guests can buy it or
 *               softly chip in toward its rough price (the GoFundMe-style bar +
 *               the "I'd like to help" pledge). This is the merge of the old
 *               `item` (buy-it-yourself) and `group_gift` (coordinate) kinds.
 *  - `request`  a non-object personal wish / gesture (a handwritten letter, a
 *               childhood photo, a song). NOT part of the gift list and carries
 *               no money — just the couple asking the wedding party for it.
 *
 *  Legacy stored values are normalized on read + at boot: item/group_gift →
 *  gift, personal → request. */
export type WishlistKind = "gift" | "request";

export const WISHLIST_KINDS: readonly WishlistKind[] = ["gift", "request"];

export const WISHLIST_MAX_TITLE_LEN = 200;
export const WISHLIST_MAX_DESC_LEN = 2000;
export const WISHLIST_MAX_URL_LEN = 2048;

/** What `image_url` actually holds, because the two want opposite framing.
 *  A product PHOTO fills the tile edge to edge. A shop's own LOGO is a mark
 *  drawn on a ground: cropped to fill, IKEA arrives as a blue wall with half
 *  a letter in it. Null on an item with no picture at all. */
export type WishlistImageKind = "photo" | "logo";

/** Icons a couple can put on a wish we could not find a picture for. Slugs are
 *  Lucide component names; the slug → component map lives in the frontend
 *  (`components/WishlistPicture.tsx`) and this list is what the server
 *  validates against, the same split as SPOKEN_LANGUAGE_OPTIONS.
 *
 *  Kept concrete and short: the picker is one wrapping strip in the add-a-wish
 *  dialog, and an icon nobody can find is the same as no icon. Ordered by what
 *  a wedding list actually asks for — home and table first, then experiences,
 *  with the two gesture marks last for `request` items. */
export const WISHLIST_ICON_SLUGS = [
  "Gift",
  "House",
  "UtensilsCrossed",
  "CookingPot",
  "Coffee",
  "Wine",
  "BedDouble",
  "Armchair",
  "Flower2",
  "Smartphone",
  "Laptop",
  "Camera",
  "Plane",
  "TreePalm",
  "Ticket",
  "Music",
  "Heart",
  "Mail",
] as const;

export type WishlistIconSlug = (typeof WISHLIST_ICON_SLUGS)[number];

export function isWishlistIconSlug(value: string): value is WishlistIconSlug {
  return (WISHLIST_ICON_SLUGS as readonly string[]).includes(value);
}

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
  /** Per-item currency override. Null means "inherit the couple's display
   *  currency" — the common case. When set, `target_amount_minor` is in minor
   *  units of THIS currency, not the couple's, so display always pairs the
   *  amount with `currency ?? couple.currency`. Lets a couple price a single
   *  wish in another currency (e.g. an item only sold abroad). */
  currency: Currency | null;
  /** Couple-pasted http(s) link to an external product / registry page. Null
   *  when unset. Validated http(s) + length on the boundary. */
  url: string | null;
  /** Preview image for the linked product, resolved server-side from the
   *  page's og:image when the couple sets `url` (see lib/link_preview.ts).
   *  Null when there's no link or the fetch found no usable image. Rendered
   *  as the row/card thumbnail on both the editor and the guest page. */
  image_url: string | null;
  /** Whether `image_url` is the product's own photo or the shop's logo (the
   *  fallback we resolve when a page publishes no og:image). Drives framing
   *  only — a photo is cropped to fill, a logo is contained on the ground.
   *  Null exactly when `image_url` is. */
  image_kind: WishlistImageKind | null;
  /** Couple-chosen icon slug for a wish with no picture at all, from
   *  `WISHLIST_ICON_SLUGS`. Null means "we pick one from the kind" — a gift
   *  box for a gift, a heart for a request. */
  icon: WishlistIconSlug | null;
  /** How many households have softly pledged ("I'd like to help") on this group
   *  gift. 0 for non-group kinds and items nobody tapped. No money moves — this
   *  is a coordination count only. */
  interest_count: number;
  /** Sum of the soft pledge amounts guests entered, in minor units of this
   *  item's effective currency (`currency ?? couple.currency`). Drives the
   *  GoFundMe-style "vállalva / célösszeg" progress bar in the editor. 0 when
   *  nobody pledged an amount (a tap without a number still counts toward
   *  `interest_count`). Informational only. */
  pledged_amount_minor: number;
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
  /** Per-item currency override (null/omitted = inherit the couple's). When
   *  set, `target_amount_minor` is interpreted in this currency's minor units. */
  currency?: Currency | null;
  url?: string | null;
  /** Usually omitted — the server resolves the preview image from `url`. May
   *  be passed explicitly (e.g. the editor echoing back a fetched preview, or
   *  null to clear it). */
  image_url?: string | null;
  /** Framing hint for an explicitly passed `image_url`, echoed back from the
   *  link preview. Ignored (and re-derived) whenever the server resolves the
   *  picture itself. */
  image_kind?: WishlistImageKind | null;
  /** Couple-chosen icon slug; null clears it back to the per-kind default. */
  icon?: WishlistIconSlug | null;
  sort_order?: number;
}

/** Guest-facing wishlist item embedded in the public-wedding response at the
 *  `confirmed` tier. Strips couple_id/sort_order/timestamps and folds in the
 *  soft interest signal. `interest_count` / `viewer_has_interest` are only
 *  meaningful for `kind === "gift"` (0 / false for requests). */
export interface WishlistEntry {
  id: number;
  title: string;
  description: string | null;
  kind: WishlistKind;
  target_amount_minor: number | null;
  /** Per-item currency override (null = inherit the couple's display
   *  currency). Display pairs the amount with `currency ?? couple.currency`. */
  currency: Currency | null;
  url: string | null;
  /** Preview image resolved from `url` (og:image, else the shop's logo), or
   *  null. */
  image_url: string | null;
  /** Photo vs logo — the guest card frames them differently. */
  image_kind: WishlistImageKind | null;
  /** The couple's chosen icon for a wish with no picture. */
  icon: WishlistIconSlug | null;
  /** How many households have tapped "I'd like to help" on this group gift. */
  interest_count: number;
  /** Sum of the guests' soft pledge amounts, in minor units of this item's
   *  effective currency. Drives the guest-side progress bar. 0 when no amounts
   *  were entered. No money moves — coordination only. */
  pledged_amount_minor: number;
  /** Whether the requesting household (the one whose code resolved the tier)
   *  has already tapped in — drives the toggle's "You're in" state. */
  viewer_has_interest: boolean;
  /** The requesting household's own soft pledge amount (minor units of the
   *  item's currency), or null when they tapped in without a number / aren't
   *  in. Lets the guest UI prefill and edit their pledge. */
  viewer_pledged_amount_minor: number | null;
}

/** Request body for the interest toggle endpoint. Two modes:
 *  - `pledged_amount_minor` ABSENT → pure toggle: a household not in taps in
 *    (no amount), one already in taps back out. (Backward-compatible default.)
 *  - `pledged_amount_minor` PRESENT (number ≥ 0 or null) → set pledge: ensure
 *    the household is in and record/replace its soft pledge amount; never
 *    leaves. Sending `null` keeps them in with no amount.
 *  - `notification_email` OPTIONAL → the guest's opt-in email for group-gift
 *    coordination notifications. Empty string treated as absent (not stored).
 *    Validated as a valid email address; max 254 chars. Never returned in any
 *    HTTP response — only used server-side to send coordination emails. */
export interface WishlistInterestToggleInput {
  pledged_amount_minor?: number | null;
  notification_email?: string;
}

/** One contributor in the group-gift coordination view. Only visible to guests
 *  who have themselves pledged on the same item (gated on household pledge
 *  membership). `label` is the household display label. Amounts are in minor
 *  units of the item's effective currency. `pledged_pct` is null when the item
 *  has no target price. */
export interface WishlistContributor {
  label: string;
  pledged_amount_minor: number | null;
  pledged_pct: number | null;
}

/** Response of GET /api/public/wedding/:slug/:code/wishlist/:itemId/contributors.
 *  Only accessible to households that have already pledged on the item; returns
 *  null (403) for non-pledgers. Aggregate coordination view — no individual
 *  emails, no raw household codes, no couple-internal data. */
export interface WishlistContributorsResult {
  contributors: WishlistContributor[];
  total_pledged_minor: number;
  target_amount_minor: number | null;
  /** Remaining amount to reach the target (null when no target set). */
  remaining_minor: number | null;
  /** Remaining as a percentage of target (null when no target set). */
  remaining_pct: number | null;
}

/** Response shape of the toggle endpoint
 *  (POST /api/public/wedding/:slug/:code/wishlist/:itemId/interest). */
export interface WishlistInterestToggleResult {
  interest_count: number;
  pledged_amount_minor: number;
  viewer_has_interest: boolean;
  viewer_pledged_amount_minor: number | null;
}

/** Response of GET /api/wishlist/link-preview?url=… — the couple-side editor
 *  calls it when a product URL is entered to pull the og:image (and title)
 *  for the row/card thumbnail. Every field is null when the page exposed no
 *  usable metadata; the endpoint never errors on an unreachable URL.
 *
 *  `image_kind` says which of the two ladders answered: the product's own
 *  photo, or the shop's logo when the page publishes no og:image (a bot wall,
 *  or simply a page that ships none — most of the Hungarian webshops couples
 *  paste). The couple gets a picture of where the wish lives either way. */
export interface WishlistLinkPreview {
  image_url: string | null;
  image_kind: WishlistImageKind | null;
  title: string | null;
}
