// Live Date Holds, vendor side only.
//
// A vendor answers an inquiry and holds the date while the couple decides. The
// invariants (one hold per inquiry, extending un-lapses it, releasing is its own
// fact) live in domain/date_holds.ts, and so does the argument for why a hold is
// publicly busy while the couple it is for is never actually blocked.
//
// Gating, and it is the same asymmetry the quote routes use:
//   * PLACING, extending and releasing a hold is PRO. It is the availability
//     calendar in a smaller costume, and that is already PRO, so it goes through
//     `requireVendorPro` per handler rather than the 402 middleware.
//   * READING one is FREE, on purpose. A lapse must not destroy a hold, and a
//     vendor who can see a live hold but cannot read that it exists would be
//     told a date is busy with nothing on the page explaining why.
//
// There is deliberately NO couple-facing route. A hold is a note between a
// vendor and their own calendar; what the couple gets is the vendor telling
// them, in the thread, that the date is theirs until Thursday.

import { HOLD_DEFAULT_HOURS, coerceHoldHours } from "@shared/date_holds";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import {
  getHoldForBooking,
  getHoldRowForBooking,
  listLiveHoldsForVendor,
  placeHold,
  releaseHold,
} from "../domain/date_holds";
import { isIsoDate } from "../domain/supplier_bookings";
import type { BookingRow } from "../domain/supplier_bookings";
import { markVendorCalendarDirty } from "../domain/vendor_google_calendar";
import { getOwnedBooking, requireVendorPro, resolveVendorAccount } from "../domain/vendor_clients";

/** Statuses the vendor has already closed. Holding a date for a lead they
 *  declined keeps a Saturday off the market for nobody, which is the exact
 *  failure the feature exists to prevent. */
const ARCHIVED_STATUSES: ReadonlySet<string> = new Set(["declined", "cancelled", "expired"]);

function parseId(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid client id");
  return n;
}

/** Today's CIVIL date in the deployment's timezone, matching `todayIso` in
 *  domain/booking_quotes.ts. The UTC date would refuse a hold on the vendor's
 *  own "today" for most of the evening east of Greenwich. */
function todayIso(at: number = Date.now()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The date this booking is about, or a 4xx explaining why it cannot be held.
 *  Three refusals, and each one is a hold that would mean nothing:
 *
 *    * no date on the inquiry (`event_date` is "" for a couple whose wedding is
 *      still a season) — there is no day to take off the market;
 *    * a date that has gone;
 *    * a lead the vendor themselves archived. */
function holdableDate(booking: BookingRow): string {
  if (ARCHIVED_STATUSES.has(booking.status)) {
    throw new HttpError(409, "This inquiry is closed", { code: "hold_booking_closed" });
  }
  if (booking.event_date === "" || !isIsoDate(booking.event_date)) {
    throw new HttpError(400, "This inquiry has no date yet", { code: "hold_no_date" });
  }
  if (booking.event_date < todayIso()) {
    throw new HttpError(400, "That date has passed", { code: "hold_date_past" });
  }
  return booking.event_date;
}

function handleGet(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  const bookingId = parseId(ctx.params.id);
  getOwnedBooking(account.id, bookingId);
  return json({ hold: getHoldForBooking(bookingId) });
}

/** Every live hold this vendor has, which is what their own calendar draws.
 *  Live only: an expired hold is history and would paint a date the vendor can
 *  already sell. */
function handleList(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  return json({ holds: listLiveHoldsForVendor(account.id) });
}

/** Place or extend, one operation. `hours` absent falls back to the default
 *  window rather than 400ing, because "hold it" with no number is a complete
 *  sentence and the picker's default is the answer. */
async function handlePut(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const bookingId = parseId(ctx.params.id);
  const booking = getOwnedBooking(account.id, bookingId);
  const eventDate = holdableDate(booking);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const hours = body.hours === undefined ? HOLD_DEFAULT_HOURS : coerceHoldHours(body.hours);
  if (hours === null) {
    throw new HttpError(400, "Invalid hold length", { code: "bad_hold_hours" });
  }
  const existed = getHoldRowForBooking(bookingId) !== null;
  const hold = placeHold({
    bookingId,
    vendorAccountId: account.id,
    eventDate,
    hours,
  });
  // The vendor's pushed calendar draws holds through the same reconciler every
  // other block goes through, so a placed hold has to mark it dirty.
  markVendorCalendarDirty(account.id);
  addAuditLog({
    actor_user_id: ctx.userId,
    couple_id: booking.couple_id,
    action: existed ? "vendor_date_hold.extended" : "vendor_date_hold.placed",
    target_kind: "booking_date_hold",
    target_id: hold.id,
    after: { booking_id: bookingId, event_date: eventDate, hours, hold_until: hold.hold_until },
  });
  return json({ hold }, { status: existed ? 200 : 201 });
}

/** Let the date go early. 404 when there was never a hold; releasing an already
 *  released one is a no-op success, so a double-click or a retry after a network
 *  blip does not surface an error, and the first stamp survives. */
function handleDelete(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const bookingId = parseId(ctx.params.id);
  const booking = getOwnedBooking(account.id, bookingId);
  const row = getHoldRowForBooking(bookingId);
  if (row === null) throw new HttpError(404, "Hold not found", { code: "hold_not_found" });
  const hold = releaseHold(row);
  markVendorCalendarDirty(account.id);
  addAuditLog({
    actor_user_id: ctx.userId,
    couple_id: booking.couple_id,
    action: "vendor_date_hold.released",
    target_kind: "booking_date_hold",
    target_id: hold.id,
    after: { booking_id: bookingId, event_date: hold.event_date },
  });
  return json({ hold });
}

export function registerDateHoldRoutes(router: Router) {
  router.get("/api/vendor/date-holds", handleList, true);
  router.get("/api/vendor/clients/:id/hold", handleGet, true);
  router.put("/api/vendor/clients/:id/hold", handlePut, true);
  router.delete("/api/vendor/clients/:id/hold", handleDelete, true);
}
