// Planner public-profile completeness — the "your profile is missing info"
// reminder shared by the automatic post-signup sweep (domain/emails/worker.ts)
// and the admin "Send reminder" button (routes/admin_planners.ts). One place
// owns the definition of "what's missing" so the sweep, the button and the
// email body can never disagree.

import { CONFIG } from "../config";
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
  row: Pick<
    PlannerProfileRow,
    "business_name" | "planner_city" | "planner_bio" | "planner_styles"
  >,
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
  row: Pick<
    PlannerProfileRow,
    "business_name" | "planner_city" | "planner_bio" | "planner_styles"
  >,
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
