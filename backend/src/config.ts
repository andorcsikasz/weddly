// Backend runtime config. Fail-fast: production refuses to boot without a strong JWT_SECRET.

const DEV_JWT_SECRET = "dev-only-secret-change-me-in-production-please-0123456789";
const IS_PROD = process.env.NODE_ENV === "production";

if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_SECRET)) {
  console.error(
    "[config] FATAL: NODE_ENV=production requires a strong JWT_SECRET. " +
      "Generate one with `openssl rand -hex 48` and set it in the Railway dashboard.",
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
  emailFrom: process.env.EMAIL_FROM ?? "Weddly <onboarding@resend.dev>",
  /** Comma-separated email allowlist. Members get `is_admin: true` on the User
   *  DTO and access to /app/admin/* routes. Reversible via env edit. */
  adminEmails: (process.env.ADMIN_EMAILS ?? "andor.csikasz@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};
