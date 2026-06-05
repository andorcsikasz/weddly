// Q&A comments. v1 = admin-only writes (the detail page itself is admin-only).
// `visibility` defaults to 'admin_internal' so a careless POST without a
// visibility hint doesn't leak content if/when the detail page opens to
// couples — Phase 3 has to consciously set visibility='public' to surface
// any new comment.

import type { CommentVisibility, CreateCommentBody } from "@shared/suppliers";
import { COMMENT_BODY_MAX_CHARS } from "@shared/suppliers";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
import { getCoupleForUser } from "../domain/couples";
import {
  createComment,
  getCommentById,
  listCommentsForSupplier,
  softDeleteComment,
} from "../domain/supplier_comments";
import { requireAdmin, viewerIsAdmin } from "../domain/users";

const VALID_VISIBILITIES = new Set<CommentVisibility>(["admin_internal", "public", "vendor_only"]);

function parseVisibility(raw: unknown): CommentVisibility {
  if (raw === undefined || raw === null) return "admin_internal";
  if (typeof raw !== "string" || !VALID_VISIBILITIES.has(raw as CommentVisibility)) {
    throw new HttpError(400, "visibility must be one of: admin_internal, public, vendor_only");
  }
  return raw as CommentVisibility;
}

function parseBody(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "body must be a string");
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, "body required");
  if (trimmed.length > COMMENT_BODY_MAX_CHARS) {
    throw new HttpError(400, `body too long (max ${COMMENT_BODY_MAX_CHARS} chars)`);
  }
  return trimmed;
}

async function handleList(ctx: Ctx): Promise<Response> {
  const { isAdmin } = viewerIsAdmin(ctx);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  // Admins see every tier; couples see only public Q&A. admin_internal and
  // vendor_only notes must never reach a couple's view now that the detail
  // page is open to couples.
  const visibilities: CommentVisibility[] = isAdmin
    ? ["admin_internal", "public", "vendor_only"]
    : ["public"];

  const cursorRaw = ctx.url.searchParams.get("cursor");
  const cursor = cursorRaw ? Number.parseInt(cursorRaw, 10) : null;
  const limitRaw = ctx.url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;

  const page = listCommentsForSupplier(supplierId, {
    limit: Number.isFinite(limit) ? limit : 20,
    cursor: cursor !== null && Number.isFinite(cursor) ? cursor : null,
    visibilities,
  });
  return json(page);
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  rateLimit(`user:${admin.id}`, "supplier_comments.create", {
    capacity: 30,
    refillRate: 2,
  });

  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  if (supplierId.length > 80) throw new HttpError(400, "supplier_id too long");

  const body = await readJson<Partial<CreateCommentBody>>(ctx.req);
  const bodyText = parseBody(body.body);
  const visibility = parseVisibility(body.visibility);
  const parentIdRaw = body.parent_id;
  const parentId =
    parentIdRaw === null || parentIdRaw === undefined
      ? null
      : typeof parentIdRaw === "number" && Number.isInteger(parentIdRaw)
        ? parentIdRaw
        : null;

  let comment;
  try {
    comment = createComment({
      supplierId,
      authorUserId: admin.id,
      body: bodyText,
      parentId,
      visibility,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("only one level of threading")) {
      throw new HttpError(400, "Cannot reply to a reply — only one level of threading");
    }
    if (msg.includes("parent comment not found")) {
      throw new HttpError(404, "Parent comment not found on this supplier");
    }
    throw e;
  }

  const couple = getCoupleForUser(admin.id);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: couple?.id ?? null,
    action: "supplier_comment.created",
    target_kind: "supplier_comment",
    target_id: comment.id,
    after: { supplier_id: supplierId, visibility, has_parent: parentId !== null },
  });
  return json(comment, { status: 201 });
}

async function handleDelete(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const commentId = Number.parseInt(ctx.params.comment_id ?? "", 10);
  if (!Number.isInteger(commentId)) throw new HttpError(400, "comment_id required");
  const existing = getCommentById(commentId);
  if (!existing) throw new HttpError(404, "Comment not found");
  const ok = softDeleteComment(commentId);
  if (!ok) throw new HttpError(404, "Comment not found");
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier_comment.deleted",
    target_kind: "supplier_comment",
    target_id: commentId,
    note: `supplier_id=${existing.supplier_id}`,
  });
  return json({ ok: true });
}

export function registerSupplierCommentRoutes(router: Router) {
  router.get("/api/suppliers/:supplier_id/comments", handleList, true);
  router.post("/api/suppliers/:supplier_id/comments", handleCreate, true);
  router.delete("/api/comments/:comment_id", handleDelete, true);
}
