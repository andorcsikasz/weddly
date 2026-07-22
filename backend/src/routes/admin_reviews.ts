// Admin review moderation: the flagged-review queue.
//
// When reviews opened to any verified email (couples without engagement proof,
// no-couple users, and email-verified visitors), a low (1-2 star) rating is
// auto-published but FLAGGED. Admins triage the flagged rows here — unflag to
// keep, or delete via the existing DELETE /api/reviews/:id (admin-authorized in
// routes/supplier_reviews.ts). Reads/writes are behind requireAdmin.

import type { AdminFlaggedReviewsResponse } from "@shared/suppliers";
import { getReviewById, listFlaggedReviews, updateReview } from "../domain/reviews";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, type Router } from "../lib/http";

async function handleListFlagged(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const cursorRaw = ctx.url.searchParams.get("cursor");
  const cursor = cursorRaw ? Number.parseInt(cursorRaw, 10) : null;
  const limitRaw = ctx.url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 30;
  const page = listFlaggedReviews({
    limit: Number.isFinite(limit) ? limit : 30,
    cursor: cursor !== null && Number.isFinite(cursor) ? cursor : null,
  });
  const payload: AdminFlaggedReviewsResponse = { items: page.items, nextCursor: page.nextCursor };
  return json(payload);
}

async function handleUnflag(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const reviewId = Number.parseInt(ctx.params.review_id ?? "", 10);
  if (!Number.isInteger(reviewId)) throw new HttpError(400, "review_id required");
  const existing = getReviewById(reviewId);
  if (!existing) throw new HttpError(404, "Review not found");
  const updated = updateReview(reviewId, existing.supplier_id, { flagged: false });
  if (!updated) throw new HttpError(404, "Review not found");
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: existing.couple_id,
    action: "supplier_review.unflagged",
    target_kind: "supplier_review",
    target_id: reviewId,
    note: `supplier_id=${existing.supplier_id}`,
  });
  return json({ ok: true });
}

export function registerAdminReviewRoutes(router: Router) {
  router.get("/api/admin/reviews/flagged", handleListFlagged, true);
  router.post("/api/admin/reviews/:review_id/unflag", handleUnflag, true);
}
