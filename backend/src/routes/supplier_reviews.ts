// Reviews on a supplier detail page. v1 = admin-only writes (Phase 1+2 of the
// rollout). Phase 3 flips POST to `requireAuth` + engagement-proof gate; the
// partial unique index on (supplier_id, couple_id) WHERE couple_id IS NOT NULL
// already enforces "one review per couple per supplier" so the migration is
// just an auth-rule change, no schema work.

import type { CreateReviewBody, SupplierReview, SupplierReviewTag } from "@shared/suppliers";
import { REVIEW_BODY_MAX_CHARS, SUPPLIER_REVIEW_TAGS } from "@shared/suppliers";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
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
import { requireAdmin, viewerIsAdmin } from "../domain/users";

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
  const { isAdmin } = viewerIsAdmin(ctx);
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
  });
  const summary = getReviewSummary(supplierId);
  return json({ items: page.items, nextCursor: page.nextCursor, summary });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  rateLimit(`user:${admin.id}`, "supplier_reviews.create", {
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
  const published = typeof body.published === "boolean" ? body.published : false;

  // Admin author has no couple workspace; the partial unique index keeps the
  // schema honest about that. Couple authors (Phase 3) will populate
  // couple_id via getCoupleForUser(admin.id).
  const couple = getCoupleForUser(admin.id);
  const coupleId = couple ? couple.id : null;

  let review: SupplierReview;
  try {
    review = createReview({
      supplierId,
      authorUserId: admin.id,
      coupleId,
      rating,
      body: reviewBody,
      tags,
      published,
    });
  } catch (e: unknown) {
    // Partial unique-index violation on (supplier_id, couple_id) → admin's
    // couple already has a review for this supplier. 409 surfaces the conflict
    // so the frontend can offer an "edit your existing review" CTA.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("unique")) {
      throw new HttpError(409, "Already reviewed this supplier", {
        code: "already_reviewed",
      });
    }
    throw e;
  }

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: coupleId,
    action: "supplier_review.created",
    target_kind: "supplier_review",
    target_id: review.id,
    after: { supplier_id: supplierId, rating, published, tag_count: tags.length },
  });
  return json(review, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const reviewId = Number.parseInt(ctx.params.review_id ?? "", 10);
  if (!Number.isInteger(reviewId)) throw new HttpError(400, "review_id required");
  const existing = getReviewById(reviewId);
  if (!existing) throw new HttpError(404, "Review not found");

  const body = await readJson<Partial<CreateReviewBody>>(ctx.req);
  const patch: Parameters<typeof updateReview>[2] = {};
  if (body.rating !== undefined) patch.rating = parseRating(body.rating);
  if (body.body !== undefined) patch.body = parseBody(body.body);
  if (body.tags !== undefined) patch.tags = parseTags(body.tags);
  if (body.published !== undefined) patch.published = Boolean(body.published);

  const updated = updateReview(reviewId, existing.supplier_id, patch);
  if (!updated) throw new HttpError(404, "Review not found");

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: existing.couple_id,
    action: "supplier_review.updated",
    target_kind: "supplier_review",
    target_id: reviewId,
    after: { supplier_id: existing.supplier_id, fields: Object.keys(patch) },
  });
  return json(updated);
}

async function handleDelete(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const reviewId = Number.parseInt(ctx.params.review_id ?? "", 10);
  if (!Number.isInteger(reviewId)) throw new HttpError(400, "review_id required");
  const existing = getReviewById(reviewId);
  if (!existing) throw new HttpError(404, "Review not found");
  const ok = softDeleteReview(reviewId, existing.supplier_id);
  if (!ok) throw new HttpError(404, "Review not found");
  addAuditLog({
    actor_user_id: admin.id,
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
