// One-off repair: `personal_invite_campaign_sends.name` for the "friends-2026-07"
// campaign (id 2) got badly corrupted for the second import batch (ids 755+).
// The source CSV's "name" column wasn't a name at all - it was a raw export row
// quoted as one field: "<price>.0000,<order id>,<M/D/YY H:MM>,<Real Name>" - so
// every greeting read "Szia 0.0000,56955,6/11/21 21:13,Szigeti Kristóf!" instead
// of "Szia Kristóf!". Reported by a recipient 2026-08-24.
//
// The real name is reliably the LAST comma-separated field; every corrupted row
// sampled (1246/1246) matched this shape with nothing left over. A legitimate
// Hungarian name in this table never contains a raw comma, so `name LIKE '%,%'`
// is a safe, campaign-agnostic filter for "this row is corrupted."
//
// Safe to run repeatedly: once fixed a name has no comma left and the WHERE
// clause stops matching it. Rows already SENT are fixed too (for correct
// display/records), which cannot recall the mail already delivered.
//
// Usage:
//   bun backend/scripts/fix_personal_invite_garbled_names.ts [--dry]
//
// In production, run it inside the container so it talks to the volume's DB:
//   railway ssh 'cd /app/backend && bun scripts/fix_personal_invite_garbled_names.ts'

import { db } from "../src/db";

const dry = process.argv.includes("--dry");

const PATTERN = /^[0-9.]+,\d+,[0-9/: ]+,(.+)$/;

const rows = db
  .prepare(
    `SELECT id, campaign_id, name FROM personal_invite_campaign_sends
      WHERE name LIKE '%,%'
      ORDER BY id ASC`,
  )
  .all() as { id: number; campaign_id: number; name: string }[];

if (rows.length === 0) {
  console.log("[fix_personal_invite_garbled_names] nothing to fix, no comma-bearing names.");
  process.exit(0);
}

const fixable: { id: number; campaign_id: number; from: string; to: string }[] = [];
const unmatched: { id: number; campaign_id: number; name: string }[] = [];

for (const row of rows) {
  const m = PATTERN.exec(row.name);
  const clean = m?.[1]?.trim();
  if (clean) {
    fixable.push({ id: row.id, campaign_id: row.campaign_id, from: row.name, to: clean });
  } else {
    unmatched.push(row);
  }
}

console.log(
  `[fix_personal_invite_garbled_names] ${rows.length} comma-bearing name(s): ${fixable.length} fixable, ${unmatched.length} unmatched.`,
);
for (const u of unmatched) {
  console.log(`  UNMATCHED id=${u.id} campaign=${u.campaign_id} name=${JSON.stringify(u.name)}`);
}

if (dry) {
  console.log("[fix_personal_invite_garbled_names] --dry, sample of what would change:");
  for (const f of fixable.slice(0, 10)) {
    console.log(`  id=${f.id}: ${JSON.stringify(f.from)} -> ${JSON.stringify(f.to)}`);
  }
  console.log(`[fix_personal_invite_garbled_names] --dry, nothing written.`);
  process.exit(0);
}

const update = db.prepare("UPDATE personal_invite_campaign_sends SET name = ? WHERE id = ?");
const tx = db.transaction((items: typeof fixable) => {
  for (const f of items) update.run(f.to, f.id);
});
tx(fixable);

console.log(`[fix_personal_invite_garbled_names] done, ${fixable.length} row(s) fixed.`);
process.exit(0);
