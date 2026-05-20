// Public guest portal — surfaces the wedding date, ceremony info, location
// and day-of schedule to a household whose at least one member has RSVP'd
// "yes". Same airport-style slug+code credential as /api/rsvp/lookup so the
// guest doesn't need to remember a separate URL. Heavy rate-limit per IP
// to slow code enumeration; mirrors the RSVP bucket.
//
// Gating rule: at least one member must have rsvp_status = "yes". A
// pending- or no-only household gets a 403 with `code: "not_rsvpd"` so the
// frontend can render a "please RSVP first" message + a deep-link back to
// the check-in flow. The schedule is shared event data — leaking it to
// someone who never RSVP'd undermines the "this page is for invited
// guests" framing.

import type { CeremonyKind } from "@shared/types";
import type { GuestPortalView, GuestScheduleEntry } from "@shared/guest_portal";
import { db } from "../db";
import { now } from "../db";
import { type CoupleRow } from "../domain/couples";
import { listScheduleEvents } from "../domain/schedule";
import { type HouseholdRow, listMembers, toHouseholdMember } from "../domain/households";
import { normalizeSlugInput } from "../domain/slug";
import { recordGrowthEventFromRequest } from "../domain/growth_events";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

// Same shape as the RSVP bucket — slightly slower refill than auth, but
// still slows brute-forcing slug+code combos.
const PORTAL_BUCKET = { capacity: 30, refillRate: 1 / 5 };

const CEREMONY_KINDS: ReadonlySet<CeremonyKind> = new Set(["civil", "religious", "both"]);

function resolveCoupleBySlug(slug: string): CoupleRow {
  if (!slug || slug.length > 64) throw new HttpError(400, "Invalid couple identifier");
  const cleaned = normalizeSlugInput(slug);
  if (!cleaned) throw new HttpError(404, "Couple not found");
  const row = db.prepare("SELECT * FROM couples WHERE slug = ?").get(cleaned) as
    | CoupleRow
    | undefined;
  if (!row) throw new HttpError(404, "Couple not found");
  return row;
}

function resolveHousehold(coupleId: number, codeRaw: string): HouseholdRow {
  if (!codeRaw || codeRaw.length > 16) throw new HttpError(400, "Invalid code");
  const code = codeRaw.trim();
  const row = db
    .prepare("SELECT * FROM households WHERE couple_id = ? AND code = ?")
    .get(coupleId, code) as HouseholdRow | undefined;
  if (!row) throw new HttpError(404, "Code not found");
  return row;
}

function handleGetPortal(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "guest:portal", PORTAL_BUCKET);

  const slug = ctx.url.searchParams.get("couple") ?? "";
  const code = ctx.url.searchParams.get("code") ?? "";
  const couple = resolveCoupleBySlug(slug);
  const household = resolveHousehold(couple.id, code);

  // Gate: at least one member must have rsvp_status === "yes". We
  // deliberately do NOT fall through to the schedule for "pending" /
  // "maybe" / "no" — the page framing is "for guests who confirmed
  // attendance". The 403 carries an explicit code so the frontend can
  // route the user back to /rsvp instead of showing a generic error.
  const members = listMembers(household.id);
  const anyYes = members.some((m) => m.rsvp_status === "yes");
  if (!anyYes) {
    throw new HttpError(403, "Please RSVP yes first", { code: "not_rsvpd" });
  }

  recordGrowthEventFromRequest("guest.portal.view", ctx.req, {
    couple_id: couple.id,
    household_id: household.id,
  });

  const schedule: GuestScheduleEntry[] = listScheduleEvents(couple.id).map((e) => ({
    id: e.id,
    label: e.label,
    starts_at_minutes: e.starts_at_minutes,
    duration_minutes: e.duration_minutes,
    location: e.location,
    notes: e.notes,
  }));

  const ceremonyKind: CeremonyKind | null =
    couple.ceremony_kind && CEREMONY_KINDS.has(couple.ceremony_kind as CeremonyKind)
      ? (couple.ceremony_kind as CeremonyKind)
      : null;

  const view: GuestPortalView = {
    couple_slug: couple.slug ?? "",
    couple_display_name: couple.display_name,
    wedding_date: couple.wedding_date,
    ceremony_kind: ceremonyKind,
    location_lat: couple.location_lat,
    location_lng: couple.location_lng,
    location_radius_km: couple.location_radius_km,
    schedule,
    household_code: household.code,
    household_label: household.label,
    members: members.map(toHouseholdMember),
    fetched_at: now(),
  };
  return json({ portal: view });
}

export function registerGuestPortalRoutes(router: Router) {
  // Public — no auth flag (third arg defaults to false in router.get).
  router.get("/api/guest/portal", handleGetPortal);
}
