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
// The couples are identified by OWNER EMAIL (partner A or B). The zero-padded
// workspace code shown in the admin UI is a display sequence, NOT couples.id,
// so email is the only reliable key when running against production.
//
// Run from INSIDE the Railway container (railway run executes locally and would
// hit the local dev DB — the prod SQLite file lives on the /data volume):
//   railway ssh "cd /app/backend && bun run scripts/move_to_trial.ts"          # dry-run
//   railway ssh "cd /app/backend && bun run scripts/move_to_trial.ts --apply"  # apply
//
// NOTE: connects to whatever DB_PATH points at (on Railway: /data/weddly.db).
// Deliberately does NOT import tests/setup, so it never touches the test DB.

import { PAID_LAUNCH_DATE, TRIAL_DURATION_MS } from "@shared/billing";
import { db, now } from "../src/db";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

// Owner emails the user asked to move to trial. Matched against partner A or B.
const TARGET_EMAILS = [
  "pecskoviklaudia@gmail.com",
  "varaljai.liza@gmail.com",
  "tomiqa@gmail.com",
  "walti96@gmail.com",
  "viktoria.zsolnai@gmail.com",
  "peter.barko92@gmail.com",
  "danicskamagdolna@gmail.com",
  "ivettfilimon@gmail.com",
  "nagy.eszter.biborka@gmail.com",
  "peterakos19@gmail.com",
  "barnabasesdorottya@gmail.com",
  "ayele.fanni@gmail.com",
  "t.gitaron70@gmail.com",
  "k.szigeti04@gmail.com",
  "oszlanszki.marko@gmail.com",
  "nelly.erdodi@gmail.com",
  "nagymartonzsolt2@gmail.com",
  "lajerbettina518@gmail.com",
  "nollikallo@gmail.com",
  "tnitramd@gmail.com",
  "lajos.gloria@gmail.com",
  "torma.szabolcs.2000@gmail.com",
  "poletthorvath8@gmail.com",
  "annacsikasz@gmail.com",
].map((e) => e.toLowerCase());

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

// Resolve a couple by either partner's email. Two LEFT JOINs so we match
// whether the listed person is partner A or B; owner_email reports the hit.
const select = db.prepare(
  `SELECT c.id, c.display_name, c.is_demo, c.subscription_status,
          c.is_founding_member, c.founding_until, c.trial_ends_at,
          ? AS owner_email
     FROM couples c
     LEFT JOIN users a ON a.id = c.partner_a_id
     LEFT JOIN users b ON b.id = c.partner_b_id
    WHERE lower(a.email) = ? OR lower(b.email) = ?`,
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
console.log(`Targets: ${TARGET_EMAILS.length}  |  trial_ends_at → ${isoDay(trialEnd)}`);
console.log("");

let changed = 0;
let skipped = 0;
let missing = 0;

for (const email of TARGET_EMAILS) {
  const row = select.get(email, email, email) as Row | undefined;
  if (!row) {
    console.log(`  MISS  <${email}>  (no couple)`);
    missing++;
    continue;
  }

  const label = row.display_name?.trim() || `couple #${row.id}`;
  const before = `${row.subscription_status}${row.is_founding_member ? "/founder" : ""}, founding_until=${isoDay(row.founding_until)}, trial_ends_at=${isoDay(row.trial_ends_at)}`;

  if (row.is_demo) {
    console.log(`  skip  ${code(row.id)}  ${label}  <${email}>  (demo)`);
    skipped++;
    continue;
  }
  if (PROTECTED.has(row.subscription_status) && !FORCE) {
    console.log(
      `  SKIP  ${code(row.id)}  ${label}  <${email}>  (paying: ${row.subscription_status}) — use --force`,
    );
    skipped++;
    continue;
  }

  console.log(`  ${APPLY ? "MOVE " : "would"}  ${code(row.id)}  ${label}  <${email}>`);
  console.log(`          from: ${before}`);
  console.log(`          to:   trialing, founding cleared, trial_ends_at=${isoDay(trialEnd)}`);
  if (APPLY) update.run(trialEnd, nowMs, row.id);
  changed++;
}

console.log("");
console.log(
  `Found ${TARGET_EMAILS.length - missing}/${TARGET_EMAILS.length}  |  ${APPLY ? "moved" : "would move"}: ${changed}  |  skipped: ${skipped}  |  missing: ${missing}`,
);
if (!APPLY) console.log(`Dry-run only. Re-run with --apply to write these ${changed} change(s).`);
