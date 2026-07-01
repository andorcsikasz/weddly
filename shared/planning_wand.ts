// The "Ütemező varázsló" (schedule wizard) heuristic: given a couple's wedding
// date, propose a sensible DUE date (and Gantt start) for an otherwise undated
// task. There is no LLM in the loop — the suggestion is a pure, deterministic
// backwards-plan off the wedding day, reusing the same calendar-aware lead math
// as the big-rock timeline generator (`planning_timeline.ts`).
//
// Precedence for picking a lead time:
//   1. the task's title matches a curated WEDDING_TIMELINE template verbatim
//      (e.g. a free-typed "Helyszínt foglalni") — use that template's own lead;
//   2. the task is a materialised decision prompt (carries a `seed_key`) — map
//      its theme group to a runway lead (venue decisions land early, day-of
//      money tasks land the week of);
//   3. neither — a neutral "about a month out" fallback.
//
// Pure module (no DB, no I/O); both backend and frontend import it. The wizard
// is the only caller today, but the mapping is deliberately reusable by the
// nudge worker later.

import { PROMPTS_BY_KEY, type PromptGroup } from "./planning_prompts";
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

/** Neutral fallback for a free-typed task we can't otherwise place: about a
 *  month before the wedding, with a two-week action window. */
export const WAND_FALLBACK_LEAD: WandLead = { lead: { months: 1 }, windowDays: 14 };

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase();
}

// hu + en title → curated template lead, built once. Lets a couple who typed a
// big-rock task by hand (rather than generating the timeline) still get the
// curated lead instead of the fallback.
const TITLE_LEAD = new Map<string, WandLead>();
for (const item of WEDDING_TIMELINE) {
  const lead: WandLead = { lead: item.lead, windowDays: item.windowDays };
  TITLE_LEAD.set(normalizeTitle(item.title.hu), lead);
  TITLE_LEAD.set(normalizeTitle(item.title.en), lead);
}

/** Pick the lead for a task by title/seed, independent of the wedding date.
 *  Exposed so tests (and any future caller) can assert the mapping without a
 *  date in hand. */
export function wandLeadFor(task: { title: string; seed_key: string | null }): WandLead {
  const byTitle = TITLE_LEAD.get(normalizeTitle(task.title));
  if (byTitle) return byTitle;
  if (task.seed_key) {
    const seed = PROMPTS_BY_KEY.get(task.seed_key);
    if (seed) return GROUP_LEAD[seed.group];
  }
  return WAND_FALLBACK_LEAD;
}

/** Resolve a concrete {start_date, due_date} suggestion for a task. Returns
 *  null when the wedding date is missing/malformed — the wizard then shows the
 *  row without a pre-filled date rather than inventing one. */
export function suggestSchedule(
  task: { title: string; seed_key: string | null },
  weddingDateIso: string | null | undefined,
): { start_date: string; due_date: string } | null {
  return timelineDatesFor(weddingDateIso, wandLeadFor(task));
}
