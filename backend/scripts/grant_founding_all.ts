// One-time backfill: give every existing real couple a founding slot (18 months
// free), so nobody currently signed up sits in the billing read-only gate.
//
// Paying Stripe subscribers (active / past_due) are SKIPPED — we don't clobber a
// live subscription or give away revenue; they can cancel via the Stripe portal
// if they'd rather take the free window. Demo couples are skipped too.
//
// Reuses the same `grantFreeAccess()` the admin "free badge" uses, so the result
// is identical to comping each couple by hand.
//
// Run (dry-run, prints what WOULD change):
//   railway run bun run backend/scripts/grant_founding_all.ts
// Apply for real:
//   railway run bun run backend/scripts/grant_founding_all.ts --apply
//
// NOTE: this connects to whatever DB_PATH points at. On Railway that's the
// mounted /data/weddly.db. It deliberately does NOT import tests/setup, so it
// never touches the test DB.

import { FOUNDING_DURATION_MS } from "@shared/billing";
import { db, now } from "../src/db";
import { grantFreeAccess } from "../src/domain/billing";

const APPLY = process.argv.includes("--apply");

interface Row {
  id: number;
  display_name: string | null;
  subscription_status: string;
}

// Live paying subscribers we must not touch.
const PROTECTED = new Set(["active", "past_due"]);

const all = db
  .prepare(
    "SELECT id, display_name, subscription_status FROM couples WHERE is_demo = 0 ORDER BY id",
  )
  .all() as Row[];

const targets = all.filter((c) => !PROTECTED.has(c.subscription_status));
const skipped = all.filter((c) => PROTECTED.has(c.subscription_status));

const nowMs = now();
const untilIso = new Date(nowMs + FOUNDING_DURATION_MS).toISOString().slice(0, 10);

console.log(`DB: ${process.env.DB_PATH ?? "./data/weddly.db"}`);
console.log(`Real couples: ${all.length}  |  to grant: ${targets.length}  |  skipped (paying): ${skipped.length}`);
console.log(`Founding window until: ${untilIso}`);
console.log("");

for (const c of targets) {
  const label = c.display_name?.trim() || `couple #${c.id}`;
  console.log(`  ${APPLY ? "GRANT " : "would "}#${c.id}  ${label}  (${c.subscription_status} → founding)`);
  if (APPLY) grantFreeAccess(c.id, nowMs);
}

for (const c of skipped) {
  console.log(`  skip  #${c.id}  ${c.display_name?.trim() || `couple #${c.id}`}  (paying: ${c.subscription_status})`);
}

console.log("");
if (APPLY) {
  console.log(`Done. Granted founding to ${targets.length} couple(s).`);
} else {
  console.log(`Dry-run only. Re-run with --apply to write these ${targets.length} change(s).`);
}
