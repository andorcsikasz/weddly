// Blog post shapes shared between the React frontend and the backend's
// SSR meta builder. The live source of truth is the `blog_posts` SQLite
// table; the `SEED_BLOG_POSTS` array below is only consumed by the
// first-boot seeder in `domain/blog.ts`, so an empty DB starts the admin
// with a usable set of posts instead of a blank screen.

import type { SeoLocale } from "./seo_routes";

export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] };

export interface BlogPostLocale {
  title: string;
  lead: string;
  body: BlogBlock[];
  seo_title: string;
  seo_description: string;
}

export interface BlogPost {
  /** Numeric primary key (admin-only; absent on seed records). */
  id?: number;
  slug: string;
  /** ISO date `YYYY-MM-DD`. Used for ordering + the visible byline. */
  published_at: string;
  /** Reading-time estimate in minutes. Hand-tuned per post, not auto. */
  read_minutes: number;
  /** Eyebrow label shown above the title (category tag). One per locale. */
  category: Record<SeoLocale, string>;
  /** Hero cover image. Either a local `/uploads/blog/...` path or an
   *  external http(s) URL the admin pasted in. Null = no image set. */
  cover_image_url?: string | null;
  /** Draft (false) vs live (true). Drafts are hidden from public lists +
   *  return 404 on /blog/:slug, but still visible in the admin index. */
  is_published?: boolean;
  hu: BlogPostLocale;
  en: BlogPostLocale;
}

export const SEED_BLOG_POSTS: BlogPost[] = [
  {
    slug: "eskuvoi-koltsegvetes-felosztas",
    published_at: "2026-05-15",
    read_minutes: 6,
    category: { hu: "Költségvetés", en: "Budget" },
    hu: {
      title: "Hogyan oszd el az esküvői költségvetést?",
      lead: "Hat kategória, egy reális arány, és három pont, ahol a magyar esküvők rendre megcsúsznak.",
      seo_title: "Hogyan oszd el az esküvői költségvetést? · Wēddly",
      seo_description:
        "Hat kategória, egy reális százalékos arány magyar esküvőre szabva, a vacsorától a fotósig. A leggyakoribb hibák, amiket érdemes elkerülni.",
      body: [
        {
          type: "p",
          text: "A legtöbb pár ott akad meg, hogy a teljes keret megvan, de a részösszegek nem. Egy 8 milliós esküvő ugyanúgy meg tudja enni a fele büdzsét catering-re, mint dekorra, attól függ, ki melyiket teszi előre. Az alábbi felosztás egy reális kiindulópont magyar esküvőre, 100 fős vendéglistával számolva.",
        },
        { type: "h2", text: "Reális kiinduló arány" },
        {
          type: "ul",
          items: [
            "Étel és ital: 38-42% (a magyar esküvő legnagyobb tétele, alig csökkenthető)",
            "Helyszín: 12-18% (ha all-inclusive, ennek egy része átcsúszik a cateringbe)",
            "Fotó és videó: 10-14% (a hosszú távú emlék, érdemes nem ide spórolni)",
            "Dekor és virág: 8-12% (itt lehet a legtöbbet alkudni stílus nélkül)",
            "Ruha, smink, fodrász: 7-10%",
            "Zene, DJ, élőzene: 5-8%",
            "Egyéb (papírmunka, meghívók, kísérők): 5-8%",
            "Tartalék: 5-10% (nem ajánlott, hanem kötelező)",
          ],
        },
        { type: "h2", text: "A három pont, ahol a magyar esküvők megcsúsznak" },
        {
          type: "p",
          text: "Az első a vendégszám. Ha 100-ban gondolkodtok, számoljatok 100 + 8% no-show-val, de 100 + 12% potenciálisan elfogadóval is. A tartalékba ezt is bele kell tervezni, mert minden egyes vendég átlagosan 22-28 ezer forinttal mozdítja a végösszeget, és ez csak a vacsora.",
        },
        {
          type: "p",
          text: "A második a felárak: felszolgálási díj, italfogyasztási minimum, korkedvezmény gyerekekre, terembérleti óradíj éjfél után. Ezek nem mind szerepelnek az ajánlatban, és tudnak +8-12%-ot jelenteni az utolsó hónapokban.",
        },
        {
          type: "p",
          text: "A harmadik a dekor. A Pinterestes vízió 18-22%-ot is megeszik egy normál büdzséből, miközben a vendég kb. három órán át fogja nézni. Itt érdemes két listát írni, „nélkülözhetetlen“ és „ha marad pénz“, és pontosan tudni, melyik melyik.",
        },
        { type: "h2", text: "Mit csinál ezzel a Wēddly?" },
        {
          type: "p",
          text: "A Költségvetés modulban beállítjátok a vendégszámot és a keretet, és a hat kategória élőben átszámolja magát erre a felosztásra. Minden kategória zárolható („ide nem nyúlunk többet“), és audit-logba megy minden módosítás. Így ketten ugyanazt a számot látjátok, és nincs vita arról, hogy „de hát múlt héten megbeszéltük“.",
        },
      ],
    },
    en: {
      title: "How to split your wedding budget",
      lead: "Six categories, one realistic split, and three places weddings consistently overspend.",
      seo_title: "How to split your wedding budget · Weddly",
      seo_description:
        "Six categories, a realistic percentage split for a 100-guest wedding, from catering to photography. The three places budgets quietly blow up.",
      body: [
        {
          type: "p",
          text: "Most couples have the total figure nailed down before the category-level split. The result is a single 8M HUF (or €20k) bucket that can eat half its weight in catering as easily as it can in florals, depending on who got their quotes in first. Here's a realistic starting point for a 100-guest wedding.",
        },
        { type: "h2", text: "A realistic starting split" },
        {
          type: "ul",
          items: [
            "Food and drink: 38-42% (the largest single line, rarely shrinks meaningfully)",
            "Venue: 12-18% (all-inclusive venues fold part of this into catering)",
            "Photo and video: 10-14% (the long-term memory, resist the urge to cut here)",
            "Decor and florals: 8-12% (the easiest line to negotiate without losing the look)",
            "Attire, hair, makeup: 7-10%",
            "Music, DJ, live band: 5-8%",
            "Other (paperwork, invites, transport for guests): 5-8%",
            "Reserve: 5-10% (not optional, mandatory)",
          ],
        },
        { type: "h2", text: "Three places budgets quietly blow up" },
        {
          type: "p",
          text: "First, headcount drift. If you're planning for 100, plan for 100 plus 8% no-show, but also 100 plus 12% potential acceptances. The reserve has to absorb this, because every guest adds €60-80 to the bottom line, and that's just catering.",
        },
        {
          type: "p",
          text: "Second, surcharges: service fees, bar minimums, child pricing, post-midnight venue rates. These don't always show up in the quote, and they can add 8-12% in the final two months when you can't renegotiate.",
        },
        {
          type: "p",
          text: 'Third, decor. The Pinterest vision can eat 18-22% of a normal budget, and your guests will look at it for about three hours. Write two lists, "essential" and "if budget allows", and know exactly which is which before you sign anything.',
        },
        { type: "h2", text: "How Weddly handles this" },
        {
          type: "p",
          text: 'The Budget module takes your guest count and total ceiling, and the six categories recalc live against this split. Each category can be locked ("we\'re done touching this one"), and every change goes into an audit log. Both of you see the same number, and there\'s no "but we agreed last week" debate.',
        },
      ],
    },
  },
  {
    slug: "ultetesi-rend-tippek",
    published_at: "2026-05-08",
    read_minutes: 5,
    category: { hu: "Ültetés", en: "Seating" },
    hu: {
      title: "Ültetési rend, ami nem robban szét két nappal a nagy nap előtt",
      lead: "Mikor kezdj hozzá, hogyan kezeld a +1-eseket, és miért érdemes az asztaloknak nevet adni.",
      seo_title: "Ültetési rend tippek esküvőhöz · Wēddly",
      seo_description:
        "Mikor kezdj hozzá, hogyan kezeld a plus-one-okat és az utolsó pillanatos visszamondásokat. Egy ültetési rend, ami nem robban szét két nappal a nagy nap előtt.",
      body: [
        {
          type: "p",
          text: "Az ültetési rend a vendéglista utolsó három hetében szokott szétesni. Aki két hete biztos jött, most mégsem; aki nem akart jönni, most hozza a barátnőjét. Néhány fogás, amit érdemes a kezdetektől beépíteni.",
        },
        { type: "h2", text: "Mikor kezdj hozzá" },
        {
          type: "p",
          text: "Akkor, amikor a vendégek 75%-a már RSVP-zett. Ez jellemzően az esküvő előtt 4-5 héttel jön el. Hamarabb kezdeni felesleges, mert minden harmadik döntésed amúgy is felülíródik. Később kezdeni viszont stresszes, mert egy 100 fős esküvő ültetése reálisan 6-8 órát eszik fel (és ezt nem fogod egy ültő helyedben megcsinálni).",
        },
        { type: "h2", text: "Adj nevet az asztaloknak" },
        {
          type: "p",
          text: "„1. asztal, 8 fő“ helyett írd, hogy „Család, szülők és nagyszülők“. Két okból: 1) a nyomtatható ültető táblán is jobban olvasható; 2) ha hirtelen kell mozgatni két vendéget, a kategória alapján gyorsabban találod meg a helyet, mint a számon.",
        },
        { type: "h2", text: "Plus-one és gyerek-stratégia" },
        {
          type: "ul",
          items: [
            "Plus-one-ok mindig olyan asztalhoz, ahol a társuk vagy az ismerős baráti kör ül. Sose külön „plus-one asztal“-ra (kínos).",
            "Gyerekek: vagy mindenki külön gyerekasztalhoz (10+ gyereknél éri meg), vagy a szülő mellé (kevesebbnél).",
            "Hagyj minden asztalon 1 üres helyet a 4. hétig. Utolsó pillanatos megerősítések jönni fognak.",
          ],
        },
        { type: "h2", text: "Konfliktus-jelzés" },
        {
          type: "p",
          text: "A Wēddly Ültetés moduljában minden vendéghez beállíthatsz „nem ezzel“ jelölést (volt házastársak, családi konfliktus, allergén-szomszéd, stb.). A canvas piros figyelmeztetést rak fel, ha véletlenül egymás mellé kerülnek, és ez a figyelmeztetés a nyomtatott PDF-en már nem szerepel, csak a tervező nézetben.",
        },
        { type: "h2", text: "Nyomtatás: A4, A6, A3" },
        {
          type: "p",
          text: "A4 a koordinátornak, A6 az ültető kártyáknak (asztalonként egy nevet listáz), A3 a bejárati táblának, ahol a vendégek megnézik, melyik asztaluk hol van. Mind a három pontos milliméter-méretben renderelődik, így nem kell a nyomdával méretről egyeztetni.",
        },
      ],
    },
    en: {
      title: "Seating charts that don't blow up two days before the wedding",
      lead: "When to start, how to handle plus-ones, and why you should give your tables names.",
      seo_title: "Wedding seating chart tips · Weddly",
      seo_description:
        "When to start, how to handle plus-ones and last-minute changes. A seating chart that survives the final two weeks of the wedding-planning sprint.",
      body: [
        {
          type: "p",
          text: "Seating charts tend to fall apart in the last three weeks. The cousin who was a certain yes is suddenly out; the friend who wasn't coming is now bringing a plus-one. A few habits keep it manageable.",
        },
        { type: "h2", text: "When to start" },
        {
          type: "p",
          text: "Once 75% of guests have RSVP'd. That's typically 4-5 weeks out. Earlier is wasted work, since a third of your decisions will be rewritten anyway. Later is stressful, because a 100-guest seating job realistically eats 6-8 hours of focused time (and you won't do it in one sitting).",
        },
        { type: "h2", text: "Name your tables" },
        {
          type: "p",
          text: '"Table 1, 8 seats" tells you nothing. "Family, parents and grandparents" tells you both who sits there and what to do if someone moves. Two benefits: the printed entrance display reads more cleanly, and if you need to swap two guests last-minute, the category name finds the right table faster than the number.',
        },
        { type: "h2", text: "Plus-ones and kids" },
        {
          type: "ul",
          items: [
            'Plus-ones always sit next to their partner, or with the partner\'s friend group. Never on a dedicated "plus-one table" (awkward).',
            "Kids: either one dedicated kids' table (worth it from 10 kids up), or next to a parent (for fewer).",
            "Leave 1 empty seat at every table until the final week. Last-minute confirmations will happen.",
          ],
        },
        { type: "h2", text: "Conflict flags" },
        {
          type: "p",
          text: "Weddly's seating canvas lets you mark \"can't sit with\" relationships per guest (exes, family rifts, allergen neighbours). The canvas flags a conflict in red if you accidentally seat them together, and that warning only appears in the planner view, never on the printed PDF.",
        },
        { type: "h2", text: "Printing at A4, A6, A3" },
        {
          type: "p",
          text: "A4 for the wedding coordinator's binder, A6 for individual place cards (one name per card), A3 for the entrance display where guests find their table. All three render at exact mm sizes, so you don't have to negotiate the dimensions with the print shop.",
        },
      ],
    },
  },
  {
    slug: "rsvp-hatarido-utanjaras",
    published_at: "2026-04-22",
    read_minutes: 4,
    category: { hu: "RSVP", en: "RSVP" },
    hu: {
      title: "RSVP határidő: mikor kérd, és mit csinálj a nem-válaszolókkal",
      lead: "A négyhetes határidő miért működik jobban a kéthetesnél, és hogyan utánajárj a csendben maradóknak anélkül, hogy idegesnek tűnnél.",
      seo_title: "RSVP határidő és utánajárás · Wēddly",
      seo_description:
        "Mikor kérd az RSVP-t, miért működik a négyhetes határidő jobban a kéthetesnél, és hogyan utánajárj a csendben maradóknak udvariasan, három lépésben.",
      body: [
        {
          type: "p",
          text: "Az RSVP határidő nem csak a vendégnek szól, neked is. A catering ezt fogja kérni 14 nappal a nagy nap előtt, a helyszín kb. 21 nappal előtte, az ültetés meg 28 nappal előtte. Ha a határidőd egyetlen pillanat, akkor mind a három láncszem stresszes lesz.",
        },
        { type: "h2", text: "Négyhetes határidő" },
        {
          type: "p",
          text: "A bevett magyar gyakorlat a kéthetes RSVP, de ez túl szoros. Négy héttel az esküvő előtt kérni a választ azt jelenti, hogy két hetetek van a halogatókat megszondázni, mielőtt a véglegesítés tényleg sürgető lenne. A meghívóra ezt írjátok: „Kérjük, jelezzétek 2026. július 12-ig.“ Egy konkrét dátum jobban működik, mint a „négy héttel előtte“.",
        },
        { type: "h2", text: "Utánajárás három lépésben" },
        {
          type: "ul",
          items: [
            "1. lépés (határidő után 3 nappal): rövid sablon SMS. „Sziasztok, csak hogy biztos legyek: jöttök a júliusi esküvőre? Köszi!“",
            "2. lépés (5 nappal később, ha még nincs válasz): közvetlen telefon, nem üzenet.",
            "3. lépés (7 nappal később, még mindig csend): tekintsd „nem“-nek és ne ülj rajta.",
          ],
        },
        { type: "h2", text: "Mit kérdezz az RSVP-ben" },
        {
          type: "p",
          text: "Minél kevesebbet. Három mező az ideális: jönnek-e (igen / nem / talán), hány fő, és van-e étrendi megkötés. A „kísérő neve“, a „dalkérés“, és a „mikor érkezel“ mind extra súrlódás, ami csökkenti a válaszadási arányt. Ha ezek fontosak, kérdezd meg egy második körben, csak azoktól, akik már igent mondtak.",
        },
        { type: "h2", text: "Hogyan kezeli ezt a Wēddly" },
        {
          type: "p",
          text: "Minden vendég kap egy személyes RSVP linket. A nevük már ki van töltve, csak rákattintanak és kiválasztják a választ. A státusz élőben jelenik meg a vendéglistátokban, ti pedig egy kattintással kiexportálhatjátok azokat a vendégeket, akiknek még nem volt válasza, hogy SMS-ben utánajárjatok.",
        },
      ],
    },
    en: {
      title: "RSVP deadlines: when to ask, and what to do about silence",
      lead: "Why a four-week deadline outperforms two weeks, and how to chase non-responders politely in three steps.",
      seo_title: "RSVP deadlines and follow-up · Weddly",
      seo_description:
        "When to set your RSVP deadline, why four weeks works better than two, and how to chase the people who didn't reply. Polite, three steps.",
      body: [
        {
          type: "p",
          text: "An RSVP deadline isn't just for the guest, it's for you. Catering will want the final number 14 days out, the venue around 21 days out, seating roughly 28 days out. If your deadline is a single point in time, all three of those handoffs get stressful.",
        },
        { type: "h2", text: "Set a four-week deadline" },
        {
          type: "p",
          text: 'The default tends to be two weeks. That\'s too tight. Asking four weeks out means you\'ve got two weeks to chase the slow responders before finalisation actually bites. Print a concrete date on the invitation, like "Please reply by July 12, 2026". A date works better than "four weeks before".',
        },
        { type: "h2", text: "Chase in three steps" },
        {
          type: "ul",
          items: [
            'Step 1 (3 days past deadline): short template SMS. "Hi, just confirming: are you coming to the July wedding? Thanks!"',
            "Step 2 (5 days later, still nothing): direct phone call, not a message.",
            "Step 3 (7 days later, silence): treat as a no and move on.",
          ],
        },
        { type: "h2", text: "Keep the form short" },
        {
          type: "p",
          text: 'The fewer fields, the higher the response rate. Three is the sweet spot: are you coming (yes / no / maybe), how many of you, any dietary needs. "Plus-one\'s name", "song request" and "arrival time" all add friction and lower the reply rate. Ask those in a second round, only of the people who already said yes.',
        },
        { type: "h2", text: "How Weddly handles this" },
        {
          type: "p",
          text: "Each guest gets a personal RSVP link with their name pre-filled. They tap once and pick a reply. Status updates live in your guest list, and you can export the no-reply rows with one click so the SMS chase is straightforward.",
        },
      ],
    },
  },
];
