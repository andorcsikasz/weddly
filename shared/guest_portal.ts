// Guest portal — the read-only "for guests" view surfaced at /g/:slug/:code
// (public) and /app/guest-portal (couple-side preview). Wedding date,
// ceremony info, location, schedule timeline + the household's own RSVP
// status. Lives in its own module — the cluster is self-contained and
// adding it to types.ts would bloat the cross-feature surface.

import type { CeremonyKind, HouseholdMember, UnixMs } from "./types";

/** Schedule entry as exposed to guests — same minutes-from-midnight model as
 *  the couple-facing `ScheduleEvent` (see `shared/schedule.ts`) but stripped
 *  of internal fields the guest doesn't need (couple_id, sort_order,
 *  timestamps). The frontend renders 0..1439 as HH:MM on the wedding day and
 *  1440+ as HH:MM with a "next day" marker. */
export interface GuestScheduleEntry {
  id: number;
  label: string;
  starts_at_minutes: number;
  duration_minutes: number | null;
  location: string | null;
  notes: string | null;
}

/** What gets returned by GET /api/guest/portal. Only assembled when at least
 *  one household member has `rsvp_status = "yes"` — otherwise the endpoint
 *  short-circuits with a 403 so we don't accidentally leak the schedule to
 *  someone who hasn't (or can't) confirm attendance. */
export interface GuestPortalView {
  couple_slug: string;
  couple_display_name: string;
  /** ISO YYYY-MM-DD. Null when the couple hasn't picked a date yet (rare for
   *  a household that already RSVP'd yes, but possible). */
  wedding_date: string | null;
  ceremony_kind: CeremonyKind | null;
  /** Lat/lng + radius — same shape as `Couple` so the frontend can drop a
   *  map pin. All-null when the couple hasn't set a location. */
  location_lat: number | null;
  location_lng: number | null;
  location_radius_km: number | null;
  /** Day-of run-of-show, ordered by `starts_at_minutes`. Empty array when the
   *  couple hasn't authored a schedule yet. */
  schedule: GuestScheduleEntry[];
  /** This household's members — name + RSVP status only. Lets the page say
   *  "Anna: igen, Bence: igen". Reuses the existing public DTO so the shape
   *  matches `PublicCheckinView.members` and downstream rendering can share
   *  helpers. */
  household_code: string;
  household_label: string;
  members: HouseholdMember[];
  /** When this snapshot was assembled (server time). Lets the page show a
   *  "frissítve X perce" hint so a guest hitting a stale tab knows whether
   *  to refresh before driving to the venue. */
  fetched_at: UnixMs;
}
