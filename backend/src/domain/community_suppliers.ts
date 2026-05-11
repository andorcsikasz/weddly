// User-submitted supplier rows: storage, mappers, and helpers. Auto-active on
// insert. Admins can hide (soft) or hard-delete via the admin routes.

import type {
  CommunitySupplierAdminView,
  CommunitySupplierStatus,
  PriceBand,
  SubmitCommunitySupplierInput,
} from "@shared/community_suppliers";
import type { DirectorySupplierBase, SupplierCategory } from "@shared/suppliers";
import { db, now } from "../db";

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

export function toAdminView(row: CommunitySupplierRowWithEmail): CommunitySupplierAdminView {
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
    hidden_at: row.hidden_at,
    hide_reason: row.hide_reason,
  };
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

/** Case-insensitive lookup for an *active* community supplier with the same
 *  website. Used to reject duplicate submissions before they land in the
 *  public list. Hidden duplicates don't block — admin already removed them. */
export function findActiveByWebsite(website: string): CommunitySupplierRow | null {
  return (
    (db
      .prepare(
        "SELECT * FROM community_suppliers WHERE LOWER(website) = LOWER(?) AND status = 'active' LIMIT 1",
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
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
