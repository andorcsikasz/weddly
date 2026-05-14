// Honeymoon-page server endpoints. Today it's just the flight estimate —
// other honeymoon state (destination, dates) lives on the couples row and is
// read/written through /api/couples. Keeping the estimate behind its own
// route lets us cache + refresh independently and skip the network entirely
// when Amadeus credentials aren't set.

import { getCoupleForUser } from "../domain/couples";
import { getFlightEstimate } from "../domain/honeymoon_flights";
import { type Ctx, json, requireAuth, type Router } from "../lib/http";

async function handleFlightEstimate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) return json({ estimate: null });
  const estimate = await getFlightEstimate(couple);
  return json({ estimate });
}

export function registerHoneymoonRoutes(router: Router) {
  router.get("/api/honeymoon/flight-estimate", handleFlightEstimate, true);
}
