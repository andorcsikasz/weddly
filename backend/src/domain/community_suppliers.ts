// User-submitted supplier rows: storage, mappers, and helpers. New submissions
// land as status='pending' and only flip to 'active' once the contact email
// owner clicks the verification link. Admins can hide (soft) or hard-delete
// via the admin routes.

import { randomBytes } from "node:crypto";
import type {
  CommunitySupplierAdminView,
  CommunitySupplierReportReason,
  CommunitySupplierStatus,
  PriceBand,
  SubmitCommunitySupplierInput,
} from "@shared/community_suppliers";
import type { DirectorySupplierBase, SupplierCategory } from "@shared/suppliers";
import { db, now } from "../db";

/** Verification-token TTL — 7 days. Vendors often share a generic inbox that
 *  is only checked weekly, so a week-long window keeps the friction low. */
export const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Distinct-reporter threshold that flips a community listing to status='hidden'
 *  automatically. Tuned conservatively (3) — at scale we may want to weight by
 *  reporter trust or recency. Exported so tests and admin tooling can read the
 *  same constant. */
export const REPORT_AUTOHIDE_THRESHOLD = 3;

export interface CommunitySupplierRow {
  id: number;
  submitter_user_id: number;
  category: string;
  name: string;
  city: string;
  address: string | null;
  website: string;
  contact_email: string | null;
  contact_phone: string | null;
  blurb: string;
  price_band: number;
  status: string;
  hide_reason: string | null;
  hidden_by_user_id: number | null;
  hidden_at: number | null;
  admin_notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface CommunitySupplierRowWithEmail extends CommunitySupplierRow {
  submitter_email: string;
}

function clampPriceBand(v: number): PriceBand {
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) return v;
  return 1;
}

// id is `c${row.id}` so community ids cannot collide with curated string slugs.
// Returns the base (no vote overlay) — the route wraps with vote tallies.
// Community submissions don't carry capacity yet; the form would need new
// fields to collect it. Leaving null until the submission UX grows.
//
// Privacy note: `contact_email` is INTENTIONALLY suppressed in the public
// list (always `null`). Submitters' inboxes were being scraped from the
// rendered mailto: links, so we now route inquiries through the website
// instead. The admin moderation view (`toAdminView`) still surfaces the
// real address.
export function toDirectorySupplierBase(row: CommunitySupplierRow): DirectorySupplierBase {
  return {
    id: `c${row.id}`,
    name: row.name,
    category: row.category as SupplierCategory,
    city: row.city,
    address: row.address,
    capacity_min: null,
    capacity_max: null,
    lat: null,
    lng: null,
    blurb_hu: row.blurb,
    blurb_en: row.blurb,
    website: row.website,
    contact_email: null,
    contact_phone: row.contact_phone,
    source: "community",
    price_band: clampPriceBand(row.price_band),
  };
}

export function toAdminView(
  row: CommunitySupplierRowWithEmail,
  openReportCount = 0,
): CommunitySupplierAdminView {
  return {
    id: row.id,
    category: row.category as SupplierCategory,
    name: row.name,
    city: row.city,
    address: row.address,
    website: row.website,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    blurb: row.blurb,
    price_band: clampPriceBand(row.price_band),
    status: row.status as CommunitySupplierStatus,
    submitter_email: row.submitter_email,
    submitter_user_id: row.submitter_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    hidden_at: row.hidden_at,
    hide_reason: row.hide_reason,
    open_report_count: openReportCount,
    admin_notes: row.admin_notes,
  };
}

/** Persist admin freeform notes for a community-submitted supplier. Empty
 *  string clears the note; NULL is reserved for "never touched". Caps the
 *  payload at 4000 chars so a stray paste can't bloat the row. */
export function updateAdminNotes(id: number, notes: string): void {
  const ts = now();
  const trimmed = notes.length > 4000 ? notes.slice(0, 4000) : notes;
  db.prepare("UPDATE community_suppliers SET admin_notes = ?, updated_at = ? WHERE id = ?").run(
    trimmed,
    ts,
    id,
  );
}

export function listActiveCommunitySuppliers(
  category?: SupplierCategory | null,
): CommunitySupplierRow[] {
  if (category) {
    return db
      .prepare(
        "SELECT * FROM community_suppliers WHERE status = 'active' AND category = ? ORDER BY created_at DESC",
      )
      .all(category) as CommunitySupplierRow[];
  }
  return db
    .prepare("SELECT * FROM community_suppliers WHERE status = 'active' ORDER BY created_at DESC")
    .all() as CommunitySupplierRow[];
}

export function listAllForAdmin(): CommunitySupplierRowWithEmail[] {
  return db
    .prepare(
      `SELECT cs.*, u.email AS submitter_email
       FROM community_suppliers cs
       JOIN users u ON u.id = cs.submitter_user_id
       ORDER BY cs.created_at DESC`,
    )
    .all() as CommunitySupplierRowWithEmail[];
}

/** Case-insensitive lookup for a live (active OR pending verification)
 *  community supplier with the same website. Used to reject duplicate
 *  submissions before they queue. Hidden duplicates don't block — admin
 *  already removed them and the user may be re-submitting with corrected
 *  details after their previous one was rejected. */
export function findActiveByWebsite(website: string): CommunitySupplierRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM community_suppliers
          WHERE LOWER(website) = LOWER(?) AND status IN ('active', 'pending')
          LIMIT 1`,
      )
      .get(website) as CommunitySupplierRow | undefined) ?? null
  );
}

export function getCommunitySupplierById(id: number): CommunitySupplierRow | null {
  return (
    (db.prepare("SELECT * FROM community_suppliers WHERE id = ?").get(id) as
      | CommunitySupplierRow
      | undefined) ?? null
  );
}

export function getCommunitySupplierWithEmail(id: number): CommunitySupplierRowWithEmail | null {
  return (
    (db
      .prepare(
        `SELECT cs.*, u.email AS submitter_email
         FROM community_suppliers cs
         JOIN users u ON u.id = cs.submitter_user_id
         WHERE cs.id = ?`,
      )
      .get(id) as CommunitySupplierRowWithEmail | undefined) ?? null
  );
}

export function insertCommunitySupplier(
  submitterUserId: number,
  input: SubmitCommunitySupplierInput,
): number {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO community_suppliers
        (submitter_user_id, category, name, city, address, website, contact_email, contact_phone,
         blurb, price_band, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      submitterUserId,
      input.category,
      input.name,
      input.city,
      input.address,
      input.website,
      input.contact_email,
      input.contact_phone,
      input.blurb,
      input.price_band,
      ts,
      ts,
    );
  return Number(result.lastInsertRowid);
}

// ── Email verification tokens ──────────────────────────────────────────────

export interface VerificationTokenRow {
  id: number;
  supplier_id: number;
  token: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

/** Generates + persists a fresh verification token tied to a supplier. The
 *  same supplier can have multiple tokens over time (e.g. admin re-sends);
 *  each is independently consumable. */
export function createVerificationToken(supplierId: number): VerificationTokenRow {
  const ts = now();
  const token = randomBytes(32).toString("hex");
  const expires = ts + VERIFICATION_TTL_MS;
  const r = db
    .prepare(
      `INSERT INTO community_supplier_verifications
        (supplier_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(supplierId, token, expires, ts);
  return {
    id: Number(r.lastInsertRowid),
    supplier_id: supplierId,
    token,
    expires_at: expires,
    consumed_at: null,
    created_at: ts,
  };
}

export type VerificationResult =
  | { ok: true; supplierId: number; alreadyActive: boolean }
  | { ok: false; reason: "not_found" | "expired" | "already_consumed" | "supplier_missing" };

/** Consumes a verification token: marks the row, flips the supplier to
 *  'active'. Idempotent — re-using an already-consumed token returns
 *  `already_consumed`; the supplier stays whatever state it was in. */
export function consumeVerificationToken(token: string): VerificationResult {
  const ts = now();
  const row = db
    .prepare("SELECT * FROM community_supplier_verifications WHERE token = ?")
    .get(token) as VerificationTokenRow | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.consumed_at !== null) return { ok: false, reason: "already_consumed" };
  if (row.expires_at < ts) return { ok: false, reason: "expired" };

  const supplier = getCommunitySupplierById(row.supplier_id);
  if (!supplier) return { ok: false, reason: "supplier_missing" };

  db.prepare("UPDATE community_supplier_verifications SET consumed_at = ? WHERE id = ?").run(
    ts,
    row.id,
  );

  // Email verification only proves the submitter controls the address — it
  // does NOT make the listing live. Flip `pending` → `awaiting_review` so the
  // admin still has to approve it. Earlier versions of this code flipped
  // straight to `active`, which let listings appear in the public directory
  // without human review; that was the v1.1 regression we're closing here.
  // Admin may have already hidden the row during the verification window;
  // respect that.
  let alreadyActive = supplier.status === "active";
  if (supplier.status === "pending") {
    db.prepare(
      "UPDATE community_suppliers SET status = 'awaiting_review', updated_at = ? WHERE id = ?",
    ).run(ts, row.supplier_id);
    alreadyActive = false;
  }

  return { ok: true, supplierId: row.supplier_id, alreadyActive };
}

/** Admin approval: flip `awaiting_review` → `active`. No-op if the row is
 *  already active. Hidden rows are NOT auto-approved — admin has to explicitly
 *  unhide first. Returns the new status. */
export function approveSupplier(id: number): CommunitySupplierStatus {
  const ts = now();
  const cur = getCommunitySupplierById(id);
  if (!cur) throw new Error("supplier not found");
  if (cur.status === "active") return "active";
  if (cur.status !== "awaiting_review") return cur.status as CommunitySupplierStatus;
  db.prepare("UPDATE community_suppliers SET status = 'active', updated_at = ? WHERE id = ?").run(
    ts,
    id,
  );
  return "active";
}

export function setStatus(
  id: number,
  status: CommunitySupplierStatus,
  hiddenBy: number | null,
  reason: string | null,
): void {
  const ts = now();
  if (status === "hidden") {
    db.prepare(
      `UPDATE community_suppliers
       SET status = 'hidden', hidden_by_user_id = ?, hidden_at = ?, hide_reason = ?, updated_at = ?
       WHERE id = ?`,
    ).run(hiddenBy, ts, reason, ts, id);
  } else {
    db.prepare(
      `UPDATE community_suppliers
       SET status = 'active', hidden_by_user_id = NULL, hidden_at = NULL, hide_reason = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(ts, id);
  }
}

export function deleteCommunitySupplier(id: number): void {
  db.prepare("DELETE FROM community_suppliers WHERE id = ?").run(id);
}

// ── Abuse reports ──────────────────────────────────────────────────────────

export interface CommunitySupplierReportRow {
  id: number;
  supplier_id: number;
  reporter_user_id: number;
  reason: string;
  note: string | null;
  status: string;
  reviewed_by_user_id: number | null;
  reviewed_at: number | null;
  created_at: number;
}

/** Inserts a report. Returns `{inserted, autoHidden}`. `inserted=false` means
 *  this user already reported the supplier (UNIQUE constraint). `autoHidden`
 *  is true iff this report pushed the distinct-reporter count to the
 *  threshold and the supplier flipped to status='hidden'. */
export function insertReport(
  supplierId: number,
  reporterUserId: number,
  reason: CommunitySupplierReportReason,
  note: string | null,
): { inserted: boolean; autoHidden: boolean; reportCount: number } {
  const ts = now();
  try {
    db.prepare(
      `INSERT INTO community_supplier_reports
         (supplier_id, reporter_user_id, reason, note, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?)`,
    ).run(supplierId, reporterUserId, reason, note, ts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return { inserted: false, autoHidden: false, reportCount: countOpenReports(supplierId) };
    }
    throw e;
  }

  const reportCount = countOpenReports(supplierId);
  let autoHidden = false;
  if (reportCount >= REPORT_AUTOHIDE_THRESHOLD) {
    const before = getCommunitySupplierById(supplierId);
    if (before && before.status === "active") {
      setStatus(supplierId, "hidden", null, `auto-hidden: ${reportCount} user reports`);
      autoHidden = true;
    }
  }
  return { inserted: true, autoHidden, reportCount };
}

/** Count of distinct OPEN reports for a supplier. Dismissed reports don't
 *  count toward the auto-hide threshold so an admin can keep a listing live
 *  after triaging spurious reports. */
export function countOpenReports(supplierId: number): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM community_supplier_reports WHERE supplier_id = ? AND status = 'open'",
    )
    .get(supplierId) as { c: number };
  return row.c;
}

/** Map of supplier_id → open report count for the full admin list. One query
 *  beats N+1 lookups when the moderation queue has dozens of rows. */
export function openReportCountsForAll(): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT supplier_id, COUNT(*) AS c
         FROM community_supplier_reports
        WHERE status = 'open'
        GROUP BY supplier_id`,
    )
    .all() as { supplier_id: number; c: number }[];
  return new Map(rows.map((r) => [r.supplier_id, r.c]));
}

export function listOpenReportsForSupplier(supplierId: number): CommunitySupplierReportRow[] {
  return db
    .prepare(
      `SELECT * FROM community_supplier_reports
        WHERE supplier_id = ? AND status = 'open'
        ORDER BY created_at DESC`,
    )
    .all(supplierId) as CommunitySupplierReportRow[];
}

export function dismissReportsForSupplier(supplierId: number, adminUserId: number): number {
  const ts = now();
  const r = db
    .prepare(
      `UPDATE community_supplier_reports
          SET status = 'dismissed', reviewed_by_user_id = ?, reviewed_at = ?
        WHERE supplier_id = ? AND status = 'open'`,
    )
    .run(adminUserId, ts, supplierId);
  return r.changes;
}
