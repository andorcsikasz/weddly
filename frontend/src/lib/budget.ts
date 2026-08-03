// Shared budget mutations. Used by BudgetPage and the cost-planning panel
// embedded on DashboardPage.
//
// Every category write is split in two: a **pure planner** that computes the
// new row values synchronously, and a **committer** that pushes them to the
// API and hands back the server's rows. Callers apply the plan to local state
// straight away and re-merge the server rows once they land. That split is
// load-bearing — see the comment on `LinePlan`.

import type { BudgetCategory, BudgetLine } from "@shared/types";
import { budgetApi } from "./endpoints";

/** The three money fields a category edit can bulk-apply. */
export type LineAmountField = "planned_huf" | "actual_huf" | "paid_huf";

/** Row the server has to create because the category owns none yet. */
export type NewLineDraft = {
  category: BudgetCategory;
  label: string;
  planned_huf: number;
  actual_huf: number;
};

/** A computed-but-not-yet-sent category write.
 *
 *  Splitting plan from commit is what keeps the budget panel responsive on a
 *  slow connection. The old code awaited the PATCH before touching local
 *  state, so between slider release and response the new amount existed
 *  *only* in the panel's transient drag preview — and the moment the user
 *  grabbed another row, that preview was dropped and the row snapped back to
 *  its pre-edit value. Now the caller merges `updates` locally first and
 *  reconciles with the server rows afterwards. */
export type LinePlan = {
  field: LineAmountField;
  /** Existing rows with the new amount applied, narrowed to the ones that
   *  actually changed. They carry the `updated_at` we last saw, so callers
   *  MUST re-merge whatever `commitLinePlan` returns — otherwise a follow-up
   *  If-Match write on the same row sends a stale version and 409s the user
   *  against their own edit. */
  updates: BudgetLine[];
  create: NewLineDraft | null;
};

/** A line whose amounts mirror a booked supplier's own record — `planned_huf`
 *  mirrors `couple_suppliers.price_huf`, `actual_huf` follows the paid
 *  installments. The supplier card owns those numbers, so the server refuses
 *  every write to the line: `PATCH /api/budget/lines/:id` answers
 *  `409 {code:"locked"}`, and DELETE does the same. Nothing in here may ever
 *  plan a write to one.
 *
 *  BOTH ownership columns count, and asking about only one is how the 409 comes
 *  back. `couple_supplier_id` is the couple's own private row; `listing_id` is a
 *  directory supplier they priced and then picked. The two are mutually
 *  exclusive per line, but they lock it for the identical reason, so every
 *  caller wants the question "does anything else own this line", never "which
 *  of the two owns it". */
export function isSupplierManagedLine(line: BudgetLine): boolean {
  return line.couple_supplier_id !== null || line.listing_id !== null;
}

/** Categories whose aggregate amounts no budget surface may edit, because at
 *  least ONE of their lines mirrors a booked supplier.
 *
 *  One mirrored line is enough, and that is the point rather than an
 *  approximation: `distribute` spreads a category TOTAL across the rows it is
 *  allowed to write, so with a mirrored row held back the bucket would settle
 *  on `mirrored + newTotal` instead of on the number the slider was released
 *  on, and the thumb would jump away on the next render. A control that
 *  reliably produces a different number than the one it shows is worse than no
 *  control. Same rule the budget table already applies to its own aggregate
 *  inputs (`categoryBuckets.editable` in BudgetPage).
 *
 *  Pass the same lines the caller aggregates into buckets: a custom row is its
 *  own row rather than part of its category's bucket, so it must not lock the
 *  bucket it happens to share a category with. */
export function supplierManagedCategories(lines: BudgetLine[]): Set<BudgetCategory> {
  const locked = new Set<BudgetCategory>();
  for (const l of lines) if (isSupplierManagedLine(l)) locked.add(l.category);
  return locked;
}

/** Field-typed setter — a computed key (`{...line, [field]: v}`) widens to a
 *  string index signature that no longer satisfies `BudgetLine`. */
function withAmount(line: BudgetLine, field: LineAmountField, value: number): BudgetLine {
  switch (field) {
    case "planned_huf":
      return { ...line, planned_huf: value };
    case "actual_huf":
      return { ...line, actual_huf: value };
    case "paid_huf":
      return { ...line, paid_huf: value };
  }
}

/** Minimal PATCH body for one amount field. Deliberately NOT the whole row:
 *  a full body also carries `label`, and the backend clears `preset_key`
 *  whenever a label is present — so every amount edit silently dropped the
 *  row's preset name and its translated label with it. */
export function amountBody(field: LineAmountField, value: number): Partial<BudgetLine> {
  switch (field) {
    case "planned_huf":
      return { planned_huf: value };
    case "actual_huf":
      return { actual_huf: value };
    case "paid_huf":
      return { paid_huf: value };
  }
}

/** Proportional split of `newTotal` across `inCat` weighted by each row's
 *  current value. Zero current total → the whole sum lands on the first row
 *  so we don't silently lose information. Round-off drift is folded back into
 *  the first row so the bucket sums exactly. Returns only the rows whose value
 *  moved — an unchanged row costs a pointless PATCH otherwise. */
function distribute(
  inCat: BudgetLine[],
  field: LineAmountField,
  newTotal: number,
  clampToActual = false,
): BudgetLine[] {
  const oldTotal = inCat.reduce((s, l) => s + l[field], 0);
  const updates = inCat.map((l, i) => {
    const raw =
      oldTotal > 0 ? Math.round((l[field] / oldTotal) * newTotal) : i === 0 ? newTotal : 0;
    return withAmount(l, field, clampToActual ? Math.max(0, Math.min(raw, l.actual_huf)) : raw);
  });
  // Clamped distributions can't be drift-corrected — pushing the remainder
  // into the first row would just breach its own clamp again.
  if (!clampToActual) {
    const drift = newTotal - updates.reduce((s, l) => s + l[field], 0);
    const first = updates[0];
    if (drift !== 0 && first) updates[0] = withAmount(first, field, first[field] + drift);
  }
  return updates.filter((l, i) => l[field] !== inCat[i]?.[field]);
}

/** Plan a new total `planned_huf` for a category. Behaviour by line count,
 *  counting only the lines this couple may actually write:
 *  - 0 lines → creates one with that planned total + the supplied label.
 *  - 1 line  → updates its `planned_huf`.
 *  - N lines → scales every line proportionally to match the new total.
 *
 *  Supplier-mirrored lines are skipped, exactly as in `planCategoryActual` /
 *  `planCategoryPaid`, and for the same reason: `planned_huf` on such a line
 *  mirrors `couple_suppliers.price_huf`, so it is owned by the supplier record
 *  and the server 409s any PATCH to it. This one used to lack the filter, so
 *  the slider for any category whose lines came from a booked supplier planned
 *  a write that could not land — a guaranteed failed save, every drag. */
export function planCategoryPlanned(
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
): LinePlan {
  const scoped = lines.filter((l) => l.category === category && (filter ? filter(l) : true));
  const inCat = scoped.filter((l) => !isSupplierManagedLine(l));
  if (inCat.length === 0) {
    // A category whose every line is supplier-managed must NOT fall through to
    // the create branch. A fresh free line would carry the whole new total on
    // top of an amount the supplier already owns, so the bucket would land on
    // `mirrored + newTotal` — a different number from the one the slider was
    // released on, and one nothing would ever reconcile. There is nothing
    // writable here to absorb the change, so the plan is empty. Keeping the
    // control off the screen is `supplierManagedCategories`' job; this branch
    // is what makes the answer safe for any caller that asks anyway.
    if (scoped.length > 0) return { field: "planned_huf", updates: [], create: null };
    return {
      field: "planned_huf",
      updates: [],
      create: { category, label: fallbackLabel, planned_huf: newTotal, actual_huf: 0 },
    };
  }
  return {
    field: "planned_huf",
    updates: distribute(inCat, "planned_huf", newTotal),
    create: null,
  };
}

/** Plan a new total `actual_huf` for a category. Same scaling rules as
 *  `planCategoryPlanned`. DIY-supplier-linked lines (`couple_supplier_id` not
 *  null) are owned by the supplier card and would 409 if we tried to write
 *  them — filter them out so the rest of the category still scales. */
export function planCategoryActual(
  category: BudgetCategory,
  newTotal: number,
  lines: BudgetLine[],
  fallbackLabel: string,
  /** Same scope-narrowing escape hatch as `planCategoryPlanned` — see that
   *  helper for the reasoning behind the parameter. */
  filter?: (line: BudgetLine) => boolean,
): LinePlan {
  const inCat = lines.filter(
    (l) => l.category === category && !isSupplierManagedLine(l) && (filter ? filter(l) : true),
  );
  if (inCat.length === 0) {
    return {
      field: "actual_huf",
      updates: [],
      create: { category, label: fallbackLabel, planned_huf: 0, actual_huf: newTotal },
    };
  }
  return { field: "actual_huf", updates: distribute(inCat, "actual_huf", newTotal), create: null };
}

/** Plan a new total `paid_huf` for a category, distributing across its lines
 *  in proportion to each line's `actual_huf` (so paid spreads like cost) and
 *  clamping each row to its own actual — the server re-clamps anyway. DIY
 *  supplier lines are owned by the supplier card (paid is derived there), so
 *  they're filtered out. Marking a category "fully paid" is just
 *  `planCategoryPaid(cat, bucketActual)`; clearing is `planCategoryPaid(cat, 0)`. */
export function planCategoryPaid(
  category: BudgetCategory,
  newTotal: number,
  lines: BudgetLine[],
  filter?: (line: BudgetLine) => boolean,
): LinePlan {
  const inCat = lines.filter(
    (l) => l.category === category && !isSupplierManagedLine(l) && (filter ? filter(l) : true),
  );
  return {
    field: "paid_huf",
    updates: distribute(inCat, "paid_huf", newTotal, true),
    create: null,
  };
}

/** True when a plan has nothing to send — the drag was released on the value
 *  the rows already hold. */
export function isNoopPlan(plan: LinePlan): boolean {
  return plan.create === null && plan.updates.length === 0;
}

/** Push a plan to the API and return the server's authoritative rows (fresh
 *  `updated_at`). Merge them into local state so the next If-Match write on
 *  the same row doesn't send a stale version. */
export async function commitLinePlan(plan: LinePlan): Promise<BudgetLine[]> {
  const rows: BudgetLine[] = [];
  if (plan.create) {
    const r = await budgetApi.createLine(plan.create);
    rows.push(r.line);
  }
  const patched = await Promise.all(
    plan.updates.map((l) => budgetApi.updateLine(l.id, amountBody(plan.field, l[plan.field]))),
  );
  for (const r of patched) rows.push(r.line);
  return rows;
}

/** Merge rows into a list **by id**, preserving every row the caller didn't
 *  touch and appending ones it doesn't know yet. Replacing the whole array
 *  with one derived from a stale snapshot is what used to revert a concurrent
 *  edit on a different row. */
export function mergeLines(prev: BudgetLine[], next: BudgetLine[]): BudgetLine[] {
  if (next.length === 0) return prev;
  const byId = new Map(next.map((l) => [l.id, l]));
  const merged = prev.map((l) => byId.get(l.id) ?? l);
  const known = new Set(prev.map((l) => l.id));
  for (const l of next) if (!known.has(l.id)) merged.push(l);
  return merged;
}

/** Plan + commit + merge in one call, for the blocking flows (freeze /
 *  unfreeze) that rewrite a category and then need the updated array back
 *  before their next step. */
export async function applyCategoryPlanned(
  category: BudgetCategory,
  newTotal: number,
  lines: BudgetLine[],
  fallbackLabel: string,
  filter?: (line: BudgetLine) => boolean,
): Promise<BudgetLine[]> {
  const plan = planCategoryPlanned(category, newTotal, lines, fallbackLabel, filter);
  if (isNoopPlan(plan)) return lines;
  return mergeLines(lines, await commitLinePlan(plan));
}

/** Per-key serialiser for budget writes.
 *
 *  Two jobs. **Ordering:** two quick drags on the same row used to PATCH
 *  concurrently, so the server kept whichever response happened to land last.
 *  **Staleness:** a slow first response must not overwrite the newer value
 *  the user has produced since — `latest` is false for any result that has
 *  been superseded, and callers skip the state merge for those. */
export type BudgetWriteQueue = {
  run<T>(key: string, task: () => Promise<T>): Promise<{ result: T; latest: boolean }>;
};

export function createBudgetWriteQueue(): BudgetWriteQueue {
  const tails = new Map<string, Promise<unknown>>();
  const tickets = new Map<string, number>();
  return {
    async run<T>(key: string, task: () => Promise<T>) {
      const ticket = (tickets.get(key) ?? 0) + 1;
      tickets.set(key, ticket);
      const tail = tails.get(key) ?? Promise.resolve();
      // `then(task, task)` so a failed predecessor doesn't strand the queue.
      const run = tail.then(task, task);
      tails.set(
        key,
        run.catch(() => undefined),
      );
      const result = await run;
      return { result, latest: tickets.get(key) === ticket };
    },
  };
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
