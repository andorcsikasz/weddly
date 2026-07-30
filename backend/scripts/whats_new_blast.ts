// Operator-triggered product-update mail to workspaces that have gone quiet.
//
// Why a script and not a sweep: `comeback_nudge` already fires automatically at
// 21 days and is ONE-SHOT per (couple, user), so every workspace that has been
// away for a month already had its single automatic touch. A second automatic
// drip to people who chose to stay away is the fastest way to earn an
// unsubscribe (the reasoning is written out at the comeback sweep in
// domain/emails/worker.ts). Deciding that a release is worth telling them about
// is a judgement call, so a human makes it, once, here.
//
// Why not a campaign family: the four campaign families exist for audiences with
// no `users` row (cold vendors, imported contacts) and carry their own send
// tables, pacing and tracking. This audience is signed-in couples with an
// account, which is exactly what the lifecycle mailer already handles, including
// per-recipient locale, the unsubscribe footer and `email_dispatches`
// idempotency.
//
// Run (dry-run, prints who WOULD be mailed and nothing else):
//   railway run bun run backend/scripts/whats_new_blast.ts
// Send for real, at most 50 addresses:
//   railway run bun run backend/scripts/whats_new_blast.ts --send
// A different batch size:
//   railway run bun run backend/scripts/whats_new_blast.ts --send --limit 20
//
// Re-running is safe: `markDispatched` claims each (couple, user) pair before the
// send, so a second run only picks up whoever is left. Opt-outs and suppressions
// are enforced inside sendKind, not here.
//
// NOTE: connects to whatever DB_PATH points at. On Railway that is the mounted
// /data/weddly.db. It deliberately does not import tests/setup, so it never
// touches the test DB.

import { CONFIG } from "../src/config";
import { db, now } from "../src/db";
import { markDispatched, sendKind } from "../src/domain/emails/send";

/** The kind carries its own dated copy. A later wave means a new kind, not a
 *  new run of this one: the dispatch key is per kind, so reusing it would skip
 *  everybody who already got this list. */
const KIND = "whats_new_2026_07" as const;

/** Quiet for at least this long. Deliberately longer than the automatic
 *  comeback nudge's 21 days, so the two mails can't land in the same week. */
const QUIET_DAYS = 30;

/** Don't interrupt a couple who is inside the final fortnight: they're
 *  executing, not planning, and the T-7 milestone owns that week. Same constant
 *  the comeback sweep uses. */
const MIN_DAYS_BEFORE_WEDDING = 14;

/** Addresses per run. Warm lifecycle mail to an opted-in list, but it still
 *  rides the same sending domain as RSVP and verification mail, so it goes out
 *  in batches rather than one blast. */
const DEFAULT_LIMIT = 50;

const SEND = process.argv.includes("--send");
const limitFlag = process.argv.indexOf("--limit");
const LIMIT =
  limitFlag !== -1 && process.argv[limitFlag + 1]
    ? Number(process.argv[limitFlag + 1])
    : DEFAULT_LIMIT;

if (!Number.isFinite(LIMIT) || LIMIT <= 0) {
  console.error("--limit must be a positive number");
  process.exit(1);
}

interface Row {
  couple_id: number;
  display_name: string | null;
  wedding_date: string | null;
  user_id: number;
  email: string;
  full_name: string;
  last_seen: number;
}

const ts = now();
const startOfDayUtc = Math.floor(ts / 86_400_000) * 86_400_000;
const cutoff = ts - QUIET_DAYS * 86_400_000;
const earliestWedding = new Date(startOfDayUtc + MIN_DAYS_BEFORE_WEDDING * 86_400_000)
  .toISOString()
  .slice(0, 10);

// Same audience shape as the comeback sweep: the workspace is the unit, and
// `last_seen` is the NEWEST last_seen_at across its members, so a couple where
// one partner still logs in every evening is not told they've been away.
const rows = db
  .prepare(
    `SELECT c.id AS couple_id, c.display_name, c.wedding_date,
            u.id AS user_id, u.email, u.full_name,
            (SELECT MAX(COALESCE(u2.last_seen_at, u2.created_at))
               FROM users u2 WHERE u2.couple_id = c.id) AS last_seen
       FROM couples c
       JOIN users u ON u.couple_id = c.id
      WHERE c.status = 'active'
        AND c.is_demo = 0
        AND u.status = 'active'
        AND u.verified_email = 1
        AND u.email NOT LIKE '%@purged.local'
        AND u.email NOT LIKE '%@demo.weddly.local'
        AND u.role != 'vendor'
        AND u.user_type != 'planner'
        AND (c.wedding_date IS NULL OR TRIM(c.wedding_date) = '' OR c.wedding_date >= ?)
        AND last_seen <= ?
        AND NOT EXISTS (
              SELECT 1 FROM email_dispatches d
               WHERE d.couple_id = c.id AND d.user_id = u.id AND d.kind = ?
            )
      ORDER BY last_seen ASC`,
  )
  .all(earliestWedding, cutoff, KIND) as Row[];

// Grouped so a workspace is always mailed WHOLE. Overshooting the batch by one
// partner beats a household where one of them heard from us and the other is
// left waiting for the next run.
const byCouple = new Map<number, Row[]>();
for (const r of rows) {
  const list = byCouple.get(r.couple_id);
  if (list) list.push(r);
  else byCouple.set(r.couple_id, [r]);
}

console.log(
  `${KIND}: ${rows.length} address(es) across ${byCouple.size} workspace(s) quiet for ${QUIET_DAYS}+ days` +
    (SEND ? `, sending up to ${LIMIT}` : ", DRY RUN (pass --send to mail them)"),
);

let sent = 0;
for (const [coupleId, members] of byCouple) {
  if (sent >= LIMIT) break;
  for (const r of members) {
    const daysAway = Math.floor((ts - r.last_seen) / 86_400_000);
    const daysUntil =
      r.wedding_date && r.wedding_date.trim()
        ? Math.round((Date.parse(`${r.wedding_date}T00:00:00Z`) - startOfDayUtc) / 86_400_000)
        : null;

    if (!SEND) {
      console.log(
        `  would mail ${r.email} (#${String(coupleId).padStart(5, "0")} ${r.display_name ?? "?"}, away ${daysAway}d` +
          (daysUntil !== null ? `, wedding in ${daysUntil}d)` : ", no date)"),
      );
      sent++;
      continue;
    }

    // Claim the pair BEFORE sending, so a crash mid-run can't double-mail on the
    // next one. A claimed-but-failed send is the safer direction: the address
    // simply doesn't get this wave.
    if (!markDispatched({ kind: KIND, couple_id: coupleId, user_id: r.user_id })) continue;

    const result = await sendKind(
      KIND,
      {
        appUrl: `${CONFIG.frontendBaseUrl}/app`,
        daysAway,
        ...(daysUntil !== null && Number.isFinite(daysUntil)
          ? { daysUntilWedding: daysUntil }
          : {}),
        coupleDisplayName:
          r.display_name && r.display_name !== "Purged workspace" ? r.display_name : undefined,
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: coupleId,
      },
    );
    sent++;
    console.log(`  ${result.status}${result.error ? ` (${result.error})` : ""}: ${r.email}`);

    // Paced rather than blasted: the same domain reputation carries every
    // verification and RSVP mail we send.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

console.log(
  SEND
    ? `done: ${sent} address(es) processed, ${rows.length - sent} left for the next run`
    : `dry run complete: ${sent} address(es) listed`,
);
