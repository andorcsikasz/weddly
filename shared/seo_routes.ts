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
// Keep the copy reasonably short — the title + description are search-result
// snippets, and the h1/intro are visible only for the brief pre-hydration
// flash. Tailwind-styled React replaces the body once the bundle hydrates,
// so this is purely an SEO surface.

export type SeoLocale = "hu" | "en";

export interface RouteSeoEntry {
  title: string;
  description: string;
  /** First-level heading shown in the SSR body. Mirrors the React page's
   *  hero / page-title so a "rendered vs raw HTML" diff doesn't flag the
   *  page as cloaking. */
  h1: string;
  /** One-paragraph intro placed under the h1. Should restate the page's
   *  topic in user-friendly prose — Google reads this as the page summary. */
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
      title: "Rólunk — Wēddly",
      description:
        "Egy magyar pár, egy nyugodt esküvőtervező webalkalmazás. A Wēddly története, indítóoka és miért építjük közösen.",
      h1: "Rólunk",
      intro:
        "Egy magyar pár vagyunk, akik saját kezűleg építik a Wēddly-t. Hisszük, hogy az esküvőtervezés legyen nyugodt, közös és kézbe vehető — ezért egy közös felületen tartjuk a költségvetést, vendéglistát, RSVP-t és ültetést, és nem osztogatunk PDF-eket éjfélkor.",
    },
    en: {
      title: "About — Weddly",
      description:
        "A small Hungarian couple building a calm wedding-planning workspace. Weddly's story, why we make it, and how we work.",
      h1: "About Weddly",
      intro:
        "We're a Hungarian couple building Weddly by hand. We believe wedding planning should be calm, shared and manageable — so we keep the budget, guest list, RSVP and seating in one shared workspace, instead of trading PDFs at midnight.",
    },
  },
  "/vendors": {
    hu: {
      title: "Szolgáltatóknak — Wēddly",
      description:
        "Iratkozzatok fel a Wēddly válogatott magyar esküvői szolgáltatói listájára: helyszínek, fotósok, cateringek, zenészek. Érjétek el a most tervező párokat.",
      h1: "Érjétek el a most tervező párokat.",
      intro:
        "A Wēddly válogatott címjegyzéke az első hely, ahol a párok keresnek esküvői szolgáltatókat — helyszínt, fotót, catering-et, zenét, dekort. Iratkozzatok fel a várólistára, és értesítünk, amint nyitunk a szolgáltatóknak.",
    },
    en: {
      title: "For vendors — Weddly",
      description:
        "Join Weddly's curated directory of Hungarian wedding suppliers — venues, photographers, caterers, musicians. Reach couples actively planning their wedding.",
      h1: "Reach couples who are planning now.",
      intro:
        "Weddly's curated directory is where couples look first when they shop venue, photo, catering, music or decor. Join the waitlist and we'll write when we open the supplier side.",
    },
  },
  "/privacy": {
    hu: {
      title: "Adatvédelmi szabályzat — Wēddly",
      description:
        "Hogyan kezeli a Wēddly az adataitokat: gyűjtött kategóriák, megőrzés, GDPR jogok, sütik és külső szolgáltatók.",
      h1: "Adatvédelmi szabályzat",
      intro:
        "Ez az oldal bemutatja, milyen adatokat gyűjt a Wēddly, miért gyűjtjük, meddig őrizzük meg, és mit kérhettek velük kapcsolatban. Egy kis, nyílt bétás termék vagyunk — ezért igyekszünk a szabályzatot rövidnek és pontosnak tartani.",
    },
    en: {
      title: "Privacy policy — Weddly",
      description:
        "How Weddly handles your data: what we collect, retention windows, GDPR rights, cookies and third-party processors.",
      h1: "Privacy policy",
      intro:
        "This page explains what data Weddly collects, why we collect it, how long we keep it and what you can ask us to do with it. We're a small open-beta product — we try to keep this short and honest.",
    },
  },
  "/terms": {
    hu: {
      title: "Felhasználási feltételek — Wēddly",
      description:
        "A Wēddly használatának feltételei: a szolgáltatás működése, jogok és kötelezettségek, korlátozások, a nyílt béta státusza és a kapcsolat.",
      h1: "Felhasználási feltételek",
      intro:
        "Ez a dokumentum a Wēddly használatának feltételeit írja le: mit jelent használni a szolgáltatást, mit vállalunk mi és mit vártok el ti, hogyan változtathatunk rajtuk és mit jelent a nyílt béta státusz.",
    },
    en: {
      title: "Terms of use — Weddly",
      description:
        "How Weddly's service works: what we promise, what we expect, limits, the open-beta status and how to get in touch.",
      h1: "Terms of use",
      intro:
        "This page describes Weddly's terms of use: what using the service means, what we commit to and what we expect from you, how we can change the terms, and what the open-beta status implies.",
    },
  },
  "/terms/vendor-subscription": {
    hu: {
      title: "Szolgáltatói előfizetési feltételek (tervezet) — Wēddly",
      description:
        "A Wēddly szolgáltatói várólistájához és a v2-es fizetős profilokhoz tartozó előfizetési feltételek tervezete.",
      h1: "Szolgáltatói előfizetési feltételek (ÁSZF — tervezet)",
      intro:
        "Ez a dokumentum a Wēddly szolgáltatói várólistájához és a v2-ben induló fizetős profilokhoz tartozó előfizetési feltételek tervezete. Egyelőre tájékoztató jellegű — a fizetős szolgáltatás indulása előtt fogjuk véglegesíteni.",
    },
    en: {
      title: "Vendor subscription terms (draft) — Weddly",
      description:
        "Draft subscription terms for Weddly's vendor waitlist and the v2 paid profiles. Informational only until the paid service launches.",
      h1: "Vendor subscription terms (draft)",
      intro:
        "This is a draft of the subscription terms that will govern Weddly's vendor waitlist and the v2 paid profiles. It's informational until we finalise it before the paid service launches.",
    },
  },
  "/imprint": {
    hu: {
      title: "Impresszum — Wēddly",
      description:
        "A Wēddly üzemeltetőjének adatai: név, elérhetőség, technikai szolgáltatók — a hatályos magyar és uniós jogszabályok szerint.",
      h1: "Impresszum",
      intro:
        "A Wēddly üzemeltetőjének kötelező impresszum-adatai: operátor neve, elérhetőségei, technikai szolgáltatók és a vonatkozó magyar és uniós jogszabályok alapján kötelező közlések.",
    },
    en: {
      title: "Imprint — Weddly",
      description:
        "Weddly's operator information: name, contact details, technical providers — as required by Hungarian and EU disclosure rules.",
      h1: "Imprint",
      intro:
        "Mandatory disclosures about Weddly's operator: name, contact details, technical providers and the related obligations under Hungarian and EU rules.",
    },
  },
  "/login": {
    hu: {
      title: "Bejelentkezés — Wēddly",
      description:
        "Lépjetek be a páros workspace-etekre. Folytatjátok ott, ahol abbahagytátok — költségvetés, vendéglista, RSVP, ültetés.",
      h1: "Bejelentkezés",
      intro:
        "Lépjetek be a Wēddly páros workspace-etekre. Folytatjátok ott, ahol abbahagytátok — közös költségvetés, vendéglista, RSVP linkek és ültetési vászon kettőtöknek.",
    },
    en: {
      title: "Sign in — Weddly",
      description:
        "Sign in to your shared Weddly workspace. Pick up where you left off — budget, guest list, RSVP, seating.",
      h1: "Sign in",
      intro:
        "Sign in to your shared Weddly workspace. Pick up where you left off — shared budget, guest list, RSVP links and seating canvas for both of you.",
    },
  },
  "/eszkozok/eskuvo-koltsegvetes-kalkulator": {
    hu: {
      title: "Esküvő költségvetés kalkulátor — Wēddly",
      description:
        "Mennyibe kerül egy esküvő Magyarországon 2026-ban? Húzd a vendégszámot és a keretet — kategóriánként élőben számolódik. Ingyenes, regisztráció nélkül.",
      h1: "Esküvő költségvetés kalkulátor",
      intro:
        "Magyar esküvős átlagokra szabott élő kalkulátor: húzd a vendégszámot és a keretet, kategóriánként újraszámolódik. A számokat egy kattintással átvihetitek a saját workspace-etekbe.",
    },
    en: {
      title: "Wedding budget calculator — Weddly",
      description:
        "How much does a wedding cost in Hungary in 2026? Drag the guest count and budget — every category recalculates live. Free, no signup needed.",
      h1: "Wedding budget calculator",
      intro:
        "Live calculator tuned to Hungarian wedding averages: drag the guest count and budget, every category recalculates. One click carries the numbers into your own workspace.",
    },
  },
  "/eszkozok/eskuvo-visszaszamlalo": {
    hu: {
      title: "Esküvő visszaszámláló — hány nap van hátra | Wēddly",
      description:
        "Hány nap, hét, hónap van az esküvőtökig? Add meg a dátumot, és mérföldkövekkel együtt látod mit érdemes intézni 12, 9, 6, 3, 1 hónappal és 1 héttel előtte.",
      h1: "Esküvő visszaszámláló",
      intro:
        "Add meg az esküvőtök dátumát — Élőben látod a maradék napok, hetek, hónapok számát, és egy mérföldkő-listát hogy mit érdemes intézni mikor.",
    },
    en: {
      title: "Wedding countdown — days remaining | Weddly",
      description:
        "How many days, weeks, months until your wedding? Pick a date and get a milestone timeline: what to plan 12, 9, 6, 3, 1 month and 1 week out.",
      h1: "Wedding countdown",
      intro:
        "Pick your wedding date — see months, weeks and days remaining live, with a milestone list of what to plan when.",
    },
  },
  "/eszkozok/vendeglista-sablon": {
    hu: {
      title: "Vendéglista sablon — esküvői CSV (ingyen) | Wēddly",
      description:
        "Letölthető CSV vendéglista-sablon magyar esküvőre szabva: vezetéknév, e-mail, telefon, háztartás, étrend, kísérő, RSVP. Importálható közvetlenül a Wēddly-be.",
      h1: "Vendéglista sablon — magyar esküvőre szabva",
      intro:
        "Töltsd le a CSV-sablont, töltsd ki Excel-ben vagy Sheets-ben, vagy importáld közvetlenül a Wēddly-be. Magyar oszlopnevekkel, 8 példasorral.",
    },
    en: {
      title: "Wedding guest list template — CSV (free) | Weddly",
      description:
        "Downloadable wedding guest-list CSV template: last name, email, phone, household, diet, plus-one, RSVP. Imports straight into Weddly.",
      h1: "Wedding guest list template",
      intro:
        "Download the CSV template, fill it in Excel or Sheets, or import directly into Weddly. Eight sample rows so you see the format.",
    },
  },
  "/eszkozok/ultetesi-rend-keszito": {
    hu: {
      title: "Ültetési rend készítő — ingyenes esküvői | Wēddly",
      description:
        "Vászon, asztalok, vendégek — húzd a helyükre, és A4 / A6 / A3 PDF-be exportálódik, pontos mm méretben. Magyar esküvőkre szabva, ingyenes a nyílt béta alatt.",
      h1: "Ültetési rend készítő — ingyen, magyar esküvőkre",
      intro:
        "Interaktív ültetési vászon: asztalok, vendégek drag-and-drop, automatikus konfliktus-jelzés, és nyomtatható PDF A4 / A6 (ültetőkártya) / A3 (bejárati tábla) méretben.",
    },
    en: {
      title: "Wedding seating chart maker — free | Weddly",
      description:
        "Canvas, tables, guests — drag onto seats and export to PDF at A4 / A6 / A3 at exact mm. Tailored for Hungarian weddings, free during the open beta.",
      h1: "Wedding seating chart maker",
      intro:
        "Interactive seating canvas: tables, drag-and-drop guests, conflict flags, and printable PDF export at A4 / A6 (place cards) / A3 (entrance display).",
    },
  },
  "/eszkozok/rsvp-szoveg-generator": {
    hu: {
      title: "RSVP szöveg generátor — esküvői minta | Wēddly",
      description:
        "RSVP minta szöveg esküvői meghívóhoz: töltsd ki a párotok nevét, dátumot, helyszínt, és kapsz kész szöveget klasszikus, hétköznapi és költői stílusban.",
      h1: "RSVP minta szöveg — esküvői meghívóhoz",
      intro:
        "Töltsd ki a nevet, dátumot, helyszínt és RSVP-határidőt — három stílusban (klasszikus, hétköznapi, költői) generálunk kész RSVP-szöveget. Másolható egy kattintással.",
    },
    en: {
      title: "Wedding RSVP wording generator | Weddly",
      description:
        "RSVP wording for wedding invitations: enter your names, date, venue and deadline, get ready-to-use wording in formal, casual or poetic styles.",
      h1: "Wedding RSVP wording — generator",
      intro:
        "Enter names, date, venue and deadline — we generate ready-to-use RSVP wording in three styles (formal, casual, poetic). Copy with one click.",
    },
  },
  "/signup": {
    hu: {
      title: "Regisztráció — Wēddly",
      description:
        "Indítsátok el a közös esküvőtervező workspace-eteket. Pár perc beállítás, magyar esküvőkre szabva, a nyílt béta alatt ingyenes.",
      h1: "Indítsátok el a páros workspace-eteket",
      intro:
        "Pár perc, és kettőtöknek lesz egy közös felülete az esküvőtervezéshez — élő költségvetés, vendéglista, RSVP linkek, ültetési vászon és nyomtatható kártyák. Magyar esküvőkre szabva, a nyílt béta alatt ingyenes.",
    },
    en: {
      title: "Create your couple workspace — Weddly",
      description:
        "Open one shared workspace for both of you and start planning in minutes. Free throughout the open beta.",
      h1: "Open your couple workspace",
      intro:
        "Set up one shared workspace for both of you in a few minutes — live budget, guest list, RSVP links, seating canvas and printable cards. Free throughout the open beta.",
    },
  },
};

/** Hungarian-alias `/impresszum` resolves to the same SEO entry as `/imprint`.
 *  Done at lookup time rather than duplicating the entry so the copy stays
 *  in one place. */
export function lookupRouteSeo(pathname: string): RouteSeo | null {
  const path = pathname === "/impresszum" ? "/imprint" : pathname;
  return ROUTE_SEO[path] ?? null;
}
