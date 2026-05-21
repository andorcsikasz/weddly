// Frontend ping endpoint for the small set of growth events that can ONLY
// originate from the browser (e.g. "couple clicked the copy-share-link
// button"). Server-side handlers cover the rest — see
// `recordGrowthEventFromRequest` call sites in routes/rsvp.ts,
// routes/guest_portal.ts, routes/auth.ts.
//
// Anonymous-tolerant + IP rate-limited so a runaway script can't fill the
// table with spurious events.

import type { GrowthEventKind, RecordGrowthEventInput } from "@shared/growth";
import { FRONTEND_GROWTH_EVENT_KINDS } from "@shared/growth";
import { getCoupleForUser } from "../domain/couples";
import { recordGrowthEventFromRequest } from "../domain/growth_events";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const GROWTH_BUCKET = { capacity: 60, refillRate: 1 };

async function handleRecord(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "growth:event", GROWTH_BUCKET);

  const body = await readJson<RecordGrowthEventInput>(ctx.req).catch(
    () => ({}) as RecordGrowthEventInput,
  );
  const kindRaw = typeof body.kind === "string" ? body.kind : "";
  if (!FRONTEND_GROWTH_EVENT_KINDS.has(kindRaw as GrowthEventKind)) {
    throw new HttpError(400, "Unsupported event kind");
  }
  const kind = kindRaw as GrowthEventKind;

  // Resolve couple from session (when present) so the admin funnel view can
  // attribute the share-link copy to a specific wedding.
  const coupleId = ctx.userId ? (getCoupleForUser(ctx.userId)?.id ?? null) : null;

  // Payload is optional; clamp to a defensive 2KB max so malformed clients
  // can't bloat the table.
  let payload: Record<string, unknown> | null = null;
  if (body.payload && typeof body.payload === "object") {
    const serialised = JSON.stringify(body.payload);
    if (serialised.length <= 2048) payload = body.payload as Record<string, unknown>;
  }

  recordGrowthEventFromRequest(kind, ctx.req, {
    couple_id: coupleId,
    user_id: ctx.userId ?? null,
    payload,
  });

  return json({ recorded: 1 });
}

export function registerGrowthRoutes(router: Router) {
  router.post("/api/growth/event", handleRecord);
}
