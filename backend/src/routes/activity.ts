// Lightweight "are you still here" heartbeat that feeds the admin's
// per-user total-active-time metric (domain/activity.ts,
// AdminUserActivity.total_active_seconds on the admin users/couples lists).
// Any authenticated account type can call it — couple, vendor, planner —
// since "my users" in the admin sense means everyone with a login, not just
// couples. See useActivityHeartbeat.ts on the frontend for the call cadence.

import { recordActivityHeartbeat } from "../domain/activity";
import { type Ctx, json, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

// A little slack over ACTIVITY_HEARTBEAT_INTERVAL_S so a couple of open tabs
// don't 429 each other; still far too tight for a runaway retry loop to
// meaningfully inflate the total.
const HEARTBEAT_BUCKET = { capacity: 6, refillRate: 1 / 20 };

function handleHeartbeat(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  rateLimit(`user:${userId}`, "activity.heartbeat", HEARTBEAT_BUCKET);
  recordActivityHeartbeat(userId);
  return json({ ok: true });
}

export function registerActivityRoutes(router: Router) {
  router.post("/api/activity/heartbeat", handleHeartbeat, true);
}
