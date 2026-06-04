// Public wedding website endpoint — couple-branded landing page served at
// `/w/:slug` (and `/w/:slug/:code` on the frontend) on the SPA. No auth
// required; per-household codes upgrade the response tier so the same
// endpoint serves the public landing and the gated guest portal. The
// shape lives in shared/wedding_website.ts so the frontend renders
// against the same contract.
//
// Tier ladder (Vendégoldal Phase 2):
//   - `public`    no/invalid `?code=`: anonymous visitor, anyone on the
//                 internet. Returns the shared bits (names, date,
//                 schedule, venue_name, cover) but never the exact
//                 lat/lng pin or post-RSVP block.
//   - `invited`   valid code, no RSVP-yes on any member. Adds the
//                 household context (label + members) so the page can
//                 show "you're on the list, please RSVP". `is_public`
//                 is NOT required here — the code itself is the
//                 credential, so personal links work even on
//                 private couples (the couple shared the slug+code
//                 directly).
//   - `confirmed` valid code + at least one member has rsvp_status='yes'.
//                 Adds the exact venue lat/lng + post_rsvp_content. The
//                 gated fields are server-side OMITTED at lower tiers —
//                 not just hidden — so a tampered client can't surface
//                 them by flipping a local flag.
//
// What's NOT exposed at any tier: guests of OTHER households, budget,
// supplier list, anything else workspace-internal. Rate-limited per IP
// to slow slug + code enumeration.

import type { CeremonyKind } from "@shared/types";
import type {
  PublicWeddingHouseholdContext,
  PublicWeddingResponse,
  PublicWeddingScheduleEntry,
  PublicWeddingTier,
  PublicWeddingWebsiteView,
} from "@shared/wedding_website";
import { db, now } from "../db";
import { type CoupleRow } from "../domain/couples";
import { recordGrowthEventFromRequest } from "../domain/growth_events";
import { listScheduleEvents } from "../domain/schedule";
import { type HouseholdRow, listMembers, toHouseholdMember } from "../domain/households";
import { normalizeSlugInput } from "../domain/slug";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

// 20-token burst then ~10/min sustained per IP. Slug enumeration is the
// concern (the only credential to a wedding site is the slug itself), so the
// sustained rate stays low. Legitimate guests open the link 1-3 times an
// hour; the burst absorbs simultaneous social-share fan-out off a single
// shared NAT without locking anyone out.
const WEDDING_BUCKET = { capacity: 20, refillRate: 1 / 6 };
// Tighter bucket for code-bearing lookups — same enumeration concern as the
// guest_portal endpoint. Slows down a brute-forcer hammering combinations
// of slug + 4-digit code; legitimate guests reload at most a few times.
const WEDDING_CODE_BUCKET = { capacity: 30, refillRate: 1 / 5 };

const CEREMONY_KINDS: ReadonlySet<CeremonyKind> = new Set(["civil", "religious", "both"]);

function resolveCoupleBySlug(slug: string, requireIsPublic: boolean): CoupleRow {
  if (!slug || slug.length > 64) throw new HttpError(400, "Invalid couple identifier");
  const cleaned = normalizeSlugInput(slug);
  if (!cleaned) throw new HttpError(404, "Couple not found");
  const row = db.prepare("SELECT * FROM couples WHERE slug = ?").get(cleaned) as
    | CoupleRow
    | undefined;
  if (!row) throw new HttpError(404, "Couple not found");
  // Don't expose archived / paused / purged workspaces publicly — those
  // couples explicitly stepped out of "wedding-in-progress" state.
  if (row.status !== "active") throw new HttpError(404, "Couple not found");
  // Public wedding-site opt-in. The anonymous landing (`/w/:slug`) 404s
  // when `is_public` is 0 — same status as an unknown slug so a scanner
  // can't tell "this slug exists but isn't published" from "this slug
  // doesn't exist". For code-bearing requests (`/w/:slug/:code`) the
  // toggle is bypassed: the code IS the credential, so personal links
  // work as direct invites even on private couples.
  if (requireIsPublic && !row.is_public) throw new HttpError(404, "Couple not found");
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

function buildView(
  couple: CoupleRow,
  tier: PublicWeddingTier,
  schedule: PublicWeddingScheduleEntry[],
): PublicWeddingWebsiteView {
  const ceremonyKind: CeremonyKind | null =
    couple.ceremony_kind && CEREMONY_KINDS.has(couple.ceremony_kind as CeremonyKind)
      ? (couple.ceremony_kind as CeremonyKind)
      : null;
  const isConfirmed = tier === "confirmed";
  return {
    couple_slug: couple.slug ?? "",
    couple_display_name: couple.display_name,
    bride_name: couple.bride_name || null,
    groom_name: couple.groom_name || null,
    wedding_date: couple.wedding_date,
    ceremony_kind: ceremonyKind,
    venue_name: couple.venue_name,
    cover_image_url: couple.cover_image_url,
    guest_page_intro: couple.guest_page_intro,
    useful_info: couple.useful_info,
    // Exact venue pin — confirmed tier only. The privacy buffer
    // (`location_radius_km`) is the public face; the precise coordinates
    // unlock once a household member has RSVP'd yes. Server-side null
    // at lower tiers so a tampered client can't surface them.
    location_lat: isConfirmed ? couple.location_lat : null,
    location_lng: isConfirmed ? couple.location_lng : null,
    location_radius_km: couple.location_radius_km,
    // Post-RSVP markdown block — confirmed tier only. Same omit-server-side
    // rule as the pin: the response simply doesn't include the data
    // unless the credential allows it.
    post_rsvp_content: isConfirmed ? couple.post_rsvp_content : null,
    schedule,
    fetched_at: now(),
  };
}

function handleGetWeddingWebsite(ctx: Ctx): Response {
  const slug = ctx.params.slug ?? "";
  const codeRaw = ctx.params.code ?? ctx.url.searchParams.get("code") ?? "";
  const hasCode = codeRaw.length > 0;

  // Different rate-limit bucket + key for code-bearing requests so the
  // brute-force enumerator can't get a sustained 10/min rate by switching
  // codes against the same slug. Both buckets are keyed per IP.
  rateLimit(
    ctx.clientIp,
    hasCode ? "public:wedding:code" : "public:wedding",
    hasCode ? WEDDING_CODE_BUCKET : WEDDING_BUCKET,
  );

  // For the anonymous /w/:slug surface, the couple must be opted-in
  // (is_public = 1). For /w/:slug/:code the toggle doesn't gate — the
  // 4-digit code IS the credential, so personal invites function as
  // direct links independent of the public publish toggle.
  const couple = resolveCoupleBySlug(slug, !hasCode);

  let tier: PublicWeddingTier = "public";
  let household: PublicWeddingHouseholdContext | null = null;
  let householdId: number | null = null;
  if (hasCode) {
    const row = resolveHousehold(couple.id, codeRaw);
    householdId = row.id;
    const members = listMembers(row.id);
    const anyYes = members.some((m) => m.rsvp_status === "yes");
    tier = anyYes ? "confirmed" : "invited";
    household = {
      household_code: row.code,
      household_label: row.label,
      members: members.map(toHouseholdMember),
    };
  }

  const schedule: PublicWeddingScheduleEntry[] = listScheduleEvents(couple.id).map((e) => ({
    id: e.id,
    label: e.label,
    starts_at_minutes: e.starts_at_minutes,
    duration_minutes: e.duration_minutes,
    location: e.location,
    notes: e.notes,
  }));

  // Funnel event — every successful fetch counts. We split by tier so
  // the dashboard can distinguish "wedding-site view" from "gated
  // guest-portal view" without two endpoints. Keeps the legacy
  // `guest.portal.view` event name on the confirmed tier so downstream
  // analytics queries don't break.
  if (tier === "public") {
    recordGrowthEventFromRequest("wedding_site.view", ctx.req, {
      couple_id: couple.id,
    });
  } else {
    recordGrowthEventFromRequest("guest.portal.view", ctx.req, {
      couple_id: couple.id,
      household_id: householdId,
    });
  }

  const wedding = buildView(couple, tier, schedule);
  const payload: PublicWeddingResponse = { wedding, household, tier };
  return json(payload);
}

// Redirect-shim for the legacy `GET /api/guest/portal?couple=X&code=Y`
// endpoint. We keep one release of back-compat for any old SPA bundle
// or saved bookmark; the canonical surface is `/api/public/wedding/:slug`
// with optional `?code=`. The shim calls into the same handler, then
// reshapes the response into the legacy `{ portal: GuestPortalView }`
// envelope. A 403 with `not_rsvpd` is preserved when at-least-one-yes
// isn't satisfied so existing frontends keep their "please RSVP first"
// gate copy working.
function handleLegacyGuestPortal(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "guest:portal", WEDDING_CODE_BUCKET);

  const slug = ctx.url.searchParams.get("couple") ?? "";
  const code = ctx.url.searchParams.get("code") ?? "";
  if (!slug) throw new HttpError(400, "Invalid couple identifier");
  if (!code) throw new HttpError(400, "Invalid code");

  const couple = resolveCoupleBySlug(slug, false);
  const householdRow = resolveHousehold(couple.id, code);
  const members = listMembers(householdRow.id);
  const anyYes = members.some((m) => m.rsvp_status === "yes");
  if (!anyYes) {
    // Legacy contract — preserve the 403 + code so existing clients
    // keep routing the user to /rsvp instead of showing an unknown error.
    throw new HttpError(403, "Please RSVP yes first", { code: "not_rsvpd" });
  }

  recordGrowthEventFromRequest("guest.portal.view", ctx.req, {
    couple_id: couple.id,
    household_id: householdRow.id,
  });

  const schedule = listScheduleEvents(couple.id).map((e) => ({
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

  // Legacy guest-portal envelope. Mirrors the original GuestPortalView
  // shape (shared/guest_portal.ts) — confirmed-tier data exposed because
  // the legacy endpoint never serviced the lower tiers; not_rsvpd above
  // is the only short-circuit.
  return json({
    portal: {
      couple_slug: couple.slug ?? "",
      couple_display_name: couple.display_name,
      wedding_date: couple.wedding_date,
      ceremony_kind: ceremonyKind,
      location_lat: couple.location_lat,
      location_lng: couple.location_lng,
      location_radius_km: couple.location_radius_km,
      schedule,
      household_code: householdRow.code,
      household_label: householdRow.label,
      members: members.map(toHouseholdMember),
      fetched_at: now(),
    },
  });
}

export function registerPublicWeddingRoutes(router: Router) {
  // Public — no auth flag. Path param `:slug` is the couple's slug.
  router.get("/api/public/wedding/:slug", handleGetWeddingWebsite);
  // Same surface, with the household code carried in the path so the
  // frontend `/w/:slug/:code` route can mirror the URL layout.
  router.get("/api/public/wedding/:slug/:code", handleGetWeddingWebsite);
  // Legacy redirect-shim — see comment on handleLegacyGuestPortal. Slated
  // for removal one release after Phase 2 ships.
  router.get("/api/guest/portal", handleLegacyGuestPortal);
}
