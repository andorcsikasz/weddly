// Public newsletter capture (landing + blog) with double opt-in.
//
// POST /api/newsletter/subscribe   → pending row + confirm email (always 200,
//                                    so the endpoint can't probe who's signed up)
// POST /api/newsletter/confirm     → flips pending → confirmed
// POST /api/newsletter/unsubscribe → suppression record, never expires

import { PRIVACY_VERSION } from "@shared/legal";
import { CONFIG } from "../config";
import { recordConsent } from "../domain/consents";
import { sendKind } from "../domain/emails/send";
import { confirmByToken, subscribeEmail, unsubscribeByToken } from "../domain/newsletter";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

interface SubscribeBody {
  email?: unknown;
  locale?: unknown;
  source?: unknown;
  privacy_version?: unknown;
}

async function handleSubscribe(ctx: Ctx): Promise<Response> {
  // Anon endpoint — IP-bucket only. Same posture as the vendor waitlist form:
  // 5 attempts/hour absorbs a fat-fingered address without inviting bots.
  rateLimit(ctx.clientIp, "newsletter_subscribe", { capacity: 5, refillRate: 1 / 720 });

  const body = await readJson<SubscribeBody>(ctx.req);

  if (body.privacy_version !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date — please refresh the page");
  }

  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  if (!email) throw new HttpError(400, "email required");
  if (email.length > 200) throw new HttpError(400, "email too long (max 200)");
  const at = email.indexOf("@");
  if (at < 1 || email.indexOf(".", at) === -1) {
    throw new HttpError(400, "email is not valid");
  }

  const locale = body.locale === "en" ? "en" : "hu";

  let source: string | null = null;
  const sourceRaw = (typeof body.source === "string" ? body.source : "").trim();
  if (sourceRaw) {
    if (sourceRaw.length > 120) throw new HttpError(400, "source too long (max 120)");
    source = sourceRaw;
  }

  const { row, token } = subscribeEmail({ email, locale, source });

  // Already-confirmed addresses get no email and the same 200 as everyone
  // else — the response never reveals subscription state.
  if (token) {
    recordConsent({
      subjectUserId: null,
      subjectKind: "newsletter",
      subjectRef: String(row.id),
      document: "privacy",
      version: PRIVACY_VERSION,
      ip: ctx.clientIp,
      userAgent: ctx.req.headers.get("user-agent"),
    });
    addAuditLog({
      actor_user_id: null,
      couple_id: null,
      action: "newsletter.subscribe_requested",
      target_kind: "newsletter_subscriber",
      target_id: row.id,
      after: { locale, source },
    });
    const confirmUrl = `${CONFIG.frontendBaseUrl}/newsletter/confirm/${encodeURIComponent(token)}`;
    // Fire-and-forget: a mailer hiccup lands in email_log but the form
    // submission still succeeds.
    void sendKind(
      "newsletter_confirm",
      { confirmUrl },
      { user: null, guest: { email, full_name: "" } },
    );
  }

  return json({ ok: true });
}

interface TokenBody {
  token?: unknown;
}

async function handleConfirm(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "newsletter_token", { capacity: 10, refillRate: 1 / 60 });
  const body = await readJson<TokenBody>(ctx.req);
  const token = (typeof body.token === "string" ? body.token : "").trim();
  if (!token || token.length > 200) throw new HttpError(400, "token required");

  const result = confirmByToken(token);
  if (result === "invalid") throw new HttpError(404, "Unknown or superseded link");
  if (result === "expired") throw new HttpError(410, "This confirmation link has expired");
  return json({ ok: true, already: result === "already_confirmed" });
}

async function handleUnsubscribe(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "newsletter_token", { capacity: 10, refillRate: 1 / 60 });
  const body = await readJson<TokenBody>(ctx.req);
  const token = (typeof body.token === "string" ? body.token : "").trim();
  if (!token || token.length > 200) throw new HttpError(400, "token required");

  const result = unsubscribeByToken(token);
  if (result === "invalid") throw new HttpError(404, "Unknown or superseded link");
  return json({ ok: true, already: result === "already_unsubscribed" });
}

export function registerNewsletterRoutes(router: Router) {
  router.post("/api/newsletter/subscribe", handleSubscribe);
  router.post("/api/newsletter/confirm", handleConfirm);
  router.post("/api/newsletter/unsubscribe", handleUnsubscribe);
}
