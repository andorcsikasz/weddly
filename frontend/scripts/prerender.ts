// Build-time SEO prerender for the landing page.
//
// Vite's output index.html ships an empty <div id="root"></div> — Googlebot
// indexes that as "no content" and ranks the page accordingly. This script
// runs *after* `vite build` and bakes the actual landing copy into two
// locale variants: `dist/index.html` (HU body) and `dist/index.en.html` (EN
// body). The Bun server picks the right variant per Host header.
//
// We render *semantic* HTML directly from the locale trees rather than
// stringifying React. The visible UI is unchanged because React's
// createRoot() wipes the placeholder before the user sees it; this content
// is only there for crawlers and the brief paint before JS hydrates. Keep
// the copy here strictly synchronized with the React landing — Google flags
// large divergence as cloaking.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import en from "../src/locales/en";
import hu from "../src/locales/hu";
import type { LocaleMessages } from "../src/locales/keys";
import { SEO_FAQ, type SeoFaqLocale } from "../../shared/seo_faq";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const INDEX_HTML = `${DIST}index.html`;
const INDEX_EN_HTML = `${DIST}index.en.html`;

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface LandingCopy {
  hero_title: string;
  hero_sub: string;
  cta_signup: string;
  cta_login: string;
  wsite_title: string;
  wsite_body: string;
  // Phases
  phases_title: string;
  phase_plan_title: string;
  phase_plan_body: string;
  phase_suppliers_title: string;
  phase_suppliers_body: string;
  phase_guests_title: string;
  phase_guests_body: string;
  phase_seating_title: string;
  phase_seating_body: string;
  phase_aftermath_title: string;
  phase_aftermath_body: string;
  // Product blocks
  product_title: string;
  block_budget_title: string;
  block_budget_body: string;
  block_guests_title: string;
  block_guests_body: string;
  block_seating_title: string;
  block_seating_body: string;
  // Why
  why_title: string;
  why_a_title: string;
  why_a_body: string;
  why_b_title: string;
  why_b_body: string;
  why_c_title: string;
  why_c_body: string;
  why_d_title: string;
  why_d_body: string;
  // Pricing
  pricing_title: string;
  pricing_body: string;
  // FAQ heading only — Q&A pairs come from shared/seo_faq.ts so the SSR'd
  // body matches the FAQPage JSON-LD verbatim.
  faq_title: string;
  // Footer / nav
  footer_couples: string;
  footer_couples_signup: string;
  footer_couples_signin: string;
  footer_vendors: string;
  footer_vendors_waitlist: string;
  footer_guests: string;
  footer_guests_enter: string;
  footer_legal_terms: string;
  footer_legal_privacy: string;
  footer_legal_about: string;
  footer_legal_imprint: string;
}

function buildBody(L: LocaleMessages, locale: SeoFaqLocale): string {
  const l = L.landing as unknown as LandingCopy;
  const rsvpHref = "/rsvp";
  const faq = SEO_FAQ[locale];
  // Semantic, link-rich, headings-rich HTML. Each section uses the same
  // headline copy that the React landing renders, so a crawler's text-content
  // diff between SSR + JS pass stays trivial.
  return [
    `<header>`,
    `  <h1>${escape(l.hero_title)}</h1>`,
    `  <p>${escape(l.hero_sub)}</p>`,
    `  <p>`,
    `    <a href="/signup" rel="nofollow">${escape(l.cta_signup)}</a> ·`,
    `    <a href="/login" rel="nofollow">${escape(l.cta_login)}</a>`,
    `  </p>`,
    `</header>`,
    `<section aria-labelledby="phases-heading">`,
    `  <h2 id="phases-heading">${escape(l.phases_title)}</h2>`,
    `  <article><h3>${escape(l.phase_plan_title)}</h3><p>${escape(l.phase_plan_body)}</p></article>`,
    `  <article><h3>${escape(l.phase_suppliers_title)}</h3><p>${escape(l.phase_suppliers_body)}</p></article>`,
    `  <article><h3>${escape(l.phase_guests_title)}</h3><p>${escape(l.phase_guests_body)}</p></article>`,
    `  <article><h3>${escape(l.phase_seating_title)}</h3><p>${escape(l.phase_seating_body)}</p></article>`,
    `  <article><h3>${escape(l.phase_aftermath_title)}</h3><p>${escape(l.phase_aftermath_body)}</p></article>`,
    `</section>`,
    `<section aria-labelledby="product-heading">`,
    `  <h2 id="product-heading">${escape(l.product_title)}</h2>`,
    `  <article><h3>${escape(l.block_budget_title)}</h3><p>${escape(l.block_budget_body)}</p></article>`,
    `  <article><h3>${escape(l.block_guests_title)}</h3><p>${escape(l.block_guests_body)}</p></article>`,
    `  <article><h3>${escape(l.block_seating_title)}</h3><p>${escape(l.block_seating_body)}</p></article>`,
    `  <article><h3>${escape(l.wsite_title)}</h3><p>${escape(l.wsite_body)}</p></article>`,
    `</section>`,
    `<section aria-labelledby="founders-heading">`,
    `  <h2 id="founders-heading">${escape(l.founders_title)}</h2>`,
    `  <p>${escape(l.founders_body)}</p>`,
    `  <p>${escape(l.founders_note)}</p>`,
    `</section>`,
    `<section aria-labelledby="pricing-heading">`,
    `  <h2 id="pricing-heading">${escape(l.pricing_title)}</h2>`,
    `  <p>${escape(l.pricing_body)}</p>`,
    `</section>`,
    `<section aria-labelledby="faq-heading">`,
    `  <h2 id="faq-heading">${escape(l.faq_title)}</h2>`,
    `  <dl>`,
    ...faq.map((entry) => `    <dt>${escape(entry.q)}</dt><dd>${escape(entry.a)}</dd>`),
    `  </dl>`,
    `</section>`,
    `<footer aria-label="${escape(locale === "hu" ? "Oldaltérkép" : "Sitemap")}">`,
    `  <nav><h3>${escape(l.footer_couples)}</h3><ul>`,
    `    <li><a href="/signup">${escape(l.footer_couples_signup)}</a></li>`,
    `    <li><a href="/login">${escape(l.footer_couples_signin)}</a></li>`,
    `  </ul></nav>`,
    `  <nav><h3>${escape(l.footer_vendors)}</h3><ul>`,
    `    <li><a href="/vendors">${escape(l.footer_vendors_waitlist)}</a></li>`,
    `  </ul></nav>`,
    `  <nav><h3>${escape(l.footer_guests)}</h3><ul>`,
    `    <li><a href="${rsvpHref}">${escape(l.footer_guests_enter)}</a></li>`,
    `  </ul></nav>`,
    `  <nav><ul>`,
    `    <li><a href="/about">${escape(l.footer_legal_about)}</a></li>`,
    `    <li><a href="/privacy">${escape(l.footer_legal_privacy)}</a></li>`,
    `    <li><a href="/terms">${escape(l.footer_legal_terms)}</a></li>`,
    `    <li><a href="${locale === "hu" ? "/impresszum" : "/imprint"}">${escape(l.footer_legal_imprint)}</a></li>`,
    `  </ul></nav>`,
    `</footer>`,
  ].join("\n      ");
}

function injectIntoRoot(template: string, body: string): string {
  // The vite-built index.html still has `<div id="root"></div>`. We replace
  // it with the same div containing the static body. React's createRoot()
  // wipes children on first render, so the user only sees the SSR body
  // during the ~100-300 ms between first paint and hydration.
  //
  // We do NOT hide this content off-screen / via aria-hidden / display:none.
  // Google's HTML-only crawl pass (which drives most SPA ranking) downweights
  // visually-hidden text — off-screen at -10000px specifically matches the
  // textbook keyword-stuffing pattern its spam filters watch for. The brief
  // pre-hydration flash is the better trade: visible content gives Google
  // full ranking weight AND wins LCP (Largest Contentful Paint fires at the
  // SSR body rather than waiting for the bundle to parse + render). The
  // `seo-prerender` class lets the stylesheet apply minimal typography so
  // the flash looks like a quiet text block, not a raw DOM dump.
  //
  // The SEO_BODY_START / SEO_BODY_END sentinels let the per-request renderer
  // in backend/src/lib/seo_ssr.ts swap this landing body for a route-specific
  // body when a known non-landing public path (e.g. /about, /vendors) is
  // requested. Without that swap every URL would ship the landing's <h1>
  // and Google would treat them as duplicates of the landing.
  const ROOT_EMPTY = `<div id="root"></div>`;
  if (!template.includes(ROOT_EMPTY)) {
    throw new Error('prerender: <div id="root"></div> placeholder not found in dist/index.html');
  }
  const wrapped = [
    `<div class="seo-prerender">`,
    `      <!-- SEO_BODY_START -->`,
    `      ${body}`,
    `      <!-- SEO_BODY_END -->`,
    `    </div>`,
  ].join("\n      ");
  return template.replace(ROOT_EMPTY, `<div id="root">\n      ${wrapped}\n    </div>`);
}

function main(): void {
  if (!existsSync(INDEX_HTML)) {
    throw new Error(`prerender: ${INDEX_HTML} missing — run \`vite build\` first.`);
  }
  const template = readFileSync(INDEX_HTML, "utf-8");

  const huHtml = injectIntoRoot(template, buildBody(hu, "hu"));
  const enHtml = injectIntoRoot(template, buildBody(en, "en"));

  // HU is the canonical default (overwrites Vite's empty root).
  writeFileSync(INDEX_HTML, huHtml);
  writeFileSync(INDEX_EN_HTML, enHtml);

  // eslint-disable-next-line no-console -- build script
  console.log(`prerender: wrote ${INDEX_HTML} (HU) + ${INDEX_EN_HTML} (EN)`);
}

main();
