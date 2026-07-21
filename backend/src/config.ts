// Backend runtime config. Fail-fast: production refuses to boot without a strong JWT_SECRET.

const DEV_JWT_SECRET = "dev-only-secret-change-me-in-production-please-0123456789";
const DEFAULT_EMAIL_FROM = "Weddly <onboarding@resend.dev>";
const IS_PROD = process.env.NODE_ENV === "production";

// Railway always injects RAILWAY_* vars into a deployed service. Treat their
// presence as "this is a real deployment" even when NODE_ENV was forgotten, so
// a misconfigured deploy can never boot on the publicly-known DEV_JWT_SECRET
// (which would let anyone forge a session token for any user — `auth/session.ts`
// signs sessions with this secret) or with an auth test-bypass enabled. This is
// additive: with NODE_ENV=production already set, behaviour is unchanged.
const ON_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
/** True when we must enforce production-grade secrets/hardening regardless of a
 *  possibly-missing NODE_ENV. */
const REQUIRE_PROD_HARDENING = IS_PROD || ON_RAILWAY;

if (
  REQUIRE_PROD_HARDENING &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_SECRET)
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
if (IS_PROD && process.env.RESEND_API_KEY && (process.env.EMAIL_FROM ?? "") === "") {
  console.error(
    "[config] FATAL: RESEND_API_KEY is set but EMAIL_FROM is missing. " +
      "Verify a domain in Resend and set EMAIL_FROM to a sender on that domain " +
      "(e.g. `Weddly <hello@tryweddly.com>`).",
  );
  process.exit(1);
}
if (IS_PROD && process.env.EMAIL_FROM === DEFAULT_EMAIL_FROM) {
  console.error(
    "[config] FATAL: EMAIL_FROM is still the resend.dev fallback in production. " +
      "Resend will only deliver to the inbox that owns the API key — every user " +
      "verification will silently fail. Set EMAIL_FROM to a verified-domain sender.",
  );
  process.exit(1);
}

export const CONFIG = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? "./data/weddly.db",
  uploadsDir: process.env.UPLOADS_DIR ?? "./data/uploads",
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
  /** 30 days. */
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30,
  frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? "http://localhost:5173",
  /** When `1`, the server also serves the built SPA from `frontend/dist`. */
  serveFrontend: process.env.SERVE_FRONTEND === "1",
  /** Resend API key. When unset, `sendEmail()` logs the link to stdout instead. */
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
  /** Reply-to + footer "questions?" address. Recipients hitting Reply on any
   *  outgoing mail land here; the footer also surfaces it as a visible link
   *  ("Kérdés? hello@tryweddly.com"). Defaults to the same mailbox as EMAIL_FROM
   *  so a single misconfiguration doesn't strand replies on a non-existent
   *  inbox. */
  supportEmail: process.env.SUPPORT_EMAIL ?? "hello@tryweddly.com",
  /** Comma-separated email allowlist. Members get `is_admin: true` on the User
   *  DTO and access to /app/admin/* routes. Reversible via env edit. */
  adminEmails: (process.env.ADMIN_EMAILS ?? "andor.csikasz@gmail.com,saraazawiasa@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
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
   *  edit add-on, sold at ~30% of one month (0.3 × the monthly couple price). One
   *  per currency, matched to the couple's `currency` like the subscription price.
   *  When unset the add-on checkout returns 503, so it never blocks boot. Create
   *  them in the Stripe dashboard at the discounted amount. */
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
   *  are set, uploads + DB backups go to R2 instead of the local `/data`
   *  volume; otherwise the app falls back to disk with zero behaviour change
   *  (same "configured?" pattern as Stripe). `endpoint` is the account S3
   *  endpoint `https://<account>.r2.cloudflarestorage.com`. */
  r2: {
    endpoint: process.env.R2_ENDPOINT ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "",
    /** Optional separate bucket for SQLite backups; falls back to `bucket`. */
    backupBucket: process.env.R2_BACKUP_BUCKET ?? "",
    /** Hours between automatic SQLite backups to R2. 0 disables the job. */
    backupIntervalHours: Number(process.env.R2_BACKUP_INTERVAL_HOURS ?? "24"),
    /** How many most-recent DB backups to retain in R2 (older ones pruned). */
    backupRetention: Number(process.env.R2_BACKUP_RETENTION ?? "14"),
  },
};

/** True when R2 object storage is fully configured. Upload routes + the backup
 *  job check this; when false everything uses the local disk fallback. */
export const R2_ENABLED =
  CONFIG.r2.endpoint !== "" &&
  CONFIG.r2.accessKeyId !== "" &&
  CONFIG.r2.secretAccessKey !== "" &&
  CONFIG.r2.bucket !== "";

/** True when a Stripe secret key is configured. Billing endpoints check this
 *  and 503 when false, mirroring the Google-OAuth "configured?" pattern. */
export const STRIPE_ENABLED = CONFIG.stripeSecretKey !== "";

/** True when the Google Calendar push-sync integration is fully wired: the GSI
 *  Web client id AND its OAuth client secret are set (or the E2E fake is on).
 *  The status endpoint surfaces this to the frontend so the "Connect Google
 *  Calendar" affordance stays hidden until an operator finishes Google setup. */
export const GOOGLE_CALENDAR_ENABLED =
  CONFIG.googleClientId !== "" && (CONFIG.googleClientSecret !== "" || CONFIG.googleCalendarFake);
