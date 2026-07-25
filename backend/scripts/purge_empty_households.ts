// One-time cleanup for 0-member "orphan" households left behind before the
// auto-delete-on-move fix landed. Moving a guest out of a solo household used to
// leave the emptied household in place, still showing in the guest list, the
// household picker, and holding its own check-in code (e.g. "Csíkász Anna ·
// 8BM95ZY0"). This finds every member-less household and removes it.
//
// A freshly created-but-not-yet-populated household is ALSO member-less, so the
// script is dry-run by default: it prints the full list for review and only
// deletes when you pass --apply.
//
// Usage:
//   bun backend/scripts/purge_empty_households.ts            # dry run (lists only)
//   bun backend/scripts/purge_empty_households.ts --apply    # actually delete
//
// Deletion is FK-safe under PRAGMA foreign_keys = ON (see
// domain/household_cleanup.ts).

import { listEmptyHouseholds, purgeEmptyHouseholds } from "../src/domain/household_cleanup";

const apply = process.argv.includes("--apply");

const empties = listEmptyHouseholds();

if (empties.length === 0) {
  console.log("[purge_empty_households] no member-less households found. Nothing to do.");
  process.exit(0);
}

console.log(`[purge_empty_households] ${empties.length} member-less household(s):`);
for (const h of empties) {
  console.log(
    `  couple ${h.couple_id}  ·  #${h.id}  ·  ${h.code}  ·  ${h.label || "(no label)"}  ·  created ${h.created_at}`,
  );
}

if (!apply) {
  console.log(
    "\n[purge_empty_households] dry run — nothing deleted. Re-run with --apply to remove the households above.",
  );
  process.exit(0);
}

const removed = purgeEmptyHouseholds(empties.map((h) => h.id));
console.log(`\n[purge_empty_households] deleted ${removed} household(s).`);
