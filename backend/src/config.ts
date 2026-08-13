// Backend runtime config. Fail-fast: production refuses to boot without a strong JWT_SECRET.

const DEV_JWT_SECRET = "dev-only-secret-change-me-in-production-please-0123456789";
const DEFAULT_EMAIL_FROM = "Weddly <onboarding@resend.dev>";
const IS_PROD = process.env.NODE_ENV === "production";

function hasStrongSigningSecret(value: string | undefined): boolean {
  if (!value || value !== value.trim() || /\s/.test(value)) return false;
  // 32 random bytes represented as hex or base64/base64url. We cannot prove
  // entropy from a string, but rejecting short/arbitrary values prevents a
  // typo such as JWT_SECRET=x from silently becoming the production key.
  if (/^[0-9a-f]{64,}$/i.test(value)) return true;
  return /^[A-Za-z0-9+/_=-]{43,}$/.test(value);
}

function configuredAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function configuredAdminTotpSecrets(): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of (process.env.ADMIN_TOTP_SECRETS ?? "").split(",")) {
    if (!entry.trim()) continue;
    const separator = entry.indexOf("=");
    const email = separator > 0 ? entry.slice(0, separator).trim().toLowerCase() : "";
    const secret =
      separator > 0
        ? entry
            .slice(separator + 1)
            .replace(/\s+/g, "")
            .toUpperCase()
        : "";
    if (!email.includes("@") || !/^[A-Z2-7]{26,}$/.test(secret)) {
      console.error(
        "[config] FATAL: ADMIN_TOTP_SECRETS must contain email=BASE32 entries with at least 128 bits of entropy.",
      );
      process.exit(1);
    }
    if (result.has(email) || [...result.values()].includes(secret)) {
      console.error("[config] FATAL: every admin must have one unique TOTP secret.");
      process.exit(1);
    }
    result.set(email, secret);
  }
  return result;
}

// Railway always injects RAILWAY_* vars into a deployed service. Treat their
// presence as "this is a real deployment" even when NODE_ENV was forgotten, so
// a misconfigured deploy can never boot on the publicly-known DEV_JWT_SECRET
// (which would let anyone forge a session token for any user — `auth/session.ts`
// signs sessions with this secret) or with an auth test-bypass enabled. This is
// additive: with NODE_ENV=production already set, behaviour is unchanged.
const ON_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
/** True when we must enforce production-grade secrets/hardening regardless of a
 *  possibly-missing NODE_ENV. */
export const REQUIRE_PROD_HARDENING = IS_PROD || ON_RAILWAY;

if (
  REQUIRE_PROD_HARDENING &&
  (!hasStrongSigningSecret(process.env.JWT_SECRET) || process.env.JWT_SECRET === DEV_JWT_SECRET)
) {
  console.error(
    "[config] FATAL: a deployed environment requires a strong JWT_SECRET " +
      "(NODE_ENV=production or a Railway deployment was detected). " +
      "Generate one with `openssl rand -hex 48` and set it in the Railway dashboard.",
  );
  process.exit(1);
}

// Refuse to boot in production with the resend.dev sandbox From address — that
// fallback only delivers to the inbox that owns the API key, so any couple who
// signs up never receives their verification email. Better to fail loudly at
// deploy than silently strand users in unverified state. Dev/test keeps the
// fallback so local runs don't need EMAIL_FROM set.
if (REQUIRE_PROD_HARDENING && process.env.RESEND_API_KEY && (process.env.EMAIL_FROM ?? "") === "") {
  console.error(
    "[config] FATAL: RESEND_API_KEY is set but EMAIL_FROM is missing. " +
      "Verify a domain in Resend and set EMAIL_FROM to a sender on that domain " +
      "(e.g. `Weddly <hello@tryweddly.com>`).",
  );
  process.exit(1);
}
if (REQUIRE_PROD_HARDENING && process.env.EMAIL_FROM === DEFAULT_EMAIL_FROM) {
  console.error(
    "[config] FATAL: EMAIL_FROM is still the resend.dev fallback in production. " +
      "Resend will only deliver to the inbox that owns the API key — every user " +
      "verification will silently fail. Set EMAIL_FROM to a verified-domain sender.",
  );
  process.exit(1);
}

if (REQUIRE_PROD_HARDENING) {
  let publicUrl: URL;
  try {
    publicUrl = new URL(process.env.FRONTEND_BASE_URL ?? "");
  } catch {
    console.error("[config] FATAL: FRONTEND_BASE_URL must be an absolute HTTPS production URL.");
    process.exit(1);
  }
  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.hostname === "localhost" ||
    publicUrl.hostname === "127.0.0.1" ||
    publicUrl.username !== "" ||
    publicUrl.password !== "" ||
    (process.env.FRONTEND_BASE_URL ?? "") !== publicUrl.origin
  ) {
    console.error(
      "[config] FATAL: FRONTEND_BASE_URL must be exactly one non-local HTTPS origin (no credentials, path, query, fragment, or trailing slash).",
    );
    process.exit(1);
  }
  if (!(process.env.RESEND_API_KEY ?? "").trim()) {
    console.error(
      "[config] FATAL: RESEND_API_KEY is required in production; account verification and recovery depend on email delivery.",
    );
    process.exit(1);
  }
  if (!(process.env.ADMIN_EMAILS ?? "").trim()) {
    console.error(
      "[config] FATAL: ADMIN_EMAILS must be explicitly configured in production; no personal-address default is allowed.",
    );
    process.exit(1);
  }
  const adminEmails = configuredAdminEmails();
  const adminTotp = configuredAdminTotpSecrets();
  if (adminEmails.some((email) => !adminTotp.has(email)) || adminTotp.size !== adminEmails.length) {
    console.error(
      "[config] FATAL: ADMIN_TOTP_SECRETS must provide one unique TOTP secret for every ADMIN_EMAILS address and no others.",
    );
    process.exit(1);
  }
  if (!(process.env.SUPPORT_EMAIL ?? "").trim()) {
    console.error(
      "[config] FATAL: SUPPORT_EMAIL must be explicit in production so replies, privacy requests and complaints reach a monitored mailbox.",
    );
    process.exit(1);
  }
  if (
    (process.env.GOOGLE_CLIENT_SECRET ?? "").trim() &&
    !(process.env.DATA_ENCRYPTION_KEYS ?? "").trim()
  ) {
    console.error(
      "[config] FATAL: DATA_ENCRYPTION_KEYS is required when Google Calendar is enabled; OAuth tokens must not share JWT_SECRET.",
    );
    process.exit(1);
  }
  if ((process.env.DATA_ENCRYPTION_KEYS ?? "").trim()) {
    const keys = (process.env.DATA_ENCRYPTION_KEYS ?? "").split(",");
    if (
      keys.some((entry) => {
        const separator = entry.indexOf(":");
        const id = separator > 0 ? entry.slice(0, separator).trim() : "";
        const secret = separator > 0 ? entry.slice(separator + 1).trim() : "";
        return !/^[A-Za-z0-9_-]{1,24}$/.test(id) || secret.length < 32;
      })
    ) {
      console.error(
        "[config] FATAL: DATA_ENCRYPTION_KEYS must be comma-separated key-id:secret entries; each secret must be at least 32 characters.",
      );
      process.exit(1);
    }
  }
  const requireMatchingBuildValue = (serverName: string, buildName: string) => {
    const serverValue = (process.env[serverName] ?? "").trim();
    const buildValue = (process.env[buildName] ?? "").trim();
    if (serverValue !== buildValue) {
      console.error(
        `[config] FATAL: ${serverName} and ${buildName} must either both be unset or match exactly.`,
      );
      process.exit(1);
    }
  };
  requireMatchingBuildValue("GOOGLE_CLIENT_ID", "VITE_GOOGLE_CLIENT_ID");
  requireMatchingBuildValue("APPLE_CLIENT_ID", "VITE_APPLE_CLIENT_ID");
  requireMatchingBuildValue("EN_CANONICAL_HOST", "VITE_EN_CANONICAL_HOST");

  const backupFields = [
    "OFFSITE_BACKUP_ENDPOINT",
    "OFFSITE_BACKUP_ACCESS_KEY_ID",
    "OFFSITE_BACKUP_SECRET_ACCESS_KEY",
    "OFFSITE_BACKUP_BUCKET",
    "OFFSITE_BACKUP_ENCRYPTION_KEYS",
    "OFFSITE_BACKUP_HEALTHCHECK_URL",
  ] as const;
  const configuredBackupFields = backupFields.filter((name) => (process.env[name] ?? "").trim());
  const missingBackupFields = backupFields.filter((name) => !(process.env[name] ?? "").trim());
  // Off-site backups need external R2 credentials and a heartbeat endpoint.
  // Keep the integration optional until those resources are provisioned, but
  // fail closed when an operator starts configuring it and leaves a partial
  // setup that would otherwise look enabled while silently producing nothing.
  if (configuredBackupFields.length > 0 && missingBackupFields.length > 0) {
    console.error(
      `[config] FATAL: encrypted off-site backup configuration is incomplete; missing ${missingBackupFields.join(", ")}.`,
    );
    process.exit(1);
  }
  const backupKeys = (process.env.OFFSITE_BACKUP_ENCRYPTION_KEYS ?? "").split(",");
  if (
    configuredBackupFields.length > 0 &&
    backupKeys.some((entry) => {
      const separator = entry.indexOf(":");
      const id = separator > 0 ? entry.slice(0, separator).trim() : "";
      const key = separator > 0 ? entry.slice(separator + 1).trim() : "";
      return !/^[A-Za-z0-9_-]{1,24}$/.test(id) || !/^[0-9a-f]{64}$/i.test(key);
    })
  ) {
    console.error(
      "[config] FATAL: OFFSITE_BACKUP_ENCRYPTION_KEYS must be comma-separated key-id:64-hex-character entries.",
    );
    process.exit(1);
  }
  if (configuredBackupFields.length > 0) {
    try {
      const endpoint = new URL(process.env.OFFSITE_BACKUP_ENDPOINT ?? "");
      const heartbeat = new URL(process.env.OFFSITE_BACKUP_HEALTHCHECK_URL ?? "");
      if (endpoint.protocol !== "https:" || heartbeat.protocol !== "https:") throw new Error();
    } catch {
      console.error(
        "[config] FATAL: OFFSITE_BACKUP_ENDPOINT and OFFSITE_BACKUP_HEALTHCHECK_URL must be absolute HTTPS URLs.",
      );
      process.exit(1);
    }
    const backupHours = Number(process.env.OFFSITE_BACKUP_INTERVAL_HOURS ?? "24");
    if (!Number.isFinite(backupHours) || backupHours <= 0) {
      console.error("[config] FATAL: OFFSITE_BACKUP_INTERVAL_HOURS must be greater than zero.");
      process.exit(1);
    }
  }
}

/** The From identity for mail an admin sends by hand from `/app/admin/*`.
 *
 *  A person wrote it, so the reply has to land somewhere a person reads, and a
 *  `noreply@` sender says the opposite before the recipient has read a word.
 *  Derived from EMAIL_FROM + SUPPORT_EMAIL rather than a third env var, so the
 *  two senders can never disagree about who Weddly is or drift apart on a
 *  Railway env edit.
 *
 *  The domain guard is the one hard constraint: Resend verifies a DOMAIN, not
 *  an address, so a support mailbox on some other domain is one we are not
 *  allowed to send as and every admin action would come back 403. Keep the
 *  configured sender in that case. An unset EMAIL_FROM (dev/test) names no
 *  domain to disagree with, so the override stands there. */
function adminSenderFrom(from: string, supportEmail: string): string {
  const support = supportEmail.trim();
  if (!support.includes("@")) return from;
  const configured = /<([^>]*)>/.exec(from)?.[1]?.trim() ?? from.trim();
  const domainOf = (addr: string) => addr.split("@")[1]?.toLowerCase() ?? "";
  if (configured.includes("@") && domainOf(configured) !== domainOf(support)) return from;
  const displayName = from.includes("<") ? from.slice(0, from.indexOf("<")).trim() : "";
  return displayName ? `${displayName} <${support}>` : support;
}

const EMAIL_FROM = process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "hello@tryweddly.com";

export const CONFIG = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? "./data/weddly.db",
  uploadsDir: process.env.UPLOADS_DIR ?? "./data/uploads",
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
  /** Rotation-capable keyring for OAuth and other encrypted application data.
   *  First key encrypts; remaining keys decrypt historical ciphertext. */
  dataEncryptionKeys: process.env.DATA_ENCRYPTION_KEYS ?? "",
  /** 30 days. */
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30,
  /** Privileged admin requests require a primary sign-in within 15 minutes.
   *  Unlike the ordinary session TTL this never slides on API activity. */
  adminReauthTtlMs: 1000 * 60 * 15,
  frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? "http://localhost:5173",
  /** When `1`, the server also serves the built SPA from `frontend/dist`. */
  serveFrontend: process.env.SERVE_FRONTEND === "1",
  /** Resend API key. When unset, `sendEmail()` logs the link to stdout instead. */
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: EMAIL_FROM,
  /** Sender for admin-console mail — see `adminSenderFrom`. */
  emailFromAdmin: adminSenderFrom(EMAIL_FROM, SUPPORT_EMAIL),
  /** Reply-to + footer "questions?" address. Recipients hitting Reply on any
   *  outgoing mail land here; the footer also surfaces it as a visible link
   *  ("Kérdés? hello@tryweddly.com"). Defaults to the same mailbox as EMAIL_FROM
   *  so a single misconfiguration doesn't strand replies on a non-existent
   *  inbox. */
  supportEmail: SUPPORT_EMAIL,
  /** Comma-separated email allowlist. Members get `is_admin: true` on the User
   *  DTO and access to /app/admin/* routes. Reversible via env edit. */
  adminEmails: configuredAdminEmails(),
  /** Per-admin application MFA. Secrets stay in deployment secret storage,
   * never the database or frontend bundle. Production boot requires exact
   * one-to-one coverage of ADMIN_EMAILS. */
  adminTotpSecrets: configuredAdminTotpSecrets(),
  /** Independent legal/accounting release gate for every path that creates a
   *  Stripe payment. Production is fail-closed until counsel/accountant review,
   *  operator registration, invoicing/VAT setup and checkout copy are signed
   *  off. Development and tests keep the normal payment fixtures usable. */
  legalPaidLaunchApproved:
    !REQUIRE_PROD_HARDENING || process.env.LEGAL_PAID_LAUNCH_APPROVED === "1",
  /** Google OAuth web-client id (e.g. "1234-abc.apps.googleusercontent.com").
   *  When empty, `/api/auth/google` returns 503 so the rest of the app keeps
   *  working in dev without Google credentials. Same value is baked into the
   *  frontend at build time as `VITE_GOOGLE_CLIENT_ID`. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  /** Test-only escape hatch: when `1`, the Google ID-token verifier accepts a
   *  signed "test bearer" instead of a real Google JWT. The bearer is HMAC'd
   *  with `jwtSecret`, so only callers who already own the secret (i.e. the
   *  E2E test process) can mint one. Never set this in production. */
  googleTestBypass: !REQUIRE_PROD_HARDENING && process.env.GOOGLE_TEST_BYPASS === "1",
  /** OAuth2 client secret for the Google Calendar push-sync integration. The
   *  existing GSI Web client id (`googleClientId`) is reused as the OAuth
   *  `client_id`; this is its paired secret, needed for the server-side
   *  authorization-code exchange. Empty = the "Connect Google Calendar" feature
   *  stays hidden (status.configured=false) and its /connect endpoint 503s, so
   *  the app boots fine without it — same "configured?" pattern as Stripe. */
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  /** Test-only escape hatch: when `1`, the Google Calendar lib answers OAuth +
   *  Calendar API calls from a deterministic in-memory fake instead of hitting
   *  Google, so the E2E suite exercises the full connect -> sync -> disconnect
   *  pipeline hermetically. Never set this in production. */
  googleCalendarFake: !REQUIRE_PROD_HARDENING && process.env.GOOGLE_CALENDAR_FAKE === "1",
  /** `1` while the OAuth app is published but still waiting on Google's
   *  verification review. Google shows every user an "app isn't verified"
   *  interstitial in that window, and a person who meets it with no warning
   *  reads it as "this app is unsafe" and backs out. So the app says it first,
   *  in its own words, before handing over.
   *
   *  Defaults to OFF: a forgotten flag then means no notice (today's behaviour),
   *  rather than telling users for months that a finished review is pending.
   *  Clearing it when the badge lands is one Railway variable, no deploy. */
  googleOAuthUnverified: process.env.GOOGLE_OAUTH_UNVERIFIED === "1",
  /** Apple "Sign in with Apple" Services ID (e.g. "hu.weddly.signin"). This is
   *  the `client_id` the Apple JS SDK is initialised with AND the `aud` claim
   *  the id-token verifier checks. When empty, `/api/auth/apple` returns 503 so
   *  the rest of the app keeps working in dev without Apple credentials. Same
   *  value is baked into the frontend at build time as `VITE_APPLE_CLIENT_ID`. */
  appleClientId: process.env.APPLE_CLIENT_ID ?? "",
  /** Test-only escape hatch: when `1`, the Apple ID-token verifier accepts a
   *  signed "test bearer" instead of a real Apple JWT. The bearer is HMAC'd
   *  with `jwtSecret`, so only callers who already own the secret (i.e. the
   *  E2E test process) can mint one. Never set this in production. */
  appleTestBypass: !REQUIRE_PROD_HARDENING && process.env.APPLE_TEST_BYPASS === "1",
  /** Numeric GA4 property id (e.g. "493210114") the admin Traffic section
   *  reports against. NOT the "G-…" measurement id — that one lives in the
   *  GTM container. Empty = GA4 traffic endpoint returns `configured:false`. */
  ga4PropertyId: (process.env.GA4_PROPERTY_ID ?? "").trim(),
  /** Full service-account key JSON (the file you download from Google Cloud,
   *  pasted verbatim). The account needs Viewer access on the GA4 property.
   *  Only `client_email` + `private_key` are read. Empty = GA4 disabled. */
  ga4ServiceAccountJson: process.env.GA4_SERVICE_ACCOUNT_JSON ?? "",
  /** Stripe secret key (`sk_live_…` / `sk_test_…`). Empty = billing disabled:
   *  the checkout/portal endpoints return 503 and the app keeps working in
   *  read-with-trial mode, so dev + early prod can run before billing is wired. */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  /** Signing secret for the Stripe webhook endpoint (`whsec_…`). Required to
   *  accept webhook events; without it the webhook handler rejects everything. */
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  /** Recurring Price ids for the standard monthly plan, one per currency. A
   *  couple is sent to Checkout with the Price matching its `currency`. Create
   *  them in the Stripe dashboard (or via scripts/stripe_setup.ts). */
  stripePriceEur: process.env.STRIPE_PRICE_EUR ?? "",
  stripePriceHuf: process.env.STRIPE_PRICE_HUF ?? "",
  /** One-time Price ids for the planner-managed couple's guest-page (vendégoldal)
   *  edit add-on, sold at roughly 30% of one month, rounded to a clean amount per
   *  currency (currently EUR 2.15, Ft 750). One per currency, matched to the
   *  couple's `currency` like the subscription price. When unset the add-on
   *  checkout returns 503, so it never blocks boot. Create them in the Stripe
   *  dashboard at the discounted amount. */
  stripeGuestPageAddonPriceEur: process.env.STRIPE_GUEST_PAGE_ADDON_PRICE_EUR ?? "",
  stripeGuestPageAddonPriceHuf: process.env.STRIPE_GUEST_PAGE_ADDON_PRICE_HUF ?? "",
  /** Recurring Price ids for the planner subscription, one per tier per currency.
   *  A planner is sent to Checkout with the Price matching their chosen tier +
   *  currency. Create them with backend/scripts/stripe_setup_planner.ts. When
   *  unset, planner checkout returns 503 (billing never blocks boot). */
  stripePricePlanner: {
    starter: {
      EUR: process.env.STRIPE_PRICE_PLANNER_STARTER_EUR ?? "",
      HUF: process.env.STRIPE_PRICE_PLANNER_STARTER_HUF ?? "",
    },
    pro: {
      EUR: process.env.STRIPE_PRICE_PLANNER_PRO_EUR ?? "",
      HUF: process.env.STRIPE_PRICE_PLANNER_PRO_HUF ?? "",
    },
    premium: {
      EUR: process.env.STRIPE_PRICE_PLANNER_PREMIUM_EUR ?? "",
      HUF: process.env.STRIPE_PRICE_PLANNER_PREMIUM_HUF ?? "",
    },
  },
  /** Signing secret for the SEPARATE planner Stripe webhook endpoint
   *  (`whsec_…`). Distinct from the couple/vendor webhook so signatures never
   *  collide — register it as its own endpoint in the Stripe dashboard. */
  stripePlannerWebhookSecret: process.env.STRIPE_PLANNER_WEBHOOK_SECRET ?? "",
  /** Recurring Price ids for the vendor monthly plan, one per currency (see
   *  shared/vendor_billing.ts VENDOR_MONTHLY_PRICE, keep in sync). Create
   *  them with backend/scripts/stripe_setup_vendor.ts. When unset, vendor
   *  checkout returns 503 (billing never blocks boot). */
  stripePriceVendorEur: process.env.STRIPE_PRICE_VENDOR_EUR ?? "",
  stripePriceVendorHuf: process.env.STRIPE_PRICE_VENDOR_HUF ?? "",
  /** Signing secret for the SEPARATE vendor Stripe webhook endpoint
   *  (`whsec_…`), its own endpoint in the Stripe dashboard, like the planner
   *  one. */
  stripeVendorWebhookSecret: process.env.STRIPE_VENDOR_WEBHOOK_SECRET ?? "",
  /** Anthropic API key (`sk-ant-…`) for the vendor inbox AI Concierge. Empty =
   *  the feature is OFF: `GET /api/ai/availability` reports `available:false`,
   *  the assistant strip never renders, and the generate endpoint 503s. Same
   *  "configured?" gate as DeepL / Stripe / GEMI, so the app boots and every
   *  other surface behaves identically without it. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Test-only escape hatch: when `1`, `lib/ai.ts` answers from a deterministic
   *  in-process stub instead of calling Anthropic, so the E2E suite exercises
   *  the whole route -> domain -> coerce pipeline with no network. Never set
   *  this in production. */
  aiFake: !REQUIRE_PROD_HARDENING && process.env.AI_FAKE === "1",
  /** Path to the MaxMind GeoLite2-Country `.mmdb` on disk. Lives on the `/data`
   *  persistent volume in prod so it survives redeploys. The file is NEVER
   *  committed (MaxMind's EULA forbids redistribution + it would bloat the
   *  `git archive` pre-push snapshot); it's fetched at boot by `ensureGeoDb()`
   *  when a license key is set. Absent file = country lookup returns null and
   *  the app boots fine (graceful degrade, like the GA4/Stripe "configured?"
   *  pattern). */
  geoIpDbPath: process.env.GEOIP_DB_PATH ?? "./data/GeoLite2-Country.mmdb",
  /** MaxMind license key (free, from maxmind.com). When set, `ensureGeoDb()`
   *  downloads the GeoLite2-Country DB to `geoIpDbPath` at boot if it's
   *  missing. Empty = no download attempt, every country lookup returns null. */
  maxmindLicenseKey: process.env.MAXMIND_LICENSE_KEY ?? "",
  /** Cloudflare R2 (S3-compatible) object storage. When all four core fields
   *  are set, uploads go to R2 instead of the local `/data`
   *  volume; otherwise the app falls back to disk with zero behaviour change
   *  (same "configured?" pattern as Stripe). `endpoint` is the account S3
   *  endpoint `https://<account>.r2.cloudflarestorage.com`. */
  r2: {
    endpoint: process.env.R2_ENDPOINT ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "",
  },
  /** Encrypted SQLite snapshots use credentials and a bucket distinct from
   * application uploads. The first key encrypts; retained older keys allow
   * historical restores after rotation. A partially configured set is fatal in
   * production; a completely absent set keeps this optional worker disabled. */
  offsiteBackup: {
    endpoint: process.env.OFFSITE_BACKUP_ENDPOINT ?? "",
    accessKeyId: process.env.OFFSITE_BACKUP_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.OFFSITE_BACKUP_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.OFFSITE_BACKUP_BUCKET ?? "",
    encryptionKeys: process.env.OFFSITE_BACKUP_ENCRYPTION_KEYS ?? "",
    healthcheckUrl: process.env.OFFSITE_BACKUP_HEALTHCHECK_URL ?? "",
    intervalHours: Number(process.env.OFFSITE_BACKUP_INTERVAL_HOURS ?? "24"),
    retention: Number(process.env.OFFSITE_BACKUP_RETENTION ?? "90"),
  },
};

/** True when R2 object storage is fully configured for application uploads. */
export const R2_ENABLED =
  CONFIG.r2.endpoint !== "" &&
  CONFIG.r2.accessKeyId !== "" &&
  CONFIG.r2.secretAccessKey !== "" &&
  CONFIG.r2.bucket !== "";

export const OFFSITE_BACKUP_ENABLED =
  CONFIG.offsiteBackup.endpoint !== "" &&
  CONFIG.offsiteBackup.accessKeyId !== "" &&
  CONFIG.offsiteBackup.secretAccessKey !== "" &&
  CONFIG.offsiteBackup.bucket !== "" &&
  CONFIG.offsiteBackup.encryptionKeys !== "" &&
  CONFIG.offsiteBackup.healthcheckUrl !== "";

/** True when a Stripe secret key is configured. Billing endpoints check this
 *  and 503 when false, mirroring the Google-OAuth "configured?" pattern. */
export const STRIPE_ENABLED = CONFIG.stripeSecretKey !== "";

/** True when the AI Concierge has a key to spend. Read the LIVE env through
 *  `aiConfigured()` in `lib/ai.ts` rather than this constant on a request path:
 *  the tests flip the key around a single case to prove the no-key branch, and
 *  a value frozen at import time would answer for the whole process. This
 *  constant is the boot-time snapshot, for logging and operator diagnostics. */
export const AI_ENABLED = CONFIG.anthropicApiKey !== "";

/** True when the Google Calendar push-sync integration is fully wired: the GSI
 *  Web client id AND its OAuth client secret are set (or the E2E fake is on).
 *  The status endpoint surfaces this to the frontend so the "Connect Google
 *  Calendar" affordance stays hidden until an operator finishes Google setup. */
export const GOOGLE_CALENDAR_ENABLED =
  CONFIG.googleClientId !== "" && (CONFIG.googleClientSecret !== "" || CONFIG.googleCalendarFake);
