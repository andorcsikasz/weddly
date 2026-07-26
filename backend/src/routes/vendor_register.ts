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

import { randomBytes } from "node:crypto";
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
import { verifyGoogleCredential } from "../lib/google_oauth";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { requireHttpUrl } from "../lib/url";
import { AUTH_BUCKET, rateLimit } from "../lib/rate_limit";
import { createVerificationToken } from "./email_verify";

/** Thrown from an `insertUser` callback on a UNIQUE(email) collision so
 *  `provisionVendor` can map the transaction failure to a clean 409. */
const ERR_EMAIL_TAKEN = "race:email_taken";

/** Flat set of every valid supplier category, built once from the taxonomy
 *  source of truth so an unknown category is rejected at the boundary. */
// `other` isn't a browse category (it's absent from SUPPLIER_GROUPS) but stays a
// valid REGISTRATION choice: a vendor whose trade doesn't fit picks "other" and
// supplies a free-text custom_category.
const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  ...SUPPLIER_GROUPS.flatMap((g) => g.categories),
  "other",
]);

/** Categories that exist in the taxonomy but are NOT self-selectable through
 *  vendor signup, because they are a different product relationship. A
 *  `wedding_planner` is a workspace COLLABORATOR the couple invites via the
 *  dedicated /planners flow, not a directory listing you cold-contact. Letting
 *  a planner self-register as a vendor is exactly the leak that seeds planner
 *  cards into the vendor catalog. The category stays valid everywhere else
 *  (admin-register, curated seed listings, the couple directory). */
const SELF_SERVE_BLOCKED_CATEGORIES: ReadonlySet<string> = new Set(["wedding_planner"]);

interface VendorRegisterBody {
  email?: unknown;
  password?: unknown;
  full_name?: unknown;
  business_name?: unknown;
  company_name?: unknown;
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
  if (SELF_SERVE_BLOCKED_CATEGORIES.has(raw)) {
    throw new HttpError(400, "Wedding planners sign up through the planner flow at /planners", {
      code: "planner_use_planner_flow",
    });
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

/** Optional website, scheme-guarded: the listing's website renders as a live
 *  href in the directory + admin panel, so only http(s) may be stored. */
function parseOptionalWebsite(raw: unknown): string | null {
  const trimmed = parseOptional(raw, 240);
  return trimmed === null ? null : requireHttpUrl(trimmed, "website");
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

/** Everything the vendor-account/listing/billing transaction needs. `email` is
 *  the account contact email — the form email on the password path, the
 *  Google-verified email on the Google path. */
interface VendorProvisionInput {
  email: string;
  /** Public brand / display name — becomes the listing name + display_name. */
  businessName: string;
  /** Legal company name shown small under the brand; optional. */
  companyName: string | null;
  category: SupplierCategory;
  customCategory: string | null;
  country: string | null;
  registryNumber: string | null;
  vatNumber: string | null;
  legalForm: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  contactPhone: string | null;
  website: string | null;
}

/** Parse + validate the company/business (step 2) fields shared by the password
 *  and Google signup paths. */
function parseBusinessFields(body: VendorRegisterBody, email: string): VendorProvisionInput {
  const category = parseCategory(body.category);
  return {
    email,
    businessName: parseName(body.business_name, "Business name", 120),
    companyName: parseOptional(body.company_name, 120),
    category,
    customCategory: parseCustomCategory(body.custom_category, category),
    country: parseCountry(body.country),
    registryNumber: parseOptional(body.registry_number, 40),
    vatNumber: parseOptional(body.vat_number, 40),
    legalForm: parseOptional(body.legal_form, 80),
    address: parseOptional(body.address, 240),
    city: parseOptional(body.city, 80),
    postalCode: parseOptional(body.postal_code, 20),
    contactPhone: parseOptional(body.contact_phone, 40),
    website: parseOptionalWebsite(body.website),
  };
}

/** Run the atomic user-insert + vendor_account + listing + billing transaction.
 *  `insertUser` is the differing piece (password vs Google) — it inserts the
 *  users row and returns the new id, throwing Error(ERR_EMAIL_TAKEN) on a
 *  UNIQUE(email) collision. */
function provisionVendor(
  insertUser: () => number,
  input: VendorProvisionInput,
  currency: ReturnType<typeof vendorCurrencyForLocale>,
  ts: number,
): { userId: number; vendorAccountId: number } {
  let userId = 0;
  let vendorAccountId = 0;
  const tx = db.transaction(() => {
    userId = insertUser();
    const account = createVendorAccount({
      ownerUserId: userId,
      displayName: input.businessName,
      companyName: input.companyName,
      contactEmail: input.email,
      contactPhone: input.contactPhone,
      vatNumber: input.vatNumber,
      country: input.country,
      registryNumber: input.registryNumber,
      legalForm: input.legalForm,
      address: input.address,
      city: input.city,
      postalCode: input.postalCode,
      onboardingDone: false, // run the in-app wizard after signup
    });
    vendorAccountId = account.id;
    // Give the vendor a live listing to land on + refine in the wizard, seeded
    // with whatever the company step collected so it opens prefilled.
    createVendorListing({
      vendorAccountId,
      category: input.category,
      customCategory: input.customCategory,
      name: input.businessName,
      city: input.city ?? "",
      address: input.address,
      contactEmail: input.email,
      contactPhone: input.contactPhone,
      website: input.website,
    });
    // Founding (free year) or trial — inside the tx so the cohort count and the
    // grant stay consistent with the account creation.
    initVendorBilling(vendorAccountId, currency, ts);
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
  return { userId, vendorAccountId };
}

/** Post-transaction side effects shared by both signup paths: GDPR consent
 *  ledger, audit, growth event, optional welcome/verify email, and the issued
 *  session response. */
async function finalizeVendorSignup(
  ctx: Ctx,
  input: {
    userId: number;
    vendorAccountId: number;
    email: string;
    fullName: string;
    category: SupplierCategory;
    currency: ReturnType<typeof vendorCurrencyForLocale>;
    auditAction: string;
    /** The password path sends a verify email (verified_email=0); the Google
     *  path skips it because Google already attested the address. */
    sendVerifyEmail: boolean;
  },
): Promise<Response> {
  const ip = ctx.clientIp;
  const userAgent = ctx.req.headers.get("user-agent");
  recordConsent({
    subjectUserId: input.userId,
    subjectKind: "user",
    subjectRef: null,
    document: "privacy",
    version: PRIVACY_VERSION,
    ip,
    userAgent,
  });
  recordConsent({
    subjectUserId: input.userId,
    subjectKind: "user",
    subjectRef: null,
    document: "terms",
    version: TERMS_VERSION,
    ip,
    userAgent,
  });

  addAuditLog({
    actor_user_id: input.userId,
    couple_id: null,
    action: input.auditAction,
    target_kind: "vendor_account",
    target_id: input.vendorAccountId,
    after: { email: input.email, category: input.category, currency: input.currency },
  });

  recordGrowthEvent("signup.completed", {
    user_id: input.userId,
    user_agent: userAgent,
    payload: { role: "vendor" },
  });

  if (input.sendVerifyEmail) {
    // Welcome + verification — single email, both purposes. Soft verification:
    // signup is never blocked on it. Fire-and-forget so a mailer outage doesn't
    // fail registration.
    const verifyToken = createVerificationToken(input.userId);
    const verifyUrl = `${CONFIG.frontendBaseUrl}/verify-email/${verifyToken}`;
    void sendKind(
      "welcome_verify",
      { verifyUrl },
      { user: { id: input.userId, email: input.email, full_name: input.fullName } },
    );
  }

  const token = issueSession(input.userId);
  const userRow = getUserById(input.userId);
  if (!userRow) throw new HttpError(500, "User vanished after vendor registration");
  const session: AuthSession = { token, user: toUser(userRow as UserRow) };
  return json(session, { status: 201 });
}

async function handleRegister(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "vendor:register", AUTH_BUCKET);
  const body = await readJson<VendorRegisterBody>(ctx.req);

  const email = parseEmail(body.email);
  const password = parsePassword(body.password);
  const fullName = parseName(body.full_name, "Name", 200);
  const input = parseBusinessFields(body, email);

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

  const insertUser = () => {
    try {
      const res = db
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
      return Number(res.lastInsertRowid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) throw new Error(ERR_EMAIL_TAKEN);
      throw e;
    }
  };

  const { userId, vendorAccountId } = provisionVendor(insertUser, input, currency, ts);
  return finalizeVendorSignup(ctx, {
    userId,
    vendorAccountId,
    email,
    fullName,
    category: input.category,
    currency,
    auditAction: "vendor.register",
    sendVerifyEmail: true,
  });
}

/** Google-based vendor signup — same provisioning as the password path, but the
 *  identity comes from a verified Google credential instead of a password. The
 *  business (step 2) fields still ride along in the body; the frontend holds the
 *  credential from step 1 and submits it together with them. */
async function handleRegisterGoogle(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "vendor:register", AUTH_BUCKET);
  if (!CONFIG.googleClientId && !CONFIG.googleTestBypass) {
    throw new HttpError(503, "Google sign-in is not configured");
  }
  const body = await readJson<VendorRegisterBody & { credential?: unknown }>(ctx.req);

  const credential = body.credential;
  if (typeof credential !== "string" || credential.length === 0) {
    throw new HttpError(400, "Missing Google credential");
  }
  let identity;
  try {
    identity = await verifyGoogleCredential(credential);
  } catch (e) {
    ctx.log.warn("vendor.google_verify_failed", { error: String(e) });
    throw new HttpError(401, "Google credential rejected");
  }
  if (!identity.email_verified) {
    throw new HttpError(400, "Google account email is not verified");
  }

  const email = identity.email.trim().toLowerCase();
  const fullName = identity.name.length > 0 ? identity.name.slice(0, 200) : email;
  const input = parseBusinessFields(body, email);

  if (body.privacy_version !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date — please refresh the page");
  }
  if (body.terms_version !== TERMS_VERSION) {
    throw new HttpError(400, "Terms version is out of date — please refresh the page");
  }
  // A Weddly account already on this email (couple or vendor) blocks the fresh
  // vendor signup, exactly like the password path. The user can link Google to
  // an existing account through the normal login flow instead.
  if (getUserByEmail(email)) {
    throw new HttpError(409, "An account with this email already exists", { code: "email_taken" });
  }

  // Google-only account: NOT NULL password_hash gets a random unguessable value
  // (argon2id'd), password_set=0, verified_email=1 (Google attests it). Mirrors
  // auth_google.ts's brand-new branch, but with role='vendor'.
  const placeholderPw = `${randomBytes(32).toString("hex")}${randomBytes(32).toString("hex")}`;
  const passwordHash = await hashPassword(placeholderPw);
  const ts = now();
  const persistedLocale = body.locale === "hu" || body.locale === "en" ? body.locale : null;
  const currency = vendorCurrencyForLocale(persistedLocale);
  const acq = buildSignupAcquisition(ctx, body);

  const insertUser = () => {
    try {
      const res = db
        .prepare(
          `INSERT INTO users
             (email, password_hash, full_name, status, role, verified_email,
              google_sub, password_set, locale,
              signup_country, device_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
              created_at, updated_at)
           VALUES (?, ?, ?, 'active', 'vendor', 1, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          email,
          passwordHash,
          fullName,
          identity.sub,
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
      return Number(res.lastInsertRowid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) throw new Error(ERR_EMAIL_TAKEN);
      throw e;
    }
  };

  const { userId, vendorAccountId } = provisionVendor(insertUser, input, currency, ts);
  return finalizeVendorSignup(ctx, {
    userId,
    vendorAccountId,
    email,
    fullName,
    category: input.category,
    currency,
    auditAction: "vendor.register_google",
    sendVerifyEmail: false,
  });
}

export function registerVendorRegisterRoutes(router: Router) {
  router.post("/api/vendor/register", handleRegister);
  router.post("/api/vendor/register/google", handleRegisterGoogle);
}
