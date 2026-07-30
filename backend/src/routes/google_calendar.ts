// Timeline -> Google Calendar push-sync endpoints. The couple connects their
// Google account once (OAuth authorization-code flow); Weddly then creates a
// dedicated secondary calendar and one-way syncs dated tasks + the wedding day
// + the day-of run sheet into it. See domain/google_calendar.ts for the sync
// logic and lib/google_calendar.ts for the OAuth/API plumbing.
//
// Feature-gated on GOOGLE_CALENDAR_ENABLED (OAuth client id + secret configured)
// exactly like the Google-sign-in / Stripe "configured?" pattern: unconfigured =
// status.configured:false and /connect 503s, app unaffected.

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
import { buildAuthUrl, exchangeCode } from "../lib/google_calendar";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";
import { signOAuthState, verifyOAuthState } from "../lib/oauth_state";
import { handleVendorCalendarCallback } from "./vendor_google_calendar";

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
    // The couple sync is push-only: their Google calendar holds the wedding, and
    // reading it back would let an unrelated appointment move planning dates.
    // Only the vendor aggregate pulls.
    pullEnabled: null,
    busySyncedAt: null,
    externalBusyCount: 0,
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
  return json({ url: buildAuthUrl(signOAuthState("couple", userId)) });
}

function redirect(pathAndQuery: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${CONFIG.frontendBaseUrl}${pathAndQuery}` },
  });
}

/** Google redirects the browser here after consent. Public — authenticated by
 *  the signed `state`, not the session bearer.
 *
 *  ONE callback serves both the couple and the vendor consent flows, so enabling
 *  the vendor side needed no new redirect URI in the Google Cloud Console. The
 *  flow is read from the SIGNED `kind` in the state (see lib/oauth_state.ts), so
 *  a state minted by one flow cannot be replayed against the other. */
async function handleCallback(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;
  const state = params.get("state");
  // The landing page depends on which flow this was, and we only know that once
  // the state verifies. An unverifiable state falls back to the couple timeline.
  const decoded = state ? verifyOAuthState(state) : null;
  if (decoded?.kind === "vendor") {
    return handleVendorCalendarCallback(ctx, decoded.userId, redirect);
  }

  if (params.get("error")) return redirect("/app/timeline?gcal=denied");
  const code = params.get("code");
  if (!code || !state) return redirect("/app/timeline?gcal=error");

  if (decoded === null) return redirect("/app/timeline?gcal=error");
  const userId = decoded.userId;
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
