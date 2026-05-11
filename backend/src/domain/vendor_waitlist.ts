// Vendor waitlist submissions from the public /vendors page. No auth on
// inserts; admins triage via /app/admin/vendor-waitlist.

import { db, now } from "../db";

export type VendorWaitlistStatus = "new" | "contacted" | "dismissed";

export interface VendorWaitlistRow {
  id: number;
  business_name: string;
  email: string;
  category: string;
  location: string | null;
  message: string | null;
  status: string;
  reviewed_by_user_id: number | null;
  reviewed_at: number | null;
  created_at: number;
}

export interface VendorWaitlistEntry {
  id: number;
  business_name: string;
  email: string;
  category: string;
  location: string | null;
  message: string | null;
  status: VendorWaitlistStatus;
  reviewed_at: number | null;
  created_at: number;
}

function toStatus(s: string): VendorWaitlistStatus {
  return s === "contacted" || s === "dismissed" ? s : "new";
}

export function toVendorWaitlistEntry(row: VendorWaitlistRow): VendorWaitlistEntry {
  return {
    id: row.id,
    business_name: row.business_name,
    email: row.email,
    category: row.category,
    location: row.location,
    message: row.message,
    status: toStatus(row.status),
    reviewed_at: row.reviewed_at,
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
  message: string | null;
}): VendorWaitlistRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO vendor_waitlist (business_name, email, category, location, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'new', ?)`,
    )
    .run(input.business_name, input.email, input.category, input.location, input.message, ts);
  const row = getVendorWaitlistById(Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to read inserted waitlist row");
  return row;
}

export function setVendorWaitlistStatus(
  id: number,
  status: VendorWaitlistStatus,
  reviewerUserId: number,
): VendorWaitlistRow | null {
  const ts = now();
  db.prepare(
    `UPDATE vendor_waitlist
     SET status = ?, reviewed_by_user_id = ?, reviewed_at = ?
     WHERE id = ?`,
  ).run(status, reviewerUserId, ts, id);
  return getVendorWaitlistById(id);
}
