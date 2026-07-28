// Admin vendor management (KEZELÉS → Szolgáltatók). Lists every vendor —
// activated `vendor_accounts` plus accepted-but-not-yet-activated onboarding
// tokens — and lets an admin suspend/reactivate, delete, edit business details,
// and resend the activation link. Gated by requireAdmin() (same ADMIN_EMAILS
// allowlist as the other admin routes). Distinct from the BEÉRKEZŐ vendor
// waitlist (triage) and the community supplier moderation directory.

import { SUPPLIER_GROUPS } from "@shared/suppliers";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { purgeOneUser } from "../domain/purge";
import { setVendorListingCategory } from "../domain/listings";
import { convertVendorToPlanner } from "../domain/planner_conversion";
import { sendKind } from "../domain/emails/send";
import {
  isVendorListingIncomplete,
  sendVendorIncompleteReminder,
  vendorListingMissing,
} from "../domain/vendor_profile";
import { getUserByEmail, getUserById, setUserStatus } from "../domain/users";
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
  updateOnboardingCategory,
} from "../domain/vendor_onboarding";
import { sendVendorActivationEmail } from "../domain/vendor_waitlist_emails";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

/** Every valid supplier category, from the taxonomy source of truth. */
// `other` isn't a browse category but stays a valid REGISTRATION choice paired
// with a free-text custom_category (see the "other" branch below).
const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  ...SUPPLIER_GROUPS.flatMap((g) => g.categories),
  "other",
]);

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

/** Reroute a mis-routed vendor to the planner side (KEZELÉS → Szolgáltatók →
 *  "Átteszem szervezőnek"). The motivating case is a wedding planner who came in
 *  through a vendor door — self-serve signup before the category was blocked, or
 *  a claim on a `wedding_planner` directory entry — and has been running the
 *  wrong product ever since.
 *
 *  Non-destructive where it counts: same login, the directory card is released
 *  back to unclaimed rather than deleted, and couples keep their inquiry rows.
 *  The vendor-side operational data (availability, tasks, payments, points) does
 *  go with the account, so the response reports the counts and the admin UI
 *  shows them in the confirm step. */
async function handleConvertToPlanner(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const account = getVendorAccountById(id);
  if (!account) throw new HttpError(404, "Vendor not found");

  const owner = getUserById(account.owner_user_id);
  if (!owner) throw new HttpError(404, "Vendor owner not found");
  if (owner.user_type === "planner") {
    throw new HttpError(409, "Already a planner", { code: "already_planner" });
  }

  const result = convertVendorToPlanner(id);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.vendor_convert_to_planner",
    target_kind: "user",
    target_id: account.owner_user_id,
    before: { vendor_account_id: id, display_name: account.display_name },
    after: {
      listings_released: result.listings_released,
      bookings_unlinked: result.bookings_unlinked,
      vendor_rows_deleted: result.vendor_rows_deleted,
    },
  });

  // Tell them, or their vendor dashboard just vanishes on the next sign-in with
  // no explanation. Fire-and-forget: a mailer hiccup must not fail the move.
  void sendKind(
    "vendor_moved_to_planner",
    {
      businessName: account.display_name,
      plannerUrl: `${CONFIG.frontendBaseUrl}/planner`,
    },
    { user: { id: owner.id, email: owner.email, full_name: owner.full_name ?? "" } },
  );

  return json({ ok: true, ...result });
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
    company_name?: unknown;
    contact_email?: unknown;
    contact_phone?: unknown;
    vat_number?: unknown;
    category?: unknown;
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
  // Legal company name — nullable, shown small under the brand on the card.
  if (body.company_name !== undefined)
    patch.company_name = optionalStr(body.company_name, "company_name");
  if (body.contact_email !== undefined)
    patch.contact_email = optionalStr(body.contact_email, "contact_email");
  if (body.contact_phone !== undefined)
    patch.contact_phone = optionalStr(body.contact_phone, "contact_phone");
  if (body.vat_number !== undefined) patch.vat_number = optionalStr(body.vat_number, "vat_number");

  updateVendorAccount(id, patch);

  // Category lives on the vendor's LISTING, not the account, so it takes a
  // separate write. Validated against the taxonomy the same way registration is.
  let categoryChanged: string | null = null;
  if (body.category !== undefined) {
    const category = typeof body.category === "string" ? body.category : "";
    if (!VALID_CATEGORIES.has(category)) throw new HttpError(400, "Pick a valid category");
    setVendorListingCategory(account.id, category);
    categoryChanged = category;
  }

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.vendor_update",
    target_kind: "user",
    target_id: account.owner_user_id,
    note: `vendor #${account.id}`,
    ...(categoryChanged ? { after: { category: categoryChanged } } : {}),
  });
  return json({ ok: true });
}

/** Edit a still-pending onboarding's category — the category the vendor's
 *  listing will inherit on activation. The `:id` here is the vendor_onboarding
 *  row id, not a vendor_accounts id. */
async function handleUpdateOnboarding(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const row = getOnboardingById(id);
  if (!row) throw new HttpError(404, "Onboarding not found");
  if (row.status !== "pending") throw new HttpError(400, "Onboarding is no longer pending");

  const body = await readJson<{ category?: unknown }>(ctx.req);
  const category = typeof body.category === "string" ? body.category : "";
  if (!VALID_CATEGORIES.has(category)) throw new HttpError(400, "Pick a valid category");

  updateOnboardingCategory(id, category);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.vendor_onboarding_update",
    target_kind: "vendor_onboarding",
    target_id: id,
    after: { category },
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

/** Admin "Send reminder": email the vendor the "your listing is still
 *  incomplete" nudge on demand. Unlike the automatic sweep this ignores the
 *  cadence + cap (the admin explicitly clicked), but it still advances the count
 *  so the copy variant rotates and the auto-sweep won't immediately double-send.
 *  400s when the listing is already complete (nothing to nudge). Returns the
 *  missing-section breakdown so the UI can toast specifics. */
function handleRemindIncomplete(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const row = db
    .prepare(
      `SELECT va.id, va.display_name, va.profile_nudge_count,
              u.id AS owner_user_id, u.email, u.full_name
         FROM vendor_accounts va
         JOIN users u ON u.id = va.owner_user_id
        WHERE va.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        display_name: string;
        profile_nudge_count: number;
        owner_user_id: number;
        email: string;
        full_name: string;
      }
    | undefined;
  if (!row) throw new HttpError(404, "Vendor not found");
  const missing = vendorListingMissing(row.id);
  if (!isVendorListingIncomplete(missing)) {
    throw new HttpError(400, "This vendor's listing is already complete");
  }
  sendVendorIncompleteReminder(
    {
      id: row.id,
      display_name: row.display_name,
      owner_user_id: row.owner_user_id,
      email: row.email,
      full_name: row.full_name,
      profile_nudge_count: row.profile_nudge_count,
    },
    missing,
    now(),
  );
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.vendor_profile_reminder",
    target_kind: "vendor_account",
    target_id: row.id,
    note: row.email,
  });
  return json({ ok: true, missing });
}

export function registerAdminVendorRoutes(router: Router) {
  router.get("/api/admin/vendors", handleList, true);
  router.post("/api/admin/vendors/register", handleRegister, true);
  router.post("/api/admin/vendors/:id/suspend", handleSuspend, true);
  router.post("/api/admin/vendors/:id/reactivate", handleReactivate, true);
  router.post("/api/admin/vendors/:id/remind-incomplete", handleRemindIncomplete, true);
  router.post("/api/admin/vendors/:id/convert-to-planner", handleConvertToPlanner, true);
  router.patch("/api/admin/vendors/:id", handleUpdate, true);
  router.delete("/api/admin/vendors/:id", handleDelete, true);
  router.patch("/api/admin/vendors/onboarding/:id", handleUpdateOnboarding, true);
  router.post("/api/admin/vendors/onboarding/:id/resend", handleResendActivation, true);
}
