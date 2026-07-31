// Dev-time guard against re-introducing the "phishy ugly email" regression
// the legacy `bilingualBody` path caused for months.
//
// The rule: only `domain/emails/send.ts` (the central dispatcher) is allowed
// to import `sendEmail` from `lib/mailer.ts` directly. Every other route or
// domain module must go through `sendKind`, which guarantees the branded
// shell, recipient locale, audit log row, and Auto-Submitted headers.
//
// Boot-time scan. Dev/test only — production should stay quiet, and an
// integrity violation in prod is a bug we'd already see in QA. Emits a
// console.warn (not throw) so a violation doesn't block local development;
// the warning is loud enough to notice and matches `warnDrift()` pattern
// from the i18n layer.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { log } from "../../lib/logger";
import { type EmailKind, senderForKind } from "./kinds";

const ALLOWED_DIRECT_CALLERS = new Set<string>([
  // The central dispatcher — by design.
  "backend/src/domain/emails/send.ts",
]);

const SCAN_ROOTS = ["backend/src/routes", "backend/src/domain", "backend/src/lib"];

const IMPORT_REGEX = /from\s+["'][^"']*\/lib\/mailer["']/;
const SENDEMAIL_USAGE_REGEX = /\bsendEmail\s*\(/;

interface Violation {
  path: string;
  reason: string;
}

/** Walk the source tree and return any files that import `sendEmail` from
 *  `lib/mailer` outside the allowed dispatcher. Returns an empty array when
 *  the project is clean. Synchronous on purpose — runs once at boot. */
export function scanEmailIntegrity(repoRoot: string): Violation[] {
  const violations: Violation[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(repoRoot, root);
    try {
      walk(abs, repoRoot, violations);
    } catch {
      // Source tree not where we expected — happens in some test sandboxes.
      // Silently skip; the integrity check is best-effort.
    }
  }
  return violations;
}

function walk(dir: string, repoRoot: string, violations: Violation[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, repoRoot, violations);
      continue;
    }
    if (!full.endsWith(".ts")) continue;
    if (full.endsWith(".test.ts") || full.endsWith(".spec.ts")) continue;
    const rel = full.slice(repoRoot.length + 1);
    if (ALLOWED_DIRECT_CALLERS.has(rel)) continue;
    // The mailer module itself is the source — skip.
    if (rel.endsWith("/lib/mailer.ts")) continue;

    const text = readFileSync(full, "utf8");
    if (!IMPORT_REGEX.test(text)) continue;
    if (!SENDEMAIL_USAGE_REGEX.test(text)) continue;

    violations.push({
      path: rel,
      reason: "imports sendEmail directly — should use sendKind() from domain/emails instead",
    });
  }
}

// ── Admin-console sender scan ──────────────────────────────────────────────
// Owner rule, 2026-07-31: anything an admin sends from /app/admin/* leaves
// from the support mailbox, not `noreply@`. The classification lives on the
// KIND (`ADMIN_CONSOLE_KINDS`), which is what makes it impossible to get wrong
// per call site — but nothing stops a NEW admin route from sending a kind
// nobody classified, and that failure is invisible: the mail goes out looking
// fine, just from the wrong mailbox.
//
// So: any file that registers a route under `/api/admin/` must not send a kind
// that resolves to the default sender, unless the kind is on the exception
// list below. Scoping the scan to those files is deliberate — plenty of kinds
// are sent from BOTH an admin route and a worker, and those pass an explicit
// per-send `sender` at the admin call site rather than being reclassified.

const ADMIN_ROUTE_REGEX = /["'`]\/api\/admin\//;
/** `sendKind(` followed by the kind literal, across the usual line break. */
const SEND_KIND_LITERAL_REGEX = /sendKind[\s\S]{0,40}?["']([a-z0-9_]+)["']/g;
/** A per-send override inside this very call, which the scan cannot evaluate
 *  but which means a human already decided the sender here. */
const EXPLICIT_SENDER_REGEX = /sender:\s*["'](?:admin|default)["']/;

/** Kinds a file that ALSO serves admin routes may send from the default
 *  mailbox. Each needs a reason; "the scan complained" is not one.
 *
 *  - `vendor_review_campaign` + its reminder: owner direction — the campaign
 *    asking vendors to collect ratings keeps the automatic sender. This is the
 *    one deliberate carve-out from the rule, not an oversight.
 *  - the two `*_waitlist_received` confirmations: the public application form
 *    lives in the same route file as the admin triage endpoints, and nobody in
 *    admin sent them — the applicant's own submit did. */
const ADMIN_SENDER_EXCEPTIONS = new Set<string>([
  "vendor_review_campaign",
  "vendor_review_campaign_reminder",
  "planner_waitlist_received",
  "vendor_waitlist_received",
]);

/** The source of one `sendKind(...)` call, from the match to its closing
 *  paren. Used to ask whether THIS call passes an explicit sender, rather than
 *  letting one annotated call anywhere in the file excuse the whole file. */
function callSource(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length && i < from + 4000; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return text.slice(from, from + 4000);
}

/** Scan every file that serves an `/api/admin/` route for a send that would go
 *  out from `noreply@`. Empty array when clean. */
export function scanAdminSenderIntegrity(repoRoot: string): Violation[] {
  const violations: Violation[] = [];
  const routesDir = join(repoRoot, "backend/src/routes");
  let entries: string[];
  try {
    entries = readdirSync(routesDir);
  } catch {
    return violations;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
    const full = join(routesDir, entry);
    const text = readFileSync(full, "utf8");
    if (!ADMIN_ROUTE_REGEX.test(text)) continue;
    for (const m of text.matchAll(SEND_KIND_LITERAL_REGEX)) {
      const kind = m[1];
      if (!kind) continue;
      if (ADMIN_SENDER_EXCEPTIONS.has(kind)) continue;
      if (senderForKind(kind as EmailKind) === "admin") continue;
      if (EXPLICIT_SENDER_REGEX.test(callSource(text, m.index))) continue;
      violations.push({
        path: `backend/src/routes/${entry}`,
        reason:
          `sends "${kind}" from an /api/admin/ route but it resolves to the default ` +
          `(noreply@) sender — add it to ADMIN_CONSOLE_KINDS, or pass sender: "admin" ` +
          `on the send if a worker fires the same kind on its own`,
      });
    }
  }
  return violations;
}

/** Dev/test boot-time invariant check. Emits a `mailer.integrity.violation`
 *  log line for each offending file. Silent when the project is clean. */
export function assertEmailIntegrityAtBoot(repoRoot: string): void {
  if (process.env.NODE_ENV === "production") return;
  const violations = [...scanEmailIntegrity(repoRoot), ...scanAdminSenderIntegrity(repoRoot)];
  for (const v of violations) {
    log.warn("mailer.integrity.violation", { path: v.path, reason: v.reason });
  }
}
