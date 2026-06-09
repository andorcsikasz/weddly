// Shared budget mutations. Used by BudgetPage and the cost-planning panel
// embedded on DashboardPage.

import type { BudgetCategory, BudgetLine } from "@shared/types";
import { budgetApi } from "./endpoints";

/** Apply a new total `planned_huf` to all lines in a category. Updates via the
 *  API and returns the new list of lines so the caller can replace local
 *  state. Behaviour by line count:
 *  - 0 lines → creates one with that planned total + the supplied label.
 *  - 1 line  → updates its `planned_huf`.
 *  - N lines → scales every line proportionally to match the new total. If the
 *    existing total is zero (no weights), assigns the whole sum to the first
 *    line so we don't silently lose information. Round-off drift is folded
 *    back into the first line so the bucket sums exactly match. */
export async function applyCategoryPlanned(
  category: BudgetCategory,
  newTotal: number,
  lines: BudgetLine[],
  fallbackLabel: string,
  /** Optional predicate to narrow which lines count as "in this category".
   *  Used by the aggregated budget table to scope edits on the `other`
   *  aggregate to default-labeled lines only — without it, custom rows
   *  (which share `category === "other"`) would get scaled too and the
   *  user's custom-row values would jump around when they tweak Egyéb. */
  filter?: (line: BudgetLine) => boolean,
): Promise<BudgetLine[]> {
  const inCat = lines.filter((l) => l.category === category && (filter ? filter(l) : true));

  if (inCat.length === 0) {
    const r = await budgetApi.createLine({
      category,
      label: fallbackLabel,
      planned_huf: newTotal,
      actual_huf: 0,
    });
    return [...lines, r.line];
  }

  if (inCat.length === 1) {
    const line = inCat[0];
    if (!line) return lines;
    const updated = { ...line, planned_huf: newTotal };
    await budgetApi.updateLine(line.id, updated);
    return lines.map((l) => (l.id === line.id ? updated : l));
  }

  const oldTotal = inCat.reduce((s, l) => s + l.planned_huf, 0);
  const updates: BudgetLine[] = inCat.map((l, i) => {
    const next =
      oldTotal > 0 ? Math.round((l.planned_huf / oldTotal) * newTotal) : i === 0 ? newTotal : 0;
    return { ...l, planned_huf: next };
  });
  const drift = newTotal - updates.reduce((s, l) => s + l.planned_huf, 0);
  if (drift !== 0 && updates[0]) {
    updates[0] = { ...updates[0], planned_huf: updates[0].planned_huf + drift };
  }
  await Promise.all(updates.map((l) => budgetApi.updateLine(l.id, l)));
  const updateMap = new Map(updates.map((l) => [l.id, l]));
  return lines.map((l) => updateMap.get(l.id) ?? l);
}

/** Apply a new total `actual_huf` to all lines in a category. Same scaling
 *  rules as `applyCategoryPlanned`. DIY-supplier-linked lines (`couple_supplier_id`
 *  not null) are owned by the supplier card and would 409 if we tried to write
 *  them — filter them out so the rest of the category still scales. */
export async function applyCategoryActual(
  category: BudgetCategory,
  newTotal: number,
  lines: BudgetLine[],
  fallbackLabel: string,
  /** Same scope-narrowing escape hatch as `applyCategoryPlanned` — see that
   *  helper for the reasoning behind the parameter. */
  filter?: (line: BudgetLine) => boolean,
): Promise<BudgetLine[]> {
  const inCat = lines.filter(
    (l) => l.category === category && l.couple_supplier_id === null && (filter ? filter(l) : true),
  );

  if (inCat.length === 0) {
    const r = await budgetApi.createLine({
      category,
      label: fallbackLabel,
      planned_huf: 0,
      actual_huf: newTotal,
    });
    return [...lines, r.line];
  }

  if (inCat.length === 1) {
    const line = inCat[0];
    if (!line) return lines;
    const updated = { ...line, actual_huf: newTotal };
    await budgetApi.updateLine(line.id, updated);
    return lines.map((l) => (l.id === line.id ? updated : l));
  }

  const oldTotal = inCat.reduce((s, l) => s + l.actual_huf, 0);
  const updates: BudgetLine[] = inCat.map((l, i) => {
    const next =
      oldTotal > 0 ? Math.round((l.actual_huf / oldTotal) * newTotal) : i === 0 ? newTotal : 0;
    return { ...l, actual_huf: next };
  });
  const drift = newTotal - updates.reduce((s, l) => s + l.actual_huf, 0);
  if (drift !== 0 && updates[0]) {
    updates[0] = { ...updates[0], actual_huf: updates[0].actual_huf + drift };
  }
  await Promise.all(updates.map((l) => budgetApi.updateLine(l.id, l)));
  const updateMap = new Map(updates.map((l) => [l.id, l]));
  return lines.map((l) => updateMap.get(l.id) ?? l);
}

/** Apply a new total `paid_huf` to a category, distributing across its lines in
 *  proportion to each line's `actual_huf` (so paid spreads like cost). The
 *  server clamps each line's paid to its own actual. DIY-supplier lines are
 *  owned by the supplier card (paid is derived there), so they're filtered out.
 *  Marking a category "fully paid" is just `applyCategoryPaid(cat, bucketActual)`;
 *  clearing is `applyCategoryPaid(cat, 0)`. */
export async function applyCategoryPaid(
  category: BudgetCategory,
  newTotal: number,
  lines: BudgetLine[],
  filter?: (line: BudgetLine) => boolean,
): Promise<BudgetLine[]> {
  const inCat = lines.filter(
    (l) => l.category === category && l.couple_supplier_id === null && (filter ? filter(l) : true),
  );
  if (inCat.length === 0) return lines;

  if (inCat.length === 1) {
    const line = inCat[0];
    if (!line) return lines;
    const paid = Math.max(0, Math.min(newTotal, line.actual_huf));
    const updated = { ...line, paid_huf: paid };
    await budgetApi.updateLine(line.id, updated);
    return lines.map((l) => (l.id === line.id ? updated : l));
  }

  const totalActual = inCat.reduce((s, l) => s + l.actual_huf, 0);
  const updates: BudgetLine[] = inCat.map((l, i) => {
    const raw =
      totalActual > 0
        ? Math.round((l.actual_huf / totalActual) * newTotal)
        : i === 0
          ? newTotal
          : 0;
    return { ...l, paid_huf: Math.max(0, Math.min(raw, l.actual_huf)) };
  });
  await Promise.all(updates.map((l) => budgetApi.updateLine(l.id, l)));
  const updateMap = new Map(updates.map((l) => [l.id, l]));
  return lines.map((l) => updateMap.get(l.id) ?? l);
}

import type { Couple } from "@shared/types";

/** Fallback baseline when the couple hasn't picked a target headcount yet —
 *  the slider needs a non-zero denominator for per-guest scaling. */
const DEFAULT_BASELINE = 100;

/**
 * The single headcount the cost-planning math anchors on. Used identically by
 * DashboardPage and BudgetPage so per-guest categories scale the same way on
 * both. `totalGuests` is the size of the actual guest list — only honoured
 * when the goal is `tbd`, so the slider still has something sensible to
 * centre on.
 */
export function guestCountBaseline(couple: Couple, totalGuests: number): number {
  const g = couple.guest_count_goal;
  if (g.kind === "exact" && g.exact !== null) return g.exact;
  if (g.kind === "range" && g.min !== null && g.max !== null) {
    return Math.round((g.min + g.max) / 2);
  }
  if (couple.target_guest_count !== null) return couple.target_guest_count;
  if (totalGuests > 0) return totalGuests;
  return DEFAULT_BASELINE;
}

/**
 * Slider bounds for the cost-planning headcount slider. When the couple has a
 * real range (`guest_count_goal.kind === "range"`), we use it verbatim so the
 * two pages stay in lockstep. For `exact` / `tbd` we synthesise ±50% around
 * the baseline — same heuristic the slider used before, now centralised so
 * both pages compute identical numbers.
 */
export function guestCountBounds(couple: Couple, baseline: number): { min: number; max: number } {
  const g = couple.guest_count_goal;
  if (g.kind === "range" && g.min !== null && g.max !== null) {
    return { min: g.min, max: g.max };
  }
  const min = Math.max(10, Math.round((baseline * 0.5) / 5) * 5);
  const max = Math.max(baseline + 20, Math.round((baseline * 1.5) / 5) * 5);
  return { min, max };
}
