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
import {
  blockDate,
  isIsoDate,
  listBlockedDates,
  nextAvailableDate,
  unblockDate,
} from "../domain/supplier_bookings";
import { resolveVendorListing } from "./vendor_listing";

const MAX_REASON_LEN = 200;

function buildView(vendorAccountId: number): VendorAvailabilityView {
  return {
    blocked_dates: listBlockedDates(vendorAccountId),
    next_available: nextAvailableDate(vendorAccountId),
  };
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
  const body = await readJson<{ date?: unknown; reason?: unknown }>(ctx.req);
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!isIsoDate(date)) throw new HttpError(400, "date must be a valid YYYY-MM-DD");
  if (date < todayIso()) throw new HttpError(400, "cannot block a past date");
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, MAX_REASON_LEN)
      : null;

  blockDate(account.id, date, reason);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.availability_block",
    target_kind: "vendor_account",
    target_id: account.id,
    after: { blocked_date: date, has_reason: reason !== null },
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
