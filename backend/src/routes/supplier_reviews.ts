// Reviews on a supplier detail page. Phase 3 (verified reviews): couples with
// ENGAGEMENT PROOF — the supplier appears in their cost plan
// (couple_supplier_costs) or is their category pick (couple_picks) — can post
// a review that goes live immediately; that gate is what makes a couple
// review "verified" (the TripAdvisor anyone-can-rate problem never opens).
// Admins keep the editorial voice (draft/publish control, edit/delete on any
// row). The partial unique index on (supplier_id, couple_id) WHERE couple_id
// IS NOT NULL enforces "one review per couple per supplier".

import { type Currency, isCurrency } from "@shared/currency";
import type { CreateReviewBody, SupplierReview } from "@shared/suppliers";
import {
  normaliseReviewTags,
  REVIEW_AMOUNT_MAX,
  REVIEW_AMOUNT_NOTE_MAX_CHARS,
  REVIEW_BODY_MAX_CHARS,
} from "@shared/suppliers";
import { plannerReviewSubjectId } from "@shared/planner_reviews";
import { canonicalListingId } from "@shared/vendor_slug";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
import { db, getVisitorSystemUserId } from "../db";
import { getCoupleForUser } from "../domain/couples";
import {
  createReview,
  getReviewById,
  listReviewsForSupplier,
  getReviewSummary,
  type ReviewAuthorKind,
  softDeleteReview,
  updateReview,
} from "../domain/reviews";
import { plannerAccountExists, plannerHasClientLink } from "../domain/planner_reviews";
import { getUserByEmail, getUserById, viewerIsAdmin } from "../domain/users";
import { requireVerifiedVisitor } from "../domain/verified_visitors";

/** What a review is ABOUT. `supplier_reviews.supplier_id` is bare TEXT with no
 *  FK, which is exactly what lets a second kind of subject share this whole
 *  stack: the aggregate, the tags, the histogram, the admin flagged queue,
 *  edit and delete all key on that string and never ask what it points at.
 *
 *  So a subject is just its id plus the one rule that genuinely differs
 *  between kinds — what counts as having worked together. Everything below
 *  this line is written once and serves both. */
interface ReviewSubject {
  id: string;
  /** Engagement proof → the "Verified" badge, and with it the path where a low
   *  rating is NOT auto-flagged. */
  hasProof: (coupleId: number) => boolean;
}

type SubjectResolver = (ctx: Ctx) => ReviewSubject;

/** Engagement proof: the couple actually worked with (or committed to) this
 *  supplier — it's in their cost plan or is their category pick. This is the
 *  whole "verified review" gate, so keep it in one place. */
function hasEngagementProof(coupleId: number, supplierId: string): boolean {
  const row = db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM couple_supplier_costs WHERE couple_id = ? AND supplier_id = ?
       ) OR EXISTS(
         SELECT 1 FROM couple_picks WHERE couple_id = ? AND supplier_id = ?
       ) AS ok`,
    )
    .get(coupleId, supplierId, coupleId, supplierId) as { ok: number };
  return row.ok === 1;
}

function coupleAlreadyReviewed(coupleId: number, supplierId: string): boolean {
  const row = db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM supplier_reviews
          WHERE couple_id = ? AND supplier_id = ? AND deleted_at IS NULL
       ) AS ok`,
    )
    .get(coupleId, supplierId) as { ok: number };
  return row.ok === 1;
}

/** A logged-in user (couple or no-couple) already has a live review here. Keys
 *  on author_user_id, so it catches both the couple path and the no-couple
 *  `user` path (which dedup on the same column via idx_supplier_reviews_user_unique). */
function userAlreadyReviewed(userId: number, supplierId: string): boolean {
  const row = db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM supplier_reviews
          WHERE author_user_id = ? AND supplier_id = ?
            AND author_kind IN ('user', 'couple') AND deleted_at IS NULL
       ) AS ok`,
    )
    .get(userId, supplierId) as { ok: number };
  return row.ok === 1;
}

function parseRating(raw: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new HttpError(400, "rating must be an integer 1-5");
  }
  return n as 1 | 2 | 3 | 4 | 5;
}

function parseBody(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") throw new HttpError(400, "body must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > REVIEW_BODY_MAX_CHARS) {
    throw new HttpError(400, `body too long (max ${REVIEW_BODY_MAX_CHARS} chars)`);
  }
  return trimmed;
}

function parseTags(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, "tags must be an array");
  // Known vocabulary passes through; a free-text ("+1") tag is accepted when it
  // clears the shape guard, else 400 so the composer can flag it. Dedups + caps.
  return normaliseReviewTags(raw, (entry) => {
    throw new HttpError(400, `invalid tag: ${String(entry)}`);
  });
}

/** Optional paid amount → a whole-unit integer, or null when not shared. 0 and
 *  blank both read as "not shared" so an untouched field never stores a 0. */
function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(400, "amount_paid must be a number");
  const int = Math.trunc(n);
  if (int < 0) throw new HttpError(400, "amount_paid must be >= 0");
  if (int > REVIEW_AMOUNT_MAX) throw new HttpError(400, "amount_paid too large");
  return int === 0 ? null : int;
}

/** Optional "what you got for the price" caption → trimmed string or null. */
function parseAmountNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "amount_note must be a string");
  const trimmed = raw.replace(/\s+/gu, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length > REVIEW_AMOUNT_NOTE_MAX_CHARS) {
    throw new HttpError(400, `amount_note too long (max ${REVIEW_AMOUNT_NOTE_MAX_CHARS} chars)`);
  }
  return trimmed;
}

/** Currency to store alongside a shared amount: the client's if valid, else a
 *  neutral EUR fallback. Null when there's no amount (the currency is moot). */
function resolveAmountCurrency(amount: number | null, raw: unknown): Currency | null {
  if (amount === null) return null;
  return isCurrency(raw) ? raw : "EUR";
}

/** The supplier id from the path, CANONICALISED. The single place this route
 *  learns which supplier it is talking about.
 *
 *  `supplier_reviews.supplier_id` is a bare TEXT column with no FK, so whatever
 *  string arrives becomes the key forever. That matters because the pretty
 *  share form is what every "collect reviews" link carries: `VendorShareDialog`
 *  and `VendorReviewsPage` both build `/vendors/{name}-v12`, and the vendor's
 *  past client rates them from exactly there. Keyed raw, that review lands on
 *  `"magyar-foto-v12"` while the listing is `"v12"`: invisible to the vendor's
 *  own reviews page, to the aggregate, to the admin counters and to Weddly
 *  Points, yet visible on the page it was written from, which is what makes it
 *  so hard to notice.
 *
 *  Deliberately NOT an existence check: a review may legitimately be keyed to a
 *  curated slug that lives in code rather than in `listings`, and 404-ing an
 *  unknown id here would be a wider behavioural change than this bug needs. */
function pathSupplierId(ctx: Ctx): string {
  const raw = ctx.params.supplier_id?.trim();
  if (!raw) throw new HttpError(400, "supplier_id required");
  if (raw.length > 80) throw new HttpError(400, "supplier_id too long");
  return canonicalListingId(raw) ?? raw;
}

const supplierSubject: SubjectResolver = (ctx) => {
  const id = pathSupplierId(ctx);
  return { id, hasProof: (coupleId) => hasEngagementProof(coupleId, id) };
};

/** A planner subject. Unlike a supplier id this IS existence-checked: a planner
 *  id is a `users` row rather than a slug that may live in code, so an unknown
 *  one would otherwise seed an aggregate for a profile nobody can open. */
const plannerSubject: SubjectResolver = (ctx) => {
  const plannerUserId = Number.parseInt(ctx.params.planner_user_id ?? "", 10);
  if (!Number.isInteger(plannerUserId) || plannerUserId < 1) {
    throw new HttpError(400, "planner_user_id required");
  }
  if (!plannerAccountExists(plannerUserId)) throw new HttpError(404, "Planner not found");
  return {
    id: plannerReviewSubjectId(plannerUserId),
    hasProof: (coupleId) => plannerHasClientLink(plannerUserId, coupleId),
  };
};

async function handleList(ctx: Ctx, subject: ReviewSubject): Promise<Response> {
  // Reads are open to any authed viewer now that the detail page serves
  // couples. Admins see every review (including unpublished drafts) for
  // moderation; couples see only published rows.
  const { userId, isAdmin } = viewerIsAdmin(ctx);
  const supplierId = subject.id;

  const cursorRaw = ctx.url.searchParams.get("cursor");
  const cursor = cursorRaw ? Number.parseInt(cursorRaw, 10) : null;
  const limitRaw = ctx.url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;

  const page = listReviewsForSupplier(supplierId, {
    limit: Number.isFinite(limit) ? limit : 20,
    cursor: cursor !== null && Number.isFinite(cursor) ? cursor : null,
    includeUnpublished: isAdmin,
    viewerUserId: userId,
  });
  const summary = getReviewSummary(supplierId);

  // Composer eligibility: reviews are open to any logged-in user with a verified
  // email who hasn't already reviewed this supplier (as a couple or as
  // themselves). Admins always may. Engagement proof is no longer required.
  const couple = getCoupleForUser(userId);
  const already =
    (couple ? coupleAlreadyReviewed(couple.id, supplierId) : false) ||
    userAlreadyReviewed(userId, supplierId);
  const user = getUserById(userId);
  const can_review = isAdmin || (!!user && Boolean(user.verified_email) && !already);

  return json({
    items: page.items,
    nextCursor: page.nextCursor,
    summary,
    can_review,
    already_reviewed: already,
  });
}

async function handleCreate(ctx: Ctx, subject: ReviewSubject): Promise<Response> {
  const { userId, isAdmin } = viewerIsAdmin(ctx);
  rateLimit(`user:${userId}`, "supplier_reviews.create", {
    capacity: 20,
    refillRate: 1,
  });

  const supplierId = subject.id;

  const body = await readJson<Partial<CreateReviewBody>>(ctx.req);
  const rating = parseRating(body.rating);
  const reviewBody = parseBody(body.body);
  const tags = parseTags(body.tags);
  const amountPaid = parseAmount(body.amount_paid);
  const amountCurrency = resolveAmountCurrency(amountPaid, body.amount_currency);
  const amountNote = parseAmountNote(body.amount_note);

  let coupleId: number | null;
  let authorKind: ReviewAuthorKind;
  let published: boolean;
  let verified: boolean;
  let flagged: boolean;
  // An admin is also a person, and being staff shouldn't mean every supplier
  // they ever hire gets reviewed in the editorial voice. The editorial voice is
  // therefore OPT-IN (`as_editorial: true`); everything else drops into the
  // ordinary path (own name, live immediately, verified only with engagement
  // proof).
  //
  // It used to be opt-OUT, and that was a trap: `as_editorial !== false` meant
  // any caller that simply omitted the field (`RateVendorsPage`'s one-tap star,
  // any future client) turned an admin's ordinary 5 stars into "Weddly editors"
  // AND, via the draft default below, into an unpublished row. Since `published`
  // gates the supplier list, the aggregate, the admin counters and the vendor's
  // own /vendor/reviews page all at once, the review existed and was visible to
  // nobody but its admin author. Opt-in makes the safe case the default one.
  const asEditorial = isAdmin && body.as_editorial === true;
  if (asEditorial) {
    // Editorial voice: couple_id stays null ("Weddly editors"), draft/publish
    // is the admin's call. Never verified-badged, never auto-flagged.
    coupleId = null;
    authorKind = "admin";
    // Live unless explicitly drafted. A draft has no queue anywhere in admin
    // (`listFlaggedReviews` filters `flagged = 1`, not `published = 0`), so a
    // draft nobody asked for is a review that silently never surfaces.
    published = typeof body.published === "boolean" ? body.published : true;
    verified = false;
    flagged = false;
  } else {
    // Open reviews: any logged-in user with a verified email may rate. A couple
    // that actually worked with this supplier (cost plan / category pick) still
    // earns the "Verified" badge; everyone else posts an unverified community
    // review that goes live immediately but is flagged for moderation when it's
    // a low (1-2 star) rating.
    const user = getUserById(userId);
    if (!user || !user.verified_email) {
      throw new HttpError(403, "Verify your email before writing a review", {
        code: "email_unverified",
      });
    }
    const couple = getCoupleForUser(userId);
    if (couple) {
      coupleId = couple.id;
      authorKind = "couple";
      verified = subject.hasProof(couple.id);
      flagged = !verified && rating <= 2;
    } else {
      coupleId = null;
      authorKind = "user";
      verified = false;
      flagged = rating <= 2;
    }
    published = true;
  }

  let review: SupplierReview;
  try {
    review = createReview({
      supplierId,
      authorUserId: userId,
      coupleId,
      authorKind,
      visitorId: null,
      rating,
      body: reviewBody,
      tags,
      amountPaid,
      amountCurrency,
      amountNote,
      published,
      verified,
      flagged,
    });
  } catch (e: unknown) {
    // Partial unique-index violation on (supplier_id, couple_id) → the
    // couple already has a review for this supplier. 409 surfaces the
    // conflict so the frontend can offer an "edit your existing review" CTA.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("unique")) {
      throw new HttpError(409, "Already reviewed this supplier", {
        code: "already_reviewed",
      });
    }
    throw e;
  }

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "supplier_review.created",
    target_kind: "supplier_review",
    target_id: review.id,
    after: {
      supplier_id: supplierId,
      rating,
      published,
      verified,
      flagged,
      author_kind: authorKind,
    },
  });
  return json(review, { status: 201 });
}

/** Public composer for an email-verified visitor (no account). The visitor
 *  proves their email once (Google or the email link, domain/verified_visitors)
 *  and replays the device token on X-Visitor-Token. Review goes live
 *  immediately; a 1-2 star rating is flagged for admin moderation. Deduped to
 *  one review per visitor per supplier by idx_supplier_reviews_visitor_unique. */
async function handleVisitorCreate(ctx: Ctx, subject: ReviewSubject): Promise<Response> {
  const visitor = requireVerifiedVisitor(ctx);
  // Anonymous principal — rate-limit both the IP and the attested identity
  // (the stronger key; shared NAT weakens IP-only limits).
  rateLimit(ctx.clientIp, "visitor_review.create.ip", { capacity: 5, refillRate: 1 / 60 });
  rateLimit(`visitor:${visitor.id}`, "visitor_review.create", { capacity: 5, refillRate: 1 / 300 });

  const supplierId = subject.id;

  const body = await readJson<Partial<CreateReviewBody>>(ctx.req);
  const rating = parseRating(body.rating);
  const reviewBody = parseBody(body.body);
  const tags = parseTags(body.tags);
  const amountPaid = parseAmount(body.amount_paid);
  const amountCurrency = resolveAmountCurrency(amountPaid, body.amount_currency);
  const amountNote = parseAmountNote(body.amount_note);

  // Same-person guard: if a Weddly account with this exact email already
  // reviewed this supplier, don't let the visitor path post a second one.
  const account = getUserByEmail(visitor.email);
  if (account && userAlreadyReviewed(account.id, supplierId)) {
    throw new HttpError(409, "Already reviewed this supplier", { code: "already_reviewed" });
  }

  const flagged = rating <= 2;
  let review: SupplierReview;
  try {
    review = createReview({
      supplierId,
      authorUserId: getVisitorSystemUserId(),
      coupleId: null,
      authorKind: "visitor",
      visitorId: visitor.id,
      rating,
      body: reviewBody,
      tags,
      amountPaid,
      amountCurrency,
      amountNote,
      published: true,
      verified: false,
      flagged,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("unique")) {
      throw new HttpError(409, "Already reviewed this supplier", { code: "already_reviewed" });
    }
    throw e;
  }

  addAuditLog({
    actor_user_id: null,
    couple_id: null,
    action: "supplier_review.created_visitor",
    target_kind: "supplier_review",
    target_id: review.id,
    after: { supplier_id: supplierId, rating, flagged, visitor_id: visitor.id },
  });
  return json(review, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const { userId, isAdmin } = viewerIsAdmin(ctx);
  const reviewId = Number.parseInt(ctx.params.review_id ?? "", 10);
  if (!Number.isInteger(reviewId)) throw new HttpError(400, "review_id required");
  const existing = getReviewById(reviewId);
  if (!existing) throw new HttpError(404, "Review not found");
  if (!isAdmin && existing.author_user_id !== userId) {
    throw new HttpError(403, "You can only edit your own review");
  }

  const body = await readJson<Partial<CreateReviewBody>>(ctx.req);
  const patch: Parameters<typeof updateReview>[2] = {};
  if (body.rating !== undefined) patch.rating = parseRating(body.rating);
  if (body.body !== undefined) patch.body = parseBody(body.body);
  if (body.tags !== undefined) patch.tags = parseTags(body.tags);
  if (body.amount_paid !== undefined) {
    const amt = parseAmount(body.amount_paid);
    patch.amountPaid = amt;
    // Clearing the amount clears its currency; setting it (re)resolves one.
    patch.amountCurrency = resolveAmountCurrency(amt, body.amount_currency);
  }
  if (body.amount_note !== undefined) patch.amountNote = parseAmountNote(body.amount_note);
  if (body.published !== undefined) {
    // Draft/publish is a moderation lever — couple reviews are always live.
    if (!isAdmin) throw new HttpError(403, "Only admins may change published");
    patch.published = Boolean(body.published);
  }

  const updated = updateReview(reviewId, existing.supplier_id, patch);
  if (!updated) throw new HttpError(404, "Review not found");

  addAuditLog({
    actor_user_id: userId,
    couple_id: existing.couple_id,
    action: "supplier_review.updated",
    target_kind: "supplier_review",
    target_id: reviewId,
    after: { supplier_id: existing.supplier_id, fields: Object.keys(patch) },
  });
  return json(updated);
}

async function handleDelete(ctx: Ctx): Promise<Response> {
  const { userId, isAdmin } = viewerIsAdmin(ctx);
  const reviewId = Number.parseInt(ctx.params.review_id ?? "", 10);
  if (!Number.isInteger(reviewId)) throw new HttpError(400, "review_id required");
  const existing = getReviewById(reviewId);
  if (!existing) throw new HttpError(404, "Review not found");
  if (!isAdmin && existing.author_user_id !== userId) {
    throw new HttpError(403, "You can only delete your own review");
  }
  const ok = softDeleteReview(reviewId, existing.supplier_id);
  if (!ok) throw new HttpError(404, "Review not found");
  addAuditLog({
    actor_user_id: userId,
    couple_id: existing.couple_id,
    action: "supplier_review.deleted",
    target_kind: "supplier_review",
    target_id: reviewId,
    note: `supplier_id=${existing.supplier_id}`,
  });
  return json({ ok: true });
}

/** Bind a subject-shaped handler to one resolver, so the route table reads as
 *  "this path, that subject" and the handlers stay written once. */
const withSubject =
  (resolve: SubjectResolver, handler: (ctx: Ctx, subject: ReviewSubject) => Promise<Response>) =>
  (ctx: Ctx) =>
    handler(ctx, resolve(ctx));

export function registerSupplierReviewRoutes(router: Router) {
  router.get("/api/suppliers/:supplier_id/reviews", withSubject(supplierSubject, handleList), true);
  router.post(
    "/api/suppliers/:supplier_id/reviews",
    withSubject(supplierSubject, handleCreate),
    true,
  );
  // Public: verified visitors compose here (auth is the X-Visitor-Token device
  // token, resolved inside via requireVerifiedVisitor — NOT a session).
  router.post(
    "/api/public/suppliers/:supplier_id/reviews",
    withSubject(supplierSubject, handleVisitorCreate),
  );

  // Planner accounts, same three surfaces. A planner is a review subject like
  // any other; only `plannerSubject` differs (see ReviewSubject above), which
  // is why there is no second copy of the composer, the moderation rules or
  // the aggregate here.
  router.get(
    "/api/planners/:planner_user_id/reviews",
    withSubject(plannerSubject, handleList),
    true,
  );
  router.post(
    "/api/planners/:planner_user_id/reviews",
    withSubject(plannerSubject, handleCreate),
    true,
  );
  router.post(
    "/api/public/planners/:planner_user_id/reviews",
    withSubject(plannerSubject, handleVisitorCreate),
  );

  // Edit + delete key on the review row, so they never needed a subject and
  // serve both kinds unchanged.
  router.patch("/api/reviews/:review_id", handleUpdate, true);
  router.delete("/api/reviews/:review_id", handleDelete, true);
}
