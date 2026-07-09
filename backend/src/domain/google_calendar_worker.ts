// Background reconciler for Google Calendar push-sync. Every tick it picks up
// connections flagged `sync_state='dirty'` (set by planning/schedule writes)
// and reconciles them, coalescing bursts — e.g. the timeline generator inserting
// ~20 tasks at once marks the couple dirty once, and the next tick pushes all 20
// in a single diff. Entirely gated on GOOGLE_CALENDAR_ENABLED, so dev/local runs
// without the integration configured never start it. Mirrors domain/backup.ts.

import { GOOGLE_CALENDAR_ENABLED } from "../config";
import { log } from "../lib/logger";
import { listDirtyConnectionCoupleIds, syncCoupleCalendar } from "./google_calendar";

/** How often to drain the dirty queue. ~30s keeps "instant" feeling instant
 *  without hammering the Google API when nothing changed (idle couples cost a
 *  single indexed query). */
const SYNC_INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function drain(): Promise<void> {
  if (running) return; // never overlap ticks
  running = true;
  try {
    const ids = listDirtyConnectionCoupleIds();
    for (const coupleId of ids) {
      // syncCoupleCalendar never throws (records last_error internally), but
      // guard anyway so one couple can't wedge the loop.
      await syncCoupleCalendar(coupleId).catch((e) =>
        log.error("gcal.worker_couple_failed", { coupleId, err: String(e) }),
      );
    }
  } finally {
    running = false;
  }
}

/** Start the periodic reconcile loop. No-op when the integration is
 *  unconfigured. Idempotent. */
export function startGoogleCalendarWorker(): void {
  if (timer) return;
  if (!GOOGLE_CALENDAR_ENABLED) return;
  timer = setInterval(() => void drain(), SYNC_INTERVAL_MS);
  timer.unref?.();
}

export function stopGoogleCalendarWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
