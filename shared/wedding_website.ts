// Public wedding-website view (`/w/:slug`). Subset of couple state safe to
// expose without auth or per-household codes — the goal is a couple-branded
// landing page anyone with the URL can share + open: hero (names + date),
// schedule (if any), venue location, ceremony kind, and a generic RSVP
// link. Story / FAQ / registry sections come in follow-up work once we
// have schema fields for them; this contract is the minimum first cut.

import type { CeremonyKind, UnixMs } from "./types";

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

export interface PublicWeddingWebsiteView {
  couple_slug: string;
  couple_display_name: string;
  bride_name: string | null;
  groom_name: string | null;
  /** ISO YYYY-MM-DD; null if the couple hasn't picked a date yet. */
  wedding_date: string | null;
  ceremony_kind: CeremonyKind | null;
  /** Free-text venue name the couple set on /app/profile. Null when
   *  unset — the page falls back to the approximate lat/lng pin only. */
  venue_name: string | null;
  /** Couple-pasted http(s) URL for the page's hero image. Null when
   *  unset — the page falls back to the stationery palette without a
   *  cover photo. */
  cover_image_url: string | null;
  /** Coordinate centre for an approximate venue pin — radius is the
   *  privacy buffer the couple set (couples.location_radius_km). Both
   *  null until the couple sets a venue. */
  location_lat: number | null;
  location_lng: number | null;
  location_radius_km: number | null;
  /** Day-of run-of-show if the couple has authored one and chose to
   *  expose it on the public site. Empty array otherwise. */
  schedule: PublicWeddingScheduleEntry[];
  fetched_at: UnixMs;
}
