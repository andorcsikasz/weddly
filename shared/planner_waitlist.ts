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

/** Pure draft builder – pre-fills the decision modal with an HU subject + body
 *  per outcome. Plain text, no HTML. Called from the admin frontend (to live
 *  update the modal as the outcome changes) and mirrored server-side as the
 *  authoritative default. Kept parallel to `buildEmailDraft` in
 *  `shared/vendor_waitlist.ts`. */
export function buildPlannerEmailDraft(
  outcome: PlannerWaitlistOutcome,
  entry: { full_name: string; company_name?: string | null },
): { subject: string; body: string } {
  const name = entry.full_name || "";
  if (outcome === "accepted") {
    return {
      subject: "Wēddly: jóváhagytuk a szervezői hozzáférésed",
      body:
        `Szia ${name}!\n\n` +
        `Köszönjük, hogy jelentkeztél a Wēddly szervezői eszközeire. Átnéztük a profilodat, ` +
        `és örömmel jelezzük: aktiváltuk a szervezői hozzáférésed.\n\n` +
        `A következő lépés egyszerű: lépj be, és a szervezői vezérlőpultból indítsd el az ` +
        `onboardingot – onnan hozzáadhatod az első ügyfeleidet és összekötheted a ` +
        `munkatereiteket.\n\n` +
        `A Wēddly még béta szakaszban van, ezért minden őszinte visszajelzésed sokat segít. ` +
        `Ha bármi kérdésed van, válaszolj nyugodtan erre a levélre – személyesen olvassuk.\n\n` +
        `Üdv,\nA Wēddly csapata`,
    };
  }
  if (outcome === "under_review") {
    return {
      subject: "Wēddly: átnézzük a jelentkezésed",
      body:
        `Szia ${name}!\n\n` +
        `Köszönjük, hogy jelentkeztél a Wēddly szervezői eszközeire. A csapatunk a következő ` +
        `napokban átnézi a profilodat, és e-mailben jelzünk vissza a döntéssel.\n\n` +
        `Ha addig van bármi, amit szeretnél megosztani magadról – portfólió, referenciák, ` +
        `korábbi esküvők –, nyugodtan válaszolj erre a levélre.\n\n` +
        `Üdv,\nA Wēddly csapata`,
    };
  }
  // rejected
  return {
    subject: "Wēddly: köszönjük a jelentkezést",
    body:
      `Szia ${name}!\n\n` +
      `Köszönjük, hogy jelentkeztél a Wēddly szervezői eszközeire. Most még nem tudunk ` +
      `továbblépni veled – jelenleg szűken alakítjuk a szervezői kört.\n\n` +
      `Ez nem örökre szól: amint bővítünk, jelzünk. Ha addig változik valami nálad, ` +
      `küldd el bátran – szívesen átnézzük újra.\n\n` +
      `Üdv,\nA Wēddly csapata`,
  };
}
