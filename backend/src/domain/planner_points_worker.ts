// Drains the planner domain-event outbox into the planner points ledger.
//
// The twin of vendor_points_worker.ts: a table plus a timer is what a "queue"
// means in a single-service Bun app, and it buys the one property that matters
// here. Points are awarded in ONE place, asynchronously, so a rule that is slow
// or throwing can never break the request that emitted the event: a planner
// accepting a client must succeed whether or not the ledger writes.
//
// Ticks are short and idle-cheap (one indexed query against the partial index on
// unprocessed rows). The interval is snappy on purpose: a planner who just
// finished their profile reloads the page within seconds, and a progress bar that
// hasn't moved reads as broken.

import { log } from "../lib/logger";
import { processPlannerEventOutbox } from "./planner_points";

const TICK_MS = 15_000;

export function startPlannerPointsWorker(): void {
  const tick = () => {
    try {
      const done = processPlannerEventOutbox();
      if (done > 0) log.info("planner_points.worker", { processed: done });
    } catch (e) {
      // Never let a worker throw kill the process: the next tick retries.
      log.warn("planner_points.worker_failed", { error: String(e) });
    }
  };
  const timer = setInterval(tick, TICK_MS);
  // Don't hold the process open for a queue that is empty most of the time.
  timer.unref?.();
  tick();
}
