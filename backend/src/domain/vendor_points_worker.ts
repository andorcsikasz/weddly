// Drains the vendor domain-event outbox into the points ledger.
//
// The "queue" for a single-service Bun app is a table plus this timer, matching
// the email and Google-Calendar workers. It buys the property that actually
// matters here: points are awarded in ONE place, asynchronously, so a slow or
// failing rule can never break the request that emitted the event.
//
// Ticks are short and idle-cheap (one indexed query against a partial index on
// unprocessed rows). The interval is deliberately snappy: a vendor who just
// collected a review reloads the dashboard within seconds, and a progress bar
// that hasn't moved reads as broken.

import { log } from "../lib/logger";
import { processVendorEventOutbox } from "./vendor_points";

const TICK_MS = 15_000;

export function startVendorPointsWorker(): void {
  const tick = () => {
    try {
      const done = processVendorEventOutbox();
      if (done > 0) log.info("vendor_points.worker", { processed: done });
    } catch (e) {
      // Never let a worker throw kill the process: the next tick retries.
      log.warn("vendor_points.worker_failed", { error: String(e) });
    }
  };
  const timer = setInterval(tick, TICK_MS);
  // Don't hold the process open for a queue that is empty most of the time.
  timer.unref?.();
  tick();
}
