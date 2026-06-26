// Vendor account = the legal payee. 1:1 with a `users` row of role='vendor'.
// Created on completion of a listing claim (P2.C) and, later (Phase 2.5+),
// during a self-serve vendor signup. One account can own N `listings` —
// we model that even though v1 mostly sees 1:1 (a photo+video studio that
// wants two cards under one payout is the prototypical N:1 case).
//
// Phase 3 will add stripe_account_id, KYC fields, and payout-related state.
// Kept off P2.C by design — don't pre-build infra.

import type { VendorAccount } from "@shared/listings";
import { db, now } from "../db";
import { generateVendorCode } from "./invite_codes";

export interface VendorAccountRow {
  id: number;
  vendor_code: string | null;
  owner_user_id: number;
  display_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  vat_number: string | null;
  created_at: number;
  updated_at: number;
}

export function toVendorAccount(row: VendorAccountRow): VendorAccount {
  return {
    id: row.id,
    vendor_code: row.vendor_code,
    owner_user_id: row.owner_user_id,
    display_name: row.display_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    vat_number: row.vat_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface CreateVendorAccountInput {
  ownerUserId: number;
  displayName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  vatNumber?: string | null;
}

/** Creates the vendor_accounts row. Caller is responsible for having set
 *  users.role='vendor' on the linked user FIRST (the UNIQUE constraint on
 *  owner_user_id makes the call idempotent for that user — a second call
 *  with the same userId will fail with a UNIQUE error, which surfaces a
 *  clean "already a vendor" path at the route layer). */
/** Generates a globally-unique vendor reference code ("V" + 5 digits),
 *  retrying on the (vanishingly rare) collision and bailing loudly if the
 *  space ever saturates. Mirrors the household-code uniqueness pattern. */
export function uniqueVendorCode(): string {
  const stmt = db.prepare("SELECT 1 FROM vendor_accounts WHERE vendor_code = ?");
  for (let attempt = 0; attempt < 64; attempt++) {
    const code = generateVendorCode();
    if (!stmt.get(code)) return code;
  }
  throw new Error("Could not generate a unique vendor code");
}

export function createVendorAccount(input: CreateVendorAccountInput): VendorAccountRow {
  const ts = now();
  const r = db
    .prepare(
      `INSERT INTO vendor_accounts
         (vendor_code, owner_user_id, display_name, contact_email, contact_phone, vat_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uniqueVendorCode(),
      input.ownerUserId,
      input.displayName,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.vatNumber ?? null,
      ts,
      ts,
    );
  const id = Number(r.lastInsertRowid);
  const row = db.prepare("SELECT * FROM vendor_accounts WHERE id = ?").get(id) as
    | VendorAccountRow
    | undefined;
  if (!row) throw new Error("vendor_account.create failed");
  return row;
}

export function getVendorAccountById(id: number): VendorAccountRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_accounts WHERE id = ?").get(id) as
      | VendorAccountRow
      | undefined) ?? null
  );
}

export function getVendorAccountByOwnerUserId(userId: number): VendorAccountRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_accounts WHERE owner_user_id = ?").get(userId) as
      | VendorAccountRow
      | undefined) ?? null
  );
}
