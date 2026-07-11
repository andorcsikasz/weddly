// Canonical "safe timeline" for a wedding: the curated set of tasks every
// couple faces, each pinned to an ideal lead time before the wedding day. This
// is the source of truth for two surfaces:
//   1. the in-app "Ütemterv összeállítása" generator, which turns a couple's
//      wedding_date into dated planning_items (start_date + due_date) the
//      existing Gantt / calendar already render, behind a confirm-and-edit step;
//   2. the proactive nudge worker (lifecycle emails + the notification centre),
//      which computes which tasks have entered their window and aren't done yet.
//
// Lead times are deliberately calendar-aware (subtract N months, not N*30 days)
// so "6 months before" lands on the same day-of-month, and broadly market-
// agnostic (ordering invitations ~6 months out holds whether the couple is in
// Budapest or Lisbon). Titles for the overlapping items match the frontend
// `planning_templates.ts` wand verbatim so the group divider + de-dupe on apply
// keep working. Pure module — no DB, no I/O — so both backend and frontend
// import it directly.

import type { SupplierCategory } from "./suppliers";
import type { PlanningTopic } from "./types";

export type TimelineLocaleText = { hu: string; en: string };

/** Lead time of a task's DUE date relative to the wedding day. Months are
 *  calendar-subtracted (clamped on short months); days are exact. */
export type TimelineLead = { months: number } | { days: number };

/** Named runway buckets, mirroring how couples actually think about the year:
 *  "what do I do 12+ months out" down to "what's left this week". Each template
 *  item carries one, so the generator can render the checklist grouped under
 *  these headings (the lead time still drives the concrete due date). */
export type TimelinePhase = "m12_plus" | "m9_12" | "m6_9" | "m3_6" | "m1_3" | "wedding_week";

/** The phases in runway order, with display labels. The generator iterates this
 *  to build its grouped sections; ordering here is the ordering on screen. */
export const TIMELINE_PHASES: readonly { id: TimelinePhase; label: TimelineLocaleText }[] = [
  { id: "m12_plus", label: { hu: "12+ hónappal előtte", en: "12+ months before" } },
  { id: "m9_12", label: { hu: "9-12 hónappal előtte", en: "9-12 months before" } },
  { id: "m6_9", label: { hu: "6-9 hónappal előtte", en: "6-9 months before" } },
  { id: "m3_6", label: { hu: "3-6 hónappal előtte", en: "3-6 months before" } },
  { id: "m1_3", label: { hu: "1-3 hónappal előtte", en: "1-3 months before" } },
  { id: "wedding_week", label: { hu: "Az esküvő hetében", en: "Wedding week" } },
];

export interface TimelineTemplateItem {
  /** Stable identifier — never reused, so the worker can key idempotency /
   *  dedupe on it and we can reorder the array freely. */
  key: string;
  title: TimelineLocaleText;
  /** Optional one-line "why now" shown under the title in the generator. */
  hint?: TimelineLocaleText;
  /** When the task should be DONE by, expressed as a lead before the wedding. */
  lead: TimelineLead;
  /** Action window in days: start_date = due_date − windowDays. Gives the Gantt
   *  bar a span and frames "you can start this now" vs "this is overdue". */
  windowDays: number;
  /** Loose link to the supplier directory category, so a generated task can
   *  surface the right point-of-contact on the timeline page. */
  supplierCategory?: SupplierCategory;
  /** Which runway bucket this task belongs to. Drives the grouped headings in
   *  the generator; the concrete due date still comes from `lead`. */
  phase: TimelinePhase;
  topic: PlanningTopic;
}

/** Computed lifecycle state of a single dated task. `undated` covers rows with
 *  no due_date (can't be placed on the timeline); everything else is derived
 *  from due_date vs today + the done flag. */
export type TimelineStatus = "done" | "overdue" | "due_soon" | "upcoming" | "undated";

/** Default horizon (days) for "due soon" — a task whose due date is within this
 *  many days of today and isn't done yet is flagged as actionable now. */
export const TIMELINE_DUE_SOON_DAYS = 21;

// ─── the template ────────────────────────────────────────────────────────────
// Ordered earliest-window-first and grouped by `phase` so the generator preview
// reads top-to-bottom as a real planning runway. Months for the long-lead
// bookings, days for the short-fuse run-up tasks. Titles for the overlapping
// items match the frontend `planning_templates.ts` wand verbatim so the group
// divider + de-dupe on apply keep working.

export const WEDDING_TIMELINE: readonly TimelineTemplateItem[] = [
  // ── 12+ months before ──────────────────────────────────────────────────────
  {
    key: "budget",
    title: { hu: "Büdzsé meghatározása", en: "Set your budget" },
    hint: { hu: "Minden későbbi döntés ebből indul.", en: "Every later decision flows from this." },
    lead: { months: 12 },
    windowDays: 45,
    phase: "m12_plus",
    topic: "wedding",
  },
  {
    key: "wedding_date",
    title: { hu: "Esküvő dátumának kiválasztása", en: "Choose your date" },
    lead: { months: 12 },
    windowDays: 45,
    phase: "m12_plus",
    topic: "wedding",
  },
  {
    key: "guest_list",
    title: { hu: "Vendéglista összeállítása", en: "Draft your guest list" },
    hint: {
      hu: "A létszám szabja meg a helyszínt és a büdzsét.",
      en: "Headcount sets the venue size and the budget.",
    },
    lead: { months: 12 },
    windowDays: 45,
    phase: "m12_plus",
    topic: "wedding",
  },
  {
    key: "vision",
    title: { hu: "Esküvői elképzelés meghatározása", en: "Define your wedding vision" },
    hint: {
      hu: "Stílus, méret, hangulat: ez ad irányt minden döntéshez.",
      en: "Style, size, and feel: the north star for every choice.",
    },
    lead: { months: 12 },
    windowDays: 45,
    phase: "m12_plus",
    topic: "wedding",
  },
  {
    key: "research_venues",
    title: { hu: "Helyszínek felkutatása", en: "Research venues" },
    lead: { months: 12 },
    windowDays: 45,
    supplierCategory: "venue",
    phase: "m12_plus",
    topic: "wedding",
  },
  {
    key: "venue",
    title: { hu: "Helyszínt foglalni", en: "Book your venue" },
    hint: {
      hu: "A jó helyszínek 12+ hónapra előre elkelnek.",
      en: "The good venues go 12+ months out.",
    },
    lead: { months: 12 },
    windowDays: 45,
    supplierCategory: "venue",
    phase: "m12_plus",
    topic: "wedding",
  },
  {
    key: "mood_board",
    title: { hu: "Hangulattábla készítése", en: "Create a mood board" },
    lead: { months: 12 },
    windowDays: 45,
    phase: "m12_plus",
    topic: "wedding",
  },
  {
    key: "vendor_research",
    title: { hu: "Szolgáltatók felkutatása", en: "Start vendor research" },
    lead: { months: 12 },
    windowDays: 45,
    phase: "m12_plus",
    topic: "wedding",
  },

  // ── 9-12 months before ─────────────────────────────────────────────────────
  {
    key: "photographer",
    title: { hu: "Fotós és videós lefoglalása", en: "Book photo and video" },
    lead: { months: 10 },
    windowDays: 30,
    supplierCategory: "photography",
    phase: "m9_12",
    topic: "wedding",
  },
  {
    key: "catering",
    title: { hu: "Catering lefoglalása", en: "Book catering" },
    lead: { months: 10 },
    windowDays: 30,
    supplierCategory: "catering",
    phase: "m9_12",
    topic: "wedding",
  },
  {
    key: "wedding_party",
    title: { hu: "Koszorúslányok és vőfély kiválasztása", en: "Choose your wedding party" },
    lead: { months: 11 },
    windowDays: 30,
    phase: "m9_12",
    topic: "wedding",
  },
  {
    key: "dress_shopping",
    title: { hu: "Menyasszonyi ruha keresése", en: "Start dress shopping" },
    lead: { months: 11 },
    windowDays: 45,
    supplierCategory: "bridal_boutique",
    phase: "m9_12",
    topic: "wedding",
  },
  {
    key: "hair_makeup_research",
    title: { hu: "Fodrász és sminkes felkutatása", en: "Research hair and makeup" },
    lead: { months: 9 },
    windowDays: 30,
    supplierCategory: "hair_makeup",
    phase: "m9_12",
    topic: "wedding",
  },
  {
    key: "website",
    title: { hu: "Esküvői weboldal létrehozása", en: "Create your wedding website" },
    lead: { months: 10 },
    windowDays: 30,
    phase: "m9_12",
    topic: "wedding",
  },
  {
    key: "save_the_dates",
    title: { hu: "Save the date kiküldése", en: "Send save the dates" },
    lead: { months: 9 },
    windowDays: 30,
    supplierCategory: "stationery",
    phase: "m9_12",
    topic: "wedding",
  },
  {
    key: "ceremony_ideas",
    title: { hu: "Szertartás ötletek tervezése", en: "Plan ceremony ideas" },
    lead: { months: 9 },
    windowDays: 30,
    phase: "m9_12",
    topic: "wedding",
  },
  {
    key: "officiant",
    title: { hu: "Anyakönyvvezetőt egyeztetni", en: "Confirm registrar" },
    lead: { months: 11 },
    windowDays: 30,
    phase: "m9_12",
    topic: "wedding",
  },

  // ── 6-9 months before ──────────────────────────────────────────────────────
  {
    key: "dress",
    title: { hu: "Menyasszonyi ruha megrendelése", en: "Order your dress" },
    hint: {
      hu: "A rendelés és igazítás könnyen hónapokba telik.",
      en: "Ordering plus alterations can take months.",
    },
    lead: { months: 8 },
    windowDays: 45,
    supplierCategory: "bridal_boutique",
    phase: "m6_9",
    topic: "wedding",
  },
  {
    key: "music",
    title: { hu: "Zenekar vagy DJ lefoglalása", en: "Book music or DJ" },
    lead: { months: 8 },
    windowDays: 30,
    supplierCategory: "dj",
    phase: "m6_9",
    topic: "wedding",
  },
  {
    key: "florist",
    title: { hu: "Virágkötő lefoglalása", en: "Book florist" },
    lead: { months: 8 },
    windowDays: 30,
    supplierCategory: "wedding_decor",
    phase: "m6_9",
    topic: "wedding",
  },
  {
    key: "color_palette",
    title: { hu: "Színvilág kiválasztása", en: "Choose your color palette" },
    lead: { months: 7 },
    windowDays: 30,
    phase: "m6_9",
    topic: "wedding",
  },
  {
    key: "stationery",
    title: { hu: "Meghívók és papír-dekor tervezése", en: "Plan stationery" },
    lead: { months: 7 },
    windowDays: 30,
    supplierCategory: "stationery",
    phase: "m6_9",
    topic: "wedding",
  },
  {
    key: "guest_stays",
    title: { hu: "Szállás a vendégeknek", en: "Research guest stays" },
    lead: { months: 7 },
    windowDays: 30,
    phase: "m6_9",
    topic: "wedding",
  },
  {
    key: "timeline_draft",
    title: { hu: "Napirend vázlatának elkészítése", en: "Draft your timeline" },
    lead: { months: 6 },
    windowDays: 30,
    phase: "m6_9",
    topic: "wedding",
  },
  {
    key: "transport",
    title: { hu: "Közlekedés megtervezése", en: "Plan transport" },
    lead: { months: 6 },
    windowDays: 30,
    phase: "m6_9",
    topic: "wedding",
  },
  {
    key: "cake",
    title: { hu: "Esküvői torta megrendelése", en: "Order wedding cake" },
    lead: { months: 6 },
    windowDays: 30,
    supplierCategory: "cake_dessert",
    phase: "m6_9",
    topic: "wedding",
  },

  // ── 3-6 months before ──────────────────────────────────────────────────────
  {
    key: "invitations_send",
    title: { hu: "Meghívók kiküldése", en: "Send invitations" },
    lead: { months: 4 },
    windowDays: 30,
    supplierCategory: "stationery",
    phase: "m3_6",
    topic: "wedding",
  },
  {
    key: "hair_makeup_trial",
    title: { hu: "Próbafrizura és -smink egyeztetése", en: "Book beauty trials" },
    lead: { months: 4 },
    windowDays: 21,
    supplierCategory: "hair_makeup",
    phase: "m3_6",
    topic: "wedding",
  },
  {
    key: "menu",
    title: { hu: "Menü véglegesítése", en: "Finalize menu" },
    hint: {
      hu: "Kóstolóval érdemes lezárni.",
      en: "Lock it in after the tasting.",
    },
    lead: { months: 5 },
    windowDays: 30,
    supplierCategory: "catering",
    phase: "m3_6",
    topic: "wedding",
  },
  {
    key: "ceremony_music",
    title: { hu: "Szertartás zenéjének kiválasztása", en: "Choose ceremony music" },
    lead: { months: 5 },
    windowDays: 30,
    supplierCategory: "dj",
    phase: "m3_6",
    topic: "wedding",
  },
  {
    key: "rings",
    title: { hu: "Karikagyűrűk beszerzése", en: "Buy rings" },
    hint: { hu: "Gravírozás és méretre igazítás időt kér.", en: "Engraving and sizing take time." },
    lead: { months: 5 },
    windowDays: 30,
    supplierCategory: "wedding_jewelry",
    phase: "m3_6",
    topic: "wedding",
  },
  {
    key: "pre_wedding_events",
    title: { hu: "Esküvő előtti események tervezése", en: "Plan pre-wedding events" },
    hint: {
      hu: "Lánybúcsú, legénybúcsú, eljegyzési buli.",
      en: "Hen do, stag do, engagement party.",
    },
    lead: { months: 4 },
    windowDays: 30,
    phase: "m3_6",
    topic: "wedding",
  },
  {
    key: "seating",
    title: { hu: "Ülésrend vázlata", en: "Draft seating plan" },
    lead: { months: 3 },
    windowDays: 30,
    phase: "m3_6",
    topic: "wedding",
  },
  {
    key: "wedding_party_outfits",
    title: { hu: "Násznép öltözékének kiválasztása", en: "Choose wedding party outfits" },
    hint: {
      hu: "Vőlegény öltöny, koszorúslányruhák.",
      en: "Groom's suit and the bridal party's outfits.",
    },
    lead: { months: 5 },
    windowDays: 30,
    supplierCategory: "bridal_boutique",
    phase: "m3_6",
    topic: "wedding",
  },
  {
    key: "witnesses",
    title: { hu: "Tanúk felkérése", en: "Ask the witnesses" },
    lead: { months: 4 },
    windowDays: 21,
    phase: "m3_6",
    topic: "wedding",
  },

  // ── 1-3 months before ──────────────────────────────────────────────────────
  {
    key: "confirm_vendors",
    title: { hu: "Szolgáltatók megerősítése", en: "Confirm vendors" },
    lead: { months: 2 },
    windowDays: 30,
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "final_headcount",
    title: { hu: "Végleges létszám leadása", en: "Finalize guest count" },
    hint: {
      hu: "A catering és az ülésrend ezen áll vagy bukik.",
      en: "Catering and seating both hinge on this.",
    },
    lead: { months: 1 },
    windowDays: 14,
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "seating_chart",
    title: { hu: "Ültetési rend elkészítése", en: "Create seating chart" },
    lead: { months: 2 },
    windowDays: 30,
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "timeline_final",
    title: { hu: "Napirend véglegesítése", en: "Finalize timeline" },
    lead: { months: 1 },
    windowDays: 21,
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "final_payments",
    title: { hu: "Hátralékok és végszámlák követése", en: "Track final payments" },
    lead: { months: 1 },
    windowDays: 21,
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "photo_list",
    title: { hu: "Fotólista összeállítása", en: "Prepare photo list" },
    lead: { months: 2 },
    windowDays: 30,
    supplierCategory: "photography",
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "emergency_kit_plan",
    title: { hu: "Vészhelyzeti csomag megtervezése", en: "Plan emergency kit" },
    lead: { months: 1 },
    windowDays: 21,
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "confirm_transport",
    title: { hu: "Közlekedés megerősítése", en: "Confirm transport" },
    lead: { months: 2 },
    windowDays: 30,
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "rsvp_deadline",
    title: { hu: "RSVP-határidő és utánkövetés", en: "RSVP deadline and follow-up" },
    hint: {
      hu: "A nem válaszolókat ilyenkor kell megkérdezni.",
      en: "Now is when you chase the non-responders.",
    },
    lead: { days: 42 },
    windowDays: 21,
    phase: "m1_3",
    topic: "wedding",
  },
  {
    key: "license",
    title: { hu: "Házassági papírok rendezése", en: "Sort the marriage paperwork" },
    lead: { months: 1 },
    windowDays: 21,
    phase: "m1_3",
    topic: "wedding",
  },

  // ── Wedding week ───────────────────────────────────────────────────────────
  {
    key: "rehearsal",
    title: { hu: "Esküvői próba egyeztetése", en: "Schedule wedding rehearsal" },
    lead: { days: 7 },
    windowDays: 7,
    phase: "wedding_week",
    topic: "wedding",
  },
  {
    key: "reconfirm_vendors",
    title: { hu: "Szolgáltatók időpontjainak újraegyeztetése", en: "Reconfirm vendor times" },
    lead: { days: 5 },
    windowDays: 5,
    phase: "wedding_week",
    topic: "wedding",
  },
  {
    key: "pack_emergency_kit",
    title: { hu: "Vészhelyzeti csomag összepakolása", en: "Pack emergency kit" },
    lead: { days: 2 },
    windowDays: 2,
    phase: "wedding_week",
    topic: "wedding",
  },
  {
    key: "prepare_payments",
    title: { hu: "Borítékok és kifizetések előkészítése", en: "Prepare payments" },
    lead: { days: 3 },
    windowDays: 3,
    phase: "wedding_week",
    topic: "wedding",
  },
  {
    key: "share_timeline",
    title: { hu: "Végleges napirend megosztása", en: "Share final timeline" },
    hint: {
      hu: "Szolgáltatók, násznép, tanúk.",
      en: "Vendors, wedding party, and witnesses.",
    },
    lead: { days: 5 },
    windowDays: 5,
    phase: "wedding_week",
    topic: "wedding",
  },
  {
    key: "detail_items",
    title: { hu: "Apró kellékek félrekészítése", en: "Set aside detail items" },
    hint: {
      hu: "Gyűrűk, eskü szövege, helykártyák.",
      en: "Rings, vows, place cards.",
    },
    lead: { days: 2 },
    windowDays: 2,
    phase: "wedding_week",
    topic: "wedding",
  },
  {
    key: "steam_outfits",
    title: { hu: "Ruhák kigőzölése", en: "Steam outfits" },
    lead: { days: 2 },
    windowDays: 2,
    phase: "wedding_week",
    topic: "wedding",
  },
  {
    key: "backup_plan",
    title: { hu: "B-terv megerősítése", en: "Confirm backup plan" },
    hint: { hu: "Eső esetére is.", en: "Including the wet-weather option." },
    lead: { days: 5 },
    windowDays: 5,
    phase: "wedding_week",
    topic: "wedding",
  },
  {
    key: "wedding_bag",
    title: { hu: "Esküvői táska összepakolása", en: "Pack wedding bag" },
    lead: { days: 1 },
    windowDays: 1,
    phase: "wedding_week",
    topic: "wedding",
  },
];

// ─── date helpers (calendar-aware, ISO YYYY-MM-DD in/out) ────────────────────

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a YYYY-MM-DD literal into a Date at local midnight, or null on any
 *  malformed input. Avoids `new Date(str)` and its cross-browser ISO quirks. */
export function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  // Reject overflow (e.g. 2026-02-30 → Mar 2) so callers never get a silently
  // shifted date.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** Subtract whole months, clamping the day to the target month's length so
 *  "Aug 31 − 1 month" lands on Jul 31, not a rolled-over Aug 1. */
function subMonths(d: Date, n: number): Date {
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() - n, 1);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDay));
  return r;
}

/** Resolve a template item's concrete dates from a couple's wedding date.
 *  Returns null when the wedding date is missing/malformed (e.g. the couple
 *  only set a target month, not an exact day) — the caller then offers the task
 *  undated rather than inventing a deadline. */
export function timelineDatesFor(
  weddingDateIso: string | null | undefined,
  item: Pick<TimelineTemplateItem, "lead" | "windowDays">,
): { start_date: string; due_date: string } | null {
  const wed = parseIsoDate(weddingDateIso);
  if (!wed) return null;
  const due =
    "months" in item.lead ? subMonths(wed, item.lead.months) : addDays(wed, -item.lead.days);
  const start = addDays(due, -item.windowDays);
  return { start_date: toIsoDate(start), due_date: toIsoDate(due) };
}

/** Classify a single task. ISO date strings compare lexicographically, so the
 *  ordering checks need no Date parsing on the hot path. `todayIso` is passed
 *  in (not read from the clock) so the worker and the UI agree on "today" and
 *  tests stay deterministic. */
export function timelineStatus(
  dueDateIso: string | null,
  done: boolean,
  todayIso: string,
  dueSoonDays: number = TIMELINE_DUE_SOON_DAYS,
): TimelineStatus {
  if (done) return "done";
  if (!dueDateIso) return "undated";
  if (dueDateIso < todayIso) return "overdue";
  const today = parseIsoDate(todayIso);
  if (!today) return "upcoming";
  const horizon = toIsoDate(addDays(today, dueSoonDays));
  if (dueDateIso <= horizon) return "due_soon";
  return "upcoming";
}

/** Roll up a task list into the counts the bell badge / dashboard card need.
 *  Only `overdue` + `due_soon` are "needs attention"; the badge total is their
 *  sum. Accepts any row carrying a due_date + done so both the DTO and a raw
 *  row shape work. */
export function summarizeTimeline(
  tasks: readonly { due_date: string | null; done: boolean }[],
  todayIso: string,
  dueSoonDays: number = TIMELINE_DUE_SOON_DAYS,
): { overdue: number; dueSoon: number; needsAttention: number } {
  let overdue = 0;
  let dueSoon = 0;
  for (const t of tasks) {
    const s = timelineStatus(t.due_date, t.done, todayIso, dueSoonDays);
    if (s === "overdue") overdue++;
    else if (s === "due_soon") dueSoon++;
  }
  return { overdue, dueSoon, needsAttention: overdue + dueSoon };
}
