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
// Pinned so the admin-console sender is deterministic: a SUPPORT_EMAIL in a
// dev .env would otherwise decide what `CONFIG.emailFromAdmin` resolves to.
process.env.SUPPORT_EMAIL = "hello@tryweddly.com";
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
process.env.FX_DISABLED = "1"; // no outbound FX call in tests; fx endpoint returns null
// Enables the Google ID-token verifier's HMAC test-bearer path so the E2E
// suite can exercise /api/auth/google without hitting Google. Tests mint
// bearers via mintTestBearer(); see backend/src/lib/google_oauth.ts.
process.env.GOOGLE_TEST_BYPASS = "1";
process.env.GOOGLE_CLIENT_ID = "test-google-client.apps.googleusercontent.com";
// Google Calendar push-sync: pin the OAuth secret NON-empty so
// GOOGLE_CALENDAR_ENABLED (status.configured) is true, and GOOGLE_CALENDAR_FAKE=1
// so the lib answers OAuth + Calendar API calls from a deterministic in-memory
// fake instead of hitting Google. See backend/src/lib/google_calendar.ts.
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_CALENDAR_FAKE = "1";
// Pinned ON so the suite exercises the interesting branch: the pre-consent
// warning the app shows while Google's verification review is pending.
process.env.GOOGLE_OAUTH_UNVERIFIED = "1";
// Same escape hatch for the Apple ID-token verifier — the E2E suite exercises
// /api/auth/apple via HMAC'd test bearers (mintAppleTestBearer) instead of
// hitting Apple; see backend/src/lib/apple_oauth.ts.
process.env.APPLE_TEST_BYPASS = "1";
process.env.APPLE_CLIENT_ID = "hu.weddly.signin.test";
// Plausible analytics is injected into the SSR <head> only when this is set
// (see seo_ssr.ts plausibleScriptTag). Pinned empty so a stray .env value
// can't leak a real analytics tag into rendered test HTML; the SEO test that
// asserts the tag sets it explicitly around its own block.
process.env.PLAUSIBLE_DOMAIN = "";

// Google Tag Manager is injected into the SSR <head> only when this is set
// (see seo_ssr.ts gtmScriptTag). Same reasoning as PLAUSIBLE_DOMAIN above:
// pinned empty so no real container id leaks into rendered test HTML.
process.env.GTM_CONTAINER_ID = "";

// GA4 gtag.js measurement id injected into the SSR <head> (seo_ssr.ts
// ga4ScriptTag). Pinned empty so the real stream id from backend/.env never
// leaks into rendered test HTML and trips the analytics-injection assertions.
process.env.GA4_MEASUREMENT_ID = "";

// GA4 Data API (admin Traffic section). Pinned empty so the suite never tries
// to reach Google — the traffic endpoint returns `configured:false` instead.
process.env.GA4_PROPERTY_ID = "";
process.env.GA4_SERVICE_ACCOUNT_JSON = "";

// GeoIP country lookup (signup acquisition capture). Pin the license key empty
// so the suite NEVER attempts a MaxMind download, and point the DB path at a
// guaranteed-absent file so the reader stays null regardless of what's on the
// dev's ./data volume. This forces the production-realistic "reader absent →
// null country" branch deterministically — tests assert the null-degrade
// contract (country null + register still 201), never a specific ISO code.
process.env.MAXMIND_LICENSE_KEY = "";
process.env.GEOIP_DB_PATH = "./data/test-geoip-does-not-exist.mmdb";

// Stripe billing stays disabled in tests (STRIPE_ENABLED=false) so checkout /
// portal endpoints 503 and no live API calls fire. The webhook is exercised
// with a forged-but-secret-signed payload using this test webhook secret.
process.env.STRIPE_SECRET_KEY = "";
process.env.STRIPE_WEBHOOK_SECRET = "";
process.env.STRIPE_PRICE_EUR = "";
process.env.STRIPE_PRICE_HUF = "";
process.env.STRIPE_GUEST_PAGE_ADDON_PRICE_EUR = "";
process.env.STRIPE_GUEST_PAGE_ADDON_PRICE_HUF = "";
process.env.STRIPE_PRICE_PLANNER_STARTER_EUR = "";
process.env.STRIPE_PRICE_PLANNER_STARTER_HUF = "";
process.env.STRIPE_PRICE_PLANNER_PRO_EUR = "";
process.env.STRIPE_PRICE_PLANNER_PRO_HUF = "";
process.env.STRIPE_PRICE_PLANNER_PREMIUM_EUR = "";
process.env.STRIPE_PRICE_PLANNER_PREMIUM_HUF = "";
process.env.STRIPE_PLANNER_WEBHOOK_SECRET = "";
process.env.STRIPE_PRICE_VENDOR_EUR = "";
process.env.STRIPE_PRICE_VENDOR_HUF = "";
process.env.STRIPE_VENDOR_WEBHOOK_SECRET = "";

// Cloudflare R2 object storage stays disabled in tests so the storage layer
// uses the local-disk backend (UPLOADS_DIR above) — pin every R2 field empty
// so a stray .env value can't flip uploads/backups to a real bucket mid-suite.
// Same regression guard as Stripe/GA4 above.
process.env.R2_ENDPOINT = "";
process.env.R2_ACCESS_KEY_ID = "";
process.env.R2_SECRET_ACCESS_KEY = "";
process.env.R2_BUCKET = "";
process.env.R2_BACKUP_BUCKET = "";
process.env.R2_BACKUP_INTERVAL_HOURS = "0";

// Company lookup: every registry provider answers from deterministic fixtures
// (src/lib/company_lookup/fake.ts) so the suite never touches a real registry.
// GEMI_API_KEY is pinned NON-empty so the Greece provider registers as
// available; the fake layer intercepts before the key would ever be sent.
process.env.COMPANY_LOOKUP_FAKE = "1";
process.env.GEMI_API_KEY = "test-gemi-key";

// Address autocomplete: the Photon proxy answers from deterministic fixtures
// (src/lib/address_suggest.ts) so the suite never touches the real geocoder.
process.env.ADDRESS_SUGGEST_FAKE = "1";

// Auto-translate: DEEPL_API_KEY is pinned NON-empty so translateConfigured()
// reports the feature available; DEEPL_FAKE=1 makes the provider answer from a
// deterministic stub instead of ever hitting DeepL (mirrors the company-lookup
// fake gate above).
process.env.DEEPL_API_KEY = "test-deepl-key";
process.env.DEEPL_FAKE = "1";

// Google Places ratings (browse-teaser ranking input): key pinned NON-empty so
// placesConfigured() is true, GOOGLE_PLACES_FAKE=1 so the stub answers instead
// of the billed API. Same shape as the DeepL gate above.
process.env.GOOGLE_PLACES_API_KEY = "test-places-key";
process.env.GOOGLE_PLACES_FAKE = "1";

// Honeymoon destination photo: no key gates this one, so the fake flag is the
// whole switch. It matters more than the others because the live path is a
// ladder of up to four wikis PER breadcrumb rung on an ordinary page load —
// left unfaked it burned tens of seconds and dragged unrelated suites past
// their 5s timeout when the whole suite ran.
process.env.HONEYMOON_PHOTO_FAKE = "1";

// Wipe the test DB before the server boots — every run starts clean. Target
// the SAME path the server is about to open (DB_PATH, resolved above), NOT the
// hardcoded default: a worktree-parallel run overrides it via BUN_TEST_DB_PATH,
// and wiping the default while the server opens the override left the override
// DB to accumulate rows across runs (which is what let couple_cards rows leak).
for (const ext of ["", "-shm", "-wal"]) {
  const f = `${process.env.DB_PATH}${ext}`;
  if (existsSync(f)) rmSync(f, { force: true });
}

// Importing the server starts Bun.serve(); the test helpers fetch from PORT.
await import("../src/server");
