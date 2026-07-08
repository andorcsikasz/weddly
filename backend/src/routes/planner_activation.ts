// Public landing for admin-provisioned planner accounts. Two steps:
//   1. GET  /api/planner/activation/:token       - anon; read the view (doesn't consume)
//   2. POST /api/planner/activation/complete     - anon; set password + clickwrap accept
//                                                  legal docs + consume token + session
//
// The token IS the credential (256-bit, hash-at-rest, see auth/tokens.ts), so
// completing issues a session directly: the planner lands inside their
// workspace with the email already verified by the click itself.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import type { AuthSession, PlannerActivationView } from "@shared/types";
import { hashPassword } from "../auth/password";
import { issueSession } from "../auth/session";
import { db } from "../db";
import { recordConsent } from "../domain/consents";
import { completeActivation, requireActivationToken } from "../domain/planner_provisioning";
import { getUserById, toUser } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const VIEW_BUCKET = { capacity: 20, refillRate: 1 / 6 };
const COMPLETE_BUCKET = { capacity: 5, refillRate: 1 / 30 };

function handleView(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "planner_activation:view", VIEW_BUCKET);
  const row = requireActivationToken(ctx.params.token ?? "");
  const user = getUserById(row.user_id);
  if (!user) throw new HttpError(404, "Activation not found");

  const sub = db
    .prepare("SELECT founding_until, trial_ends_at FROM planner_subscriptions WHERE user_id = ?")
    .get(row.user_id) as
    | { founding_until: number | null; trial_ends_at: number | null }
    | undefined;

  const view: PlannerActivationView = {
    email: user.email,
    full_name: user.full_name,
    business_name: user.business_name ?? null,
    planner_category: user.planner_category ?? null,
    // Founding window when a slot was granted, else the (short) trial window;
    // fall back to the token's own expiry only when there is no sub row.
    free_until: sub?.founding_until ?? sub?.trial_ends_at ?? row.expires_at,
    expires_at: row.expires_at,
  };
  return json(view);
}

interface CompleteBody {
  token?: unknown;
  password?: unknown;
  privacy_version?: unknown;
  terms_version?: unknown;
  locale?: unknown;
}

async function handleComplete(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "planner_activation:complete", COMPLETE_BUCKET);
  const body = await readJson<CompleteBody>(ctx.req);
  if (typeof body.token !== "string") throw new HttpError(400, "Invalid token");
  if (
    typeof body.password !== "string" ||
    body.password.length < 8 ||
    body.password.length > 1024
  ) {
    throw new HttpError(400, "Password must be 8-1024 characters");
  }
  // Same clickwrap contract as /api/auth/register: the activate button's
  // microcopy names both documents, and a stale cached SPA is refused so the
  // consent ledger only ever records versions the user actually saw.
  if (body.privacy_version !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date, please refresh the page");
  }
  if (body.terms_version !== TERMS_VERSION) {
    throw new HttpError(400, "Terms version is out of date, please refresh the page");
  }

  const row = requireActivationToken(body.token);
  const user = getUserById(row.user_id);
  if (!user || user.status === "suspended") throw new HttpError(404, "Activation not found");

  const passwordHash = await hashPassword(body.password);
  const locale = body.locale === "hu" || body.locale === "en" ? body.locale : null;
  completeActivation(row, passwordHash, locale);

  const ip = ctx.clientIp;
  const userAgent = ctx.req.headers.get("user-agent");
  recordConsent({
    subjectUserId: user.id,
    subjectKind: "user",
    subjectRef: null,
    document: "privacy",
    version: PRIVACY_VERSION,
    ip,
    userAgent,
  });
  recordConsent({
    subjectUserId: user.id,
    subjectKind: "user",
    subjectRef: null,
    document: "terms",
    version: TERMS_VERSION,
    ip,
    userAgent,
  });

  addAuditLog({
    actor_user_id: user.id,
    couple_id: null,
    action: "planner.activate",
    target_kind: "user",
    target_id: user.id,
    after: { email: user.email },
  });

  const fresh = getUserById(user.id);
  if (!fresh) throw new HttpError(500, "Activation failed");
  const session: AuthSession = { token: issueSession(user.id), user: toUser(fresh) };
  return json(session, { status: 200 });
}

export function registerPlannerActivationRoutes(router: Router) {
  router.get("/api/planner/activation/:token", handleView);
  router.post("/api/planner/activation/complete", handleComplete);
}
