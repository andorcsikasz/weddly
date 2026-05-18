// Shrek & Fiona demo wedding seeder. Builds one fully-furnished couple
// workspace — guests, households, budget, transfers, accommodations, schedule,
// planning tasks, seating tables — so a landing-page visitor lands in /app
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

const FAR_FAR_AWAY = "Far Far Away";

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
  full_name: string;
  group_tag: "his_family" | "her_family" | "his_friends" | "her_friends" | "shared_friends" | "work" | "other";
  kind: "adult" | "child" | "baby";
  rsvp_status: "pending" | "yes" | "no" | "maybe";
  meal_choice: "meat" | "fish" | "vegetarian" | "vegan" | "child" | "none" | null;
  dietary: string | null;
  notes: string | null;
}

interface HouseholdSeed {
  label: string;
  group_tag: GuestSeed["group_tag"];
  notes: string | null;
  members: GuestSeed[];
}

/** The fairytale guest list — 15 named guests organised into households so
 *  the household view, RSVP flow, dietary aggregates and seating chart all
 *  show non-trivial data on first load. */
const HOUSEHOLDS: HouseholdSeed[] = [
  {
    label: "King Harold & Queen Lillian",
    group_tag: "her_family",
    notes: "Bride's parents. Royal protocol, please.",
    members: [
      {
        full_name: "King Harold",
        group_tag: "her_family",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "fish",
        dietary: "no shellfish — turns back into a frog",
        notes: "Father of the bride.",
      },
      {
        full_name: "Queen Lillian",
        group_tag: "her_family",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "meat",
        dietary: null,
        notes: "Mother of the bride.",
      },
    ],
  },
  {
    label: "Donkey & Dragon",
    group_tag: "his_friends",
    notes: "Best man + plus one. Dragon needs a wide aisle.",
    members: [
      {
        full_name: "Donkey",
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: "waffles, parfait, layered desserts",
        notes: "BEST MAN. Will talk through the ceremony.",
      },
      {
        full_name: "Dragon",
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "meat",
        dietary: "extra spicy — fire-breather",
        notes: "Tail does not fit under round tables.",
      },
    ],
  },
  {
    label: "Puss in Boots",
    group_tag: "shared_friends",
    notes: "Bringing his own sword. Will sit in a small chair.",
    members: [
      {
        full_name: "Puss in Boots",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "fish",
        dietary: "lactose intolerant — but loves cream",
        notes: "Eyes will be deployed.",
      },
    ],
  },
  {
    label: "The Three Little Pigs",
    group_tag: "his_friends",
    notes: "Came as a household. Please seat together, away from any wolves.",
    members: [
      {
        full_name: "Pig One (Straw)",
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: null,
        notes: null,
      },
      {
        full_name: "Pig Two (Sticks)",
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "maybe",
        meal_choice: "vegetarian",
        dietary: null,
        notes: "Anxious — depends on the wolf situation.",
      },
      {
        full_name: "Pig Three (Bricks)",
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: null,
        notes: "Will give a structured toast.",
      },
    ],
  },
  {
    label: "Gingy",
    group_tag: "his_friends",
    notes: "Will arrive in a small cookie tin. No oven seating.",
    members: [
      {
        full_name: "Gingerbread Man",
        group_tag: "his_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "none",
        dietary: "gluten-free (paradoxically)",
        notes: "Do NOT dunk in milk.",
      },
    ],
  },
  {
    label: "Pinocchio & Geppetto",
    group_tag: "shared_friends",
    notes: "Lie-detector seating.",
    members: [
      {
        full_name: "Pinocchio",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegan",
        dietary: "no wood-fired pizza",
        notes: "Says he RSVPed. Nose did NOT grow.",
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
    label: "Fairy Godmother",
    group_tag: "her_family",
    notes: "Plus-one declined. RSVPed in glitter.",
    members: [
      {
        full_name: "Fairy Godmother",
        group_tag: "her_family",
        kind: "adult",
        rsvp_status: "no",
        meal_choice: null,
        dietary: null,
        notes: "Declined — long story.",
      },
    ],
  },
  {
    label: "Lord Farquaad",
    group_tag: "other",
    notes: "Awkward invite. Decline expected.",
    members: [
      {
        full_name: "Lord Farquaad",
        group_tag: "other",
        kind: "adult",
        rsvp_status: "no",
        meal_choice: null,
        dietary: null,
        notes: "He is not invited. He is on the list.",
      },
    ],
  },
  {
    label: "Magic Mirror",
    group_tag: "work",
    notes: "Coming with the venue. Will MC.",
    members: [
      {
        full_name: "Magic Mirror",
        group_tag: "work",
        kind: "adult",
        rsvp_status: "pending",
        meal_choice: null,
        dietary: null,
        notes: "Will reflect on the speeches.",
      },
    ],
  },
  {
    label: "Three Blind Mice",
    group_tag: "shared_friends",
    notes: "Need help finding their seats — please print large place cards.",
    members: [
      {
        full_name: "Mouse #1",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: "cheese plate, please",
        notes: null,
      },
      {
        full_name: "Mouse #2",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        dietary: null,
        notes: null,
      },
      {
        full_name: "Mouse #3",
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

/** Budget — Forints. Roughly mirrors DEFAULT_BUDGET_SPLIT but each line gets
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
  label: string;
  planned: number;
  actual: number;
  notes: string | null;
}> = [
  { category: "venue", label: "Swamp clearing + ogre-sized marquee", planned: 3_200_000, actual: 1_500_000, notes: "Includes onion-field rental." },
  { category: "catering", label: "Far Far Away catering — onion-forward menu", planned: 2_400_000, actual: 800_000, notes: null },
  { category: "drinks", label: "Bog-water bar + mead pairings", planned: 720_000, actual: 250_000, notes: null },
  { category: "attire", label: "Ogre-cut wedding dress + Shrek's vest", planned: 950_000, actual: 950_000, notes: "Tailor: Wolf in Granny's Clothes." },
  { category: "decor_floral", label: "Swamp lilies + fire-resistant garlands", planned: 700_000, actual: 200_000, notes: "Dragon-proof centrepieces." },
  { category: "photo_video", label: "Magic Mirror live broadcast", planned: 1_200_000, actual: 1_200_000, notes: "Books fast — Mirror is in high demand." },
  { category: "music_dj", label: "DJ Donkey & the Three Pigs (live)", planned: 600_000, actual: 600_000, notes: "Setlist negotiated." },
  { category: "cake_dessert", label: "Seven-tier ogre cake + Gingy croquembouche", planned: 360_000, actual: 0, notes: "Order 6 weeks out." },
  { category: "hair_makeup", label: "Royal grooming — Fiona prep", planned: 240_000, actual: 0, notes: null },
  { category: "transport", label: "Donkey shuttle service", planned: 360_000, actual: 360_000, notes: "Round trips. Loud. Reliable." },
  { category: "honeymoon", label: "Honeymoon — Honeymoon Isle (the literal one)", planned: 720_000, actual: 0, notes: null },
  { category: "stationery", label: "Scroll-style invites + place cards", planned: 220_000, actual: 220_000, notes: null },
  { category: "favours", label: "Onion-themed favours (peeling guide included)", planned: 110_000, actual: 0, notes: null },
  { category: "rings", label: "Wedding bands — solid iron", planned: 240_000, actual: 240_000, notes: "Resized for ogre fingers." },
];

interface SchedSeed {
  label: string;
  starts_at_minutes: number;
  duration_minutes: number | null;
  location: string | null;
  notes: string | null;
}

const SCHEDULE_EVENTS: SchedSeed[] = [
  { label: "Donkey arrives (early — as always)", starts_at_minutes: 9 * 60, duration_minutes: 30, location: "Swamp gate", notes: "Bring his own coffee." },
  { label: "Hair & makeup — Fiona", starts_at_minutes: 10 * 60, duration_minutes: 90, location: "The royal tent", notes: null },
  { label: "Guest arrivals + welcome drinks", starts_at_minutes: 14 * 60, duration_minutes: 60, location: "Swamp clearing", notes: "Mead on tap." },
  { label: "Ceremony — Shrek + Fiona", starts_at_minutes: 15 * 60 + 30, duration_minutes: 45, location: "Onion arch", notes: "Magic Mirror live-broadcasts." },
  { label: "Photos (Magic Mirror)", starts_at_minutes: 16 * 60 + 30, duration_minutes: 60, location: "Far Far Away meadow", notes: null },
  { label: "Dinner served", starts_at_minutes: 18 * 60, duration_minutes: 120, location: "Marquee", notes: null },
  { label: "First dance", starts_at_minutes: 20 * 60 + 30, duration_minutes: 15, location: "Dance floor", notes: '"I\'m a Believer"' },
  { label: "Best-man speech (Donkey)", starts_at_minutes: 21 * 60, duration_minutes: 20, location: "Marquee", notes: "Hard cap: 20 min. (Likely will run over.)" },
  { label: "Cake cutting — seven-tier ogre cake", starts_at_minutes: 21 * 60 + 30, duration_minutes: 15, location: "Marquee", notes: null },
  { label: "Dance floor opens (DJ Donkey)", starts_at_minutes: 22 * 60, duration_minutes: 180, location: "Marquee", notes: null },
  { label: "Last call + Donkey shuttle departs", starts_at_minutes: 25 * 60, duration_minutes: 30, location: "Swamp gate", notes: "Past midnight — day-2 row." },
];

interface PlanningSeed {
  kind: "task" | "idea" | "schedule";
  topic: "wedding" | "honeymoon" | null;
  title: string;
  body: string | null;
  done: boolean;
  due_date: string | null;
  assignee: string | null;
  priority: 0 | 1 | 2;
}

const PLANNING_ITEMS: PlanningSeed[] = [
  { kind: "task", topic: "wedding", title: "Book the swamp", body: "Confirm with the Witch — onion fields included.", done: true, due_date: null, assignee: "Shrek", priority: 0 },
  { kind: "task", topic: "wedding", title: "Hire Magic Mirror as photographer", body: "Negotiated rate.", done: true, due_date: null, assignee: "Fiona", priority: 0 },
  { kind: "task", topic: "wedding", title: "Send invites", body: "Pinocchio is delivering by hand.", done: true, due_date: null, assignee: "Donkey", priority: 1 },
  { kind: "task", topic: "wedding", title: "Final dress fitting", body: "Ogre-cut alteration — needs one more pass.", done: false, due_date: null, assignee: "Fiona", priority: 1 },
  { kind: "task", topic: "wedding", title: "Confirm Donkey's speech length", body: "Cap at 20 min. (It will run over.)", done: false, due_date: null, assignee: "Shrek", priority: 2 },
  { kind: "task", topic: "wedding", title: "Order the cake (seven tiers)", body: null, done: false, due_date: null, assignee: "Shrek", priority: 1 },
  { kind: "task", topic: "wedding", title: "Chase Fairy Godmother for plus-one", body: "She RSVPed no — see if she'll bring Charming anyway.", done: false, due_date: null, assignee: "Fiona", priority: 0 },
  { kind: "task", topic: "honeymoon", title: "Book Honeymoon Isle flights", body: "Round trip. Avoid Lord Farquaad's airline.", done: false, due_date: null, assignee: "Shrek", priority: 1 },
  { kind: "idea", topic: "wedding", title: "Fireworks finale", body: "Dragon. Obviously.", done: false, due_date: null, assignee: null, priority: 0 },
  { kind: "idea", topic: "wedding", title: "Skip the dance floor, do mud pit", body: "Floor optional.", done: false, due_date: null, assignee: null, priority: 0 },
  { kind: "idea", topic: "wedding", title: "Onion bouquet instead of flowers", body: "Layers!", done: false, due_date: null, assignee: null, priority: 0 },
];

/** Idempotent helper — generate a household code unique within this couple. */
function uniqueHhCode(coupleId: number): string {
  const stmt = db.prepare("SELECT 1 FROM households WHERE couple_id = ? AND code = ?");
  for (let i = 0; i < 50; i++) {
    const code = generateHouseholdCode();
    if (!stmt.get(coupleId, code)) return code;
  }
  throw new Error(`Could not allocate a unique household code for couple ${coupleId}`);
}

/** Idempotent helper — generate a globally-unique guest invite code. */
function uniqueGuestCode(): string {
  const stmt = db.prepare("SELECT 1 FROM guests WHERE invite_code = ?");
  for (let i = 0; i < 50; i++) {
    const code = generateInviteCode();
    if (!stmt.get(code)) return code;
  }
  throw new Error("Could not allocate a unique invite code");
}

/** Seat assignments — pair each guest_id with a (table_id, seat_index). The
 *  caller passes back the actual IDs after the INSERTs, so we shape the
 *  pre-DB plan as labels + nicknames and resolve them inside the transaction. */
interface SeatPlan {
  /** Tables. mm coordinates land the layout inside the canvas. */
  tables: Array<{
    label: string;
    shape: "head" | "round" | "long" | "square";
    seats: number;
    x_mm: number;
    y_mm: number;
    width_mm: number;
    length_mm: number;
    is_kids_table: boolean;
  }>;
  /** Per-table seat assignments by guest full_name (resolved at insert time). */
  seating: Array<{ table_label: string; seats: Array<{ index: number; full_name: string }> }>;
}

const SEAT_PLAN: SeatPlan = {
  tables: [
    { label: "Head table", shape: "head", seats: 6, x_mm: 600, y_mm: 200, width_mm: 2400, length_mm: 900, is_kids_table: false },
    { label: "Family — bride's side", shape: "round", seats: 8, x_mm: 300, y_mm: 1100, width_mm: 1500, length_mm: 1500, is_kids_table: false },
    { label: "Best man's table", shape: "round", seats: 8, x_mm: 1800, y_mm: 1100, width_mm: 1500, length_mm: 1500, is_kids_table: false },
    { label: "Friends — fairytale crowd", shape: "round", seats: 8, x_mm: 3300, y_mm: 1100, width_mm: 1500, length_mm: 1500, is_kids_table: false },
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
      table_label: "Family — bride's side",
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
      table_label: "Friends — fairytale crowd",
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
  name: string;
  address: string | null;
  capacity: number;
  price_huf: number | null;
  link: string | null;
  contact: string | null;
  notes: string | null;
  /** Resolves to a guest by full_name at insert time. */
  assigned_to: string[];
}

const ACCOMMODATIONS: AccommodationSeed[] = [
  {
    name: "Far Far Away Inn — royal suite",
    address: "1 Cobblestone Square, Far Far Away",
    capacity: 2,
    price_huf: 95_000,
    link: null,
    contact: "+36 1 555 0000",
    notes: "Soundproofed against trumpet announcements.",
    assigned_to: ["King Harold", "Queen Lillian"],
  },
  {
    name: "The Swamp Cabin (Shrek's place)",
    address: "Deep in the swamp",
    capacity: 4,
    price_huf: null,
    link: null,
    contact: null,
    notes: "Free. Bring your own mud.",
    assigned_to: ["Donkey", "Dragon"],
  },
  {
    name: "The Three Pigs B&B (brick wing)",
    address: "End of the lane",
    capacity: 6,
    price_huf: 32_000,
    link: null,
    contact: null,
    notes: "Brick wing only. The other two are still under construction.",
    assigned_to: ["Pig One (Straw)", "Pig Two (Sticks)", "Pig Three (Bricks)"],
  },
];

interface TransferSeed {
  label: string;
  direction: string | null;
  depart_at: string | null;
  capacity: number | null;
  notes: string | null;
  assigned_to: string[];
}

const TRANSFERS: TransferSeed[] = [
  {
    label: "Donkey shuttle — pickup",
    direction: "Far Far Away → Swamp",
    depart_at: null,
    capacity: 6,
    notes: "Loud. Will sing.",
    assigned_to: ["Puss in Boots", "Gingerbread Man", "Pinocchio", "Geppetto"],
  },
  {
    label: "Donkey shuttle — return",
    direction: "Swamp → Far Far Away",
    depart_at: null,
    capacity: 6,
    notes: "Post-cake. Wear a seatbelt — Donkey takes the corners hard.",
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
 *  All writes happen inside one DB transaction. */
export function seedShrekDemo(coupleId: number): SeedResult {
  const ts = now();
  const weddingDate = demoWeddingDate();

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
      "Honeymoon Isle",
      // Honeymoon = day after wedding + 7 nights
      addDaysIso(weddingDate, 1),
      addDaysIso(weddingDate, 8),
      ts,
      coupleId,
    );

    // 1. Host household — Shrek & Fiona as guests at their own wedding. The
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

    // Bride first so she appears at the top of the household.
    insertGuest.run(
      coupleId,
      "Fiona",
      "her_family",
      uniqueGuestCode(),
      "adult",
      "yes",
      "fish",
      "no shellfish",
      0,
      "Stay (Stay Forever)",
      "Bride. Princess by day, ogre by night.",
      ts,
      ts,
      ts,
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
      "onions, obviously",
      0,
      "I'm a Believer",
      "Groom. Big guy, big heart.",
      ts,
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
        .run(coupleId, code, hh.label, hh.notes, hh.group_tag, ts, ts);
      const hhId = Number(hhRes.lastInsertRowid);
      result.households_created += 1;
      for (const m of hh.members) {
        const respondedAt = m.rsvp_status === "pending" ? null : ts;
        const r = insertGuest.run(
          coupleId,
          m.full_name,
          m.group_tag,
          uniqueGuestCode(),
          m.kind,
          m.rsvp_status,
          m.meal_choice,
          m.dietary,
          0,
          null,
          m.notes,
          respondedAt,
          ts,
          ts,
          hhId,
          null,
          ts,
          ts,
        );
        guestIdByName.set(m.full_name, Number(r.lastInsertRowid));
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
      insertBudget.run(coupleId, b.category, b.label, b.planned, b.actual, b.notes, ts, ts);
      result.budget_lines_created += 1;
    }
    // Stamp the budget ceiling on the couple — sum of planned rows.
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
        e.label,
        e.starts_at_minutes,
        e.duration_minutes,
        e.location,
        e.notes,
        ts,
        ts,
      );
      result.schedule_events_created += 1;
    }

    // 5. Planning items.
    const insertPlanning = db.prepare(
      `INSERT INTO planning_items
         (couple_id, kind, topic, title, body, done, due_date, scheduled_time, position,
          assignee, suggested_by_user_id, start_date, supplier_id, priority,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?,
               ?, NULL, NULL, NULL, ?,
               ?, ?)`,
    );
    let pos = 0;
    for (const p of PLANNING_ITEMS) {
      insertPlanning.run(
        coupleId,
        p.kind,
        p.topic,
        p.title,
        p.body,
        p.done ? 1 : 0,
        p.due_date,
        pos++,
        p.assignee,
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
        t.label,
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
      tableIdByLabel.set(t.label, Number(r.lastInsertRowid));
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
    const setGuestAcc = db.prepare("UPDATE guests SET accommodation_id = ?, updated_at = ? WHERE id = ?");
    for (const a of ACCOMMODATIONS) {
      const r = insertAcc.run(
        coupleId,
        a.name,
        a.address,
        a.capacity,
        a.price_huf,
        a.link,
        a.contact,
        a.notes,
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
    const setGuestTransfer = db.prepare("UPDATE guests SET transfer_id = ?, updated_at = ? WHERE id = ?");
    for (const t of TRANSFERS) {
      const r = insertTransfer.run(
        coupleId,
        t.label,
        t.direction,
        t.depart_at,
        t.capacity,
        t.notes,
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

/** Housekeeping — purge demo couples older than `maxAgeMs`. Called both
 *  inline from `POST /api/demo/start` (so an abandoned demo lazily disappears
 *  on the next visitor) and from the boot-time sweep in server.ts so a quiet
 *  weekend still tidies up.
 *
 *  Demo couples have no audit-retention obligation (they were never real),
 *  so after the shared purgeOneCouple call (which scrubs PII + nulls the
 *  couples row) we go further and hard-delete the tombstone + the purged
 *  user rows. This keeps the auth.email index sparse so a fresh demo never
 *  collides on a "deleted-…@purged.local" address. */
export function purgeStaleDemoCouples(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const cutoff = now() - maxAgeMs;
  const rows = db
    .prepare("SELECT id FROM couples WHERE is_demo = 1 AND created_at < ?")
    .all(cutoff) as { id: number }[];
  if (rows.length === 0) return 0;
  let purged = 0;
  for (const r of rows) {
    try {
      // Capture member user ids BEFORE purgeOneCouple nulls them out — we'll
      // hard-delete those rows below since a demo has no retention claim on
      // them.
      const userIds = (
        db.prepare("SELECT id FROM users WHERE couple_id = ?").all(r.id) as { id: number }[]
      ).map((u) => u.id);
      purgeOneCouple(r.id, { silent: true });
      for (const uid of userIds) {
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(uid);
        db.prepare("DELETE FROM users WHERE id = ?").run(uid);
      }
      db.prepare("DELETE FROM couple_members WHERE couple_id = ?").run(r.id);
      db.prepare("DELETE FROM couples WHERE id = ?").run(r.id);
      purged += 1;
    } catch {
      // Skip a row that fails — next sweep will retry.
    }
  }
  return purged;
}
