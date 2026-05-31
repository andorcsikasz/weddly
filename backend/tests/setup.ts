// MUST be the first import in every test file. Sets a hermetic env so we
// don't accidentally talk to dev services or share rate-limit buckets.
//
// IMPORTANT: every test-critical env var is set with a plain `=` assignment
// rather than `process.env.X ?? "..."`. Bun autoloads backend/.env BEFORE
// this file runs, and the `??` fallback would let .env values silently win
// — exactly the bug that masked tests-against-dev-DB for three days in
// May 2026. The only escape hatches are `BUN_TEST_PORT` / `BUN_TEST_DB_PATH`
// for worktree-parallel testing; everything else is unconditional.
import { existsSync, rmSync } from "node:fs";

process.env.NODE_ENV = "test";
// Worktree-parallel escape hatch: pass BUN_TEST_PORT / BUN_TEST_DB_PATH on the
// bun-test invocation to run two worktrees side-by-side. Plain .env values
// (PORT, DB_PATH) deliberately NEVER win — that's the regression guard.
process.env.DB_PATH = process.env.BUN_TEST_DB_PATH ?? "./data/test-weddly.db";
process.env.PORT = process.env.BUN_TEST_PORT ?? "8791";
process.env.UPLOADS_DIR = "./data/test-uploads";
process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.FRONTEND_BASE_URL = "http://localhost:5173";
process.env.RESEND_API_KEY = ""; // ensure email is no-op
process.env.EMAIL_FROM = ""; // no real From means no real send even if RESEND_API_KEY ever leaks
// Disable static SPA serving so a stray `SERVE_FRONTEND=1` in .env doesn't
// flip the server into double-duty mode mid-suite (every dist-asset 404
// would otherwise turn into the SPA fallback HTML, polluting test bodies).
process.env.SERVE_FRONTEND = "0";
// Admin allowlist for tests — must be set BEFORE the server boots so config.ts
// picks it up. Tests register `admin@test.test` to exercise admin-only routes.
process.env.ADMIN_EMAILS = "admin@test.test";
// Sentry stays off in tests — even a placeholder DSN would queue HTTPS
// requests during the suite and tag every event with the test environment.
process.env.SENTRY_DSN = "";
process.env.SENTRY_TRACES_SAMPLE_RATE = "0";
// Amadeus + SerpApi (honeymoon flights) get zeroed so the tests can't hit
// the real APIs by accident — every call short-circuits when the
// credentials are missing. Amadeus is the legacy fallback (kept in tree
// but no longer imported by the honeymoon flow); SerpApi is the live
// integration in production.
process.env.AMADEUS_BASE_URL = "";
process.env.AMADEUS_CLIENT_ID = "";
process.env.AMADEUS_CLIENT_SECRET = "";
process.env.SERPAPI_KEY = "";
// Enables the Google ID-token verifier's HMAC test-bearer path so the E2E
// suite can exercise /api/auth/google without hitting Google. Tests mint
// bearers via mintTestBearer(); see backend/src/lib/google_oauth.ts.
process.env.GOOGLE_TEST_BYPASS = "1";
process.env.GOOGLE_CLIENT_ID = "test-google-client.apps.googleusercontent.com";
// Plausible analytics is injected into the SSR <head> only when this is set
// (see seo_ssr.ts plausibleScriptTag). Pinned empty so a stray .env value
// can't leak a real analytics tag into rendered test HTML; the SEO test that
// asserts the tag sets it explicitly around its own block.
process.env.PLAUSIBLE_DOMAIN = "";

// Google Tag Manager is injected into the SSR <head> only when this is set
// (see seo_ssr.ts gtmScriptTag). Same reasoning as PLAUSIBLE_DOMAIN above:
// pinned empty so no real container id leaks into rendered test HTML.
process.env.GTM_CONTAINER_ID = "";

// Wipe the test DB before the server boots — every run starts clean.
for (const ext of ["", "-shm", "-wal"]) {
  const f = `./data/test-weddly.db${ext}`;
  if (existsSync(f)) rmSync(f, { force: true });
}

// Importing the server starts Bun.serve(); the test helpers fetch from PORT.
await import("../src/server");
