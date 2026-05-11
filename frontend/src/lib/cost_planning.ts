// Shared "cost planning" headcount for the couple. Owned by the slider on
// /app/budget but mirrored to /app/suppliers' Vendégszám filter so couples
// don't have to re-type the same number on every page. The value is a pure
// what-if scenario — kept in localStorage so it never lands in the couple's
// permanent record (which is the legal /onboarding target_guest_count).
//
// Keying is per couple_id so a partner switching workspaces (rare today but
// possible in v2) doesn't inherit someone else's scenario count.
//
// Sync model:
// - BudgetPage writes on every slider commit.
// - SuppliersPage writes on every Vendégszám input commit.
// - Both pages read on mount and reflect the latest value.
// - Cross-tab updates propagate via the browser's `storage` event.

const LS_PREFIX = "weddly.cost_planning_count.";

function key(coupleId: number): string {
  return `${LS_PREFIX}${coupleId}`;
}

export function readCostPlanningCount(coupleId: number): number | null {
  try {
    const raw = localStorage.getItem(key(coupleId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : null;
  } catch {
    return null;
  }
}

export function writeCostPlanningCount(coupleId: number, count: number): void {
  if (!Number.isInteger(count) || count <= 0) return;
  try {
    localStorage.setItem(key(coupleId), String(count));
  } catch {
    // Quota / private-mode — bail silently; same-tab UI still works.
  }
}

export function clearCostPlanningCount(coupleId: number): void {
  try {
    localStorage.removeItem(key(coupleId));
  } catch {
    // ignore
  }
}

/** Subscribe to cross-tab changes for this couple's scenario count. Returns
 *  an unsubscribe function. Self-writes inside the same tab don't fire the
 *  `storage` event by spec — those are handled by each page's own state. */
export function subscribeCostPlanningCount(
  coupleId: number,
  cb: (next: number | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const targetKey = key(coupleId);
  const handler = (e: StorageEvent) => {
    if (e.key !== targetKey) return;
    if (e.newValue === null) {
      cb(null);
      return;
    }
    const n = Number(e.newValue);
    cb(Number.isInteger(n) && n > 0 ? n : null);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
