// One-off: move a hand-picked set of couples back onto the trial → paid path.
//
// For each target couple it stamps:
//   subscription_status = 'trialing'
//   trial_ends_at       = max(now + 14d, PAID_LAUNCH_DATE)  → "free until Aug 1, 2026"
//   is_founding_member  = 0      (full reset: releases the founding slot)
//   founding_until      = NULL
// Stripe linkage fields are left untouched.
//
// Live paying subscribers (active / past_due) are SKIPPED so we never clobber a
// real Stripe subscription; pass --force to override that guard. Demo couples
// are skipped unconditionally.
//
// The couples are identified by the zero-padded workspace code shown in the
// admin UI ("00114" → couples.id = 114).
//
// Run (dry-run, prints CURRENT state + what WOULD change):
//   railway run bun run backend/scripts/move_to_trial.ts
// Apply for real:
//   railway run bun run backend/scripts/move_to_trial.ts --apply
//
// NOTE: connects to whatever DB_PATH points at (on Railway: /data/weddly.db).
// Deliberately does NOT import tests/setup, so it never touches the test DB.

import { PAID_LAUNCH_DATE, TRIAL_DURATION_MS } from "@shared/billing";
import { db, now } from "../src/db";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

// Admin workspace codes the user asked to move to trial → couples.id.
const TARGET_IDS = [
  114, 110, 107, 104, 94, 93, 87, 83, 79, 64, 30, 26, 21, 20, 19, 16, 15, 14, 13, 12, 11, 10, 9,
];

interface Row {
  id: number;
  display_name: string | null;
  is_demo: number;
  subscription_status: string;
  is_founding_member: number;
  founding_until: number | null;
  trial_ends_at: number | null;
  owner_email: string | null;
}

// Live paying subscribers we must not touch (unless --force).
const PROTECTED = new Set(["active", "past_due"]);

const code = (id: number) => String(id).padStart(5, "0");
const isoDay = (ms: number | null) => (ms == null ? "—" : new Date(ms).toISOString().slice(0, 10));

const select = db.prepare(
  `SELECT c.id, c.display_name, c.is_demo, c.subscription_status,
          c.is_founding_member, c.founding_until, c.trial_ends_at,
          u.email AS owner_email
     FROM couples c
     LEFT JOIN users u ON u.id = c.partner_a_id
    WHERE c.id = ?`,
);

const update = db.prepare(
  `UPDATE couples
      SET subscription_status = 'trialing',
          trial_ends_at = ?,
          is_founding_member = 0,
          founding_until = NULL,
          updated_at = ?
    WHERE id = ?`,
);

const nowMs = now();
const trialEnd = Math.max(nowMs + TRIAL_DURATION_MS, PAID_LAUNCH_DATE);

console.log(`DB: ${process.env.DB_PATH ?? "./data/weddly.db"}`);
console.log(`Targets: ${TARGET_IDS.length}  |  trial_ends_at → ${isoDay(trialEnd)}`);
console.log("");

let changed = 0;
let skipped = 0;
let missing = 0;

for (const id of TARGET_IDS) {
  const row = select.get(id) as Row | undefined;
  if (!row) {
    console.log(`  MISS  ${code(id)}  (no couple with id ${id})`);
    missing++;
    continue;
  }

  const label = row.display_name?.trim() || `couple #${row.id}`;
  const who = row.owner_email ?? "?";
  const before = `${row.subscription_status}${row.is_founding_member ? "/founder" : ""}, founding_until=${isoDay(row.founding_until)}, trial_ends_at=${isoDay(row.trial_ends_at)}`;

  if (row.is_demo) {
    console.log(`  skip  ${code(id)}  ${label}  (demo)`);
    skipped++;
    continue;
  }
  if (PROTECTED.has(row.subscription_status) && !FORCE) {
    console.log(
      `  SKIP  ${code(id)}  ${label}  (paying: ${row.subscription_status}) — use --force`,
    );
    skipped++;
    continue;
  }

  console.log(`  ${APPLY ? "MOVE " : "would"}  ${code(id)}  ${label}  <${who}>`);
  console.log(`          from: ${before}`);
  console.log(`          to:   trialing, founding cleared, trial_ends_at=${isoDay(trialEnd)}`);
  if (APPLY) update.run(trialEnd, nowMs, row.id);
  changed++;
}

console.log("");
console.log(
  `Found ${TARGET_IDS.length - missing}/${TARGET_IDS.length}  |  ${APPLY ? "moved" : "would move"}: ${changed}  |  skipped: ${skipped}  |  missing: ${missing}`,
);
if (!APPLY) console.log(`Dry-run only. Re-run with --apply to write these ${changed} change(s).`);
