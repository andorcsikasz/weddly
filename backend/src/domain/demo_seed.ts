// Shrek & Fiona demo wedding seeder. Builds one fully-furnished couple
// workspace, guests, households, budget, transfers, accommodations, schedule,
// planning tasks, seating tables, so a landing-page visitor lands in /app
// with every surface already populated. Designed to be funny but every row is
// shaped like real production data, so the visitor sees the actual UI.
//
// One entry point: seedShrekDemo(coupleId). Caller is responsible for creating
// the empty couple row + linking the owner user; this function only writes the
// child tables. All writes happen inside a single transaction so a mid-seed
// failure rolls back cleanly.

import { db, now } from "../db";
import { generateInviteCode, generateHouseholdCode } from "./invite_codes";
import { purgeOneCouple } from "./purge";

/** Locale the demo dataset is written in. Mirrors the frontend `Locale`. */
export type DemoLocale = "hu" | "en";

/** A localisable seed string. Plain string = same in both languages (names
 *  like "Shrek" or "Fiona"); the object form carries both translations. */
export type LText = string | { en: string; hu: string };

/** Resolve a localisable string for the given locale. */
export function pickL(l: LText, locale: DemoLocale): string {
  return typeof l === "string" ? l : l[locale];
}

/** Canonical (EN) form of a localisable string — used as the stable key for
 *  cross-references inside the seed (seat assignments, accommodation and
 *  transfer rosters point at guests by this key, never the localised name). */
export function keyL(l: LText): string {
  return typeof l === "string" ? l : l.en;
}

/** Wedding date for the demo: ~120 days from now, snapped to a Saturday.
 *  Recomputed every demo so the dashboard's countdown is always meaningful. */
function demoWeddingDate(): string {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 120);
  // Snap forward to Saturday (6 = Sat). 0 = Sun … 6 = Sat.
  const dow = base.getUTCDay();
  const delta = (6 - dow + 7) % 7;
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

interface GuestSeed {
  full_name: LText;
  group_tag:
    | "his_family"
    | "her_family"
    | "his_friends"
    | "her_friends"
    | "shared_friends"
    | "work"
    | "other";
  kind: "adult" | "child" | "baby";
  rsvp_status: "pending" | "yes" | "no" | "maybe";
  meal_choice: "meat" | "fish" | "vegetarian" | "vegan" | "child" | "none" | null;
  dietary: LText | null;
  notes: LText | null;
}

interface HouseholdSeed {
  label: LText;
  group_tag: GuestSeed["group_tag"];
  notes: LText | null;
  members: GuestSeed[];
}

/** The fairytale guest list, 15 named guests organised into households so
 *  the household view, RSVP flow, dietary aggregates and seating chart all
 *  show non-trivial data on first load. */
const HOUSEHOLDS: HouseholdSeed[] = [
  {
    label: { en: "King Harold & Queen Lillian", hu: "Harold király és Lillian királynő" },
    group_tag: "her_family",
    notes: {
      en: "Bride's parents. Royal protocol, please.",
      hu: "A menyasszony szülei. Királyi protokoll, kérjük.",
    },
    members: [
      {
        full_name: { en: "King Harold", hu: "Harold király" },
        group_tag: "her_family",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "fish",
        dietary: {
          en: "no shellfish, turns back into a frog",
          hu: "kagylófélék nélkül, visszaváltozik békává",
        },
        notes: { en: "Father of the bride.", hu: "A menyasszony édesapja." },
      },
      {
        full_name: { en: "Queen Lillian", hu: "Lillian királynő" },
        group_tag: "her_family",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "meat",
        dietary: null,
        notes: { en: "Mother of the bride.", hu: "A menyasszony édesanyja." },
      },
    ],
  },
  {
    label: { en: "Donkey & Dragon", hu: "Szamár és Sárkány" },
    group_tag: "his_friends",
    notes: {
      en: "Best man + plus one. Dragon needs a wide aisle.",
      hu: "Tanú + kísérő. Sárkánynak széles átjáró kell.",
    },
    members: [
      {
        full_name: { en: "Donkey", hu: "Szamár" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: {
          en: "waffles, parfait, layered desserts",
          hu: "gofri, parfé, réteges desszertek",
        },
        notes: {
          en: "BEST MAN. Will talk through the ceremony.",
          hu: "TANÚ. Végig fogja beszélni a szertartást.",
        },
      },
      {
        full_name: { en: "Dragon", hu: "Sárkány" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "meat",
        dietary: { en: "extra spicy, fire-breather", hu: "extra csípős, tűzokádó" },
        notes: {
          en: "Tail does not fit under round tables.",
          hu: "A farka nem fér el a kerek asztalok alatt.",
        },
      },
    ],
  },
  {
    label: { en: "Puss in Boots", hu: "Csizmás Kandúr" },
    group_tag: "shared_friends",
    notes: {
      en: "Bringing his own sword. Will sit in a small chair.",
      hu: "Hozza a saját kardját. Kis széken ül.",
    },
    members: [
      {
        full_name: { en: "Puss in Boots", hu: "Csizmás Kandúr" },
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "fish",
        dietary: {
          en: "lactose intolerant, but loves cream",
          hu: "laktózérzékeny, de imádja a tejszínt",
        },
        notes: { en: "Eyes will be deployed.", hu: "A nagy szemek bevetésre kerülnek." },
      },
    ],
  },
  {
    label: { en: "The Three Little Pigs", hu: "A három kismalac" },
    group_tag: "his_friends",
    notes: {
      en: "Came as a household. Please seat together, away from any wolves.",
      hu: "Egy háztartásként jönnek. Kérjük együtt ültetni, farkasoktól távol.",
    },
    members: [
      {
        full_name: { en: "Pig One (Straw)", hu: "Első kismalac (szalma)" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: null,
        notes: null,
      },
      {
        full_name: { en: "Pig Two (Sticks)", hu: "Második kismalac (gally)" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "maybe",
        meal_choice: "vegetarian",
        dietary: null,
        notes: {
          en: "Anxious, depends on the wolf situation.",
          hu: "Izgul, a farkashelyzettől függ.",
        },
      },
      {
        full_name: { en: "Pig Three (Bricks)", hu: "Harmadik kismalac (tégla)" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: null,
        notes: {
          en: "Will give a structured toast.",
          hu: "Jól felépített pohárköszöntőt mond.",
        },
      },
    ],
  },
  {
    label: { en: "Gingy", hu: "Mézi" },
    group_tag: "his_friends",
    notes: {
      en: "Will arrive in a small cookie tin. No oven seating.",
      hu: "Kis kekszesdobozban érkezik. Sütő közelébe ne ültessük.",
    },
    members: [
      {
        full_name: { en: "Gingerbread Man", hu: "Mézeskalács Ember" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "none",
        dietary: { en: "gluten-free (paradoxically)", hu: "gluténmentes (paradox módon)" },
        notes: { en: "Do NOT dunk in milk.", hu: "TILOS tejbe mártani." },
      },
    ],
  },
  {
    label: { en: "Pinocchio & Geppetto", hu: "Pinokkió és Geppetto" },
    group_tag: "shared_friends",
    notes: { en: "Lie-detector seating.", hu: "Hazugságvizsgáló ültetés." },
    members: [
      {
        full_name: { en: "Pinocchio", hu: "Pinokkió" },
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegan",
        dietary: { en: "no wood-fired pizza", hu: "fatüzelésű pizza kizárva" },
        notes: {
          en: "Says he RSVPed. Nose did NOT grow.",
          hu: "Azt mondja, visszajelzett. Az orra NEM nőtt meg.",
        },
      },
      {
        full_name: "Geppetto",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "fish",
        dietary: null,
        notes: null,
      },
    ],
  },
  {
    label: { en: "Fairy Godmother", hu: "Tündérkeresztanya" },
    group_tag: "her_family",
    notes: {
      en: "Plus-one declined. RSVPed in glitter.",
      hu: "Kísérő nélkül. Csillámporral jelzett vissza.",
    },
    members: [
      {
        full_name: { en: "Fairy Godmother", hu: "Tündérkeresztanya" },
        group_tag: "her_family",
        kind: "adult",
        rsvp_status: "no",
        meal_choice: null,
        dietary: null,
        notes: { en: "Declined, long story.", hu: "Lemondta, hosszú történet." },
      },
    ],
  },
  {
    label: "Lord Farquaad",
    group_tag: "other",
    notes: { en: "Awkward invite. Decline expected.", hu: "Kínos meghívó. Lemondás várható." },
    members: [
      {
        full_name: "Lord Farquaad",
        group_tag: "other",
        kind: "adult",
        rsvp_status: "no",
        meal_choice: null,
        dietary: null,
        notes: {
          en: "He is not invited. He is on the list.",
          hu: "Nincs meghívva. Rajta van a listán.",
        },
      },
    ],
  },
  {
    label: { en: "Magic Mirror", hu: "Varázstükör" },
    group_tag: "work",
    notes: {
      en: "Coming with the venue. Will MC.",
      hu: "A helyszínnel érkezik. Ő lesz a ceremóniamester.",
    },
    members: [
      {
        full_name: { en: "Magic Mirror", hu: "Varázstükör" },
        group_tag: "work",
        kind: "adult",
        rsvp_status: "pending",
        meal_choice: null,
        dietary: null,
        notes: {
          en: "Will reflect on the speeches.",
          hu: "A beszédekre majd reflektál. Szó szerint.",
        },
      },
    ],
  },
  {
    label: { en: "Three Blind Mice", hu: "A három vak egér" },
    group_tag: "shared_friends",
    notes: {
      en: "Need help finding their seats, please print large place cards.",
      hu: "Segítség kell a helyük megtalálásához, kérünk nagy betűs ültetőkártyát.",
    },
    members: [
      {
        full_name: { en: "Mouse #1", hu: "1. egér" },
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: { en: "cheese plate, please", hu: "sajttál, kérjük" },
        notes: null,
      },
      {
        full_name: { en: "Mouse #2", hu: "2. egér" },
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: null,
        notes: null,
      },
      {
        full_name: { en: "Mouse #3", hu: "3. egér" },
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: null,
        notes: null,
      },
    ],
  },
];

/** Budget, Forints. Roughly mirrors DEFAULT_BUDGET_SPLIT but each line gets
 *  a Far-Far-Away-flavoured label so the visitor reads them as the demo's. */
const BUDGET_LINES: Array<{
  category:
    | "venue"
    | "catering"
    | "drinks"
    | "attire"
    | "decor_floral"
    | "photo_video"
    | "music_dj"
    | "cake_dessert"
    | "hair_makeup"
    | "transport"
    | "honeymoon"
    | "stationery"
    | "favours"
    | "rings"
    | "other";
  label: LText;
  planned: number;
  actual: number;
  notes: LText | null;
}> = [
  // Sized for an intimate 15-guest HU wedding, ~3.2M HUF total,
  // ~215K per guest. Sits between the mid (90K/fő) and max (150K/fő) bands
  // in shared/budget_benchmarks.ts for ≤30-guest weddings: the demo is meant
  // to look like a boutique wedding, not a Vegas elopement or a 200-fő bash.
  {
    category: "venue",
    label: { en: "Swamp clearing + small marquee", hu: "Mocsári tisztás + kis rendezvénysátor" },
    planned: 720_000,
    actual: 360_000,
    notes: { en: "Half-deposit paid.", hu: "Fél előleg kifizetve." },
  },
  {
    category: "catering",
    label: {
      en: "Far Far Away catering, onion-forward menu",
      hu: "Túl az Óperencián catering, hagyma-központú menü",
    },
    planned: 450_000,
    actual: 0,
    notes: null,
  },
  {
    category: "drinks",
    label: { en: "Bog-water bar + mead pairings", hu: "Lápvíz-bár + mézsör-párosítások" },
    planned: 150_000,
    actual: 0,
    notes: null,
  },
  {
    category: "attire",
    label: {
      en: "Ogre-cut wedding dress + Shrek's vest",
      hu: "Ogre-szabású menyasszonyi ruha + Shrek mellénye",
    },
    planned: 280_000,
    actual: 280_000,
    notes: { en: "Tailor: Wolf in Granny's Clothes.", hu: "Szabó: Farkas nagyi ruhájában." },
  },
  {
    category: "decor_floral",
    label: {
      en: "Swamp lilies + fire-resistant garlands",
      hu: "Mocsári liliomok + tűzálló girlandok",
    },
    planned: 180_000,
    actual: 60_000,
    notes: { en: "Dragon-proof centrepieces.", hu: "Sárkánybiztos asztaldíszek." },
  },
  {
    category: "photo_video",
    label: { en: "Magic Mirror live broadcast", hu: "Varázstükör élő közvetítés" },
    planned: 420_000,
    actual: 420_000,
    notes: {
      en: "Books fast, Mirror is in high demand.",
      hu: "Gyorsan betelik, a Tükör nagyon keresett.",
    },
  },
  {
    category: "music_dj",
    label: {
      en: "DJ Donkey & the Three Pigs (live)",
      hu: "DJ Szamár és a három kismalac (élőben)",
    },
    planned: 180_000,
    actual: 180_000,
    notes: { en: "Setlist negotiated.", hu: "Számlista leegyeztetve." },
  },
  {
    category: "cake_dessert",
    label: {
      en: "Seven-tier ogre cake + Gingy croquembouche",
      hu: "Hétemeletes ogretorta + Mézi croquembouche",
    },
    planned: 90_000,
    actual: 0,
    notes: { en: "Order 6 weeks out.", hu: "6 héttel előre rendelendő." },
  },
  {
    category: "hair_makeup",
    label: { en: "Royal grooming, Fiona prep", hu: "Királyi szépészet, Fiona készülődés" },
    planned: 75_000,
    actual: 0,
    notes: null,
  },
  {
    category: "transport",
    label: { en: "Donkey shuttle service", hu: "Szamár-transzferjárat" },
    planned: 90_000,
    actual: 90_000,
    notes: { en: "Round trips. Loud. Reliable.", hu: "Oda-vissza járatok. Hangos. Megbízható." },
  },
  {
    category: "honeymoon",
    label: {
      en: "Honeymoon, Honeymoon Isle (the literal one)",
      hu: "Nászút, Nászút-sziget (szó szerint az)",
    },
    planned: 320_000,
    actual: 0,
    notes: null,
  },
  {
    category: "stationery",
    label: { en: "Scroll-style invites + place cards", hu: "Tekercses meghívók + ültetőkártyák" },
    planned: 60_000,
    actual: 60_000,
    notes: null,
  },
  {
    category: "favours",
    label: {
      en: "Onion-themed favours (peeling guide included)",
      hu: "Hagymás köszönőajándékok (hámozási útmutatóval)",
    },
    planned: 30_000,
    actual: 0,
    notes: null,
  },
  {
    category: "rings",
    label: { en: "Wedding bands, solid iron", hu: "Karikagyűrűk, tömör vasból" },
    planned: 180_000,
    actual: 180_000,
    notes: { en: "Resized for ogre fingers.", hu: "Ogreméretű ujjakra igazítva." },
  },
];

interface SchedSeed {
  label: LText;
  starts_at_minutes: number;
  duration_minutes: number | null;
  location: LText | null;
  notes: LText | null;
}

const SCHEDULE_EVENTS: SchedSeed[] = [
  {
    label: {
      en: "Donkey arrives (early, as always)",
      hu: "Szamár megérkezik (korán, mint mindig)",
    },
    starts_at_minutes: 9 * 60,
    duration_minutes: 30,
    location: { en: "Swamp gate", hu: "Mocsárkapu" },
    notes: { en: "Bring his own coffee.", hu: "Hozza a saját kávéját." },
  },
  {
    label: { en: "Hair & makeup, Fiona", hu: "Haj és smink, Fiona" },
    starts_at_minutes: 10 * 60,
    duration_minutes: 90,
    location: { en: "The royal tent", hu: "A királyi sátor" },
    notes: null,
  },
  {
    label: { en: "Guest arrivals + welcome drinks", hu: "Vendégek érkezése + welcome drink" },
    starts_at_minutes: 14 * 60,
    duration_minutes: 60,
    location: { en: "Swamp clearing", hu: "Mocsári tisztás" },
    notes: { en: "Mead on tap.", hu: "Csapolt mézsör." },
  },
  {
    label: { en: "Ceremony, Shrek + Fiona", hu: "Szertartás, Shrek + Fiona" },
    starts_at_minutes: 15 * 60 + 30,
    duration_minutes: 45,
    location: { en: "Onion arch", hu: "Hagymaboltív" },
    notes: { en: "Magic Mirror live-broadcasts.", hu: "A Varázstükör élőben közvetít." },
  },
  {
    label: { en: "Photos (Magic Mirror)", hu: "Fotózás (Varázstükör)" },
    starts_at_minutes: 16 * 60 + 30,
    duration_minutes: 60,
    location: { en: "Far Far Away meadow", hu: "Túl az Óperencián rét" },
    notes: null,
  },
  {
    label: { en: "Dinner served", hu: "Vacsora" },
    starts_at_minutes: 18 * 60,
    duration_minutes: 120,
    location: { en: "Marquee", hu: "Rendezvénysátor" },
    notes: null,
  },
  {
    label: { en: "First dance", hu: "Nyitótánc" },
    starts_at_minutes: 20 * 60 + 30,
    duration_minutes: 15,
    location: { en: "Dance floor", hu: "Táncparkett" },
    notes: '"I\'m a Believer"',
  },
  {
    label: { en: "Best-man speech (Donkey)", hu: "Tanú beszéde (Szamár)" },
    starts_at_minutes: 21 * 60,
    duration_minutes: 20,
    location: { en: "Marquee", hu: "Rendezvénysátor" },
    notes: {
      en: "Hard cap: 20 min. (Likely will run over.)",
      hu: "Kemény limit: 20 perc. (Úgyis túllépi.)",
    },
  },
  {
    label: { en: "Cake cutting, seven-tier ogre cake", hu: "Tortavágás, hétemeletes ogretorta" },
    starts_at_minutes: 21 * 60 + 30,
    duration_minutes: 15,
    location: { en: "Marquee", hu: "Rendezvénysátor" },
    notes: null,
  },
  {
    label: { en: "Dance floor opens (DJ Donkey)", hu: "Táncparkett nyit (DJ Szamár)" },
    starts_at_minutes: 22 * 60,
    duration_minutes: 180,
    location: { en: "Marquee", hu: "Rendezvénysátor" },
    notes: null,
  },
  {
    label: { en: "Last call + Donkey shuttle departs", hu: "Utolsó kör + Szamár-transzfer indul" },
    starts_at_minutes: 25 * 60,
    duration_minutes: 30,
    location: { en: "Swamp gate", hu: "Mocsárkapu" },
    notes: { en: "Past midnight, day-2 row.", hu: "Éjfél után, másnapi sor." },
  },
];

interface PlanningSeed {
  kind: "task" | "idea" | "schedule";
  topic: "wedding" | "honeymoon" | null;
  title: LText;
  body: LText | null;
  done: boolean;
  /** Days before the wedding the task starts. Negative = before, null = no
   *  range (the row falls into the "open ranges" panel on /app/timeline). */
  start_offset: number | null;
  /** Days before the wedding the task is due. Pair with `start_offset` to
   *  draw a Gantt bar; pair with null start_offset to draw a single-day
   *  milestone marker. */
  due_offset: number | null;
  assignee: LText | null;
  priority: 0 | 1 | 2;
}

const DONKEY: LText = { en: "Donkey", hu: "Szamár" };

const PLANNING_ITEMS: PlanningSeed[] = [
  // Done tasks, drawn as solid bars in the past months. Spaced so the
  // Gantt reads chronologically: venue first, then suppliers, then invites.
  {
    kind: "task",
    topic: "wedding",
    title: { en: "Book the swamp", hu: "Mocsár lefoglalása" },
    body: {
      en: "Confirm with the Witch, onion fields included.",
      hu: "Megerősítés a boszorkánnyal, hagymaföldekkel együtt.",
    },
    done: true,
    start_offset: -150,
    due_offset: -135,
    assignee: "Shrek",
    priority: 0,
  },
  {
    kind: "task",
    topic: "wedding",
    title: { en: "Hire Magic Mirror as photographer", hu: "Varázstükör felkérése fotósnak" },
    body: { en: "Negotiated rate.", hu: "Lealkudott ár." },
    done: true,
    start_offset: -130,
    due_offset: -110,
    assignee: "Fiona",
    priority: 0,
  },
  {
    kind: "task",
    topic: "wedding",
    title: { en: "Send invites", hu: "Meghívók kiküldése" },
    body: { en: "Pinocchio is delivering by hand.", hu: "Pinokkió kézbesíti személyesen." },
    done: true,
    start_offset: -95,
    due_offset: -80,
    assignee: DONKEY,
    priority: 1,
  },
  // Open tasks, bars staggered through the next 6 weeks so the Gantt has
  // visible parallel lanes rather than one straight column.
  {
    kind: "task",
    topic: "wedding",
    title: { en: "Final dress fitting", hu: "Utolsó ruhapróba" },
    body: {
      en: "Ogre-cut alteration, needs one more pass.",
      hu: "Ogre-szabású igazítás, még egy kör kell.",
    },
    done: false,
    start_offset: -42,
    due_offset: -21,
    assignee: "Fiona",
    priority: 1,
  },
  {
    kind: "task",
    topic: "wedding",
    title: { en: "Order the cake (seven tiers)", hu: "Torta megrendelése (hét emelet)" },
    body: null,
    done: false,
    start_offset: -60,
    due_offset: -45,
    assignee: "Shrek",
    priority: 1,
  },
  {
    kind: "task",
    topic: "wedding",
    title: {
      en: "Chase Fairy Godmother for plus-one",
      hu: "Tündérkeresztanya kísérőjének utánajárni",
    },
    body: {
      en: "She RSVPed no, see if she'll bring Charming anyway.",
      hu: "Nemet mondott, hátha mégis elhozza a Szőke Herceget.",
    },
    done: false,
    start_offset: -28,
    due_offset: -14,
    assignee: "Fiona",
    priority: 0,
  },
  {
    kind: "task",
    topic: "wedding",
    title: { en: "Confirm Donkey's speech length", hu: "Szamár beszédhosszának egyeztetése" },
    body: { en: "Cap at 20 min. (It will run over.)", hu: "Max 20 perc. (Túl fogja lépni.)" },
    done: false,
    start_offset: -21,
    due_offset: -7,
    assignee: "Shrek",
    priority: 2,
  },
  {
    kind: "task",
    topic: "wedding",
    title: {
      en: "Print place cards & seating chart",
      hu: "Ültetőkártyák és ültetési rend nyomtatása",
    },
    body: {
      en: "A4 + A6 from the Wēddly print export.",
      hu: "A4 + A6 a Wēddly nyomtatási exportból.",
    },
    done: false,
    start_offset: -14,
    due_offset: -3,
    assignee: "Fiona",
    priority: 1,
  },
  // Honeymoon, real, boring travel-prep tasks with a light fairytale
  // garnish. Five entries so /app/honeymoon reads as a populated checklist
  // instead of a single-item placeholder.
  {
    kind: "task",
    topic: "honeymoon",
    title: { en: "Check passport validity", hu: "Útlevél érvényességének ellenőrzése" },
    body: {
      en: "Needs to be valid at least 6 months past the return date.",
      hu: "A visszaút után még legalább 6 hónapig érvényesnek kell lennie.",
    },
    done: true,
    start_offset: -100,
    due_offset: -90,
    assignee: "Shrek",
    priority: 0,
  },
  {
    kind: "task",
    topic: "honeymoon",
    title: { en: "Book Honeymoon Isle flights", hu: "Repjegyek a Nászút-szigetre" },
    body: {
      en: "Round trip. Avoid Lord Farquaad's airline.",
      hu: "Retúr. Lord Farquaad légitársaságát kerüljük.",
    },
    done: false,
    start_offset: -45,
    due_offset: -30,
    assignee: "Shrek",
    priority: 1,
  },
  {
    kind: "task",
    topic: "honeymoon",
    title: { en: "Reserve the Honeymoon Isle villa", hu: "Villa foglalása a Nászút-szigeten" },
    body: { en: "Ocean view, two-room suite.", hu: "Óceánra néző, kétszobás lakosztály." },
    done: false,
    start_offset: -40,
    due_offset: -25,
    assignee: "Fiona",
    priority: 1,
  },
  {
    kind: "task",
    topic: "honeymoon",
    title: { en: "Buy travel insurance", hu: "Utasbiztosítás megkötése" },
    body: { en: "Includes dragon-incident coverage.", hu: "Sárkány-incidensekre is kiterjed." },
    done: false,
    start_offset: -20,
    due_offset: -14,
    assignee: "Fiona",
    priority: 0,
  },
  {
    kind: "task",
    topic: "honeymoon",
    title: { en: "Notify the bank of travel", hu: "Bank értesítése az utazásról" },
    body: {
      en: "Card declines on Honeymoon Isle would be inconvenient.",
      hu: "Kártyaelutasítás a Nászút-szigeten kellemetlen lenne.",
    },
    done: false,
    start_offset: -10,
    due_offset: -3,
    assignee: "Shrek",
    priority: 0,
  },
  {
    kind: "task",
    topic: "honeymoon",
    title: { en: "Pack the essentials", hu: "Alapfelszerelés bepakolása" },
    body: {
      en: "Sunscreen, swimsuit, mosquito spray, charger.",
      hu: "Naptej, fürdőruha, szúnyogriasztó, töltő.",
    },
    done: false,
    start_offset: -7,
    due_offset: -2,
    assignee: null,
    priority: 0,
  },
  // Ideas, no date ranges (`start_offset` + `due_offset` null). The
  // planning page surfaces these under the "ötletek" tab and they're
  // intentionally excluded from the Gantt.
  {
    kind: "idea",
    topic: "wedding",
    title: { en: "Fireworks finale", hu: "Tűzijáték a végén" },
    body: { en: "Dragon. Obviously.", hu: "Sárkány. Nyilván." },
    done: false,
    start_offset: null,
    due_offset: null,
    assignee: null,
    priority: 0,
  },
  {
    kind: "idea",
    topic: "wedding",
    title: { en: "Skip the dance floor, do mud pit", hu: "Táncparkett helyett sárgödör" },
    body: { en: "Floor optional.", hu: "A parkett opcionális." },
    done: false,
    start_offset: null,
    due_offset: null,
    assignee: null,
    priority: 0,
  },
  {
    kind: "idea",
    topic: "wedding",
    title: { en: "Onion bouquet instead of flowers", hu: "Hagymacsokor virág helyett" },
    body: { en: "Layers!", hu: "Rétegek!" },
    done: false,
    start_offset: null,
    due_offset: null,
    assignee: null,
    priority: 0,
  },
];

/** Idempotent helper, generate a household code unique within this couple. */
function uniqueHhCode(coupleId: number): string {
  const stmt = db.prepare("SELECT 1 FROM households WHERE couple_id = ? AND code = ?");
  for (let i = 0; i < 50; i++) {
    const code = generateHouseholdCode();
    if (!stmt.get(coupleId, code)) return code;
  }
  throw new Error(`Could not allocate a unique household code for couple ${coupleId}`);
}

/** Idempotent helper, generate a globally-unique guest invite code. */
function uniqueGuestCode(): string {
  const stmt = db.prepare("SELECT 1 FROM guests WHERE invite_code = ?");
  for (let i = 0; i < 50; i++) {
    const code = generateInviteCode();
    if (!stmt.get(code)) return code;
  }
  throw new Error("Could not allocate a unique invite code");
}

/** Seat assignments, pair each guest_id with a (table_id, seat_index). The
 *  caller passes back the actual IDs after the INSERTs, so we shape the
 *  pre-DB plan as labels + nicknames and resolve them inside the transaction. */
interface SeatPlan {
  /** Tables. mm coordinates land the layout inside the canvas. */
  tables: Array<{
    label: LText;
    shape: "head" | "round" | "long" | "square";
    seats: number;
    x_mm: number;
    y_mm: number;
    width_mm: number;
    length_mm: number;
    is_kids_table: boolean;
  }>;
  /** Per-table seat assignments by CANONICAL (EN) table label + guest
   *  full_name — resolved to real ids at insert time via keyL(). */
  seating: Array<{ table_label: string; seats: Array<{ index: number; full_name: string }> }>;
}

// Table coordinates are in millimetres on the demo's 10 × 15 m portrait
// floor (x: 0..10000, y: 0..15000). `x_mm` / `y_mm` are the table's CENTRE.
// Convention from shared/types.ts:
//   - `width_mm` is the SHORTER side (= the depth for a long/head table).
//   - `length_mm` is the LONGER side (= the horizontal span).
// A 2.4 × 0.9 m head table is therefore length_mm: 2400, width_mm: 900.
//
// Layout: head table centred against the top wall, three round guest
// tables in a triangle below, left + right at mid-room, friends down
// below them, so the portrait floor reads as used end-to-end without
// crowding.
const SEAT_PLAN: SeatPlan = {
  tables: [
    {
      label: { en: "Head table", hu: "Főasztal" },
      shape: "head",
      seats: 6,
      x_mm: 5_000,
      y_mm: 1_500,
      width_mm: 900,
      length_mm: 2_400,
      is_kids_table: false,
    },
    {
      label: { en: "Family, bride's side", hu: "Család, menyasszonyi oldal" },
      shape: "round",
      seats: 8,
      x_mm: 2_500,
      y_mm: 6_000,
      width_mm: 1_500,
      length_mm: 1_500,
      is_kids_table: false,
    },
    {
      label: { en: "Best man's table", hu: "A tanú asztala" },
      shape: "round",
      seats: 8,
      x_mm: 7_500,
      y_mm: 6_000,
      width_mm: 1_500,
      length_mm: 1_500,
      is_kids_table: false,
    },
    {
      label: { en: "Friends, fairytale crowd", hu: "Barátok, mesebeli társaság" },
      shape: "round",
      seats: 8,
      x_mm: 5_000,
      y_mm: 10_500,
      width_mm: 1_500,
      length_mm: 1_500,
      is_kids_table: false,
    },
  ],
  seating: [
    {
      table_label: "Head table",
      seats: [
        { index: 0, full_name: "Shrek" },
        { index: 1, full_name: "Fiona" },
      ],
    },
    {
      table_label: "Family, bride's side",
      seats: [
        { index: 0, full_name: "King Harold" },
        { index: 1, full_name: "Queen Lillian" },
      ],
    },
    {
      table_label: "Best man's table",
      seats: [
        { index: 0, full_name: "Donkey" },
        { index: 1, full_name: "Dragon" },
        { index: 2, full_name: "Puss in Boots" },
      ],
    },
    {
      table_label: "Friends, fairytale crowd",
      seats: [
        { index: 0, full_name: "Pig One (Straw)" },
        { index: 1, full_name: "Pig Three (Bricks)" },
        { index: 2, full_name: "Gingerbread Man" },
        { index: 3, full_name: "Pinocchio" },
        { index: 4, full_name: "Geppetto" },
        { index: 5, full_name: "Mouse #1" },
        { index: 6, full_name: "Mouse #2" },
        { index: 7, full_name: "Mouse #3" },
      ],
    },
  ],
};

interface AccommodationSeed {
  name: LText;
  address: LText | null;
  capacity: number;
  price_huf: number | null;
  link: string | null;
  contact: string | null;
  notes: LText | null;
  /** Resolves to a guest by canonical (EN) full_name at insert time. */
  assigned_to: string[];
}

const ACCOMMODATIONS: AccommodationSeed[] = [
  {
    name: {
      en: "Far Far Away Inn, royal suite",
      hu: "Túl az Óperencián Fogadó, királyi lakosztály",
    },
    address: { en: "1 Cobblestone Square, Far Far Away", hu: "Macskakő tér 1., Túl az Óperencián" },
    capacity: 2,
    price_huf: 95_000,
    link: null,
    contact: "+36 1 555 0000",
    notes: {
      en: "Soundproofed against trumpet announcements.",
      hu: "Hangszigetelt a harsonás bejelentések ellen.",
    },
    assigned_to: ["King Harold", "Queen Lillian"],
  },
  {
    name: { en: "The Swamp Cabin (Shrek's place)", hu: "A mocsári kunyhó (Shrek háza)" },
    address: { en: "Deep in the swamp", hu: "A mocsár mélyén" },
    capacity: 4,
    price_huf: null,
    link: null,
    contact: null,
    notes: { en: "Free. Bring your own mud.", hu: "Ingyenes. Sarat mindenki hozzon magával." },
    assigned_to: ["Donkey", "Dragon"],
  },
  {
    name: { en: "The Three Pigs B&B (brick wing)", hu: "Három Kismalac Panzió (tégla szárny)" },
    address: { en: "End of the lane", hu: "A dűlő vége" },
    capacity: 6,
    price_huf: 32_000,
    link: null,
    contact: null,
    notes: {
      en: "Brick wing only. The other two are still under construction.",
      hu: "Csak a tégla szárny. A másik kettő még építés alatt.",
    },
    assigned_to: ["Pig One (Straw)", "Pig Two (Sticks)", "Pig Three (Bricks)"],
  },
];

interface TransferSeed {
  label: LText;
  direction: LText | null;
  depart_at: string | null;
  capacity: number | null;
  notes: LText | null;
  /** Canonical (EN) guest names, resolved at insert time. */
  assigned_to: string[];
}

const TRANSFERS: TransferSeed[] = [
  {
    label: { en: "Donkey shuttle, pickup", hu: "Szamár-transzfer, odaút" },
    direction: { en: "Far Far Away → Swamp", hu: "Túl az Óperencián → Mocsár" },
    depart_at: null,
    capacity: 6,
    notes: { en: "Loud. Will sing.", hu: "Hangos. Énekelni fog." },
    assigned_to: ["Puss in Boots", "Gingerbread Man", "Pinocchio", "Geppetto"],
  },
  {
    label: { en: "Donkey shuttle, return", hu: "Szamár-transzfer, visszaút" },
    direction: { en: "Swamp → Far Far Away", hu: "Mocsár → Túl az Óperencián" },
    depart_at: null,
    capacity: 6,
    notes: {
      en: "Post-cake. Wear a seatbelt, Donkey takes the corners hard.",
      hu: "Torta után. Öv kötelező, Szamár élesen veszi a kanyarokat.",
    },
    assigned_to: ["Mouse #1", "Mouse #2", "Mouse #3"],
  },
];

export interface SeedResult {
  guests_created: number;
  households_created: number;
  budget_lines_created: number;
  tables_created: number;
  schedule_events_created: number;
  planning_items_created: number;
  accommodations_created: number;
  transfers_created: number;
}

/** Seed the entire Shrek & Fiona demo dataset into a fresh couple workspace.
 *  Caller must have already INSERTed the empty couple row (with bride_name =
 *  "Fiona", groom_name = "Shrek") AND linked the owner user via couple_members.
 *  All writes happen inside one DB transaction. `locale` picks the language
 *  every human-readable seed string is written in — the demo must read fully
 *  HU for Hungarian visitors and fully EN for everyone else. */
export function seedShrekDemo(coupleId: number, locale: DemoLocale = "en"): SeedResult {
  const ts = now();
  const weddingDate = demoWeddingDate();
  /** Resolve an optional localisable string for this seed's locale. */
  const T = (l: LText | null): string | null => (l === null ? null : pickL(l, locale));

  const result: SeedResult = {
    guests_created: 0,
    households_created: 0,
    budget_lines_created: 0,
    tables_created: 0,
    schedule_events_created: 0,
    planning_items_created: 0,
    accommodations_created: 0,
    transfers_created: 0,
  };

  const tx = db.transaction(() => {
    // 0. Stamp the wedding date + ceremony kind on the couple row so the
    //    dashboard's countdown + budget seeding pick up real values.
    db.prepare(
      `UPDATE couples
          SET wedding_date = ?,
              wedding_date_kind = 'exact',
              wedding_target_year = ?,
              wedding_target_month = ?,
              ceremony_kind = 'both',
              honeymoon_destination = ?,
              honeymoon_start_date = ?,
              honeymoon_end_date = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(
      weddingDate,
      Number(weddingDate.slice(0, 4)),
      Number(weddingDate.slice(5, 7)),
      pickL({ en: "Honeymoon Isle", hu: "Nászút-sziget" }, locale),
      // Honeymoon = day after wedding + 7 nights
      addDaysIso(weddingDate, 1),
      addDaysIso(weddingDate, 8),
      ts,
      coupleId,
    );

    // 1. Host household, Shrek & Fiona as guests at their own wedding. The
    //    partner_role markers pin them to the top of /app/guests + /app/seating.
    const hostCode = uniqueHhCode(coupleId);
    const hostHhRes = db
      .prepare(
        "INSERT INTO households (couple_id, code, label, notes, group_tag, auto_created, created_at, updated_at) VALUES (?, ?, ?, NULL, 'other', 0, ?, ?)",
      )
      .run(coupleId, hostCode, "Shrek & Fiona", ts, ts);
    const hostHhId = Number(hostHhRes.lastInsertRowid);
    result.households_created += 1;

    const insertGuest = db.prepare(
      `INSERT INTO guests
         (couple_id, full_name, email, phone, group_tag, invite_code, kind, rsvp_status,
          meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
          song_request, notes, rsvp_responded_at, invited_at, invitation_delivered_at,
          household_id, partner_role, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, ?, ?, ?,
               ?, ?, NULL, NULL, ?,
               ?, ?, ?, ?, NULL,
               ?, ?, ?, ?)`,
    );

    // Bride first so she appears at the top of the household. Parameter
    // order matches the INSERT above, invitation_delivered_at is hardcoded
    // NULL in the SQL, so it does NOT take a positional value here.
    insertGuest.run(
      coupleId,
      "Fiona",
      "her_family",
      uniqueGuestCode(),
      "adult",
      "yes",
      "fish",
      pickL({ en: "no shellfish", hu: "kagylófélék nélkül" }, locale),
      0,
      "Stay (Stay Forever)",
      pickL(
        {
          en: "Bride. Princess by day, ogre by night.",
          hu: "Menyasszony. Nappal hercegnő, éjjel ogre.",
        },
        locale,
      ),
      ts, // rsvp_responded_at
      ts, // invited_at
      hostHhId,
      "bride",
      ts,
      ts,
    );
    insertGuest.run(
      coupleId,
      "Shrek",
      "his_family",
      uniqueGuestCode(),
      "adult",
      "yes",
      "meat",
      pickL({ en: "onions, obviously", hu: "hagyma, természetesen" }, locale),
      0,
      "I'm a Believer",
      pickL({ en: "Groom. Big guy, big heart.", hu: "Vőlegény. Nagy test, nagy szív." }, locale),
      ts,
      ts,
      hostHhId,
      "groom",
      ts,
      ts,
    );
    result.guests_created += 2;

    // 2. Fairytale households.
    const guestIdByName = new Map<string, number>();
    for (const hh of HOUSEHOLDS) {
      const code = uniqueHhCode(coupleId);
      const hhRes = db
        .prepare(
          "INSERT INTO households (couple_id, code, label, notes, group_tag, auto_created, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .run(coupleId, code, pickL(hh.label, locale), T(hh.notes), hh.group_tag, ts, ts);
      const hhId = Number(hhRes.lastInsertRowid);
      result.households_created += 1;
      for (const m of hh.members) {
        const respondedAt = m.rsvp_status === "pending" ? null : ts;
        const r = insertGuest.run(
          coupleId,
          pickL(m.full_name, locale),
          m.group_tag,
          uniqueGuestCode(),
          m.kind,
          m.rsvp_status,
          m.meal_choice,
          T(m.dietary),
          0,
          null,
          T(m.notes),
          respondedAt, // rsvp_responded_at
          ts, // invited_at, invitation_delivered_at stays NULL in SQL
          hhId,
          null,
          ts,
          ts,
        );
        guestIdByName.set(keyL(m.full_name), Number(r.lastInsertRowid));
        result.guests_created += 1;
      }
    }

    // 3. Budget lines.
    const insertBudget = db.prepare(
      `INSERT INTO budget_lines
         (couple_id, category, label, planned_huf, actual_huf, supplier_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    );
    for (const b of BUDGET_LINES) {
      insertBudget.run(
        coupleId,
        b.category,
        pickL(b.label, locale),
        b.planned,
        b.actual,
        T(b.notes),
        ts,
        ts,
      );
      result.budget_lines_created += 1;
    }
    // Stamp the budget ceiling on the couple, sum of planned rows.
    const totalPlanned = BUDGET_LINES.reduce((s, b) => s + b.planned, 0);
    db.prepare(
      "UPDATE couples SET budget_ceiling_huf = ?, budget_kind = 'exact', target_guest_count = ?, guest_count_kind = 'exact', updated_at = ? WHERE id = ?",
    ).run(totalPlanned, 15, ts, coupleId);

    // 4. Schedule events.
    const insertSchedule = db.prepare(
      `INSERT INTO schedule_events
         (couple_id, label, starts_at_minutes, duration_minutes, location, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    for (const e of SCHEDULE_EVENTS) {
      insertSchedule.run(
        coupleId,
        pickL(e.label, locale),
        e.starts_at_minutes,
        e.duration_minutes,
        T(e.location),
        T(e.notes),
        ts,
        ts,
      );
      result.schedule_events_created += 1;
    }

    // 5. Planning items. `start_date` + `due_date` are derived from the
    //    seed's `*_offset` fields (days before the wedding) so the Gantt
    //    on /app/timeline draws each task as a real bar over the months.
    const insertPlanning = db.prepare(
      `INSERT INTO planning_items
         (couple_id, kind, topic, title, body, done, due_date, scheduled_time, position,
          assignee, suggested_by_user_id, start_date, supplier_id, priority,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?,
               ?, NULL, ?, NULL, ?,
               ?, ?)`,
    );
    let pos = 0;
    for (const p of PLANNING_ITEMS) {
      const startDate = p.start_offset !== null ? addDaysIso(weddingDate, p.start_offset) : null;
      const dueDate = p.due_offset !== null ? addDaysIso(weddingDate, p.due_offset) : null;
      insertPlanning.run(
        coupleId,
        p.kind,
        p.topic,
        pickL(p.title, locale),
        T(p.body),
        p.done ? 1 : 0,
        dueDate,
        pos++,
        T(p.assignee),
        startDate,
        p.priority,
        ts,
        ts,
      );
      result.planning_items_created += 1;
    }

    // 6. Seating: tables + assignments.
    const insertTable = db.prepare(
      `INSERT INTO seating_tables
         (couple_id, label, shape, seats, x_mm, y_mm, width_mm, length_mm,
          rotation_deg, disabled_seats_json, baby_seats_json, is_kids_table,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', '[]', ?, ?, ?)`,
    );
    const tableIdByLabel = new Map<string, number>();
    for (const t of SEAT_PLAN.tables) {
      const r = insertTable.run(
        coupleId,
        pickL(t.label, locale),
        t.shape,
        t.seats,
        t.x_mm,
        t.y_mm,
        t.width_mm,
        t.length_mm,
        t.is_kids_table ? 1 : 0,
        ts,
        ts,
      );
      tableIdByLabel.set(keyL(t.label), Number(r.lastInsertRowid));
      result.tables_created += 1;
    }
    const insertAssign = db.prepare(
      "INSERT INTO seat_assignments (table_id, seat_index, guest_id) VALUES (?, ?, ?)",
    );
    // Pre-resolve Shrek + Fiona ids for the head table assignment.
    const shrekRow = db
      .prepare("SELECT id FROM guests WHERE couple_id = ? AND partner_role = 'groom' LIMIT 1")
      .get(coupleId) as { id: number } | undefined;
    const fionaRow = db
      .prepare("SELECT id FROM guests WHERE couple_id = ? AND partner_role = 'bride' LIMIT 1")
      .get(coupleId) as { id: number } | undefined;
    if (shrekRow) guestIdByName.set("Shrek", shrekRow.id);
    if (fionaRow) guestIdByName.set("Fiona", fionaRow.id);
    for (const seat of SEAT_PLAN.seating) {
      const tableId = tableIdByLabel.get(seat.table_label);
      if (!tableId) continue;
      for (const s of seat.seats) {
        const gid = guestIdByName.get(s.full_name);
        if (gid !== undefined) insertAssign.run(tableId, s.index, gid);
      }
    }

    // 7. Accommodations.
    const insertAcc = db.prepare(
      `INSERT INTO accommodations
         (couple_id, name, address, capacity, price_huf, link, contact, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const setGuestAcc = db.prepare(
      "UPDATE guests SET accommodation_id = ?, updated_at = ? WHERE id = ?",
    );
    for (const a of ACCOMMODATIONS) {
      const r = insertAcc.run(
        coupleId,
        pickL(a.name, locale),
        T(a.address),
        a.capacity,
        a.price_huf,
        a.link,
        a.contact,
        T(a.notes),
        ts,
        ts,
      );
      const accId = Number(r.lastInsertRowid);
      result.accommodations_created += 1;
      for (const name of a.assigned_to) {
        const gid = guestIdByName.get(name);
        if (gid !== undefined) setGuestAcc.run(accId, ts, gid);
      }
    }

    // 8. Transfers.
    const insertTransfer = db.prepare(
      `INSERT INTO transfers
         (couple_id, label, direction, depart_at, capacity, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const setGuestTransfer = db.prepare(
      "UPDATE guests SET transfer_id = ?, updated_at = ? WHERE id = ?",
    );
    for (const t of TRANSFERS) {
      const r = insertTransfer.run(
        coupleId,
        pickL(t.label, locale),
        T(t.direction),
        t.depart_at,
        t.capacity,
        T(t.notes),
        ts,
        ts,
      );
      const trId = Number(r.lastInsertRowid);
      result.transfers_created += 1;
      for (const name of t.assigned_to) {
        const gid = guestIdByName.get(name);
        if (gid !== undefined) setGuestTransfer.run(trId, ts, gid);
      }
    }
  });

  tx();
  return result;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Default demo lifetime, 4 hours. Beyond that the workspace is reaped
 *  by the next sweep tick. Visitors abandoning the trial almost always
 *  drop in the first few minutes; anyone still poking around after four
 *  hours is keeping the row warm against the next visitor's fresh start. */
export const DEMO_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** Housekeeping, purge demo couples older than `maxAgeMs`. Called from
 *  three places: inline on `POST /api/demo/start` (lazy cleanup before
 *  the next seed), the boot-time sweep in server.ts, and the hourly
 *  `runPurgeSweep()` in domain/purge.ts so abandoned demos disappear on
 *  their own without depending on landing-page traffic.
 *
 *  Before hard-delete we snapshot the demo's audit_log into `demo_usage`
 * , one row per purged demo capturing lifetime + per-feature event
 *  counts. That preserves the "what did visitors actually try?" signal
 *  for the admin analytics surface even after the source rows are gone.
 *
 *  Demo couples have no audit-retention obligation (they were never real),
 *  so after the snapshot we DELETE the audit_log rows for the couple —
 *  a one-time exception to the append-only contract, scoped to demos.
 *  Required because audit_log.actor_user_id REFERENCES users(id) with
 *  no ON DELETE clause and FKs are enforced, so the user DELETE below
 *  would otherwise fail and the sweep would silently no-op forever. */
export function purgeStaleDemoCouples(maxAgeMs: number = DEMO_MAX_AGE_MS): number {
  const cutoff = now() - maxAgeMs;
  const rows = db
    .prepare(
      "SELECT id, slug, created_at, demo_kind FROM couples WHERE is_demo = 1 AND created_at < ?",
    )
    .all(cutoff) as {
    id: number;
    slug: string | null;
    created_at: number;
    demo_kind: string | null;
  }[];
  if (rows.length === 0) return 0;
  let purged = 0;
  for (const r of rows) {
    try {
      // Capture member user ids BEFORE purgeOneCouple nulls them out, we'll
      // hard-delete those rows below since a demo has no retention claim on
      // them.
      const userIds = (
        db.prepare("SELECT id FROM users WHERE couple_id = ?").all(r.id) as { id: number }[]
      ).map((u) => u.id);

      // Snapshot usage from audit_log BEFORE the rows disappear. We match
      // via couple_id directly so any "demo.start" entry written before the
      // user was linked to the couple is still captured.
      snapshotDemoUsage(r.id, r.slug, r.created_at, userIds, r.demo_kind ?? "couple");

      purgeOneCouple(r.id, { silent: true });

      // Now scrub the audit_log entries for this demo, they were just
      // aggregated into demo_usage and would block the user DELETE under
      // FK enforcement.
      db.prepare("DELETE FROM audit_log WHERE couple_id = ?").run(r.id);
      if (userIds.length > 0) {
        const placeholders = userIds.map(() => "?").join(",");
        db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (${placeholders})`).run(
          ...userIds,
        );
      }

      for (const uid of userIds) {
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(uid);
        db.prepare("DELETE FROM users WHERE id = ?").run(uid);
      }
      db.prepare("DELETE FROM couple_members WHERE couple_id = ?").run(r.id);
      db.prepare("DELETE FROM couples WHERE id = ?").run(r.id);
      purged += 1;
    } catch {
      // Skip a row that fails, next sweep will retry.
    }
  }
  return purged;
}

/** Write a one-row summary of a demo's audit history into `demo_usage`.
 *  Called from `purgeStaleDemoCouples` right before the rows are hard-
 *  deleted. The snapshot survives the purge so admin analytics can keep
 *  showing "147 demos served, top features tried: budget, seating, guests"
 *  long after the underlying workspaces are gone. */
function snapshotDemoUsage(
  coupleId: number,
  slug: string | null,
  createdAt: number,
  userIds: number[],
  kind: string,
): void {
  // Pull every audit row attributable to this demo. We match by couple_id
  // OR actor_user_id ∈ demo's users, the demo.start row is logged with
  // the demo's couple_id, but subsequent in-app actions also stamp
  // actor_user_id so the OR catches any anomalies (e.g. a future action
  // that forgets to set couple_id).
  let auditRows: { action: string }[] = [];
  if (userIds.length === 0) {
    auditRows = db.prepare("SELECT action FROM audit_log WHERE couple_id = ?").all(coupleId) as {
      action: string;
    }[];
  } else {
    const placeholders = userIds.map(() => "?").join(",");
    auditRows = db
      .prepare(
        `SELECT action FROM audit_log
          WHERE couple_id = ? OR actor_user_id IN (${placeholders})`,
      )
      .all(coupleId, ...userIds) as { action: string }[];
  }

  insertDemoUsageSnapshot({
    kind,
    sourceId: coupleId,
    slug,
    createdAt,
    actions: auditRows.map((r) => r.action),
  });
}

/** Aggregate a purged demo's audit actions into one `demo_usage` row.
 *  Shared by all three sweeps: the couples sweep passes the couple id +
 *  its `demo_kind`, the planner/vendor sweeps pass the demo USER id with
 *  kind 'planner' / 'vendor' (source_couple_id is just a stable handle,
 *  not a FK — the source row is gone right after). */
export function insertDemoUsageSnapshot(opts: {
  kind: string;
  sourceId: number;
  slug: string | null;
  createdAt: number;
  actions: string[];
}): void {
  const featureCounts: Record<string, number> = {};
  for (const action of opts.actions) {
    const dot = action.indexOf(".");
    const feature = dot === -1 ? action : action.slice(0, dot);
    featureCounts[feature] = (featureCounts[feature] ?? 0) + 1;
  }

  const purgedAt = now();
  const lifetimeSeconds = Math.max(0, Math.floor((purgedAt - opts.createdAt) / 1000));
  db.prepare(
    `INSERT INTO demo_usage
       (kind, source_couple_id, source_slug, created_at, purged_at,
        lifetime_seconds, total_events, feature_counts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.kind,
    opts.sourceId,
    opts.slug,
    opts.createdAt,
    purgedAt,
    lifetimeSeconds,
    opts.actions.length,
    JSON.stringify(featureCounts),
  );
}
