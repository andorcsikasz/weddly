// Vendor account = the legal payee. 1:1 with a `users` row of role='vendor'.
// Created on completion of a listing claim (P2.C) and, later (Phase 2.5+),
// during a self-serve vendor signup. One account can own N `listings` —
// we model that even though v1 mostly sees 1:1 (a photo+video studio that
// wants two cards under one payout is the prototypical N:1 case).
//
// Phase 3 will add stripe_account_id, KYC fields, and payout-related state.
// Kept off P2.C by design — don't pre-build infra.

import type { AdminVendorView, VendorAccount } from "@shared/listings";
import type { SupplierCategory } from "@shared/suppliers";
import { computeVendorEntitlement, type VendorSubscriptionStatus } from "@shared/vendor_billing";
import { vendorPlanFromEntitlement } from "@shared/vendor_plan";
import { db, now } from "../db";
import { generateVendorCode } from "./invite_codes";
import { aggregateAnalytics, sumAnalytics } from "./supplier_views";
import { isVendorListingIncomplete, vendorListingMissing } from "./vendor_profile";

export interface VendorAccountRow {
  id: number;
  vendor_code: string | null;
  owner_user_id: number;
  display_name: string;
  company_name: string | null;
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
    company_name: row.company_name,
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
  /** Legal company name shown small under the brand; optional at signup. */
  companyName?: string | null;
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
         (vendor_code, owner_user_id, display_name, company_name, contact_email, contact_phone, vat_number,
          country, registry_number, legal_form, address, city, postal_code,
          onboarding_done, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uniqueVendorCode(),
      input.ownerUserId,
      input.displayName,
      input.companyName ?? null,
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
  sub_trial_ends_at: number | null;
  sub_founding_until: number | null;
  sub_is_founding_member: number | null;
  sub_lead_credits_used: number | null;
  sub_billing_starts_at: number | null;
  sub_card_on_file: number | null;
  sub_current_period_end: number | null;
  listing_count: number;
  /** Comma-separated distinct listing categories (SQLite GROUP_CONCAT), or null
   *  when the vendor has no listings yet. */
  categories: string | null;
  /** Recurring incomplete-listing reminder bookkeeping (SELECT va.*). */
  profile_nudge_count: number;
  profile_nudge_last_at: number | null;
  /** Owner activity + demand + reputation, all correlated subqueries on the one
   *  admin list query rather than an N+1 per row. */
  owner_last_seen_at: number | null;
  inquiry_count: number;
  review_count: number;
  review_avg: number | null;
  listing_updated_at: number | null;
}

/** Split the GROUP_CONCAT category blob into a clean SupplierCategory[]. */
function splitCategories(raw: string | null): SupplierCategory[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as SupplierCategory[];
}

export function toAdminVendorView(row: AdminVendorRow): AdminVendorView {
  // Listing completeness via the shared helper so the admin badge, the auto
  // sweep, and the reminder email can never disagree on "what's missing".
  const missing = vendorListingMissing(row.id);
  // Derive the FREE/PRO tier the same way the vendor's own billing surface
  // does (computeVendorEntitlement) so admin and vendor can never disagree.
  let plan: AdminVendorView["plan"] = null;
  let billingReason: AdminVendorView["billing_reason"] = null;
  if (row.subscription_status) {
    const { entitled, reason } = computeVendorEntitlement(
      row.subscription_status as VendorSubscriptionStatus,
      {
        trial_ends_at: row.sub_trial_ends_at,
        founding_until: row.sub_founding_until,
        lead_credits_used: row.sub_lead_credits_used ?? 0,
        billing_starts_at: row.sub_billing_starts_at,
        nowMs: Date.now(),
      },
    );
    plan = vendorPlanFromEntitlement(entitled);
    billingReason = reason;
  }
  return {
    state: "active",
    id: row.id,
    vendor_code: row.vendor_code,
    display_name: row.display_name,
    company_name: row.company_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    vat_number: row.vat_number,
    onboarding_done: row.onboarding_done === 1,
    owner_user_id: row.owner_user_id,
    owner_email: row.owner_email,
    owner_status: row.owner_status === "suspended" ? "suspended" : "active",
    subscription_status: row.subscription_status,
    plan,
    billing_reason: billingReason,
    is_founding_member: row.sub_is_founding_member === 1,
    founding_until: row.sub_founding_until,
    trial_ends_at: row.sub_trial_ends_at,
    card_on_file: row.sub_card_on_file === 1,
    billing_starts_at: row.sub_billing_starts_at,
    current_period_end: row.sub_current_period_end,
    lead_credits_used: row.sub_lead_credits_used,
    listing_count: row.listing_count,
    categories: splitCategories(row.categories),
    token_expired: false,
    listing_missing: missing,
    listing_incomplete: isVendorListingIncomplete(missing),
    profile_nudge_count: row.profile_nudge_count ?? 0,
    profile_nudge_last_at: row.profile_nudge_last_at,
    owner_last_seen_at: row.owner_last_seen_at,
    inquiry_count: row.inquiry_count ?? 0,
    review_count: row.review_count ?? 0,
    // SQLite AVG returns a full float; one decimal is all a star rating means.
    review_avg: row.review_avg == null ? null : Math.round(row.review_avg * 10) / 10,
    listing_updated_at: row.listing_updated_at,
    created_at: row.created_at,
  };
}

export function listAdminVendorAccounts(): AdminVendorView[] {
  const rows = db
    .prepare(
      `SELECT va.*,
              u.email  AS owner_email,
              u.status AS owner_status,
              vs.subscription_status  AS subscription_status,
              vs.trial_ends_at        AS sub_trial_ends_at,
              vs.founding_until       AS sub_founding_until,
              vs.is_founding_member   AS sub_is_founding_member,
              vs.lead_credits_used    AS sub_lead_credits_used,
              vs.billing_starts_at    AS sub_billing_starts_at,
              vs.card_on_file         AS sub_card_on_file,
              vs.current_period_end   AS sub_current_period_end,
              u.last_seen_at          AS owner_last_seen_at,
              (SELECT COUNT(*) FROM listings l WHERE l.vendor_account_id = va.id) AS listing_count,
              (SELECT GROUP_CONCAT(DISTINCT l.category) FROM listings l WHERE l.vendor_account_id = va.id) AS categories,
              (SELECT MAX(l.updated_at) FROM listings l WHERE l.vendor_account_id = va.id) AS listing_updated_at,
              (SELECT COUNT(*) FROM supplier_bookings b WHERE b.vendor_account_id = va.id) AS inquiry_count,
              -- Reviews hang off the LISTING (supplier_id), not the account, so
              -- they are counted across everything this vendor owns: their own
              -- v{N} card plus any curated listing they claimed.
              (SELECT COUNT(*) FROM supplier_reviews r
                 JOIN listings l ON l.id = r.supplier_id
                WHERE l.vendor_account_id = va.id
                  AND r.published = 1 AND r.deleted_at IS NULL) AS review_count,
              (SELECT AVG(r.rating) FROM supplier_reviews r
                 JOIN listings l ON l.id = r.supplier_id
                WHERE l.vendor_account_id = va.id
                  AND r.published = 1 AND r.deleted_at IS NULL) AS review_avg
         FROM vendor_accounts va
         LEFT JOIN users u ON u.id = va.owner_user_id
         LEFT JOIN vendor_subscriptions vs ON vs.vendor_account_id = va.id
        -- Demo vendors (demo-…@demo.weddly.local owner) are kept out of the
        -- admin vendor list + its filter counts, mirroring how listAdminPlanners
        -- excludes demo planners. They stay visible, distinguished, in the admin
        -- Users overview's Demo section. Purged owners (deleted-…@purged.local
        -- tombstones) are dropped entirely — a deleted account must never show.
        WHERE u.email IS NULL
           OR (u.email NOT LIKE '%@demo.weddly.local' AND u.email NOT LIKE '%@purged.local')
        ORDER BY va.created_at DESC`,
    )
    .all() as AdminVendorRow[];
  const views = rows.map(toAdminVendorView);

  // Roll directory analytics (supplier_events) into each vendor. A vendor's
  // reach is the sum across every listing it owns — its `v{N}` card plus any
  // curated/community listing it has claimed. One events scan + one listings
  // scan, then an in-memory group-by keyed on vendor_account_id.
  const perListing = aggregateAnalytics();
  const idsByVendor = new Map<number, string[]>();
  const links = db
    .prepare("SELECT id, vendor_account_id FROM listings WHERE vendor_account_id IS NOT NULL")
    .all() as { id: string; vendor_account_id: number }[];
  for (const l of links) {
    const arr = idsByVendor.get(l.vendor_account_id) ?? [];
    arr.push(l.id);
    idsByVendor.set(l.vendor_account_id, arr);
  }
  for (const v of views) {
    v.analytics = sumAnalytics(idsByVendor.get(v.id) ?? [], perListing);
  }
  return views;
}

export interface UpdateVendorAccountInput {
  display_name?: string;
  company_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  vat_number?: string | null;
  country?: string | null;
  registry_number?: string | null;
  legal_form?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
}

/** Edit of a vendor's business details (admin surface + vendor self-serve).
 *  Only present keys are applied; returns the fresh row (or null if the
 *  account is gone).
 *
 *  A VENDOR HAS EXACTLY ONE NAME, and this is one of its two write paths (the
 *  other is PATCH /api/users/me, which comes straight back here). The portal
 *  used to show two: `users.full_name` on the Fiók tab and this column on
 *  Cégadatok, labelled "Megjelenített név" and "Megjelenő név" — two strings a
 *  reader cannot tell apart, only one of which the header, the settings hero
 *  and the public listing actually used. A vendor renaming themselves in the
 *  wrong one saw nothing change anywhere and had no way to find out why
 *  (reported 2026-08-05). So a rename here flows to BOTH the claimed listing
 *  and the owner's `users.full_name` in the same call. */
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
  if (input.company_name !== undefined) {
    sets.push("company_name = ?");
    vals.push(input.company_name);
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
  if (input.country !== undefined) {
    sets.push("country = ?");
    vals.push(input.country);
  }
  if (input.registry_number !== undefined) {
    sets.push("registry_number = ?");
    vals.push(input.registry_number);
  }
  if (input.legal_form !== undefined) {
    sets.push("legal_form = ?");
    vals.push(input.legal_form);
  }
  if (input.address !== undefined) {
    sets.push("address = ?");
    vals.push(input.address);
  }
  if (input.city !== undefined) {
    sets.push("city = ?");
    vals.push(input.city);
  }
  if (input.postal_code !== undefined) {
    sets.push("postal_code = ?");
    vals.push(input.postal_code);
  }
  if (sets.length > 0) {
    const ts = now();
    sets.push("updated_at = ?");
    db.prepare(`UPDATE vendor_accounts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, ts, id);
    // The display name IS the public brand name, so a rename must flow to the
    // vendor's OWN listing (source='claimed', id `v{N}`). Curated/community
    // mirror rows (source != 'claimed') are deliberately left alone — their
    // name is code-managed and re-synced from suppliers_data.ts on every boot,
    // so writing here would just be reverted (and would bypass the
    // anti-hostile-rename guard on entries a vendor merely claimed).
    if (input.display_name !== undefined) {
      db.prepare(
        "UPDATE listings SET name = ?, updated_at = ? WHERE vendor_account_id = ? AND source = 'claimed'",
      ).run(input.display_name, ts, id);
      // ...and to the owner's account name, which is the same name (see above).
      // A subquery rather than a second read: the owner is a NOT NULL column on
      // the row we just wrote, so there is nothing to look up first.
      db.prepare(
        `UPDATE users SET full_name = ?, updated_at = ?
          WHERE id = (SELECT owner_user_id FROM vendor_accounts WHERE id = ?)`,
      ).run(input.display_name, ts, id);
    }
  }
  return getVendorAccountById(id);
}
