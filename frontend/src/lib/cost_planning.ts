// Shared "cost planning" headcount for the couple. Owned by the slider on
// /app/budget but mirrored to /app/suppliers' Vendégszám filter so couples
// don't have to re-type the same number on every page. The value is a pure
// what-if scenario — distinct from the legal onboarding target_guest_count
// goal that lives on `couples.guest_count_goal`.
//
// Storage moved server-side to `couples.planning_count` (PATCH /api/couples/current)
// so partner A on a laptop and partner B on a phone share one slider value.
// An in-memory cache mirrors the last value seen from the server (seeded by
// `hydrateCostPlanningCount(couple)` from any page that already calls
// `coupleApi.current()`). Writes are debounced 300ms so a slider drag is one
// request, not one-per-pixel. Cross-tab sync rides BroadcastChannel("weddly").

import type { Couple } from "@shared/types";
import { coupleApi } from "./endpoints";
import { ApiError } from "./api";
import { publish, subscribe } from "./sync";

const LS_PREFIX = "weddly.cost_planning_count.";

function lsKey(coupleId: number): string {
  return `${LS_PREFIX}${coupleId}`;
}

// In-memory cache + per-couple listener fan-out. Same pattern as
// supplier_selection.ts so the two libs read alike. Concurrency on writes
// is server-checked but we don't carry the couple's `updated_at` locally —
// `coupleApi.update` doesn't accept an `ifMatch` opt today and the slider is
// too low-stakes to require one (a 409 silently refetches and retries below).
const cache = new Map<number, number | null>();
const listeners = new Map<number, Set<(next: number | null) => void>>();
// Debounce handle per couple — slider drags collapse into one server write.
const pendingWrite = new Map<number, ReturnType<typeof setTimeout>>();
export type CostPlanningSaveStatus = "idle" | "saving" | "saved" | "error";
const saveStatuses = new Map<number, CostPlanningSaveStatus>();
const saveStatusListeners = new Map<number, Set<(status: CostPlanningSaveStatus) => void>>();
const savedStatusTimers = new Map<number, ReturnType<typeof setTimeout>>();
// Migration-already-attempted set so a hydrated null doesn't try to upload
// the same legacy localStorage value twice.
const migrated = new Set<number>();
// Couple ids we've ever hydrated for — used by the cross-tab listener to
// know whose state to refetch on a `planning_count:changed` ping.
const knownCouples = new Set<number>();
let crossTabInstalled = false;

const WRITE_DEBOUNCE_MS = 300;

function setSaveStatus(coupleId: number, status: CostPlanningSaveStatus): void {
  const timer = savedStatusTimers.get(coupleId);
  if (timer) {
    clearTimeout(timer);
    savedStatusTimers.delete(coupleId);
  }
  saveStatuses.set(coupleId, status);
  for (const cb of saveStatusListeners.get(coupleId) ?? []) cb(status);
  if (status === "saved") {
    const nextTimer = setTimeout(() => {
      savedStatusTimers.delete(coupleId);
      if (saveStatuses.get(coupleId) === "saved") setSaveStatus(coupleId, "idle");
    }, 2_000);
    savedStatusTimers.set(coupleId, nextTimer);
  }
}

function emit(coupleId: number) {
  const subs = listeners.get(coupleId);
  if (!subs || subs.size === 0) return;
  const value = cache.get(coupleId) ?? null;
  for (const cb of subs) {
    try {
      cb(value);
    } catch {
      // listener crash shouldn't break fan-out.
    }
  }
}

function isValidCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 100_000;
}

function readLocalStorage(coupleId: number): number | null {
  try {
    const raw = localStorage.getItem(lsKey(coupleId));
    if (!raw) return null;
    const n = Number(raw);
    return isValidCount(n) ? n : null;
  } catch {
    return null;
  }
}

function clearLocalStorage(coupleId: number): void {
  try {
    localStorage.removeItem(lsKey(coupleId));
  } catch {
    // ignore
  }
}

async function refetchCouple(coupleId: number): Promise<void> {
  try {
    const r = await coupleApi.current();
    const c = r.couple;
    if (!c || c.id !== coupleId) return;
    cache.set(coupleId, c.planning_count);
    emit(coupleId);
  } catch {
    // Best-effort — leave the cache untouched.
  }
}

function ensureCrossTabListener() {
  if (crossTabInstalled) return;
  crossTabInstalled = true;
  subscribe("planning_count:changed", () => {
    for (const coupleId of knownCouples) {
      void refetchCouple(coupleId);
    }
  });
}

/** Seed the cache from a `Couple` object the page already fetched. Idempotent
 *  — re-seeding with the same `updated_at` is a no-op. Also fires the legacy
 *  one-way localStorage → server migration if the server is null and the
 *  browser still has a value cached locally. */
export function hydrateCostPlanningCount(couple: Couple): void {
  knownCouples.add(couple.id);
  ensureCrossTabListener();
  const prev = cache.get(couple.id);
  const next = couple.planning_count;
  cache.set(couple.id, next);
  if (prev !== next) emit(couple.id);

  // One-way legacy migration. Only attempt once per couple per session, and
  // only when the server hasn't already adopted a value (so we never
  // overwrite a partner's choice with our stale local copy).
  if (next === null && !migrated.has(couple.id)) {
    migrated.add(couple.id);
    const legacy = readLocalStorage(couple.id);
    if (legacy !== null) {
      // Fire-and-forget. On success clear localStorage so we don't double-
      // upload on the next mount. On failure leave the entry alone — the
      // next hydrate will retry once the migration set is cleared (next
      // session).
      void (async () => {
        try {
          const r = await coupleApi.update({ planning_count: legacy });
          cache.set(couple.id, r.couple.planning_count);
          clearLocalStorage(couple.id);
          emit(couple.id);
          publish("planning_count:changed");
        } catch {
          // Stale-couple / network — give up silently.
        }
      })();
    } else {
      // Nothing to migrate but mark localStorage clean either way.
      clearLocalStorage(couple.id);
    }
  } else if (next !== null) {
    // Server already has a value — local copy is dead weight.
    clearLocalStorage(couple.id);
  }
}

/** Read the cached planning count. Returns `null` if no value has been
 *  hydrated yet (or the couple genuinely has no scenario count). Pages that
 *  already fetch the couple should call `hydrateCostPlanningCount(couple)`
 *  to seed the cache before the first read. */
export function readCostPlanningCount(coupleId: number): number | null {
  knownCouples.add(coupleId);
  ensureCrossTabListener();
  return cache.get(coupleId) ?? null;
}

async function performWrite(coupleId: number, value: number | null): Promise<void> {
  try {
    const r = await coupleApi.update({ planning_count: value });
    cache.set(coupleId, r.couple.planning_count);
    emit(coupleId);
    publish("planning_count:changed");
    setSaveStatus(coupleId, "saved");
  } catch (e) {
    // On a 409 (stale couple) silently refetch and retry once. The slider
    // is too low-stakes to bubble a "stale couple" toast.
    if (e instanceof ApiError && e.status === 409) {
      try {
        await coupleApi.current();
        const r = await coupleApi.update({ planning_count: value });
        cache.set(coupleId, r.couple.planning_count);
        emit(coupleId);
        publish("planning_count:changed");
        setSaveStatus(coupleId, "saved");
        return;
      } catch {
        // Final fall-through: refetch and let the UI reflect the server.
        setSaveStatus(coupleId, "error");
        try {
          await refetchCouple(coupleId);
        } catch {
          // Keep the optimistic value visible when even the recovery read is
          // offline; the error state makes clear that it was not persisted.
        }
        return;
      }
    }
    // Any other error: refetch so the slider snaps back to the server's view.
    setSaveStatus(coupleId, "error");
    try {
      await refetchCouple(coupleId);
    } catch {
      // See above: a failed recovery read must not swallow the save error.
    }
  }
}

function scheduleWrite(coupleId: number, value: number | null): void {
  const cur = pendingWrite.get(coupleId);
  if (cur) clearTimeout(cur);
  setSaveStatus(coupleId, "saving");
  const handle = setTimeout(() => {
    pendingWrite.delete(coupleId);
    void performWrite(coupleId, value);
  }, WRITE_DEBOUNCE_MS);
  pendingWrite.set(coupleId, handle);
}

export function readCostPlanningSaveStatus(coupleId: number): CostPlanningSaveStatus {
  return saveStatuses.get(coupleId) ?? "idle";
}

export function subscribeCostPlanningSaveStatus(
  coupleId: number,
  cb: (status: CostPlanningSaveStatus) => void,
): () => void {
  let bucket = saveStatusListeners.get(coupleId);
  if (!bucket) {
    bucket = new Set();
    saveStatusListeners.set(coupleId, bucket);
  }
  bucket.add(cb);
  return () => {
    const current = saveStatusListeners.get(coupleId);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) saveStatusListeners.delete(coupleId);
  };
}

/** Persist a new planning count for the couple. Updates the cache + fires
 *  subscribers synchronously; the actual server write is debounced 300ms so a
 *  slider drag collapses into one request. */
export function writeCostPlanningCount(coupleId: number, count: number): void {
  if (!isValidCount(count)) return;
  knownCouples.add(coupleId);
  ensureCrossTabListener();
  const prev = cache.get(coupleId);
  if (prev === count) return;
  cache.set(coupleId, count);
  emit(coupleId);
  scheduleWrite(coupleId, count);
}

/** Clear the scenario count back to "use the goal default". Same debounce +
 *  cache semantics as `writeCostPlanningCount`. */
export function clearCostPlanningCount(coupleId: number): void {
  knownCouples.add(coupleId);
  ensureCrossTabListener();
  const prev = cache.get(coupleId);
  if (prev === null || prev === undefined) {
    cache.set(coupleId, null);
    return;
  }
  cache.set(coupleId, null);
  emit(coupleId);
  scheduleWrite(coupleId, null);
}

/** Subscribe to scenario-count changes. The callback fires on subsequent cache
 *  updates only — same-tab writes after subscribe, future hydrations, and
 *  cross-tab BroadcastChannel pings. The initial value should be read via
 *  `readCostPlanningCount` so this matches the old localStorage-based
 *  contract (the storage event only fires on cross-tab changes, never on
 *  subscribe). Returns an unsubscribe function. */
export function subscribeCostPlanningCount(
  coupleId: number,
  cb: (next: number | null) => void,
): () => void {
  knownCouples.add(coupleId);
  ensureCrossTabListener();
  let bucket = listeners.get(coupleId);
  if (!bucket) {
    bucket = new Set();
    listeners.set(coupleId, bucket);
  }
  bucket.add(cb);
  return () => {
    const cur = listeners.get(coupleId);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) listeners.delete(coupleId);
  };
}
