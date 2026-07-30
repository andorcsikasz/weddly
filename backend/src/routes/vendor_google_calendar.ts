// Vendor calendar -> Google Calendar push-sync endpoints. The vendor connects
// their Google account once (OAuth authorization-code flow); Weddly then creates
// a dedicated secondary calendar and one-way syncs confirmed weddings, pending
// inquiries, blocked days and task deadlines into it.
//
// Mirrors routes/google_calendar.ts (couples) but for the vendor aggregate. Note
// there is no callback route HERE: both flows share the single
// /api/google-calendar/callback redirect URI, which dispatches on the signed
// `kind` in the OAuth state and calls `handleVendorCalendarCallback` below. That
// is what lets the vendor flow ship without a new Google Cloud Console entry.
//
// Feature-gated on GOOGLE_CALENDAR_ENABLED like the couple flow, and ADDITIONALLY
// on the PRO `calendar_availability` entitlement — this syncs the availability
// calendar, which is itself a PRO feature.

import type { GoogleCalendarStatus } from "@shared/types";
import { isVendorFeatureEnabled } from "@shared/vendor_plan";
import { GOOGLE_CALENDAR_ENABLED } from "../config";
import { getVendorAccountByOwnerUserId } from "../domain/vendor_accounts";
import { resolveVendorAccount, vendorPlanForAccount } from "../domain/vendor_clients";
import {
  disconnectVendorCalendar,
  getVendorConnectionRow,
  listVendorGoogleCalendars,
  pullCalendarIds,
  saveVendorConnection,
  setVendorPullSelection,
  syncVendorCalendar,
  syncVendorExternalBusy,
  timeZoneForVendor,
} from "../domain/vendor_google_calendar";
import { countVendorExternalBusy } from "../domain/vendor_external_busy";
import { buildAuthUrl, exchangeCode } from "../lib/google_calendar";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { signOAuthState } from "../lib/oauth_state";

/** Where the vendor lands after the consent round-trip. */
const VENDOR_CALENDAR_PATH = "/vendor/calendar";

function statusFor(vendorAccountId: number): GoogleCalendarStatus {
  const conn = getVendorConnectionRow(vendorAccountId);
  return {
    configured: GOOGLE_CALENDAR_ENABLED,
    connected: !!conn,
    email: conn?.google_email ?? null,
    calendarId: conn?.calendar_id ?? null,
    lastSyncedAt: conn?.last_synced_at ?? null,
    syncState: conn ? (conn.sync_state === "idle" ? "idle" : "dirty") : null,
    lastError: conn?.last_error ?? null,
    // The pull half. Null when not connected; the couple flow is push-only and
    // reports the same nulls.
    pullEnabled: conn ? conn.pull_enabled === 1 : null,
    busySyncedAt: conn?.busy_synced_at ?? null,
    externalBusyCount: conn ? countVendorExternalBusy(vendorAccountId) : 0,
  };
}

function handleStatus(ctx: Ctx): Response {
  return json(statusFor(resolveVendorAccount(ctx).id));
}

/** Start the OAuth flow: return the Google consent URL the frontend redirects
 *  to. Bound to this user AND to the vendor flow via the signed `state`. */
function handleConnect(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  if (!GOOGLE_CALENDAR_ENABLED) throw new HttpError(503, "Google Calendar is not configured");
  if (!isVendorFeatureEnabled(vendorPlanForAccount(account.id), "calendar_availability")) {
    throw new HttpError(403, "Pro plan required", { code: "vendor_pro_required" });
  }
  return json({ url: buildAuthUrl(signOAuthState("vendor", account.owner_user_id)) });
}

/** The vendor branch of the shared OAuth callback, invoked by
 *  routes/google_calendar.ts once the signed state proves this was a vendor
 *  flow. `redirect` is passed in so both branches share one 302 helper. */
export async function handleVendorCalendarCallback(
  ctx: Ctx,
  userId: number,
  redirect: (pathAndQuery: string) => Response,
): Promise<Response> {
  const params = ctx.url.searchParams;
  if (params.get("error")) return redirect(`${VENDOR_CALENDAR_PATH}?gcal=denied`);
  const code = params.get("code");
  if (!code) return redirect(`${VENDOR_CALENDAR_PATH}?gcal=error`);

  const account = getVendorAccountByOwnerUserId(userId);
  if (!account) return redirect(`${VENDOR_CALENDAR_PATH}?gcal=error`);
  // Re-check entitlement at callback time: the consent round-trip is minutes
  // long and the plan could have lapsed in between.
  if (!isVendorFeatureEnabled(vendorPlanForAccount(account.id), "calendar_availability")) {
    return redirect(`${VENDOR_CALENDAR_PATH}?gcal=error`);
  }

  try {
    const tokens = await exchangeCode(code);
    saveVendorConnection({
      vendorAccountId: account.id,
      connectedUserId: userId,
      email: tokens.email ?? "",
      timeZone: timeZoneForVendor(account.id),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresInSec,
    });
    // Populate the calendar before the vendor lands back. If it fails it stays
    // dirty and the worker retries, so we still report success.
    await syncVendorCalendar(account.id);
    return redirect(`${VENDOR_CALENDAR_PATH}?gcal=connected`);
  } catch (e) {
    ctx.log.error("gcal.vendor_callback_failed", { err: String(e) });
    return redirect(`${VENDOR_CALENDAR_PATH}?gcal=error`);
  }
}

/** Manual "Sync now". Runs BOTH directions: push what Weddly knows, then pull
 *  free/busy back. One button, because from the vendor's side "sync" is one
 *  idea, and doing only half of it is what makes an integration feel unreliable. */
async function handleSync(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  if (!getVendorConnectionRow(account.id)) {
    throw new HttpError(400, "Google Calendar is not connected");
  }
  await syncVendorCalendar(account.id);
  await syncVendorExternalBusy(account.id);
  return json(statusFor(account.id));
}

/** The vendor's Google calendars, with the ones currently read ticked. Live from
 *  Google rather than cached: a calendar list changes rarely but silently, and a
 *  stale picker would offer calendars that no longer exist. */
async function handleListCalendars(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const conn = getVendorConnectionRow(account.id);
  if (!conn) throw new HttpError(400, "Google Calendar is not connected");
  const selected = new Set(pullCalendarIds(conn));
  try {
    const calendars = await listVendorGoogleCalendars(account.id);
    return json({
      pull_enabled: conn.pull_enabled === 1,
      calendars: calendars.map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary,
        // An unchosen selection resolves to "primary", so the primary calendar
        // shows as ticked before the vendor has touched anything, which is what
        // the pull actually does.
        selected: selected.has(c.id) || (c.primary && selected.has("primary")),
      })),
    });
  } catch (e) {
    ctx.log.error("gcal.vendor_calendar_list_failed", { err: String(e) });
    throw new HttpError(502, "Could not read your Google calendars");
  }
}

/** Save which calendars the pull reads, then re-pull immediately so the vendor
 *  sees the effect of the tick they just made rather than at the next sweep. */
async function handleSaveCalendars(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const conn = getVendorConnectionRow(account.id);
  if (!conn) throw new HttpError(400, "Google Calendar is not connected");
  const body = await readJson<{ calendar_ids?: unknown; pull_enabled?: unknown }>(ctx.req);
  const ids = Array.isArray(body.calendar_ids)
    ? body.calendar_ids.filter((x): x is string => typeof x === "string")
    : [];
  const pullEnabled = body.pull_enabled !== false;
  setVendorPullSelection(account.id, { calendarIds: ids, pullEnabled });
  await syncVendorExternalBusy(account.id);
  return json(statusFor(account.id));
}

async function handleDisconnect(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  await disconnectVendorCalendar(account.id);
  return json(statusFor(account.id));
}

export function registerVendorGoogleCalendarRoutes(router: Router) {
  router.get("/api/vendor/google-calendar/status", handleStatus, true);
  router.get("/api/vendor/google-calendar/connect", handleConnect, true);
  router.post("/api/vendor/google-calendar/sync", handleSync, true);
  router.post("/api/vendor/google-calendar/disconnect", handleDisconnect, true);
  router.get("/api/vendor/google-calendar/calendars", handleListCalendars, true);
  router.put("/api/vendor/google-calendar/calendars", handleSaveCalendars, true);
}
