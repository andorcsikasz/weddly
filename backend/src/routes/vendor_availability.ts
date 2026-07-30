// Vendor self-serve availability. A claimed vendor marks the days they're
// already booked / unavailable; couples see those on the public busy calendar
// (getAvailability) and the listing's next-free date is recomputed from them.
//
//   GET    /api/vendor/availability/me        — list blocked dates + next free
//   POST   /api/vendor/availability/me        — block a date  { date, reason? }
//   DELETE /api/vendor/availability/me?date=…  — unblock a date
//
// Authorisation is identical to the listing editor: requireAuth + role
// 'vendor' + an owned vendor_account attached to a listing. We reuse
// resolveVendorListing so the gate can never drift between the two surfaces.

import type { VendorAvailabilityView } from "@shared/listings";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { markVendorCalendarDirty } from "../domain/vendor_google_calendar";
import {
  coerceWeekdays,
  coerceWeeklyHours,
  hasAnyWorkingDay,
  hoursFromWeekdays,
  MAX_SCHEDULE_NAME_LEN,
  type WeeklyHours,
} from "@shared/vendor_availability";
import { getVendorSchedule, setVendorSchedule } from "../domain/vendor_availability_settings";
import { listVendorExternalBusy } from "../domain/vendor_external_busy";
import {
  blockDate,
  isIsoDate,
  listBlockedDates,
  listBlockedDays,
  listOpenDates,
  nextAvailableDate,
  unblockDate,
} from "../domain/supplier_bookings";
import { resolveVendorListing } from "./vendor_listing";

const MAX_REASON_LEN = 200;

function buildView(vendorAccountId: number): VendorAvailabilityView {
  const busy = listVendorExternalBusy(vendorAccountId);
  const externalBusy: VendorAvailabilityView["external_busy"] = [];
  for (const [date, list] of busy) {
    for (const iv of list) {
      externalBusy.push({ date, start_min: iv.start_min, end_min: iv.end_min });
    }
  }
  return {
    blocked_dates: listBlockedDates(vendorAccountId),
    blocked_days: listBlockedDays(vendorAccountId),
    next_available: nextAvailableDate(vendorAccountId),
    open_dates: listOpenDates(vendorAccountId),
    external_busy: externalBusy,
  };
}

/** Validate an inbound `hours` field into a sorted, deduped hour list (0-23) or
 *  null (= whole-day block). Absent/null → whole day. A present-but-invalid
 *  value throws so the client can't silently create a garbage partial block. */
function parseHoursInput(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new HttpError(400, "hours must be an array of integers 0-23");
  const hours = new Set<number>();
  for (const h of raw) {
    if (typeof h !== "number" || !Number.isInteger(h) || h < 0 || h > 23) {
      throw new HttpError(400, "hours must be integers between 0 and 23");
    }
    hours.add(h);
  }
  // An empty array means "no hours" — treat as a whole-day block rather than a
  // partial block that blocks nothing.
  if (hours.size === 0) return null;
  return Array.from(hours).sort((a, b) => a - b);
}

/** Today as ISO 'YYYY-MM-DD' in UTC — matches the window nextAvailableDate
 *  scans, so "can't block a past day" lines up with the calendar couples see. */
function todayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function handleGet(ctx: Ctx): Promise<Response> {
  const { account } = resolveVendorListing(ctx);
  return json(buildView(account.id));
}

async function handleBlock(ctx: Ctx): Promise<Response> {
  const { account } = resolveVendorListing(ctx);
  const body = await readJson<{
    date?: unknown;
    hours?: unknown;
    reason?: unknown;
    available?: unknown;
  }>(ctx.req);
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!isIsoDate(date)) throw new HttpError(400, "date must be a valid YYYY-MM-DD");
  if (date < todayIso()) throw new HttpError(400, "cannot block a past date");
  // `available: true` flips the row to the other direction: the vendor
  // exceptionally WORKS this day even though the weekly pattern excludes it.
  const available = body.available === true;
  const hours = available ? null : parseHoursInput(body.hours);
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, MAX_REASON_LEN)
      : null;

  blockDate(account.id, date, hours, reason, available);
  markVendorCalendarDirty(account.id);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.availability_block",
    target_kind: "vendor_account",
    target_id: account.id,
    after: {
      blocked_date: date,
      hours: hours ?? "all_day",
      has_reason: reason !== null,
      available,
    },
  });
  return json(buildView(account.id), { status: 201 });
}

async function handleUnblock(ctx: Ctx): Promise<Response> {
  const { account } = resolveVendorListing(ctx);
  const date = ctx.url.searchParams.get("date")?.trim() ?? "";
  if (!isIsoDate(date)) throw new HttpError(400, "date query param must be a valid YYYY-MM-DD");

  // Idempotent: unblocking a date that isn't blocked is a no-op success, so a
  // double-click or retry after a network blip doesn't surface an error.
  const removed = unblockDate(account.id, date);
  if (removed) markVendorCalendarDirty(account.id);
  if (removed) {
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.availability_unblock",
      target_kind: "vendor_account",
      target_id: account.id,
      after: { blocked_date: date },
    });
  }
  return json(buildView(account.id));
}

/** The recurring weekly schedule: which weekdays this vendor works, and from
 *  when to when on each. Its own resource because it is settings rather than
 *  dated data. */
async function handleGetPattern(ctx: Ctx): Promise<Response> {
  const { account } = resolveVendorListing(ctx);
  return json(getVendorSchedule(account.id));
}

/** Two accepted shapes on one endpoint, which is deliberate:
 *
 *  * `working_hours` (+ optional `schedule_name`) is the current contract: the
 *    full week of intervals, authoritative, with `weekdays` derived from it.
 *  * a bare `weekdays` list is the pre-hours contract, still spoken by older
 *    clients. It writes the same schedule with whole working days.
 *
 *  Splitting them into two endpoints would let a client write one layer and
 *  leave the other stale, which is exactly the drift the single writer in
 *  `setVendorSchedule` exists to prevent. */
async function handlePutPattern(ctx: Ctx): Promise<Response> {
  const { account } = resolveVendorListing(ctx);
  const body = await readJson<{
    weekdays?: unknown;
    working_hours?: unknown;
    schedule_name?: unknown;
  }>(ctx.req);

  const current = getVendorSchedule(account.id);
  const name =
    typeof body.schedule_name === "string"
      ? body.schedule_name.trim().slice(0, MAX_SCHEDULE_NAME_LEN)
      : current.schedule_name;

  let hours: WeeklyHours;
  if (body.working_hours !== undefined) {
    const parsed = coerceWeeklyHours(body.working_hours);
    if (parsed === null) {
      throw new HttpError(
        400,
        "working_hours must map weekdays 1-7 to {start_min,end_min} objects",
      );
    }
    // A week with no working day at all would mean "never available" and would
    // silently drop the vendor out of every date-filtered search. Refused loudly
    // rather than coerced, because unlike a junk weekday list there is no
    // reading of an empty hour editor that means "every day".
    if (!hasAnyWorkingDay(parsed)) throw new HttpError(400, "at least one working day is required");
    hours = parsed;
  } else {
    // Legacy shape. Anything that isn't a usable partial set (absent, empty, or
    // all seven) resolves to null = "available every day", so there is exactly
    // one representation of the unrestricted case and a vendor can never
    // accidentally store "never available" and vanish from every search. The
    // named days become whole working days, which is what they meant before
    // hours existed.
    hours = hoursFromWeekdays(coerceWeekdays(body.weekdays));
  }
  setVendorSchedule(account.id, { hours, scheduleName: name });

  markVendorCalendarDirty(account.id);
  const settings = getVendorSchedule(account.id);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.availability_pattern",
    target_kind: "vendor_account",
    target_id: account.id,
    after: { weekdays: settings.weekdays ?? "every_day", named: settings.schedule_name !== "" },
  });
  return json(settings);
}

export function registerVendorAvailabilityRoutes(router: Router) {
  router.get("/api/vendor/availability/me", handleGet);
  router.post("/api/vendor/availability/me", handleBlock);
  router.delete("/api/vendor/availability/me", handleUnblock);
  router.get("/api/vendor/availability/me/pattern", handleGetPattern);
  router.put("/api/vendor/availability/me/pattern", handlePutPattern);
}
