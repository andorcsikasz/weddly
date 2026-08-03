// The "Ütemező varázsló" (schedule wizard) heuristic: given a couple's wedding
// date, propose a sensible DUE date (and Gantt start) for an otherwise undated
// task. There is no LLM in the loop — the suggestion is a pure, deterministic
// backwards-plan off the wedding day, reusing the same calendar-aware lead math
// as the big-rock timeline generator (`planning_timeline.ts`).
//
// Precedence for picking a lead time:
//   1. the task's title matches a curated template verbatim (e.g. a free-typed
//      "Helyszínt foglalni", or a task the couple added from a starter pack):
//      use that template's own lead. WEDDING_TIMELINE wins over the task packs
//      where both carry a title, since its leads are calendar-month exact;
//   2. the task is a materialised decision prompt (carries a `seed_key`) — map
//      its theme group to a runway lead (venue decisions land early, day-of
//      money tasks land the week of);
//   3. neither: a neutral "about a month out" fallback, dealt out one day per
//      task across a fortnight so a screenful of free-typed tasks does not all
//      land on the same date.
//
// Branch 1 reading the TASK PACKS is what makes the honeymoon set work. The
// packs used to live in `frontend/src/lib/planning_templates.ts`, which this
// module cannot import, so every honeymoon task missed branches 1 and 2 and the
// wizard proposed one identical date for the passport check, the flights and
// the packing list. The catalogue now lives in `planning_task_packs.ts`.
//
// Pure module (no DB, no I/O); both backend and frontend import it. The wizard
// is the only caller today, but the mapping is deliberately reusable by the
// nudge worker later.

import { PROMPTS_BY_KEY, type PromptGroup } from "./planning_prompts";
import { ALL_TASK_PACK_ITEMS } from "./planning_task_packs";
import { type TimelineLead, timelineDatesFor, WEDDING_TIMELINE } from "./planning_timeline";

/** A lead time plus the Gantt window (start = due − windowDays), the two inputs
 *  `timelineDatesFor` needs to resolve concrete dates from the wedding day. */
export interface WandLead {
  lead: TimelineLead;
  windowDays: number;
}

/** Theme group → runway lead. The eight decision-prompt groups are already a
 *  loose chronology (venue first, day-of money last), so mapping each to a lead
 *  gives a defensible default the couple then fine-tunes. Not exact deadlines —
 *  a starting point the wizard lets you drag and edit. */
const GROUP_LEAD: Record<PromptGroup, WandLead> = {
  venue_weather: { lead: { months: 4 }, windowDays: 30 },
  food_drink: { lead: { months: 2 }, windowDays: 21 },
  ceremony: { lead: { months: 2 }, windowDays: 21 },
  style_decor: { lead: { months: 3 }, windowDays: 30 },
  music_photo: { lead: { months: 1 }, windowDays: 21 },
  guests: { lead: { months: 2 }, windowDays: 30 },
  morning_timeline: { lead: { days: 21 }, windowDays: 14 },
  dayof_money_close: { lead: { days: 10 }, windowDays: 7 },
};

/** Width of the fallback band, in days. A free-typed task we can't place at all
 *  gets one day of it, so N such tasks are dealt across a fortnight instead of
 *  stacked on a single date. See `fallbackLead`. */
export const WAND_FALLBACK_SPREAD_DAYS = 14;

/** Lead of the band's FIRST slot: the fortnight that ends about a month before
 *  the wedding, so every fallback task still reads as "roughly a month out",
 *  with a two-week action window. */
export const WAND_FALLBACK_LEAD: WandLead = { lead: { days: 43 }, windowDays: 14 };

/** Deal a fallback task its own day inside the band. The slot is the task's own
 *  row id, which is creation order, so the tasks come out in the order the
 *  couple typed them (earliest slot = earliest due date) and the same task is
 *  proposed the same date every time the wizard is reopened. A task with no id
 *  yet falls back to a title hash, which is arbitrary but still stable and
 *  still spread. Slot 0 is `WAND_FALLBACK_LEAD`; each next slot is a day later.
 *  Tasks whose ids are exactly a spread apart do share a day, which is the
 *  price of needing no view of the other rows. */
function fallbackLead(task: { title: string; id?: number }): WandLead {
  const raw = typeof task.id === "number" && Number.isFinite(task.id) ? task.id : hash(task.title);
  const slot =
    ((Math.trunc(raw) % WAND_FALLBACK_SPREAD_DAYS) + WAND_FALLBACK_SPREAD_DAYS) %
    WAND_FALLBACK_SPREAD_DAYS;
  const first = WAND_FALLBACK_LEAD.lead;
  const days = ("days" in first ? first.days : 43) - slot;
  return { lead: { days }, windowDays: WAND_FALLBACK_LEAD.windowDays };
}

/** Small deterministic string hash (FNV-1a, 32-bit). Only ever used to pick a
 *  fallback slot, never for anything that has to resist collisions. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase();
}

/** Turn a task pack's `deadline_days` (negative = before the wedding) into a
 *  wand lead. The action window scales with the runway, a fifth of it clamped
 *  to 3..30 days, so a passport check six months out gets a month-long Gantt
 *  bar and a packing list three days out gets a short one. */
function packLead(deadlineDays: number): WandLead {
  const daysBefore = Math.max(0, -deadlineDays);
  return {
    lead: { days: daysBefore },
    windowDays: Math.min(30, Math.max(3, Math.round(daysBefore / 5))),
  };
}

// hu + en title → curated template lead, built once. Lets a couple who typed a
// big-rock task by hand (rather than generating the timeline), or who added one
// from a starter pack, still get the curated lead instead of the fallback.
//
// Task packs go in FIRST so WEDDING_TIMELINE overwrites them where the two
// carry the same title: the 15 wedding pack items are deliberately verbatim
// copies of timeline items, and the timeline's calendar-month leads plus real
// windowDays are the better of the two. The honeymoon set exists only in the
// packs, so it keeps its own leads.
const TITLE_LEAD = new Map<string, WandLead>();
for (const item of ALL_TASK_PACK_ITEMS) {
  const lead = packLead(item.deadline_days);
  TITLE_LEAD.set(normalizeTitle(item.title.hu), lead);
  TITLE_LEAD.set(normalizeTitle(item.title.en), lead);
}
for (const item of WEDDING_TIMELINE) {
  const lead: WandLead = { lead: item.lead, windowDays: item.windowDays };
  TITLE_LEAD.set(normalizeTitle(item.title.hu), lead);
  TITLE_LEAD.set(normalizeTitle(item.title.en), lead);
}

/** Pick the lead for a task by title/seed, independent of the wedding date.
 *  `id` is optional and only steers the fallback spread. Exposed so tests (and
 *  any future caller) can assert the mapping without a date in hand. */
export function wandLeadFor(task: {
  title: string;
  seed_key: string | null;
  id?: number;
}): WandLead {
  const byTitle = TITLE_LEAD.get(normalizeTitle(task.title));
  if (byTitle) return byTitle;
  if (task.seed_key) {
    const seed = PROMPTS_BY_KEY.get(task.seed_key);
    if (seed) return GROUP_LEAD[seed.group];
  }
  return fallbackLead(task);
}

/** Resolve a concrete {start_date, due_date} suggestion for a task. Returns
 *  null when the wedding date is missing/malformed — the wizard then shows the
 *  row without a pre-filled date rather than inventing one. */
export function suggestSchedule(
  task: { title: string; seed_key: string | null; id?: number },
  weddingDateIso: string | null | undefined,
): { start_date: string; due_date: string } | null {
  return timelineDatesFor(weddingDateIso, wandLeadFor(task));
}
