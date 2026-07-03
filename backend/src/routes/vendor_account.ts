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
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { addAuditLog } from "../lib/audit";
import { now } from "../db";
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

// Mirrors the listing editor's limits where the same kind of field exists.
const MAX_DISPLAY_NAME_LEN = 200;
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
  router.patch("/api/vendor/account", handlePatchAccount);
  router.get("/api/vendor/export", handleExport);
}
