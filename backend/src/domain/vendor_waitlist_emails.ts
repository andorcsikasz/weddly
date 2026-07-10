// Vendor-waitlist triage emails — HU subject + body templates for each of the
// three outcome buttons (accepted / under_review / rejected). The admin sees
// the rendered draft in the triage modal and can edit it before sending; the
// final text (whatever the admin actually sent) is stored on the row.
//
// The pure draft builder itself lives in `shared/vendor_waitlist.ts` so the
// frontend can call it to live-update the modal when the outcome radio
// changes. This file holds the backend wrapper that resolves the category
// label and the raw text-send helper.

import {
  buildEmailDraft as buildEmailDraftPure,
  type VendorWaitlistOutcome,
} from "@shared/vendor_waitlist";
import type { SupplierCategory } from "@shared/suppliers";
import { sendKind } from "./emails/send";

export { buildEmailDraftPure as buildEmailDraft };

/** HU labels for the 14 supplier categories. Kept here (not in the shared
 *  module) so the frontend's category-pill labels can drive their own copy
 *  without us coupling backend domain text to the UI's label system. */
const CATEGORY_LABEL_HU: Record<SupplierCategory, string> = {
  wedding_planner: "Esküvőszervező",
  venue: "Esküvői helyszín",
  accommodation: "Szállás",
  catering: "Catering",
  cake_dessert: "Torta & desszert",
  bar_drinks: "Bár & italok",
  pizza: "Pizza",
  decor_floral: "Dekoráció & virág",
  lighting: "Világítás",
  music_dj: "Zene & DJ",
  sound_tech: "Hangtechnika",
  photo_video: "Fotó & videó",
  entertainment: "Animáció & program",
  attire: "Ruha",
  hair_makeup: "Smink & haj",
  nails: "Köröm",
  stationery: "Papír & nyomtatvány",
  transport: "Transzfer",
  rings: "Karikagyűrűk",
  tent_pavilion: "Sátor & pavilon",
  wedding_website: "Esküvői honlap",
  other: "Egyéb",
};

/** Convenience: resolve a row's free-text `category` slug to a localized HU
 *  label, falling back to the raw slug if the slug isn't one of the canonical
 *  14 (defensive — admin-defined categories from the taxonomy editor can also
 *  show up here). */
export function resolveCategoryLabel(category: string): string {
  return CATEGORY_LABEL_HU[category as SupplierCategory] ?? category;
}

/** Build the default draft for a given outcome + waitlist entry. Resolves the
 *  HU category label internally — callers only pass the row's `category`
 *  slug. */
export function buildDraftForEntry(
  outcome: VendorWaitlistOutcome,
  entry: { business_name: string; category: string },
): { subject: string; body: string } {
  return buildEmailDraftPure(outcome, {
    business_name: entry.business_name,
    category_label: resolveCategoryLabel(entry.category),
  });
}

/** Triage decision mail. The admin already edited the subject + body in the
 *  modal; we slot those strings into the standard branded shell via
 *  `sendKind("vendor_waitlist_decision", ...)`. Previously this path emitted a
 *  raw plain-text reply with no brand chrome — that read as a low-effort,
 *  context-less response and corroded trust. The vendor still sees their
 *  admin-edited copy verbatim; the shell adds the brand header + footer so
 *  it's clearly a Weddly response. */
export async function sendDecisionEmail(input: {
  to: string;
  subject: string;
  body: string;
  outcome: VendorWaitlistOutcome;
  full_name?: string;
}): Promise<void> {
  await sendKind(
    "vendor_waitlist_decision",
    { subject: input.subject, body: input.body, outcome: input.outcome },
    { user: null, guest: { email: input.to, full_name: input.full_name ?? "" } },
  );
}

/** Activation mail for an accepted vendor (or an admin resend). The single-use
 *  activation link IS the CTA button (never the homepage) and is repeated as a
 *  clickable copy-paste fallback. On the accept path the admin's edited subject
 *  + warm body ride along (`subject` / `introMessage`); the resend path omits
 *  both and the template falls back to a clear default welcome + instruction. */
export async function sendVendorActivationEmail(input: {
  to: string;
  businessName: string;
  activateUrl: string;
  introMessage?: string;
  subject?: string;
}): Promise<void> {
  await sendKind(
    "vendor_activation",
    {
      businessName: input.businessName,
      activateUrl: input.activateUrl,
      introMessage: input.introMessage,
      subject: input.subject,
    },
    { user: null, guest: { email: input.to, full_name: input.businessName } },
  );
}
