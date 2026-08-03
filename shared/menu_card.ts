// The wedding menu the couple prints, shared by the PDF renderer, the live
// card preview and the editor.
//
// This is NOT `couples.meal_menu`. That one names the six RSVP meal SLOTS a
// guest chooses between (`shared/meals.ts`); this is the menu card handed out
// on the table: courses in the order they are served, with the dishes written
// under each. A wedding routinely has both, and they say different things (a
// six-course tasting menu with one vegetarian alternative is one `meal_menu`
// slot and six courses here).
//
// Until this existed the A5 menu card drew three hardcoded English labels
// ("Starter" / "Main" / "Dessert") over blank ruled lines for the couple to
// fill in with a pen, and there was no way to type a dish anywhere in the
// product. The blank-rules layout is still what an EMPTY menu renders, because
// it is a genuinely useful thing to print, and because inventing dishes for
// somebody's wedding is exactly the fake-placeholder-data the project bans.

import type { MenuCard, MenuCourse } from "./types";

/** Courses on one card. Past this the A5 page has no room left and the type
 *  size would have to shrink below what a table candle can be read by. */
export const MENU_MAX_COURSES = 6;

/** Dish lines within one course. */
export const MENU_MAX_LINES = 6;

/** Course heading, e.g. "Előétel", "Amuse-bouche", "Main course". */
export const MENU_TITLE_MAX = 40;

/** One dish line. Long enough for "Sült pisztráng citrusos vajjal, petrezselymes
 *  burgonyával", short enough to stay on one line at readable size. */
export const MENU_LINE_MAX = 90;

/** The empty menu: no courses. Renders as the blank ruled card with localised
 *  default course labels, which is what every couple has today. */
export function emptyMenuCard(): MenuCard {
  return { courses: [] };
}

/** True when the couple has actually written something. Drives whether the PDF
 *  prints dishes or falls back to writing rules, and whether the editor shows
 *  its "customised" state. A course with a title but no dishes counts: naming
 *  the courses of your own dinner is a real edit. */
export function hasMenuContent(menu: MenuCard): boolean {
  return menu.courses.some((c) => c.title.trim() !== "" || c.lines.some((l) => l.trim() !== ""));
}

/** Resolve a stored value into a valid menu. Tolerant of null (every row that
 *  pre-dates this), malformed JSON, wrong shapes and over-long input — anything
 *  unexpected degrades to the empty menu or gets trimmed, so a bad row can
 *  never break the print route. Accepts the stored JSON string or an
 *  already-parsed value. */
export function parseMenuCard(raw: string | null | undefined | unknown): MenuCard {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return emptyMenuCard();
    try {
      parsed = JSON.parse(raw);
    } catch {
      return emptyMenuCard();
    }
  }
  if (typeof parsed !== "object" || parsed === null) return emptyMenuCard();
  const rawCourses = (parsed as { courses?: unknown }).courses;
  if (!Array.isArray(rawCourses)) return emptyMenuCard();

  const courses: MenuCourse[] = [];
  for (const entry of rawCourses) {
    if (courses.length >= MENU_MAX_COURSES) break;
    if (typeof entry !== "object" || entry === null) continue;
    const title = cleanText((entry as { title?: unknown }).title, MENU_TITLE_MAX);
    const rawLines = (entry as { lines?: unknown }).lines;
    const lines: string[] = [];
    if (Array.isArray(rawLines)) {
      for (const line of rawLines) {
        if (lines.length >= MENU_MAX_LINES) break;
        const cleaned = cleanText(line, MENU_LINE_MAX);
        if (cleaned) lines.push(cleaned);
      }
    }
    // A course with neither a title nor a dish is the editor's empty row; it
    // is dropped on save rather than stored as a gap in the printed card.
    if (!title && lines.length === 0) continue;
    courses.push({ title, lines });
  }
  return { courses };
}

/** Validate + normalise client input for storage. Same tolerant resolution as
 *  `parseMenuCard` — the editor cannot submit anything this does not accept,
 *  and a hand-rolled request gets trimmed rather than a 400, because there is
 *  nothing a caller could do with the error that silently dropping an eighth
 *  course does not already do better. */
export function normalizeMenuCardInput(input: unknown): MenuCard {
  return parseMenuCard(input);
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export type { MenuCard, MenuCourse };
