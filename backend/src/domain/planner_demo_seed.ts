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
import { DEMO_MAX_AGE_MS, seedShrekDemo } from "./demo_seed";
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
  full_name: string;
  group_tag: GroupTag;
  kind: "adult" | "child" | "baby";
  rsvp: "pending" | "yes" | "no" | "maybe";
  meal?: "meat" | "fish" | "vegetarian" | "vegan" | "child" | null;
  notes?: string | null;
}

interface FtTask {
  title: string;
  body: string;
  done: boolean;
  /** Days relative to the wedding (negative = before). null = no due date. */
  due_offset: number | null;
  assignee: string | null;
  priority: 0 | 1 | 2;
}

interface FtClientSpec {
  /** Slug base for the public couple page (e.g. "CINDERELLA"). */
  slug_base: string;
  display_name: string;
  bride_name: string;
  groom_name: string;
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
  lead_source: string;
  contract_value_huf: number;
  deposit_paid_huf: number;
  crm_notes: string;
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
    title: "Sign the venue contract",
    body: "Deposit wired, date locked.",
    due_offset: -300,
    assignee: null,
    priority: 2,
  },
  {
    title: "Book catering",
    body: "Tasting scheduled, headcount estimate sent.",
    due_offset: -260,
    assignee: null,
    priority: 2,
  },
  {
    title: "Hire the photographer",
    body: "Full-day package + engagement shoot.",
    due_offset: -240,
    assignee: null,
    priority: 1,
  },
  {
    title: "Order invitations",
    body: "Proof approved, print run placed.",
    due_offset: -180,
    assignee: null,
    priority: 1,
  },
  {
    title: "Send save-the-dates",
    body: "Digital + printed for the older guests.",
    due_offset: -170,
    assignee: null,
    priority: 1,
  },
  {
    title: "Book the florist",
    body: "Seasonal palette agreed.",
    due_offset: -150,
    assignee: null,
    priority: 1,
  },
  {
    title: "Finalise the menu",
    body: "Two mains + vegetarian, kids' plate.",
    due_offset: -120,
    assignee: null,
    priority: 1,
  },
  {
    title: "Order the cake",
    body: "Three tiers, tasting booked.",
    due_offset: -90,
    assignee: null,
    priority: 0,
  },
  {
    title: "Final dress fitting",
    body: "Alterations, second fitting if needed.",
    due_offset: -45,
    assignee: null,
    priority: 1,
  },
  {
    title: "Confirm final headcount",
    body: "Chase the stragglers, lock catering.",
    due_offset: -21,
    assignee: null,
    priority: 2,
  },
  {
    title: "Build the seating plan",
    body: "Tables, dietary flags, escort cards.",
    due_offset: -14,
    assignee: null,
    priority: 2,
  },
  {
    title: "Rehearsal & run sheet",
    body: "Walk the order of service with the party.",
    due_offset: -3,
    assignee: null,
    priority: 1,
  },
];

/** How the client's total budget splits across categories. */
const BUDGET_SHARES: { category: string; label: string; share: number }[] = [
  { category: "venue", label: "Venue & rental", share: 0.34 },
  { category: "catering", label: "Catering & bar", share: 0.28 },
  { category: "photo", label: "Photo & video", share: 0.12 },
  { category: "flowers", label: "Flowers & decor", share: 0.1 },
  { category: "music", label: "Music & DJ", share: 0.08 },
  { category: "attire", label: "Attire & beauty", share: 0.08 },
];

/** A tasteful reception timeline (minutes from midnight). */
const SCHEDULE: {
  label: string;
  starts_at_minutes: number;
  duration_minutes: number;
  location: string;
}[] = [
  { label: "Ceremony", starts_at_minutes: 900, duration_minutes: 30, location: "Chapel" },
  {
    label: "Couple & family photos",
    starts_at_minutes: 945,
    duration_minutes: 45,
    location: "Garden",
  },
  {
    label: "Reception & dinner",
    starts_at_minutes: 1020,
    duration_minutes: 240,
    location: "Grand Hall",
  },
  { label: "First dance", starts_at_minutes: 1200, duration_minutes: 20, location: "Grand Hall" },
];

// ── The fairy-tale book of business ─────────────────────────────────────────

const CLIENTS: FtClientSpec[] = [
  {
    slug_base: "CINDERELLA",
    display_name: "Cinderella & Prince Charming",
    bride_name: "Cinderella",
    groom_name: "Prince Charming",
    style_tags: ["classic", "ballroom"],
    wedding_in_days: 18,
    task_done_count: 10, // near-complete: seating plan is the "due this week" item
    budget_total_huf: 7_800_000,
    link_status: "active",
    initiated_by: "planner",
    stage: "active",
    lead_source: "Referral — the Grand Duke",
    contract_value_huf: 950_000,
    deposit_paid_huf: 475_000,
    crm_notes: "Palace ballroom, black-tie. Glass-slipper detail on the escort cards.",
    guests: [
      {
        full_name: "Fairy Godmother",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: "Officiant + on-call wardrobe.",
      },
      { full_name: "The King", group_tag: "his_family", kind: "adult", rsvp: "yes", meal: "meat" },
      {
        full_name: "The Grand Duke",
        group_tag: "his_family",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: "Brought the slipper.",
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
        notes: "Cheese course, obviously.",
      },
      {
        full_name: "Lady Tremaine",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "no",
        meal: null,
        notes: "Declined. No love lost.",
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
        full_name: "Prince Charming's aunt",
        group_tag: "his_family",
        kind: "adult",
        rsvp: "pending",
        meal: null,
      },
      {
        full_name: "Captain of the Guard",
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "fish",
      },
    ],
  },
  {
    slug_base: "SNOWWHITE",
    display_name: "Snow White & Prince Florian",
    bride_name: "Snow White",
    groom_name: "Prince Florian",
    style_tags: ["forest", "storybook"],
    wedding_in_days: 240,
    task_done_count: 3, // early stage: venue booked, most of the backlog still open
    budget_total_huf: 5_200_000,
    link_status: "active",
    initiated_by: "planner",
    stage: "proposal",
    lead_source: "Enchanted Forest wedding fair",
    contract_value_huf: 720_000,
    deposit_paid_huf: 0,
    crm_notes: "Woodland ceremony. Seven groomsmen — sizes on file. Deposit invoice sent.",
    guests: [
      {
        full_name: "Doc",
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: "Best-man duties.",
      },
      {
        full_name: "Grumpy",
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "no",
        meal: null,
        notes: "Says he'll come. He won't. He will.",
      },
      { full_name: "Happy", group_tag: "her_friends", kind: "adult", rsvp: "yes", meal: "meat" },
      { full_name: "Sleepy", group_tag: "her_friends", kind: "adult", rsvp: "pending", meal: null },
      {
        full_name: "Bashful",
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
      },
      {
        full_name: "Sneezy",
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: "Keep him away from the florals.",
      },
      { full_name: "Dopey", group_tag: "her_friends", kind: "adult", rsvp: "yes", meal: "meat" },
      {
        full_name: "The Queen Mother",
        group_tag: "his_family",
        kind: "adult",
        rsvp: "pending",
        meal: null,
      },
      {
        full_name: "The Huntsman",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
      },
      {
        full_name: "Magic Mirror",
        group_tag: "other",
        kind: "adult",
        rsvp: "maybe",
        meal: null,
        notes: "Wall-mounted. Needs an outlet.",
      },
    ],
  },
  {
    slug_base: "RAPUNZEL",
    display_name: "Rapunzel & Flynn Rider",
    bride_name: "Rapunzel",
    groom_name: "Flynn Rider",
    style_tags: ["lanterns", "riverside"],
    wedding_in_days: 75,
    task_done_count: 6, // mid-stage: menu + cake slipped and are now overdue
    budget_total_huf: 6_400_000,
    link_status: "active",
    initiated_by: "planner",
    stage: "deposit",
    lead_source: "Instagram — the floating lanterns reel",
    contract_value_huf: 840_000,
    deposit_paid_huf: 420_000,
    crm_notes: "Lantern release at dusk — permit confirmed. Chase the caterer, menu is late.",
    guests: [
      {
        full_name: "The King of Corona",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "yes",
        meal: "fish",
        notes: "Father of the bride.",
      },
      {
        full_name: "The Queen of Corona",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "yes",
        meal: "fish",
      },
      {
        full_name: "Mother Gothel",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "no",
        meal: null,
        notes: "Not invited. Do not seat.",
      },
      {
        full_name: "Pascal",
        group_tag: "her_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: "Ring-bearer. Colour-coordinates himself.",
      },
      {
        full_name: "Hook Hand",
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: "Piano at the reception.",
      },
      { full_name: "Big Nose", group_tag: "his_friends", kind: "adult", rsvp: "yes", meal: "meat" },
      {
        full_name: "Vladimir",
        group_tag: "his_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: "Bringing a ceramic unicorn.",
      },
      {
        full_name: "The Stabbington Brothers",
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
        notes: "Cupcakes for the dessert table.",
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
    lead_source: "Website enquiry",
    contract_value_huf: 0,
    deposit_paid_huf: 0,
    crm_notes: "Invited you from their workspace — awaiting your acceptance.",
    guests: [
      {
        full_name: "Maurice",
        group_tag: "her_family",
        kind: "adult",
        rsvp: "yes",
        meal: "vegetarian",
        notes: "Father of the bride.",
      },
      {
        full_name: "Mrs. Potts",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: "Tea service, naturally.",
      },
      {
        full_name: "Lumière",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "fish",
        notes: "Maître d' for the evening.",
      },
      {
        full_name: "Cogsworth",
        group_tag: "shared_friends",
        kind: "adult",
        rsvp: "yes",
        meal: "meat",
        notes: "Keeper of the run sheet.",
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
        notes: "Uninvited. Security briefed.",
      },
    ],
  },
];

// ── Seed one lighter fairy-tale client workspace ────────────────────────────

/** Fill a fresh couple workspace with a believable, enterable dataset: wedding
 *  date, guests, budget, schedule and a task backlog. Lighter than the Shrek
 *  flagship (no seating / accommodation / transfers). All writes are wrapped in
 *  one transaction so a mid-seed failure rolls back cleanly. */
export function seedFairytaleClient(coupleId: number, spec: FtClientSpec): void {
  const ts = now();
  const weddingDate = weddingDateInDays(spec.wedding_in_days);

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
      const hhRes = insertHh.run(
        coupleId,
        uniqueHhCode(coupleId),
        g.full_name,
        g.group_tag,
        ts,
        ts,
      );
      const respondedAt = g.rsvp === "pending" ? null : ts;
      insertGuest.run(
        coupleId,
        g.full_name,
        g.group_tag,
        uniqueGuestCode(),
        g.kind,
        g.rsvp,
        g.meal ?? null,
        g.notes ?? null,
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
      insertBudget.run(coupleId, b.category, b.label, planned, actual, ts, ts);
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
        e.label,
        e.starts_at_minutes,
        e.duration_minutes,
        e.location,
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
        task.title,
        task.body,
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
 *  session + billing row are stamped before the workspace fills. */
export function seedPlannerDemo(
  plannerUserId: number,
  opts: { ownerPasswordHash: string },
): PlannerDemoResult {
  const ts = now();
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
  seedShrekDemo(shrekId);
  insertLink.run(
    plannerUserId,
    shrekId,
    "active",
    "planner",
    "Flagship client. Swamp ceremony, onion-forward menu. Fully briefed.",
    "Far Far Away referral",
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
      display_name: spec.display_name,
      bride_name: spec.bride_name,
      groom_name: spec.groom_name,
      style_tags: spec.style_tags,
      ownerPasswordHash: opts.ownerPasswordHash,
    });
    seedFairytaleClient(coupleId, spec);
    insertLink.run(
      plannerUserId,
      coupleId,
      spec.link_status,
      spec.initiated_by,
      spec.crm_notes,
      spec.lead_source,
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
  const byName = (needle: string) =>
    clientCoupleIds.find((c) => c.spec.display_name.startsWith(needle))?.coupleId ?? null;
  const events: {
    coupleId: number | null;
    title: string;
    inDays: number;
    time: string | null;
    notes: string | null;
  }[] = [
    {
      coupleId: null,
      title: "Weekly planning block",
      inDays: 1,
      time: "09:00",
      notes: "Inbox zero + follow-ups.",
    },
    {
      coupleId: byName("Snow White"),
      title: "Intro call — Snow White & Florian",
      inDays: 2,
      time: "11:00",
      notes: "Scope, budget, deposit invoice.",
    },
    {
      coupleId: shrekId,
      title: "Menu tasting at the swamp",
      inDays: 6,
      time: "12:30",
      notes: "Onion five ways. Bring antacids.",
    },
    {
      coupleId: byName("Rapunzel"),
      title: "Dress fitting — Rapunzel",
      inDays: 9,
      time: "14:00",
      notes: "Second fitting, veil length.",
    },
    {
      coupleId: byName("Cinderella"),
      title: "Final venue walkthrough — Cinderella",
      inDays: 13,
      time: "10:00",
      notes: "Load-in times, ballroom layout.",
    },
    {
      coupleId: byName("Cinderella"),
      title: "Rehearsal — Cinderella & Charming",
      inDays: 17,
      time: "17:00",
      notes: "Order of service, processional.",
    },
  ];
  for (const e of events) {
    insertEvent.run(
      plannerUserId,
      e.coupleId,
      e.title,
      addDaysIso(todayIso(), e.inDays),
      e.time,
      e.notes,
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
  const messages: { coupleId: number | null; subject: string; body: string }[] = [
    {
      coupleId: byName("Cinderella"),
      subject: "Timeline confirmed 🕛",
      body: "Hi Cinderella — venue walkthrough is locked for next week. Please send the final headcount by Friday so I can close catering. Carriage returns at midnight, as agreed.",
    },
    {
      coupleId: byName("Rapunzel"),
      subject: "Lantern permit + caterer chase",
      body: "Good news: the dusk lantern release is approved. I'm chasing the caterer on the menu today — expect a proof by tomorrow.",
    },
  ];
  for (const m of messages) {
    if (m.coupleId == null) continue;
    insertMessage.run(plannerUserId, m.coupleId, m.subject, m.body, emailFor(m.coupleId), ts);
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
