// Timeline -> Google Calendar push-sync endpoints. The couple connects their
// Google account once (OAuth authorization-code flow); Weddly then creates a
// dedicated secondary calendar and one-way syncs dated tasks + the wedding day
// + the day-of run sheet into it. See domain/google_calendar.ts for the sync
// logic and lib/google_calendar.ts for the OAuth/API plumbing.
//
// Feature-gated on GOOGLE_CALENDAR_ENABLED (OAuth client id + secret configured)
// exactly like the Google-sign-in / Stripe "configured?" pattern: unconfigured =
// status.configured:false and /connect 503s, app unaffected.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { GoogleCalendarStatus } from "@shared/types";
import { CONFIG, GOOGLE_CALENDAR_ENABLED } from "../config";
import { getCoupleForUser } from "../domain/couples";
import {
  disconnectCoupleCalendar,
  getConnectionRow,
  saveConnection,
  syncCoupleCalendar,
  timeZoneForCouple,
} from "../domain/google_calendar";
import { now } from "../db";
import { buildAuthUrl, exchangeCode } from "../lib/google_calendar";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";

const STATE_TTL_MS = 10 * 60 * 1000;

// ─── Signed OAuth `state` (CSRF + binds the flow to the initiating user) ──────
// Format: base64url(`${userId}.${exp}`).sig, HMAC-SHA256 with JWT_SECRET. The
// callback is public (a top-level browser redirect can't carry the session
// bearer), so the state is what authenticates it.

function signState(userId: number): string {
  const payload = Buffer.from(`${userId}.${now() + STATE_TTL_MS}`).toString("base64url");
  const sig = createHmac("sha256", CONFIG.jwtSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyState(state: string): number | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", CONFIG.jwtSecret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [uidStr, expStr] = Buffer.from(payload, "base64url").toString("utf8").split(".");
  const uid = Number(uidStr);
  const exp = Number(expStr);
  if (!Number.isInteger(uid) || !Number.isFinite(exp) || exp < now()) return null;
  return uid;
}

function statusFor(coupleId: number): GoogleCalendarStatus {
  const conn = getConnectionRow(coupleId);
  return {
    configured: GOOGLE_CALENDAR_ENABLED,
    connected: !!conn,
    email: conn?.google_email ?? null,
    calendarId: conn?.calendar_id ?? null,
    lastSyncedAt: conn?.last_synced_at ?? null,
    syncState: conn ? (conn.sync_state === "idle" ? "idle" : "dirty") : null,
    lastError: conn?.last_error ?? null,
  };
}

function requireCoupleId(ctx: Ctx): number {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return couple.id;
}

function handleStatus(ctx: Ctx): Response {
  return json(statusFor(requireCoupleId(ctx)));
}

/** Start the OAuth flow: return the Google consent URL the frontend redirects
 *  to. Bound to this user via a signed `state`. */
function handleConnect(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  if (!GOOGLE_CALENDAR_ENABLED) throw new HttpError(503, "Google Calendar is not configured");
  return json({ url: buildAuthUrl(signState(userId)) });
}

function redirect(pathAndQuery: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${CONFIG.frontendBaseUrl}${pathAndQuery}` },
  });
}

/** Google redirects the browser here after consent. Public — authenticated by
 *  the signed `state`, not the session bearer. Exchanges the code, stores the
 *  (encrypted) tokens, and kicks off the initial sync, then bounces back to the
 *  timeline with a status flag the page turns into a toast. */
async function handleCallback(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;
  if (params.get("error")) return redirect("/app/timeline?gcal=denied");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return redirect("/app/timeline?gcal=error");

  const userId = verifyState(state);
  if (userId === null) return redirect("/app/timeline?gcal=error");
  const couple = getCoupleForUser(userId);
  if (!couple) return redirect("/app/timeline?gcal=error");

  try {
    const tokens = await exchangeCode(code);
    saveConnection({
      coupleId: couple.id,
      connectedUserId: userId,
      email: tokens.email ?? "",
      timeZone: timeZoneForCouple(couple.id),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresInSec,
    });
    // Populate the calendar before the user lands back. If it fails it stays
    // dirty and the worker retries, so we still report success.
    await syncCoupleCalendar(couple.id);
    return redirect("/app/timeline?gcal=connected");
  } catch (e) {
    ctx.log.error("gcal.callback_failed", { err: String(e) });
    return redirect("/app/timeline?gcal=error");
  }
}

/** Manual "Sync now". Awaits a reconcile and returns the fresh status. */
async function handleSync(ctx: Ctx): Promise<Response> {
  const coupleId = requireCoupleId(ctx);
  if (!getConnectionRow(coupleId)) throw new HttpError(400, "Google Calendar is not connected");
  await syncCoupleCalendar(coupleId);
  return json(statusFor(coupleId));
}

async function handleDisconnect(ctx: Ctx): Promise<Response> {
  const coupleId = requireCoupleId(ctx);
  await disconnectCoupleCalendar(coupleId);
  return json(statusFor(coupleId));
}

export function registerGoogleCalendarRoutes(router: Router) {
  router.get("/api/google-calendar/status", handleStatus, true);
  router.get("/api/google-calendar/connect", handleConnect, true);
  // Public: the browser hits this on redirect from Google; `state` authenticates.
  router.get("/api/google-calendar/callback", handleCallback, false);
  router.post("/api/google-calendar/sync", handleSync, true);
  router.post("/api/google-calendar/disconnect", handleDisconnect, true);
}
