// Meal-menu helpers shared by the backend (storage + public RSVP view) and
// the frontend (guest-list dialog + public RSVP form). The six meal slots stay
// the canonical `MealChoice` enum — stats, place cards, allergen logic and the
// seating baby rules all depend on it — couples only customise each slot's
// visible LABEL and whether it's OFFERED on the RSVP form. That keeps the
// "personalised, shareable menu" purely cosmetic on top of a stable model.

import type { MealChoice, MealMenu, MealMenuItem } from "./types";

/** Canonical render order of the six fixed meal slots. The single source of
 *  truth — both the guest-list dialog and the public RSVP form import this
 *  rather than re-declaring their own array (they used to drift). */
export const MEAL_ORDER: MealChoice[] = ["meat", "fish", "vegetarian", "vegan", "child", "none"];

const MEAL_SET = new Set<MealChoice>(MEAL_ORDER);

/** Max length of a custom label. Long enough for "Sült pisztráng citrusos
 *  vajjal", short enough to keep the RSVP radio rows on one line. */
export const MEAL_LABEL_MAX = 48;

/** The default menu: every slot offered, no label override (the client falls
 *  back to its localised `guests.meal_<choice>` string). */
export function defaultMealMenu(): MealMenu {
  return MEAL_ORDER.map((choice) => ({ choice, label: null, enabled: true }));
}

/** Resolve a stored value into a complete, ordered 6-item menu. Tolerant of
 *  null (legacy rows), malformed JSON, partial records, unknown keys, and bad
 *  types — anything unexpected falls back to the slot default so the RSVP form
 *  can never break on a bad row. Accepts either the stored JSON string or an
 *  already-parsed value. */
export function parseMealMenu(raw: string | null | undefined | unknown): MealMenu {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return defaultMealMenu();
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaultMealMenu();
    }
  }
  if (!Array.isArray(parsed)) return defaultMealMenu();
  // Index incoming items by choice so order/extra/missing entries don't matter.
  const byChoice = new Map<MealChoice, { label: string | null; enabled: boolean }>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const choice = (entry as { choice?: unknown }).choice;
    if (typeof choice !== "string" || !MEAL_SET.has(choice as MealChoice)) continue;
    byChoice.set(choice as MealChoice, {
      label: cleanLabel((entry as { label?: unknown }).label),
      enabled: (entry as { enabled?: unknown }).enabled !== false, // default true
    });
  }
  return MEAL_ORDER.map((choice) => {
    const found = byChoice.get(choice);
    return { choice, label: found?.label ?? null, enabled: found?.enabled ?? true };
  });
}

/** Validate + normalise a client-supplied menu for storage. Same tolerant
 *  resolution as `parseMealMenu`, then guarantees at least one slot stays
 *  enabled (an all-disabled menu would leave the RSVP form with no options to
 *  show). Returns the canonical 6-item menu ready to JSON-serialise. */
export function normalizeMealMenuInput(input: unknown): MealMenu {
  const menu = parseMealMenu(input);
  if (!menu.some((m) => m.enabled)) {
    // Re-enable the first slot rather than reject — a softer failure mode.
    const first = menu[0];
    if (first) first.enabled = true;
  }
  return menu;
}

/** The label to show for a slot: the couple's override, or null when they
 *  haven't set one (callers then fall back to their localised default). */
export function mealItemLabel(menu: MealMenu, choice: MealChoice): string | null {
  return menu.find((m) => m.choice === choice)?.label ?? null;
}

/** True when the menu differs from the all-default state — drives the "reset"
 *  affordance and any "customised" badge. */
export function isCustomMealMenu(menu: MealMenu): boolean {
  return menu.some((m) => m.label !== null || !m.enabled);
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MEAL_LABEL_MAX);
  return trimmed.length > 0 ? trimmed : null;
}

// Re-export the item type so callers can `import { MealMenuItem } from "@shared/meals"`.
export type { MealMenuItem };
