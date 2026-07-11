// Batched ingest for planner directory analytics — the planner twin of
// `POST /api/suppliers/events`. The couple-facing rail on /app/vendors sends a
// batch per page-load (card impressions) plus click-throughs (open profile,
// Felkérés, website). Couple-authed (the rail only renders for a signed-in
// couple), rate-limited per IP so a client can't flood the table.

import type { PlannerEventInput } from "@shared/types";
import { getCoupleForUser } from "../domain/couples";
import { recordPlannerEvents } from "../domain/planner_views";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

interface EventsBody {
  events?: unknown;
}

async function handleRecordEvents(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  rateLimit(ctx.clientIp, "planners.events", { capacity: 60, refillRate: 1 });
  const body = await readJson<EventsBody>(ctx.req).catch(() => ({}) as EventsBody);
  if (!Array.isArray(body.events)) {
    throw new HttpError(400, "events must be an array");
  }
  if (body.events.length > 200) {
    throw new HttpError(400, "events batch too large (max 200)");
  }
  const coupleId = getCoupleForUser(userId)?.id ?? null;
  const written = recordPlannerEvents(body.events as PlannerEventInput[], userId, coupleId);
  return json({ recorded: written });
}

export function registerPlannerEventsRoutes(router: Router) {
  router.post("/api/planners/events", handleRecordEvents);
}
