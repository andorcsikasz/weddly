// Same-session privileged elevation. This route never performs account lookup
// by caller-supplied email, creates/links an account, or returns/replaces a
// session credential. Possession of the existing HttpOnly session plus the
// admin's application TOTP factor is required.

import { elevateSession, extractToken } from "../auth/session";
import { verifyTotp } from "../auth/totp";
import { CONFIG } from "../config";
import { getUserById, isAdminEmail } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

interface StepUpBody {
  code?: unknown;
}

async function handleAdminStepUp(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  rateLimit(ctx.clientIp, "auth:admin_step_up:ip", { capacity: 8, refillRate: 8 / 600 });
  rateLimit(`user:${userId}`, "auth:admin_step_up:user", { capacity: 5, refillRate: 5 / 600 });
  const user = getUserById(userId);
  if (!user || !isAdminEmail(user.email)) throw new HttpError(403, "Admin only");
  const secret = CONFIG.adminTotpSecrets.get(user.email.trim().toLowerCase());
  if (!secret) {
    throw new HttpError(503, "Admin MFA is not configured", { code: "admin_mfa_unavailable" });
  }
  const body = await readJson<StepUpBody>(ctx.req);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const counter = verifyTotp(secret, code);
  const token = extractToken(ctx.req);
  if (counter === null || !token || !elevateSession(token, userId, counter)) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: null,
      action: "auth.admin_step_up_failed",
      target_kind: "user",
      target_id: userId,
    });
    throw new HttpError(403, "Invalid or already-used authentication code", {
      code: "admin_mfa_invalid",
    });
  }
  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "auth.admin_step_up",
    target_kind: "user",
    target_id: userId,
  });
  return json({ ok: true, valid_until: Date.now() + CONFIG.adminReauthTtlMs });
}

export function registerAuthStepUpRoutes(router: Router): void {
  router.post("/api/auth/admin-step-up", handleAdminStepUp, true);
}
