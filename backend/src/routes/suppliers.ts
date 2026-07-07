// Public suppliers directory. Merges the static curated list with active
// user-submitted entries, then overlays per-supplier vote tallies + the
// caller's own vote. Anonymous callers get votes_score but user_vote = 0.

import type {
  DirectorySupplier,
  DirectorySupplierBase,
  SupplierCategory,
  SupplierDetail,
  SupplierEventInput,
} from "@shared/suppliers";
import {
  listActiveCommunitySuppliers,
  toDirectorySupplierBase,
} from "../domain/community_suppliers";
import { getCoupleForUser } from "../domain/couples";
import { curatedOverrideMap, isCuratedPubliclyVisible } from "../domain/curated_overrides";
import { DIRECTORY } from "../domain/suppliers_data";
import { getCoupleVotesMap, getScoresMap, setVote, type VoteValue } from "../domain/supplier_votes";
import { recordSupplierEvents } from "../domain/supplier_views";
import { listListingPhotos, listListingVideos } from "../domain/listings";
import { getReviewSummary } from "../domain/reviews";
import { countNonDeletedComments } from "../domain/supplier_comments";
import { getAvailability } from "../domain/supplier_bookings";
import { isAdminEmail } from "../domain/users";
import { db } from "../db";
import { haversineKm } from "../lib/geo";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set([
  "venue",
  "accommodation",
  "tent_pavilion",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "sound_tech",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "nails",
  "rings",
  "stationery",
  "wedding_website",
  "transport",
]);

function withVotes(
  base: DirectorySupplierBase,
  scores: Map<string, number>,
  coupleVotes: Map<string, VoteValue> | null,
): DirectorySupplier {
  return {
    ...base,
    votes_score: scores.get(base.id) ?? 0,
    user_vote: (coupleVotes?.get(base.id) ?? 0) as -1 | 0 | 1,
  };
}

async function handleList(ctx: Ctx): Promise<Response> {
  const cat = ctx.url.searchParams.get("category");
  // Optional geo proximity filter: `?near_lat=&near_lng=&radius_km=`. All three
  // must parse to finite numbers to activate; partial / malformed input keeps
  // the legacy un-filtered behaviour so the URL stays back-compat. Frontend
  // opt-in only — the UI doesn't expose the toggle yet (the curated catalogue
  // is HU-only, so EU couples would get empty sets), but the backend is ready
  // for the "Near my venue" filter once non-HU listings populate.
  const nearLatRaw = ctx.url.searchParams.get("near_lat");
  const nearLngRaw = ctx.url.searchParams.get("near_lng");
  const radiusKmRaw = ctx.url.searchParams.get("radius_km");
  const nearLat = nearLatRaw !== null ? Number.parseFloat(nearLatRaw) : Number.NaN;
  const nearLng = nearLngRaw !== null ? Number.parseFloat(nearLngRaw) : Number.NaN;
  const radiusKm = radiusKmRaw !== null ? Number.parseFloat(radiusKmRaw) : Number.NaN;
  const hasGeoFilter =
    Number.isFinite(nearLat) &&
    Number.isFinite(nearLng) &&
    Number.isFinite(radiusKm) &&
    radiusKm > 0;

  // Country scoping: a couple only sees curated venues in the country their
  // wedding is in (set at onboarding, defaults "HU"). So a Hungarian couple
  // never gets offered a Croatian/Austrian/etc. venue. Anonymous callers and
  // users without a workspace see the full catalogue. Community submissions
  // are left unscoped (all HU today) so a couple's own recs stay visible.
  const couple = ctx.userId ? getCoupleForUser(ctx.userId) : null;
  // Drop curated entries an admin has hidden or deleted (moderation overrides).
  const overrides = curatedOverrideMap();
  const visible = overrides.size > 0 ? DIRECTORY.filter((s) => !overrides.has(s.id)) : DIRECTORY;

  // Distinct curated countries + their counts, so the frontend can render a
  // country picker (defaults to the couple's own country, with an "all"
  // escape hatch). Sorted by count desc so the biggest catalogue leads.
  const countryCounts = new Map<string, number>();
  for (const s of visible) countryCounts.set(s.country, (countryCounts.get(s.country) ?? 0) + 1);
  const countries = [...countryCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  // `?country=` overrides the couple-derived default: a valid alpha-2 code
  // scopes to that country, `all` disables scoping (full catalogue), and an
  // absent/invalid value falls back to the couple's onboarding country.
  const countryParam = ctx.url.searchParams.get("country");
  const countryFilter =
    countryParam === "all"
      ? null
      : countryParam && /^[A-Za-z]{2}$/.test(countryParam)
        ? countryParam.toUpperCase()
        : (couple?.country ?? null);
  const scoped = countryFilter ? visible.filter((s) => s.country === countryFilter) : visible;
  const curated = cat ? scoped.filter((s) => s.category === cat) : scoped;
  const community = listActiveCommunitySuppliers((cat as SupplierCategory | null) ?? null);
  let allBase: DirectorySupplierBase[] = [...curated, ...community.map(toDirectorySupplierBase)];

  if (hasGeoFilter) {
    allBase = allBase.filter((s) => {
      if (s.lat == null || s.lng == null) return false;
      return haversineKm(nearLat, nearLng, s.lat, s.lng) <= radiusKm;
    });
  }

  const scores = getScoresMap();
  // user_vote is now per-couple — both partners see the same "+1" once either
  // casts it. Anonymous callers and signed-in users without a workspace get
  // `user_vote: 0` everywhere.
  const coupleVotes = couple ? getCoupleVotesMap(couple.id) : null;

  // Overlay `vendor_account_id` + `hero_image_url` from the unified `listings`
  // table. Both curated and community entries default to null at the mapper
  // layer; here we pull the actual claim state + vendor-uploaded hero in one
  // query so the public card knows whether to render the "Ez a sajátom" CTA
  // and which image to show. One IN(...) hop is cheaper than per-row lookups
  // even at 200+ rows.
  if (allBase.length > 0) {
    const ids = allBase.map((b) => b.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, vendor_account_id, hero_image_url FROM listings WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Array<{
      id: string;
      vendor_account_id: number | null;
      hero_image_url: string | null;
    }>;
    const byListing = new Map(rows.map((r) => [r.id, r] as const));
    for (const b of allBase) {
      const row = byListing.get(b.id);
      if (row === undefined) continue;
      b.vendor_account_id = row.vendor_account_id;
      b.hero_image_url = row.hero_image_url;
    }
  }

  return json({ suppliers: allBase.map((b) => withVotes(b, scores, coupleVotes)), countries });
}

interface VoteBody {
  value?: unknown;
}

async function handleVote(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  if (supplierId.length > 80) throw new HttpError(400, "supplier_id too long");

  // Votes are per-couple — a user without a workspace has no slot to vote
  // into. Returning 403 surfaces the constraint instead of letting the row
  // land with a null couple_id and silently fail the unique index.
  const couple = getCoupleForUser(userId);
  if (!couple) {
    throw new HttpError(403, "Join or create a couple workspace to vote", {
      code: "no_couple",
    });
  }

  // The id must reference something in the public list — either a curated slug
  // or an active community entry. Without this guard we'd accept votes for
  // garbage ids that no card ever shows.
  const isCurated =
    DIRECTORY.some((s) => s.id === supplierId) && isCuratedPubliclyVisible(supplierId);
  if (!isCurated) {
    if (!supplierId.startsWith("c")) throw new HttpError(404, "Unknown supplier");
    const community = listActiveCommunitySuppliers();
    const communityMatch = community.find((c) => `c${c.id}` === supplierId);
    if (!communityMatch) {
      throw new HttpError(404, "Unknown supplier");
    }
    // Self-vote block: refuse votes on a community supplier whose submitter
    // is a member of the voting couple (either partner). Without this the
    // submitter's workspace gets a free +1 the moment they finish the form,
    // and "Top voted" becomes a self-listing leaderboard.
    if (communityMatch.submitter_user_id) {
      const submitter = db
        .prepare("SELECT couple_id FROM users WHERE id = ?")
        .get(communityMatch.submitter_user_id) as { couple_id: number | null } | undefined;
      if (submitter && submitter.couple_id === couple.id) {
        throw new HttpError(403, "Can't vote on your own submission", {
          code: "self_vote",
        });
      }
    }
  }

  const body = await readJson<VoteBody>(ctx.req);
  const raw = body.value;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (n !== -1 && n !== 0 && n !== 1) {
    throw new HttpError(400, "value must be -1, 0, or 1");
  }
  setVote(couple.id, userId, supplierId, n as VoteValue);

  // Echo the fresh tally so the frontend can sync optimistically.
  const scores = getScoresMap();
  return json({
    supplier_id: supplierId,
    votes_score: scores.get(supplierId) ?? 0,
    user_vote: n,
  });
}

interface EventsBody {
  events?: unknown;
}

/** Batched ingest for directory analytics. Anonymous-tolerant — a logged-out
 *  visitor still counts toward views. We rate-limit per IP so a single
 *  client can't flood the table; the cap is generous (60 batches/min) since
 *  the frontend sends one batch per page-load. */
async function handleRecordEvents(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "suppliers.events", { capacity: 60, refillRate: 1 });
  const body = await readJson<EventsBody>(ctx.req).catch(() => ({}) as EventsBody);
  if (!Array.isArray(body.events)) {
    throw new HttpError(400, "events must be an array");
  }
  if (body.events.length > 200) {
    throw new HttpError(400, "events batch too large (max 200)");
  }
  const coupleId = ctx.userId ? (getCoupleForUser(ctx.userId)?.id ?? null) : null;
  const written = recordSupplierEvents(
    body.events as SupplierEventInput[],
    ctx.userId ?? null,
    coupleId,
  );
  return json({ recorded: written });
}

function resolveSupplierBase(supplierId: string): DirectorySupplierBase | null {
  const curated = DIRECTORY.find((s) => s.id === supplierId);
  // A hidden/deleted curated entry 404s on the public detail + redirect paths.
  if (curated) return isCuratedPubliclyVisible(supplierId) ? curated : null;
  if (!supplierId.startsWith("c")) return null;
  const community = listActiveCommunitySuppliers().find((c) => `c${c.id}` === supplierId);
  return community ? toDirectorySupplierBase(community) : null;
}

/** GET /api/suppliers/:supplier_id — detail-page payload. v1 is admin-only on
 *  the route layer (the detail page itself is admin-gated); flipping the auth
 *  rule to requireAuth in Phase 3 makes the same shape couple-friendly. */
async function handleDetail(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  const resolved = resolveSupplierBase(supplierId);
  if (!resolved) throw new HttpError(404, "Unknown supplier");
  // Copy before overlaying — resolveSupplierBase can hand back the shared
  // static DIRECTORY object, and mutating that would leak one request's
  // overlay into every later request.
  const base = { ...resolved };

  // Overlay vendor_account_id + hero from listings (same shape the list view
  // uses). Curated entries default to null and only flip when the vendor
  // claims the listing.
  const listing = db
    .prepare("SELECT vendor_account_id, hero_image_url FROM listings WHERE id = ?")
    .get(supplierId) as
    | { vendor_account_id: number | null; hero_image_url: string | null }
    | undefined;
  if (listing) {
    base.vendor_account_id = listing.vendor_account_id;
    base.hero_image_url = listing.hero_image_url;
  }

  // Build the gallery from LOCAL (CSP-safe) images only: the cached hero first,
  // then the re-hosted portfolio photos in order. The detail page renders these
  // via <img src>, and our CSP `img-src` only allows `'self'` (+ a few fixed
  // hosts) — so the static seed's raw vendor-website URLs would be blocked by
  // the browser and paint as broken thumbnails. Those photos live in
  // `listing_photos`: vendor uploads (vendor_listing.ts) or the curated-gallery
  // backfill (domain/listing_gallery_backfill) that re-hosts the seed images.
  // When nothing is cached yet the strip collapses to the hero alone — one
  // clean image, never a row of broken icons.
  const uploadedPhotos = listListingPhotos(supplierId);
  base.gallery_urls = [
    ...(base.hero_image_url ? [base.hero_image_url] : []),
    ...uploadedPhotos.map((p) => p.url),
  ];

  // Vote overlay so the detail page can keep the up/down hint above the
  // stars during the migration window (v1 retains both surfaces).
  const scores = getScoresMap();
  const couple = getCoupleForUser(userId);
  const coupleVotes = couple ? getCoupleVotesMap(couple.id) : null;
  const directory: DirectorySupplier = {
    ...base,
    votes_score: scores.get(base.id) ?? 0,
    user_vote: (coupleVotes?.get(base.id) ?? 0) as -1 | 0 | 1,
  };

  const reviewsSummary = getReviewSummary(supplierId);
  const availability = getAvailability(supplierId);

  // `next_available` is public: couples compare suppliers on it in the
  // shortlist comparison dialog. It's only ever non-null for claimed vendor
  // accounts (the rest stay null and render an "ask to confirm" fallback),
  // so exposing it leaks nothing an unclaimed listing didn't already imply.
  // `comments_count` stays admin-only — it's a moderation signal, not a
  // couple-facing fact.
  const userRow = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as
    | { email: string }
    | undefined;
  const viewerIsAdmin = userRow ? isAdminEmail(userRow.email) : false;

  const payload: SupplierDetail = {
    ...directory,
    reviews_summary: reviewsSummary,
    bookable: availability.bookable,
    next_available: availability.next_available,
    // Reference-video reel, in vendor drag order. Empty for the unclaimed
    // majority; the detail page renders a lazy click-to-play grid when present.
    videos: listListingVideos(supplierId),
    ...(viewerIsAdmin ? { comments_count: countNonDeletedComments(supplierId) } : {}),
  };
  return json(payload);
}

/** GET /r/supplier/:supplier_id — tracked website redirect for unclaimed
 *  curated/community suppliers. Records a `website_click` event so the
 *  vendor-acquisition team can see demand signal without us cold-emailing the
 *  vendor. 302 to the listing's website; 404 when the supplier doesn't exist
 *  or has no website on file. No auth — couples (Phase 3) and anonymous
 *  visitors both can use it. */
async function handleRedirect(ctx: Ctx): Promise<Response> {
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) return new Response("Not found", { status: 404 });
  const base = resolveSupplierBase(supplierId);
  if (!base || !base.website) return new Response("Not found", { status: 404 });

  const coupleId = ctx.userId ? (getCoupleForUser(ctx.userId)?.id ?? null) : null;
  // Reuse the existing suppliers event ingest path. Single event so the
  // counter increments in the same Map the admin directory reads from.
  recordSupplierEventsSafe(
    [{ supplier_id: supplierId, type: "website_click" }],
    ctx.userId ?? null,
    coupleId,
  );

  // Defend against open-redirect: only forward to absolute http(s) URLs.
  let target = base.website.trim();
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    target = `https://${target}`;
  }
  return new Response(null, { status: 302, headers: { Location: target } });
}

function recordSupplierEventsSafe(
  events: SupplierEventInput[],
  userId: number | null,
  coupleId: number | null,
): void {
  try {
    recordSupplierEvents(events, userId, coupleId);
  } catch {
    // Telemetry must never block a redirect — swallow.
  }
}

export function registerSupplierRoutes(router: Router) {
  router.get("/api/suppliers", handleList);
  router.get("/api/suppliers/:supplier_id", handleDetail, true);
  router.post("/api/suppliers/events", handleRecordEvents);
  router.put("/api/suppliers/:supplier_id/vote", handleVote, true);
  router.get("/r/supplier/:supplier_id", handleRedirect);
  // Silence the unused-import warning for VALID_CATEGORIES; it's left here
  // so a future "validate cat param" path is one line away.
  void VALID_CATEGORIES;
}
