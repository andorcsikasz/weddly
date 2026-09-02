/**
 * Hungarian, indexable marketing and guide content.
 *
 * This module is shared by the React pages and the server-side HTML renderer.
 * Keeping the prose in one place prevents visible content, metadata, FAQ
 * structured data and the prerendered HTML from drifting apart.
 */

import { toolPathFor } from "./tool_faq";

export interface MarketingLink {
  href: string;
  label: string;
}

export interface MarketingImage {
  url: string;
  alt: string;
  /** Which part of the crop to keep when the photo's own aspect ratio
   *  doesn't match the box it renders in. Defaults to "top" at the call
   *  site; set "center" for photos whose focal point sits mid-frame. */
  position?: "top" | "center";
}

export interface MarketingSection {
  heading: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
  image?: MarketingImage;
}

export interface MarketingFaq {
  question: string;
  answer: string;
}

export interface MarketingGuideCard {
  href: string;
  label: string;
  description: string;
  image: MarketingImage;
}

export interface MarketingPage {
  path: string;
  kind: "feature" | "guide" | "hub";
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  intro: string;
  heroImage?: MarketingImage;
  sections: readonly MarketingSection[];
  steps?: readonly { title: string; body: string }[];
  faqs?: readonly MarketingFaq[];
  guideCards?: readonly MarketingGuideCard[];
  related: readonly MarketingLink[];
  cta?: { title: string; body: string; href: string; label: string };
  published?: string;
  updated?: string;
}

const featurePages: readonly MarketingPage[] = [
  {
    path: "/eskuvoi-vendeglista",
    kind: "feature",
    title: "Esküvői vendéglista Excel helyett | Wēddly",
    description:
      "Kezeljétek közösen az esküvői vendéglistát, RSVP-ket, kísérőket, ételválasztást és étrendi igényeket egy mindig naprakész felületen.",
    eyebrow: "Vendéglista",
    h1: "Esküvői vendéglista, amit nem kell körbeküldeni",
    intro:
      "A Weddlyben mindketten ugyanazt a vendéglistát látjátok. Az RSVP-válaszok, kísérők, ételválasztások és megjegyzések egy helyre érkeznek, ezért nem kell több Excel-verzióból összefésülni az adatokat.",
    heroImage: {
      url: "https://images.unsplash.com/photo-1537843147573-84a454793cf6?w=1200&auto=format&fit=crop&q=75",
      alt: "Sötétzöld esküvői boríték kézzel írt fehér kalligráfiával, tollheggyel és fenyőtobozzal, meleg fényben.",
      position: "center",
    },
    sections: [
      {
        heading: "Miért nehéz egy táblázattal tervezni?",
        paragraphs: [
          "Egy esküvői vendéglista gyorsan több lesz névsornál. Tudnotok kell, ki melyik háztartáshoz tartozik, válaszolt-e, hoz-e kísérőt, melyik menüt választja, és van-e étrendi kérése.",
          "Ha ezek külön üzenetekben és fájlmásolatokban élnek, könnyű egy régi adatból dolgozni. A közös lista előnye nem a több mező, hanem az, hogy egyetlen aktuális állapototok van.",
        ],
        bullets: [
          "Háztartások és vendégek rendezett kezelése",
          "RSVP-állapot, kísérő és étkezési adatok egy sorban",
          "Kereshető, közösen szerkeszthető lista",
          "CSV-sablonból induló import, ha már van táblázatotok",
        ],
      },
      {
        heading: "Hogyan kapcsolódik a lista az esküvő többi részéhez?",
        paragraphs: [
          "A visszajelzések ugyanabban a rendszerben jelennek meg, ahol a vendégeket kezelitek. Amikor eljön az ültetés ideje, nem kell újra begépelni a neveket: a vendéglistából dolgozhattok tovább.",
          "Ez különösen hasznos a végső létszám, a menük összesítése és az utolsó pillanatos változások idején.",
        ],
        image: {
          url: "https://images.unsplash.com/photo-1687226480327-a8948ec49f9b?w=1200&auto=format&fit=crop&q=75",
          alt: "Egyenként megcímzett, kraftpapír csomagok névre szóló kártyákkal, sorba állítva egy asztalon.",
        },
      },
    ],
    steps: [
      {
        title: "Vegyétek fel a vendégeket",
        body: "Induljatok üres listából, vagy töltsétek fel a meglévő CSV-t.",
      },
      {
        title: "Rendezzétek háztartásokba",
        body: "Tartsátok együtt azokat, akik közös meghívót és RSVP-t kapnak.",
      },
      {
        title: "Küldjétek ki az RSVP-linkeket",
        body: "A személyes linkeken érkező válaszok automatikusan a listához kerülnek.",
      },
      {
        title: "Dolgozzatok az aktuális adatokból",
        body: "A létszámot, menüket és az ültetést ugyanabból a naprakész listából kezelhetitek.",
      },
    ],
    faqs: [
      {
        question: "Behozható a már meglévő vendéglistánk?",
        answer:
          "Igen. A Weddlyhez letölthető CSV-sablon tartozik, amelyet Excelben vagy Google Táblázatokban is kitölthettek, majd importálhattok.",
      },
      {
        question: "Kezelhetők a kísérők és az étrendi igények?",
        answer:
          "Igen. A vendégadatok között a kísérő, az ételválasztás és az étrendi megjegyzés is rögzíthető.",
      },
      {
        question: "A párom is ugyanazt a listát látja?",
        answer:
          "Igen. A Weddly közös páros felület, ezért nem kell külön fájlokat vagy frissítéseket küldenetek egymásnak.",
      },
    ],
    related: [
      { href: "/online-eskuvoi-rsvp", label: "Online esküvői RSVP" },
      { href: "/eskuvoi-ultetesi-rend-tervezo", label: "Esküvői ültetési rend tervező" },
      { href: "/utmutato/eskuvoi-vendeglista", label: "Vendéglista-készítési útmutató" },
    ],
    cta: {
      title: "Legyen egy közös, naprakész vendéglistátok",
      body: "Hozzátok létre a páros felületeteket, és folytassátok a tervezést egy helyen.",
      href: "/signup",
      label: "Regisztráció",
    },
  },
  {
    path: "/eskuvoi-koltsegvetes-tervezo",
    kind: "feature",
    title: "Esküvői költségvetés tervező pároknak | Wēddly",
    description:
      "Tervezzétek és kövessétek közösen az esküvői költségvetést: kategóriák, tervezett és tényleges kiadások, fizetések egy helyen.",
    eyebrow: "Költségvetés",
    h1: "Esküvői költségvetés tervező, közös döntésekhez",
    intro:
      "A Weddly költségvetés-tervezőjében egy helyen látjátok a keretet, a tervezett tételeket és a tényleges költéseket. Így egy új ajánlatnál rögtön látszik, mi fér bele, és hol változott a terv.",
    sections: [
      {
        heading: "A keret csak akkor hasznos, ha követhető",
        paragraphs: [
          "Az esküvői költségvetés nem egyszer elkészített szám, hanem folyamatosan változó terv. Egy foglaló, módosított vendégszám vagy új szolgáltatói ajánlat több kategóriát is érinthet.",
          "A Weddly külön kezeli a tervezett és a tényleges összegeket, így nem kell fejben tartanotok, hogy melyik szám becslés, és melyik már vállalt kiadás.",
        ],
        bullets: [
          "Kiadások kategóriák szerint",
          "Tervezett és tényleges összegek összevetése",
          "Fizetési tételek és határidők kezelése",
          "Közös nézet mindkettőtöknek",
        ],
      },
      {
        heading: "Mire használható a gyakorlatban?",
        paragraphs: [
          "Rögzíthetitek például a helyszín teljes becslését, majd külön követhetitek a foglalót és a későbbi fizetéseket. Ugyanígy láthatjátok, mennyi maradt dekorra, zenére vagy fotóra egy döntés után.",
          "A cél nem az, hogy minden forintot előre tökéletesen eltaláljatok, hanem hogy a változások következménye látható legyen.",
        ],
      },
    ],
    steps: [
      {
        title: "Adjátok meg a teljes keretet",
        body: "Induljatok abból az összegből, amelyet valóban az esküvőre szántok.",
      },
      {
        title: "Bontsátok kategóriákra",
        body: "Osszátok szét a tervet a fontos területek között, majd vegyétek fel a konkrét tételeket.",
      },
      {
        title: "Rögzítsétek a vállalásokat",
        body: "Az ajánlatokat, foglalókat és tényleges költéseket a döntések után frissítsétek.",
      },
      {
        title: "Nézzetek rá döntések előtt",
        body: "Mielőtt új szolgáltatót választotok, ellenőrizzétek, hogyan áll a teljes keret.",
      },
    ],
    faqs: [
      {
        question: "Külön látszik a tervezett és a tényleges költés?",
        answer:
          "Igen. A költségvetésben a terv és a tényleges kiadás külön követhető, így látszik az eltérés.",
      },
      {
        question: "Követhetők a fizetési határidők is?",
        answer: "Igen. A költségekhez kapcsolódó fizetési tételek és esedékességek rögzíthetők.",
      },
      {
        question: "Mindketten szerkeszthetjük a költségvetést?",
        answer:
          "Igen. A költségvetés a közös páros felület része, így mindketten ugyanazt az aktuális állapotot látjátok.",
      },
    ],
    related: [
      { href: "/utmutato/eskuvoi-koltsegvetes", label: "Esküvői költségvetés útmutató" },
      {
        href: toolPathFor("hu", "budget_calculator"),
        label: "Ingyenes költségvetés-kalkulátor",
      },
      { href: "/eskuvoi-szolgaltatok", label: "Esküvői szolgáltatók keresése" },
    ],
    cta: {
      title: "Lássátok együtt, mire megy el a keret",
      body: "Indítsátok el a közös költségvetést a Weddlyben.",
      href: "/signup",
      label: "Regisztráció",
    },
  },
  {
    path: "/eskuvoi-ultetesi-rend-tervezo",
    kind: "feature",
    title: "Esküvői ültetési rend tervező | Wēddly",
    description:
      "Készítsetek esküvői ültetési rendet vizuális, drag-and-drop felületen, majd nyomtassátok A4, A6 vagy A3 méretben.",
    eyebrow: "Ültetési rend",
    h1: "Esküvői ültetési rend tervező, húzd a vendégeket a helyükre",
    intro:
      "A Weddly vizuális ültetési felületén asztalokat és székeket rendezhettek el, majd a vendéglistáról a helyükre húzhatjátok a neveket. A kész terv A4, A6 és A3 méretben is nyomtatható.",
    sections: [
      {
        heading: "Az ültetés akkor átlátható, ha látjátok is",
        paragraphs: [
          "Egy névsorban nehéz észrevenni, hogy egy asztal túlzsúfolt, egy háztartás szétszakadt, vagy valaki még nem kapott helyet. A vizuális vásznon az asztalok és a vendégek kapcsolata azonnal látszik.",
          "A drag-and-drop szerkesztés különösen az utolsó héten hasznos, amikor egy lemondás miatt több embert is át kell rendezni.",
        ],
        bullets: [
          "Asztalok és székek vizuális elrendezése",
          "Vendégek áthúzása a listáról a helyükre",
          "A vendéglistával közös adatforrás",
          "A4, A6 és A3 nyomtatható elrendezések",
        ],
      },
      {
        heading: "Egy terv többféle nyomtatáshoz",
        paragraphs: [
          "Ugyanabból az ültetésből készíthettek kisebb, kézben tartható nézetet és nagyobb, a bejáratnál használható elrendezést. Nem kell külön dokumentumban újraépíteni a végleges névsort.",
          "A nyomtatás előtt érdemes még egyszer összevetni a tervet a legfrissebb RSVP-válaszokkal és étrendi megjegyzésekkel.",
        ],
      },
    ],
    steps: [
      {
        title: "Véglegesítsétek a résztvevőket",
        body: "Az ültetést a naprakész vendéglistából érdemes elkezdeni.",
      },
      {
        title: "Helyezzétek el az asztalokat",
        body: "Állítsátok össze a terem logikáját a rendelkezésre álló asztalokkal és székekkel.",
      },
      {
        title: "Húzzátok helyre a vendégeket",
        body: "Tartsátok együtt a fontos csoportokat, és közben figyeljetek az egyéni szempontokra.",
      },
      {
        title: "Ellenőrizzétek és nyomtassátok",
        body: "A végleges tervet exportáljátok a felhasználásnak megfelelő A4, A6 vagy A3 formátumban.",
      },
    ],
    faqs: [
      {
        question: "A vendéglistából kerülnek át a nevek?",
        answer:
          "Igen. Az ültetési felület a Weddlyben kezelt vendégekkel dolgozik, ezért nem kell külön névsort gépelnetek.",
      },
      {
        question: "Át lehet tenni valakit másik asztalhoz?",
        answer: "Igen. A vendégeket drag-and-drop módon mozgathatjátok a helyek között.",
      },
      {
        question: "Milyen méretekben nyomtatható a terv?",
        answer: "A Weddly A4, A6 és A3 méretű nyomtatható elrendezéseket támogat.",
      },
    ],
    related: [
      { href: "/eskuvoi-vendeglista", label: "Esküvői vendéglista" },
      { href: "/utmutato/eskuvoi-ultetesi-rend", label: "Ültetési rend készítési útmutató" },
      { href: toolPathFor("hu", "seating_chart"), label: "Ültetési rend készítő eszköz" },
    ],
    cta: {
      title: "Rakjátok össze vizuálisan az ültetést",
      body: "A naprakész vendéglistából indulva gyorsabban kezelhetitek a változásokat.",
      href: "/signup",
      label: "Regisztráció",
    },
  },
  {
    path: "/online-eskuvoi-rsvp",
    kind: "feature",
    title: "Online esküvői RSVP és visszajelzés | Wēddly",
    description:
      "Küldjetek személyes online esküvői RSVP-linkeket, és gyűjtsétek egy helyre a részvételt, menüket, kísérőket és dalkéréseket.",
    eyebrow: "Online RSVP",
    h1: "Online esküvői RSVP, külön utánajárás nélkül",
    intro:
      "A Weddlyben a vendégek személyes RSVP-linken jelezhetnek vissza. A részvétel, az ételválasztás, a kísérő és a dalkérés közvetlenül a vendéglistát frissíti.",
    sections: [
      {
        heading: "Mitől lesz használható egy online RSVP?",
        paragraphs: [
          "Attól, hogy a vendégnek egyszerű válaszolni, nektek pedig nem kell a válaszokat kézzel átvezetni. A személyes link egyértelművé teszi, melyik meghívotthoz tartozik a visszajelzés.",
          "A kérdések maradjanak azoknál az adatoknál, amelyeket később tényleg felhasználtok: részvétel, kísérő, menü, étrendi információ és opcionális dalkérés.",
        ],
        bullets: [
          "Személyes RSVP-link a meghívottaknak",
          "Részvételi válasz és kísérő kezelése",
          "Ételválasztás és étrendi megjegyzés",
          "Dalkérés rögzítése a válasszal együtt",
        ],
      },
      {
        heading: "A válaszok ott landolnak, ahol szükség van rájuk",
        paragraphs: [
          "A beérkező adatok a vendéglistában jelennek meg, így a végső létszám, a menük és az ültetés ugyanabból az állapotból készülhet. Ha valaki módosítja a válaszát, nem egy külön űrlap eredményeit kell keresnetek.",
          "A vendégek számára készített esküvői oldalon a dátum, helyszín és program is megosztható, az RSVP pedig ehhez a vendégélményhez kapcsolódik.",
        ],
      },
    ],
    steps: [
      {
        title: "Rendezzétek a vendéglistát",
        body: "A személyes linkek előtt legyenek rendben a meghívottak és háztartások.",
      },
      {
        title: "Állítsátok be a szükséges kérdéseket",
        body: "Csak azt kérdezzétek, amit a szervezés során használni fogtok.",
      },
      {
        title: "Osszátok meg a személyes linket",
        body: "Küldjétek el a megfelelő vendégnek vagy háztartásnak.",
      },
      {
        title: "Kövessétek a válaszokat",
        body: "A függőben lévő és beérkezett RSVP-ket a közös vendéglistában látjátok.",
      },
    ],
    faqs: [
      {
        question: "A vendégnek kell Weddly-fiók?",
        answer: "Nem. A vendég a neki küldött személyes RSVP-linken válaszolhat.",
      },
      {
        question: "Kérhető ételválasztás és kísérő neve?",
        answer:
          "Igen. A válasz része lehet az ételválasztás, étrendi megjegyzés és a kísérő adata.",
      },
      {
        question: "A válasz automatikusan megjelenik a vendéglistában?",
        answer:
          "Igen. Az RSVP a hozzá tartozó vendég vagy háztartás adatait frissíti a közös listában.",
      },
    ],
    related: [
      { href: "/eskuvoi-vendeglista", label: "Esküvői vendéglista" },
      { href: toolPathFor("hu", "rsvp_generator"), label: "Esküvői RSVP-szöveg generátor" },
      { href: "/utmutato/eskuvoi-vendeglista", label: "Vendéglista és visszajelzés útmutató" },
    ],
    cta: {
      title: "Gyűjtsétek egy helyre a visszajelzéseket",
      body: "Készítsétek el a vendéglistát, majd osszátok meg a személyes RSVP-linkeket.",
      href: "/signup",
      label: "Regisztráció",
    },
  },
  {
    path: "/eskuvoi-szolgaltatok",
    kind: "feature",
    title: "Esküvői szolgáltatók keresése | Wēddly",
    description:
      "Keressetek esküvői helyszínt, fotóst, zenét, cateringet és más szolgáltatókat kategória vagy helyszín alapján a Weddly katalógusában.",
    eyebrow: "Szolgáltatói katalógus",
    h1: "Esküvői szolgáltatók egy átlátható katalógusban",
    intro:
      "A Weddly nyilvános szolgáltatói katalógusában kategória és hely alapján kereshettek. A részletes profilokon a szolgáltató által megadott bemutatkozás és képek segítenek a rövid lista összeállításában.",
    heroImage: {
      url: "https://images.unsplash.com/photo-1758810743028-6b8e150ec98f?w=1200&auto=format&fit=crop&q=75",
      alt: "Szalvia-zöld terítővel és vadvirág-csokrokkal berendezett esküvői asztal, arany evőeszközökkel, kerti fényben.",
    },
    sections: [
      {
        heading: "Induljatok a valódi igényeitekből",
        paragraphs: [
          "Mielőtt végignéztek minden találatot, írjátok le a dátumot, a helyszínt vagy régiót, a hozzávetőleges keretet és azt a három szempontot, amelyből nem szeretnétek engedni.",
          "Ezután kategóriánként haladjatok. Más információ fontos egy helyszínnél, egy fotósnál és egy zenekarnál, ezért az összehasonlítást is az adott döntéshez igazítsátok.",
        ],
        bullets: [
          "Keresés esküvői szolgáltatói kategóriák között",
          "Hely vagy szolgáltatási terület figyelembevétele",
          "Nyilvános szolgáltatói profilok és képek",
          "Kiválasztott szolgáltatók mentése a tervezéshez",
        ],
      },
      {
        heading: "A kereséstől a rövid listáig",
        paragraphs: [
          "Első körben ne egyetlen nyertest keressetek. Mentsétek el azokat, akik stílusban, helyben és szolgáltatásban szóba jöhetnek, majd ugyanazokat a kérdéseket tegyétek fel nekik.",
          "A katalógus a felfedezést segíti; az elérhetőséget, a pontos tartalmat és a feltételeket mindig közvetlenül a szolgáltatóval egyeztessétek.",
        ],
        image: {
          url: "https://images.unsplash.com/photo-1782038522911-10e919331c16?w=1200&auto=format&fit=crop&q=75",
          alt: "Virágkötő kezei rózsaszín rózsákat válogatnak egy esküvői csokorhoz.",
        },
      },
    ],
    steps: [
      {
        title: "Válasszatok kategóriát",
        body: "Kezdjetek a következő valódi döntéssel, például helyszínnel, fotóval vagy zenével.",
      },
      {
        title: "Szűkítsetek hely alapján",
        body: "Nézzétek meg, hol dolgozik a szolgáltató, és illik-e az esküvőtök régiójához.",
      },
      {
        title: "Olvassátok el a profilokat",
        body: "A bemutatkozás és a képek alapján készítsetek kezelhető rövid listát.",
      },
      {
        title: "Egyeztessetek közvetlenül",
        body: "Kérjetek azonos részleteket, majd a válaszokat és a keretet együtt mérlegeljétek.",
      },
    ],
    faqs: [
      {
        question: "Regisztráció nélkül is böngészhető a katalógus?",
        answer:
          "Igen. A nyilvános szolgáltatói katalógus és a publikus profilok bejelentkezés nélkül is megnyithatók.",
      },
      {
        question: "Milyen szolgáltatókat lehet keresni?",
        answer:
          "A katalógus többek között helyszíneket, fotósokat, videósokat, zenészeket, vendéglátást, dekorációt és más esküvői kategóriákat tartalmaz.",
      },
      {
        question: "A Weddly garantálja az elérhetőséget vagy az ajánlatot?",
        answer:
          "Nem. A pontos elérhetőséget, szolgáltatási tartalmat és feltételeket közvetlenül a kiválasztott szolgáltatóval kell egyeztetnetek.",
      },
    ],
    related: [
      { href: "/suppliers/browse", label: "Szolgáltatói katalógus megnyitása" },
      { href: "/eskuvoi-koltsegvetes-tervezo", label: "Esküvői költségvetés tervező" },
      { href: "/utmutato/eskuvoi-koltsegvetes", label: "Költségvetési útmutató" },
    ],
    cta: {
      title: "Kezdjétek el a szolgáltatók keresését",
      body: "A katalógust regisztráció nélkül is böngészhetitek.",
      href: "/suppliers/browse",
      label: "Esküvői szolgáltatók böngészése",
    },
  },
];

const guidePages: readonly MarketingPage[] = [
  {
    path: "/utmutato/eskuvoi-vendeglista",
    kind: "guide",
    title: "Esküvői vendéglista készítése lépésről lépésre | Wēddly",
    description:
      "Gyakorlati útmutató esküvői vendéglista készítéséhez: keret, csoportok, kísérők, RSVP, étkezési adatok és gyakori hibák.",
    eyebrow: "Gyakorlati útmutató",
    h1: "Esküvői vendéglista készítése: a névsortól a végleges létszámig",
    intro:
      "A jó vendéglista nem attól jó, hogy elsőre végleges, hanem attól, hogy minden döntésnél egyértelmű: kit hívtok, ki válaszolt, és milyen információ hiányzik még.",
    published: "2026-08-12",
    updated: "2026-08-12",
    sections: [
      {
        heading: "1. Előbb a keretet és a helyszínt tisztázzátok",
        paragraphs: [
          "A vendégszám közvetlenül hat a helyszínre, a cateringre és sokszor a dekorációra is. Készítsetek három számot: ideális létszám, kényelmes felső határ és abszolút maximum.",
          "Példa: ha 80 fő az ideális és 90 a maximum, ne 110 nevet írjatok fel abban bízva, hogy sokan visszamondják. A meghívás ígéret, nem várólista.",
        ],
      },
      {
        heading: "2. Neveket csoportokban gyűjtsetek",
        paragraphs: [
          "Induljatok mindketten külön: közeli család, tágabb család, barátok, munka, közösségek. Ezután egyesítsétek a listát, és jelöljétek a háztartásokat.",
          "A háztartás azért fontos, mert általában együtt kapnak meghívót, együtt jeleznek vissza, és az ültetésnél is van köztük kapcsolat.",
        ],
        bullets: [
          "Teljes név",
          "Háztartás vagy csoport",
          "Kapcsolattartási adat",
          "Kísérő szabálya",
          "RSVP-állapot",
          "Menü és étrendi igény",
        ],
      },
      {
        heading: "3. A kísérőkről hozzatok egyértelmű szabályt",
        paragraphs: [
          "Döntsétek el, hogy név szerint hívjátok-e a párt, vagy valóban szabadon hozható plusz egy főről van szó. A két helyzetet a listán is külön kezeljétek.",
          "Példa: „Kovács Anna és Nagy Péter” két név szerint meghívott vendég. „Kovács Anna + 1 fő” olyan hely, amelynek a neve csak később derül ki.",
        ],
      },
      {
        heading: "4. Az RSVP legyen rövid és határidős",
        paragraphs: [
          "A visszajelzésben csak azt kérdezzétek, amit fel fogtok használni: részvétel, kísérő, ételválasztás, étrendi igény és szükség esetén egy rövid megjegyzés. Adjatok konkrét határidőt, amely után még marad időtök utánajárni.",
          "A határidő előtt egy udvarias emlékeztető sokkal jobb, mint az utolsó héten egyenként telefonálni.",
        ],
      },
      {
        heading: "Gyakori hibák",
        paragraphs: [
          "A legtöbb hiba nem a névsor elején, hanem a változások kezelésénél keletkezik.",
        ],
        bullets: [
          "Több, eltérő fájlverzió használata",
          "A háztartások és kísérők összekeverése",
          "Szóbeli válaszok átvezetésének halogatása",
          "Túl sok, később nem használt RSVP-kérdés",
          "Az ültetés megkezdése a válaszadási határidő előtt",
        ],
      },
    ],
    related: [
      { href: "/eskuvoi-vendeglista", label: "Weddly esküvői vendéglista" },
      { href: "/online-eskuvoi-rsvp", label: "Online esküvői RSVP" },
      { href: "/utmutato/eskuvoi-ultetesi-rend", label: "Ültetési rend útmutató" },
    ],
    cta: {
      title: "Ha egy közös listában dolgoznátok",
      body: "A Weddlyben a vendéglista, az RSVP és az ültetés ugyanarra az adatra épül.",
      href: "/eskuvoi-vendeglista",
      label: "A vendéglista funkció bemutatása",
    },
  },
  {
    path: "/utmutato/eskuvoi-koltsegvetes",
    kind: "guide",
    title: "Esküvői költségvetés készítése reálisan | Wēddly",
    description:
      "Gyakorlati esküvői költségvetés útmutató: teljes keret, kategóriák, tartalék, ajánlatok, fizetési ütemezés és gyakori hibák.",
    eyebrow: "Gyakorlati útmutató",
    h1: "Esküvői költségvetés készítése: kerettől a kifizetésekig",
    intro:
      "A használható költségvetés nem egy optimista végösszeg. Megmutatja, mennyit vállalhattok biztonságosan, mi fontos nektek, és mikor kell ténylegesen fizetni.",
    published: "2026-08-12",
    updated: "2026-08-12",
    sections: [
      {
        heading: "1. Határozzátok meg a valódi teljes keretet",
        paragraphs: [
          "Csak olyan összeget számoljatok bele, amely biztosan rendelkezésre áll. Ha családi hozzájárulás is része a tervnek, tisztázzátok az összeget és az időzítést, mielőtt szerződést írtok alá.",
          "A keretből különítsetek el tartalékot. Ez nem „elkölthető extra”, hanem hely az előre nem látott változásoknak, például létszámemelkedésnek vagy szállítási költségnek.",
        ],
      },
      {
        heading: "2. Osszátok fel fontosság szerint",
        paragraphs: [
          "Külön-külön válasszatok három területet, amely számotokra a legtöbbet adja az esküvőhöz. A közös prioritások kapjanak előbb keretet, a kevésbé fontos elemek később.",
          "Példa: ha az étel és a fotó fontos, a dekor pedig kevésbé, ne egy általános százalékos sablon kényszerítse fordított döntésre a tervet.",
        ],
        bullets: [
          "Helyszín és vendéglátás",
          "Fotó és videó",
          "Zene és program",
          "Dekoráció és virág",
          "Öltözék és szépség",
          "Meghívó és nyomtatás",
          "Utazás és szállás",
          "Tartalék",
        ],
      },
      {
        heading: "3. Az ajánlatok teljes tartalmát hasonlítsátok össze",
        paragraphs: [
          "Két végösszeg csak akkor összehasonlítható, ha ugyanazt tartalmazza. Nézzétek meg az óraszámot, létszámot, kiszállást, eszközöket, túlórát, adókat és a lemondási feltételeket.",
          "A tervezett tételt akkor módosítsátok, amikor új információ érkezik. Így a költségvetés döntési eszköz marad, nem az eredeti elképzelés emléke.",
        ],
      },
      {
        heading: "4. Készítsetek fizetési naptárt",
        paragraphs: [
          "A teljes keret mellett a pénz időzítése is számít. Rögzítsétek a foglalót, a részleteket és a végső fizetési határidőt. Egy hónapban több nagy tétel is összetorlódhat akkor is, ha a teljes büdzsé rendben van.",
          "Példa: a helyszín második részlete és a fotós végszámlája ugyanarra a hétre eshet. Ezt hamarabb kell látni, mint a banki értesítésekből.",
        ],
      },
      {
        heading: "Gyakori hibák",
        paragraphs: [
          "A költségvetés akkor veszti el a hasznát, ha a terv és a vállalt kiadások elválnak egymástól.",
        ],
        bullets: [
          "Tartalék nélküli tervezés",
          "A foglaló összekeverése a teljes árral",
          "Az apró, sokszorozódó tételek kihagyása",
          "Eltérő tartalmú ajánlatok puszta végösszegének összevetése",
          "A fizetési határidők külön naptárban tartása",
        ],
      },
    ],
    related: [
      { href: "/eskuvoi-koltsegvetes-tervezo", label: "Weddly költségvetés tervező" },
      { href: toolPathFor("hu", "budget_calculator"), label: "Költségvetés-kalkulátor" },
      { href: "/eskuvoi-szolgaltatok", label: "Esküvői szolgáltatók" },
    ],
    cta: {
      title: "Ha a tervet és a költést együtt követnétek",
      body: "A Weddly közös költségvetésében külön látszanak a tervezett és tényleges összegek.",
      href: "/eskuvoi-koltsegvetes-tervezo",
      label: "A költségvetés funkció bemutatása",
    },
  },
  {
    path: "/utmutato/eskuvoi-ultetesi-rend",
    kind: "guide",
    title: "Esküvői ültetési rend készítése lépésről lépésre | Wēddly",
    description:
      "Gyakorlati útmutató esküvői ültetési rendhez: asztalok, csoportok, családi helyzetek, speciális igények, ellenőrzés és nyomtatás.",
    eyebrow: "Gyakorlati útmutató",
    h1: "Esküvői ültetési rend készítése, felesleges körök nélkül",
    intro:
      "A jó ültetési rend nem mindenkit a legjobb barátja mellé ültet. Olyan asztalokat alakít ki, ahol mindenki ismer valakit, tud beszélgetni, és a terem működése is zavartalan marad.",
    published: "2026-08-12",
    updated: "2026-08-12",
    sections: [
      {
        heading: "1. Várjátok meg a használható vendéglistát",
        paragraphs: [
          "A csoportok felírását elkezdhetitek korábban, de konkrét székeket csak a legtöbb RSVP beérkezése után osszatok. Különben minden lemondás dominóként mozgatja az egész termet.",
          "A listán legyen egyértelmű a háztartás, a kísérő, a gyerekek, az étrendi és a mozgással kapcsolatos igény.",
        ],
      },
      {
        heading: "2. Rajzoljátok fel a terem kötött pontjait",
        paragraphs: [
          "Jelöljétek a bejáratot, táncteret, zenét, mosdóhoz vezető útvonalat, kijáratot és azokat az oszlopokat vagy falakat, amelyek befolyásolják a rálátást. Csak ezután tegyétek le az asztalokat.",
          "Kérjetek a helyszíntől pontos asztalméretet és maximális székszámot. Egy tízfősnek nevezett asztal nem minden teremben kényelmes tíz fővel.",
        ],
      },
      {
        heading: "3. Először csoportokat, utána székeket tervezzetek",
        paragraphs: [
          "Készítsetek természetes csoportokat: közeli család, rokonok, egyetemi barátok, munkahely, közös hobbi. A cél, hogy minden asztalnál legyen legalább két-három működő kapcsolódási pont.",
          "Példa: egy nyolcfős baráti társasághoz két olyan vendég könnyen kapcsolódhat, akik ugyanabból a városból jönnek vagy hasonló korú gyerekkel érkeznek. Két teljesen ismeretlen embert viszont ne csak azért tegyetek oda, mert maradt két szék.",
        ],
      },
      {
        heading: "4. Kezeljétek külön az érzékeny szempontokat",
        paragraphs: [
          "Az idősebb vendégeknek lehet fontos a rövidebb útvonal és a halkabb hely. Kisgyerekes családoknál számíthat a kijárat közelsége. Családi konfliktusnál ne egyetlen szék távolságára, hanem külön asztalban gondolkodjatok.",
          "Az érintettektől csak annyi információt kérjetek, amennyi a kényelmes és biztonságos elhelyezéshez kell.",
        ],
      },
      {
        heading: "5. Ellenőrizzétek három nézetben",
        paragraphs: [
          "Nézzétek át vendégenként: mindenki kapott helyet? Asztalonként: stimmel a létszám és működik a társaság? Teremként: szabadok az útvonalak és megfelelő a rálátás?",
          "Végül vessétek össze a legfrissebb vendéglistával, majd készítsétek el a bejárati táblát és a szervezőknek szánt példányt.",
        ],
        bullets: [
          "Túl korán rögzített székek",
          "Az asztalok valós méretének figyelmen kívül hagyása",
          "Párok vagy háztartások véletlen szétválasztása",
          "Idősek és kisgyerekesek útvonalának kihagyása",
          "Régi vendéglistából történő nyomtatás",
        ],
      },
    ],
    related: [
      { href: "/eskuvoi-ultetesi-rend-tervezo", label: "Weddly ültetési rend tervező" },
      { href: "/eskuvoi-vendeglista", label: "Esküvői vendéglista" },
      { href: toolPathFor("hu", "seating_chart"), label: "Ültetési rend készítő eszköz" },
    ],
    cta: {
      title: "Ha vizuálisan rendeznétek el a vendégeket",
      body: "A Weddly vásznán a vendéglistáról húzhatjátok a neveket az asztalokhoz.",
      href: "/eskuvoi-ultetesi-rend-tervezo",
      label: "Az ültetési funkció bemutatása",
    },
  },
];

const hub: MarketingPage = {
  path: "/utmutato",
  kind: "hub",
  title: "Esküvőszervezési útmutatók pároknak | Wēddly",
  description:
    "Gyakorlati magyar esküvőszervezési útmutatók vendéglistához, költségvetéshez és ültetési rendhez, konkrét példákkal és hibákkal.",
  eyebrow: "Weddly útmutatók",
  h1: "Esküvőszervezési útmutatók, valódi döntésekhez",
  intro:
    "A tervezés legnehezebb részeihez készítettünk lépésről lépésre használható útmutatókat. Regisztráció nélkül végigolvashatók, példákkal és ellenőrző szempontokkal.",
  heroImage: {
    url: "https://images.unsplash.com/photo-1541140911322-98afe66ea6da?w=1200&auto=format&fit=crop&q=75",
    alt: "Nyitott éves tervező kézzel írt bejegyzésekkel és egy rézszínű toll, letisztult asztalon.",
  },
  sections: [
    {
      heading: "Három alap, amelyre a többi döntés épül",
      paragraphs: [
        "A vendéglista meghatározza a létszámot, a költségvetés kijelöli a lehetőségeket, az ültetési rend pedig a végleges vendégadatokból lesz használható. Érdemes ebben a sorrendben haladni, miközben a változásokat mindhárom helyen átvezetitek.",
        "Egyik útmutató sem egyszeri feladatlista. Mindegyik lépésről lépésre halad, konkrét példákkal illusztrálja a döntéseket, és egy gyakori hibákat összegző résszel zárul, hogy ne csak azt lássátok, mit érdemes csinálni, hanem azt is, hol szoktak elcsúszni mások.",
      ],
    },
  ],
  guideCards: [
    {
      href: "/utmutato/eskuvoi-vendeglista",
      label: "Esküvői vendéglista készítése",
      description:
        "A névsortól a végleges létszámig: keret, csoportok, kísérők, RSVP és a leggyakoribb hibák.",
      image: {
        url: "https://images.unsplash.com/photo-1537843147573-84a454793cf6?w=1200&auto=format&fit=crop&q=75",
        alt: "Sötétzöld esküvői boríték kézzel írt fehér kalligráfiával.",
        position: "center",
      },
    },
    {
      href: "/utmutato/eskuvoi-koltsegvetes",
      label: "Esküvői költségvetés készítése",
      description:
        "Kerettől a kifizetésekig: kategóriák, tartalék, ajánlatok összehasonlítása és fizetési naptár.",
      image: {
        url: "https://images.unsplash.com/photo-1633158829585-23ba8f7c8caf?w=1200&auto=format&fit=crop&q=75",
        alt: "Egymásra rakott érmék, ahogy valaki a költségvetés tételeit számolja.",
      },
    },
    {
      href: "/utmutato/eskuvoi-ultetesi-rend",
      label: "Esküvői ültetési rend készítése",
      description:
        "Asztaltól asztalig: csoportok, érzékeny szempontok és a végső ellenőrzés nyomtatás előtt.",
      image: {
        url: "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1200&auto=format&fit=crop&q=75",
        alt: "Hosszú, virágdíszes esküvői asztal megterítve, székekkel mindkét oldalon.",
      },
    },
  ],
  faqs: [
    {
      question: "Kell hozzá Weddly-fiók az útmutatók elolvasásához?",
      answer: "Nem. Mindhárom útmutató regisztráció nélkül, szabadon olvasható.",
    },
    {
      question: "Milyen sorrendben érdemes végigolvasni őket?",
      answer:
        "A vendéglistával érdemes kezdeni, utána jöhet a költségvetés, majd az ültetési rend, mert mindegyik az előzőre épül.",
    },
    {
      question: "Az útmutatók a Weddly használatához kellenek?",
      answer:
        "Nem feltétlenül. A lépések bármilyen módszerrel, akár papíron vagy táblázatban is követhetők; a Weddly funkciói csak megkönnyítik a megvalósítást.",
    },
  ],
  related: [
    { href: "/eskuvoi-vendeglista", label: "Esküvői vendéglista" },
    { href: "/eskuvoi-koltsegvetes-tervezo", label: "Esküvői költségvetés tervező" },
    { href: "/eskuvoi-ultetesi-rend-tervezo", label: "Esküvői ültetési rend tervező" },
    { href: "/online-eskuvoi-rsvp", label: "Online esküvői RSVP" },
  ],
  cta: {
    title: "Ha közben terveznétek is, ne csak olvasnátok",
    body: "A Weddlyben a vendéglista, a költségvetés és az ültetés ugyanarra a közös, naprakész adatra épül.",
    href: "/signup",
    label: "Regisztráció",
  },
};

export const MARKETING_PAGES: Readonly<Record<string, MarketingPage>> = Object.fromEntries(
  [...featurePages, hub, ...guidePages].map((page) => [page.path, page]),
);

export const FEATURE_PAGE_PATHS = featurePages.map((page) => page.path);
export const GUIDE_PAGE_PATHS = [hub.path, ...guidePages.map((page) => page.path)];

export function marketingPageForPath(pathname: string): MarketingPage | null {
  const normalized = pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return MARKETING_PAGES[normalized] ?? null;
}
