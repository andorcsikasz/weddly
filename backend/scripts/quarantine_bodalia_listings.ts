#!/usr/bin/env bun
// Operator entry point for the bodalia.es source-dispute quarantine
// (domain/listing_quarantine.ts). Idempotent and safe to re-run: rows already
// quarantined, or already claimed by a real vendor, are reported and left
// untouched. Nothing is deleted — the listing rows, their contact fields and
// their image files all stay exactly where they are; the quarantine only
// changes what's visible on public surfaces and stops future automated
// access, and the original images are additionally copied to a
// `quarantine-evidence/` prefix that no public route serves.
//
// Usage:
//   bun backend/scripts/quarantine_bodalia_listings.ts --admin-email you@x.com [--dry-run]
//
// `--admin-email` must resolve to an existing users row (typically an admin)
// — it's the actor recorded on the curated-override tombstone and the audit
// log, matching the "the person, the reason, the date" pattern the rest of
// the removal/moderation tooling already uses (domain/vendor_removal.ts).

import { getUserByEmail } from "../src/domain/users";
import {
  findExcludedFromQuarantine,
  findQuarantineCandidates,
  QUARANTINE_REASON_BODALIA,
  quarantineListings,
} from "../src/domain/listing_quarantine";

const HOST_FRAGMENT = "bodalia.es";

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

async function main() {
  const adminEmail = argValue("--admin-email");
  const dryRun = process.argv.includes("--dry-run");

  if (!adminEmail) {
    console.error(
      "Usage: bun backend/scripts/quarantine_bodalia_listings.ts --admin-email <email> [--dry-run]",
    );
    process.exit(1);
  }
  const admin = getUserByEmail(adminEmail);
  if (!admin) {
    console.error(`No user found for --admin-email ${adminEmail}`);
    process.exit(1);
  }

  const candidates = findQuarantineCandidates(HOST_FRAGMENT);
  const excluded = findExcludedFromQuarantine(HOST_FRAGMENT);
  const alreadyClaimed = excluded.filter((e) => e.reason === "already_claimed");
  const alreadyQuarantined = excluded.filter((e) => e.reason === "already_quarantined");

  console.log(`Source host: ${HOST_FRAGMENT}`);
  console.log(`Candidates to quarantine now: ${candidates.length}`);
  console.log(`Already claimed (untouched, always): ${alreadyClaimed.length}`);
  console.log(`Already quarantined (no-op): ${alreadyQuarantined.length}`);

  if (alreadyClaimed.length > 0) {
    console.log("\nAlready-claimed listings this run will NOT touch:");
    for (const row of alreadyClaimed) console.log(`  - ${row.id}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: no changes made.");
    if (candidates.length > 0) {
      console.log("Would quarantine:");
      for (const id of candidates) console.log(`  - ${id}`);
    }
    return;
  }

  if (candidates.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  const result = await quarantineListings(candidates, admin.id, QUARANTINE_REASON_BODALIA);
  console.log(`\nQuarantined: ${result.quarantined.length}`);
  console.log(`Images copied to quarantine-evidence/: ${result.imagesSnapshotted}`);
  if (result.skippedAlreadyClaimed.length > 0) {
    console.log(`Skipped (claimed mid-run): ${result.skippedAlreadyClaimed.join(", ")}`);
  }
  if (result.skippedAlreadyQuarantined.length > 0) {
    console.log(`Skipped (already quarantined): ${result.skippedAlreadyQuarantined.join(", ")}`);
  }

  const manifestPath = `docs/bodalia-quarantine-${new Date().toISOString().slice(0, 10)}.json`;
  await Bun.write(
    manifestPath,
    JSON.stringify(
      {
        run_at: new Date().toISOString(),
        actor_email: adminEmail,
        actor_user_id: admin.id,
        reason: QUARANTINE_REASON_BODALIA,
        quarantined_ids: result.quarantined,
        images_snapshotted: result.imagesSnapshotted,
        already_claimed_skipped: result.skippedAlreadyClaimed,
        already_quarantined_skipped: result.skippedAlreadyQuarantined,
      },
      null,
      2,
    ),
  );
  console.log(`\nManifest written to ${manifestPath}`);
}

await main();
