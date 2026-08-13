// Per-route SEO metadata for the public, indexable surfaces.
//
// The landing page (/) is handled by the default META in seo_ssr.ts and the
// rich SSR body in prerender.ts. Every OTHER public route used to inherit
// that same title / description / h1 in the initial HTML, which Googlebot
// reads as "all these URLs are the same page" and ranks them as thin
// duplicates. This map gives each public path its own title, description
// and a tiny route-specific body fragment so the HTML-only crawl pass sees
// distinct content per URL.
//
// Keep the copy reasonably short, the title + description are search-result
// snippets, and the h1/intro are visible only for the brief pre-hydration
// flash. Tailwind-styled React replaces the body once the bundle hydrates,
// so this is purely an SEO surface.

import { MARKETING_PAGES } from "./marketing_pages";

export type SeoLocale = "hu" | "en";

export interface RouteSeoEntry {
  title: string;
  description: string;
  /** First-level heading shown in the SSR body. Mirrors the React page's
   *  hero / page-title so a "rendered vs raw HTML" diff doesn't flag the
   *  page as cloaking. */
  h1: string;
  /** One-paragraph intro placed under the h1. Should restate the page's
   *  topic in user-friendly prose, Google reads this as the page summary. */
  intro: string;
}

export interface RouteSeo {
  hu: RouteSeoEntry;
  en: RouteSeoEntry;
}

/** Path → per-locale SEO. Keys are canonical URL paths exactly as they
 *  appear in App.tsx routes. `/impresszum` and `/imprint` both map to the
 *  same page; we list them both so either URL gets its own indexed meta. */
export const ROUTE_SEO: Record<string, RouteSeo> = {
  "/about": {
    hu: {
      title: "Rólunk · Wēddly",
      description:
        "Egy magyar pár, egy nyugodt esküvőtervező webalkalmazás. A Wēddly története, indítóoka és miért építjük közösen.",
      h1: "Rólunk",
      intro:
        "Egy magyar pár vagyunk, akik saját kezűleg építik a Wēddly-t. Hisszük, hogy az esküvőtervezés legyen nyugodt, közös és kézbe vehető, ezért egy közös felületen tartjuk a költségvetést, vendéglistát, RSVP-t és ültetést, és nem osztogatunk PDF-eket éjfélkor.",
    },
    en: {
      title: "About · Wēddly",
      description:
        "A small Hungarian couple building a calm wedding-planning workspace. Weddly's story, why we make it, and how we work.",
      h1: "About Wēddly",
      intro:
        "We're a Hungarian couple building Weddly by hand. We believe wedding planning should be calm, shared and manageable, so we keep the budget, guest list, RSVP and seating in one shared workspace, instead of trading PDFs at midnight.",
    },
  },
  "/suppliers/browse": {
    hu: {
      title: "Esküvői szolgáltatók · Wēddly",
      description:
        "Böngéssz több mint ezer esküvői helyszínt, fotóst, zenészt és cateringet városra és kategóriára szűrve. Fotók, árfekvés, vélemények, regisztráció nélkül.",
      h1: "Esküvői szolgáltatók",
      intro:
        "Helyszínek, fotósok, videósok, zenekarok, DJ-k, catering, dekor és minden más, amire egy esküvőhöz szükség van. Szűrj városra és kategóriára, nézd meg a képeket és a véleményeket, aztán vedd fel a kapcsolatot azzal, aki tetszik. A böngészéshez nem kell fiók.",
    },
    en: {
      title: "Wedding suppliers · Wēddly",
      description:
        "Browse over a thousand wedding venues, photographers, bands and caterers, filtered by city and category. Photos, price bands and reviews, no sign-up needed.",
      h1: "Wedding suppliers",
      intro:
        "Venues, photographers, videographers, bands, DJs, catering, flowers and everything else a wedding needs. Filter by city and category, look at the photographs and the reviews, then get in touch with whoever fits. Browsing needs no account.",
    },
  },
  "/suppliers": {
    hu: {
      title: "Szolgáltatóknak · Wēddly",
      description:
        "Olyan párok elé kerülsz, akiknek már megvan a dátum és a keret. Így kerülhetsz fel a Wēddly válogatott esküvői szolgáltatói listájára.",
      h1: "Olyan párok elé kerülsz, akiknek már megvan a dátum és a keret.",
      intro:
        "A Wēddlyn a párok a vendéglistát, a büdzsét és az ütemtervet vezetik. Amikor a te kategóriádra kerül a sor, helyszínre, fotóra, cateringre, zenére vagy dekorra, ebből a válogatott listából választanak. Ehhez a listához adunk hozzáférést.",
    },
    en: {
      title: "For suppliers · Wēddly",
      description:
        "Get in front of couples who already have a date and a budget. How to get onto Weddly's curated directory of wedding suppliers.",
      h1: "Get in front of couples who already have a date and a budget.",
      intro:
        "Couples run their guest list, their budget and their timeline on Weddly. When they get to your category, venue, photo, catering, music or decor, they pick from this curated list. That list is what we give you access to.",
    },
  },
  "/privacy": {
    hu: {
      title: "Adatvédelmi szabályzat · Wēddly",
      description:
        "Hogyan kezeli a Wēddly az adataitokat: gyűjtött kategóriák, megőrzés, GDPR jogok, sütik és külső szolgáltatók.",
      h1: "Adatvédelmi szabályzat",
      intro:
        "Ez az oldal bemutatja, milyen adatokat gyűjt a Wēddly, miért gyűjtjük, meddig őrizzük meg, és mit kérhettek velük kapcsolatban. Egy kis, nyílt bétás termék vagyunk, ezért igyekszünk a szabályzatot rövidnek és pontosnak tartani.",
    },
    en: {
      title: "Privacy policy · Wēddly",
      description:
        "How Weddly handles your data: what we collect, retention windows, GDPR rights, cookies and third-party processors.",
      h1: "Privacy policy",
      intro:
        "This page explains what data Weddly collects, why we collect it, how long we keep it and what you can ask us to do with it. We're a small open-beta product, we try to keep this short and honest.",
    },
  },
  "/terms": {
    hu: {
      title: "Felhasználási feltételek · Wēddly",
      description:
        "A Wēddly használatának feltételei: a szolgáltatás működése, jogok és kötelezettségek, korlátozások, a nyílt béta státusza és a kapcsolat.",
      h1: "Felhasználási feltételek",
      intro:
        "Ez a dokumentum a Wēddly használatának feltételeit írja le: mit jelent használni a szolgáltatást, mit vállalunk mi és mit vártok el ti, hogyan változtathatunk rajtuk és mit jelent a nyílt béta státusz.",
    },
    en: {
      title: "Terms of use · Wēddly",
      description:
        "How Weddly's service works: what we promise, what we expect, limits, the open-beta status and how to get in touch.",
      h1: "Terms of use",
      intro:
        "This page describes Weddly's terms of use: what using the service means, what we commit to and what we expect from you, how we can change the terms, and what the open-beta status implies.",
    },
  },
  "/terms/vendor-subscription": {
    hu: {
      title: "Szolgáltatói előfizetési feltételek (ÁSZF) · Wēddly",
      description:
        "A Wēddly szolgáltatói ÁSZF-je: szerződéskötés, díjak, számlázás, megújulás, rangsorolás, panaszkezelés és megszűnés.",
      h1: "Szolgáltatói előfizetési feltételek (ÁSZF)",
      intro:
        "Ez a verziózott dokumentum szabályozza a Wēddly szolgáltatói fiókját és az esetleges jövőbeli fizetős csomagokat. A regisztráció a jelenlegi ÁSZF kifejezett elfogadását igényli; a fizetés külön megerősítés nélkül nem indul el.",
    },
    en: {
      title: "Vendor subscription terms (ÁSZF) · Wēddly",
      description:
        "Weddly's vendor terms: contract formation, fees, billing, renewal, ranking, complaints and termination.",
      h1: "Vendor subscription terms (ÁSZF)",
      intro:
        "This versioned document governs Weddly vendor accounts and any future paid plan. Registration requires express acceptance of the current terms; payment cannot begin without a separate confirmation.",
    },
  },
  "/imprint": {
    hu: {
      title: "Impresszum · Wēddly",
      description:
        "A Wēddly üzemeltetőjének adatai: név, elérhetőség, technikai szolgáltatók, a hatályos magyar és uniós jogszabályok szerint.",
      h1: "Impresszum",
      intro:
        "A Wēddly üzemeltetőjének kötelező impresszum-adatai: operátor neve, elérhetőségei, technikai szolgáltatók és a vonatkozó magyar és uniós jogszabályok alapján kötelező közlések.",
    },
    en: {
      title: "Imprint · Wēddly",
      description:
        "Weddly's operator information: name, contact details, technical providers, as required by Hungarian and EU disclosure rules.",
      h1: "Imprint",
      intro:
        "Mandatory disclosures about Weddly's operator: name, contact details, technical providers and the related obligations under Hungarian and EU rules.",
    },
  },
  "/login": {
    hu: {
      title: "Bejelentkezés · Wēddly",
      description:
        "Lépjetek be a páros workspace-etekre. Folytatjátok ott, ahol abbahagytátok, költségvetés, vendéglista, RSVP, ültetés.",
      h1: "Bejelentkezés",
      intro:
        "Lépjetek be a Wēddly páros workspace-etekre. Folytatjátok ott, ahol abbahagytátok, közös költségvetés, vendéglista, RSVP linkek és ültetési vászon kettőtöknek.",
    },
    en: {
      title: "Sign in · Wēddly",
      description:
        "Sign in to your shared Weddly workspace. Pick up where you left off, budget, guest list, RSVP, seating.",
      h1: "Sign in",
      intro:
        "Sign in to your shared Weddly workspace. Pick up where you left off, shared budget, guest list, RSVP links and seating canvas for both of you.",
    },
  },
  "/eszkozok/eskuvo-koltsegvetes-kalkulator": {
    hu: {
      title: "Esküvő költségvetés kalkulátor · Wēddly",
      description:
        "Mennyibe kerül egy esküvő Magyarországon 2026-ban? Húzd a vendégszámot és a keretet, kategóriánként élőben számolódik. Ingyenes, regisztráció nélkül.",
      h1: "Esküvő költségvetés kalkulátor",
      intro:
        "Magyar esküvős átlagokra szabott élő kalkulátor: húzd a vendégszámot és a keretet, kategóriánként újraszámolódik. A számokat egy kattintással átvihetitek a saját workspace-etekbe.",
    },
    en: {
      title: "Wedding budget calculator · Wēddly",
      description:
        "How much does a wedding cost in Hungary in 2026? Drag the guest count and budget, every category recalculates live. Free, no signup needed.",
      h1: "Wedding budget calculator",
      intro:
        "Live calculator tuned to Hungarian wedding averages: drag the guest count and budget, every category recalculates. One click carries the numbers into your own workspace.",
    },
  },
  "/eszkozok/eskuvo-visszaszamlalo": {
    hu: {
      title: "Esküvő visszaszámláló, hány nap van hátra | Wēddly",
      description:
        "Hány nap, hét, hónap van az esküvőtökig? Add meg a dátumot, és mérföldkövekkel együtt látod mit érdemes intézni 12, 9, 6, 3, 1 hónappal és 1 héttel előtte.",
      h1: "Esküvő visszaszámláló",
      intro:
        "Add meg az esküvőtök dátumát, Élőben látod a maradék napok, hetek, hónapok számát, és egy mérföldkő-listát hogy mit érdemes intézni mikor.",
    },
    en: {
      title: "Wedding countdown, days remaining | Wēddly",
      description:
        "How many days, weeks, months until your wedding? Pick a date and get a milestone timeline: what to plan 12, 9, 6, 3, 1 month and 1 week out.",
      h1: "Wedding countdown",
      intro:
        "Pick your wedding date, see months, weeks and days remaining live, with a milestone list of what to plan when.",
    },
  },
  "/eszkozok/vendeglista-sablon": {
    hu: {
      title: "Vendéglista sablon: esküvői CSV (ingyen) | Wēddly",
      description:
        "Letölthető CSV vendéglista-sablon: vezetéknév, e-mail, telefon, háztartás, étrend, kísérő, RSVP. Importálható közvetlenül a Wēddly-be.",
      h1: "Vendéglista sablon esküvőre",
      intro:
        "Töltsd le a CSV-sablont, töltsd ki Excel-ben vagy Sheets-ben, vagy importáld közvetlenül a Wēddly-be. 8 példasorral.",
    },
    en: {
      title: "Wedding guest list template, CSV (free) | Wēddly",
      description:
        "Downloadable wedding guest-list CSV template: last name, email, phone, household, diet, plus-one, RSVP. Imports straight into Weddly.",
      h1: "Wedding guest list template",
      intro:
        "Download the CSV template, fill it in Excel or Sheets, or import directly into Weddly. Eight sample rows so you see the format.",
    },
  },
  "/eszkozok/ultetesi-rend-keszito": {
    hu: {
      title: "Ültetési rend készítő, ingyenes esküvői | Wēddly",
      description:
        "Vászon, asztalok, vendégek; húzd a helyükre, és A4 / A6 / A3 PDF-be exportálódik, pontos mm méretben. Ingyenes a nyílt béta alatt.",
      h1: "Ültetési rend készítő, ingyen",
      intro:
        "Interaktív ültetési vászon: asztalok, vendégek drag-and-drop, automatikus konfliktus-jelzés, és nyomtatható PDF A4 / A6 (ültetőkártya) / A3 (bejárati tábla) méretben.",
    },
    en: {
      title: "Wedding seating chart maker, free | Wēddly",
      description:
        "Canvas, tables, guests, drag onto seats and export to PDF at A4 / A6 / A3 at exact mm. Tailored for Hungarian weddings, free during the open beta.",
      h1: "Wedding seating chart maker",
      intro:
        "Interactive seating canvas: tables, drag-and-drop guests, conflict flags, and printable PDF export at A4 / A6 (place cards) / A3 (entrance display).",
    },
  },
  "/eszkozok/rsvp-szoveg-generator": {
    hu: {
      title: "RSVP szöveg generátor, esküvői minta | Wēddly",
      description:
        "RSVP minta szöveg esküvői meghívóhoz: töltsd ki a párotok nevét, dátumot, helyszínt, és kapsz kész szöveget klasszikus, hétköznapi és költői stílusban.",
      h1: "RSVP minta szöveg, esküvői meghívóhoz",
      intro:
        "Töltsd ki a nevet, dátumot, helyszínt és RSVP-határidőt, három stílusban (klasszikus, hétköznapi, költői) generálunk kész RSVP-szöveget. Másolható egy kattintással.",
    },
    en: {
      title: "Wedding RSVP wording generator | Wēddly",
      description:
        "RSVP wording for wedding invitations: enter your names, date, venue and deadline, get ready-to-use wording in formal, casual or poetic styles.",
      h1: "Wedding RSVP wording, generator",
      intro:
        "Enter names, date, venue and deadline, we generate ready-to-use RSVP wording in three styles (formal, casual, poetic). Copy with one click.",
    },
  },
  "/eszkozok/100-kerdes-eskuvo-elott": {
    hu: {
      title: "100 kérdés az esküvő előtt · beszélgető kártyák pároknak | Wēddly",
      description:
        "100 kérdés az esküvő előtt, négy szint, a felszíntől a mély vizekig. Ismerjétek meg egymást igazán a nagy nap előtt. Ingyenes, regisztráció nélkül.",
      h1: "100 kérdés az esküvő előtt",
      intro:
        "Négy pakli, paklinként 25 beszélgetésindító kérdés jegyes pároknak. Válasszatok paklit, húzzatok egy kártyát, és menjetek bele a beszélgetésbe. Ingyenes, regisztráció nélkül.",
    },
    en: {
      title: "100 Questions Before You Say Yes · couple conversation cards | Wēddly",
      description:
        "Four decks of 25 deep questions for engaged couples: roots, the everyday, closeness, deep water. Draw a card and start the conversation.",
      h1: "100 Questions Before You Say Yes",
      intro:
        "Four decks of 25 conversation-starter cards for engaged couples. Pick a deck, draw a card, and let the conversation begin. Free, no signup needed.",
    },
  },
  "/blog": {
    hu: {
      title: "Blog · Wēddly",
      description:
        "Költségvetés, vendéglista, ültetési rend, RSVP. Gyakorlati cikkek pároknak, akik magyar esküvőt terveznek.",
      h1: "Blog",
      intro:
        "Rövid, gyakorlati írások az esküvőtervezés legtöbb idő- és pénzigényes részeiről: költségvetés-felosztás, ültetési rend, RSVP utánajárás. Minden poszt egy konkrét döntésen segít át.",
    },
    en: {
      title: "Blog · Wēddly",
      description:
        "Budget, guest list, seating, RSVP. Practical articles for couples planning a wedding.",
      h1: "Blog",
      intro:
        "Short, practical reads on the parts of wedding planning that take the most time and money: budget allocation, seating, RSVP follow-up. Each post helps with one concrete decision.",
    },
  },
  "/signup": {
    hu: {
      title: "Regisztráció: Wēddly",
      description:
        "Indítsátok el a közös esküvőtervező workspace-eteket. Pár perc beállítás, a nyílt béta alatt ingyenes.",
      h1: "Indítsátok el a páros workspace-eteket",
      intro:
        "Pár perc, és kettőtöknek lesz egy közös felülete az esküvőtervezéshez: élő költségvetés, vendéglista, RSVP linkek, ültetési vászon és nyomtatható kártyák. A nyílt béta alatt ingyenes.",
    },
    en: {
      title: "Create your couple workspace · Wēddly",
      description:
        "Open one shared workspace for both of you and start planning in minutes. Free throughout the open beta.",
      h1: "Open your couple workspace",
      intro:
        "Set up one shared workspace for both of you in a few minutes, live budget, guest list, RSVP links, seating canvas and printable cards. Free throughout the open beta.",
    },
  },
};

// The Hungarian feature and guide pages intentionally have no partial English
// alternative. They remain Hungarian in both slots so locale selection cannot
// produce metadata that disagrees with their visible body, and no EN hreflang
// is emitted for them.
for (const page of Object.values(MARKETING_PAGES)) {
  const entry: RouteSeoEntry = {
    title: page.title,
    description: page.description,
    h1: page.h1,
    intro: page.intro,
  };
  ROUTE_SEO[page.path] = { hu: entry, en: entry };
}

/** HU/EN slug pairs for the public tool pages. Both halves of each pair
 *  mount the same React component in `App.tsx`, share the same bilingual
 *  ROUTE_SEO entry (keyed by the HU path), and reference each other via
 *  `hreflang` link rels so Google can index the EN slug under the EN
 *  canonical host (`weddly.com`) while keeping the HU SEO weight on the
 *  HU canonical (`weddly.hu`). When the multi-host setup is OFF, EN slugs
 *  still resolve client-side but the SSR doesn't pair them, single-host
 *  fallback behaviour. */
export const SLUG_PAIRS: ReadonlyArray<{ hu: string; en: string }> = [
  {
    hu: "/eszkozok/eskuvo-koltsegvetes-kalkulator",
    en: "/tools/wedding-budget-calculator",
  },
  {
    hu: "/eszkozok/eskuvo-visszaszamlalo",
    en: "/tools/wedding-countdown",
  },
  {
    hu: "/eszkozok/vendeglista-sablon",
    en: "/tools/guest-list-template",
  },
  {
    hu: "/eszkozok/ultetesi-rend-keszito",
    en: "/tools/seating-chart-builder",
  },
  {
    hu: "/eszkozok/rsvp-szoveg-generator",
    en: "/tools/rsvp-text-generator",
  },
  {
    hu: "/eszkozok/100-kerdes-eskuvo-elott",
    en: "/tools/100-questions-before-marriage",
  },
];

const HU_TO_EN_SLUG = new Map(SLUG_PAIRS.map((p) => [p.hu, p.en]));
const EN_TO_HU_SLUG = new Map(SLUG_PAIRS.map((p) => [p.en, p.hu]));

/** Resolve a path to its HU canonical version. EN slug → its HU pair; any
 *  other path (no pair, or already HU) is returned unchanged. Used by
 *  `seo_ssr.ts` to build the `hreflang="hu"` href regardless of which
 *  slug the visitor landed on. */
export function huPathFor(path: string): string {
  return EN_TO_HU_SLUG.get(path) ?? path;
}

/** Resolve a path to its EN canonical version. HU slug → its EN pair; any
 *  other path is returned unchanged. Used by `seo_ssr.ts` to build the
 *  `hreflang="en"` href when the multi-host setup is active. */
export function enPathFor(path: string): string {
  return HU_TO_EN_SLUG.get(path) ?? path;
}

/** Hungarian-alias `/impresszum` resolves to the same SEO entry as `/imprint`.
 *  EN tool slugs resolve to their HU pair's bilingual entry, the visitor's
 *  locale picks which copy renders. Done at lookup time rather than
 *  duplicating the entry so the copy stays in one place.
 *
 *  `/blog/:slug` is NOT handled here. The backend's `seo_ssr.ts` reads the
 *  per-post meta from the `blog_posts` table at request time and short-
 *  circuits the static lookup so admin edits land in the SSR'd <head>
 *  without a rebuild. */
export function lookupRouteSeo(pathname: string): RouteSeo | null {
  // Normalise trailing slash before the lookup. Visitors sometimes land on
  // `/blog/` (linked or typed) and Googlebot crawls both shapes, so the
  // SSR head builder has to recognise either form. Root `/` is preserved.
  let normalised = pathname;
  if (normalised.length > 1 && normalised.endsWith("/")) {
    normalised = normalised.slice(0, -1);
  }
  const aliased = normalised === "/impresszum" ? "/imprint" : normalised;
  const resolved = EN_TO_HU_SLUG.get(aliased) ?? aliased;
  return ROUTE_SEO[resolved] ?? null;
}
