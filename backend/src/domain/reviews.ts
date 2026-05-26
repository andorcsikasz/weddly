// Supplier reviews: persistence + aggregate recompute. Admin-only writes in
// v1; the partial unique index on (supplier_id, couple_id) keeps the door
// open for Phase 3 couple-authored reviews without a schema rewrite (admin
// rows have couple_id IS NULL and so don't participate in the unique).
//
// `supplier_id` is the public string id (curated slug or "c{N}") to match
// every other supplier-keyed table — no FK because curated suppliers live in
// code, not the DB.

import type { ReviewSummary, SupplierReview, SupplierReviewTag } from "@shared/suppliers";
import { MAX_REVIEW_TAGS, SUPPLIER_REVIEW_TAGS } from "@shared/suppliers";
import { db, now } from "../db";

const VALID_TAGS: ReadonlySet<string> = new Set(SUPPLIER_REVIEW_TAGS);

/** Cold-start gate: don't publish an aggregate until this many published
 *  reviews exist. A single 1-star shouldn't read as a supplier's reputation. */
const MIN_REVIEWS_FOR_AGGREGATE = 3;

export interface ReviewRow {
  id: number;
  supplier_id: string;
  author_user_id: number;
  couple_id: number | null;
  rating: number;
  body: string | null;
  published: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Pre-joined fields so the mapper doesn't issue per-row queries. */
export interface ReviewWithAuthorRow extends ReviewRow {
  author_email: string | null;
  author_full_name: string | null;
  couple_display_name: string | null;
}

export function normaliseTags(raw: unknown): SupplierReviewTag[] {
  if (!Array.isArray(raw)) return [];
  const out: SupplierReviewTag[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string") continue;
    if (!VALID_TAGS.has(r)) continue;
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r as SupplierReviewTag);
    if (out.length >= MAX_REVIEW_TAGS) break;
  }
  return out;
}

function authorDisplayName(row: ReviewWithAuthorRow): string {
  if (row.couple_id === null) return "Weddly editors";
  if (row.couple_display_name && row.couple_display_name.trim()) {
    return row.couple_display_name.trim();
  }
  if (row.author_full_name && row.author_full_name.trim()) {
    return row.author_full_name.trim();
  }
  return "Weddly couple";
}

export function toReview(row: ReviewWithAuthorRow, tags: SupplierReviewTag[]): SupplierReview {
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    rating: Math.max(1, Math.min(5, Math.trunc(row.rating))) as 1 | 2 | 3 | 4 | 5,
    body: row.body,
    tags,
    published: Boolean(row.published),
    editorial: row.couple_id === null,
    author: { display_name: authorDisplayName(row) },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function loadTagsForReviews(reviewIds: number[]): Map<number, SupplierReviewTag[]> {
  const map = new Map<number, SupplierReviewTag[]>();
  if (reviewIds.length === 0) return map;
  const placeholders = reviewIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT review_id, tag FROM supplier_review_tags WHERE review_id IN (${placeholders})`)
    .all(...reviewIds) as Array<{ review_id: number; tag: string }>;
  for (const r of rows) {
    if (!VALID_TAGS.has(r.tag)) continue;
    const list = map.get(r.review_id) ?? [];
    list.push(r.tag as SupplierReviewTag);
    map.set(r.review_id, list);
  }
  return map;
}

const REVIEW_BASE_SELECT = `
  SELECT r.*,
         u.email AS author_email,
         u.full_name AS author_full_name,
         c.display_name AS couple_display_name
    FROM supplier_reviews r
    LEFT JOIN users u ON u.id = r.author_user_id
    LEFT JOIN couples c ON c.id = r.couple_id
`;

export function listReviewsForSupplier(
  supplierId: string,
  opts: { limit: number; cursor: number | null; includeUnpublished: boolean },
): { items: SupplierReview[]; nextCursor: string | null } {
  const limit = Math.max(1, Math.min(50, opts.limit));
  const params: (string | number)[] = [supplierId];
  let cursorClause = "";
  if (opts.cursor !== null) {
    cursorClause = " AND r.id < ?";
    params.push(opts.cursor);
  }
  const publishedClause = opts.includeUnpublished ? "" : " AND r.published = 1";
  const sql = `${REVIEW_BASE_SELECT}
     WHERE r.supplier_id = ?
       AND r.deleted_at IS NULL${publishedClause}${cursorClause}
     ORDER BY r.id DESC
     LIMIT ?`;
  params.push(limit + 1);
  const rows = db.prepare(sql).all(...params) as ReviewWithAuthorRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const tags = loadTagsForReviews(page.map((r) => r.id));
  const items = page.map((r) => toReview(r, tags.get(r.id) ?? []));
  const nextCursor = hasMore && page.length > 0 ? String(page[page.length - 1]!.id) : null;
  return { items, nextCursor };
}

export function getReviewById(id: number): ReviewWithAuthorRow | null {
  const row = db.prepare(`${REVIEW_BASE_SELECT} WHERE r.id = ? AND r.deleted_at IS NULL`).get(id) as
    | ReviewWithAuthorRow
    | undefined;
  return row ?? null;
}

export function getReviewWithTags(id: number): SupplierReview | null {
  const row = getReviewById(id);
  if (!row) return null;
  const tags = loadTagsForReviews([id]).get(id) ?? [];
  return toReview(row, tags);
}

export interface CreateReviewArgs {
  supplierId: string;
  authorUserId: number;
  coupleId: number | null;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string | null;
  tags: SupplierReviewTag[];
  published: boolean;
}

export function createReview(args: CreateReviewArgs): SupplierReview {
  const ts = now();
  const txn = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO supplier_reviews
           (supplier_id, author_user_id, couple_id, rating, body, published, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.supplierId,
        args.authorUserId,
        args.coupleId,
        args.rating,
        args.body,
        args.published ? 1 : 0,
        ts,
        ts,
      );
    const reviewId = Number(info.lastInsertRowid);
    if (args.tags.length > 0) {
      const stmt = db.prepare("INSERT INTO supplier_review_tags (review_id, tag) VALUES (?, ?)");
      for (const t of args.tags) stmt.run(reviewId, t);
    }
    recomputeSupplierAggregate(args.supplierId);
    return reviewId;
  });
  const reviewId = txn();
  const result = getReviewWithTags(reviewId);
  if (!result) throw new Error("review vanished after insert");
  return result;
}

export interface UpdateReviewArgs {
  rating?: 1 | 2 | 3 | 4 | 5;
  body?: string | null;
  tags?: SupplierReviewTag[];
  published?: boolean;
}

export function updateReview(
  reviewId: number,
  supplierId: string,
  args: UpdateReviewArgs,
): SupplierReview | null {
  const ts = now();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (args.rating !== undefined) {
    sets.push("rating = ?");
    params.push(args.rating);
  }
  if (args.body !== undefined) {
    sets.push("body = ?");
    params.push(args.body);
  }
  if (args.published !== undefined) {
    sets.push("published = ?");
    params.push(args.published ? 1 : 0);
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    params.push(ts);
    params.push(reviewId);
    const stmt = db.prepare(
      `UPDATE supplier_reviews SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
    );
    stmt.run(...(params as (string | number | null)[]));
  }
  if (args.tags !== undefined) {
    db.prepare("DELETE FROM supplier_review_tags WHERE review_id = ?").run(reviewId);
    if (args.tags.length > 0) {
      const stmt = db.prepare("INSERT INTO supplier_review_tags (review_id, tag) VALUES (?, ?)");
      for (const t of args.tags) stmt.run(reviewId, t);
    }
  }
  recomputeSupplierAggregate(supplierId);
  return getReviewWithTags(reviewId);
}

export function softDeleteReview(reviewId: number, supplierId: string): boolean {
  const ts = now();
  const info = db
    .prepare(
      "UPDATE supplier_reviews SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .run(ts, ts, reviewId);
  if (info.changes > 0) recomputeSupplierAggregate(supplierId);
  return info.changes > 0;
}

/** Recompute the supplier_aggregates row for a single supplier. Idempotent —
 *  call from anywhere a review's published/rating/tags shifted. Hides the
 *  aggregate (avg = null) when below the cold-start threshold. */
export function recomputeSupplierAggregate(supplierId: string): void {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, AVG(rating) AS avg
         FROM supplier_reviews
        WHERE supplier_id = ?
          AND published = 1
          AND deleted_at IS NULL`,
    )
    .get(supplierId) as { n: number; avg: number | null };
  const reviewsCount = row.n;
  const avg = reviewsCount >= MIN_REVIEWS_FOR_AGGREGATE && row.avg !== null ? row.avg : null;

  const tagRows = db
    .prepare(
      `SELECT t.tag AS tag, COUNT(*) AS n
         FROM supplier_review_tags t
         JOIN supplier_reviews r ON r.id = t.review_id
        WHERE r.supplier_id = ?
          AND r.published = 1
          AND r.deleted_at IS NULL
        GROUP BY t.tag
        ORDER BY n DESC, t.tag ASC
        LIMIT 5`,
    )
    .all(supplierId) as Array<{ tag: string; n: number }>;
  const topTags = tagRows
    .filter((t) => VALID_TAGS.has(t.tag))
    .map((t) => ({ tag: t.tag, count: t.n }));

  const ts = now();
  db.prepare(
    `INSERT INTO supplier_aggregates (supplier_id, avg_rating, reviews_count, top_tags, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(supplier_id) DO UPDATE SET
       avg_rating = excluded.avg_rating,
       reviews_count = excluded.reviews_count,
       top_tags = excluded.top_tags,
       updated_at = excluded.updated_at`,
  ).run(supplierId, avg, reviewsCount, JSON.stringify(topTags), ts);
}

/** Read the aggregate row + compute the histogram. Histogram is computed at
 *  read time (cheap, only 5 buckets) rather than denormalised — keeps the
 *  aggregate-recompute path simple. */
export function getReviewSummary(supplierId: string): ReviewSummary {
  const agg = db
    .prepare(
      "SELECT avg_rating, reviews_count, top_tags FROM supplier_aggregates WHERE supplier_id = ?",
    )
    .get(supplierId) as
    | { avg_rating: number | null; reviews_count: number; top_tags: string }
    | undefined;

  const histRows = db
    .prepare(
      `SELECT rating, COUNT(*) AS n FROM supplier_reviews
        WHERE supplier_id = ? AND published = 1 AND deleted_at IS NULL
        GROUP BY rating`,
    )
    .all(supplierId) as Array<{ rating: number; n: number }>;
  const histogram: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const r of histRows) {
    const i = Math.max(1, Math.min(5, Math.trunc(r.rating))) - 1;
    histogram[i] = r.n;
  }

  let topTagsParsed: ReviewSummary["top_tags"] = [];
  if (agg) {
    try {
      const parsed = JSON.parse(agg.top_tags);
      if (Array.isArray(parsed)) {
        topTagsParsed = parsed
          .filter(
            (p: unknown): p is { tag: string; count: number } =>
              typeof p === "object" &&
              p !== null &&
              typeof (p as { tag: unknown }).tag === "string" &&
              typeof (p as { count: unknown }).count === "number" &&
              VALID_TAGS.has((p as { tag: string }).tag),
          )
          .map((p) => ({ tag: p.tag as SupplierReviewTag, count: p.count }));
      }
    } catch {
      // Stored JSON malformed — surface as an empty list rather than crashing.
    }
  }

  return {
    avg_rating: agg?.avg_rating ?? null,
    reviews_count: agg?.reviews_count ?? 0,
    histogram,
    top_tags: topTagsParsed,
  };
}
