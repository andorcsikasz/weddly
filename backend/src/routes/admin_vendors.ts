// Admin vendor management (KEZELÉS → Szolgáltatók). Lists every vendor —
// activated `vendor_accounts` plus accepted-but-not-yet-activated onboarding
// tokens — and lets an admin suspend/reactivate, delete, edit business details,
// and resend the activation link. Gated by requireAdmin() (same ADMIN_EMAILS
// allowlist as the other admin routes). Distinct from the BEÉRKEZŐ vendor
// waitlist (triage) and the community supplier moderation directory.

import { SUPPLIER_GROUPS } from "@shared/suppliers";
import { CONFIG } from "../config";
import { purgeOneUser } from "../domain/purge";
import { getUserByEmail, setUserStatus } from "../domain/users";
import { requireAdmin } from "../domain/users";
import {
  getVendorAccountById,
  listAdminVendorAccounts,
  updateVendorAccount,
} from "../domain/vendor_accounts";
import {
  cancelPendingOnboarding,
  cancelPendingOnboardingsByEmail,
  createOnboardingToken,
  getOnboardingById,
  listPendingOnboardings,
} from "../domain/vendor_onboarding";
import { sendVendorActivationEmail } from "../domain/vendor_waitlist_emails";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

/** Every valid supplier category, from the taxonomy source of truth. */
const VALID_CATEGORIES: ReadonlySet<string> = new Set(SUPPLIER_GROUPS.flatMap((g) => g.categories));

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");
  return id;
}

function handleList(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json({ active: listAdminVendorAccounts(), pending: listPendingOnboardings() });
}

/** Suspend or reactivate the vendor's owner user (users.status). Takes effect
 *  on the vendor's next request — a suspended user fails token verify. */
function setVendorStatus(ctx: Ctx, status: "active" | "suspended"): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const account = getVendorAccountById(id);
  if (!account) throw new HttpError(404, "Vendor not found");

  setUserStatus(account.owner_user_id, status);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: status === "suspended" ? "admin.vendor_suspend" : "admin.vendor_reactivate",
    target_kind: "user",
    target_id: account.owner_user_id,
    note: `vendor ${account.display_name} (#${account.id})`,
  });
  return json({ ok: true, status });
}

function handleSuspend(ctx: Ctx): Response {
  return setVendorStatus(ctx, "suspended");
}

function handleReactivate(ctx: Ctx): Response {
  return setVendorStatus(ctx, "active");
}

function handleDelete(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const account = getVendorAccountById(id);
  if (!account) throw new HttpError(404, "Vendor not found");

  // Purge the owner user; the vendor_accounts row cascades (FK ON DELETE
  // CASCADE), which in turn nulls out any owned listings' vendor_account_id.
  purgeOneUser(account.owner_user_id, { adminInitiated: true });
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.vendor_delete",
    target_kind: "user",
    target_id: account.owner_user_id,
    before: { display_name: account.display_name, vendor_account_id: account.id },
  });
  return json({ ok: true });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const account = getVendorAccountById(id);
  if (!account) throw new HttpError(404, "Vendor not found");

  const body = await readJson<{
    display_name?: unknown;
    contact_email?: unknown;
    contact_phone?: unknown;
    vat_number?: unknown;
  }>(ctx.req);

  const patch: Parameters<typeof updateVendorAccount>[1] = {};
  if (body.display_name !== undefined) {
    if (typeof body.display_name !== "string" || body.display_name.trim().length === 0) {
      throw new HttpError(400, "`display_name` must be a non-empty string");
    }
    if (body.display_name.length > 200) throw new HttpError(400, "`display_name` too long");
    patch.display_name = body.display_name.trim();
  }
  const optionalStr = (v: unknown, field: string): string | null => {
    if (v === null) return null;
    if (typeof v !== "string") throw new HttpError(400, `\`${field}\` must be a string or null`);
    const trimmed = v.trim();
    if (trimmed.length > 200) throw new HttpError(400, `\`${field}\` too long`);
    return trimmed.length === 0 ? null : trimmed;
  };
  if (body.contact_email !== undefined)
    patch.contact_email = optionalStr(body.contact_email, "contact_email");
  if (body.contact_phone !== undefined)
    patch.contact_phone = optionalStr(body.contact_phone, "contact_phone");
  if (body.vat_number !== undefined) patch.vat_number = optionalStr(body.vat_number, "vat_number");

  updateVendorAccount(id, patch);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.vendor_update",
    target_kind: "user",
    target_id: account.owner_user_id,
    note: `vendor #${account.id}`,
  });
  return json({ ok: true });
}

/** Re-send the activation link for an accepted-but-not-yet-activated vendor.
 *  Re-mints a fresh single-use token (superseding the prior pending one) and
 *  emails it via the standard branded shell. */
async function handleResendActivation(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const row = getOnboardingById(id);
  if (!row) throw new HttpError(404, "Onboarding not found");
  if (row.status === "completed") throw new HttpError(400, "Vendor already activated");

  // Supersede the exact row we're resending. createOnboardingToken only cancels
  // siblings that share a waitlist_id, so this guarantees one live token even
  // for a waitlist_id-less row.
  cancelPendingOnboarding(row.id);
  const token = createOnboardingToken({
    waitlistId: row.waitlist_id,
    businessName: row.business_name,
    email: row.email,
    category: row.category,
    locale: row.locale,
  });
  const activateUrl = `${CONFIG.frontendBaseUrl}/vendor/activate/${encodeURIComponent(token.token)}`;

  // The activation link IS the CTA button here (no admin-typed intro on the
  // resend path — the template's clear default welcome + instruction stands in).
  await sendVendorActivationEmail({
    to: row.email,
    businessName: row.business_name,
    activateUrl,
  });

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.vendor_resend_activation",
    target_kind: "vendor_onboarding",
    target_id: row.id,
    note: row.email,
  });
  return json({ ok: true });
}

/** Admin-initiated vendor registration. Mints a fresh pending onboarding for a
 *  {business name, email, category} and emails the vendor the activation link —
 *  the same "Aktiválásra vár" state the waitlist-accept path produces, but
 *  started directly by an admin (no waitlist entry, no card). The vendor sets
 *  their own password + finishes onboarding via the link. Mirrors the planner
 *  provision flow (admin_planners.ts:handleProvision). */
async function handleRegister(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<{
    email?: unknown;
    business_name?: unknown;
    category?: unknown;
  }>(ctx.req);

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length < 3 || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    throw new HttpError(400, "Email looks invalid");
  }
  const businessName = typeof body.business_name === "string" ? body.business_name.trim() : "";
  if (!businessName) throw new HttpError(400, "Business name is required");
  if (businessName.length > 120) throw new HttpError(400, "Business name too long");
  const category = typeof body.category === "string" ? body.category : "";
  if (!VALID_CATEGORIES.has(category)) throw new HttpError(400, "Pick a valid category");

  // An email already tied to a real Weddly account (any role) can't be
  // re-registered as a fresh vendor.
  if (getUserByEmail(email)) {
    throw new HttpError(409, "An account with this email already exists", { code: "email_taken" });
  }

  // One live activation link per email: supersede any prior admin-registered
  // pending row (createOnboardingToken only auto-cancels waitlist_id siblings).
  cancelPendingOnboardingsByEmail(email);
  const token = createOnboardingToken({
    waitlistId: null,
    businessName,
    email,
    category,
    locale: null,
  });
  const activateUrl = `${CONFIG.frontendBaseUrl}/vendor/activate/${encodeURIComponent(token.token)}`;
  await sendVendorActivationEmail({ to: email, businessName, activateUrl });

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.vendor_register",
    target_kind: "vendor_onboarding",
    target_id: token.id,
    after: { email, business_name: businessName, category },
  });
  return json({ ok: true, onboarding_id: token.id }, { status: 201 });
}

export function registerAdminVendorRoutes(router: Router) {
  router.get("/api/admin/vendors", handleList, true);
  router.post("/api/admin/vendors/register", handleRegister, true);
  router.post("/api/admin/vendors/:id/suspend", handleSuspend, true);
  router.post("/api/admin/vendors/:id/reactivate", handleReactivate, true);
  router.patch("/api/admin/vendors/:id", handleUpdate, true);
  router.delete("/api/admin/vendors/:id", handleDelete, true);
  router.post("/api/admin/vendors/onboarding/:id/resend", handleResendActivation, true);
}
