// Day-of run-of-show wand templates. Strings live outside the locale tree
// because (a) they're content data, not UI labels, and (b) adding 20+ keys
// to keys.ts triples the i18n maintenance per template item. Mirrors the
// pattern used by `lib/planning_templates.ts`.

import { SCHEDULE_MAX_MINUTES } from "@shared/schedule";
import { contentLocale, type Locale } from "./i18n";
import type { LocaleText } from "./planning_templates";

/** One milestone in the wedding-day template. `fraction` positions the event
 *  within the [start, end] window the user supplies — 0 = start, 1 = end —
 *  so the template stretches gracefully across a short afternoon ceremony or
 *  an all-evening reception. `defaultDuration` is optional minutes; we cap it
 *  at the remaining time before the next event to avoid awkward overlaps. */
export interface ScheduleTemplateItem {
  /** Stable key used as the React list key. */
  key: string;
  title: LocaleText;
  /** 0 = start time, 1 = end time. Events are sorted by this when rendered. */
  fraction: number;
  /** Optional default duration in minutes. */
  defaultDuration?: number;
}

export const SCHEDULE_TEMPLATE: ScheduleTemplateItem[] = [
  {
    key: "arrival",
    title: { hu: "Megérkezés", en: "Arrival" },
    fraction: 0.0,
    defaultDuration: 30,
  },
  {
    key: "ceremony",
    title: { hu: "Polgári szertartás", en: "Civil ceremony" },
    fraction: 0.06,
    defaultDuration: 45,
  },
  {
    key: "group_photo",
    title: { hu: "Csoportkép", en: "Group photo" },
    fraction: 0.18,
    defaultDuration: 30,
  },
  {
    key: "cocktail",
    title: { hu: "Fogadás, koccintás", en: "Cocktail hour" },
    fraction: 0.25,
    defaultDuration: 60,
  },
  {
    key: "dinner",
    title: { hu: "Vacsora", en: "Dinner" },
    fraction: 0.4,
    defaultDuration: 90,
  },
  {
    key: "first_dance",
    title: { hu: "Nyitótánc", en: "First dance" },
    fraction: 0.62,
  },
  {
    key: "cake_cutting",
    title: { hu: "Tortavágás", en: "Cake cutting" },
    fraction: 0.72,
  },
  {
    key: "midnight_surprise",
    title: { hu: "Éjféli meglepetés", en: "Midnight surprise" },
    fraction: 0.85,
  },
  {
    key: "last_dance",
    title: { hu: "Záró tánc", en: "Last dance" },
    fraction: 0.96,
  },
  {
    key: "end",
    title: { hu: "Program vége", en: "End of program" },
    fraction: 1.0,
  },
];

/** Lookup of every label the wand or the legacy starter button may have
 *  written to the DB, mapped to its current-locale translation. Lets us
 *  render rows in the user's selected language even when they were seeded
 *  while the UI was in the other language. Hand-edited labels won't match
 *  any entry here and will fall through unchanged — exactly what we want. */
const KNOWN_LABELS: { hu: string; en: string }[] = SCHEDULE_TEMPLATE.map((item) => ({
  hu: item.title.hu,
  en: item.title.en,
}));

export function localizeKnownLabel(label: string, locale: Locale): string {
  for (const entry of KNOWN_LABELS) {
    if (entry.hu === label || entry.en === label) return entry[contentLocale(locale)];
  }
  return label;
}

/** Round to the nearest 5 minutes so the proposed timeline reads as
 *  intentional human-set times instead of `17:23`. */
function roundTo5(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

/** Compute the proposed timeline within [startMinutes, endMinutes]. Returns
 *  one entry per template item with the rounded `starts_at_minutes`. The
 *  caller can then ask the user which entries to keep. */
export function buildScheduleProposal(
  startMinutes: number,
  endMinutes: number,
): { item: ScheduleTemplateItem; starts_at_minutes: number; duration_minutes: number | null }[] {
  const window = endMinutes - startMinutes;
  return SCHEDULE_TEMPLATE.map((item, idx) => {
    const raw = startMinutes + window * item.fraction;
    const rounded = roundTo5(raw);
    // 2-day model: allow minutes past 1440 so an overnight window (end <=
    // start) lays the late-night milestones on day 2 instead of wrapping
    // them to morning. Day-2 rows render with a "+1 nap" badge.
    const clamped = Math.max(0, Math.min(SCHEDULE_MAX_MINUTES, rounded));
    // Cap default duration so it doesn't overshoot the next event.
    let duration: number | null = null;
    if (item.defaultDuration) {
      const next = SCHEDULE_TEMPLATE[idx + 1];
      const nextMinutes = next ? roundTo5(startMinutes + window * next.fraction) : endMinutes;
      const gap = Math.max(0, nextMinutes - clamped);
      duration = gap > 0 ? Math.min(item.defaultDuration, gap) : item.defaultDuration;
    }
    return { item, starts_at_minutes: clamped, duration_minutes: duration };
  });
}
