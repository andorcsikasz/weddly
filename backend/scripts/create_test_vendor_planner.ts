// One-off: create local vendor + planner test login accounts in the dev DB.
//
//   cd backend && bun run scripts/create_test_vendor_planner.ts
//
// Safe to re-run — upserts the password if the email already exists and only
// mints the vendor account/listing/billing the first time.
// LOCAL ONLY: do not point DB_PATH at a production volume.
import { db, now } from "../src/db";
import { hashPassword } from "../src/auth/password";
import { getUserByEmail } from "../src/domain/users";
import {
  createVendorAccount,
  getVendorAccountByOwnerUserId,
} from "../src/domain/vendor_accounts";
import { createVendorListing } from "../src/domain/listings";
import { initVendorBilling } from "../src/domain/vendor_billing";

const PASSWORD = "123456789";

// --- Vendor ---------------------------------------------------------------
const VENDOR_EMAIL = "testvendor@weddly.test";
const VENDOR_NAME = "Test Vendor Studio";

// --- Planner --------------------------------------------------------------
const PLANNER_EMAIL = "testplanner@weddly.test";
const PLANNER_NAME = "Test Planner";

const passwordHash = await hashPassword(PASSWORD);
const ts = now();

function upsertUser(opts: {
  email: string;
  fullName: string;
  role: "owner" | "vendor";
  userType: "couple" | "planner";
}): number {
  const existing = getUserByEmail(opts.email);
  if (existing) {
    db.prepare(
      `UPDATE users
         SET password_hash = ?, status = 'active', role = ?, user_type = ?,
             verified_email = 1, updated_at = ?
       WHERE id = ?`,
    ).run(passwordHash, opts.role, opts.userType, ts, existing.id);
    console.log(`Reset existing ${opts.role}/${opts.userType} account (id ${existing.id}).`);
    return existing.id;
  }
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, user_type, verified_email, locale, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, 1, 'en', ?, ?)`,
    )
    .run(opts.email, passwordHash, opts.fullName, opts.role, opts.userType, ts, ts);
  const id = Number(result.lastInsertRowid);
  console.log(`Created ${opts.role}/${opts.userType} account (id ${id}).`);
  return id;
}

// Vendor: user(role=vendor) + vendor_account + claimed listing + billing.
const vendorUserId = upsertUser({
  email: VENDOR_EMAIL,
  fullName: VENDOR_NAME,
  role: "vendor",
  userType: "couple",
});
let vendorAccount = getVendorAccountByOwnerUserId(vendorUserId);
if (!vendorAccount) {
  vendorAccount = createVendorAccount({
    ownerUserId: vendorUserId,
    displayName: VENDOR_NAME,
    contactEmail: VENDOR_EMAIL,
  });
  createVendorListing({
    vendorAccountId: vendorAccount.id,
    category: "venue",
    name: VENDOR_NAME,
    city: "Budapest",
    contactEmail: VENDOR_EMAIL,
  });
  initVendorBilling(vendorAccount.id, "HUF", ts);
  console.log(`  + vendor_account ${vendorAccount.id} + listing + billing.`);
}

// Planner: a normal user flagged user_type='planner'.
upsertUser({
  email: PLANNER_EMAIL,
  fullName: PLANNER_NAME,
  role: "owner",
  userType: "planner",
});

console.log(
  `\n  VENDOR   ${VENDOR_EMAIL} / ${PASSWORD}   (→ /vendor)\n  PLANNER  ${PLANNER_EMAIL} / ${PASSWORD}   (→ /app/planner)\n`,
);
