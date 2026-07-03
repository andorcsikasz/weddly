// Self-serve vendor signup — the planner-style "sign up directly, then run an
// in-app onboarding wizard" path that replaces the old waitlist → admin-accept →
// token-activation flow.
//
//   POST /api/vendor/register   — anon; atomic create user(role=vendor) +
//                                 vendor_account + listing + subscription,
//                                 issue a session, send the verify email.
//
// This is the listing-claim/token-onboarding completion transaction
// (routes/vendor_onboarding.ts:handleComplete) driven by a submitted form
// instead of a minted token. No card is asked — the first VENDOR_FOUNDING_CAP
// vendors get a free founding year, everyone after lands on a 14-day trial.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import type { AuthSession } from "@shared/types";
import { vendorCurrencyForLocale } from "@shared/vendor_billing";
import { hashPassword } from "../auth/password";
import { issueSession } from "../auth/session";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { recordConsent } from "../domain/consents";
import { sendKind } from "../domain/emails";
import { recordGrowthEvent } from "../domain/growth_events";
import { createVendorListing } from "../domain/listings";
import { buildSignupAcquisition } from "../domain/signup_meta";
import { createVendorAccount } from "../domain/vendor_accounts";
import { initVendorBilling } from "../domain/vendor_billing";
import { getUserById, getUserByEmail, toUser, type UserRow } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { AUTH_BUCKET, rateLimit } from "../lib/rate_limit";
import { createVerificationToken } from "./email_verify";

/** Flat set of every valid supplier category, built once from the taxonomy
 *  source of truth so an unknown category is rejected at the boundary. */
const VALID_CATEGORIES: ReadonlySet<string> = new Set(SUPPLIER_GROUPS.flatMap((g) => g.categories));

interface VendorRegisterBody {
  email?: unknown;
  password?: unknown;
  full_name?: unknown;
  business_name?: unknown;
  category?: unknown;
  custom_category?: unknown;
  country?: unknown;
  registry_number?: unknown;
  vat_number?: unknown;
  legal_form?: unknown;
  address?: unknown;
  city?: unknown;
  postal_code?: unknown;
  contact_phone?: unknown;
  website?: unknown;
  privacy_version?: unknown;
  terms_version?: unknown;
  locale?: unknown;
  referrer?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_content?: unknown;
  utm_term?: unknown;
}

function parseEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Email is required");
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 3 || !trimmed.includes("@") || trimmed.startsWith("@")) {
    throw new HttpError(400, "Email looks invalid");
  }
  return trimmed;
}

function parsePassword(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters");
  }
  if (raw.length > 1024) throw new HttpError(400, "Password too long");
  return raw;
}

function parseName(raw: unknown, field: string, maxLen: number): string {
  if (typeof raw !== "string") throw new HttpError(400, `${field} is required`);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > maxLen) {
    throw new HttpError(400, `${field} looks invalid`);
  }
  return trimmed;
}

function parseCategory(raw: unknown): SupplierCategory {
  if (typeof raw !== "string" || !VALID_CATEGORIES.has(raw)) {
    throw new HttpError(400, "Pick a valid category");
  }
  return raw as SupplierCategory;
}

/** Optional free-text company field: trimmed, empty → null, hard length cap.
 *  Missing and non-string both read as "not provided"; the whole company
 *  block is optional at signup. */
function parseOptional(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLen) throw new HttpError(400, "Field too long");
  return trimmed;
}

function parseCountry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  if (!/^[A-Z]{2}$/.test(trimmed)) throw new HttpError(400, "Country must be ISO 3166-1 alpha-2");
  return trimmed;
}

/** The vendor-written label behind category='other'. Required exactly when
 *  the vendor picked "other" (an unlabeled "other" card is useless in the
 *  directory) and dropped otherwise so a stray value can't shadow a real
 *  category. */
function parseCustomCategory(raw: unknown, category: SupplierCategory): string | null {
  if (category !== "other") return null;
  const label = parseOptional(raw, 60);
  if (!label) throw new HttpError(400, "Tell us what your service is");
  return label;
}

async function handleRegister(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "vendor:register", AUTH_BUCKET);
  const body = await readJson<VendorRegisterBody>(ctx.req);

  const email = parseEmail(body.email);
  const password = parsePassword(body.password);
  const fullName = parseName(body.full_name, "Name", 200);
  const businessName = parseName(body.business_name, "Business name", 120);
  const category = parseCategory(body.category);
  const customCategory = parseCustomCategory(body.custom_category, category);
  const country = parseCountry(body.country);
  const registryNumber = parseOptional(body.registry_number, 40);
  const vatNumber = parseOptional(body.vat_number, 40);
  const legalForm = parseOptional(body.legal_form, 80);
  const address = parseOptional(body.address, 240);
  const city = parseOptional(body.city, 80);
  const postalCode = parseOptional(body.postal_code, 20);
  const contactPhone = parseOptional(body.contact_phone, 40);
  const website = parseOptional(body.website, 240);

  // GDPR Art. 7(1): refuse a stale client so the consent ledger only ever
  // records the exact policy version the vendor actually saw (mirrors auth.ts).
  if (body.privacy_version !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date — please refresh the page");
  }
  if (body.terms_version !== TERMS_VERSION) {
    throw new HttpError(400, "Terms version is out of date — please refresh the page");
  }

  if (getUserByEmail(email)) {
    throw new HttpError(409, "An account with this email already exists", { code: "email_taken" });
  }

  const passwordHash = await hashPassword(password);
  const ts = now();
  const persistedLocale = body.locale === "hu" || body.locale === "en" ? body.locale : null;
  const currency = vendorCurrencyForLocale(persistedLocale);
  const acq = buildSignupAcquisition(ctx, body);

  let newUserId = 0;
  let newVendorAccountId = 0;
  const ERR_EMAIL_TAKEN = "race:email_taken";

  const tx = db.transaction(() => {
    let userResult;
    try {
      userResult = db
        .prepare(
          `INSERT INTO users
             (email, password_hash, full_name, status, role, verified_email, locale,
              signup_country, device_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
              created_at, updated_at)
           VALUES (?, ?, ?, 'active', 'vendor', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          email,
          passwordHash,
          fullName,
          persistedLocale,
          acq.signup_country,
          acq.device_type,
          acq.utm_source,
          acq.utm_medium,
          acq.utm_campaign,
          acq.utm_content,
          acq.utm_term,
          ts,
          ts,
        );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) throw new Error(ERR_EMAIL_TAKEN);
      throw e;
    }
    newUserId = Number(userResult.lastInsertRowid);

    const account = createVendorAccount({
      ownerUserId: newUserId,
      displayName: businessName,
      contactEmail: email,
      contactPhone,
      vatNumber,
      country,
      registryNumber,
      legalForm,
      address,
      city,
      postalCode,
      onboardingDone: false, // run the in-app wizard after signup
    });
    newVendorAccountId = account.id;

    // Give the vendor a live listing to land on + refine in the wizard,
    // seeded with whatever the company step collected so the wizard opens
    // prefilled instead of blank.
    createVendorListing({
      vendorAccountId: newVendorAccountId,
      category,
      customCategory,
      name: businessName,
      city: city ?? "",
      address,
      contactEmail: email,
      contactPhone,
      website,
    });

    // Founding (free year) or trial — inside the tx so the cohort count and the
    // grant stay consistent with the account creation.
    initVendorBilling(newVendorAccountId, currency, ts);
  });

  try {
    tx();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === ERR_EMAIL_TAKEN) {
      throw new HttpError(409, "An account with this email already exists", {
        code: "email_taken",
      });
    }
    throw e;
  }

  const ip = ctx.clientIp;
  const userAgent = ctx.req.headers.get("user-agent");
  recordConsent({
    subjectUserId: newUserId,
    subjectKind: "user",
    subjectRef: null,
    document: "privacy",
    version: PRIVACY_VERSION,
    ip,
    userAgent,
  });
  recordConsent({
    subjectUserId: newUserId,
    subjectKind: "user",
    subjectRef: null,
    document: "terms",
    version: TERMS_VERSION,
    ip,
    userAgent,
  });

  addAuditLog({
    actor_user_id: newUserId,
    couple_id: null,
    action: "vendor.register",
    target_kind: "vendor_account",
    target_id: newVendorAccountId,
    after: { email, category, currency },
  });

  recordGrowthEvent("signup.completed", {
    user_id: newUserId,
    user_agent: userAgent,
    payload: { role: "vendor" },
  });

  // Welcome + verification — single email, both purposes. Soft verification:
  // signup is never blocked on it. Fire-and-forget so a mailer outage doesn't
  // fail registration.
  const verifyToken = createVerificationToken(newUserId);
  const verifyUrl = `${CONFIG.frontendBaseUrl}/verify-email/${verifyToken}`;
  void sendKind(
    "welcome_verify",
    { verifyUrl },
    { user: { id: newUserId, email, full_name: fullName } },
  );

  const token = issueSession(newUserId);
  const userRow = getUserById(newUserId);
  if (!userRow) throw new HttpError(500, "User vanished after vendor registration");
  const session: AuthSession = { token, user: toUser(userRow as UserRow) };
  return json(session, { status: 201 });
}

export function registerVendorRegisterRoutes(router: Router) {
  router.post("/api/vendor/register", handleRegister);
}
