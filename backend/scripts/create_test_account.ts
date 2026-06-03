// One-off: create a local test login account in the dev DB.
//
//   cd backend && bun run scripts/create_test_account.ts
//
// Safe to re-run — it upserts the password if the email already exists.
// LOCAL ONLY: do not point DB_PATH at a production volume.
import { db, now } from "../src/db";
import { hashPassword } from "../src/auth/password";
import { getUserByEmail } from "../src/domain/users";

const EMAIL = "testaccountandor@weddly.test";
const PASSWORD = "123456789";
const FULL_NAME = "Test Account Andor";

const passwordHash = await hashPassword(PASSWORD);
const ts = now();
const existing = getUserByEmail(EMAIL);

if (existing) {
  db.prepare(
    `UPDATE users
       SET password_hash = ?, password_set = 1, status = 'active', verified_email = 1, updated_at = ?
     WHERE id = ?`,
  ).run(passwordHash, ts, existing.id);
  console.log(`Reset password for existing test account (id ${existing.id}).`);
} else {
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, password_set, locale, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 1, 1, 'en', ?, ?)`,
    )
    .run(EMAIL, passwordHash, FULL_NAME, ts, ts);
  console.log(`Created test account (id ${Number(result.lastInsertRowid)}).`);
}

console.log(`\n  Email:    ${EMAIL}\n  Password: ${PASSWORD}\n`);
