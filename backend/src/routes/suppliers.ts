// Public suppliers directory. Merges the static curated list with active
// user-submitted entries, then overlays per-supplier vote tallies + the
// caller's own vote. Anonymous callers get votes_score but user_vote = 0.

import type {
  CommentVisibility,
  DirectorySupplier,
  DirectorySupplierBase,
  PublicShowcaseCategory,
  PublicShowcaseVendor,
  PublicVendorPageData,
  PublicVendorShowcase,
  PublicDirectoryPage,
  SupplierCategory,
  SupplierContact,
  SupplierCountryCount,
  SupplierDetail,
  SupplierEventInput,
} from "@shared/suppliers";
import {
  cityDisplayName,
  foldForSearch,
  parseSpokenLanguages,
  SUPPLIER_GROUPS,
} from "@shared/suppliers";
import { countryName } from "@shared/country_list";
import { listingCurrency } from "@shared/listing_pricing";
import { searchPublicVendors } from "../domain/vendor_search";
import {
  listActiveCommunitySuppliers,
  toDirectorySupplierBase,
} from "../domain/community_suppliers";
import { getCoupleForUser } from "../domain/couples";
import { maskPhoneForAnonymous } from "../domain/phone_mask";
import { correspondingListingIds } from "../domain/vendor_correspondence";
import { curatedOverrideMap, isCuratedPubliclyVisible } from "../domain/curated_overrides";
import { resolveSupplierBase } from "../domain/resolve_supplier";
import { DIRECTORY } from "../domain/suppliers_data";
import { getCoupleVotesMap, getScoresMap, setVote, type VoteValue } from "../domain/supplier_votes";
import { recordSupplierEvents } from "../domain/supplier_views";
import {
  getClaimedDirectoryBaseById,
  listActiveClaimedListingsForDirectory,
  listingContactHidden,
  listListingPackages,
  listListingPhotos,
  listListingVideos,
  listShowcaseCandidates,
  redactUnclaimedImport,
  type ShowcaseVendorRow,
} from "../domain/listings";
import { maskAddressForPublic } from "../domain/contact_mask";
import { getReviewCountsMap, getReviewSummary, listReviewsForSupplier } from "../domain/reviews";
import { countNonDeletedComments, listCommentsForSupplier } from "../domain/supplier_comments";
import { getAvailability, isIsoDate, listingIdsUnavailableOn } from "../domain/supplier_bookings";
import { isAdminEmail, requireAdmin } from "../domain/users";
import { completeListingIds } from "../domain/vendor_clients";
import { db } from "../db";
import { haversineKm } from "../lib/geo";
import { lookupCountry } from "../lib/geoip";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { log } from "../lib/logger";
import { rateLimit } from "../lib/rate_limit";

const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set(
  SUPPLIER_GROUPS.flatMap((g) => g.categories),
);

/** Shared "no listing qualifies" set, so an anonymous catalogue render costs no
 *  allocation and no query. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

function withVotes(
  base: DirectorySupplierBase,
  scores: Map<string, number>,
  coupleVotes: Map<string, VoteValue> | null,
  completeIds: ReadonlySet<string>,
  phoneEarnedIds: ReadonlySet<string>,
  reviewCounts: Map<string, number>,
): DirectorySupplier {
  // The exception to the nulling below, and the only one: a vendor this couple
  // has actually corresponded with. See domain/vendor_correspondence.ts for why
  // a two-way thread is consent. The set is the couple's own handful of
  // conversations, so this can never turn back into "every number in one GET",
  // which is the property the rule below is protecting.
  const earned = phoneEarnedIds.has(base.id);
  return {
    ...base,
    // The catalogue arrives in ONE response, so a contact detail on this object
    // is a contact detail multiplied by a thousand: the list used to hand any
    // caller, session or not, 503 mailboxes and 538 phone numbers in a single
    // unauthenticated GET. What the list may say is that a contact EXISTS (the
    // card's phone button, the compare dialog's channel row); the value itself
    // comes one listing at a time from `/api/suppliers/:id/contact`, which needs
    // a session and spends from a per-user quota. Nulled here rather than at the
    // mappers so there is exactly one place to audit.
    // A held-back address counts as no address here: the card must not offer
    // a mail affordance for a mailbox nothing is allowed to write to.
    has_contact_email: Boolean(base.contact_email) && base.contact_email_flag == null,
    has_contact_phone: Boolean(base.contact_phone || base.contact_phone_alt),
    contact_email: null,
    contact_phone: earned ? base.contact_phone : null,
    contact_phone_alt: earned ? (base.contact_phone_alt ?? null) : null,
    votes_score: scores.get(base.id) ?? 0,
    user_vote: (coupleVotes?.get(base.id) ?? 0) as -1 | 0 | 1,
    listing_complete: completeIds.has(base.id),
    reviews_count: reviewCounts.get(base.id) ?? 0,
  };
}

/** Assemble the catalogue: curated + community + claimed, with the `listings`
 *  overlay (claim state, hero, imported-teaser redaction) applied.
 *
 *  Extracted so the in-app directory and the PUBLIC browser are the same
 *  catalogue rather than two hand-kept copies of one. They differ in what they
 *  do with it (the app scopes to the couple's country and overlays their votes;
 *  the public browser filters, ranks and paginates), never in what is in it: a
 *  vendor visible to a signed-in couple and invisible to a visitor would be a
 *  listing whose own share link outranks it.
 *
 *  `country: null` means no scoping at all. Exported for
 *  `domain/vendor_locations.ts`, which needs the exact same catalogue (photo
 *  presence included) to count listings per category × city combination —
 *  same "one catalogue, not two hand-kept copies" reasoning as the rest of
 *  this comment. */
export function assembleDirectoryBase(opts: {
  category: SupplierCategory | null;
  country: string | null;
  geo?: { lat: number; lng: number; radiusKm: number } | null;
  /** Reuse a caller's moderation snapshot when it already needed one (the
   *  list endpoint also uses it to build country counts). */
  curatedOverrides?: ReadonlyMap<string, unknown>;
}): DirectorySupplierBase[] {
  // Drop curated entries an admin has hidden or deleted (moderation overrides).
  const overrides = opts.curatedOverrides ?? curatedOverrideMap();
  const visible = overrides.size > 0 ? DIRECTORY.filter((s) => !overrides.has(s.id)) : DIRECTORY;
  const scoped = opts.country ? visible.filter((s) => s.country === opts.country) : visible;
  const curated = opts.category ? scoped.filter((s) => s.category === opts.category) : scoped;
  const community = listActiveCommunitySuppliers(opts.category);
  let allBase: DirectorySupplierBase[] = [...curated, ...community.map(toDirectorySupplierBase)];

  // Every listing a vendor account owns — self-serve `v{N}` cards AND curated /
  // community entries a vendor has claimed. Not country-scoped (like community)
  // so a registered vendor stays visible to every couple. Dedupe by id: an
  // in-scope claimed curated entry already came through above under the same id,
  // so what this actually adds is the vendor whose entry the country filter just
  // dropped — the case that used to make a verified Austrian venue invisible to
  // every couple whose wedding wasn't in Austria.
  const seenIds = new Set(allBase.map((b) => b.id));
  for (const c of listActiveClaimedListingsForDirectory(opts.category)) {
    if (!seenIds.has(c.id)) allBase.push(c);
  }

  const geo = opts.geo;
  if (geo) {
    allBase = allBase.filter((s) => {
      if (s.lat == null || s.lng == null) return false;
      return haversineKm(geo.lat, geo.lng, s.lat, s.lng) <= geo.radiusKm;
    });
  }

  // Overlay `vendor_account_id` + `hero_image_url` from the unified `listings`
  // table. Both curated and community entries default to null at the mapper
  // layer; here we pull the actual claim state + vendor-uploaded hero in one
  // query so the public card knows whether to render the "Ez a sajátom" CTA
  // and which image to show.
  //
  // For the full catalogue, read the five narrow columns sequentially and
  // match them in memory. A freshly prepared `IN (?, …)` with thousands of
  // placeholders made SQLite perform thousands of PK probes on every request.
  // Small country/category slices keep the targeted query; once the slice is
  // large, a sequential scan is materially faster even if the DB still holds
  // an old curated row no longer in DIRECTORY. The map naturally ignores it.
  if (allBase.length > 0) {
    type OverlayRow = {
      id: string;
      vendor_account_id: number | null;
      hero_image_url: string | null;
      source: string;
      profile_imported: number;
    };
    const columns = "id, vendor_account_id, hero_image_url, source, profile_imported";
    let rows: OverlayRow[];
    if (allBase.length >= 500) {
      rows = db.prepare(`SELECT ${columns} FROM listings`).all() as OverlayRow[];
    } else {
      const ids = allBase.map((b) => b.id);
      const placeholders = ids.map(() => "?").join(",");
      rows = db
        .prepare(`SELECT ${columns} FROM listings WHERE id IN (${placeholders})`)
        .all(...ids) as OverlayRow[];
    }
    const byListing = new Map(rows.map((r) => [r.id, r] as const));
    for (let i = 0; i < allBase.length; i++) {
      const row = byListing.get(allBase[i]!.id);
      if (row === undefined) continue;
      // Copy before overlaying: `allBase` holds the shared static DIRECTORY
      // objects, and the redaction below must not be able to reach them.
      const b = { ...allBase[i]! };
      b.vendor_account_id = row.vendor_account_id;
      b.hero_image_url = row.hero_image_url;
      // A vendor-owned listing IS claimed — surface it as such even on a
      // curated/community entry whose stored origin `source` predates the
      // claim, so the Verified badge + "Verified only" filter see the real
      // ownership. Derive from the DB row every request (never from the possibly
      // shared, possibly stale `b.source`).
      b.source =
        row.vendor_account_id !== null
          ? "claimed"
          : (row.source as "curated" | "community" | "claimed");
      b.profile_imported = row.profile_imported === 1;
      // An imported profile nobody has claimed yet shows as a teaser: the card
      // keeps its photo, name, town and category and loses the bio, the price
      // band and the phone number. Replaces the element because `allBase` can
      // hold the shared static DIRECTORY object, which must never be mutated.
      allBase[i] = redactUnclaimedImport(b, {
        profile_imported: b.profile_imported,
        vendor_account_id: b.vendor_account_id,
      });
    }
  }

  return allBase;
}

async function handleList(ctx: Ctx): Promise<Response> {
  // The whole catalogue in one response is the cheapest thing on the server to
  // ask for repeatedly and the most expensive to serve. Generous enough that a
  // couple flipping between the directory, the dashboard and the timeline never
  // notices (each of those pages fetches it once), tight enough that a scraper
  // pulling it in a loop stops.
  rateLimit(ctx.clientIp, "suppliers.list", { capacity: 40, refillRate: 0.2 });
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

  const allBase = assembleDirectoryBase({
    category: (cat as SupplierCategory | null) ?? null,
    country: countryFilter,
    geo: hasGeoFilter ? { lat: nearLat, lng: nearLng, radiusKm } : null,
    curatedOverrides: overrides,
  });

  const scores = getScoresMap();
  // user_vote is now per-couple — both partners see the same "+1" once either
  // casts it. Anonymous callers and signed-in users without a workspace get
  // `user_vote: 0` everywhere.
  const coupleVotes = couple ? getCoupleVotesMap(couple.id) : null;

  // Which of the claimed cards have a finished listing — the difference between
  // a solid verified check and a hollow one. Asked only about claimed entries:
  // the rest wear no badge, and keeping the id list the size of the vendor
  // roster (not the catalogue) is what makes this one extra query instead of a
  // second pass over every curated row.
  const completeIds = completeListingIds(
    allBase.filter((b) => b.vendor_account_id !== null).map((b) => b.id),
  );

  // The vendors this couple is already talking to, whose numbers therefore ride
  // along on the card instead of costing a reveal tap and a quota slot. One
  // query, and none at all for an anonymous browser or a workspace-less user.
  const phoneEarnedIds = couple ? correspondingListingIds(couple.id) : EMPTY_IDS;
  const reviewCounts = getReviewCountsMap();

  return json({
    suppliers: allBase.map((b) =>
      withVotes(b, scores, coupleVotes, completeIds, phoneEarnedIds, reviewCounts),
    ),
    countries,
  });
}

/** `GET /api/suppliers/unavailable?date=YYYY-MM-DD` — the listing ids known to
 *  be taken that day.
 *
 *  Deliberately NOT a parameter on the list endpoint: `/api/suppliers` is
 *  fetched once and every filter on the directory page is applied client-side,
 *  so folding the date in would turn each change of the date into a refetch of
 *  the whole catalogue. This is the small half of the answer, so the page can
 *  keep filtering locally. */
function handleUnavailable(ctx: Ctx): Response {
  const date = ctx.url.searchParams.get("date") ?? "";
  // A malformed date returns an empty set rather than a 400: the caller is a
  // filter, and hiding nothing is the correct behaviour for "we don't know".
  if (!isIsoDate(date)) return json({ date, supplier_ids: [] });
  return json({ date, supplier_ids: listingIdsUnavailableOn(date) });
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

  // The id must reference something in the public list. The directory has THREE
  // public card sources, so the vote guard has to accept all three or it 404s a
  // real card (and the frontend rolls the optimistic tally back to 0):
  //   • curated slug        (e.g. "villa-deste")           via DIRECTORY
  //   • community entry      (id "c{N}")                    via listActiveCommunitySuppliers
  //   • registered vendor    (id "v{N}", source='claimed')  via getClaimedDirectoryBaseById
  const isCurated =
    DIRECTORY.some((s) => s.id === supplierId) && isCuratedPubliclyVisible(supplierId);
  if (!isCurated) {
    if (supplierId.startsWith("c")) {
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
    } else {
      // Registered-vendor self-serve listing. getClaimedDirectoryBaseById is
      // the authoritative "is this a live, publicly-visible claimed listing?"
      // check (null for anything else, including a hidden curated slug or a
      // garbage id), so it doubles as the not-found guard.
      const claimed = getClaimedDirectoryBaseById(supplierId);
      if (!claimed) {
        throw new HttpError(404, "Unknown supplier");
      }
      // Same self-vote block as community: a vendor whose owner account belongs
      // to the voting couple can't pad their own listing's score.
      if (claimed.vendor_account_id) {
        const owner = db
          .prepare(
            `SELECT u.couple_id
               FROM vendor_accounts va
               JOIN users u ON u.id = va.owner_user_id
              WHERE va.id = ?`,
          )
          .get(claimed.vendor_account_id) as { couple_id: number | null } | undefined;
        if (owner && owner.couple_id === couple.id) {
          throw new HttpError(403, "Can't vote on your own listing", {
            code: "self_vote",
          });
        }
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

/** Assemble the full SupplierDetail payload for a resolved id. Shared by the
 *  authed detail endpoint and the public vendor page. `viewerUserId` drives the
 *  per-couple vote overlay (null for anonymous → user_vote 0); `includeComments`
 *  gates the admin-only moderation count. Returns null when the id resolves to
 *  nothing public (hidden/unknown), so both callers 404 the same way. */
function buildSupplierDetail(
  supplierId: string,
  opts: { viewerUserId: number | null; includeCommentsCount: boolean },
): SupplierDetail | null {
  const resolved = resolveSupplierBase(supplierId);
  if (!resolved) return null;
  // Copy before overlaying — resolveSupplierBase can hand back the shared
  // static DIRECTORY object, and mutating that would leak one request's
  // overlay into every later request.
  const base = { ...resolved };
  // EVERY lookup below keys on the CANONICAL id, never on the `supplierId` the
  // caller passed. `resolveSupplierBase` accepts the pretty form as well as the
  // bare one ("weddly-v67" → "v67"), and the pretty form is precisely what the
  // Share button copies and what the vendor sends to couples. Keying the
  // follow-up queries on the raw param served that link a hollow page: no
  // gallery, no videos, no packages, no Q&A, no rating summary, and
  // `bookable: false`, so the vendor's own listing read as abandoned on the one
  // URL they hand out.
  const id = base.id;

  // Overlay vendor_account_id + hero from listings (same shape the list view
  // uses). Curated entries default to null and only flip when the vendor
  // claims the listing.
  const listing = db
    .prepare(
      `SELECT vendor_account_id, hero_image_url, spoken_languages, profile_imported, currency
         FROM listings WHERE id = ?`,
    )
    .get(id) as
    | {
        vendor_account_id: number | null;
        hero_image_url: string | null;
        spoken_languages: string | null;
        profile_imported: number;
        currency: string | null;
      }
    | undefined;
  if (listing) {
    base.vendor_account_id = listing.vendor_account_id;
    base.hero_image_url = listing.hero_image_url;
    base.profile_imported = listing.profile_imported === 1;
    // Always reflect the listing's current languages, even on a claimed curated
    // slug whose static base carried none.
    base.spoken_languages = parseSpokenLanguages(listing.spoken_languages);
    // Vendor-owned ⇒ claimed, so the Verified badge shows even on a curated
    // slug the vendor took over (resolveSupplierBase hands back the static
    // curated entry, whose source is hardcoded 'curated'). `base` is a copy, so
    // this never mutates the shared DIRECTORY object.
    if (listing.vendor_account_id !== null) base.source = "claimed";
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
  const uploadedPhotos = listListingPhotos(id);
  base.gallery_urls = [
    ...(base.hero_image_url ? [base.hero_image_url] : []),
    ...uploadedPhotos.map((p) => p.url),
  ];
  // Carry the vendor's chosen framing to the public page. Only non-centred
  // photos ride along, so a gallery nobody has dragged adds nothing to the
  // payload and renders exactly as it did before.
  const positions: Record<string, number> = {};
  for (const p of uploadedPhotos) {
    if (p.position_y !== 50) positions[p.url] = p.position_y;
  }
  if (Object.keys(positions).length > 0) base.gallery_positions_y = positions;

  // Vote overlay so the detail page can keep the up/down hint above the
  // stars during the migration window (v1 retains both surfaces).
  const scores = getScoresMap();
  const couple = opts.viewerUserId ? getCoupleForUser(opts.viewerUserId) : null;
  const coupleVotes = couple ? getCoupleVotesMap(couple.id) : null;
  const reviewsSummary = getReviewSummary(id);
  const directory: DirectorySupplier = {
    ...base,
    // The detail page IS allowed to carry the PHONE (one listing, one caller,
    // one rate-limited request), so unlike the list that keeps its value. The
    // flags travel with it so a card built from a detail response answers
    // "is there a phone here" the same way a card built from the list does.
    has_contact_email: Boolean(base.contact_email) && base.contact_email_flag == null,
    has_contact_phone: Boolean(base.contact_phone || base.contact_phone_alt),
    // The email address is NEVER handed to a user (owner rule, 2026-07-31), on
    // any surface, signed in or not. A mailbox is the one contact detail that
    // can be harvested silently, at scale and forever — a phone number costs a
    // call, an address is a published fact, an address book is a mailing list.
    // A couple who wants this vendor writes through Weddly (the inquiry /
    // outreach path, which still mails `contact_email` server-side), so nothing
    // a couple can actually do is lost. `has_contact_email` stays: that a
    // mailbox EXISTS is what tells the UI the channel is deliverable, and it
    // reveals no characters. Admin reads the row directly and still sees it.
    contact_email: null,
    votes_score: scores.get(base.id) ?? 0,
    user_vote: (coupleVotes?.get(base.id) ?? 0) as -1 | 0 | 1,
    // Solid check vs hollow one. Only a claimed listing is asked — nothing else
    // renders a badge, and the checklist is the vendor's, not the catalogue's.
    listing_complete: base.vendor_account_id !== null && completeListingIds([base.id]).has(base.id),
    reviews_count: reviewsSummary.reviews_count,
  };

  const availability = getAvailability(id);

  // Teaser gate for an imported profile nobody has claimed: bio, price band,
  // phone and every photo past the first come off here, on the shared assembly
  // both the in-app detail page and the anonymous public profile go through.
  const gate = {
    profile_imported: directory.profile_imported === true,
    vendor_account_id: directory.vendor_account_id,
  };
  const gated = redactUnclaimedImport(directory, gate);
  const redacted = gate.profile_imported && gate.vendor_account_id === null;
  return {
    ...gated,
    currency: listingCurrency({
      country: directory.country,
      currency: listing?.currency,
    }),
    reviews_summary: reviewsSummary,
    bookable: availability.bookable,
    next_available: availability.next_available,
    // Reference-video reel, in vendor drag order. Empty for the unclaimed
    // majority; the detail page renders a lazy click-to-play grid when present.
    videos: listListingVideos(id),
    // Price offers / packages (árajánlat). Empty for the unclaimed majority,
    // and force-empty on a redacted import: packages ARE pricing, so leaving
    // them would put back through the side door exactly what the price band
    // just took out.
    packages: redacted ? [] : listListingPackages(id),
    // `comments_count` stays admin-only — it's a moderation signal, not a
    // couple-facing fact — so it's gated by the caller.
    ...(opts.includeCommentsCount ? { comments_count: countNonDeletedComments(id) } : {}),
  };
}

/** The per-user allowance both surfaces that can yield ONE vendor's contact
 *  details spend from: the detail payload and the contact endpoint. Shared on
 *  purpose, so a scraper can't take the quota twice by alternating between them.
 *
 *  Sized against how a couple actually browses. Opening 60 vendor pages in a
 *  sitting is a thorough evening; after that the bucket refills at roughly one
 *  a minute, which no human notices and which turns "harvest the catalogue"
 *  from one request into somewhere north of a day of patient, logged-in,
 *  attributable requests. The key is the USER, not the IP: a scraper behind a
 *  hundred addresses still has one account.
 *
 *  A tripped bucket is worth seeing, so it logs — the interesting event is not
 *  one 429, it is the same user id producing them all evening. */
function spendContactQuota(userId: number): void {
  try {
    rateLimit(`u${userId}`, "vendor.contact", { capacity: 60, refillRate: 1 / 60 });
  } catch (e) {
    log.warn("vendor.contact.quota_exceeded", { userId });
    throw e;
  }
}

/** GET /api/suppliers/:supplier_id/contact — one listing's published PHONE, and
 *  the only place in the product that returns it in full.
 *
 *  Split off the list (which now carries `has_contact_*` flags and nothing else)
 *  because the list is the entire catalogue in one response: the contact fields
 *  on it handed any caller, with or without a session, every vendor's mailbox
 *  and phone number in a single GET. Here it is one listing per request, behind
 *  a session and the shared per-user quota.
 *
 *  `contact_email` is always null here — see buildSupplierDetail. The field
 *  stays on the DTO so a client that reads it keeps compiling and simply gets
 *  nothing; removing it would break the venue-picker prefill's optional read
 *  rather than emptying it. */
async function handleContact(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  spendContactQuota(userId);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");

  // Through the same assembly as the detail page, so an unclaimed imported
  // profile's redaction (which takes the phone off the teaser) applies here too
  // rather than being bypassed by the narrower endpoint.
  const detail = buildSupplierDetail(supplierId, {
    viewerUserId: userId,
    includeCommentsCount: false,
  });
  if (!detail) throw new HttpError(404, "Unknown supplier");

  const payload: SupplierContact = {
    // Always null (buildSupplierDetail drops it for every viewer); kept explicit
    // here because this is the endpoint a reader would check first.
    contact_email: null,
    contact_phone: detail.contact_phone,
    contact_phone_alt: detail.contact_phone_alt ?? null,
  };
  return json(payload);
}

/** GET /api/suppliers/:supplier_id — detail-page payload. Requires auth (the
 *  in-app detail page serves couples + admins). Admins additionally get the
 *  `comments_count` moderation signal. */
async function handleDetail(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  spendContactQuota(userId);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");

  // `next_available` is public: couples compare suppliers on it in the
  // shortlist comparison dialog. It's only ever non-null for claimed vendor
  // accounts (the rest stay null and render an "ask to confirm" fallback),
  // so exposing it leaks nothing an unclaimed listing didn't already imply.
  const userRow = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as
    | { email: string }
    | undefined;
  const viewerIsAdmin = userRow ? isAdminEmail(userRow.email) : false;
  if (viewerIsAdmin) requireAdmin(ctx);

  const payload = buildSupplierDetail(supplierId, {
    viewerUserId: userId,
    includeCommentsCount: viewerIsAdmin,
  });
  if (!payload) throw new HttpError(404, "Unknown supplier");
  return json(payload);
}

/** GET /api/public/vendors/:supplier_id — the unauthenticated, shareable
 *  vendor page payload. This is the ONE endpoint that leaves the workspace
 *  auth wall, so it deliberately returns a curated public subset: the detail
 *  (never the admin-only comments_count, votes anonymised), PUBLISHED reviews
 *  only, the PUBLIC Q&A tier only, and the busy calendar (public by design).
 *  Rate-limited per IP so it can't be scraped into the ground. */
const PUBLIC_VISIBILITIES: CommentVisibility[] = ["public"];
async function handlePublicDetail(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "public.vendor", { capacity: 60, refillRate: 1 });
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");

  const detail = buildSupplierDetail(supplierId, {
    viewerUserId: null,
    includeCommentsCount: false,
  });
  if (!detail) throw new HttpError(404, "Unknown supplier");

  // Gate contact details behind registration for anonymous visitors (ctx.userId
  // is populated whenever a valid session token rides along, even on this public
  // route). Masked server-side so the hidden characters never leave the server;
  // a logged-in viewer gets everything in full.
  //
  //  - The PHONE is always masked for an anonymous visitor. They get the shape
  //    of a contact ("+36 70 6** ****"), which is the reason to register; the
  //    characters themselves never leave the server.
  //  - There is nothing to do about the EMAIL here any more: it is null for
  //    every viewer (buildSupplierDetail), so the masked teaser it used to get
  //    would be a mask over an empty string. Registering no longer reveals it
  //    either, which is the point — see the rule there.
  //  - The ADDRESS stays under the vendor's own `hide_contact_public` switch: a
  //    business address is a published fact, it is what puts the listing on the
  //    map, and hiding it by default would break the one thing a visitor
  //    scouting venues actually needs.
  //  - Website is left as-is — its raw URL already goes through the tracked
  //    /r/supplier redirect.
  if (ctx.userId === null) {
    if (detail.contact_phone) {
      detail.contact_phone = maskPhoneForAnonymous(detail.contact_phone);
    }
    if (detail.contact_phone_alt) {
      detail.contact_phone_alt = maskPhoneForAnonymous(detail.contact_phone_alt);
    }
    if (detail.address && listingContactHidden(detail.id)) {
      detail.address = maskAddressForPublic(detail.address);
    }
  }

  // `detail.id` is the canonical id, not the URL's. A pretty share link
  // ("/vendors/weddly-v67") must read the same reviews, Q&A and calendar as the
  // bare one, or the link the vendor hands out is the one that looks empty.
  const reviews = listReviewsForSupplier(detail.id, {
    limit: 50,
    cursor: null,
    includeUnpublished: false,
  });
  const comments = listCommentsForSupplier(detail.id, {
    limit: 50,
    cursor: null,
    visibilities: PUBLIC_VISIBILITIES,
  });
  const availability = getAvailability(detail.id);

  const payload: PublicVendorPageData = {
    detail,
    reviews: reviews.items,
    comments: comments.items,
    availability,
  };
  return json(payload);
}

/** Page size for the public browser. 24 fills a 4-across grid six rows deep
 *  and keeps a page under ~60 kB; 48 is the ceiling a caller may ask for. */
const PUBLIC_PAGE_SIZE = 24;
const PUBLIC_PAGE_MAX = 48;

/** Rank for the public browser, best-first:
 *    1. has a photograph — a card without one is a dead end for a visitor who
 *       came to look at venues, so photographed listings lead. Never HIDDEN
 *       though: "show every vendor" means every vendor is reachable.
 *    2. claimed by a real Weddly vendor — they answer inquiries.
 *    3. finished listing, then name, so the order is stable across pages
 *       (an unstable sort duplicates and drops rows as the visitor paginates).
 */
function publicBrowseRank(a: DirectorySupplier, b: DirectorySupplier): number {
  const photo = (s: DirectorySupplier) => (s.hero_image_url || s.gallery_urls?.length ? 0 : 1);
  if (photo(a) !== photo(b)) return photo(a) - photo(b);
  const claimed = (s: DirectorySupplier) => (s.vendor_account_id !== null ? 0 : 1);
  if (claimed(a) !== claimed(b)) return claimed(a) - claimed(b);
  const complete = (s: DirectorySupplier) => (s.listing_complete ? 0 : 1);
  if (complete(a) !== complete(b)) return complete(a) - complete(b);
  return a.name.localeCompare(b.name);
}

/** GET /api/public/vendors — the whole directory, for anybody.
 *
 *  The visitor's browser and the couple's directory list the SAME catalogue.
 *  The teaser endpoint below still exists for the landing rails, but a visitor
 *  who wants to browse is no longer shown six cards per category and a wall:
 *  they get all of it, filterable, paginated, and every card links to a public
 *  vendor page that is in the sitemap. That is the useful-browser half; it is
 *  also the SEO half, since it gives crawlers a path into every listing.
 *
 *  What a visitor still does not get is a contact value. The cards carry the
 *  `has_contact_*` flags like every other list and nothing more, so opening the
 *  catalogue to the public did not re-open the contact book with it. */
async function handlePublicDirectory(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "public.directory", { capacity: 60, refillRate: 1 });

  const catParam = ctx.url.searchParams.get("category");
  const category =
    catParam && VALID_CATEGORIES.has(catParam as SupplierCategory)
      ? (catParam as SupplierCategory)
      : null;
  const countryParam = ctx.url.searchParams.get("country");
  const country =
    countryParam && /^[A-Za-z]{2}$/.test(countryParam) ? countryParam.toUpperCase() : null;
  const cityParam = (ctx.url.searchParams.get("city") ?? "").trim();
  const qParam = (ctx.url.searchParams.get("q") ?? "").trim();

  const limitRaw = Number.parseInt(ctx.url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(PUBLIC_PAGE_MAX, Math.max(1, limitRaw))
    : PUBLIC_PAGE_SIZE;
  const offsetRaw = Number.parseInt(ctx.url.searchParams.get("offset") ?? "", 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  // Country is applied during assembly (it is what the catalogue is indexed
  // by); category is NOT, because the category facet has to count the other
  // categories in the same country to fill the filter row.
  const base = assembleDirectoryBase({ category: null, country });
  const scores = getScoresMap();
  const completeIds = completeListingIds(
    base.filter((b) => b.vendor_account_id !== null).map((b) => b.id),
  );
  // Public browse: no session, so no correspondence and no numbers. The phone a
  // visitor may see here is the masked teaser on the detail page, nothing else.
  //
  // Photos-only, same policy the showcase teaser already holds (every
  // PublicShowcaseVendor carries a real hero_image_url) — this endpoint just
  // didn't apply it. A card with the fallback glyph looks abandoned rather
  // than curated at this page's scale (the catalogue is hundreds of rows, most
  // imported from public registries with no photo of their own), and a
  // visitor comparing vendors reads a blank tile as "nothing here" long before
  // they'd read it as "hasn't uploaded one yet". The row still exists — a
  // vendor who adds a photo appears on their next visit with no other change.
  const reviewCounts = getReviewCountsMap();
  const cards = base
    .filter((b) => b.hero_image_url)
    // `assembleDirectoryBase` deliberately leaves claimed listings unscoped
    // by country (see its own comment) so a verified vendor stays findable
    // in the couple's cross-border in-app directory. The public *browser*'s
    // country filter means something narrower, "businesses located here",
    // so a claimed listing outside the picked country has to be dropped
    // here rather than upstream, or a Hungary filter leaks every claimed
    // Austrian/Slovak/Croatian venue onto the grid and the town map.
    .filter((b) => !country || b.country === country)
    .map((b) => withVotes(b, scores, null, completeIds, EMPTY_IDS, reviewCounts));

  // Free-text match over the fields a visitor would type: the business name and
  // the town. Folded so "Fotó" finds "foto" and vice versa.
  const q = qParam ? foldForSearch(qParam) : "";
  const cityFolded = cityParam ? foldForSearch(cityParam) : "";
  // Typed to the BASE shape, not the vote-overlaid `DirectorySupplier`, so the
  // country-pin loop below can reuse it against a second, country-unscoped
  // assembly without mapping through `withVotes` first.
  const matchesText = (s: DirectorySupplierBase) =>
    !q || foldForSearch(s.name).includes(q) || foldForSearch(s.city).includes(q);
  const matchesCity = (s: DirectorySupplierBase) =>
    !cityFolded || foldForSearch(s.city) === cityFolded;

  // Facets are counted against the OTHER active filters, so picking a category
  // never leaves a city chip that returns nothing (and vice versa).
  const categoryCounts = new Map<SupplierCategory, number>();
  for (const s of cards) {
    if (!matchesCity(s) || !matchesText(s)) continue;
    categoryCounts.set(s.category, (categoryCounts.get(s.category) ?? 0) + 1);
  }
  const cityCounts = new Map<string, number>();
  // Mean of that town's own placed listings, same idiom as the showcase's
  // `nearby_origin` — feeds the "explore by town" map, not the count-only
  // chips this map used to be the whole of.
  const cityCoordSum = new Map<string, { lat: number; lng: number; n: number }>();
  // First-seen wins: a city name is one country's in practice (every non-HU
  // curated batch suffixes its towns with ", XX", so a bare name is HU by
  // construction). Lets the client auto-set the country filter — and scope
  // the map — the moment a town is picked, instead of asking the visitor to
  // also pick the country themselves.
  const cityCountryOf = new Map<string, string>();
  for (const s of cards) {
    // A handful of curated entries (nationwide food trucks, mobile services)
    // carry the bare country name as their `city` — the least-wrong value
    // available when the business genuinely has no fixed town. That is a
    // fact worth keeping on the CARD, but it is not a town anyone can pick
    // from a list, so it never becomes a facet: offering "Magyarország" as a
    // town filter option promises a level of specificity that pick doesn't
    // have.
    if (
      !s.city.trim() ||
      s.city === countryName(s.country, "hu") ||
      s.city === countryName(s.country, "en")
    )
      continue;
    cityCounts.set(s.city, (cityCounts.get(s.city) ?? 0) + 1);
    if (!cityCountryOf.has(s.city)) cityCountryOf.set(s.city, s.country);
    if (s.lat != null && s.lng != null) {
      const acc = cityCoordSum.get(s.city) ?? { lat: 0, lng: 0, n: 0 };
      acc.lat += s.lat;
      acc.lng += s.lng;
      acc.n += 1;
      cityCoordSum.set(s.city, acc);
    }
  }
  const countryCounts = new Map<string, number>();
  for (const s of assembleDirectoryBase({ category: null, country: null })) {
    if (!s.hero_image_url) continue;
    countryCounts.set(s.country, (countryCounts.get(s.country) ?? 0) + 1);
  }
  // Mean per COUNTRY, so the map can collapse to one pin per country when no
  // country is picked yet, instead of every town in the catalogue at once.
  // Deliberately built off a country-UNSCOPED assembly, same reason as
  // `countryCounts` above rather than the already-scoped `cards`: once a
  // visitor has drilled into one country, `cards` only has that one left in
  // it, and a facet that can only ever show the one country already picked
  // is useless for the "zoom back out" pin. Category and the text query still
  // apply, matching `cities`, so a category filter shrinks it like it shrinks
  // the town facet.
  const countryPinCounts = new Map<string, number>();
  const countryPinCoordSum = new Map<string, { lat: number; lng: number; n: number }>();
  const worldCards = country
    ? assembleDirectoryBase({ category: null, country: null }).filter((b) => b.hero_image_url)
    : cards;
  for (const s of worldCards) {
    if (category && s.category !== category) continue;
    if (!matchesText(s)) continue;
    countryPinCounts.set(s.country, (countryPinCounts.get(s.country) ?? 0) + 1);
    if (s.lat != null && s.lng != null) {
      const acc = countryPinCoordSum.get(s.country) ?? { lat: 0, lng: 0, n: 0 };
      acc.lat += s.lat;
      acc.lng += s.lng;
      acc.n += 1;
      countryPinCoordSum.set(s.country, acc);
    }
  }

  const filtered = cards
    .filter((s) => (!category || s.category === category) && matchesCity(s) && matchesText(s))
    .sort(publicBrowseRank);

  // ── The "thin town" rescue, same idea as the showcase teaser's
  // NEARBY_TRIGGER (see its own comment) but scoped to the ACTIVE category: a
  // visitor who filtered "venues in Veszprém" down to nothing does not hit a
  // dead end, they get the honest few in town plus every venue within an
  // hour's drive, distance-stamped. Only fires with a category picked (a bare
  // city browse already has plenty to show, and "nearby venues" answers a
  // question nobody asked when no category was chosen) and a city typed.
  //
  // The origin is measured across EVERY category matching the town, not just
  // the (possibly empty) category+city filter: a town with zero venues can
  // still anchor the search off its restaurants and florists, which is what
  // lets this fire even when `filtered.length` is 0, unlike the showcase
  // teaser's `total > 0` guard (that endpoint has no single active category
  // to fall back on).
  const nearby: (DirectorySupplier & { distance_km: number })[] = [];
  let nearbyOrigin: string | null = null;
  if (category && cityFolded && filtered.length <= NEARBY_TRIGGER) {
    const origin = originOf(cards.filter(matchesCity));
    if (origin) {
      const shown = new Set(filtered.map((s) => s.id));
      const withDistance = cards
        .filter(
          (s) => s.category === category && !shown.has(s.id) && s.lat != null && s.lng != null,
        )
        .map((s) => ({
          row: s,
          km: haversineKm(origin.lat, origin.lng, s.lat as number, s.lng as number),
        }))
        .filter((x) => x.km <= NEARBY_RADIUS_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, NEARBY_MAX);
      for (const { row, km } of withDistance) {
        // Rounded to the kilometre, same as the showcase teaser: these are
        // straight-line distances between town centroids, and a decimal
        // would claim a precision we don't have.
        nearby.push({ ...row, distance_km: Math.max(1, Math.round(km)) });
      }
      if (nearby.length > 0) nearbyOrigin = cityParam;
    }
  }

  const payload: PublicDirectoryPage = {
    vendors: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
    categories: [...categoryCounts.entries()]
      .map(([c, count]) => ({ category: c, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    cities: [...cityCounts.entries()]
      .map(([city, count]) => {
        const coord = cityCoordSum.get(city);
        return {
          city,
          count,
          lat: coord ? coord.lat / coord.n : null,
          lng: coord ? coord.lng / coord.n : null,
          // Always set — every row that reached cityCounts passed through the
          // loop above, which stamps this before the count.
          country: cityCountryOf.get(city) as string,
        };
      })
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
      // Was capped at 60, which silently dropped every smaller town from the
      // town picker AND the map — findable only by typing its name straight
      // into the ?city= URL. That cap made sense while the picker was a plain
      // scrollable list; now that it's searchable, a town with a couple of
      // vendors deserves to be selectable too. ~750 distinct towns exist across
      // the whole directory at time of writing, so this comfortably covers the
      // real (already filtered, per-category/-country) list without being
      // unbounded against a pathological future.
      .slice(0, 500),
    countries: [...countryCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    country_pins: [...countryPinCounts.entries()]
      .map(([code, count]) => {
        const coord = countryPinCoordSum.get(code);
        return {
          code,
          count,
          lat: coord ? coord.lat / coord.n : null,
          lng: coord ? coord.lng / coord.n : null,
        };
      })
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    nearby,
    nearby_origin: nearbyOrigin,
  };
  return json(payload);
}

/** GET /api/public/vendor-showcase — the unauthenticated "browse teaser".
 *  Returns a photos-only sample of the directory, capped per category, so a
 *  visitor sees real vendors and then registers to unlock the full directory.
 *  Claimed Weddly vendors lead each category (real signups), then curated
 *  businesses fill the rest. Distinct path (not `/api/public/vendors/...`) so
 *  it never collides with the `:supplier_id` param route. Rate-limited per IP.
 */
const SHOWCASE_PER_CATEGORY = 6;
// Lead with the visual, high-intent categories; the rest follow. Only
// categories with at least one photographed vendor are emitted. A category
// MISSING from this list is invisible on the teaser however many vendors it
// has, so every slug in SupplierCategory except the legacy `other` belongs
// here (`celebrant` was left out when it split off mc_celebrant, and stayed
// dark until this list caught up).
const SHOWCASE_CATEGORY_ORDER: SupplierCategory[] = [
  "venue",
  "photography",
  "videography",
  "content_creator",
  "photo_booth",
  "wedding_decor",
  "florist",
  "catering",
  "cake_dessert",
  "food_trucks",
  "dj",
  "live_music",
  "hair_makeup",
  "bridal_boutique",
  "suit_formal",
  "entertainment",
  "mc_celebrant",
  "celebrant",
  "dance_lessons",
  "lighting",
  "bar_drinks",
  "accommodation",
  "tent_pavilion",
  "sound_tech",
  "nails",
  "wedding_jewelry",
  "invitation_graphics",
  "rental_equipment",
  "transport",
  "wedding_planner",
];
// ── The "nearly empty town" rescue ────────────────────────────────────────
// Filtering to a small town regularly leaves one card on the page, which reads
// as "Weddly has nothing here" when the truth is "Weddly has 40 of these an
// hour up the road". Below the trigger we keep the town's own results exactly
// as they are and APPEND everything within the radius, distance-stamped, so
// the visitor can judge "35 km" for themselves rather than being handed an
// empty page.
//
// Only fires behind a `?city=` filter: without one the sample is already the
// whole catalogue and there is no origin to measure from.
/** At or below this many in-town cards the page can't stand on its own. */
const NEARBY_TRIGGER = 3;
/** Driving-distance sanity, not a hard geography rule: past this a vendor is a
 *  different region's vendor, and offering them reads as padding. */
const NEARBY_RADIUS_KM = 70;
/** Total nearby cards. Enough to fill several rails, few enough that the town's
 *  own results stay the headline. */
const NEARBY_MAX = 18;
/** Per category, so one dense category (venues) can't eat the whole block. */
const NEARBY_PER_CATEGORY = 4;

/** Mean coordinate of the listings that matched the town filter, which is the
 *  town itself to within a few hundred metres and needs no gazetteer. Falls
 *  back to the whole-country pool's match on the same folded name, so a town
 *  whose only listing lacks coords can still anchor. Null when nothing in the
 *  town has been geocoded at all — then there is no nearby block, rather than
 *  a block measured from the wrong place. Generic over the row shape so both
 *  the showcase teaser (`ShowcaseVendorRow`) and the full public directory
 *  (`DirectorySupplier`) share this one implementation. */
function originOf<T extends { lat: number | null; lng: number | null }>(
  rows: T[],
): { lat: number; lng: number } | null {
  const placed = rows.filter((r) => r.lat != null && r.lng != null);
  if (placed.length === 0) return null;
  const lat = placed.reduce((n, r) => n + (r.lat as number), 0) / placed.length;
  const lng = placed.reduce((n, r) => n + (r.lng as number), 0) / placed.length;
  return { lat, lng };
}

function handlePublicShowcase(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "public.showcase", { capacity: 60, refillRate: 1 });
  // `?country=XX` scopes the sample to one country (the chip row). Absent or
  // malformed means the full catalogue — the teaser's default is "everything",
  // and the visitor's own country only changes the ORDER (below).
  const countryParam = ctx.url.searchParams.get("country");
  const requestedCountry =
    countryParam && /^[A-Za-z]{2}$/.test(countryParam) ? countryParam.toUpperCase() : null;
  // Null whenever the MaxMind DB isn't present, so the whole feature degrades
  // to the previous claimed-first ordering rather than erroring.
  const viewerCountry = lookupCountry(ctx.clientIp);
  const preferCountry = requestedCountry ?? viewerCountry;

  const candidates = listShowcaseCandidates();
  // Solid-vs-hollow check per card, resolved once for the whole page. Only the
  // registered vendors are asked: everything else in the sample is a curated or
  // community row that wears no badge at all.
  const completeIds = completeListingIds(candidates.filter((r) => r.verified).map((r) => r.id));

  // Chips are counted over the WHOLE eligible set, before the country filter,
  // so picking a country never removes the way back to the others.
  const counts = new Map<string, number>();
  for (const r of candidates) counts.set(r.country, (counts.get(r.country) ?? 0) + 1);
  const countries: SupplierCountryCount[] = [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  // `?city=` scopes the sample to one town — where a city pick from the public
  // typeahead lands. Matched on the folded display name so "Wien" finds the
  // curated "Wien, AT" rows and accents don't have to survive a URL. The param
  // itself goes through `cityDisplayName` too: the browse page's OWN city
  // picker (`/api/public/vendors`'s `cities` facet) hands back the RAW stored
  // value, suffix included, and round-trips it straight into this `?city=` —
  // so a visitor who picked "Wien, AT" from the page's own dropdown matched
  // nothing here even though the directory has dozens of Vienna listings,
  // every non-HU market bore the same bug, and the whole page rendered as a
  // dead end (see VendorBrowsePage's empty-state funnel, added the same day).
  const cityParam = ctx.url.searchParams.get("city");
  const requestedCity = cityParam?.trim() ? foldForSearch(cityDisplayName(cityParam)) : null;

  const countryPool = requestedCountry
    ? candidates.filter((r) => r.country === requestedCountry)
    : candidates;
  const pool = requestedCity
    ? countryPool.filter((r) => foldForSearch(cityDisplayName(r.city)) === requestedCity)
    : countryPool;
  // Rank: the preferred country, then registered Weddly vendors, then how the
  // outside world rates them (Google Places, null = unrated and sorted last),
  // then newest. Each tier only breaks ties inside the one above it.
  const ranked = [...pool].sort((a, b) => {
    const aHome = preferCountry && a.country === preferCountry ? 1 : 0;
    const bHome = preferCountry && b.country === preferCountry ? 1 : 0;
    if (aHome !== bHome) return bHome - aHome;
    const aClaimed = a.verified ? 1 : 0;
    const bClaimed = b.verified ? 1 : 0;
    if (aClaimed !== bClaimed) return bClaimed - aClaimed;
    const aRated = a.google_rating ?? -1;
    const bRated = b.google_rating ?? -1;
    if (aRated !== bRated) return bRated - aRated;
    return b.created_at - a.created_at;
  });

  const byCat = new Map<SupplierCategory, PublicShowcaseVendor[]>();
  for (const r of ranked) {
    const list = byCat.get(r.category) ?? [];
    if (list.length >= SHOWCASE_PER_CATEGORY) continue;
    list.push({
      id: r.id,
      name: r.name,
      category: r.category,
      city: r.city,
      hero_image_url: r.hero_image_url,
      country: r.country,
      verified: r.verified,
      listing_complete: completeIds.has(r.id),
    });
    byCat.set(r.category, list);
  }

  const categories: PublicShowcaseCategory[] = [];
  let total = 0;
  for (const category of SHOWCASE_CATEGORY_ORDER) {
    const vendors = byCat.get(category);
    if (!vendors || vendors.length === 0) continue;
    categories.push({ category, vendors });
    total += vendors.length;
  }

  // A town that came back nearly empty gets the surrounding region appended.
  // Measured from the matched listings themselves, ranked by distance, and
  // capped per category so the block reads as a directory rather than a list
  // of the one thing that happens to be dense nearby.
  const nearby: PublicShowcaseCategory[] = [];
  let nearbyOrigin: string | null = null;
  if (requestedCity && total > 0 && total <= NEARBY_TRIGGER) {
    const origin = originOf(pool);
    if (origin) {
      const shown = new Set(pool.map((r) => r.id));
      // Country pool, not the global one: the whole point is a drive away, and
      // the radius already keeps it tight. Staying inside the active country
      // filter also means the chip row and this block never disagree.
      const withDistance = countryPool
        .filter((r) => !shown.has(r.id) && r.lat != null && r.lng != null)
        .map((r) => ({
          row: r,
          km: haversineKm(origin.lat, origin.lng, r.lat as number, r.lng as number),
        }))
        .filter((x) => x.km <= NEARBY_RADIUS_KM)
        .sort((a, b) => a.km - b.km);

      const nearByCat = new Map<SupplierCategory, PublicShowcaseVendor[]>();
      let taken = 0;
      for (const { row, km } of withDistance) {
        if (taken >= NEARBY_MAX) break;
        const list = nearByCat.get(row.category) ?? [];
        if (list.length >= NEARBY_PER_CATEGORY) continue;
        list.push({
          id: row.id,
          name: row.name,
          category: row.category,
          // Raw, exactly like the main block: a curated ", AT" suffix is real
          // context, and stripping it in one block and not the other would read
          // as a bug on a page that shows both.
          city: row.city,
          hero_image_url: row.hero_image_url,
          country: row.country,
          verified: row.verified,
          listing_complete: completeIds.has(row.id),
          // Rounded to the kilometre: these are straight-line distances between
          // town centroids, and a decimal would claim a precision we don't have.
          distance_km: Math.max(1, Math.round(km)),
        });
        nearByCat.set(row.category, list);
        taken++;
      }
      // Same category order as the main block, so the two read as one page.
      for (const category of SHOWCASE_CATEGORY_ORDER) {
        const vendors = nearByCat.get(category);
        if (!vendors || vendors.length === 0) continue;
        nearby.push({ category, vendors });
      }
      // Origin only when there is actually a block to measure — the frontend
      // uses it to name the town in the heading, so a stray value with no
      // section under it would be worse than null.
      if (nearby.length > 0) nearbyOrigin = cityParam?.trim() ?? null;
    }
  }

  const payload: PublicVendorShowcase = {
    categories,
    total,
    countries,
    viewer_country: viewerCountry,
    nearby,
    nearby_origin: nearbyOrigin,
  };
  // Private: the body now varies by the caller's IP country, so a shared cache
  // could serve one visitor's ordering to another country's visitor.
  return json(payload, { headers: { "Cache-Control": "private, max-age=120" } });
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
  // `base.id`, not the URL's: a click arriving on the pretty form would
  // otherwise bank the event under an id `viewCountsForListings` never asks
  // about, so the vendor's own share link would report no demand at all.
  recordSupplierEventsSafe(
    [{ supplier_id: base.id, type: "website_click" }],
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

/** GET /api/suppliers/name-check?name= — public. Live "is this supplier already
 *  on Weddly?" lookup for the recommend form. Searches the full directory
 *  (curated + active community + claimed vendors) by case-insensitive name
 *  overlap and returns up to 6 lightweight matches so the submitter can jump to
 *  the existing listing instead of filing a duplicate. */
function handleNameCheck(ctx: Ctx): Response {
  const q = (ctx.url.searchParams.get("name") ?? "").trim().toLowerCase();
  if (q.length < 3) return json({ matches: [] });
  const overrides = curatedOverrideMap();
  const curated = overrides.size > 0 ? DIRECTORY.filter((s) => !overrides.has(s.id)) : DIRECTORY;
  const community = listActiveCommunitySuppliers(null).map(toDirectorySupplierBase);
  const seen = new Set<string>([...curated, ...community].map((b) => b.id));
  const claimed = listActiveClaimedListingsForDirectory(null).filter((c) => !seen.has(c.id));
  const all: DirectorySupplierBase[] = [...curated, ...community, ...claimed];
  const matches = all
    .filter((b) => {
      const n = b.name.toLowerCase();
      // Match either direction so "Anna" finds "Anna's Photography" and a
      // pasted full name finds a shorter listing, but never let a 1-2 char
      // listing name swallow every query.
      return n.includes(q) || (n.length >= 3 && q.includes(n));
    })
    .slice(0, 6)
    .map((b) => ({ id: b.id, name: b.name, city: b.city, category: b.category }));
  return json({ matches });
}

/** GET /api/public/vendor-search?q= — the public typeahead. Vendor + city hits
 *  (max `VENDOR_SEARCH_LIMIT`) plus the category census the client scores in
 *  its own language. Fires per keystroke behind a client debounce, so the
 *  bucket is roomier than the other public routes but still bounded. */
function handlePublicSearch(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "public.vendorSearch", { capacity: 90, refillRate: 3 });
  const q = ctx.url.searchParams.get("q") ?? "";
  // A pasted paragraph can't match anything useful and would fold char by char
  // over every listing; cut it at a length no business name reaches.
  return json(searchPublicVendors(q.slice(0, 80)));
}

export function registerSupplierRoutes(router: Router) {
  router.get("/api/suppliers", handleList);
  // Registered before the `:supplier_id` route so neither of these is parsed as
  // a supplier id.
  router.get("/api/suppliers/name-check", handleNameCheck);
  router.get("/api/suppliers/unavailable", handleUnavailable);
  router.get("/api/suppliers/:supplier_id/contact", handleContact, true);
  router.get("/api/suppliers/:supplier_id", handleDetail, true);
  // Public, unauthenticated vendor page payload (the shareable surface).
  router.get("/api/public/vendors/:supplier_id", handlePublicDetail);
  // Public "browse teaser" — photos-only directory sample, capped per category.
  router.get("/api/public/vendors", handlePublicDirectory);
  router.get("/api/public/vendor-showcase", handlePublicShowcase);
  // Public typeahead over vendor names + cities (categories are client-side).
  router.get("/api/public/vendor-search", handlePublicSearch);
  router.post("/api/suppliers/events", handleRecordEvents);
  router.put("/api/suppliers/:supplier_id/vote", handleVote, true);
  router.get("/r/supplier/:supplier_id", handleRedirect);
  // Silence the unused-import warning for VALID_CATEGORIES; it's left here
  // so a future "validate cat param" path is one line away.
  void VALID_CATEGORIES;
}
