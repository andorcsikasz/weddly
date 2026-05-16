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
import { sendEmail } from "../lib/mailer";

export { buildEmailDraftPure as buildEmailDraft };

/** HU labels for the 14 supplier categories. Kept here (not in the shared
 *  module) so the frontend's category-pill labels can drive their own copy
 *  without us coupling backend domain text to the UI's label system. */
const CATEGORY_LABEL_HU: Record<SupplierCategory, string> = {
  venue: "Esküvői helyszín",
  accommodation: "Szállás",
  catering: "Catering",
  cake_dessert: "Torta & desszert",
  bar_drinks: "Bár & italok",
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

/** Plain-text mail send for the triage outcome — the admin already edited the
 *  template inline in the modal, so we trust the strings as-is. Uses the same
 *  underlying mailer.ts dev-print path as the rest of the app (matches what
 *  `mailer.dev_print` shows in tests). Plain-text only — no HTML — keeps the
 *  triage email indistinguishable from a normal human reply. */
export async function sendDecisionEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  await sendEmail({
    to: input.to,
    subject: input.subject,
    text: input.body,
    // Mirror the text into a minimal HTML wrapper so Resend's anti-spam
    // heuristics don't downgrade plain-text-only mail. Keeps the visual
    // identical (line breaks preserved).
    html: `<div style="font-family:system-ui,sans-serif;white-space:pre-wrap;color:#111;">${escapeHtml(input.body)}</div>`,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
