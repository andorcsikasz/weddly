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
  blockDate,
  isIsoDate,
  listBlockedDates,
  listBlockedDays,
  nextAvailableDate,
  unblockDate,
} from "../domain/supplier_bookings";
import { resolveVendorListing } from "./vendor_listing";

const MAX_REASON_LEN = 200;

function buildView(vendorAccountId: number): VendorAvailabilityView {
  return {
    blocked_dates: listBlockedDates(vendorAccountId),
    blocked_days: listBlockedDays(vendorAccountId),
    next_available: nextAvailableDate(vendorAccountId),
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
  const body = await readJson<{ date?: unknown; hours?: unknown; reason?: unknown }>(ctx.req);
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!isIsoDate(date)) throw new HttpError(400, "date must be a valid YYYY-MM-DD");
  if (date < todayIso()) throw new HttpError(400, "cannot block a past date");
  const hours = parseHoursInput(body.hours);
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, MAX_REASON_LEN)
      : null;

  blockDate(account.id, date, hours, reason);
  markVendorCalendarDirty(account.id);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.availability_block",
    target_kind: "vendor_account",
    target_id: account.id,
    after: { blocked_date: date, hours: hours ?? "all_day", has_reason: reason !== null },
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

export function registerVendorAvailabilityRoutes(router: Router) {
  router.get("/api/vendor/availability/me", handleGet);
  router.post("/api/vendor/availability/me", handleBlock);
  router.delete("/api/vendor/availability/me", handleUnblock);
}
