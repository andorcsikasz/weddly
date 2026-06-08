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
// Ordered earliest-window-first so the generator preview reads top-to-bottom as
// a real planning runway. Months for the long-lead bookings, days for the
// short-fuse run-up tasks.

export const WEDDING_TIMELINE: readonly TimelineTemplateItem[] = [
  {
    key: "budget",
    title: { hu: "Büdzsé és vendéglista vázlat", en: "Draft the budget and guest list" },
    hint: { hu: "Minden döntés ebből indul.", en: "Every later decision flows from this." },
    lead: { months: 12 },
    windowDays: 45,
    topic: "wedding",
  },
  {
    key: "venue",
    title: { hu: "Helyszínt foglalni", en: "Book the venue" },
    hint: {
      hu: "A jó helyszínek 12+ hónapra előre elkelnek.",
      en: "The good venues go 12+ months out.",
    },
    lead: { months: 12 },
    windowDays: 45,
    supplierCategory: "venue",
    topic: "wedding",
  },
  {
    key: "photographer",
    title: { hu: "Fotóst lefoglalni", en: "Book photographer" },
    lead: { months: 10 },
    windowDays: 30,
    supplierCategory: "photo_video",
    topic: "wedding",
  },
  {
    key: "officiant",
    title: { hu: "Anyakönyvvezetőt egyeztetni", en: "Confirm registrar" },
    lead: { months: 9 },
    windowDays: 30,
    topic: "wedding",
  },
  {
    key: "music",
    title: { hu: "Zenekart vagy DJ-t lefoglalni", en: "Book band or DJ" },
    lead: { months: 9 },
    windowDays: 30,
    supplierCategory: "music_dj",
    topic: "wedding",
  },
  {
    key: "dress",
    title: { hu: "Menyasszonyi ruhát kiválasztani", en: "Choose wedding dress" },
    hint: {
      hu: "A rendelés + igazítás könnyen 6 hónap.",
      en: "Ordering plus alterations can take 6 months.",
    },
    lead: { months: 8 },
    windowDays: 45,
    supplierCategory: "attire",
    topic: "wedding",
  },
  {
    key: "invitations_order",
    title: { hu: "Meghívókat megrendelni", en: "Order invitations" },
    lead: { months: 8 },
    windowDays: 30,
    supplierCategory: "stationery",
    topic: "wedding",
  },
  {
    key: "florist",
    title: { hu: "Virágost egyeztetni", en: "Confirm florist" },
    lead: { months: 8 },
    windowDays: 30,
    supplierCategory: "decor_floral",
    topic: "wedding",
  },
  {
    key: "catering_menu",
    title: { hu: "Menüt és catering-et véglegesíteni", en: "Finalise catering and menu" },
    lead: { months: 6 },
    windowDays: 30,
    supplierCategory: "catering",
    topic: "wedding",
  },
  {
    key: "suit",
    title: { hu: "Vőlegény öltönyt kiválasztani", en: "Choose groom's suit" },
    lead: { months: 6 },
    windowDays: 30,
    supplierCategory: "attire",
    topic: "wedding",
  },
  {
    key: "cake",
    title: { hu: "Tortát megrendelni", en: "Order wedding cake" },
    lead: { months: 5 },
    windowDays: 30,
    supplierCategory: "cake_dessert",
    topic: "wedding",
  },
  {
    key: "hair_makeup_trial",
    title: { hu: "Haj- és sminkpróbát egyeztetni", en: "Book hair & makeup trial" },
    lead: { months: 4 },
    windowDays: 21,
    supplierCategory: "hair_makeup",
    topic: "wedding",
  },
  {
    key: "rings",
    title: { hu: "Karikagyűrűket beszerezni", en: "Buy wedding rings" },
    hint: { hu: "Gravírozás + méretre igazítás idő.", en: "Engraving and sizing take time." },
    lead: { months: 3 },
    windowDays: 30,
    supplierCategory: "rings",
    topic: "wedding",
  },
  {
    key: "invitations_send",
    title: { hu: "Meghívókat kiküldeni", en: "Send the invitations" },
    lead: { months: 3 },
    windowDays: 21,
    topic: "wedding",
  },
  {
    key: "witnesses",
    title: { hu: "Tanúkat felkérni", en: "Ask the witnesses" },
    lead: { months: 3 },
    windowDays: 21,
    topic: "wedding",
  },
  {
    key: "seating",
    title: { hu: "Ülésrendet elkezdeni", en: "Start the seating plan" },
    lead: { months: 2 },
    windowDays: 30,
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
    topic: "wedding",
  },
  {
    key: "final_headcount",
    title: { hu: "Végleges létszámot leadni", en: "Confirm final headcount" },
    hint: {
      hu: "A catering és az ülésrend ezen áll vagy bukik.",
      en: "Catering and seating both hinge on this.",
    },
    lead: { months: 1 },
    windowDays: 14,
    topic: "wedding",
  },
  {
    key: "license",
    title: { hu: "Házassági papírokat rendezni", en: "Sort the marriage paperwork" },
    lead: { months: 1 },
    windowDays: 21,
    topic: "wedding",
  },
  {
    key: "rehearsal",
    title: { hu: "Esküvői próbát egyeztetni", en: "Schedule wedding rehearsal" },
    lead: { days: 10 },
    windowDays: 10,
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
