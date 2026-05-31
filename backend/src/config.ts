// Backend runtime config. Fail-fast: production refuses to boot without a strong JWT_SECRET.

const DEV_JWT_SECRET = "dev-only-secret-change-me-in-production-please-0123456789";
const DEFAULT_EMAIL_FROM = "Weddly <onboarding@resend.dev>";
const IS_PROD = process.env.NODE_ENV === "production";

if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_SECRET)) {
  console.error(
    "[config] FATAL: NODE_ENV=production requires a strong JWT_SECRET. " +
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
      "(e.g. `Weddly <hello@weddly.hu>`).",
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
   *  ("Kérdés? hello@weddly.hu"). Defaults to the same mailbox as EMAIL_FROM
   *  so a single misconfiguration doesn't strand replies on a non-existent
   *  inbox. */
  supportEmail: process.env.SUPPORT_EMAIL ?? "hello@weddly.hu",
  /** Comma-separated email allowlist. Members get `is_admin: true` on the User
   *  DTO and access to /app/admin/* routes. Reversible via env edit. */
  adminEmails: (process.env.ADMIN_EMAILS ?? "andor.csikasz@gmail.com")
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
  googleTestBypass: process.env.NODE_ENV !== "production" && process.env.GOOGLE_TEST_BYPASS === "1",
  /** Numeric GA4 property id (e.g. "493210114") the admin Traffic section
   *  reports against. NOT the "G-…" measurement id — that one lives in the
   *  GTM container. Empty = GA4 traffic endpoint returns `configured:false`. */
  ga4PropertyId: (process.env.GA4_PROPERTY_ID ?? "").trim(),
  /** Full service-account key JSON (the file you download from Google Cloud,
   *  pasted verbatim). The account needs Viewer access on the GA4 property.
   *  Only `client_email` + `private_key` are read. Empty = GA4 disabled. */
  ga4ServiceAccountJson: process.env.GA4_SERVICE_ACCOUNT_JSON ?? "",
};
