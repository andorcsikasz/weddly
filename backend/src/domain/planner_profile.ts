// Planner public-profile completeness — the "your profile is missing info"
// reminder shared by the automatic post-signup sweep (domain/emails/worker.ts)
// and the admin "Send reminder" button (routes/admin_planners.ts). One place
// owns the definition of "what's missing" so the sweep, the button and the
// email body can never disagree.

import type { PlannerProfileChecklist } from "@shared/types";
import { CONFIG } from "../config";
import { db } from "../db";
import { sendKind } from "./emails";

/** The subset of a planner `users` row this module reasons about. */
export interface PlannerProfileRow {
  id: number;
  email: string;
  full_name: string;
  business_name: string | null;
  planner_city: string | null;
  planner_bio: string | null;
  /** JSON string[] of wedding-style slugs, or null. */
  planner_styles: string | null;
}

/** Which public-profile fields the planner hasn't filled in yet. `businessName`
 *  + `city` are the directory-blocking pair (a card can't list without them);
 *  `bio` + `styles` are the softer "makes the card convincing" fields the email
 *  also nudges. */
export function plannerProfileMissing(
  row: Pick<PlannerProfileRow, "business_name" | "planner_city" | "planner_bio" | "planner_styles">,
): {
  businessName: boolean;
  city: boolean;
  bio: boolean;
  styles: boolean;
} {
  const blank = (v: string | null) => !(v && v.trim().length > 0);
  let hasStyles = false;
  try {
    const parsed = JSON.parse(row.planner_styles ?? "[]");
    hasStyles = Array.isArray(parsed) && parsed.length > 0;
  } catch {
    hasStyles = false;
  }
  return {
    businessName: blank(row.business_name),
    city: blank(row.planner_city),
    bio: blank(row.planner_bio),
    styles: !hasStyles,
  };
}

/** True when the planner has filled in every public-profile field the nudge
 *  asks for. This is what FILLS the verified badge on the planner card and
 *  detail page: the admin's trust signal is never withheld, but a card that is
 *  still missing its bio or styles wears the check as an outline. Reuses the
 *  nudge's own definition of "missing" so the email and the badge can't drift.
 *
 *  The vendor-side counterpart is `completeListingIds` / the listing checklist,
 *  and both feed one `<VerifiedBadge complete>` in the frontend, so a hollow
 *  check means the same thing wherever a couple meets it. */
export function isPlannerProfileComplete(
  row: Pick<PlannerProfileRow, "business_name" | "planner_city" | "planner_bio" | "planner_styles">,
): boolean {
  const m = plannerProfileMissing(row);
  return !m.businessName && !m.city && !m.bio && !m.styles;
}

/** True when the planner can't even be listed in the directory yet (missing the
 *  business name or city). Drives BOTH the auto-nudge sweep and the admin
 *  "Send reminder" button, so the two stay in lockstep. */
export function isPlannerProfileIncomplete(row: PlannerProfileRow): boolean {
  const m = plannerProfileMissing(row);
  return m.businessName || m.city;
}

/** The row shape the public-profile checklist reasons about: the four listing
 *  fields plus the free-text availability note (the only showcase half that
 *  lives on `users` rather than in a child table). */
export type PlannerChecklistRow = Pick<
  PlannerProfileRow,
  "business_name" | "planner_city" | "planner_bio" | "planner_styles"
> & { planner_availability: string | null };

/** What a couple actually meets on the profile. The first four mirror the
 *  directory-listing fields the verified badge already measures; the last three
 *  are the showcase sections, which render only when they have content, so a
 *  planner can fill in every text field and still publish a page that is a
 *  monogram tile over three collapsed sections.
 *
 *  ONE implementation on purpose. `GET /api/planner/profile` returns it, the
 *  settings ring draws it, and the points engine pays 25% milestones off it
 *  (`plannerChecklistCompleteness`). A second copy would mean the planner is
 *  told they are 71% done and paid for a different number. The child-table
 *  lookups are why it can't be a pure function of the row: the photo, the
 *  package and the blocked-date calendar all live outside `users`. */
export function plannerProfileChecklist(
  row: PlannerChecklistRow,
  userId: number,
): PlannerProfileChecklist {
  const missing = plannerProfileMissing(row);
  const has = (sql: string) => ((db.prepare(sql).get(userId) as { n: number }).n ?? 0) > 0;
  return {
    business_name: !missing.businessName,
    city: !missing.city,
    bio: !missing.bio,
    styles: !missing.styles,
    has_photo: has(
      "SELECT COUNT(*) AS n FROM planner_portfolio WHERE planner_user_id = ? AND image_url IS NOT NULL",
    ),
    has_package: has("SELECT COUNT(*) AS n FROM planner_packages WHERE planner_user_id = ?"),
    // Either half of the availability block counts: a kept calendar OR the
    // free-text note. Both render the same section to the couple.
    has_availability:
      Boolean(row.planner_availability?.trim()) ||
      has("SELECT COUNT(*) AS n FROM planner_unavailable_dates WHERE planner_user_id = ?"),
  };
}

/** The same checklist for a caller that holds only a user id (the points
 *  engine, which is handed an id by the outbox). Null when the id is not a
 *  planner row at all. */
export function plannerChecklistForUser(userId: number): PlannerProfileChecklist | null {
  const row = db
    .prepare(
      `SELECT business_name, planner_city, planner_bio, planner_styles, planner_availability
         FROM users WHERE id = ? AND user_type = 'planner'`,
    )
    .get(userId) as PlannerChecklistRow | undefined;
  return row ? plannerProfileChecklist(row, userId) : null;
}

/** The couple-facing directory's own visibility predicate, as SQL over a `users
 *  u` alias. Admin-verified planners are surfaced even with a thin profile (the
 *  card falls back to full_name and city is optional); everyone else still needs
 *  a minimally complete profile (business name + city). Dormant provisioned
 *  accounts (verified_email=0), suspended users and demo planners are out.
 *
 *  Lives here rather than inline in the route because THREE readers have to
 *  agree on it: the directory list, the single-planner detail, and the Weddly
 *  Points rank, whose whole claim is "your place among the planners a couple can
 *  actually find". A rank counted against a different pool than the directory
 *  shows would be a number about nobody. */
export const PLANNER_DIRECTORY_VISIBLE_SQL = `
  u.user_type = 'planner'
  AND u.status = 'active'
  AND u.verified_email = 1
  AND u.email NOT LIKE '%@demo.weddly.local'
  AND (
    u.planner_verified = 1
    OR (TRIM(COALESCE(u.business_name, '')) != ''
        AND TRIM(COALESCE(u.planner_city, '')) != '')
  )`;

/** Fire the "complete your profile" email. Fire-and-forget: a mailer hiccup
 *  never fails the caller (sweep or admin action). Callers own the "should we
 *  send" decision (dedup for the sweep, explicit click for the admin button). */
export function sendPlannerProfileReminder(row: PlannerProfileRow): void {
  const missing = plannerProfileMissing(row);
  void sendKind(
    "planner_profile_incomplete",
    {
      fullName: row.full_name,
      businessName: row.business_name,
      editUrl: `${CONFIG.frontendBaseUrl}/app/planner/settings/account`,
      missing,
    },
    { user: { id: row.id, email: row.email, full_name: row.full_name } },
  );
}
