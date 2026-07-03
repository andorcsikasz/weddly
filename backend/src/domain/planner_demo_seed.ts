// Planner demo seeder. Builds a throwaway "Fairy Godmother Weddings" planner
// account pre-loaded with a whole book of fairy-tale clients so a prospective
// planner visiting /planners can tour the pro tool with real data in it.
//
// It is connected to the couple-side Shrek & Fiona demo: Shrek & Fiona is one
// of the planner's active clients, seeded with the exact same full
// `seedShrekDemo` dataset, so "enter workspace" on that client drops into the
// existing demo experience. A pending, couple-initiated invite from Belle &
// Adam (Beauty & the Beast) surfaces the consent/invite flow on the Clients
// page.
//
// Entry points:
//   - seedPlannerDemo(plannerUserId, { ownerPasswordHash }) — fills the book of
//     business (called from routes/demo.ts after the planner user is created).
//   - purgeStalePlannerDemos() — reaps demo planners older than the demo TTL.
//
// Every couple row it creates is `is_demo = 1`, so the existing
// purgeStaleDemoCouples() sweep reaps the client workspaces; this module only
// has to reap the demo PLANNER user (+ its planner_* rows). See the ordering
// note on purgeStalePlannerDemos.

import { db, now } from "../db";
import { addCoupleMember, assignOrganiserCode } from "./couples";
import { DEMO_MAX_AGE_MS, type DemoLocale, type LText, pickL, seedShrekDemo } from "./demo_seed";
import { generateHouseholdCode, generateInviteCode } from "./invite_codes";
import { uniqueCoupleSlug } from "./slug";

// ── Shared shapes (mirror the couple demo seed) ─────────────────────────────

type GroupTag =
  | "his_family"
  | "her_family"
  | "his_friends"
  | "her_friends"
  | "shared_friends"
  | "work"
  | "other";

interface FtGuest {
  full_name: LText;
  group_tag: GroupTag;
  kind: "adult" | "child" | "baby";
  rsvp: "pending" | "yes" | "no" | "maybe";
  meal?: "meat" | "fish" | "vegetarian" | "vegan" | "child" | null;
  notes?: LText | null;
}

interface FtTask {
  title: LText;
  body: LText;
  done: boolean;
  /** Days relative to the wedding (negative = before). null = no due date. */
  due_offset: number | null;
  assignee: string | null;
  priority: 0 | 1 | 2;
}

interface FtClientSpec {
  /** Slug base for the public couple page (e.g. "CINDERELLA"). */
  slug_base: string;
  display_name: LText;
  bride_name: LText;
  groom_name: LText;
  style_tags: string[];
  /** Days from today to the wedding, snapped forward to a Saturday. */
  wedding_in_days: number;
  guests: FtGuest[];
  /** How many of BASE_TASKS are marked done — tunes the dashboard rollups. */
  task_done_count: number;
  /** Total planned budget in Forint; split across BUDGET_SHARES below. */
  budget_total_huf: number;
  // ── planner-side CRM (planner_clients columns) ──
  link_status: "active" | "pending";
  initiated_by: "planner" | "couple";
  stage: string;
  lead_source: LText;
  contract_value_huf: number;
  deposit_paid_huf: number;
  crm_notes: LText;
}

export interface PlannerDemoResult {
  planner_user_id: number;
  clients_created: number;
  pending_invites: number;
  events_created: number;
  messages_created: number;
}

// ── Local unique-code helpers (private twins of the couple seed's) ──────────

function uniqueHhCode(coupleId: number): string {
  const stmt = db.prepare("SELECT 1 FROM households WHERE couple_id = ? AND code = ?");
  for (let i = 0; i < 50; i++) {
    const code = generateHouseholdCode();
    if (!stmt.get(coupleId, code)) return code;
  }
  throw new Error(`Could not allocate a unique household code for couple ${coupleId}`);
}

function uniqueGuestCode(): string {
  const stmt = db.prepare("SELECT 1 FROM guests WHERE invite_code = ?");
  for (let i = 0; i < 50; i++) {
    const code = generateInviteCode();
    if (!stmt.get(code)) return code;
  }
  throw new Error("Could not allocate a unique invite code");
}

/** Random opaque demo email — same shape + reaping predicate as the couple
 *  demo (`%@demo.weddly.local`) so both sweeps recognise the row. */
function randomDemoEmail(): string {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `demo-${hex}@demo.weddly.local`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Wedding date `days` out, snapped forward to a Saturday (matches the couple
 *  demo's convention so countdowns land on a real weekend). */
function weddingDateInDays(days: number): string {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + days);
  const dow = base.getUTCDay();
  const delta = (6 - dow + 7) % 7;
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Generic (but real) wedding data, parameterised per client ───────────────

/** A standard planner task backlog. `due_offset` = days before the wedding.
 *  Per-client `task_done_count` marks the first N done; the rest stay open so
 *  overdue / due-this-week rollups follow from each client's wedding date. */
const BASE_TASKS: Omit<FtTask, "done">[] = [
  {
    title: { en: "Sign the venue contract", hu: "Helyszín-szerződés aláírása" },
    body: { en: "Deposit wired, date locked.", hu: "Előleg elutalva, dátum rögzítve." },
    due_offset: -300,
    assignee: null,
    priority: 2,
  },
  {
    title: { en: "Book catering", hu: "Catering lefoglalása" },
    body: {
      en: "Tasting scheduled, headcount estimate sent.",
      hu: "Kóstoló egyeztetve, becsült létszám elküldve.",
    },
    due_offset: -260,
    assignee: null,
    priority: 2,
  },
  {
    title: { en: "Hire the photographer", hu: "Fotós leszerződtetése" },
    body: {
      en: "Full-day package + engagement shoot.",
      hu: "Egész napos csomag + jegyesfotózás.",
    },
    due_offset: -240,
    assignee: null,
    priority: 1,
  },
  {
    title: { en: "Order invitations", hu: "Meghívók megrendelése" },
    body: {
      en: "Proof approved, print run placed.",
      hu: "Korrektúra jóváhagyva, nyomtatás megrendelve.",
    },
    due_offset: -180,
    assignee: null,
    priority: 1,
  },
  {
    title: { en: "Send save-the-dates", hu: "Save-the-date kiküldése" },
    body: {
      en: "Digital + printed for the older guests.",
      hu: "Digitális + nyomtatott az idősebb vendégeknek.",
    },
    due_offset: -170,
    assignee: null,
    priority: 1,
  },
  {
    title: { en: "Book the florist", hu: "Virágos lefoglalása" },
    body: { en: "Seasonal palette agreed.", hu: "Szezonális színpaletta leegyeztetve." },
    due_offset: -150,
    assignee: null,
    priority: 1,
  },
  {
    title: { en: "Finalise the menu", hu: "Menü véglegesítése" },
    body: {
      en: "Two mains + vegetarian, kids' plate.",
      hu: "Két főétel + vegetáriánus, gyerektányér.",
    },
    due_offset: -120,
    assignee: null,
    priority: 1,
  },
  {
    title: { en: "Order the cake", hu: "Torta megrendelése" },
    body: { en: "Three tiers, tasting booked.", hu: "Három emelet, kóstoló lefoglalva." },
    due_offset: -90,
    assignee: null,
    priority: 0,
  },
  {
    title: { en: "Final dress fitting", hu: "Utolsó ruhapróba" },
    body: {
      en: "Alterations, second fitting if needed.",
      hu: "Igazítások, ha kell, második próba.",
    },
    due_offset: -45,
    assignee: null,
    priority: 1,
  },
  {
    title: { en: "Confirm final headcount", hu: "Végleges létszám megerősítése" },
    body: {
      en: "Chase the stragglers, lock catering.",
      hu: "Lemaradók megsürgetése, catering véglegesítése.",
    },
    due_offset: -21,
    assignee: null,
    priority: 2,
  },
  {
    title: { en: "Build the seating plan", hu: "Ültetési rend összeállítása" },
    body: {
      en: "Tables, dietary flags, escort cards.",
      hu: "Asztalok, étrendi jelölések, ültetőkártyák.",
    },
    due_offset: -14,
    assignee: null,
    priority: 2,
  },
  {
    title: { en: "Rehearsal & run sheet", hu: "Próba és forgatókönyv" },
    body: {
      en: "Walk the order of service with the party.",
      hu: "Szertartásrend átbeszélése a násznéppel.",
    },
    due_offset: -3,
    assignee: null,
    priority: 1,
  },
];

/** How the client's total budget splits across categories. */
const BUDGET_SHARES: { category: string; label: LText; share: number }[] = [
  { category: "venue", label: { en: "Venue & rental", hu: "Helyszín és bérlés" }, share: 0.34 },
  { category: "catering", label: { en: "Catering & bar", hu: "Catering és bár" }, share: 0.28 },
  { category: "photo", label: { en: "Photo & video", hu: "Fotó és videó" }, share: 0.12 },
  { category: "flowers", label: { en: "Flowers & decor", hu: "Virág és dekor" }, share: 0.1 },
  { category: "music", label: { en: "Music & DJ", hu: "Zene és DJ" }, share: 0.08 },
  { category: "attire", label: { en: "Attire & beauty", hu: "Ruha és szépség" }, share: 0.08 },
];

/** A tasteful reception timeline (minutes from midnight). */
const SCHEDULE: {
  label: LText;
  starts_at_minutes: number;
  duration_minutes: number;
  location: LText;
}[] = [
  {
    label: { en: "Ceremony", hu: "Szertartás" },
    starts_at_minutes: 900,
    duration_minutes: 30,
    location: { en: "Chapel", hu: "Kápolna" },
  },
  {
    label: { en: "Couple & family photos", hu: "Páros és családi fotók" },
    starts_at_minutes: 945,
    duration_minutes: 45,
    location: { en: "Garden", hu: "Kert" },
  },
  {
    label: { en: "Reception & dinner", hu: "Fogadás és vacsora" },
    starts_at_minutes: 1020,
    duration_minutes: 240,
    location: { en: "Grand Hall", hu: "Díszterem" },
  },
  {
    label: { en: "First dance", hu: "Nyitótánc" },
    starts_at_minutes: 1200,
    duration_minutes: 20,
    location: { en: "Grand Hall", hu: "Díszterem" },
  },
];

// ── The fairy-tale book of business ─────────────────────────────────────────

const CLIENTS: FtClientSpec[] = [
  {
    slug_base: "CINDERELLA",
    display_name: { en: "Cinderella & Prince Charming", hu: "Hamupipőke & Szőke Herceg" },
    bride_name: { en: "Cinderella", hu: "Hamupipőke" },
    groom_name: { en: "Prince Charming", hu: "Szőke Herceg" },
    style_tags: ["classic", "ballroom"],
    wedding_in_days: 18,
    task_done_count: 10, // near-complete: seating plan is the "due this week" item
    budget_total_huf: 7_800_000,
    link_status: "active",
    initiated_by: "planner",
    stage: "active",
    lead_source: { en: "Referral from the Grand Duke", hu: "Ajánlás a nagyhercegtől" },
    contract_value_huf: 950_000,
    deposit_paid_huf: 475_000,
    crm_notes: {
      en: "Palace ballroom, black-tie. Glass-slipper detail on the escort cards.",
      hu: "Palotabálterem, black-tie. Üvegcipellő-motívum az ültetőkártyákon.",
    },
    guests: [
      {
        full_name: { en: "Fairy Godmother", hu: "Tündérkeresztanya" },
        group_tag: "her_family",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: {
          en: "Officiant + on-call wardrobe.",
          hu: "Szertartásvezető + ügyeletes ruhatár.",
        },
      },
      {
        full_name: { en: "The King", hu: "A király" },
        group_tag: "his_family",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
      },
      {
        full_name: { en: "The Grand Duke", hu: "A nagyherceg" },
        group_tag: "his_family",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: { en: "Brought the slipper.", hu: "Ő hozta a cipellőt." },
      },
      {
        full_name: "Jaq",
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
      },
      {
        full_name: "Gus",
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: { en: "Cheese course, obviously.", hu: "Sajtfogás, természetesen." },
      },
      {
        full_name: "Lady Tremaine",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "no",
        meal: null,
        notes: { en: "Declined. No love lost.", hu: "Lemondta. Nem nagy veszteség." },
      },
      {
        full_name: "Anastasia Tremaine",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "maybe",
        meal: null,
      },
      {
        full_name: "Drizella Tremaine",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "no",
        meal: null,
      },
      {
        full_name: { en: "Prince Charming's aunt", hu: "A Szőke Herceg nagynénje" },
        group_tag: "his_family",
        kind: "adult",
        rsvp: "pending",
        meal: null,
      },
      {
        full_name: { en: "Captain of the Guard", hu: "A testőrkapitány" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "fish",
      },
    ],
  },
  {
    slug_base: "SNOWWHITE",
    display_name: { en: "Snow White & Prince Florian", hu: "Hófehérke & Florian herceg" },
    bride_name: { en: "Snow White", hu: "Hófehérke" },
    groom_name: { en: "Prince Florian", hu: "Florian herceg" },
    style_tags: ["forest", "storybook"],
    wedding_in_days: 240,
    task_done_count: 3, // early stage: venue booked, most of the backlog still open
    budget_total_huf: 5_200_000,
    link_status: "active",
    initiated_by: "planner",
    stage: "proposal",
    lead_source: {
      en: "Enchanted Forest wedding fair",
      hu: "Elvarázsolt erdei esküvőkiállítás",
    },
    contract_value_huf: 720_000,
    deposit_paid_huf: 0,
    crm_notes: {
      en: "Woodland ceremony. Seven groomsmen, sizes on file. Deposit invoice sent.",
      hu: "Erdei szertartás. Hét vőfély, méretek megvannak. Előlegszámla kiküldve.",
    },
    guests: [
      {
        full_name: { en: "Doc", hu: "Tudor" },
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: { en: "Best-man duties.", hu: "Tanúi teendők." },
      },
      {
        full_name: { en: "Grumpy", hu: "Morgó" },
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "no",
        meal: null,
        notes: {
          en: "Says he'll come. He won't. He will.",
          hu: "Azt mondja, jön. Nem jön. De igen.",
        },
      },
      {
        full_name: { en: "Happy", hu: "Vidor" },
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
      },
      {
        full_name: { en: "Sleepy", hu: "Szundi" },
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "pending",
        meal: null,
      },
      {
        full_name: { en: "Bashful", hu: "Szende" },
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
      },
      {
        full_name: { en: "Sneezy", hu: "Hapci" },
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: { en: "Keep him away from the florals.", hu: "A virágdekortól tartsuk távol." },
      },
      {
        full_name: { en: "Dopey", hu: "Kuka" },
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
      },
      {
        full_name: { en: "The Queen Mother", hu: "Az anyakirályné" },
        group_tag: "his_family",
        kind: "adult",
        rsvp: "pending",
        meal: null,
      },
      {
        full_name: { en: "The Huntsman", hu: "A vadász" },
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
      },
      {
        full_name: { en: "Magic Mirror", hu: "Varázstükör" },
        group_tag: "other",
        kind: "adult",
        rsvp: "maybe",
        meal: null,
        notes: {
          en: "Wall-mounted. Needs an outlet.",
          hu: "Falra szerelve érkezik. Konnektor kell neki.",
        },
      },
    ],
  },
  {
    slug_base: "RAPUNZEL",
    display_name: { en: "Rapunzel & Flynn Rider", hu: "Aranyhaj & Flynn Rider" },
    bride_name: { en: "Rapunzel", hu: "Aranyhaj" },
    groom_name: "Flynn Rider",
    style_tags: ["lanterns", "riverside"],
    wedding_in_days: 75,
    task_done_count: 6, // mid-stage: menu + cake slipped and are now overdue
    budget_total_huf: 6_400_000,
    link_status: "active",
    initiated_by: "planner",
    stage: "deposit",
    lead_source: {
      en: "Instagram, the floating lanterns reel",
      hu: "Instagram, a lampionos reel",
    },
    contract_value_huf: 840_000,
    deposit_paid_huf: 420_000,
    crm_notes: {
      en: "Lantern release at dusk, permit confirmed. Chase the caterer, menu is late.",
      hu: "Lampioneresztés alkonyatkor, engedély megvan. Caterer sürgetése, késik a menü.",
    },
    guests: [
      {
        full_name: { en: "The King of Corona", hu: "Corona királya" },
        group_tag: "her_family",
        kind: "adult",
        rsvp: "yes",
        meal: "fish",
        notes: { en: "Father of the bride.", hu: "A menyasszony édesapja." },
      },
      {
        full_name: { en: "The Queen of Corona", hu: "Corona királynéja" },
        group_tag: "her_family",
        kind: "adult",
        rsvp: "yes",
        meal: "fish",
      },
      {
        full_name: { en: "Mother Gothel", hu: "Gothel anya" },
        group_tag: "her_family",
        kind: "adult",
        rsvp: "no",
        meal: null,
        notes: { en: "Not invited. Do not seat.", hu: "Nincs meghívva. Ne ültessük le." },
      },
      {
        full_name: "Pascal",
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: {
          en: "Ring-bearer. Colour-coordinates himself.",
          hu: "Gyűrűhordozó. Magától színben van.",
        },
      },
      {
        full_name: { en: "Hook Hand", hu: "Kampókezű" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: { en: "Piano at the reception.", hu: "Zongorázik a fogadáson." },
      },
      {
        full_name: { en: "Big Nose", hu: "Nagyorrú" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
      },
      {
        full_name: "Vladimir",
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: { en: "Bringing a ceramic unicorn.", hu: "Kerámia unikornist hoz." },
      },
      {
        full_name: { en: "The Stabbington Brothers", hu: "A Stabbington fivérek" },
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "pending",
        meal: null,
      },
      {
        full_name: "Attila",
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "maybe",
        meal: null,
        notes: {
          en: "Cupcakes for the dessert table.",
          hu: "Muffinokat hoz a desszertasztalra.",
        },
      },
    ],
  },
  {
    // Beauty & the Beast — the PENDING, couple-initiated invite. Fully seeded
    // so the moment the demo visitor accepts the invite the workspace is real.
    slug_base: "BELLEADAM",
    display_name: "Belle & Adam",
    bride_name: "Belle",
    groom_name: "Adam",
    style_tags: ["library", "rose"],
    wedding_in_days: 150,
    task_done_count: 5,
    budget_total_huf: 9_100_000,
    link_status: "pending",
    initiated_by: "couple",
    stage: "inquiry",
    lead_source: { en: "Website enquiry", hu: "Webes érdeklődés" },
    contract_value_huf: 0,
    deposit_paid_huf: 0,
    crm_notes: {
      en: "Invited you from their workspace, awaiting your acceptance.",
      hu: "A saját felületükről hívtak meg, elfogadásra vár.",
    },
    guests: [
      {
        full_name: "Maurice",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: { en: "Father of the bride.", hu: "A menyasszony édesapja." },
      },
      {
        full_name: "Mrs. Potts",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: { en: "Tea service, naturally.", hu: "Teafelszolgálás, természetesen." },
      },
      {
        full_name: "Lumière",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "fish",
        notes: { en: "Maître d' for the evening.", hu: "Az este főpincére." },
      },
      {
        full_name: "Cogsworth",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: { en: "Keeper of the run sheet.", hu: "A forgatókönyv őre." },
      },
      { full_name: "Chip", group_tag: "shared_friends", kind: "child", rsvp: "yes", meal: "child" },
      {
        full_name: "Madame de la Grande Bouche",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "maybe",
        meal: null,
      },
      {
        full_name: "Plumette",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
      },
      {
        full_name: "Gaston",
        group_tag: "other",
        kind: "adult",
        rsvp: "no",
        meal: null,
        notes: { en: "Uninvited. Security briefed.", hu: "Nincs meghívva. A biztonságiak tudják." },
      },
    ],
  },
];

// ── Seed one lighter fairy-tale client workspace ────────────────────────────

/** Fill a fresh couple workspace with a believable, enterable dataset: wedding
 *  date, guests, budget, schedule and a task backlog. Lighter than the Shrek
 *  flagship (no seating / accommodation / transfers). All writes are wrapped in
 *  one transaction so a mid-seed failure rolls back cleanly. */
export function seedFairytaleClient(
  coupleId: number,
  spec: FtClientSpec,
  locale: DemoLocale = "en",
): void {
  const ts = now();
  const weddingDate = weddingDateInDays(spec.wedding_in_days);
  const T = (l: LText | null | undefined): string | null => (l == null ? null : pickL(l, locale));

  const tx = db.transaction(() => {
    // 0. Stamp the wedding date + counts on the couple row.
    const confirmed = spec.guests.filter((g) => g.rsvp === "yes").length;
    db.prepare(
      `UPDATE couples
          SET wedding_date = ?, wedding_date_kind = 'exact',
              wedding_target_year = ?, wedding_target_month = ?,
              ceremony_kind = 'both',
              budget_ceiling_huf = ?, budget_kind = 'exact',
              target_guest_count = ?, guest_count_kind = 'exact',
              updated_at = ?
        WHERE id = ?`,
    ).run(
      weddingDate,
      Number(weddingDate.slice(0, 4)),
      Number(weddingDate.slice(5, 7)),
      spec.budget_total_huf,
      Math.max(confirmed, spec.guests.length),
      ts,
      coupleId,
    );

    // 1. Guests — one household per guest keeps the seed compact while still
    //    populating the household + RSVP + dietary views.
    const insertHh = db.prepare(
      "INSERT INTO households (couple_id, code, label, notes, group_tag, auto_created, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, 0, ?, ?)",
    );
    const insertGuest = db.prepare(
      `INSERT INTO guests
         (couple_id, full_name, email, phone, group_tag, invite_code, kind, rsvp_status,
          meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
          song_request, notes, rsvp_responded_at, invited_at, invitation_delivered_at,
          household_id, partner_role, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, ?, ?, ?,
               ?, NULL, NULL, NULL, 0,
               NULL, ?, ?, ?, NULL,
               ?, NULL, ?, ?)`,
    );
    for (const g of spec.guests) {
      const fullName = pickL(g.full_name, locale);
      const hhRes = insertHh.run(coupleId, uniqueHhCode(coupleId), fullName, g.group_tag, ts, ts);
      const respondedAt = g.rsvp === "pending" ? null : ts;
      insertGuest.run(
        coupleId,
        fullName,
        g.group_tag,
        uniqueGuestCode(),
        g.kind,
        g.rsvp,
        g.meal ?? null,
        T(g.notes),
        respondedAt,
        ts,
        Number(hhRes.lastInsertRowid),
        ts,
        ts,
      );
    }

    // 2. Budget lines from the category shares.
    const insertBudget = db.prepare(
      `INSERT INTO budget_lines
         (couple_id, category, label, planned_huf, actual_huf, supplier_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    );
    for (const b of BUDGET_SHARES) {
      const planned = Math.round((spec.budget_total_huf * b.share) / 1000) * 1000;
      // Rough "spend so far" so the budget bars aren't all empty — scaled to
      // how far along the couple is (deposit ratio).
      const spentRatio =
        spec.contract_value_huf > 0 ? spec.deposit_paid_huf / spec.contract_value_huf : 0;
      const actual = Math.round((planned * Math.min(spentRatio, 1)) / 1000) * 1000;
      insertBudget.run(coupleId, b.category, pickL(b.label, locale), planned, actual, ts, ts);
    }

    // 3. Schedule.
    const insertSchedule = db.prepare(
      `INSERT INTO schedule_events
         (couple_id, label, starts_at_minutes, duration_minutes, location, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    );
    SCHEDULE.forEach((e, i) => {
      insertSchedule.run(
        coupleId,
        pickL(e.label, locale),
        e.starts_at_minutes,
        e.duration_minutes,
        pickL(e.location, locale),
        i,
        ts,
        ts,
      );
    });

    // 4. Task backlog — first `task_done_count` marked done; the rest open so
    //    overdue / due-this-week follow from the wedding date.
    const insertPlanning = db.prepare(
      `INSERT INTO planning_items
         (couple_id, kind, topic, title, body, done, due_date, scheduled_time, position,
          assignee, suggested_by_user_id, start_date, supplier_id, priority,
          created_at, updated_at)
       VALUES (?, 'task', 'wedding', ?, ?, ?, ?, NULL, ?,
               ?, NULL, NULL, NULL, ?, ?, ?)`,
    );
    BASE_TASKS.forEach((task, i) => {
      const done = i < spec.task_done_count;
      const dueDate = task.due_offset !== null ? addDaysIso(weddingDate, task.due_offset) : null;
      insertPlanning.run(
        coupleId,
        pickL(task.title, locale),
        pickL(task.body, locale),
        done ? 1 : 0,
        dueDate,
        i,
        task.assignee,
        task.priority,
        ts,
        ts,
      );
    });
  });
  tx();
}

// ── Create a throwaway demo client couple (user + couple + owner link) ──────

interface DemoCoupleInput {
  slug_base: string;
  display_name: string;
  bride_name: string;
  groom_name: string;
  style_tags: string[];
  ownerPasswordHash: string;
}

/** Insert the throwaway owner user + an empty `is_demo=1` couple row, mirroring
 *  routes/demo.ts. Returns the new couple id. Caller seeds the workspace. */
function createDemoClientCouple(input: DemoCoupleInput): number {
  const ts = now();
  const email = randomDemoEmail();
  const userResult = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 1, ?, ?)`,
    )
    .run(email, input.ownerPasswordHash, `${input.bride_name} & ${input.groom_name}`, ts, ts);
  const userId = Number(userResult.lastInsertRowid);

  const coupleResult = db
    .prepare(
      `INSERT INTO couples
         (partner_a_id, partner_b_id, display_name, bride_name, groom_name,
          wedding_date_kind, guest_count_kind, budget_kind,
          style_tags_json, currency, status, is_demo,
          created_at, updated_at, onboarded_at)
       VALUES (?, NULL, ?, ?, ?,
               'exact', 'exact', 'exact',
               ?, 'HUF', 'active', 1,
               ?, ?, ?)`,
    )
    .run(
      userId,
      input.display_name,
      input.bride_name,
      input.groom_name,
      JSON.stringify(input.style_tags),
      ts,
      ts,
      ts,
    );
  const coupleId = Number(coupleResult.lastInsertRowid);

  const slug = uniqueCoupleSlug(input.slug_base, coupleId);
  db.prepare("UPDATE couples SET slug = ?, updated_at = ? WHERE id = ?").run(slug, ts, coupleId);
  assignOrganiserCode(coupleId, ts);

  db.prepare("UPDATE users SET couple_id = ?, role = 'owner', updated_at = ? WHERE id = ?").run(
    coupleId,
    ts,
    userId,
  );
  addCoupleMember(coupleId, userId, "owner");
  return coupleId;
}

// ── Top-level: build the whole planner book of business ─────────────────────

/** Seed the demo planner's clients, calendar and one message thread. The
 *  planner user itself is created by the caller (routes/demo.ts) so the auth
 *  session + billing row are stamped before the workspace fills. `locale`
 *  controls the language of every seeded string so a HU visitor tours a fully
 *  Hungarian book of business and everyone else a fully English one. */
export function seedPlannerDemo(
  plannerUserId: number,
  opts: { ownerPasswordHash: string; locale?: DemoLocale },
): PlannerDemoResult {
  const ts = now();
  const locale: DemoLocale = opts.locale ?? "en";
  const result: PlannerDemoResult = {
    planner_user_id: plannerUserId,
    clients_created: 0,
    pending_invites: 0,
    events_created: 0,
    messages_created: 0,
  };

  const insertLink = db.prepare(
    `INSERT INTO planner_clients
       (planner_user_id, couple_id, status, initiated_by, notes,
        lead_source, contract_value, deposit_paid, stage, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // 1. Flagship: Shrek & Fiona, using the exact couple-demo seed so "enter
  //    workspace" is the existing demo experience.
  const shrekId = createDemoClientCouple({
    slug_base: "SHREKFIONA",
    display_name: "Shrek & Fiona",
    bride_name: "Fiona",
    groom_name: "Shrek",
    style_tags: ["rustic", "garden"],
    ownerPasswordHash: opts.ownerPasswordHash,
  });
  seedShrekDemo(shrekId, locale);
  insertLink.run(
    plannerUserId,
    shrekId,
    "active",
    "planner",
    pickL(
      {
        en: "Flagship client. Swamp ceremony, onion-forward menu. Fully briefed.",
        hu: "Kiemelt ügyfél. Mocsári szertartás, hagyma-központú menü. Minden leegyeztetve.",
      },
      locale,
    ),
    pickL({ en: "Far Far Away referral", hu: "Túl az Óperencián ajánlás" }, locale),
    1_150_000,
    575_000,
    "active",
    ts,
  );
  result.clients_created += 1;
  const clientCoupleIds: { spec: FtClientSpec; coupleId: number }[] = [];

  // 2. The lighter fairy-tale clients.
  for (const spec of CLIENTS) {
    const coupleId = createDemoClientCouple({
      slug_base: spec.slug_base,
      display_name: pickL(spec.display_name, locale),
      bride_name: pickL(spec.bride_name, locale),
      groom_name: pickL(spec.groom_name, locale),
      style_tags: spec.style_tags,
      ownerPasswordHash: opts.ownerPasswordHash,
    });
    seedFairytaleClient(coupleId, spec, locale);
    insertLink.run(
      plannerUserId,
      coupleId,
      spec.link_status,
      spec.initiated_by,
      pickL(spec.crm_notes, locale),
      pickL(spec.lead_source, locale),
      spec.contract_value_huf,
      spec.deposit_paid_huf,
      spec.stage,
      ts,
    );
    clientCoupleIds.push({ spec, coupleId });
    if (spec.link_status === "pending") result.pending_invites += 1;
    else result.clients_created += 1;
  }

  // 3. Calendar events across the coming weeks (+ one standalone planner task).
  const insertEvent = db.prepare(
    `INSERT INTO planner_events
       (planner_user_id, couple_id, title, event_date, start_time, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const bySlug = (slug: string) =>
    clientCoupleIds.find((c) => c.spec.slug_base === slug)?.coupleId ?? null;
  const events: {
    coupleId: number | null;
    title: LText;
    inDays: number;
    time: string | null;
    notes: LText | null;
  }[] = [
    {
      coupleId: null,
      title: { en: "Weekly planning block", hu: "Heti tervezőblokk" },
      inDays: 1,
      time: "09:00",
      notes: { en: "Inbox zero + follow-ups.", hu: "Inbox zero + utánkövetések." },
    },
    {
      coupleId: bySlug("SNOWWHITE"),
      title: {
        en: "Intro call: Snow White & Florian",
        hu: "Bemutatkozó hívás: Hófehérke és Florian",
      },
      inDays: 2,
      time: "11:00",
      notes: { en: "Scope, budget, deposit invoice.", hu: "Feladatkör, büdzsé, előlegszámla." },
    },
    {
      coupleId: shrekId,
      title: { en: "Menu tasting at the swamp", hu: "Menükóstoló a mocsárban" },
      inDays: 6,
      time: "12:30",
      notes: {
        en: "Onion five ways. Bring antacids.",
        hu: "Hagyma ötféleképpen. Savlekötőt hozni.",
      },
    },
    {
      coupleId: bySlug("RAPUNZEL"),
      title: { en: "Dress fitting: Rapunzel", hu: "Ruhapróba: Aranyhaj" },
      inDays: 9,
      time: "14:00",
      notes: { en: "Second fitting, veil length.", hu: "Második próba, fátyolhossz." },
    },
    {
      coupleId: bySlug("CINDERELLA"),
      title: {
        en: "Final venue walkthrough: Cinderella",
        hu: "Utolsó helyszínbejárás: Hamupipőke",
      },
      inDays: 13,
      time: "10:00",
      notes: { en: "Load-in times, ballroom layout.", hu: "Pakolási idők, bálterem-elrendezés." },
    },
    {
      coupleId: bySlug("CINDERELLA"),
      title: {
        en: "Rehearsal: Cinderella & Charming",
        hu: "Próba: Hamupipőke és a Szőke Herceg",
      },
      inDays: 17,
      time: "17:00",
      notes: { en: "Order of service, processional.", hu: "Szertartásrend, bevonulás." },
    },
  ];
  for (const e of events) {
    insertEvent.run(
      plannerUserId,
      e.coupleId,
      pickL(e.title, locale),
      addDaysIso(todayIso(), e.inDays),
      e.time,
      e.notes === null ? null : pickL(e.notes, locale),
      ts,
    );
    result.events_created += 1;
  }

  // 4. A couple of sent messages so the Messages surface isn't empty.
  const insertMessage = db.prepare(
    `INSERT INTO planner_messages
       (planner_user_id, couple_id, direction, subject, body_text, recipient_email, status, created_at)
     VALUES (?, ?, 'out', ?, ?, ?, 'sent', ?)`,
  );
  const emailFor = (coupleId: number): string =>
    (
      db.prepare("SELECT email FROM users WHERE couple_id = ? LIMIT 1").get(coupleId) as
        | { email: string }
        | undefined
    )?.email ?? "couple@demo.weddly.local";
  const messages: { coupleId: number | null; subject: LText; body: LText }[] = [
    {
      coupleId: bySlug("CINDERELLA"),
      subject: { en: "Timeline confirmed 🕛", hu: "Idővonal megerősítve 🕛" },
      body: {
        en: "Hi Cinderella, the venue walkthrough is locked for next week. Please send the final headcount by Friday so I can close catering. Carriage returns at midnight, as agreed.",
        hu: "Kedves Hamupipőke! A helyszínbejárás jövő hétre rögzítve. Kérlek, péntekig küldd el a végleges létszámot, hogy lezárhassam a cateringet. A hintó éjfélkor fordul, ahogy megbeszéltük.",
      },
    },
    {
      coupleId: bySlug("RAPUNZEL"),
      subject: {
        en: "Lantern permit + caterer chase",
        hu: "Lampionengedély + caterer sürgetés",
      },
      body: {
        en: "Good news: the dusk lantern release is approved. I'm chasing the caterer on the menu today, expect a proof by tomorrow.",
        hu: "Jó hír: az alkonyati lampioneresztést engedélyezték. A caterert ma megsürgetem a menü miatt, holnapra várható a próbaverzió.",
      },
    },
  ];
  for (const m of messages) {
    if (m.coupleId == null) continue;
    insertMessage.run(
      plannerUserId,
      m.coupleId,
      pickL(m.subject, locale),
      pickL(m.body, locale),
      emailFor(m.coupleId),
      ts,
    );
    result.messages_created += 1;
  }

  return result;
}

// ── Reaping ─────────────────────────────────────────────────────────────────

/** Purge demo PLANNER accounts older than `maxAgeMs`. The client couples the
 *  planner manages are `is_demo=1` and reaped by purgeStaleDemoCouples; this
 *  only has to remove the planner user + its planner_* rows.
 *
 *  ORDERING: call this BEFORE purgeStaleDemoCouples at every trigger site. If a
 *  demo visitor "entered" a client workspace, the planner user's couple_id
 *  points at that client couple; running the couples sweep first would try to
 *  hard-delete the planner user (matched via couple_id) while its
 *  planner_subscriptions row still references it. Reaping the planner first
 *  removes that row (via ON DELETE CASCADE) so the couples sweep is clean.
 *
 *  audit_log.actor_user_id has no ON DELETE clause, so its rows are deleted
 *  explicitly before the user row (the FK would otherwise block the delete).
 *  planner_clients / planner_events / planner_messages / planner_subscriptions /
 *  sessions all cascade on the user delete, but we delete them explicitly too
 *  so the intent is obvious and the function is order-independent internally. */
export function purgeStalePlannerDemos(maxAgeMs: number = DEMO_MAX_AGE_MS): number {
  const cutoff = now() - maxAgeMs;
  const planners = db
    .prepare(
      "SELECT id FROM users WHERE user_type = 'planner' AND email LIKE '%@demo.weddly.local' AND created_at < ?",
    )
    .all(cutoff) as { id: number }[];
  if (planners.length === 0) return 0;

  let purged = 0;
  for (const p of planners) {
    try {
      db.transaction(() => {
        db.prepare("DELETE FROM planner_clients WHERE planner_user_id = ?").run(p.id);
        db.prepare("DELETE FROM planner_events WHERE planner_user_id = ?").run(p.id);
        db.prepare("DELETE FROM planner_messages WHERE planner_user_id = ?").run(p.id);
        db.prepare("DELETE FROM planner_invitations WHERE planner_user_id = ?").run(p.id);
        db.prepare("DELETE FROM planner_subscriptions WHERE user_id = ?").run(p.id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(p.id);
        db.prepare("DELETE FROM audit_log WHERE actor_user_id = ?").run(p.id);
        db.prepare("DELETE FROM users WHERE id = ?").run(p.id);
      })();
      purged += 1;
    } catch {
      // Skip a row that fails; the next sweep retries.
    }
  }
  return purged;
}
