// Blog post shapes shared between the React frontend and the backend's
// SSR meta builder. The live source of truth is the `blog_posts` SQLite
// table; the `SEED_BLOG_POSTS` array below is consumed by the slug-level
// seeder in `domain/blog.ts`, which inserts any missing seed slug on
// every boot so new content reaches production without a manual migration.

import type { SeoLocale } from "./seo_routes";

export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "cta"; lead: string; href: string; label: string };

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
  // ── 1. Költségvetés ────────────────────────────────────────────────
  {
    slug: "eskuvoi-koltsegvetes-keszitese",
    published_at: "2026-05-26",
    read_minutes: 6,
    category: { hu: "Költségvetés", en: "Budget" },
    hu: {
      title: "Esküvői költségvetés készítése: így marad átlátható minden döntés",
      lead: "Hogyan osszátok fel a keretet, hogyan számoljatok vendégszámmal, és hogyan kerülhetitek el a túlköltést.",
      seo_title: "Esküvői költségvetés készítése · Wēddly",
      seo_description:
        "Esküvői költségvetés egyszerűen: mutatjuk, hogyan osszátok fel a keretet, hogyan számoljatok vendégszámmal, és hogyan kerülhetitek el a túlköltést.",
      body: [
        {
          type: "p",
          text: "Az esküvőszervezés egyik legnehezebb része nem az, hogy mit szeretnétek, hanem az, hogy mi fér bele a keretbe. A helyszín, a vacsora, a dekor, a ruha, a fotós, a zene és az apró nyomtatványok külön-külön még kezelhetőnek tűnnek, együtt viszont gyorsan széteshet a kép.",
        },
        {
          type: "p",
          text: "Ezért érdemes az esküvői költségvetést nem egy egyszer kitöltött táblázatként kezelni, hanem élő tervként. Ha változik a vendégszám, a menü vagy a helyszín ára, a teljes költségvetésnek is frissülnie kell.",
        },
        { type: "h2", text: "1. Először a teljes keretet határozzátok meg" },
        {
          type: "p",
          text: "Ne kategóriákkal kezdjetek. Először azt beszéljétek meg, mennyi az a teljes összeg, amit nyugodt szívvel rá tudtok szánni az esküvőre.",
        },
        { type: "p", text: "Ezután osszátok fel a keretet főbb kategóriákra:" },
        {
          type: "ul",
          items: [
            "helyszín",
            "catering és italok",
            "fotó és videó",
            "dekor",
            "ruha és öltöny",
            "zene",
            "meghívók és nyomtatványok",
            "tartalék",
          ],
        },
        {
          type: "p",
          text: "A tartalékot ne hagyjátok ki. Egy esküvőnél szinte mindig lesz olyan költség, amire az elején nem gondoltatok.",
        },
        { type: "h2", text: "2. A vendégszám mindenre hatással van" },
        {
          type: "p",
          text: "A vendégszám nemcsak a vacsora árát befolyásolja. Hatással van az italokra, az asztalok számára, az ültetési rendre, a nyomtatványokra, a köszönőajándékokra és sokszor még a helyszín minimum fogyasztására is.",
        },
        { type: "p", text: "Ezért nem elég annyit írni, hogy „kb. 90 fő“. Érdemes több verzióval számolni:" },
        {
          type: "ul",
          items: ["szűk esküvő: 50 fő", "közepes esküvő: 80 fő", "nagyobb esküvő: 120 fő"],
        },
        { type: "p", text: "Így hamar látszik, melyik forgatókönyv fér bele kényelmesen." },
        { type: "h2", text: "3. Ne csak a végösszeget nézzétek" },
        {
          type: "p",
          text: "Sok pár csak azt figyeli, hogy a teljes költségvetés még belefér-e. Ennél hasznosabb, ha kategóriánként is látjátok, hol van túlköltés.",
        },
        {
          type: "p",
          text: "Lehet, hogy összességében még rendben vagytok, de a dekor már elvitte a fotósra szánt keret egy részét. Ilyenkor jobb korán dönteni, mint az esküvő előtti hetekben kapkodni.",
        },
        { type: "h2", text: "4. A költségvetés legyen közös" },
        {
          type: "p",
          text: "Ha az egyikőtök egy táblázatot frissít, a másik pedig régi számokat néz, abból könnyen félreértés lesz. A közös esküvőszervezéshez közös, mindig friss költségvetés kell.",
        },
        {
          type: "p",
          text: "A Wēddly-ben a költségvetés, a vendéglista és az ültetés egy helyen él, így ha változik a vendégszám, a kapcsolódó döntések is könnyebben átláthatók.",
        },
        { type: "h2", text: "Rövid checklist" },
        {
          type: "ul",
          items: [
            "Legyen teljes esküvői keret.",
            "Legyen kategóriánkénti bontás.",
            "Számoljatok több vendégszám-verzióval.",
            "Tegyetek félre tartalékot.",
            "Mindketten ugyanazt az aktuális verziót nézzétek.",
          ],
        },
        {
          type: "cta",
          lead: "Szeretnétek átláthatóbban kezelni az esküvői költségvetést? A Wēddly-ben egy helyen él a költségvetés, vendéglista, RSVP és ültetés.",
          href: "/signup",
          label: "Ingyenes próba indítása",
        },
      ],
    },
    en: {
      title: "How to build a wedding budget that stays under control",
      lead: "How to set the total, how to plan for guest count, and how to avoid quietly overspending.",
      seo_title: "How to build a wedding budget · Weddly",
      seo_description:
        "Practical guide to wedding budgeting: how to set the total, allocate by category, plan for guest count, and avoid quiet overspend.",
      body: [
        {
          type: "p",
          text: "The hardest part of wedding planning isn't deciding what you want. It's keeping it inside the budget. Venue, catering, decor, attire, photo, music and stationery look manageable on their own, but they add up fast.",
        },
        {
          type: "p",
          text: "Treat the budget as a living plan, not a one-time spreadsheet. When guest count, menu or venue pricing changes, the whole budget needs to follow.",
        },
        { type: "h2", text: "1. Start with the total" },
        {
          type: "p",
          text: "Don't start with categories. First agree on the total amount you can comfortably commit to the wedding.",
        },
        { type: "p", text: "Then split it across the main categories:" },
        {
          type: "ul",
          items: [
            "venue",
            "catering and drinks",
            "photo and video",
            "decor",
            "attire",
            "music",
            "invitations and stationery",
            "reserve",
          ],
        },
        {
          type: "p",
          text: "Don't skip the reserve. Almost every wedding picks up a cost that wasn't on the original list.",
        },
        { type: "h2", text: "2. Guest count drives everything" },
        {
          type: "p",
          text: "Guest count doesn't just change the catering line. It moves drinks, table count, seating, stationery, favours, and often the venue minimum spend.",
        },
        { type: "p", text: "\"About 90 guests\" isn't enough. Plan against several scenarios:" },
        {
          type: "ul",
          items: [
            "small: 50 guests",
            "medium: 80 guests",
            "larger: 120 guests",
          ],
        },
        { type: "p", text: "It becomes obvious quickly which scenario actually fits the total." },
        { type: "h2", text: "3. Don't only watch the grand total" },
        {
          type: "p",
          text: "Many couples track only whether the total still fits. It's far more useful to see where, by category, you're already over.",
        },
        {
          type: "p",
          text: "You may be on track overall while decor has quietly eaten part of the photo budget. Better to catch it early than scramble in the last weeks.",
        },
        { type: "h2", text: "4. The budget has to be shared" },
        {
          type: "p",
          text: "If one of you updates a spreadsheet and the other is reading old numbers, misunderstandings will follow. Shared planning needs one shared, always-current budget.",
        },
        {
          type: "p",
          text: "In Weddly the budget, guest list and seating live in one workspace, so when guest count moves the connected decisions are easier to keep straight.",
        },
        { type: "h2", text: "Short checklist" },
        {
          type: "ul",
          items: [
            "Agree on a total budget first.",
            "Break it down by category.",
            "Plan against several guest-count scenarios.",
            "Set aside a reserve.",
            "Both of you read the same live version.",
          ],
        },
        {
          type: "cta",
          lead: "Want a more transparent wedding budget? In Weddly the budget, guest list, RSVP and seating live in one shared workspace.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },
  // ── 2. Vendéglista ─────────────────────────────────────────────────
  {
    slug: "eskuvoi-vendeglista-keszitese",
    published_at: "2026-05-19",
    read_minutes: 6,
    category: { hu: "Vendéglista", en: "Guest list" },
    hu: {
      title: "Esküvői vendéglista készítése: hogyan legyen végre átlátható?",
      lead: "Így gyűjtsétek össze a neveket, plus one-okat, RSVP válaszokat, ételválasztásokat és speciális igényeket egy helyre.",
      seo_title: "Esküvői vendéglista készítése · Wēddly",
      seo_description:
        "Esküvői vendéglista stressz nélkül: így gyűjtsétek össze a neveket, plus one-okat, RSVP válaszokat, ételválasztásokat és speciális igényeket.",
      body: [
        {
          type: "p",
          text: "A vendéglista az esküvőszervezés egyik legfontosabb alapja. Mégis sok párnál több táblázatban, jegyzetben és chatüzenetben él egyszerre. Valaki már visszajelzett, valaki még nem. Egy vendég hozna kísérőt, más vegetáriánus menüt kér, a harmadik pedig még nem biztos benne, hogy jön.",
        },
        { type: "p", text: "Ebből lesz az a káosz, amit jobb már az elején megelőzni." },
        { type: "h2", text: "1. Ne csak neveket írjatok össze" },
        { type: "p", text: "Egy jó esküvői vendéglista nemcsak névsor. Minden vendégnél érdemes vezetni:" },
        {
          type: "ul",
          items: [
            "teljes név",
            "meghívási státusz",
            "RSVP válasz",
            "kísérő",
            "ételválasztás",
            "allergia vagy étrendi igény",
            "asztal",
            "megjegyzés",
          ],
        },
        {
          type: "p",
          text: "Így nem az esküvő előtti napokban kell visszakeresni, ki mit írt Messengeren vagy e-mailben.",
        },
        { type: "h2", text: "2. Legyen egyértelmű RSVP folyamat" },
        {
          type: "p",
          text: "A „majd szóban jelzik“ ritkán működik jól. Sokkal egyszerűbb, ha minden vendég kap egy saját RSVP linket, ahol gyorsan vissza tud jelezni.",
        },
        {
          type: "p",
          text: "Egy jó RSVP űrlap nem kér túl sokat, csak azt, amire tényleg szükségetek van:",
        },
        {
          type: "ul",
          items: [
            "jön-e a vendég",
            "hoz-e kísérőt",
            "milyen menüt választ",
            "van-e ételérzékenysége",
            "van-e külön kérése",
          ],
        },
        { type: "p", text: "Minél egyszerűbb a válaszadás, annál hamarabb jönnek be a válaszok." },
        { type: "h2", text: "3. A plus one kérdést korán tisztázzátok" },
        {
          type: "p",
          text: "A kísérők kezelése az egyik leggyakoribb vendéglista-probléma. Érdemes előre eldönteni, kik hozhatnak plus one-t, és ezt következetesen vezetni.",
        },
        {
          type: "p",
          text: "Ez nemcsak költségvetési kérdés, hanem ültetési is. Egy plusz vendég új széket, új menüt, új helyet és néha új asztalkiosztást jelent.",
        },
        { type: "h2", text: "4. Kössetek össze mindent az ültetéssel" },
        {
          type: "p",
          text: "A vendéglista akkor igazán hasznos, ha nem külön életet él az ültetéstől. Ha valaki visszamondja, jelzi a kísérőjét vagy ételérzékenységet ad meg, annak az ültetési rendben is látszania kell.",
        },
        {
          type: "p",
          text: "A Wēddly-ben a vendéglista, RSVP és ültetés egy közös rendszerben van, így nem kell több helyen frissíteni ugyanazt az információt.",
        },
        { type: "h2", text: "Rövid checklist" },
        {
          type: "ul",
          items: [
            "Minden vendéghez legyen státusz.",
            "Külön vezessétek az RSVP választ.",
            "A kísérőket ne utólag találjátok ki.",
            "Gyűjtsétek az ételválasztást és allergiákat.",
            "Az ültetési rend kapcsolódjon a vendéglistához.",
          ],
        },
        {
          type: "cta",
          lead: "A Wēddly segít egy helyen kezelni a vendéglistát, RSVP válaszokat, kísérőket, menüket és ültetést.",
          href: "/signup",
          label: "Kezdjétek el ingyen",
        },
      ],
    },
    en: {
      title: "Building a wedding guest list that actually stays organised",
      lead: "How to collect names, plus-ones, RSVPs, meal choices and dietary needs in one place.",
      seo_title: "Building a wedding guest list · Weddly",
      seo_description:
        "Wedding guest list without stress: how to collect names, plus-ones, RSVPs, meals and dietary needs in one place.",
      body: [
        {
          type: "p",
          text: "The guest list is one of the foundations of planning. For most couples it ends up spread across spreadsheets, notes and chat threads. Someone has replied, someone hasn't. One wants a plus-one, another needs a vegetarian menu, a third still isn't sure.",
        },
        { type: "p", text: "That's the chaos worth preventing from the start." },
        { type: "h2", text: "1. Track more than names" },
        { type: "p", text: "A good guest list isn't a roster. For each guest, keep:" },
        {
          type: "ul",
          items: [
            "full name",
            "invitation status",
            "RSVP reply",
            "plus-one",
            "meal choice",
            "allergies / dietary need",
            "table",
            "notes",
          ],
        },
        {
          type: "p",
          text: "Saves you from digging through Messenger or email in the last week to remember who wrote what.",
        },
        { type: "h2", text: "2. Run a clear RSVP flow" },
        {
          type: "p",
          text: "\"They'll let us know in person\" rarely works. Much easier when every guest has a personal RSVP link they can use in under a minute.",
        },
        { type: "p", text: "A good RSVP form only asks for what you actually need:" },
        {
          type: "ul",
          items: [
            "are you coming",
            "any plus-one",
            "meal choice",
            "dietary need",
            "anything else we should know",
          ],
        },
        { type: "p", text: "The shorter the form, the faster the responses come in." },
        { type: "h2", text: "3. Settle plus-ones early" },
        {
          type: "p",
          text: "Plus-ones are the most common guest-list problem. Decide upfront who can bring one, and apply the rule consistently.",
        },
        {
          type: "p",
          text: "It's not just a budget question. Every plus-one is another seat, meal, sometimes another table arrangement.",
        },
        { type: "h2", text: "4. Connect it to the seating" },
        {
          type: "p",
          text: "Guest list information is most useful when it isn't separate from seating. If someone cancels, adds a plus-one or names a dietary need, the seating chart should reflect it.",
        },
        {
          type: "p",
          text: "In Weddly the guest list, RSVP and seating share one workspace, so you don't update the same information in three places.",
        },
        { type: "h2", text: "Short checklist" },
        {
          type: "ul",
          items: [
            "Status for every guest.",
            "Track the RSVP reply separately.",
            "Decide plus-ones early.",
            "Collect meals and allergies in the same flow.",
            "Connect seating to the guest list.",
          ],
        },
        {
          type: "cta",
          lead: "Weddly keeps the guest list, RSVPs, plus-ones, meals and seating in one workspace.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },
  // ── 3. Ültetési rend ───────────────────────────────────────────────
  {
    slug: "eskuvoi-ultetesi-rend-keszitese",
    published_at: "2026-05-12",
    read_minutes: 5,
    category: { hu: "Ültetés", en: "Seating" },
    hu: {
      title: "Esküvői ültetési rend készítése: hogyan legyen logikus és nyomtatható?",
      lead: "Mire figyeljetek családoknál, barátoknál, gyerekeknél és nyomtatásnál.",
      seo_title: "Esküvői ültetési rend készítése · Wēddly",
      seo_description:
        "Esküvői ültetési rend egyszerűen: hogyan osszátok be a vendégeket, mire figyeljetek családoknál, barátoknál, gyerekeknél és nyomtatásnál.",
      body: [
        {
          type: "p",
          text: "Az ültetési rend sokszor csak az esküvő előtti hetekben kerül elő, pedig rengeteg döntést befolyásol. Ki ül a főasztalnál? Hová kerülnek a családok? Üljenek együtt a barátok? Mi legyen azokkal, akik senkit nem ismernek?",
        },
        {
          type: "p",
          text: "Egy jó ültetési rend nemcsak szép, hanem praktikus is. Segít a vendégeknek, a helyszínnek, a cateringnek és nektek is.",
        },
        { type: "h2", text: "1. Ne kezdjétek túl korán véglegesíteni" },
        {
          type: "p",
          text: "Az ültetési rendet lehet korán tervezni, de ne tekintsétek véglegesnek, amíg nincs elég RSVP válasz. Ha sok a bizonytalan vendég, az ültetés is sokszor fog változni.",
        },
        { type: "p", text: "Érdemes először asztalcsoportokban gondolkodni:" },
        {
          type: "ul",
          items: [
            "közeli család",
            "tágabb család",
            "barátok",
            "kollégák",
            "gyerekes családok",
            "idősebb vendégek",
          ],
        },
        { type: "p", text: "Ezután jöhet a pontos székek kiosztása." },
        { type: "h2", text: "2. Vegyétek figyelembe a helyszín logikáját" },
        {
          type: "p",
          text: "Nem mindegy, hol van a tánctér, a kijárat, a mosdó, a büfé vagy a zenekar. Az idősebb vendégeknek kényelmesebb lehet egy nyugodtabb asztal. A baráti társaságoknak jobb lehet a tánctér közelében.",
        },
        { type: "p", text: "A jó ültetési rend nemcsak embereket párosít, hanem a térrel is számol." },
        { type: "h2", text: "3. Legyen nyomtatható verzió" },
        { type: "p", text: "Az ültetési rend nem ér véget a képernyőn. Szükség lehet:" },
        {
          type: "ul",
          items: [
            "nagy ültetési táblára a bejárathoz",
            "asztalszámokra",
            "ültetőkártyákra",
            "catering-listára",
            "helyszíni segítői verzióra",
          ],
        },
        { type: "p", text: "Ezért fontos, hogy az ültetési rend exportálható és nyomdakész legyen." },
        { type: "h2", text: "4. Készüljetek az utolsó pillanatos változásokra" },
        {
          type: "p",
          text: "Szinte mindig lesz valaki, aki az utolsó héten mondja le, vagy akkor jelzi, hogy mégis jönne. Ha az ültetés kézzel rajzolt PDF-ekben él, minden változás fájdalmas.",
        },
        {
          type: "p",
          text: "A Wēddly vizuális ültetési felületén könnyebb mozgatni a vendégeket, majd A4, A6 vagy A3 formátumban nyomtatható anyagot készíteni.",
        },
        { type: "h2", text: "Rövid checklist" },
        {
          type: "ul",
          items: [
            "Először csoportokban gondolkodjatok.",
            "Az RSVP válaszok után véglegesítsetek.",
            "Vegyétek figyelembe a helyszín adottságait.",
            "Készítsetek nyomtatható verziót.",
            "Hagyjatok mozgásteret az utolsó módosításokra.",
          ],
        },
        {
          type: "cta",
          lead: "A Wēddly-ben vizuálisan készíthettek ültetési rendet, mozgathatjátok a vendégeket, és nyomtatható verziót exportálhattok.",
          href: "/signup",
          label: "Próbáljátok ki ingyen",
        },
      ],
    },
    en: {
      title: "Designing a wedding seating chart that is logical and printable",
      lead: "What to watch for with families, friends, kids and printing.",
      seo_title: "Wedding seating chart design · Weddly",
      seo_description:
        "How to plan a seating chart that handles family, friends, kids and last-minute changes, and prints cleanly.",
      body: [
        {
          type: "p",
          text: "The seating chart usually shows up in the last few weeks before the wedding, even though it shapes many decisions. Who sits at the head table? Where do families go? Should friend groups stay together? What about guests who don't know anyone?",
        },
        {
          type: "p",
          text: "A good seating chart is not only nice, it's practical. It helps your guests, the venue, the caterer and you.",
        },
        { type: "h2", text: "1. Don't lock it in too early" },
        {
          type: "p",
          text: "Plan early, but don't treat it as final until enough RSVPs are in. If many guests are uncertain, the chart will change repeatedly.",
        },
        { type: "p", text: "Start with table-level groups:" },
        {
          type: "ul",
          items: [
            "close family",
            "extended family",
            "friends",
            "colleagues",
            "families with kids",
            "older guests",
          ],
        },
        { type: "p", text: "Once those are stable, do the exact seat assignments." },
        { type: "h2", text: "2. Respect the venue layout" },
        {
          type: "p",
          text: "Position matters: the dance floor, the bar, the entrance, the band. Older guests prefer quieter corners. Friend groups belong near the dance floor.",
        },
        { type: "p", text: "Good seating doesn't only pair people; it accounts for the space." },
        { type: "h2", text: "3. Get the printable version right" },
        { type: "p", text: "Seating doesn't end on screen. You'll likely need:" },
        {
          type: "ul",
          items: [
            "a large entrance display",
            "table numbers",
            "place cards",
            "a caterer-friendly list",
            "a runner copy for on-the-day staff",
          ],
        },
        { type: "p", text: "So the chart has to export cleanly and at print sizes." },
        { type: "h2", text: "4. Plan for last-minute changes" },
        {
          type: "p",
          text: "Someone always cancels in the final week, or confirms after being unsure. If the chart only lives in a hand-drawn PDF, every change is painful.",
        },
        {
          type: "p",
          text: "Weddly's visual seating canvas lets you move guests easily, then export to A4, A6 or A3 for print.",
        },
        { type: "h2", text: "Short checklist" },
        {
          type: "ul",
          items: [
            "Group first, seat second.",
            "Finalise after RSVPs settle.",
            "Use the venue layout.",
            "Plan the printable output.",
            "Leave room for late changes.",
          ],
        },
        {
          type: "cta",
          lead: "Plan your seating visually in Weddly and export to A4 / A6 / A3 for the entrance display, place cards and the coordinator binder.",
          href: "/signup",
          label: "Try it free",
        },
      ],
    },
  },
  // ── 4. RSVP ────────────────────────────────────────────────────────
  {
    slug: "eskuvoi-rsvp-kerdesek",
    published_at: "2026-05-05",
    read_minutes: 5,
    category: { hu: "RSVP", en: "RSVP" },
    hu: {
      title: "Esküvői RSVP: mit kérdezzetek a vendégektől, hogy ne legyen káosz?",
      lead: "Milyen kérdések kerüljenek a visszajelző űrlapra, hogy egyszerű legyen a vendégeknek és hasznos nektek.",
      seo_title: "Esküvői RSVP kérdések · Wēddly",
      seo_description:
        "Esküvői RSVP útmutató pároknak: milyen kérdések kerüljenek a visszajelző űrlapra, hogy egyszerű legyen a vendégeknek és hasznos nektek.",
      body: [
        {
          type: "p",
          text: "Az RSVP célja egyszerű: tudni szeretnétek, ki jön az esküvőre. A gyakorlatban viszont ennél sokkal többről van szó. A válaszokból derül ki a végleges vendégszám, a menüigény, a kísérők száma és sok apró részlet, ami a szervezéshez kell.",
        },
        {
          type: "p",
          text: "A legjobb RSVP űrlap rövid, mobilon is könnyen kitölthető, és csak olyan kérdéseket tartalmaz, amelyekkel tényleg kezdeni fogtok valamit.",
        },
        { type: "h2", text: "1. A legfontosabb kérdés: jössz vagy nem?" },
        {
          type: "p",
          text: "Ez legyen az első. Ne rejtőzzön hosszú szöveg vagy sok mező mögé. A vendég azonnal értse, hogy visszajelzést kértek.",
        },
        { type: "p", text: "Példa: „Részt tudsz venni az esküvőnkön?“" },
        {
          type: "ul",
          items: ["Igen, ott leszek.", "Sajnos nem tudok menni."],
        },
        { type: "h2", text: "2. Kísérő kérdése" },
        {
          type: "p",
          text: "Ha engedtek kísérőt, az RSVP-ben legyen egyértelműen kezelve. Ha nem mindenki hozhat plus one-t, akkor személyre szabott RSVP linkkel elkerülhető a félreértés.",
        },
        { type: "p", text: "Példa: „Kísérővel érkezel?“" },
        { type: "h2", text: "3. Menü és ételérzékenység" },
        {
          type: "p",
          text: "A catering miatt ezt időben érdemes bekérni. Kérdezzetek rá az ételválasztásra és a speciális igényekre is.",
        },
        { type: "p", text: "Példa: „Van ételérzékenységed vagy speciális étrended?“" },
        {
          type: "p",
          text: "Itt jó, ha van szabad szöveges mező is, mert nem minden igény fér bele előre megadott opciókba.",
        },
        { type: "h2", text: "4. Extra kérdések, amelyek hasznosak lehetnek" },
        { type: "p", text: "Nem kell túlzásba vinni, de néhány extra kérdés sokat segíthet:" },
        {
          type: "ul",
          items: [
            "Kérsz transzfert?",
            "Szükséged van szállásinformációra?",
            "Melyik zenét hallanád szívesen a buliban?",
            "Van bármi, amit jó, ha előre tudunk?",
          ],
        },
        { type: "h2", text: "5. Ne kérjetek túl sokat" },
        {
          type: "p",
          text: "Ha az RSVP túl hosszú, a vendégek halogatni fogják. A cél az, hogy egy perc alatt kitölthető legyen.",
        },
        {
          type: "p",
          text: "A Wēddly-ben minden vendég saját RSVP linket kaphat, a válaszok pedig automatikusan bekerülnek a vendéglistába.",
        },
        {
          type: "cta",
          lead: "Készítsetek egyszerű RSVP folyamatot a Wēddly-ben, és gyűjtsétek egy helyre a válaszokat, menüket, kísérőket és megjegyzéseket.",
          href: "/signup",
          label: "Indítsátok el ingyen",
        },
      ],
    },
    en: {
      title: "Wedding RSVP: what to ask guests so the responses stay manageable",
      lead: "Which questions to put on the reply form so it's easy for guests and useful for you.",
      seo_title: "Wedding RSVP questions · Weddly",
      seo_description:
        "Wedding RSVP guide: which questions to ask, why fewer fields produce higher response rates, and how to use what you collect.",
      body: [
        {
          type: "p",
          text: "RSVP looks simple: you want to know who's coming. In practice the replies carry the final headcount, meal choices, plus-one count and a handful of details you'll need across the rest of planning.",
        },
        {
          type: "p",
          text: "The best RSVP form is short, mobile-friendly, and only asks what you'll actually use.",
        },
        { type: "h2", text: "1. Coming or not?" },
        {
          type: "p",
          text: "Put this first. Don't bury it under a long preamble. The guest should see immediately what's being asked.",
        },
        { type: "p", text: "Example: \"Can you join us?\"" },
        { type: "ul", items: ["Yes, I'll be there.", "Sadly I can't make it."] },
        { type: "h2", text: "2. Plus-one" },
        {
          type: "p",
          text: "If you allow plus-ones, the RSVP has to handle it cleanly. If not everyone gets one, per-guest links prevent the awkward case.",
        },
        { type: "p", text: "Example: \"Bringing a plus-one?\"" },
        { type: "h2", text: "3. Meal and dietary needs" },
        {
          type: "p",
          text: "Catering needs this early. Ask for meal choice and dietary requirements together.",
        },
        { type: "p", text: "Example: \"Any dietary needs or restrictions?\"" },
        { type: "p", text: "Leave a free-text field — not every need fits a preset option." },
        { type: "h2", text: "4. Optional extras" },
        { type: "p", text: "Don't overdo it, but a few extras can be useful:" },
        {
          type: "ul",
          items: [
            "Do you need transport?",
            "Do you need accommodation info?",
            "Any song requests?",
            "Anything else we should know in advance?",
          ],
        },
        { type: "h2", text: "5. Don't ask too much" },
        {
          type: "p",
          text: "Long RSVPs get postponed. Aim for under a minute to complete.",
        },
        {
          type: "p",
          text: "In Weddly every guest gets a personal RSVP link, and the replies flow straight into the guest list.",
        },
        {
          type: "cta",
          lead: "Set up a simple RSVP flow in Weddly and collect every reply, meal, plus-one and note in one place.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },
  // ── 5. 12-month checklist ──────────────────────────────────────────
  {
    slug: "eskuvoszervezesi-checklist-12-honapra",
    published_at: "2026-04-28",
    read_minutes: 7,
    category: { hu: "Tervezés", en: "Planning" },
    hu: {
      title: "Esküvőszervezési checklist 12 hónapra: mit mikor intézzetek?",
      lead: "Lépésről lépésre mutatjuk, mit érdemes intézni egy évvel, fél évvel és egy hónappal az esküvő előtt.",
      seo_title: "Esküvőszervezési checklist 12 hónapra · Wēddly",
      seo_description:
        "Esküvőszervezési checklist 12 hónapra: lépésről lépésre mutatjuk, mit érdemes intézni egy évvel, fél évvel és egy hónappal az esküvő előtt.",
      body: [
        {
          type: "p",
          text: "Az esküvőszervezés akkor tűnik ijesztőnek, ha minden egyszerre szakad rátok. Helyszín, vendéglista, fotós, zene, meghívó, ruha, ültetés, menü, dekor, nyomtatványok. Könnyű elveszni benne.",
        },
        {
          type: "p",
          text: "A jó hír az, hogy nem mindent kell egyszerre megoldani. Ha időrendben haladtok, sokkal nyugodtabb lesz az egész folyamat.",
        },
        { type: "h2", text: "12 hónappal az esküvő előtt" },
        { type: "p", text: "Ebben az időszakban a nagy döntéseket érdemes meghozni." },
        {
          type: "ul",
          items: [
            "dátum kiválasztása",
            "esküvői stílus meghatározása",
            "nagyságrendi költségvetés",
            "várható vendégszám",
            "helyszínkeresés",
            "fő szolgáltatók felkutatása",
          ],
        },
        {
          type: "p",
          text: "Ilyenkor még nem kell minden részletet tudnotok, de a keretek legyenek világosak.",
        },
        { type: "h2", text: "9 hónappal az esküvő előtt" },
        { type: "p", text: "Ekkor már érdemes elkezdeni konkrétan foglalni." },
        {
          type: "ul",
          items: [
            "helyszín véglegesítése",
            "fotós / videós kiválasztása",
            "zenekar vagy DJ lefoglalása",
            "ceremóniamester vagy vőfély keresése",
            "vendéglista első verziója",
            "esküvői weboldal vagy RSVP folyamat előkészítése",
          ],
        },
        { type: "p", text: "A vendéglista ilyenkor még változhat, de legyen egy első verzió, amivel számolni tudtok." },
        { type: "h2", text: "6 hónappal az esküvő előtt" },
        { type: "p", text: "Itt jönnek a részletek." },
        {
          type: "ul",
          items: [
            "meghívók előkészítése",
            "RSVP határidő meghatározása",
            "dekorációs irány véglegesítése",
            "ruha és öltöny intézése",
            "menüajánlatok egyeztetése",
            "szállás és transzfer átgondolása",
          ],
        },
        {
          type: "p",
          text: "Ekkor már jó, ha a költségvetés nem csak becslés, hanem tényleges ajánlatok alapján frissül.",
        },
        { type: "h2", text: "3 hónappal az esküvő előtt" },
        { type: "p", text: "Most már a válaszok és a pontosítások időszaka jön." },
        {
          type: "ul",
          items: [
            "RSVP válaszok követése",
            "vendéglista frissítése",
            "menüválasztások gyűjtése",
            "szolgáltatói részletek véglegesítése",
            "első ültetési verzió elkészítése",
            "nyomtatványok megtervezése",
          ],
        },
        {
          type: "p",
          text: "Ha ekkor még minden külön táblázatban van, nagyon könnyű hibázni. Érdemes egy közös rendszerben vezetni az adatokat.",
        },
        { type: "h2", text: "1 hónappal az esküvő előtt" },
        { type: "p", text: "Ez már a véglegesítés időszaka." },
        {
          type: "ul",
          items: [
            "végleges vendégszám leadása",
            "ültetési rend véglegesítése",
            "asztalszámok és ültetőkártyák nyomtatása",
            "szolgáltatói időrend egyeztetése",
            "fizetési határidők ellenőrzése",
            "napi forgatókönyv elkészítése",
          ],
        },
        {
          type: "p",
          text: "Ebben a hónapban már nem az új ötletek a legfontosabbak, hanem az, hogy mindenki ugyanazt az aktuális információt lássa.",
        },
        { type: "h2", text: "1 héttel az esküvő előtt" },
        { type: "p", text: "Itt már csak a finomhangolás maradjon." },
        {
          type: "ul",
          items: [
            "utolsó vendégváltozások kezelése",
            "nyomtatott anyagok ellenőrzése",
            "szolgáltatók visszaigazolása",
            "vészcsomag összeállítása",
            "pihenés",
          ],
        },
        {
          type: "p",
          text: "Igen, a pihenés is teendő. Az esküvő nem projektzáró prezentáció, hanem egy közös nap, amit meg kell élni.",
        },
        { type: "h2", text: "Rövid összefoglaló" },
        {
          type: "p",
          text: "Az esküvőszervezés akkor lesz kezelhető, ha nem egyszerre próbáltok mindent megoldani. Legyen egy közös checklist, egy friss vendéglista, egy élő költségvetés és egy olyan rendszer, ahol mindketten ugyanazt látjátok.",
        },
        {
          type: "cta",
          lead: "A Wēddly segít egy helyen tartani a költségvetést, vendéglistát, RSVP válaszokat és ültetési rendet, hogy ne külön táblázatokból kelljen szerveznetek az esküvőt.",
          href: "/signup",
          label: "Tegyétek a helyére ingyen",
        },
        { type: "h2", text: "GYIK" },
        { type: "h3", text: "Mikor érdemes elkezdeni az esküvőszervezést?" },
        {
          type: "p",
          text: "Ideálisan 9-12 hónappal az esküvő előtt, de kisebb esküvőnél rövidebb idő is elég lehet.",
        },
        { type: "h3", text: "Mikor kell kiküldeni a meghívókat?" },
        {
          type: "p",
          text: "Általában 3-6 hónappal az esküvő előtt érdemes, attól függően, mennyi vendég utazik messzebbről.",
        },
        { type: "h3", text: "Mikor legyen végleges az ültetési rend?" },
        {
          type: "p",
          text: "A végleges RSVP válaszok után, jellemzően az esküvő előtti 2-4 hétben.",
        },
      ],
    },
    en: {
      title: "12-month wedding planning checklist: what to handle, when",
      lead: "Step by step: what to lock in a year, six months and a month before the wedding.",
      seo_title: "12-month wedding planning checklist · Weddly",
      seo_description:
        "A practical 12-month wedding planning checklist: what to handle a year, nine months, six, three, one month, and one week out.",
      body: [
        {
          type: "p",
          text: "Wedding planning only feels overwhelming when everything lands on you at once. Venue, guest list, photo, music, invites, attire, seating, menu, decor, stationery. It's easy to lose track.",
        },
        {
          type: "p",
          text: "The good news: it doesn't have to be solved in one go. Working in time-ordered phases makes it much calmer.",
        },
        { type: "h2", text: "12 months out" },
        { type: "p", text: "This is the period for the big decisions." },
        {
          type: "ul",
          items: [
            "pick the date",
            "decide the style",
            "draft a rough budget",
            "estimate guest count",
            "search for venues",
            "shortlist key vendors",
          ],
        },
        {
          type: "p",
          text: "You don't need every detail yet, just clear boundaries.",
        },
        { type: "h2", text: "9 months out" },
        { type: "p", text: "Time to start booking." },
        {
          type: "ul",
          items: [
            "venue contract",
            "photo / video",
            "band or DJ",
            "officiant / MC",
            "first guest-list draft",
            "wedding website or RSVP flow",
          ],
        },
        { type: "p", text: "The guest list will still move, but get a first version on paper." },
        { type: "h2", text: "6 months out" },
        { type: "p", text: "Now the details." },
        {
          type: "ul",
          items: [
            "invitation design",
            "RSVP deadline",
            "decor direction",
            "attire",
            "menu quotes",
            "accommodation / transport plan",
          ],
        },
        {
          type: "p",
          text: "By now your budget should be updating from real quotes, not just estimates.",
        },
        { type: "h2", text: "3 months out" },
        { type: "p", text: "Replies and refinements." },
        {
          type: "ul",
          items: [
            "track RSVPs",
            "update the guest list",
            "collect meal choices",
            "finalise vendor details",
            "first seating draft",
            "design the printed pieces",
          ],
        },
        {
          type: "p",
          text: "If everything still lives in separate spreadsheets it's easy to drop information. Keep it in one shared system.",
        },
        { type: "h2", text: "1 month out" },
        { type: "p", text: "Finalisation phase." },
        {
          type: "ul",
          items: [
            "submit final headcount",
            "lock the seating chart",
            "print table numbers and place cards",
            "vendor run-of-show",
            "check payment deadlines",
            "build the day-of timeline",
          ],
        },
        {
          type: "p",
          text: "Less about new ideas, more about everyone reading the same current information.",
        },
        { type: "h2", text: "1 week out" },
        { type: "p", text: "Only fine-tuning left." },
        {
          type: "ul",
          items: [
            "handle last guest changes",
            "review printed pieces",
            "vendor confirmations",
            "pack the emergency kit",
            "rest",
          ],
        },
        {
          type: "p",
          text: "Yes, rest is on the list. A wedding isn't a project closeout, it's a day you have to live in.",
        },
        { type: "h2", text: "Summary" },
        {
          type: "p",
          text: "Planning becomes manageable when you don't try to solve everything at once. Keep a shared checklist, a fresh guest list, a live budget, and one place where both of you see the same picture.",
        },
        {
          type: "cta",
          lead: "Weddly keeps your budget, guest list, RSVPs and seating chart together, so you don't have to plan from disconnected spreadsheets.",
          href: "/signup",
          label: "Set it up for free",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "When should we start planning the wedding?" },
        {
          type: "p",
          text: "Ideally 9-12 months out. Smaller weddings can be planned faster.",
        },
        { type: "h3", text: "When should invitations go out?" },
        {
          type: "p",
          text: "Usually 3-6 months before the wedding, depending on how many guests travel.",
        },
        { type: "h3", text: "When should the seating chart be final?" },
        {
          type: "p",
          text: "After the final RSVPs, typically 2-4 weeks before the wedding.",
        },
      ],
    },
  },
  // ── 6. Digital vs paper invitation ─────────────────────────────────
  {
    slug: "digitalis-eskuvoi-meghivo-vagy-papir-meghivo",
    published_at: "2026-04-21",
    read_minutes: 6,
    category: { hu: "Meghívók", en: "Invitations" },
    hu: {
      title: "Digitális esküvői meghívó vagy papír meghívó: melyiket válasszátok?",
      lead: "Az előnyök, hátrányok, költségek és az RSVP folyamat összehasonlítása.",
      seo_title: "Digitális vagy papír esküvői meghívó · Wēddly",
      seo_description:
        "Digitális vagy papír esküvői meghívó? Összehasonlítjuk az előnyöket, hátrányokat, költségeket és azt, hogyan kapcsolódik az RSVP folyamatba.",
      body: [
        {
          type: "p",
          text: "Az esküvői meghívó az első dolog, amivel a vendégek találkoznak. Megadja az esküvő hangulatát, stílusát és a legfontosabb információkat. Ma már nem csak az a kérdés, milyen papírra készüljön, hanem az is, hogy kell-e egyáltalán papír.",
        },
        {
          type: "p",
          text: "A digitális meghívó és a klasszikus papír meghívó nem feltétlenül egymás ellentétei. Sok párnak a kettő kombinációja működik a legjobban.",
        },
        { type: "h2", text: "Papír meghívó: mikor jó választás?" },
        {
          type: "p",
          text: "A papír meghívó személyes, elegáns és kézzelfogható. Különösen akkor jó, ha fontos nektek a klasszikus esküvői élmény, vagy ha sok idősebb vendégetek van, akik jobban szeretik a hagyományos formát.",
        },
        { type: "p", text: "Előnyei:" },
        {
          type: "ul",
          items: [
            "szép emlék marad",
            "elegáns és ünnepélyes",
            "jól illik klasszikus esküvőkhöz",
            "személyesebbnek érződik",
          ],
        },
        { type: "p", text: "Hátrányai:" },
        {
          type: "ul",
          items: [
            "drágább lehet",
            "nyomtatási és postázási idővel kell számolni",
            "változás esetén nehéz frissíteni",
            "az RSVP-t külön kell kezelni",
          ],
        },
        { type: "h2", text: "Digitális meghívó: mikor praktikusabb?" },
        {
          type: "p",
          text: "A digitális meghívó gyors, könnyen frissíthető és jól kapcsolható RSVP rendszerhez. Ha változik az időpont, helyszín, menüinformáció vagy program, nem kell újranyomtatni semmit.",
        },
        { type: "p", text: "Előnyei:" },
        {
          type: "ul",
          items: [
            "gyorsan elküldhető",
            "mobilon könnyen megnyitható",
            "összeköthető RSVP-vel",
            "frissíthető információkkal",
            "költséghatékony",
          ],
        },
        { type: "p", text: "Hátrányai:" },
        {
          type: "ul",
          items: [
            "kevésbé ünnepélyesnek tűnhet",
            "nem minden vendég szereti",
            "figyelni kell arra, hogy ne vesszen el az üzenetek között",
          ],
        },
        { type: "h2", text: "A legjobb megoldás sokszor a kombináció" },
        {
          type: "p",
          text: "Sok pár úgy dönt, hogy a közeli családnak és néhány fontos vendégnek papír meghívót ad, míg a többi vendég digitális meghívót vagy RSVP linket kap.",
        },
        {
          type: "p",
          text: "Ez különösen praktikus, ha szeretnétek megőrizni az elegáns meghívó élményét, de közben nem akartok minden választ kézzel követni.",
        },
        { type: "h2", text: "Mire figyeljetek digitális meghívónál?" },
        { type: "p", text: "Egy jó digitális meghívó nem csak szép, hanem hasznos is. Tartalmazza:" },
        {
          type: "ul",
          items: [
            "a neveteket",
            "az esküvő dátumát",
            "helyszínt és címet",
            "programot",
            "dress code-ot, ha van",
            "RSVP határidőt",
            "menü- vagy allergiakérdéseket",
            "kapcsolattartási információt",
          ],
        },
        { type: "p", text: "A legfontosabb: a vendég tudja gyorsan jelezni, hogy jön-e." },
        { type: "h2", text: "Hogyan kapcsolódik ide az RSVP?" },
        {
          type: "p",
          text: "A digitális meghívó legnagyobb előnye, hogy azonnal összekapcsolható a visszajelzéssel. Nem kell külön üzeneteket, hívásokat és táblázatokat kezelni.",
        },
        {
          type: "p",
          text: "A vendég megnyitja a linket, válaszol néhány kérdésre, ti pedig látjátok a vendéglistában az aktuális státuszt.",
        },
        { type: "h2", text: "Rövid döntési segédlet" },
        { type: "h3", text: "Válasszatok papír meghívót, ha…" },
        {
          type: "ul",
          items: [
            "fontos az elegáns, klasszikus élmény",
            "sok idősebb vendégetek van",
            "szeretnétek kézzelfogható emléket",
          ],
        },
        { type: "h3", text: "Válasszatok digitális meghívót, ha…" },
        {
          type: "ul",
          items: [
            "gyors, praktikus megoldást szeretnétek",
            "sok adatot kell gyűjteni",
            "fontos az RSVP automatizálása",
            "szeretnétek csökkenteni a költségeket",
          ],
        },
        { type: "h3", text: "Válasszatok kombinált megoldást, ha…" },
        {
          type: "ul",
          items: [
            "szeretnétek szépet és praktikusat is",
            "a családnak adnátok papírt, másoknak digitális linket",
            "fontos az emlék, de nem akartok manuális RSVP káoszt",
          ],
        },
        {
          type: "cta",
          lead: "A Wēddly segítségével a vendégek saját RSVP linken jelezhetnek vissza, ti pedig egy helyen látjátok a válaszokat, kísérőket, menüket és megjegyzéseket.",
          href: "/signup",
          label: "Próbáljátok ki ingyen",
        },
        { type: "h2", text: "GYIK" },
        { type: "h3", text: "Elég csak digitális meghívót küldeni?" },
        {
          type: "p",
          text: "Igen, ha a vendégkörötök nyitott rá, és minden fontos információ könnyen elérhető benne.",
        },
        { type: "h3", text: "Kell papír meghívó is?" },
        {
          type: "p",
          text: "Nem kötelező, de szép gesztus lehet a családnak vagy azoknak, akik értékelik a hagyományos formát.",
        },
        { type: "h3", text: "Mi legyen a meghívóban a legfontosabb?" },
        {
          type: "p",
          text: "Dátum, helyszín, időpont, RSVP határidő és minden olyan információ, ami segíti a vendéget a döntésben.",
        },
      ],
    },
    en: {
      title: "Digital or paper wedding invitations: which should you choose?",
      lead: "Pros, cons, costs and how each affects the RSVP flow.",
      seo_title: "Digital or paper wedding invitations · Weddly",
      seo_description:
        "Compare digital and paper wedding invitations: upsides, downsides, costs, and how each connects to the RSVP process.",
      body: [
        {
          type: "p",
          text: "The invitation is the first thing your guests see. It sets the tone and carries the essential information. Today the question isn't only what paper to use, it's whether you need paper at all.",
        },
        {
          type: "p",
          text: "Digital and paper aren't opposites. For many couples the combination works best.",
        },
        { type: "h2", text: "Paper invitations: when they shine" },
        {
          type: "p",
          text: "Paper feels personal, elegant and tangible. It's a good fit if a classic experience matters to you, or if many guests prefer the traditional form.",
        },
        { type: "p", text: "Upsides:" },
        {
          type: "ul",
          items: [
            "becomes a keepsake",
            "elegant and formal",
            "fits a classic style",
            "feels more personal",
          ],
        },
        { type: "p", text: "Downsides:" },
        {
          type: "ul",
          items: [
            "more expensive",
            "print and postage lead times",
            "hard to update if details change",
            "RSVP has to be handled separately",
          ],
        },
        { type: "h2", text: "Digital invitations: when they're more practical" },
        {
          type: "p",
          text: "Digital is fast, easy to update, and connects directly to an RSVP system. If the date, venue, menu or schedule changes, nothing needs to be reprinted.",
        },
        { type: "p", text: "Upsides:" },
        {
          type: "ul",
          items: [
            "quick to send",
            "opens easily on mobile",
            "connects to RSVP",
            "updatable",
            "cost-effective",
          ],
        },
        { type: "p", text: "Downsides:" },
        {
          type: "ul",
          items: [
            "may feel less formal",
            "not every guest prefers it",
            "easy to lose in a message thread",
          ],
        },
        { type: "h2", text: "The hybrid often wins" },
        {
          type: "p",
          text: "Many couples send paper to close family and a few VIPs, while the rest of the guests get a digital invitation or RSVP link.",
        },
        {
          type: "p",
          text: "Practical if you want the elegant invitation experience without manually tracking every reply.",
        },
        { type: "h2", text: "What a digital invitation should include" },
        { type: "p", text: "A good digital invitation is both pretty and useful. Include:" },
        {
          type: "ul",
          items: [
            "your names",
            "date",
            "venue and address",
            "schedule",
            "dress code (if any)",
            "RSVP deadline",
            "meal / dietary questions",
            "contact info",
          ],
        },
        { type: "p", text: "Most important: the guest can reply quickly." },
        { type: "h2", text: "How RSVP fits in" },
        {
          type: "p",
          text: "Digital's biggest advantage is the direct link to RSVP. No separate messages, calls or spreadsheets.",
        },
        {
          type: "p",
          text: "The guest opens the link, answers a few questions, and you see live status in the guest list.",
        },
        { type: "h2", text: "Quick decision aid" },
        { type: "h3", text: "Choose paper if…" },
        {
          type: "ul",
          items: [
            "you want the classic experience",
            "you have many older guests",
            "you want a physical keepsake",
          ],
        },
        { type: "h3", text: "Choose digital if…" },
        {
          type: "ul",
          items: [
            "you want a fast, practical setup",
            "you need to collect lots of details",
            "RSVP automation matters",
            "you want to reduce costs",
          ],
        },
        { type: "h3", text: "Choose hybrid if…" },
        {
          type: "ul",
          items: [
            "you want both beauty and convenience",
            "paper for family, digital for everyone else",
            "you want the keepsake without manual RSVP",
          ],
        },
        {
          type: "cta",
          lead: "With Weddly each guest replies on their own RSVP link, and you see every reply, plus-one, meal and note in one place.",
          href: "/signup",
          label: "Try it free",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "Is digital-only enough?" },
        {
          type: "p",
          text: "Yes, as long as your guest list is comfortable with it and all key information is easy to find.",
        },
        { type: "h3", text: "Do we still need a paper invitation?" },
        {
          type: "p",
          text: "Not required, but a nice gesture for family or anyone who values the traditional form.",
        },
        { type: "h3", text: "What's the most important content?" },
        {
          type: "p",
          text: "Date, venue, time, RSVP deadline, and everything else that helps the guest decide.",
        },
      ],
    },
  },
];
