// Vendor waitlist contract — public submission shape + admin list shape.
// The admin triage flow has three outcomes (accepted / under_review / rejected)
// that each fire a template email to the supplier; the entry is kept forever
// for CRM-style review (notes + last-sent subject/body live on the row).

import type { SupplierCategory } from "./suppliers";

/** Canonical outcome union. Legacy "contacted"/"dismissed" values still exist
 *  in old rows and are mapped on read: contacted → accepted, dismissed →
 *  rejected. New writes only ever use this canonical set. */
export type VendorWaitlistStatus = "new" | "under_review" | "accepted" | "rejected";

/** The three outcome buttons in the triage modal. "new" is the inbox state —
 *  not a valid decision outcome. */
export type VendorWaitlistOutcome = "under_review" | "accepted" | "rejected";

export interface SubmitVendorWaitlistInput {
  business_name: string;
  email: string;
  category: SupplierCategory;
  location: string | null;
  website: string | null;
  message: string | null;
  /** Up to 6 portfolio URLs (galleries, reels, Instagram posts, Drive
   *  folders, …). Each entry must be a parseable http(s) URL. Empty array
   *  is fine — the field is optional. */
  portfolio_links: string[];
  /** Bare Instagram handle (no leading '@'). Optional. */
  instagram_handle: string | null;
}

/** Public-form return shape — the same shape the admin list returns, minus
 *  CRM detail (notes / sent subject + body). Kept for the public POST so old
 *  callers don't notice the admin extension. */
export interface VendorWaitlistEntry {
  id: number;
  business_name: string;
  email: string;
  category: string;
  location: string | null;
  website: string | null;
  message: string | null;
  portfolio_links: string[];
  instagram_handle: string | null;
  status: VendorWaitlistStatus;
  reviewed_at: number | null;
  created_at: number;
}

/** Admin triage view. Adds `outcome_at` (timestamp the entry left the inbox)
 *  plus free-form `notes` and the last-sent template `sent_subject` /
 *  `sent_body` for CRM-style follow-ups. */
export interface VendorWaitlistAdminView {
  id: number;
  business_name: string;
  email: string;
  category: string;
  location: string | null;
  website: string | null;
  message: string | null;
  portfolio_links: string[];
  instagram_handle: string | null;
  status: VendorWaitlistStatus;
  reviewed_at: number | null;
  outcome_at: number | null;
  notes: string | null;
  sent_subject: string | null;
  sent_body: string | null;
  created_at: number;
}

/** Body of POST /api/admin/vendor-waitlist/:id/decide — atomic transition
 *  out of the inbox with the email payload + admin notes. */
export interface DecideVendorWaitlistInput {
  outcome: VendorWaitlistOutcome;
  subject: string;
  body: string;
  notes: string;
}

/** Pure draft builder — pre-fills the template modal with an HU subject + body
 *  parameterised by business / category. Plain text, no HTML. Called from both
 *  the admin frontend (to live-update the modal as the outcome radio changes)
 *  and the backend (as the authoritative source). */
export function buildEmailDraft(
  outcome: VendorWaitlistOutcome,
  entry: { business_name: string; category_label: string },
): { subject: string; body: string } {
  const name = entry.business_name || "";
  const category = entry.category_label || "";
  if (outcome === "accepted") {
    return {
      subject: `Wēddly: szívesen szerepelnétek nálunk — mi a következő lépés`,
      body:
        `Szia ${name}!\n\n` +
        `Köszönjük, hogy jelentkeztetek a Wēddly szolgáltatói várólistájára (${category}). ` +
        `Megnéztük a profilotokat — szívesen bemutatnánk titeket a Weddly-n tervező pároknak.\n\n` +
        `A következő lépés: küldjetek vissza pár adatot (rövid bemutatkozás, 4-6 portfólió kép, ` +
        `kapcsolat, irányár), és mi felvesszük a katalógusunkba. Hamarosan jövünk a részletes ` +
        `onboarding e-maillel.\n\n` +
        `Ha bármi kérdésetek van, válaszoljatok erre az e-mailre — emberek olvassák.\n\n` +
        `Üdv,\nA Wēddly csapata`,
    };
  }
  if (outcome === "under_review") {
    return {
      subject: `Wēddly: alaposabban átnézzük a jelentkezéseteket`,
      body:
        `Szia ${name}!\n\n` +
        `Köszönjük, hogy jelentkeztetek a Wēddly szolgáltatói várólistájára (${category}). ` +
        `Egy-két napon belül alaposabban átnézzük a profilotokat, és e-mailben jelzünk vissza ` +
        `a végleges döntéssel.\n\n` +
        `Ha addig van bármi, amit szeretnétek megosztani magatokról (portfólió, referenciák), ` +
        `nyugodtan válaszoljatok erre a levélre.\n\n` +
        `Üdv,\nA Wēddly csapata`,
    };
  }
  // rejected
  return {
    subject: `Wēddly: köszönjük a jelentkezést — most még nem tudunk továbblépni`,
    body:
      `Szia ${name}!\n\n` +
      `Köszönjük, hogy jelentkeztetek a Wēddly szolgáltatói várólistájára (${category}). ` +
      `Most még nem tudunk továbblépni veletek — egy szűk, kategóriánkénti listát építünk, ` +
      `és ebben a körben máshogy alakult a válogatás.\n\n` +
      `Ez nem végleges nem: amint újra nyitunk a kategóriátokban, jelzünk. Ha addig változik ` +
      `valami nálatok (új portfólió, új fókusz), küldjétek el bátran.\n\n` +
      `Üdv,\nA Wēddly csapata`,
  };
}
