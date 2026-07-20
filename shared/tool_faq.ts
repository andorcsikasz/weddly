// Single source of truth for the per-tool FAQ copy on the /tools/* (HU:
// /eszkozok/*) landing pages.
//
// Used in two places, exactly like shared/seo_faq.ts does for the landing FAQ:
//   1. backend/src/lib/seo_ssr.ts → emits these verbatim as the FAQPage
//      JSON-LD on each tool path. Googlebot needs the SAME Q/A strings that
//      appear on the visible page; divergence is treated as cloaking and can
//      demote the page, which is exactly why this copy cannot stay in the
//      frontend-only locale tree.
//   2. frontend/src/pages/<Tool>Page.tsx → renders these into the visible
//      <details> FAQ cards.
//
// Edit this file (not duplicates in locales/seo_ssr) when tool FAQ copy
// changes — that is the whole point of keeping it in `shared/`.

import type { SeoFaqEntry, SeoFaqLocale } from "./seo_faq";

/** The six tools that have an FAQ block. The slug is the stable key; the two
 *  path spellings are the HU and EN canonical URLs the SSR layer matches on. */
export type ToolFaqSlug =
  | "budget_calculator"
  | "countdown"
  | "guest_list_template"
  | "seating_chart"
  | "rsvp_generator"
  | "couple_cards";

/** HU + EN canonical paths per tool, mirroring SLUG_PAIRS in seo_routes.ts. */
export const TOOL_FAQ_PATHS: Record<ToolFaqSlug, { hu: string; en: string }> = {
  budget_calculator: {
    hu: "/eszkozok/eskuvo-koltsegvetes-kalkulator",
    en: "/tools/wedding-budget-calculator",
  },
  countdown: { hu: "/eszkozok/eskuvo-visszaszamlalo", en: "/tools/wedding-countdown" },
  guest_list_template: { hu: "/eszkozok/vendeglista-sablon", en: "/tools/guest-list-template" },
  seating_chart: { hu: "/eszkozok/ultetesi-rend-keszito", en: "/tools/seating-chart-builder" },
  rsvp_generator: { hu: "/eszkozok/rsvp-szoveg-generator", en: "/tools/rsvp-text-generator" },
  couple_cards: {
    hu: "/eszkozok/100-kerdes-eskuvo-elott",
    en: "/tools/100-questions-before-marriage",
  },
};

export const TOOL_FAQ: Record<SeoFaqLocale, Record<ToolFaqSlug, ReadonlyArray<SeoFaqEntry>>> = {
  hu: {
    budget_calculator: [
      {
        q: "Mennyibe kerül átlagosan egy esküvő Magyarországon?",
        a: "Egy 80–100 fős esküvő mediánja 5–8 millió forint 2026-ban, a vidéki és fővárosi árkülönbségtől függően. A kalkulátorban kicsi és nagy létszámra is megnézheted, hogyan oszlik el a keret kategóriák szerint.",
      },
      {
        q: "Mennyit költsünk egy vendégre?",
        a: "Egy vendégre átlagosan 50 000–80 000 Ft jut a teljes keretből, ami magába foglalja a cateringet, italokat, dekort és a vendégekre eső helyszín-arányt. A Wēddly kalkulátora pontosan kiszámolja a vendégszám és a keret alapján a per-fő költést.",
      },
      {
        q: "Hogyan oszlik meg az esküvői keret kategóriák között?",
        a: "Ajánlott bontás: ~35% catering és italok, ~18% helyszín, ~13% fotó-videó, ~9% dekor és virág, ~8% öltözet és szépség, ~7% zene/DJ, ~5% ceremónia, ~2% papírárú, és ~3% biztonsági tartalék. A kalkulátorban élőben látjátok az aktuális számokra vetítve.",
      },
      {
        q: "Megőrizhetők a számok regisztráció után?",
        a: "Igen. A „Folytasd a Wēddly-ben” gombbal a vendégszám és a teljes keret bekerül a saját workspace-etek vázlatába; a regisztráció utáni onboardingnál ezekkel a számokkal indul a tervezés. Onnantól kategóriánként szerkeszthetitek és bármikor szüneteltethetitek a workspace-et.",
      },
    ],
    countdown: [
      {
        q: "Mikor érdemes kezdeni az esküvőtervezést?",
        a: "Magyar átlag: 12–18 hónappal az esküvő előtt. A helyszín és a fotós a két leghamarabb foglalandó tétel, népszerű időpontokra 18 hónappal előtte már nehéz lehet jó helyszínt találni.",
      },
      {
        q: "Hány nappal előtte küldjük ki a meghívókat?",
        a: "Klasszikusan 8–12 héttel az esküvő előtt érdemes a meghívókat kiküldeni, RSVP-határidővel ~4 héttel az esküvő előtt. Külföldről érkező vendégeknek érdemes 4–6 héttel hamarabb save-the-date-et küldeni.",
      },
      {
        q: "Mi az a save-the-date és mikor küldjük?",
        a: "A save-the-date egy rövid előzetes értesítés a dátumról és a helyszín-régióról, hogy a vendégek be tudják iktatni a naptárukba. Ideális kiküldési idő: 6–9 hónappal az esküvő előtt, főleg ha sok vidéki vagy külföldi vendég lesz.",
      },
    ],
    guest_list_template: [
      {
        q: "Hány vendéget hívjunk az esküvőre?",
        a: "Magyar átlag: 80–120 fő. A létszám közvetlenül befolyásolja a helyszínt, cateringet és a teljes keret 55%-át, érdemes a vendégszámot előbb tisztázni, mint a keretet. A Wēddly költségvetés-kalkulátora élőben mutatja a hatást.",
      },
      {
        q: "Kiket NEM kell hívni az esküvőre?",
        a: "Nincs kötelező mező. Egy érvényes elv: ha az utolsó találkozás óta több mint 2 év telt el, vagy nem érdekel hogy ott legyenek-e a nagy napon, akkor inkább ne. A „kötelességből” meghívott vendégek a leggyakoribb feszültségforrás.",
      },
      {
        q: "Mit írjak a vendéglista Excel/Google Sheets fájlomban?",
        a: "Minimum: keresztnév, vezetéknév, kapcsolattartó (e-mail vagy telefon), háztartás, RSVP-státusz. Hasznos extra oszlopok: étrend, kísérő, kapcsolat típusa (család / barát / munka / egyetem). A Wēddly-sablon mindezt tartalmazza.",
      },
    ],
    seating_chart: [
      {
        q: "Hányan üljenek egy asztalnál?",
        a: "Kerek asztal: 8–10 fő ideális, max 12. Szögletes (banketts): 6–8 fő egy oldalon, vagyis 12–16 egy asztalon. 10 fő felett a beszélgetés szétfeslik, vendégek nem hallják egymást, a Wēddly figyelmeztet, ha túl sokat raksz egy asztalra.",
      },
      {
        q: "Mikor készítsem el az ültetési rendet?",
        a: "Az RSVP-határidő (~4 héttel az esküvő előtt) után érdemes kezdeni. A végleges létszámmal lehet pontosan tervezni; addig vázlat-szinten elég. A Wēddly-ben kétféle nézet van: tervezett és végleges, így átmehetsz vázlat-módból véglegesbe.",
      },
      {
        q: "Hogyan oldjam meg a kínos vendégeket?",
        a: "A legbiztosabb módszer: külön asztal és minimum 2 asztalnyi távolság. A vendéglistádba felviszed a konfliktust mint jegyzet, a Wēddly pedig jelez, ha véletlenül egymás mellé húzod őket.",
      },
    ],
    rsvp_generator: [
      {
        q: "Mit jelent az RSVP?",
        a: "Az RSVP a francia „Répondez s'il vous plaît” rövidítése, „kérjük, válaszoljon”. Esküvős kontextusban annyit jelent: kérjük, jelezze, hogy jön-e az esküvőre. A magyar esküvőkön klasszikusan 3–4 héttel az esküvő előtt szokás összegyűjteni.",
      },
      {
        q: "Mikor küldjem ki az RSVP-kérést?",
        a: "Az RSVP-kérés a meghívóval együtt megy, magyar átlag: 8–12 héttel az esküvő előtt. RSVP-határidő: ~4 héttel az esküvő előtt, hogy a catering-nek és helyszínnek időben tudjátok jelezni a végleges létszámot.",
      },
      {
        q: "Mit írjak az RSVP-szövegbe?",
        a: "Minimum: párotok neve, az esküvő dátuma, helyszín, RSVP-határidő és egy elérhetőség (e-mail vagy telefon, vagy egy link). Hasznos extra: étrend kérdés, kísérő-mező, allergia. A Wēddly RSVP-oldala ezeket egy linken keresztül oldja meg.",
      },
    ],
    couple_cards: [
      {
        q: "Mire való ez a 100 kérdés?",
        a: "Beszélgetésindító. A kutatások szerint a tartós kapcsolatokban az számít, hogy a pár képes-e nyitottan beszélni a pénzről, a családról, a vágyról és a halálról is. A négy paklit ezek köré rendeztük, hogy a nehéz témák ne maradjanak a szőnyeg alatt.",
      },
      {
        q: "Kötelező mind a 100-at megválaszolni?",
        a: "Nem. Egy kártya egy beszélgetés. Húzzatok egyet, beszéljétek meg, és tegyétek vissza a paklit. A böngészőtök megjegyzi, melyik kártyáknál tartotok, és a következő látogatáskor onnan folytatjátok.",
      },
      {
        q: "Miért pont ez a négy pakli?",
        a: "Tíz külső szakértő (párterapeuta, pénzügyi tervező, hosszan házas párok, intimitás-coach, filozófus) szemszögéből szűrtük le a témákat. Ami mindenkinél visszatért: a család öröksége, a pénz és a hétköznapok, a test és a vágy, és a halál–krízis–értelem hármasa. Innen jött a négy pakli.",
      },
    ],
  },
  en: {
    budget_calculator: [
      {
        q: "How much does an average wedding cost?",
        a: "An 80–100 guest wedding follows the same proportional split regardless of country, catering and venue dominate, with 20–25% of the remaining budget covering attire, music, ceremony and stationery. The calculator lets you see how the budget splits for any guest count + total in your own currency.",
      },
      {
        q: "How much per guest?",
        a: "Catering, drinks, decor and the guest-share of the venue typically run together as the largest per-guest cost. The calculator computes the exact per-guest figure for the total you set, work backwards from the per-guest you can afford if that frames the budget better for you.",
      },
      {
        q: "How is a wedding budget broken down by category?",
        a: "Hungarian-typical split: ~35% catering and drinks, ~18% venue, ~13% photo / video, ~9% decor and flowers, ~8% attire and beauty, ~7% music / DJ, ~5% ceremony, ~2% stationery, ~3% contingency. The calculator visualises this live against your numbers.",
      },
      {
        q: "Are the numbers saved after signup?",
        a: "Yes. The “Continue in Weddly” button carries the guest count + total into your workspace draft; onboarding picks up with those numbers pre-filled. From there it's per-category editable and you can pause the workspace any time.",
      },
    ],
    countdown: [
      {
        q: "How early should we start wedding planning?",
        a: "Typical: 12–18 months out. Venue and photographer book earliest, for popular dates, 18 months is already tight in Hungary.",
      },
      {
        q: "How long before the wedding should invitations go out?",
        a: "Classic: 8–12 weeks before the wedding, with an RSVP deadline ~4 weeks out. For out-of-town guests, send save-the-dates 4–6 weeks earlier.",
      },
      {
        q: "What is a save-the-date and when should we send it?",
        a: "A save-the-date is a short heads-up about the date and venue region so guests can block calendars. Ideal: 6–9 months out, especially if many guests are travelling.",
      },
    ],
    guest_list_template: [
      {
        q: "How many guests should we invite?",
        a: "Hungarian typical: 80–120 guests. Headcount drives venue, catering and ~55% of the total budget, pin the guest count before pinning the budget. The Weddly budget calculator shows the impact live.",
      },
      {
        q: "Who NOT to invite?",
        a: "No mandatory column. A simple rule: if you haven't seen them in 2+ years and don't actively want them on the big day, skip. Obligation invites are the most common source of stress.",
      },
      {
        q: "What columns should a wedding guest list spreadsheet have?",
        a: "Minimum: first name, last name, contact (email or phone), household, RSVP status. Useful extras: diet, plus-one, relationship (family / friends / work / uni). The Weddly template covers all of these.",
      },
    ],
    seating_chart: [
      {
        q: "How many guests per table?",
        a: "Round: 8–10 ideal, max 12. Rectangular (banquet): 6–8 per side, so 12–16 per table. Above 10 conversation breaks; Weddly warns if you over-pack a table.",
      },
      {
        q: "When should we make the seating chart?",
        a: "After the RSVP deadline (~4 weeks out). Draft modes are fine before then; finalize once headcount is locked. Weddly has draft + final modes so you don't lose the in-between work.",
      },
      {
        q: "How do we handle awkward guests?",
        a: "Safest move: separate tables, at least 2 tables apart. Add the conflict to your notes and Weddly will flag if you accidentally drag them next to each other.",
      },
    ],
    rsvp_generator: [
      {
        q: "What does RSVP mean?",
        a: "RSVP comes from the French “Répondez s'il vous plaît”, “please respond”. In a wedding context: please let us know whether you can attend. Classic: collect RSVPs 3–4 weeks before the wedding.",
      },
      {
        q: "When should we send the RSVP request?",
        a: "The RSVP request goes with the invitation, typically 8–12 weeks out. RSVP deadline: ~4 weeks before the wedding so you can lock final headcount with the venue and caterer.",
      },
      {
        q: "What should the RSVP wording include?",
        a: "Minimum: your names, the wedding date, venue, RSVP deadline, and one contact channel (email / phone / link). Helpful extras: a dietary question, a plus-one field, an allergy line. Weddly's RSVP page covers all of these via a single link.",
      },
    ],
    couple_cards: [
      {
        q: "What's the point of these 100 questions?",
        a: "Conversation starters. Long-term relationships research keeps pointing to the same thing: couples who can talk openly about money, family, desire and death tend to last. The four decks are organised around those topics, so the hard ones don't stay under the rug.",
      },
      {
        q: "Do we have to answer all 100?",
        a: "No. One card is one conversation. Pull one, talk it through, put the deck down. Your browser remembers where you are in each deck, so the next visit picks up from there.",
      },
      {
        q: "Why these four decks specifically?",
        a: "We took the synthesis of ten different perspectives (a couples therapist, a long-married couple, an intimacy coach, a financial planner, a philosopher) and the themes that surfaced in all of them: family inheritance, money and the everyday, body and desire, and the death–crisis–meaning cluster. That's how we landed on four.",
      },
    ],
  },
};

/** Resolve a request path (either locale's spelling, with or without a trailing
 *  slash) to its tool slug, or null when the path isn't a tool page. */
export function toolFaqSlugForPath(pathname: string): ToolFaqSlug | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const slug of Object.keys(TOOL_FAQ_PATHS) as ToolFaqSlug[]) {
    const pair = TOOL_FAQ_PATHS[slug];
    if (pair.hu === clean || pair.en === clean) return slug;
  }
  return null;
}

/** The FAQ entries for a request path in the given locale, or null. */
export function toolFaqForPath(
  pathname: string,
  locale: SeoFaqLocale,
): ReadonlyArray<SeoFaqEntry> | null {
  const slug = toolFaqSlugForPath(pathname);
  return slug ? TOOL_FAQ[locale][slug] : null;
}
