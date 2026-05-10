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
): Promise<BudgetLine[]> {
  const inCat = lines.filter((l) => l.category === category);

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
