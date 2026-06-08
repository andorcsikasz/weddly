// Audience filtering for the admin analytics surface. Every couple- or
// user-shaped rollup runs through one of the two predicate builders here so
// the same cohort rules apply consistently across Money / Activity / Weddings
// / Honeymoon / Guests / Picks / Engagement. Without this, the team's own
// admin + test usage (and demo seeds) silently distort feature-usage,
// session, and engagement numbers.
//
// Cohorts:
//   - admin    : a partner's email is in the ADMIN_EMAILS allowlist
//   - test     : a partner has users.is_beta_tester = 1
//   - demo     : couples.is_demo = 1 (landing "Try the demo" seeds)
//   - archived : couples.status = 'archived' (past weddings, kept read-only)
//   - deleting : couples.status = 'deleting' (purge countdown / tombstones)
//   - real     : none of the above — a genuine active couple
//
// The baseline ("real users only") excludes every non-real cohort; each toggle
// adds one back. Purged tombstones (`…@purged.local`) are ALWAYS excluded —
// they're deleted accounts, never a meaningful cohort to include.
//
// Admin emails come from trusted CONFIG (env), never request input, so they're
// inlined as escaped SQL string literals. That keeps every predicate a
// self-contained boolean expression with NO bind params — it drops into any
// WHERE clause with `AND (…)` without disturbing the caller's parameter order.

import type { AnalyticsAudience } from "@shared/admin_analytics";
import { CONFIG } from "../config";

export type { AnalyticsAudience };

/** The default lens: a clean "real users only" view. */
export const REAL_USERS_ONLY: AnalyticsAudience = {
  includeAdmins: false,
  includeTest: false,
  includeDemos: false,
  includeArchived: false,
  includeDeleting: false,
};

/** Parse the audience toggles off the request query string. Anything not
 *  explicitly "1"/"true" stays off, so a bare request is the real-only view. */
export function parseAudience(params: URLSearchParams): AnalyticsAudience {
  const on = (k: string): boolean => {
    const v = params.get(k);
    return v === "1" || v === "true";
  };
  return {
    includeAdmins: on("include_admins"),
    includeTest: on("include_test"),
    includeDemos: on("include_demos"),
    includeArchived: on("include_archived"),
    includeDeleting: on("include_deleting"),
  };
}

function sqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Comma-separated, escaped, lowercased admin-email list for an IN clause, or
 *  null when the allowlist is empty (so callers skip the clause entirely
 *  rather than emit an invalid empty `IN ()`). */
function adminEmailList(): string | null {
  const emails = CONFIG.adminEmails;
  if (emails.length === 0) return null;
  return emails.map((e) => sqlQuote(e.toLowerCase())).join(", ");
}

/** Predicate that is TRUE for couples the given audience should INCLUDE.
 *  `alias` is the couples table alias in the caller's query (e.g. "c" or the
 *  bare table name "couples"). Returns a parameter-free SQL boolean string. */
export function coupleAudienceSql(alias: string, f: AnalyticsAudience): string {
  const A = alias;
  const clauses: string[] = [];
  if (!f.includeDeleting) clauses.push(`${A}.status <> 'deleting'`);
  if (!f.includeArchived) clauses.push(`${A}.status <> 'archived'`);
  if (!f.includeDemos) clauses.push(`${A}.is_demo = 0`);
  if (!f.includeAdmins) {
    const list = adminEmailList();
    if (list) {
      clauses.push(
        `NOT EXISTS (SELECT 1 FROM users u WHERE (u.id = ${A}.partner_a_id OR u.id = ${A}.partner_b_id) AND lower(u.email) IN (${list}))`,
      );
    }
  }
  if (!f.includeTest) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM users u WHERE (u.id = ${A}.partner_a_id OR u.id = ${A}.partner_b_id) AND u.is_beta_tester = 1)`,
    );
  }
  return clauses.length > 0 ? clauses.join(" AND ") : "1 = 1";
}

/** Predicate that is TRUE for users the given audience should INCLUDE. `alias`
 *  is the users table alias (e.g. "u" or "users"). Purged tombstones are
 *  always excluded. Returns a parameter-free SQL boolean string. */
export function userAudienceSql(alias: string, f: AnalyticsAudience): string {
  const A = alias;
  const clauses: string[] = [`${A}.email NOT LIKE '%@purged.local'`];
  if (!f.includeAdmins) {
    const list = adminEmailList();
    if (list) clauses.push(`lower(${A}.email) NOT IN (${list})`);
  }
  if (!f.includeTest) clauses.push(`${A}.is_beta_tester = 0`);
  if (!f.includeDemos) {
    clauses.push(
      `${A}.email NOT LIKE '%@demo.weddly.local' AND NOT EXISTS (SELECT 1 FROM couples c WHERE c.id = ${A}.couple_id AND c.is_demo = 1)`,
    );
  }
  if (!f.includeDeleting) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM couples c WHERE c.id = ${A}.couple_id AND c.status = 'deleting')`,
    );
  }
  if (!f.includeArchived) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM couples c WHERE c.id = ${A}.couple_id AND c.status = 'archived')`,
    );
  }
  return clauses.join(" AND ");
}
