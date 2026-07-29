// One-off repair: hand every couple's outreach message to the vendor it was
// addressed to, for the sends that predate the outreach → `supplier_bookings`
// seam (commit 909bd106, 2026-07-28).
//
// Until that commit, `POST /api/outreach/campaigns` was email-only: it wrote
// `outreach_campaigns` / `outreach_messages` and mailed `listings.contact_email`,
// and never touched `supplier_bookings`, the one table every vendor surface
// reads. So a couple sent an inquiry, saw it in their own sent history, and the
// vendor's portal honestly reported zero inquiries forever. Those leads are
// still sitting in the mail table with nothing pointing at them.
//
// Safe to run repeatedly. `replayOutreachForListing` is keyed on
// `outreach_messages.booking_id`, so a message that already landed is skipped,
// and a follow-up to a couple with an open inquiry appends to that inquiry
// rather than opening a second one. Inquiries are backdated to the ORIGINAL
// send time, so a vendor sees when the couple actually wrote.
//
// Usage:
//   bun backend/scripts/backfill_outreach_inquiries.ts [--dry]
//
// In production, run it inside the container so it talks to the volume's DB:
//   railway ssh 'cd /app/backend && bun scripts/backfill_outreach_inquiries.ts'

import { db } from "../src/db";
import { replayOutreachForListing } from "../src/domain/outreach";

const dry = process.argv.includes("--dry");

// Only listings that HAVE an account can receive a delivery; an unclaimed one
// has nothing to deliver into and is correctly left for the claim-time replay.
const pending = db
  .prepare(
    `SELECT m.supplier_id AS supplier_id,
            COUNT(*)      AS messages,
            l.vendor_account_id AS vendor_account_id
       FROM outreach_messages m
       JOIN listings l ON l.id = m.supplier_id
      WHERE m.booking_id IS NULL
        AND l.vendor_account_id IS NOT NULL
      GROUP BY m.supplier_id
      ORDER BY m.supplier_id`,
  )
  .all() as { supplier_id: string; messages: number; vendor_account_id: number }[];

const orphaned = db
  .prepare(
    `SELECT COUNT(*) AS n FROM outreach_messages m
       LEFT JOIN listings l ON l.id = m.supplier_id
      WHERE m.booking_id IS NULL
        AND (l.id IS NULL OR l.vendor_account_id IS NULL)`,
  )
  .get() as { n: number };

if (pending.length === 0) {
  console.log("[backfill_outreach_inquiries] nothing to deliver, every message is accounted for.");
} else {
  console.log(
    `[backfill_outreach_inquiries] ${pending.length} claimed listing(s) with undelivered messages:`,
  );
  for (const row of pending) {
    console.log(
      `  ${row.supplier_id.padEnd(32)} account ${String(row.vendor_account_id).padStart(4)}  ${row.messages} message(s)`,
    );
  }
}

if (orphaned.n > 0) {
  // Not a failure: these are messages to businesses that never joined. They get
  // their leads the moment they claim, via `replayOutreachForListing` at
  // claim-complete. Reported so the count is never silently dropped.
  console.log(
    `[backfill_outreach_inquiries] ${orphaned.n} message(s) target an unclaimed listing, left for the claim-time replay.`,
  );
}

if (dry) {
  console.log("[backfill_outreach_inquiries] --dry, nothing written.");
  process.exit(0);
}

let landed = 0;
for (const row of pending) {
  const n = replayOutreachForListing(row.supplier_id);
  landed += n;
  if (n > 0) console.log(`  → ${row.supplier_id}: delivered ${n}`);
}
console.log(`[backfill_outreach_inquiries] done, ${landed} inquiry/inquiries delivered.`);
process.exit(0);
