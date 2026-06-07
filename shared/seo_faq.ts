// Single source of truth for the landing-page FAQ.
//
// Used in two places:
//   1. backend/src/lib/seo_ssr.ts → emits this verbatim as the FAQPage
//      JSON-LD on the root path (Googlebot needs the exact same Q/A
//      strings that appear on the visible page; divergence is treated
//      as cloaking and can demote the page).
//   2. frontend/src/pages/LandingPage.tsx → renders these into <details>
//      cards as the visible FAQ.
//
// Edit this file (not duplicates in locales/seo_ssr) when the FAQ copy
// changes — that's the whole point of keeping it in `shared/`.

export type SeoFaqLocale = "hu" | "en";

export interface SeoFaqEntry {
  q: string;
  a: string;
}

export const SEO_FAQ: Record<SeoFaqLocale, ReadonlyArray<SeoFaqEntry>> = {
  hu: [
    {
      q: "Mit vált ki a Wēddly?",
      a: "A Wēddly leváltja a táblázatokat, jegyzeteket, RSVP-üzeneteket és ültetési vázlatokat, amelyek általában szétszóródnak a telefonokon és laptopokon. A költségvetés, a vendéglista, az RSVP-válaszok, az ültetés és az esküvői weboldal egyetlen közös felületen él.",
    },
    {
      q: "Tényleg ingyenes a Wēddly?",
      a: "Igen. Az első 200 pár az esküvője napjáig, legfeljebb 18 hónapig ingyen használhatja a Wēddly-t. Az induláshoz nincs szükség bankkártyára.",
    },
    {
      q: "Mindketten ugyanazt a tervet használhatjuk?",
      a: "Igen. Egyikőtök létrehozza a felületet, és egy privát linkkel meghívja a másikat. Mindketten saját belépéssel léptek be, de ugyanazt a költségvetést, vendéglistát, RSVP-válaszokat és ültetést látjátok, valós időben.",
    },
    {
      q: "Kell a vendégeinknek fiók?",
      a: "Nem. A vendégek megnyitják a személyes RSVP linkjüket, ellenőrzik az adataikat, és a telefonjukról válaszolnak. Nincs szükségük Wēddly-fiókra.",
    },
    {
      q: "Exportálhatjuk a vendéglistát és az ültetést?",
      a: "Igen. A vendégadatokat CSV-ben exportálhatjátok, az ültetési terveket pedig PDF-ben nyomtathatjátok A4, A6 és A3 méretben.",
    },
    {
      q: "Kié az esküvői adatunk?",
      a: "A tiétek. A vendéglista, az RSVP-válaszok, az ültetési terv és a költségvetés hozzátok tartozik. Minden változást auditnaplóban mentünk, és bármikor exportálhatjátok az adataitokat.",
    },
    {
      q: "Törölhetünk mindent az esküvő után?",
      a: "Igen. A profilotokból bármikor szüneteltethetitek vagy törölhetitek a felületet. Az adatokat 30 napig megőrizzük, hátha meggondoljátok magatokat, utána véglegesen töröljük. A határidő előtt bármelyikőtök visszavonhatja a kérést.",
    },
    {
      q: "A mi esküvőszervezőnk is használhatja a Wēddly-t?",
      a: "Igen. Tervezhettek kettesben, vagy meghívhattok egy esküvőszervezőt ugyanarra a felületre. Ugyanazon az élő költségvetésen, vendéglistán, RSVP-válaszokon és ültetésen tud segíteni, fájlok ide-oda küldözgetése helyett.",
    },
    {
      q: "Használható már ma a Wēddly?",
      a: "Igen. A tervezés magja ma is élesben működik: költségvetés, vendéglista, személyes RSVP linkek, vizuális ültetés, nyomtatható PDF-ek, napirend, feladat-idővonal és a saját vendégoldalatok. A szolgáltatók foglalása a v2-ben jön, de a válogatott szolgáltatói lista már elérhető.",
    },
    {
      q: "Mi jön később?",
      a: "A szolgáltatófoglalás, az esküvő utáni galéria, a köszönetkövetés és az értékelések a későbbi verziókban érkeznek. A jelenlegi termék már most lefedi az esküvő előtti fő tervezési folyamatot.",
    },
  ],
  en: [
    {
      q: "What does Weddly replace?",
      a: "Weddly replaces the spreadsheets, notes, RSVP messages and seating drafts that usually get scattered across phones and laptops. Your budget, guest list, RSVP replies, seating chart and wedding website live in one shared workspace.",
    },
    {
      q: "Is Weddly really free?",
      a: "Yes. The first 200 couples can use Weddly free until their wedding day, for up to 18 months. No credit card is needed to start.",
    },
    {
      q: "Can both of us use the same wedding plan?",
      a: "Yes. One of you creates the workspace and invites the other with a private link. You each use your own login, but both of you see the same budget, guest list, RSVP replies and seating chart in real time.",
    },
    {
      q: "Do our guests need an account?",
      a: "No. Guests open their personal RSVP link, check their details and reply from their phone. They do not need a Weddly account.",
    },
    {
      q: "Can we export our guest list and seating plan?",
      a: "Yes. You can export guest data as CSV and print seating layouts as PDF in A4, A6 and A3 formats.",
    },
    {
      q: "Who owns our wedding data?",
      a: "You do. Your guest list, RSVP replies, seating plan and budget belong to you. Every change is saved in an audit log, and you can export your data anytime.",
    },
    {
      q: "Can we delete everything after the wedding?",
      a: "Yes. You can pause or delete your workspace from your profile. We keep the data for 30 days in case you change your mind, then delete it permanently. Either partner can undo the request before the deadline.",
    },
    {
      q: "Can our wedding planner use Weddly too?",
      a: "Yes. You can plan as a couple, or invite a wedding planner into the same workspace. They can help with the same live budget, guest list, RSVP replies and seating plan instead of sending files back and forth.",
    },
    {
      q: "Is Weddly ready to use today?",
      a: "Yes. The core planning flow is live today: budget, guest list, personal RSVP links, visual seating, printable PDFs, day-of schedule, task timeline and your guest page. Supplier booking is planned for v2, but the curated supplier directory is already available.",
    },
    {
      q: "What is coming later?",
      a: "Supplier booking, post-wedding gallery, thank-you tracking and reviews are planned for later versions. The current product already covers the main planning flow before the wedding.",
    },
  ],
};
