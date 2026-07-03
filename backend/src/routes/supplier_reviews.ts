// Reviews on a supplier detail page. Phase 3 (verified reviews): couples with
// ENGAGEMENT PROOF — the supplier appears in their cost plan
// (couple_supplier_costs) or is their category pick (couple_picks) — can post
// a review that goes live immediately; that gate is what makes a couple
// review "verified" (the TripAdvisor anyone-can-rate problem never opens).
// Admins keep the editorial voice (draft/publish control, edit/delete on any
// row). The partial unique index on (supplier_id, couple_id) WHERE couple_id
// IS NOT NULL enforces "one review per couple per supplier".

import type { CreateReviewBody, SupplierReview, SupplierReviewTag } from "@shared/suppliers";
import { REVIEW_BODY_MAX_CHARS, SUPPLIER_REVIEW_TAGS } from "@shared/suppliers";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
import { db } from "../db";
import { getCoupleForUser } from "../domain/couples";
import {
  createReview,
  getReviewById,
  listReviewsForSupplier,
  getReviewSummary,
  normaliseTags,
  softDeleteReview,
  updateReview,
} from "../domain/reviews";
import { viewerIsAdmin } from "../domain/users";

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

const VALID_TAG_SET: ReadonlySet<string> = new Set(SUPPLIER_REVIEW_TAGS);

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

function parseTags(raw: unknown): SupplierReviewTag[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, "tags must be an array");
  for (const t of raw) {
    if (typeof t !== "string" || !VALID_TAG_SET.has(t)) {
      throw new HttpError(400, `unknown tag: ${String(t)}`);
    }
  }
  return normaliseTags(raw);
}

async function handleList(ctx: Ctx): Promise<Response> {
  // Reads are open to any authed viewer now that the detail page serves
  // couples. Admins see every review (including unpublished drafts) for
  // moderation; couples see only published rows.
  const { userId, isAdmin } = viewerIsAdmin(ctx);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");

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

  // Composer eligibility for the viewer's couple — drives whether the detail
  // page shows the review form ("verified reviews": engagement proof only).
  const couple = getCoupleForUser(userId);
  const already = couple ? coupleAlreadyReviewed(couple.id, supplierId) : false;
  const can_review = isAdmin || (!!couple && !already && hasEngagementProof(couple.id, supplierId));

  return json({
    items: page.items,
    nextCursor: page.nextCursor,
    summary,
    can_review,
    already_reviewed: already,
  });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const { userId, isAdmin } = viewerIsAdmin(ctx);
  rateLimit(`user:${userId}`, "supplier_reviews.create", {
    capacity: 20,
    refillRate: 1,
  });

  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  if (supplierId.length > 80) throw new HttpError(400, "supplier_id too long");

  const body = await readJson<Partial<CreateReviewBody>>(ctx.req);
  const rating = parseRating(body.rating);
  const reviewBody = parseBody(body.body);
  const tags = parseTags(body.tags);

  let coupleId: number | null;
  let published: boolean;
  if (isAdmin) {
    // Editorial voice: couple_id stays null ("Weddly editors"), draft/publish
    // is the admin's call.
    coupleId = null;
    published = typeof body.published === "boolean" ? body.published : false;
  } else {
    // Couple author: verified-review gate. Only a couple that actually worked
    // with this supplier (cost plan row or category pick) may rate it, and
    // the review goes live immediately — the gate IS the moderation.
    const couple = getCoupleForUser(userId);
    if (!couple) throw new HttpError(403, "Create a wedding workspace first");
    if (!hasEngagementProof(couple.id, supplierId)) {
      throw new HttpError(
        403,
        "Reviews are open to couples who worked with this supplier (add it to your cost plan or pick it first)",
        { code: "not_engaged" },
      );
    }
    coupleId = couple.id;
    published = true;
  }

  let review: SupplierReview;
  try {
    review = createReview({
      supplierId,
      authorUserId: userId,
      coupleId,
      rating,
      body: reviewBody,
      tags,
      published,
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
    after: { supplier_id: supplierId, rating, published, tag_count: tags.length },
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

export function registerSupplierReviewRoutes(router: Router) {
  router.get("/api/suppliers/:supplier_id/reviews", handleList, true);
  router.post("/api/suppliers/:supplier_id/reviews", handleCreate, true);
  router.patch("/api/reviews/:review_id", handleUpdate, true);
  router.delete("/api/reviews/:review_id", handleDelete, true);
}
