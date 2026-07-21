// Verified-visitor email confirmation (no account, no session).
//
// POST /api/visitors/verify/request  → pending row + confirm email (always 200,
//                                       so it can't probe who's verified)
// POST /api/visitors/verify/:token   → consume link → { visitor, token } device token
// GET  /api/visitors/me              → resolve X-Visitor-Token → { visitor }
//
// The device token returned by /:token is stored client-side and replayed on the
// X-Visitor-Token header; suggest-supplier and review endpoints resolve it via
// requireVerifiedVisitor (domain/verified_visitors.ts). See shared/verified_visitors.ts.

import type { VisitorSession } from "@shared/verified_visitors";
import { CONFIG } from "../config";
import { sendKind } from "../domain/emails/send";
import {
  consumeVisitorVerify,
  optionalVerifiedVisitor,
  requestVisitorVerify,
  toVerifiedVisitor,
} from "../domain/verified_visitors";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

interface RequestBody {
  email?: unknown;
  full_name?: unknown;
  locale?: unknown;
}

async function handleRequest(ctx: Ctx): Promise<Response> {
  // Anon endpoint — IP bucket only, same posture as newsletter/verify-resend:
  // 5 attempts/hour absorbs a typo without inviting a mail-bomb of a stranger.
  rateLimit(ctx.clientIp, "visitor_verify_request", { capacity: 5, refillRate: 1 / 720 });

  const body = await readJson<RequestBody>(ctx.req);

  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  if (!email) throw new HttpError(400, "email required");
  if (email.length > 200) throw new HttpError(400, "email too long (max 200)");
  const at = email.indexOf("@");
  if (at < 1 || email.indexOf(".", at) === -1) throw new HttpError(400, "email is not valid");

  const locale = body.locale === "hu" ? "hu" : "en";
  let fullName: string | null = null;
  const nameRaw = (typeof body.full_name === "string" ? body.full_name : "").trim();
  if (nameRaw) {
    if (nameRaw.length > 120) throw new HttpError(400, "name too long (max 120)");
    fullName = nameRaw;
  }

  const { row, token } = requestVisitorVerify({ email, full_name: fullName, locale });

  addAuditLog({
    actor_user_id: null,
    couple_id: null,
    action: "visitor.verify_requested",
    target_kind: "verified_visitor",
    target_id: row.id,
    after: { locale },
  });

  const verifyUrl = `${CONFIG.frontendBaseUrl}/visitor/verify/${encodeURIComponent(token)}`;
  // Fire-and-forget: a mailer hiccup lands in email_log but the request still
  // succeeds. `pending` branch = own address, own locale, no opt-out check.
  void sendKind(
    "visitor_verify",
    { verifyUrl },
    { user: null, pending: { email, full_name: fullName ?? "", locale } },
  );

  return json({ ok: true });
}

async function handleConsume(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "visitor_verify_consume", { capacity: 10, refillRate: 1 / 30 });
  const token = (ctx.params.token ?? "").trim();
  if (!token || token.length > 200) throw new HttpError(400, "token required");

  const result = consumeVisitorVerify(token);
  if (!result.ok) {
    if (result.reason === "expired") {
      throw new HttpError(410, "This confirmation link has expired");
    }
    throw new HttpError(404, "Unknown or superseded link");
  }

  addAuditLog({
    actor_user_id: null,
    couple_id: null,
    action: "visitor.verified",
    target_kind: "verified_visitor",
    target_id: result.visitor.id,
  });

  const payload: VisitorSession = {
    visitor: toVerifiedVisitor(result.visitor),
    token: result.deviceToken,
  };
  return json(payload, { status: 201 });
}

async function handleMe(ctx: Ctx): Promise<Response> {
  const visitor = optionalVerifiedVisitor(ctx);
  if (!visitor) throw new HttpError(401, "Visitor email not verified", { code: "visitor_unverified" });
  return json({ visitor: toVerifiedVisitor(visitor) });
}

export function registerVerifiedVisitorRoutes(router: Router) {
  router.post("/api/visitors/verify/request", handleRequest);
  router.post("/api/visitors/verify/:token", handleConsume);
  router.get("/api/visitors/me", handleMe);
}
