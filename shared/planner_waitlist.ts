// Planner waitlist contract – public submission shape + admin list shape.
// The admin triage decision sends an editable HU email to the planner
// (parity with the vendor waitlist flow); the sent copy is stored on the row.

export type PlannerWaitlistStatus = "new" | "under_review" | "accepted" | "rejected";
export type PlannerWaitlistOutcome = "under_review" | "accepted" | "rejected";

export interface SubmitPlannerWaitlistInput {
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  city: string | null;
  message: string | null;
  privacy_version: string;
  selected_plan: "basic" | "pro" | "unlimited" | null;
  website: string | null;
  weddings_per_year: number | null;
  km_radius: number | null;
  wedding_style_1: string | null;
  wedding_style_2: string | null;
  wedding_style_3: string | null;
  other_style: string | null;
  reference_links: string | null;
  early_bird: boolean;
}

export interface PlannerWaitlistEntry {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  city: string | null;
  years_experience: number | null;
  message: string | null;
  status: PlannerWaitlistStatus;
  selected_plan: "basic" | "pro" | "unlimited" | null;
  website: string | null;
  weddings_per_year: number | null;
  usage: string | null;
  created_at: number;
}

export interface PlannerWaitlistAdminView {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  city: string | null;
  message: string | null;
  status: PlannerWaitlistStatus;
  reviewed_at: number | null;
  outcome_at: number | null;
  notes: string | null;
  selected_plan: "basic" | "pro" | "unlimited" | null;
  website: string | null;
  weddings_per_year: number | null;
  km_radius: number | null;
  wedding_style_1: string | null;
  wedding_style_2: string | null;
  wedding_style_3: string | null;
  other_style: string | null;
  reference_links: string | null;
  early_bird: boolean;
  /** Subject + body of the last decision email actually sent to the planner,
   *  so re-deciding a row shows what already went out. Null until first sent. */
  sent_subject: string | null;
  sent_body: string | null;
  created_at: number;
}

export interface DecidePlannerWaitlistInput {
  outcome: PlannerWaitlistOutcome;
  /** Admin-edited subject + body, sent to the planner in the branded shell. */
  subject: string;
  body: string;
  notes: string;
}

/** Pure draft builder: pre-fills the decision modal with an HU subject + body
 *  per outcome. Plain text, no HTML. Called from the admin frontend (to live
 *  update the modal as the outcome changes) and mirrored server-side as the
 *  authoritative default. Kept parallel to `buildEmailDraft` in
 *  `shared/vendor_waitlist.ts`, including its three copy rules: no greeting
 *  (the card greets by name), no sign-off, and no offer described here. */
export function buildPlannerEmailDraft(
  outcome: PlannerWaitlistOutcome,
  entry: { full_name: string; company_name?: string | null },
): { subject: string; body: string } {
  const name = entry.full_name || "";
  if (outcome === "accepted") {
    return {
      subject: "Jóváhagytuk a szervezői hozzáférésed",
      body:
        `Köszönjük, hogy jelentkeztél a Weddly szervezői eszközeire. Átnéztük a profilodat, ` +
        `és aktiváltuk a szervezői hozzáférésed.\n\n` +
        `Lépj be a szervezői vezérlőpultba, és állítsd be a profilodat. Ezután egy helyről ` +
        `követheted az összes ügyfeled vendéglistáját, költségvetését, ütemtervét és feladatait.\n\n` +
        `Ha bármi kérdésed van, válaszolj nyugodtan erre a levélre, ember olvassa.`,
    };
  }
  if (outcome === "under_review") {
    return {
      subject: "Átnézzük a jelentkezésed",
      body:
        `Köszönjük, hogy jelentkeztél a Weddly szervezői eszközeire. A következő napokban ` +
        `átnézzük a profilodat, és e-mailben jelzünk vissza a döntéssel. Addig nincs teendőd.\n\n` +
        `Ha van bármi, amit szeretnél megosztani magadról, portfólió, referenciák vagy korábbi ` +
        `esküvők, nyugodtan válaszolj erre a levélre.`,
    };
  }
  // rejected
  return {
    subject: "Köszönjük a jelentkezést",
    body:
      `Köszönjük, hogy jelentkeztél a Weddly szervezői eszközeire. Most még nem tudunk ` +
      `továbblépni veled: jelenleg szűken alakítjuk a szervezői kört.\n\n` +
      `Ez nem örökre szól, amint bővítünk, jelzünk. Ha addig változik valami nálad, ` +
      `küldd el bátran, szívesen átnézzük újra.`,
  };
}
