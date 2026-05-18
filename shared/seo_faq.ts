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
      q: "Tényleg ingyenes a Wēddly?",
      a: "A nyílt béta alatt minden funkciót szabadon használhattok — költségvetés, vendéglista, RSVP, ültetés, nyomtatható kártyák. A v2-vel vezetjük be az árazást; a részleteket időben kihirdetjük.",
    },
    {
      q: "Mindketten tudjuk használni?",
      a: "Igen. Egyikőtök regisztrál, és egy linkkel meghívja a másikat. Ugyanazt a felületet látjátok, mindketten saját belépéssel.",
    },
    {
      q: "Mi történik az adatainkkal?",
      a: "A tiétek. Minden változást auditnaplóban követünk. Bármikor szüneteltethetitek a felületet; ha 30 napon belül visszajöttök, ott folytatjátok, ahol abbahagytátok — ügyfélszolgálatra sincs szükség.",
    },
    {
      q: "Mi történik az adatainkkal az esküvő után?",
      a: "Ott maradnak — addig, ameddig csak szeretnétek, mintha egy esküvői albumot tartanátok a polcon. A Profil oldalról bármikor szüneteltethetitek a felületet: 30 napig megőrizzük az adatokat, utána véglegesen töröljük. A határidőig bármelyikőtök vissza tudja vonni a kérést.",
    },
    {
      q: "Kell hozzá esküvőszervező?",
      a: "Megoldjátok kettesben is — a Wēddly végigvezet a költségvetésen, vendéglistán és ültetésen. Ha van szervezőtök, ő is csatlakozhat egy harmadik belépéssel ugyanahhoz a felülethez.",
    },
    {
      q: "Készen áll a mi esküvőnkre?",
      a: "Az élő költségvetés, RSVP linkek, vizuális ültetés és nyomtatható kártyák (A4 / A6 / A3) ma már működnek. A szolgáltatói lista válogatott; a foglalás a v2-ben jön.",
    },
  ],
  en: [
    {
      q: "Is Weddly really free?",
      a: "Every feature is free throughout the open beta — budget, guest list, RSVP, seating, printable cards. We'll introduce pricing with v2; details will be announced ahead of time.",
    },
    {
      q: "Can both of us use it?",
      a: "Yes. One of you signs up and invites the other with a link. You both see the same workspace with your own logins.",
    },
    {
      q: "What happens to our data?",
      a: "It's yours. Every change goes into an audit log. You can pause the workspace any time; come back within 30 days and pick up exactly where you left off — no support ticket needed.",
    },
    {
      q: "What happens to our data after the wedding?",
      a: "It stays — as long as you want, like a wedding album on a shelf. From the Profile page you can pause the workspace any time: we keep the data for 30 days, then delete it permanently. Either of you can undo the request until that deadline.",
    },
    {
      q: "Do we need a wedding planner?",
      a: "You can plan it together — Weddly walks you through budget, guests and seating. If you do work with a planner, they can join the same workspace with a third login.",
    },
    {
      q: "Is it ready for our wedding?",
      a: "Live budget, RSVP links, visual seating and printable cards (A4 / A6 / A3) work today. The supplier directory is curated for browsing; bookings land in v2.",
    },
  ],
};
