// Meal-menu helpers shared by the backend (storage + public RSVP view) and
// the frontend (guest-list dialog + public RSVP form).
//
// The menu is SIX CANONICAL SLOTS plus however many the couple adds. The six
// (`MealChoice`) are a closed enum that everything reasoning about a known
// meal depends on: the caterer buckets, the baby/child rules, the allergen
// scan. Couples customise each one's visible LABEL and whether it is OFFERED.
//
// Custom slots (`x1`…`xN`) exist because six was not enough for real weddings
// ("Halal", "Gluténmentes tál", a second main). They carry no meaning beyond
// their label, which is exactly why they are a separate key space: code that
// switches on the six keeps its exhaustive switch, and a custom slot falls
// through to "other" everywhere that has to classify rather than count.

import type { CustomMealKey, MealChoice, MealMenu, MealMenuItem, MealSlotKey } from "./types";

/** Canonical render order of the six fixed meal slots. The single source of
 *  truth — both the guest-list dialog and the public RSVP form import this
 *  rather than re-declaring their own array (they used to drift). */
export const MEAL_ORDER: MealChoice[] = ["meat", "fish", "vegetarian", "vegan", "child", "none"];

const MEAL_SET = new Set<MealChoice>(MEAL_ORDER);

/** Max length of a custom label. Long enough for "Sült pisztráng citrusos
 *  vajjal", short enough to keep the RSVP radio rows on one line. */
export const MEAL_LABEL_MAX = 48;

/** How many options a couple may add on top of the six. The RSVP form renders
 *  these as a tap grid on a phone; past a dozen total it stops being a choice
 *  and becomes a form to read. */
export const MEAL_MAX_CUSTOM = 6;

const CUSTOM_KEY_RE = /^x[1-9][0-9]?$/;

export function isMealChoice(s: string): s is MealChoice {
  return MEAL_SET.has(s as MealChoice);
}

export function isCustomMealKey(s: string): s is CustomMealKey {
  return CUSTOM_KEY_RE.test(s);
}

/** Anything storable in `guests.meal_choice`. Note this accepts a well-formed
 *  custom key WITHOUT checking it exists in any particular couple's menu:
 *  callers that care (the RSVP submit) check the menu, and a stale key on a
 *  guest row whose option was later deleted must still parse rather than
 *  crash a read. */
export function isMealSlotKey(s: string): s is MealSlotKey {
  return isMealChoice(s) || isCustomMealKey(s);
}

/** The default menu: every canonical slot offered, no label override, no
 *  custom options. */
export function defaultMealMenu(): MealMenu {
  return MEAL_ORDER.map((choice) => ({ choice, label: null, enabled: true }));
}

/** Resolve a stored value into a complete menu: the six canonical slots in
 *  `MEAL_ORDER` first, then the couple's own in the order they were added.
 *  Tolerant of null (legacy rows), malformed JSON, partial records, unknown
 *  keys and bad types — anything unexpected falls back to the slot default so
 *  the RSVP form can never break on a bad row. Accepts either the stored JSON
 *  string or an already-parsed value. */
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
  const custom: MealMenuItem[] = [];
  const seenCustom = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const choice = (entry as { choice?: unknown }).choice;
    if (typeof choice !== "string") continue;
    const label = cleanLabel((entry as { label?: unknown }).label);
    const enabled = (entry as { enabled?: unknown }).enabled !== false; // default true
    if (isMealChoice(choice)) {
      byChoice.set(choice, { label, enabled });
      continue;
    }
    // A custom slot is nothing but its label, so an unlabelled one is not an
    // option a guest could choose and is dropped rather than stored as a blank
    // button. Duplicates keep the first.
    if (!isCustomMealKey(choice) || !label) continue;
    if (seenCustom.has(choice) || custom.length >= MEAL_MAX_CUSTOM) continue;
    seenCustom.add(choice);
    custom.push({ choice, label, enabled });
  }
  const core = MEAL_ORDER.map((choice) => {
    const found = byChoice.get(choice);
    return { choice, label: found?.label ?? null, enabled: found?.enabled ?? true };
  });
  return [...core, ...custom];
}

/** Validate + normalise a client-supplied menu for storage. Same tolerant
 *  resolution as `parseMealMenu`, then guarantees at least one slot stays
 *  enabled (an all-disabled menu would leave the RSVP form with no options to
 *  show). Returns the canonical menu ready to JSON-serialise. */
export function normalizeMealMenuInput(input: unknown): MealMenu {
  const menu = parseMealMenu(input);
  if (!menu.some((m) => m.enabled)) {
    // Re-enable the first slot rather than reject — a softer failure mode.
    const first = menu[0];
    if (first) first.enabled = true;
  }
  return menu;
}

/** The next free custom key for this menu. Reuses gaps, so deleting `x2` and
 *  adding an option gives `x2` back rather than climbing forever past the
 *  two-digit key format. */
export function nextCustomMealKey(menu: MealMenu): CustomMealKey {
  const used = new Set(menu.map((m) => m.choice));
  for (let i = 1; i <= MEAL_MAX_CUSTOM + 1; i++) {
    const key = `x${i}` as CustomMealKey;
    if (!used.has(key)) return key;
  }
  return `x${MEAL_MAX_CUSTOM + 1}` as CustomMealKey;
}

/** How many custom options this menu carries, for the "add" button's cap. */
export function customMealCount(menu: MealMenu): number {
  return menu.filter((m) => isCustomMealKey(m.choice)).length;
}

/** The label to show for a slot: the couple's override, or null when they
 *  haven't set one (callers then fall back to their localised default). A
 *  custom slot always has one, since an unlabelled custom slot cannot exist. */
export function mealItemLabel(menu: MealMenu, choice: MealSlotKey): string | null {
  return menu.find((m) => m.choice === choice)?.label ?? null;
}

/** True when the menu differs from the all-default state — drives the "reset"
 *  affordance and any "customised" badge. */
export function isCustomMealMenu(menu: MealMenu): boolean {
  return menu.some((m) => m.label !== null || !m.enabled || isCustomMealKey(m.choice));
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MEAL_LABEL_MAX);
  return trimmed.length > 0 ? trimmed : null;
}

// Re-export the item type so callers can `import { MealMenuItem } from "@shared/meals"`.
export type { MealMenuItem };
