// Ready-made WeddlyMarket questions, grouped by the moment of the day they
// belong to, so a couple starts from a full board instead of a blank form.
// Written in EN and HU; every other UI locale reads the EN text, the same
// per-key fallback the app's own copy uses. `opening` is a suggested starting
// line for YES (see MARKET_OPENING_OPTIONS): a few questions are obviously
// lopsided, and opening those at 50/50 would hand the first bettor a freebie.
//
// Over/under questions are phrased as a plain yes/no ("Will the speech run
// over 7 minutes?"), which is exactly what an over/under is in a two-pool
// pari-mutuel market.

export type MarketPackId = "ceremony" | "speeches" | "dinner" | "party" | "late_night";

export interface MarketPackQuestion {
  en: string;
  hu: string;
  opening?: number;
}

export interface MarketPack {
  id: MarketPackId;
  emoji: string;
  questions: readonly MarketPackQuestion[];
}

export const MARKET_PACKS: readonly MarketPack[] = [
  {
    id: "ceremony",
    emoji: "💍",
    questions: [
      { en: "Will the groom cry before the vows?", hu: "Elsírja magát a vőlegény az eskü előtt?" },
      {
        en: "Will someone stumble over a line in the vows?",
        hu: "Belesül valaki egy mondatba az eskü alatt?",
        opening: 60,
      },
      {
        en: "Will a phone ring during the ceremony?",
        hu: "Megszólal egy telefon a szertartás alatt?",
        opening: 30,
      },
      {
        en: "Will the ring get stuck on the finger?",
        hu: "Megakad a gyűrű az ujjon?",
        opening: 30,
      },
      {
        en: "Will the first kiss last over 5 seconds?",
        hu: "Tovább tart az első csók 5 másodpercnél?",
      },
      { en: "Will the ceremony start late?", hu: "Késve kezdődik a szertartás?", opening: 70 },
      { en: "Will a kid steal the show?", hu: "Elviszi a show-t egy gyerek?", opening: 40 },
    ],
  },
  {
    id: "speeches",
    emoji: "🎤",
    questions: [
      {
        en: "Will the best man's speech run over 7 minutes?",
        hu: "Tovább tart a tanú beszéde 7 percnél?",
      },
      { en: "Will the best man mention an ex?", hu: "Szóba hoz a tanú egy exet?", opening: 30 },
      {
        en: "Will a parent cry during their speech?",
        hu: "Elsírja magát egy szülő a beszéde közben?",
        opening: 60,
      },
      {
        en: "Will a speech get a standing ovation?",
        hu: "Állva tapsolnak meg egy beszédet?",
        opening: 30,
      },
      {
        en: "Will anyone read their speech off a phone?",
        hu: "Telefonról olvassa fel valaki a beszédét?",
        opening: 60,
      },
      {
        en: "Will the couple be roasted harder than toasted?",
        hu: "Inkább szívatás lesz, mint köszöntő?",
      },
      {
        en: "Will the mic cut out at least once?",
        hu: "Legalább egyszer elmegy a mikrofon?",
        opening: 40,
      },
    ],
  },
  {
    id: "dinner",
    emoji: "🍰",
    questions: [
      { en: "Will the cake be cut before 22:00?", hu: "22:00 előtt felvágják a tortát?" },
      {
        en: "Will the couple smash cake in each other's face?",
        hu: "Egymás arcába nyomják a tortát?",
        opening: 30,
      },
      {
        en: "Will a glass get smashed by accident?",
        hu: "Véletlenül összetörik egy pohár?",
        opening: 60,
      },
      {
        en: "Will someone ask for seconds of dessert?",
        hu: "Kér valaki repetát a desszertből?",
        opening: 80,
      },
      {
        en: "Will a guest spill wine on their outfit?",
        hu: "Leönti valaki borral a ruháját?",
        opening: 60,
      },
      {
        en: "Will the couple get to finish their main course?",
        hu: "Sikerül a párnak megennie a főételt?",
        opening: 40,
      },
      {
        en: "Will someone tap a glass for a kiss more than 5 times?",
        hu: "Ötnél többször kocogtatják meg a poharat egy csókért?",
      },
    ],
  },
  {
    id: "party",
    emoji: "🪩",
    questions: [
      {
        en: "Will the first dance last over 3 minutes?",
        hu: "Tovább tart az első tánc 3 percnél?",
      },
      {
        en: "Will the first person on the dance floor be over 60?",
        hu: "60 év feletti lesz az első a táncparketten?",
        opening: 40,
      },
      { en: "Will the bouquet land on someone under 25?", hu: "25 év alatti kapja el a csokrot?" },
      { en: "Will the DJ play ABBA?", hu: "Játszik ABBA-t a DJ?", opening: 70 },
      {
        en: "Will someone attempt the worm?",
        hu: "Megpróbálja valaki a kukacot a parketten?",
        opening: 30,
      },
      {
        en: "Will the groom take his jacket off before midnight?",
        hu: "Leveszi a zakóját a vőlegény éjfél előtt?",
        opening: 70,
      },
      { en: "Will there be a conga line?", hu: "Lesz vonatozás?", opening: 60 },
      { en: "Will the bride change shoes?", hu: "Cipőt vált a menyasszony?", opening: 60 },
    ],
  },
  {
    id: "late_night",
    emoji: "🌙",
    questions: [
      {
        en: "Will anyone still be dancing at 3:00?",
        hu: "Táncol még valaki hajnali 3-kor?",
        opening: 60,
      },
      {
        en: "Will someone fall asleep at their table?",
        hu: "Elalszik valaki az asztalánál?",
        opening: 40,
      },
      { en: "Will there be a karaoke moment?", hu: "Lesz rögtönzött karaoke?" },
      { en: "Will someone lose a shoe?", hu: "Elhagyja valaki a cipőjét?", opening: 40 },
      {
        en: "Will the couple leave before the last guest?",
        hu: "Hamarabb lelép a pár, mint az utolsó vendég?",
        opening: 60,
      },
      {
        en: "Will someone order a pizza to the venue?",
        hu: "Rendel valaki pizzát a helyszínre?",
        opening: 20,
      },
    ],
  },
];

export function packQuestionText(q: MarketPackQuestion, locale: string): string {
  return locale === "hu" ? q.hu : q.en;
}
