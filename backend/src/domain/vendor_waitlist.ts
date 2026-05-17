// Vendor waitlist submissions from the public /vendors page. No auth on
// inserts; admins triage via /app/admin/vendor-waitlist.

import type {
  VendorWaitlistAdminView,
  VendorWaitlistEntry,
  VendorWaitlistOutcome,
  VendorWaitlistStatus,
} from "@shared/vendor_waitlist";
import { db, now } from "../db";

// Re-export the shared union so callers in `routes/` keep the existing import.
export type { VendorWaitlistStatus } from "@shared/vendor_waitlist";

export interface VendorWaitlistRow {
  id: number;
  business_name: string;
  email: string;
  category: string;
  location: string | null;
  website: string | null;
  message: string | null;
  /** JSON-encoded `string[]` (URLs) or null. Parsed via `parsePortfolioLinks`
   *  on read — defensive against legacy / hand-edited rows. */
  portfolio_links: string | null;
  instagram_handle: string | null;
  status: string;
  reviewed_by_user_id: number | null;
  reviewed_at: number | null;
  outcome_at: number | null;
  notes: string | null;
  sent_subject: string | null;
  sent_body: string | null;
  created_at: number;
}

/** Defensive JSON parse — rows existed before the column was added, and
 *  someone hand-editing the DB could land non-JSON text in here. Drop
 *  garbage rather than throwing; a bad value loses the portfolio links but
 *  never blocks the admin list. */
function parsePortfolioLinks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

/** Legacy `contacted`/`dismissed` rows pre-date the three-outcome triage
 *  redesign. We map them on read so the admin UI never has to special-case
 *  them — `contacted → accepted`, `dismissed → rejected`. New writes only
 *  emit the canonical four-value union. */
function toStatus(s: string): VendorWaitlistStatus {
  if (s === "under_review" || s === "accepted" || s === "rejected") return s;
  if (s === "contacted") return "accepted";
  if (s === "dismissed") return "rejected";
  return "new";
}

export function toVendorWaitlistEntry(row: VendorWaitlistRow): VendorWaitlistEntry {
  return {
    id: row.id,
    business_name: row.business_name,
    email: row.email,
    category: row.category,
    location: row.location,
    website: row.website,
    message: row.message,
    portfolio_links: parsePortfolioLinks(row.portfolio_links),
    instagram_handle: row.instagram_handle,
    status: toStatus(row.status),
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
  };
}

export function toVendorWaitlistAdminView(row: VendorWaitlistRow): VendorWaitlistAdminView {
  return {
    id: row.id,
    business_name: row.business_name,
    email: row.email,
    category: row.category,
    location: row.location,
    website: row.website,
    message: row.message,
    portfolio_links: parsePortfolioLinks(row.portfolio_links),
    instagram_handle: row.instagram_handle,
    status: toStatus(row.status),
    reviewed_at: row.reviewed_at,
    outcome_at: row.outcome_at,
    notes: row.notes,
    sent_subject: row.sent_subject,
    sent_body: row.sent_body,
    created_at: row.created_at,
  };
}

export function listVendorWaitlist(): VendorWaitlistRow[] {
  return db
    .prepare("SELECT * FROM vendor_waitlist ORDER BY created_at DESC")
    .all() as VendorWaitlistRow[];
}

export function getVendorWaitlistById(id: number): VendorWaitlistRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_waitlist WHERE id = ?").get(id) as
      | VendorWaitlistRow
      | undefined) ?? null
  );
}

export function insertVendorWaitlist(input: {
  business_name: string;
  email: string;
  category: string;
  location: string | null;
  website: string | null;
  message: string | null;
  portfolio_links: string[];
  instagram_handle: string | null;
}): VendorWaitlistRow {
  const ts = now();
  // Empty array serialises to null on the row — keeps the column NULL for
  // submissions without portfolio, so the admin can `WHERE portfolio_links
  // IS NOT NULL` if we ever want to filter on it.
  const portfolioJson =
    input.portfolio_links.length > 0 ? JSON.stringify(input.portfolio_links) : null;
  const result = db
    .prepare(
      `INSERT INTO vendor_waitlist (business_name, email, category, location, website, message, portfolio_links, instagram_handle, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .run(
      input.business_name,
      input.email,
      input.category,
      input.location,
      input.website,
      input.message,
      portfolioJson,
      input.instagram_handle,
      ts,
    );
  const row = getVendorWaitlistById(Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to read inserted waitlist row");
  return row;
}

/** Atomic transition out of the inbox: stamps the outcome, the reviewer,
 *  `outcome_at`, the admin's private notes, and the last-sent template
 *  subject/body all in one UPDATE. The email itself fires from the route
 *  handler — this function only owns the DB write. */
export function decideVendorWaitlist(
  id: number,
  input: {
    outcome: VendorWaitlistOutcome;
    notes: string;
    sent_subject: string;
    sent_body: string;
  },
  reviewerUserId: number,
): VendorWaitlistRow | null {
  const ts = now();
  db.prepare(
    `UPDATE vendor_waitlist
     SET status = ?,
         reviewed_by_user_id = ?,
         reviewed_at = ?,
         outcome_at = ?,
         notes = ?,
         sent_subject = ?,
         sent_body = ?
     WHERE id = ?`,
  ).run(
    input.outcome,
    reviewerUserId,
    ts,
    ts,
    input.notes,
    input.sent_subject,
    input.sent_body,
    id,
  );
  return getVendorWaitlistById(id);
}

/** Re-open: status → 'new', clear `outcome_at` and `reviewed_at`. Notes +
 *  last-sent subject/body stay on the row so the admin can see the prior
 *  outreach if they decide differently the second time around. */
export function reopenVendorWaitlist(id: number, reviewerUserId: number): VendorWaitlistRow | null {
  db.prepare(
    `UPDATE vendor_waitlist
     SET status = 'new',
         reviewed_by_user_id = ?,
         reviewed_at = NULL,
         outcome_at = NULL
     WHERE id = ?`,
  ).run(reviewerUserId, id);
  return getVendorWaitlistById(id);
}
