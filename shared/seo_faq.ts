// Shared FAQ entry shape + locale union for structured-data-backed FAQ
// copy that has to render identically on the visible page and in the
// FAQPage JSON-LD (divergence is treated as cloaking).
//
// The landing page's own FAQ section (and the SEO_FAQ data that used to
// live here) was removed; the surviving consumers are:
//   - shared/tool_faq.ts (SeoFaqEntry) → the per-tool FAQ blocks on
//     /tools/* pages, still rendered + emitted as JSON-LD.
//   - frontend/scripts/prerender.ts (SeoFaqLocale) → the two static HU/EN
//     body variants the SEO prerender writes.

export type SeoFaqLocale = "hu" | "en";

export interface SeoFaqEntry {
  q: string;
  a: string;
  // Optional in-app link rendered under the visible answer card. NOT part of
  // the FAQPage JSON-LD (seo_ssr emits q/a only), so the structured data and
  // the visible prose stay identical for Googlebot.
  cta?: { href: string; label: string };
}
