// Supplier reviews: persistence + aggregate recompute. Admin-only writes in
// v1; the partial unique index on (supplier_id, couple_id) keeps the door
// open for Phase 3 couple-authored reviews without a schema rewrite (admin
// rows have couple_id IS NULL and so don't participate in the unique).
//
// `supplier_id` is the public string id (curated slug or "c{N}") to match
// every other supplier-keyed table — no FK because curated suppliers live in
// code, not the DB.

import type {
  AdminFlaggedReview,
  ReviewSummary,
  SupplierReview,
  SupplierReviewTag,
} from "@shared/suppliers";
import {
  isKnownReviewTag,
  normaliseCustomReviewTag,
  SUPPLIER_REVIEW_TAGS,
} from "@shared/suppliers";
import { PLANNER_REVIEW_PREFIX, plannerUserIdFromSubject } from "@shared/planner_reviews";
import { db, now } from "../db";
import { emitPlannerEvent } from "./planner_points";
import { emitVendorEventForSupplier } from "./vendor_points";
import { shortenName } from "./verified_visitors";

/** How a review's author is attributed. `admin` = editorial ("Weddly editors",
 *  couple_id NULL); `couple` = a couple workspace; `user` = a logged-in user
 *  with no couple; `visitor` = an email-verified visitor with no account
 *  (author_user_id points at the reserved system user, real identity in
 *  visitor_id). Legacy rows (author_kind NULL) fall back to the couple_id shape. */
export type ReviewAuthorKind = "admin" | "couple" | "user" | "visitor";

/** Shown when a visitor/user review has no usable name. Matches the hardcoded
 *  EN author labels already in this mapper ("Weddly editors" / "Weddly couple"). */
const VISITOR_FALLBACK_NAME = "Verified visitor";

const VALID_TAGS: ReadonlySet<string> = new Set(SUPPLIER_REVIEW_TAGS);

/** Cold-start gate: don't publish an aggregate until this many published
 *  reviews exist. A single 1-star shouldn't read as a supplier's reputation. */
const MIN_REVIEWS_FOR_AGGREGATE = 3;

export interface ReviewRow {
  id: number;
  supplier_id: string;
  author_user_id: number;
  couple_id: number | null;
  /** null on legacy rows (pre-open-reviews); resolve via authorKindOf(). */
  author_kind: string | null;
  /** Real author for a visitor review (verified-visitor infra owns the column). */
  author_visitor_id: number | null;
  rating: number;
  body: string | null;
  /** Optional "what it cost": whole-unit amount + its currency + a short note.
   *  All null when the reviewer didn't share a price. */
  amount_paid: number | null;
  amount_currency: string | null;
  amount_note: string | null;
  published: number;
  /** 1 = engagement-proof-verified couple review (drives the "Verified" badge). */
  verified: number;
  /** 1 = low-rating open review awaiting admin moderation (still visible). */
  flagged: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Pre-joined fields so the mapper doesn't issue per-row queries. */
export interface ReviewWithAuthorRow extends ReviewRow {
  author_email: string | null;
  author_full_name: string | null;
  couple_display_name: string | null;
  visitor_name: string | null;
}

/** Effective author kind, tolerating legacy rows where the column is NULL. */
function authorKindOf(row: ReviewRow): ReviewAuthorKind {
  if (row.author_kind === "admin" || row.author_kind === "couple") return row.author_kind;
  if (row.author_kind === "user" || row.author_kind === "visitor") return row.author_kind;
  return row.couple_id === null ? "admin" : "couple";
}

function authorDisplayName(row: ReviewWithAuthorRow): string {
  switch (authorKindOf(row)) {
    case "admin":
      return "Weddly editors";
    case "couple":
      if (row.couple_display_name?.trim()) return row.couple_display_name.trim();
      if (row.author_full_name?.trim()) return row.author_full_name.trim();
      return "Weddly couple";
    case "user":
      // A logged-in user with no couple workspace — same privacy form as a
      // visitor (first name + last initial), never their full name.
      return shortenName(row.author_full_name) || VISITOR_FALLBACK_NAME;
    case "visitor":
      return shortenName(row.visitor_name) || VISITOR_FALLBACK_NAME;
  }
}

export function toReview(
  row: ReviewWithAuthorRow,
  tags: string[],
  viewerUserId?: number,
): SupplierReview {
  const kind = authorKindOf(row);
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    rating: Math.max(1, Math.min(5, Math.trunc(row.rating))) as 1 | 2 | 3 | 4 | 5,
    body: row.body,
    tags,
    amount_paid: row.amount_paid,
    amount_currency: row.amount_currency,
    amount_note: row.amount_note,
    published: Boolean(row.published),
    editorial: kind === "admin",
    verified: Boolean(row.verified),
    // The reserved system user owns every visitor row's author_user_id, so guard
    // against a real viewer ever "owning" a visitor review by coincidence.
    own: viewerUserId !== undefined && kind !== "visitor" && row.author_user_id === viewerUserId,
    author: { display_name: authorDisplayName(row) },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function loadTagsForReviews(reviewIds: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  if (reviewIds.length === 0) return map;
  const placeholders = reviewIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT review_id, tag FROM supplier_review_tags WHERE review_id IN (${placeholders})`)
    .all(...reviewIds) as Array<{ review_id: number; tag: string }>;
  for (const r of rows) {
    // Keep controlled tags plus any free-text tag that still passes the shape
    // guard (defensive — the write path already validated). Anything malformed
    // is dropped rather than surfaced.
    if (!isKnownReviewTag(r.tag) && normaliseCustomReviewTag(r.tag) === null) continue;
    const list = map.get(r.review_id) ?? [];
    list.push(r.tag);
    map.set(r.review_id, list);
  }
  return map;
}

const REVIEW_BASE_SELECT = `
  SELECT r.*,
         u.email AS author_email,
         u.full_name AS author_full_name,
         c.display_name AS couple_display_name,
         vv.full_name AS visitor_name
    FROM supplier_reviews r
    LEFT JOIN users u ON u.id = r.author_user_id
    LEFT JOIN couples c ON c.id = r.couple_id
    LEFT JOIN verified_visitors vv ON vv.id = r.author_visitor_id
`;

export function listReviewsForSupplier(
  supplierId: string,
  opts: {
    limit: number;
    cursor: number | null;
    includeUnpublished: boolean;
    /** When set, each item's `own` flags the viewer's authorship (drives the
     *  couple-side edit/delete affordance). */
    viewerUserId?: number;
  },
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
  const items = page.map((r) => toReview(r, tags.get(r.id) ?? [], opts.viewerUserId));
  const nextCursor = hasMore && page.length > 0 ? String(page[page.length - 1]!.id) : null;
  return { items, nextCursor };
}

/** Admin moderation queue: flagged (low-rating open) reviews, newest first,
 *  across every review subject. The name is best-effort and resolved from BOTH
 *  namespaces — a `listings` row for a supplier, a planner account for a
 *  `planner:{id}` subject. Planner reviews reached this queue the moment they
 *  existed (the filter is `flagged = 1` and nothing else), so without the
 *  second join a moderator would be asked to judge a 1-star review of a
 *  business the row could not name. */
export function listFlaggedReviews(opts: {
  limit: number;
  cursor: number | null;
}): { items: AdminFlaggedReview[]; nextCursor: string | null } {
  const limit = Math.max(1, Math.min(50, opts.limit));
  const params: (string | number)[] = [];
  let cursorClause = "";
  if (opts.cursor !== null) {
    cursorClause = " AND r.id < ?";
    params.push(opts.cursor);
  }
  const sql = `
    SELECT r.*,
           u.email AS author_email,
           u.full_name AS author_full_name,
           c.display_name AS couple_display_name,
           vv.full_name AS visitor_name,
           COALESCE(l.name, NULLIF(TRIM(COALESCE(pu.business_name, '')), ''), pu.full_name)
             AS supplier_name
      FROM supplier_reviews r
      LEFT JOIN users u ON u.id = r.author_user_id
      LEFT JOIN couples c ON c.id = r.couple_id
      LEFT JOIN verified_visitors vv ON vv.id = r.author_visitor_id
      LEFT JOIN listings l ON l.id = r.supplier_id
      LEFT JOIN users pu
        ON ('${PLANNER_REVIEW_PREFIX}' || pu.id) = r.supplier_id AND pu.user_type = 'planner'
     WHERE r.flagged = 1
       AND r.deleted_at IS NULL${cursorClause}
     ORDER BY r.id DESC
     LIMIT ?`;
  params.push(limit + 1);
  const rows = db.prepare(sql).all(...params) as Array<
    ReviewWithAuthorRow & { supplier_name: string | null }
  >;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const tags = loadTagsForReviews(page.map((r) => r.id));
  const items: AdminFlaggedReview[] = page.map((r) => ({
    id: r.id,
    supplier_id: r.supplier_id,
    supplier_name: r.supplier_name,
    rating: Math.max(1, Math.min(5, Math.trunc(r.rating))) as 1 | 2 | 3 | 4 | 5,
    body: r.body,
    tags: tags.get(r.id) ?? [],
    author_display_name: authorDisplayName(r),
    author_kind: authorKindOf(r),
    created_at: r.created_at,
  }));
  const nextCursor = hasMore && page.length > 0 ? String(page[page.length - 1]?.id) : null;
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
  authorKind: ReviewAuthorKind;
  /** Real author id for a visitor review; null for every other kind. */
  visitorId: number | null;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string | null;
  tags: string[];
  /** Optional "what it cost" — whole-unit amount, its currency, a short note. */
  amountPaid: number | null;
  amountCurrency: string | null;
  amountNote: string | null;
  published: boolean;
  /** Engagement-proof "Verified" badge — only true for engaged couples. */
  verified: boolean;
  /** Low-rating open review awaiting admin moderation (still published). */
  flagged: boolean;
}

export function createReview(args: CreateReviewArgs): SupplierReview {
  const ts = now();
  const txn = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO supplier_reviews
           (supplier_id, author_user_id, couple_id, author_kind, author_visitor_id,
            rating, body, amount_paid, amount_currency, amount_note,
            published, verified, flagged, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.supplierId,
        args.authorUserId,
        args.coupleId,
        args.authorKind,
        args.visitorId,
        args.rating,
        args.body,
        args.amountPaid,
        args.amountCurrency,
        args.amountNote,
        args.published ? 1 : 0,
        args.verified ? 1 : 0,
        args.flagged ? 1 : 0,
        ts,
        ts,
      );
    const reviewId = Number(info.lastInsertRowid);
    if (args.tags.length > 0) {
      const stmt = db.prepare("INSERT INTO supplier_review_tags (review_id, tag) VALUES (?, ?)");
      for (const t of args.tags) stmt.run(reviewId, t);
    }
    recomputeSupplierAggregate(args.supplierId);
    // Weddly Points: announce the collection, never the reward. The engine
    // decides what a review is worth, and deliberately never sees the rating.
    //
    // Both subject kinds are announced from HERE rather than from the routes,
    // for the same reason the aggregate is recomputed here: three composers post
    // reviews (the couple/user one, the verified-visitor one, the admin one) and
    // a rule that lives in the route has to be remembered three times. A
    // `planner:{id}` subject resolves to no listing, so the vendor call below is
    // a no-op for planners and vice versa.
    emitVendorEventForSupplier(args.supplierId, "review.created", { review_id: reviewId });
    // A DRAFT earns nothing: an unpublished review is visible to nobody but its
    // admin author, so paying for it would credit a planner for a page a couple
    // never sees. The engine re-reads `published` too; this just keeps the
    // pointless event out of the queue.
    if (args.published) {
      emitPlannerEvent(plannerUserIdFromSubject(args.supplierId), "review.created", {
        review_id: reviewId,
      });
    }
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
  tags?: string[];
  amountPaid?: number | null;
  amountCurrency?: string | null;
  amountNote?: string | null;
  published?: boolean;
  flagged?: boolean;
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
  if (args.amountPaid !== undefined) {
    sets.push("amount_paid = ?");
    params.push(args.amountPaid);
  }
  if (args.amountCurrency !== undefined) {
    sets.push("amount_currency = ?");
    params.push(args.amountCurrency);
  }
  if (args.amountNote !== undefined) {
    sets.push("amount_note = ?");
    params.push(args.amountNote);
  }
  if (args.published !== undefined) {
    sets.push("published = ?");
    params.push(args.published ? 1 : 0);
  }
  if (args.flagged !== undefined) {
    sets.push("flagged = ?");
    params.push(args.flagged ? 1 : 0);
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
