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

/** Dev/test boot-time invariant check. Emits a `mailer.integrity.violation`
 *  log line for each offending file. Silent when the project is clean. */
export function assertEmailIntegrityAtBoot(repoRoot: string): void {
  if (process.env.NODE_ENV === "production") return;
  const violations = scanEmailIntegrity(repoRoot);
  for (const v of violations) {
    log.warn("mailer.integrity.violation", { path: v.path, reason: v.reason });
  }
}
