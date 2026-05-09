// MUST be the first import in every test file. Sets a hermetic env so we
// don't accidentally talk to dev services or share rate-limit buckets.
import { existsSync, rmSync } from "node:fs";

process.env.NODE_ENV = "test";
process.env.DB_PATH = "./data/test-weddly.db";
process.env.PORT = "8791";
process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.FRONTEND_BASE_URL = "http://localhost:5173";
process.env.RESEND_API_KEY = ""; // ensure email is no-op
// Admin allowlist for tests — must be set BEFORE the server boots so config.ts
// picks it up. Tests register `admin@test.test` to exercise admin-only routes.
process.env.ADMIN_EMAILS = "admin@test.test";

// Wipe the test DB before the server boots — every run starts clean.
for (const ext of ["", "-shm", "-wal"]) {
  const f = `./data/test-weddly.db${ext}`;
  if (existsSync(f)) rmSync(f, { force: true });
}

// Importing the server starts Bun.serve(); the test helpers fetch from PORT.
await import("../src/server");
