// Vendor self-serve account (company identity) + data takeout.
//
//   PATCH /api/vendor/account — edit the legal-payee fields the vendor gave at
//     signup (display name, contact, VAT, registry identity, address). The
//     PUBLIC listing name stays admin-moderated (see vendor_listing.ts); this
//     endpoint only touches `vendor_accounts`.
//   GET /api/vendor/export — the vendor's full data snapshot as one JSON
//     document (account + listings + billing + clients incl. payment schedule
//     + blocked dates). Deliberately NOT plan-gated: takeout of your own data
//     is a right, not a PRO feature.
//
// Authorisation: requireAuth + role === 'vendor' + an owned vendor_account
// (resolveVendorAccount) — a listing is NOT required, so a mid-onboarding
// vendor can already fix a typo in their company data.

import type { VendorAccountEditInput, VendorDataExport } from "@shared/listings";
import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { addAuditLog } from "../lib/audit";
import { db, now } from "../db";
import { listListingsByVendorAccountId } from "../domain/listings";
import { listBlockedDates } from "../domain/supplier_bookings";
import {
  toVendorAccount,
  updateVendorAccount,
  type UpdateVendorAccountInput,
} from "../domain/vendor_accounts";
import { getVendorSub, toVendorBilling } from "../domain/vendor_billing";
import { listVendorClientDetails, resolveVendorAccount } from "../domain/vendor_clients";
import { getUserById } from "../domain/users";
import { recordConsent } from "../domain/consents";

interface LegalAcceptanceBody {
  privacy_version?: unknown;
  vendor_terms_version?: unknown;
  highlighted_terms_accepted?: unknown;
}

// Demo vendors (demo-…@demo.weddly.local, see vendor_demo_seed.ts) are seeded
// with a raw INSERT INTO users, never through register/claim, so they never
// pick up a consent row and would otherwise hit this gate on their very first
// look at the workspace — a prospective vendor touring the demo has nothing
// to "review and accept". Same predicate the rest of the codebase reaps/
// excludes demo rows by.
const DEMO_EMAIL_SUFFIX = "@demo.weddly.local";

export function hasCurrentVendorAcceptance(userId: number): boolean {
  const user = getUserById(userId);
  if (user?.email.toLowerCase().endsWith(DEMO_EMAIL_SUFFIX)) return true;
  const rows = db
    .prepare(
      `SELECT document FROM user_consents
        WHERE subject_user_id = ? AND subject_kind = 'user' AND version = ?
          AND document IN ('vendor_terms', 'vendor_terms_highlighted')`,
    )
    .all(userId, VENDOR_TERMS_VERSION) as Array<{ document: string }>;
  const docs = new Set(rows.map((row) => row.document));
  return docs.has("vendor_terms") && docs.has("vendor_terms_highlighted");
}

function handleLegalStatus(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  return json({
    accepted: hasCurrentVendorAcceptance(account.owner_user_id),
    privacy_version: PRIVACY_VERSION,
    vendor_terms_version: VENDOR_TERMS_VERSION,
  });
}

async function handleAcceptLegal(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const body = await readJson<LegalAcceptanceBody>(ctx.req);
  if (
    body.privacy_version !== PRIVACY_VERSION ||
    body.vendor_terms_version !== VENDOR_TERMS_VERSION
  ) {
    throw new HttpError(409, "Legal documents changed; refresh and review the current version", {
      code: "legal_version_stale",
    });
  }
  if (body.highlighted_terms_accepted !== true) {
    throw new HttpError(400, "The highlighted vendor clauses must be expressly accepted");
  }
  if (!hasCurrentVendorAcceptance(account.owner_user_id)) {
    const evidence = {
      subjectUserId: account.owner_user_id,
      subjectKind: "user" as const,
      subjectRef: null,
      ip: ctx.clientIp,
      userAgent: ctx.req.headers.get("user-agent"),
    };
    recordConsent({ ...evidence, document: "privacy", version: PRIVACY_VERSION });
    recordConsent({ ...evidence, document: "vendor_terms", version: VENDOR_TERMS_VERSION });
    recordConsent({
      ...evidence,
      document: "vendor_terms_highlighted",
      version: VENDOR_TERMS_VERSION,
    });
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.legal_acceptance",
      target_kind: "vendor_account",
      target_id: account.id,
      after: { privacy_version: PRIVACY_VERSION, vendor_terms_version: VENDOR_TERMS_VERSION },
    });
  }
  return json({ accepted: true });
}

// Mirrors the listing editor's limits where the same kind of field exists.
const MAX_DISPLAY_NAME_LEN = 200;
const MAX_COMPANY_NAME_LEN = 120;
const MAX_EMAIL_LEN = 120;
const MAX_PHONE_LEN = 40;
const MAX_VAT_LEN = 40;
const MAX_COUNTRY_LEN = 2;
const MAX_REGISTRY_LEN = 60;
const MAX_LEGAL_FORM_LEN = 80;
const MAX_ADDRESS_LEN = 240;
const MAX_CITY_LEN = 80;
const MAX_POSTAL_LEN = 16;

/** Validate + coerce one nullable string field. Empty string normalises to
 *  `null` (clearing via the UI == omitting in JSON), same contract as the
 *  listing PATCH. */
function parseNullableString(
  raw: unknown,
  field: string,
  maxLen: number,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new HttpError(400, `${field} must be a string or null`);
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLen) {
    throw new HttpError(400, `${field} is too long (${trimmed.length} > ${maxLen})`);
  }
  return trimmed;
}

function buildAccountPatch(body: VendorAccountEditInput): UpdateVendorAccountInput {
  const patch: UpdateVendorAccountInput = {};
  // display_name is NOT NULL — clearing it is rejected rather than nulled.
  if (body.display_name !== undefined) {
    if (typeof body.display_name !== "string") {
      throw new HttpError(400, "display_name must be a string");
    }
    const trimmed = body.display_name.trim();
    if (trimmed.length === 0) throw new HttpError(400, "display_name cannot be empty");
    if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
      throw new HttpError(
        400,
        `display_name is too long (${trimmed.length} > ${MAX_DISPLAY_NAME_LEN})`,
      );
    }
    patch.display_name = trimmed;
  }
  const companyName = parseNullableString(body.company_name, "company_name", MAX_COMPANY_NAME_LEN);
  if (companyName !== undefined) patch.company_name = companyName;
  const contactEmail = parseNullableString(body.contact_email, "contact_email", MAX_EMAIL_LEN);
  if (contactEmail !== undefined) patch.contact_email = contactEmail;
  const contactPhone = parseNullableString(body.contact_phone, "contact_phone", MAX_PHONE_LEN);
  if (contactPhone !== undefined) patch.contact_phone = contactPhone;
  const vat = parseNullableString(body.vat_number, "vat_number", MAX_VAT_LEN);
  if (vat !== undefined) patch.vat_number = vat;
  const country = parseNullableString(body.country, "country", MAX_COUNTRY_LEN);
  if (country !== undefined) patch.country = country ? country.toUpperCase() : country;
  const registry = parseNullableString(body.registry_number, "registry_number", MAX_REGISTRY_LEN);
  if (registry !== undefined) patch.registry_number = registry;
  const legalForm = parseNullableString(body.legal_form, "legal_form", MAX_LEGAL_FORM_LEN);
  if (legalForm !== undefined) patch.legal_form = legalForm;
  const address = parseNullableString(body.address, "address", MAX_ADDRESS_LEN);
  if (address !== undefined) patch.address = address;
  const city = parseNullableString(body.city, "city", MAX_CITY_LEN);
  if (city !== undefined) patch.city = city;
  const postal = parseNullableString(body.postal_code, "postal_code", MAX_POSTAL_LEN);
  if (postal !== undefined) patch.postal_code = postal;
  return patch;
}

async function handlePatchAccount(ctx: Ctx): Promise<Response> {
  const accountRow = resolveVendorAccount(ctx);
  const body = await readJson<VendorAccountEditInput>(ctx.req);
  const patch = buildAccountPatch(body);
  const updated = updateVendorAccount(accountRow.id, patch);
  if (!updated) throw new HttpError(404, "Vendor account vanished mid-update");
  addAuditLog({
    actor_user_id: accountRow.owner_user_id,
    couple_id: null,
    action: "vendor.account_update",
    target_kind: "vendor_account",
    target_id: accountRow.id,
    after: { fields: Object.keys(patch) },
  });
  return json({ account: toVendorAccount(updated) });
}

async function handleExport(ctx: Ctx): Promise<Response> {
  const accountRow = resolveVendorAccount(ctx);
  const user = getUserById(accountRow.owner_user_id);
  if (!user) throw new HttpError(401, "User not found");
  const sub = getVendorSub(accountRow.id);
  const payload: VendorDataExport = {
    exported_at: now(),
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      locale: user.locale ?? null,
      created_at: user.created_at,
    },
    account: toVendorAccount(accountRow),
    listings: listListingsByVendorAccountId(accountRow.id),
    billing: sub ? toVendorBilling(sub) : null,
    clients: listVendorClientDetails(accountRow.id),
    blocked_dates: listBlockedDates(accountRow.id),
  };
  addAuditLog({
    actor_user_id: accountRow.owner_user_id,
    couple_id: null,
    action: "vendor.data_export",
    target_kind: "vendor_account",
    target_id: accountRow.id,
    after: { listings: payload.listings.length, clients: payload.clients.length },
  });
  return json(payload);
}

export function registerVendorAccountRoutes(router: Router) {
  router.patch("/api/vendor/account", handlePatchAccount, true);
  router.get("/api/vendor/export", handleExport, true);
  router.get("/api/vendor/legal-status", handleLegalStatus, true);
  router.post("/api/vendor/legal-acceptance", handleAcceptLegal, true);
}
