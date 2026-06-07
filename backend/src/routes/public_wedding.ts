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
import type {
  WishlistEntry,
  WishlistInterestToggleInput,
  WishlistInterestToggleResult,
} from "@shared/wishlist";
import { toPublicDesign } from "@shared/design";
import { db, now } from "../db";
import { type CoupleRow, parseDesignJson } from "../domain/couples";
import { recordGrowthEventFromRequest } from "../domain/growth_events";
import { listScheduleEvents } from "../domain/schedule";
import {
  getWishlistItemScoped,
  listHouseholdPledges,
  listInterestStatsForItems,
  listWishlistItemRows,
  normalizeKind,
  setInterest,
  toWishlistEntry,
} from "../domain/wishlist";
import { type HouseholdRow, listMembers, toHouseholdMember } from "../domain/households";
import { normalizeSlugInput } from "../domain/slug";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
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
  wishlist: WishlistEntry[] | null,
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
    // Couple-curated wishlist: confirmed tier AND the couple flipped publish.
    // Same server-side omission rule as the exact pin / post_rsvp_content: the
    // caller passes the array only when confirmed + published (null otherwise),
    // so a tampered client can never surface it. The `isConfirmed` guard is
    // belt-and-suspenders on the tier; the null pass-through carries the
    // unpublished case. Empty array when published with no items authored.
    wishlist: isConfirmed ? wishlist : null,
    // Visual identity — presentation-only, never gated (styling is public).
    // Resolved to hex + font stacks; the guest page reads these straight into
    // CSS custom properties. NULL/legacy design_json → Botanical Green.
    design: toPublicDesign(parseDesignJson(couple.design_json)),
    fetched_at: now(),
  };
}

/** Build the confirmed-tier wishlist embed for one resolved household. For each
 *  item we strip the couple-internal fields; for 'gift' items we fold in the
 *  soft interest count + this household's pledge. 'request' items get 0 / false
 *  (the interest tap + pledge only apply to gifts). Batched: one stats query +
 *  one household-pledge query, not per-item. */
function buildWishlistEntries(coupleId: number, householdId: number): WishlistEntry[] {
  const rows = listWishlistItemRows(coupleId);
  if (rows.length === 0) return [];
  const giftIds = rows.filter((r) => normalizeKind(r.kind) === "gift").map((r) => r.id);
  const stats = listInterestStatsForItems(giftIds);
  const mine = listHouseholdPledges(householdId, giftIds);
  return rows.map((r) => {
    if (normalizeKind(r.kind) !== "gift") return toWishlistEntry(r, 0, 0, false, null);
    const s = stats.get(r.id);
    return toWishlistEntry(
      r,
      s?.count ?? 0,
      s?.pledged ?? 0,
      mine.has(r.id),
      mine.get(r.id) ?? null,
    );
  });
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

  // Wishlist is a confirmed-tier-only embed (valid code + ≥1 RSVP yes). At
  // lower tiers we pass null so buildView omits it server-side — same omission
  // rule as the exact pin / post_rsvp_content.
  const wishlist =
    tier === "confirmed" && householdId !== null && couple.wishlist_published === 1
      ? buildWishlistEntries(couple.id, householdId)
      : null;

  const wedding = buildView(couple, tier, schedule, wishlist);
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

// Toggle the household's soft "I'd like to help" tap on a 'gift' wishlist item.
// The slug + code pair is the credential — same gate as the confirmed-tier
// embed: the household must resolve AND have at least one RSVP yes (403
// otherwise). Only 'gift' items accept the tap ('request' items carry no
// money). Idempotent toggle, plus an optional soft pledge amount. Rate-limited
// on the same code bucket as the lookup so it can't be used to enumerate codes.
async function handleToggleWishlistInterest(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "public:wedding:code", WEDDING_CODE_BUCKET);

  const slug = ctx.params.slug ?? "";
  const codeRaw = ctx.params.code ?? "";
  const itemId = Number(ctx.params.itemId);
  if (!Number.isFinite(itemId)) throw new HttpError(400, "Invalid item id");

  // Code is the credential — works even on private couples (requireIsPublic
  // false), matching the code-bearing lookup path.
  const couple = resolveCoupleBySlug(slug, false);
  const household = resolveHousehold(couple.id, codeRaw);

  // Confirmed-tier gate: at least one member must have RSVP'd yes. Below that
  // the wishlist isn't even visible, so the tap is refused with 403.
  const members = listMembers(household.id);
  const anyYes = members.some((m) => m.rsvp_status === "yes");
  if (!anyYes) {
    throw new HttpError(403, "Please RSVP yes first", { code: "not_rsvpd" });
  }

  const item = getWishlistItemScoped(itemId, couple.id);
  if (!item) throw new HttpError(404, "Wishlist item not found");
  // Only gifts surface the coordination tap; requests carry no money.
  if (normalizeKind(item.kind) !== "gift") {
    throw new HttpError(400, "Interest is only valid for gift items");
  }

  // Optional soft pledge. Absent key → pure toggle (undefined). `null` → in,
  // no amount. A number must be a non-negative integer (minor units). No money
  // moves — this is a non-binding coordination figure.
  const body = await readJson<WishlistInterestToggleInput>(ctx.req).catch(() => ({}));
  let pledge: number | null | undefined;
  if (!("pledged_amount_minor" in body)) {
    pledge = undefined;
  } else if (body.pledged_amount_minor === null) {
    pledge = null;
  } else {
    const n = Number(body.pledged_amount_minor);
    if (!Number.isInteger(n) || n < 0) {
      throw new HttpError(400, "pledged_amount_minor must be a non-negative integer or null");
    }
    pledge = n;
  }

  const result: WishlistInterestToggleResult = setInterest(couple.id, itemId, household, pledge);
  return json(result);
}

export function registerPublicWeddingRoutes(router: Router) {
  // Public — no auth flag. Path param `:slug` is the couple's slug.
  router.get("/api/public/wedding/:slug", handleGetWeddingWebsite);
  // Same surface, with the household code carried in the path so the
  // frontend `/w/:slug/:code` route can mirror the URL layout.
  router.get("/api/public/wedding/:slug/:code", handleGetWeddingWebsite);
  // Soft "I'd like to help" toggle on a group-gift wishlist item. The code in
  // the path is the credential; confirmed-tier-gated + gift-only inside
  // the handler. No auth flag — guests aren't logged in.
  router.post(
    "/api/public/wedding/:slug/:code/wishlist/:itemId/interest",
    handleToggleWishlistInterest,
  );
  // Legacy redirect-shim — see comment on handleLegacyGuestPortal. Slated
  // for removal one release after Phase 2 ships.
  router.get("/api/guest/portal", handleLegacyGuestPortal);
}
