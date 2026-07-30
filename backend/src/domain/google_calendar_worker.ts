// Background reconciler for Google Calendar push-sync. Every tick it picks up
// connections flagged `sync_state='dirty'` (set by planning/schedule writes)
// and reconciles them, coalescing bursts — e.g. the timeline generator inserting
// ~20 tasks at once marks the couple dirty once, and the next tick pushes all 20
// in a single diff. Entirely gated on GOOGLE_CALENDAR_ENABLED, so dev/local runs
// without the integration configured never start it. Mirrors domain/backup.ts.

import { GOOGLE_CALENDAR_ENABLED } from "../config";
import { log } from "../lib/logger";
import { listDirtyConnectionCoupleIds, syncCoupleCalendar } from "./google_calendar";
import {
  listDirtyVendorAccountIds,
  listVendorAccountIdsNeedingBusyPull,
  syncVendorCalendar,
  syncVendorExternalBusy,
} from "./vendor_google_calendar";

/** How often to drain the dirty queue. ~30s keeps "instant" feeling instant
 *  without hammering the Google API when nothing changed (idle couples cost a
 *  single indexed query). */
const SYNC_INTERVAL_MS = 30_000;

/** How stale a vendor's pulled free/busy may get. The pull CANNOT be
 *  dirty-driven the way the push is: nothing in Weddly knows when the vendor
 *  edits their own Google calendar, so it is a poll, and this interval is the
 *  whole cost control. A year of horizon is five free/busy calls, so 30 minutes
 *  is ten calls an hour for a connected vendor, and "Sync now" covers the vendor
 *  who just moved a gig and wants to see it land. */
const BUSY_PULL_INTERVAL_MS = 30 * 60_000;

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
    // Vendors drain on the SAME timer rather than a second interval: both queues
    // are one indexed query when idle, and sharing the tick keeps the "never
    // overlap" guarantee across both aggregates instead of two loops racing for
    // the Google API quota.
    const vendorIds = listDirtyVendorAccountIds();
    for (const vendorAccountId of vendorIds) {
      await syncVendorCalendar(vendorAccountId).catch((e) =>
        log.error("gcal.worker_vendor_failed", { vendorAccountId, err: String(e) }),
      );
    }

    // The PULL half, on the same tick but its own (much longer) clock: the
    // queue is "whose free/busy is older than the interval", so a connection
    // that just synced is skipped by the query rather than by a counter here.
    const pullIds = listVendorAccountIdsNeedingBusyPull(BUSY_PULL_INTERVAL_MS);
    for (const vendorAccountId of pullIds) {
      await syncVendorExternalBusy(vendorAccountId).catch((e) =>
        log.error("gcal.worker_vendor_pull_failed", { vendorAccountId, err: String(e) }),
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
