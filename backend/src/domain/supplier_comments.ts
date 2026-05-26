// Q&A comments on the supplier detail page. Flat thread + one-level reply
// (parent_id NULL = top-level, otherwise points at another top-level). Deeper
// nesting is rejected at write time so the UI doesn't have to render a tree.
//
// `visibility` separates the three modes the 5-agent debate concluded with:
//   admin_internal  v1 default — admin notes, never surfaced to couples
//   public          Phase-3 public Q&A (couples + claimed vendors)
//   vendor_only     a couple's private question routed to one vendor only
//
// `supplier_id` is the public string id (curated slug or "c{N}").

import type { CommentVisibility, SupplierComment } from "@shared/suppliers";
import { db, now } from "../db";
import { isAdminEmail } from "./users";

const VALID_VISIBILITIES: ReadonlySet<CommentVisibility> = new Set([
  "admin_internal",
  "public",
  "vendor_only",
]);

export interface CommentRow {
  id: number;
  supplier_id: string;
  parent_id: number | null;
  author_user_id: number;
  visibility: string;
  body: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface CommentWithAuthorRow extends CommentRow {
  author_email: string | null;
  author_full_name: string | null;
  couple_display_name: string | null;
}

function authorIsAdmin(row: CommentWithAuthorRow): boolean {
  return row.author_email ? isAdminEmail(row.author_email) : false;
}

function authorDisplayName(row: CommentWithAuthorRow): string {
  if (authorIsAdmin(row)) return "Weddly";
  if (row.couple_display_name && row.couple_display_name.trim()) {
    return row.couple_display_name.trim();
  }
  if (row.author_full_name && row.author_full_name.trim()) {
    return row.author_full_name.trim();
  }
  return "Weddly couple";
}

export function toComment(row: CommentWithAuthorRow): SupplierComment {
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    parent_id: row.parent_id,
    visibility: VALID_VISIBILITIES.has(row.visibility as CommentVisibility)
      ? (row.visibility as CommentVisibility)
      : "admin_internal",
    body: row.body,
    author: {
      display_name: authorDisplayName(row),
      is_admin: authorIsAdmin(row),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const COMMENT_BASE_SELECT = `
  SELECT cm.*,
         u.email AS author_email,
         u.full_name AS author_full_name,
         c.display_name AS couple_display_name
    FROM supplier_comments cm
    LEFT JOIN users u ON u.id = cm.author_user_id
    LEFT JOIN couples c ON c.id = u.couple_id
`;

export function listCommentsForSupplier(
  supplierId: string,
  opts: { limit: number; cursor: number | null; visibilities: CommentVisibility[] },
): { items: SupplierComment[]; nextCursor: string | null } {
  if (opts.visibilities.length === 0) {
    return { items: [], nextCursor: null };
  }
  const limit = Math.max(1, Math.min(50, opts.limit));
  const visPlaceholders = opts.visibilities.map(() => "?").join(",");
  const params: (string | number)[] = [supplierId, ...opts.visibilities];
  let cursorClause = "";
  if (opts.cursor !== null) {
    cursorClause = " AND cm.id < ?";
    params.push(opts.cursor);
  }
  const sql = `${COMMENT_BASE_SELECT}
     WHERE cm.supplier_id = ?
       AND cm.deleted_at IS NULL
       AND cm.visibility IN (${visPlaceholders})${cursorClause}
     ORDER BY cm.id DESC
     LIMIT ?`;
  params.push(limit + 1);
  const rows = db.prepare(sql).all(...params) as CommentWithAuthorRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map(toComment);
  const nextCursor = hasMore && page.length > 0 ? String(page[page.length - 1]!.id) : null;
  return { items, nextCursor };
}

export function countNonDeletedComments(supplierId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM supplier_comments WHERE supplier_id = ? AND deleted_at IS NULL",
    )
    .get(supplierId) as { n: number };
  return row.n;
}

export function getCommentById(id: number): CommentRow | null {
  const row = db.prepare("SELECT * FROM supplier_comments WHERE id = ?").get(id) as
    | CommentRow
    | undefined;
  return row ?? null;
}

export interface CreateCommentArgs {
  supplierId: string;
  authorUserId: number;
  body: string;
  parentId: number | null;
  visibility: CommentVisibility;
}

export function createComment(args: CreateCommentArgs): SupplierComment {
  if (args.parentId !== null) {
    const parent = getCommentById(args.parentId);
    if (!parent || parent.supplier_id !== args.supplierId) {
      throw new Error("parent comment not found on this supplier");
    }
    if (parent.parent_id !== null) {
      throw new Error("cannot reply to a reply — only one level of threading");
    }
  }
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO supplier_comments
         (supplier_id, parent_id, author_user_id, visibility, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(args.supplierId, args.parentId, args.authorUserId, args.visibility, args.body, ts, ts);
  const id = Number(info.lastInsertRowid);
  const row = db.prepare(`${COMMENT_BASE_SELECT} WHERE cm.id = ?`).get(id) as CommentWithAuthorRow;
  return toComment(row);
}

export function softDeleteComment(id: number): boolean {
  const ts = now();
  const info = db
    .prepare(
      "UPDATE supplier_comments SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .run(ts, ts, id);
  return info.changes > 0;
}
