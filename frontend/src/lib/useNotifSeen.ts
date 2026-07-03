// Per-device "seen" watermark for the count-based notification dots in the pro
// shells (planner + vendor header bells). The couple bell has a server-side
// read watermark; these bells are computed from live counts, so without a
// watermark the dot would never clear on open. Last-seen counts live in
// localStorage; the dot shows only when a count RISES above its watermark.
// Falling counts lower the watermark, so resolving items re-arms the dot for
// the next new one instead of leaving a stale high-water mark.

import { useCallback, useEffect, useState } from "react";

type Counts = Record<string, number>;

function readSeen(key: string): Counts {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Counts = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSeen(key: string, counts: Counts) {
  try {
    localStorage.setItem(key, JSON.stringify(counts));
  } catch {
    /* localStorage blocked; the dot just behaves as always-on */
  }
}

/** `ready` must stay false until `counts` reflect fetched data: the transient
 *  all-zero mount state would otherwise lower the watermark and re-arm the dot
 *  on every reload. */
export function useNotifSeen(
  storageKey: string,
  counts: Counts,
  ready: boolean,
): { dot: boolean; markSeen: () => void } {
  const [seen, setSeen] = useState<Counts>(() => readSeen(storageKey));

  useEffect(() => {
    if (!ready) return;
    setSeen((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const [k, v] of Object.entries(counts)) {
        if ((next[k] ?? 0) > v) {
          next[k] = v;
          changed = true;
        }
      }
      if (!changed) return cur;
      writeSeen(storageKey, next);
      return next;
    });
  }, [storageKey, counts, ready]);

  const dot = ready && Object.entries(counts).some(([k, v]) => v > (seen[k] ?? 0));

  const markSeen = useCallback(() => {
    if (!ready) return;
    setSeen({ ...counts });
    writeSeen(storageKey, counts);
  }, [storageKey, counts, ready]);

  return { dot, markSeen };
}
