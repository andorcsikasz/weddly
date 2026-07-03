// Vendor account = the legal payee. 1:1 with a `users` row of role='vendor'.
// Created on completion of a listing claim (P2.C) and, later (Phase 2.5+),
// during a self-serve vendor signup. One account can own N `listings` —
// we model that even though v1 mostly sees 1:1 (a photo+video studio that
// wants two cards under one payout is the prototypical N:1 case).
//
// Phase 3 will add stripe_account_id, KYC fields, and payout-related state.
// Kept off P2.C by design — don't pre-build infra.

import type { AdminVendorView, VendorAccount } from "@shared/listings";
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
  country: string | null;
  registry_number: string | null;
  legal_form: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  onboarding_done: number;
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
    country: row.country,
    registry_number: row.registry_number,
    legal_form: row.legal_form,
    address: row.address,
    city: row.city,
    postal_code: row.postal_code,
    onboarding_done: row.onboarding_done === 1,
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
  country?: string | null;
  registryNumber?: string | null;
  legalForm?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  /** Self-serve signups run the in-app onboarding wizard, so they start with
   *  `onboarding_done = 0`. The claim flow (no wizard) leaves this at the
   *  column default of 1. */
  onboardingDone?: boolean;
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
         (vendor_code, owner_user_id, display_name, contact_email, contact_phone, vat_number,
          country, registry_number, legal_form, address, city, postal_code,
          onboarding_done, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uniqueVendorCode(),
      input.ownerUserId,
      input.displayName,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.vatNumber ?? null,
      input.country ?? null,
      input.registryNumber ?? null,
      input.legalForm ?? null,
      input.address ?? null,
      input.city ?? null,
      input.postalCode ?? null,
      input.onboardingDone === false ? 0 : 1,
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

/** Admin management view — join denormalises the owner user (email + status)
 *  and the subscription snapshot, plus a listing count, so the Szolgáltatók
 *  list renders in one query without N+1 reads. */
interface AdminVendorRow extends VendorAccountRow {
  owner_email: string | null;
  owner_status: string | null;
  subscription_status: string | null;
  listing_count: number;
}

export function toAdminVendorView(row: AdminVendorRow): AdminVendorView {
  return {
    state: "active",
    id: row.id,
    vendor_code: row.vendor_code,
    display_name: row.display_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    vat_number: row.vat_number,
    onboarding_done: row.onboarding_done === 1,
    owner_user_id: row.owner_user_id,
    owner_email: row.owner_email,
    owner_status: row.owner_status === "suspended" ? "suspended" : "active",
    subscription_status: row.subscription_status,
    listing_count: row.listing_count,
    token_expired: false,
    created_at: row.created_at,
  };
}

export function listAdminVendorAccounts(): AdminVendorView[] {
  const rows = db
    .prepare(
      `SELECT va.*,
              u.email  AS owner_email,
              u.status AS owner_status,
              vs.subscription_status AS subscription_status,
              (SELECT COUNT(*) FROM listings l WHERE l.vendor_account_id = va.id) AS listing_count
         FROM vendor_accounts va
         LEFT JOIN users u ON u.id = va.owner_user_id
         LEFT JOIN vendor_subscriptions vs ON vs.vendor_account_id = va.id
        ORDER BY va.created_at DESC`,
    )
    .all() as AdminVendorRow[];
  return rows.map(toAdminVendorView);
}

export interface UpdateVendorAccountInput {
  display_name?: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  vat_number?: string | null;
}

/** Admin edit of a vendor's business details. Only present keys are applied;
 *  returns the fresh row (or null if the account is gone). */
export function updateVendorAccount(
  id: number,
  input: UpdateVendorAccountInput,
): VendorAccountRow | null {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (input.display_name !== undefined) {
    sets.push("display_name = ?");
    vals.push(input.display_name);
  }
  if (input.contact_email !== undefined) {
    sets.push("contact_email = ?");
    vals.push(input.contact_email);
  }
  if (input.contact_phone !== undefined) {
    sets.push("contact_phone = ?");
    vals.push(input.contact_phone);
  }
  if (input.vat_number !== undefined) {
    sets.push("vat_number = ?");
    vals.push(input.vat_number);
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    db.prepare(`UPDATE vendor_accounts SET ${sets.join(", ")} WHERE id = ?`).run(
      ...vals,
      now(),
      id,
    );
  }
  return getVendorAccountById(id);
}
