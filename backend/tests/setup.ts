// MUST be the first import in every test file. Sets a hermetic env so we
// don't accidentally talk to dev services or share rate-limit buckets.
import { existsSync, rmSync } from "node:fs";

process.env.NODE_ENV = "test";
// Force-override PORT + DB_PATH so backend/.env (which sets dev PORT=8787 +
// DB_PATH=./data/weddly.db) can't leak into the test suite. Without this,
// `bun test` autoloads .env, the ?? fallback keeps the dev values, and tests
// run against the dev DB on the dev port — pollution + port collision between
// worker files. To run two worktrees in parallel, pass an explicit BUN_TEST_PORT.
process.env.DB_PATH = process.env.BUN_TEST_DB_PATH ?? "./data/test-weddly.db";
process.env.PORT = process.env.BUN_TEST_PORT ?? "8791";
process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.FRONTEND_BASE_URL = "http://localhost:5173";
process.env.RESEND_API_KEY = ""; // ensure email is no-op
// Admin allowlist for tests — must be set BEFORE the server boots so config.ts
// picks it up. Tests register `admin@test.test` to exercise admin-only routes.
process.env.ADMIN_EMAILS = "admin@test.test";
// Enables the Google ID-token verifier's HMAC test-bearer path so the E2E
// suite can exercise /api/auth/google without hitting Google. Tests mint
// bearers via mintTestBearer(); see backend/src/lib/google_oauth.ts.
process.env.GOOGLE_TEST_BYPASS = "1";
process.env.GOOGLE_CLIENT_ID = "test-google-client.apps.googleusercontent.com";

// Wipe the test DB before the server boots — every run starts clean.
for (const ext of ["", "-shm", "-wal"]) {
  const f = `./data/test-weddly.db${ext}`;
  if (existsSync(f)) rmSync(f, { force: true });
}

// Importing the server starts Bun.serve(); the test helpers fetch from PORT.
await import("../src/server");
