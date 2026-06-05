// Public wedding-website view (`/w/:slug` and `/w/:slug/:code`). Subset of
// couple state safe to expose without auth or per-household codes — the
// goal is a couple-branded landing page anyone with the URL can share +
// open: hero (names + date), schedule (if any), venue location,
// ceremony kind, and a generic RSVP link. The endpoint is tier-aware: a
// guest with a valid household code unlocks the per-household block
// (`household`), and at least one RSVP-yes on that household promotes the
// tier to `confirmed` — that level adds the exact venue lat/lng and the
// couple-authored post-RSVP content that wouldn't otherwise be exposed.
//
// Phase 2 (Vendégoldal merger): single endpoint serves all three tiers
// — server-side omits gated fields, so the contract is "if a field is
// non-null in the payload, you may render it".

import type { PublicDesign } from "./design";
import type { CeremonyKind, HouseholdMember, UnixMs } from "./types";
import type { WishlistEntry } from "./wishlist";

export interface PublicWeddingScheduleEntry {
  id: number;
  label: string;
  /** Minutes since midnight on the wedding day (matches schedule.ts). */
  starts_at_minutes: number;
  /** Null when the couple authored the entry without a fixed duration —
   *  matches the in-app ScheduleEvent shape. */
  duration_minutes: number | null;
  location: string | null;
  notes: string | null;
}

/** Tier discriminator returned alongside the payload. The frontend reads
 *  `tier` to decide which sections to render — the gated fields are
 *  omitted at lower tiers (server-side), so a malicious client can't
 *  flip a `tier === "confirmed"` flag locally and reveal the post-RSVP
 *  block. The trust boundary is at the API. */
export type PublicWeddingTier = "public" | "invited" | "confirmed";

export interface PublicWeddingWebsiteView {
  couple_slug: string;
  couple_display_name: string;
  bride_name: string | null;
  groom_name: string | null;
  /** ISO YYYY-MM-DD; null if the couple hasn't picked a date yet. */
  wedding_date: string | null;
  ceremony_kind: CeremonyKind | null;
  /** Free-text venue name the couple set on /app/profile. Null when
   *  unset — the page falls back to the approximate lat/lng pin only.
   *  Visible at every tier; the post-RSVP exact pin is the gated piece. */
  venue_name: string | null;
  /** Couple-pasted http(s) URL for the page's hero image. Null when
   *  unset — the page falls back to the stationery palette without a
   *  cover photo. Visible at every tier. */
  cover_image_url: string | null;
  /** Pre-RSVP welcome block (markdown). Visible at every tier — the
   *  couple authors this for "anyone with the link". Null when unset. */
  guest_page_intro: string | null;
  /** "Good to know" block (parking, getting there, accommodation, …). Visible
   *  at every tier like guest_page_intro. Null when unset. */
  useful_info: string | null;
  /** Exact venue coordinate centre. Returned only at `confirmed` tier —
   *  the privacy buffer (`location_radius_km`) is the public face. Null
   *  outside `confirmed` so a client that mis-parses tier can't render
   *  the pin. */
  location_lat: number | null;
  location_lng: number | null;
  /** Privacy buffer radius in km. Always returned so the public page can
   *  render an "approximate" indicator even at public/invited tiers. */
  location_radius_km: number | null;
  /** Post-RSVP unlocked content (markdown). Returned only at `confirmed`
   *  tier — the couple uses this for the day-of details that should only
   *  reach confirmed guests (parking, dress code, gift registry, etc). */
  post_rsvp_content: string | null;
  /** Day-of run-of-show if the couple has authored one and chose to
   *  expose it on the public site. Empty array otherwise. Visible at
   *  every tier — schedule has always been on the public surface. */
  schedule: PublicWeddingScheduleEntry[];
  /** Couple-curated wishlist. Returned only at `confirmed` tier (valid
   *  household code + at least one RSVP yes) — same server-side omission rule
   *  as `post_rsvp_content` / the exact pin: null at public/invited so a
   *  tampered client can't surface it. Empty array when the couple is
   *  confirmed-eligible but authored no items. */
  wishlist: WishlistEntry[] | null;
  /** Resolved visual identity (hex colours + font stacks) the couple chose on
   *  /app/design. Presentation-only, visible at every tier — styling isn't
   *  gated. The guest page reads these straight into CSS custom properties. */
  design: PublicDesign;
  fetched_at: UnixMs;
}

/** Per-household context returned when the caller supplies a valid
 *  `?code=XXXX`. Omitted (null in the response wrapper) for the public
 *  tier. Reuses the existing HouseholdMember DTO so downstream renderers
 *  match the shape used elsewhere. */
export interface PublicWeddingHouseholdContext {
  household_code: string;
  household_label: string;
  members: HouseholdMember[];
}

/** Wrapper shape returned by `GET /api/public/wedding/:slug[?code=]`.
 *  The tier discriminator drives the frontend's progressive-disclosure
 *  rendering. `household` is non-null iff the supplied code matched a
 *  household; gated fields on `wedding` are populated only when
 *  `tier === "confirmed"`. */
export interface PublicWeddingResponse {
  wedding: PublicWeddingWebsiteView;
  household: PublicWeddingHouseholdContext | null;
  tier: PublicWeddingTier;
}
