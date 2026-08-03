// AI Concierge API — the assistant strip on the vendor's client detail.
//
//   GET  /api/ai/availability                  — { available } so the UI hides
//                                                the whole strip when no
//                                                ANTHROPIC_API_KEY is set
//   POST /api/vendor/clients/:id/ai-assist     — one summary + one draft reply +
//                                                one package suggestion
//
// Gating, in the order it is applied:
//
//   1. VENDOR ROLE + OWNERSHIP (`resolveVendorAccount` + `getOwnedBooking`), so
//      a foreign booking id 404s rather than 403s and cannot be enumerated.
//   2. PRO (`requireVendorPro`, 403 `vendor_pro_required`). Applied BEFORE the
//      rate limit deliberately: a FREE vendor's refused calls must not eat the
//      bucket of a plan they are not on.
//   3. RATE LIMIT PER VENDOR ACCOUNT, not per IP. The cost here is a model call
//      on our bill, and the account is who spends it — an office behind one NAT
//      is several vendors, and one vendor on a phone and a laptop is one.
//   4. CONFIGURED (503). Last, because it is the cheapest thing to be wrong
//      about and the UI should never have asked.
//
// What is deliberately NOT here: any path from a model output to an outbound
// message. The answer is returned to the vendor's browser and stops there.

import type { AiAvailability, InquiryAssistResult } from "@shared/ai_assist";
import { generateInquiryAssist } from "../domain/ai_assist";
import { getOwnedBooking, requireVendorPro, resolveVendorAccount } from "../domain/vendor_clients";
import { aiConfigured } from "../lib/ai";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { AI_ASSIST_BUCKET, rateLimit } from "../lib/rate_limit";

/** Availability is a pure in-process env check with no upstream call, so it
 *  stays unauthenticated and unthrottled — it reveals a feature-flag bit and
 *  nothing else. Same shape as GET /api/translate/availability. */
function handleAvailability(): Response {
  const body: AiAvailability = { available: aiConfigured() };
  return json(body);
}

function parseId(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid client id");
  return n;
}

async function handleAssist(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  // Keyed on the vendor ACCOUNT, so the budget follows whoever spends it.
  rateLimit(`vendor:${account.id}`, "ai_assist", AI_ASSIST_BUCKET);
  if (!aiConfigured()) {
    throw new HttpError(503, "The assistant is not configured", { code: "ai_not_configured" });
  }
  const booking = getOwnedBooking(account.id, parseId(ctx.params.id));
  const result: InquiryAssistResult = await generateInquiryAssist(booking, account.id);
  // A model that produced nothing usable is a 200 with `generated:false`. The
  // strip renders nothing; the page it sits on is unaffected.
  return json(result);
}

export function registerAiAssistRoutes(router: Router) {
  router.get("/api/ai/availability", handleAvailability);
  router.post("/api/vendor/clients/:id/ai-assist", handleAssist, true);
}
