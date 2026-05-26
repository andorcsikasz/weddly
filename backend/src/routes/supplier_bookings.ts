// Booking inquiries on a supplier detail page.
//
// v1 = admin-only writes (Phase 1+2 dogfood). The admin sends a test inquiry
// on behalf of a couple by passing `couple_id` in the body. Phase 3 will
// drop the body field and read couple from ctx; the route file is the only
// place that has to change.
//
// CLAIMED-VENDORS-ONLY: createBooking() in the domain layer rejects an
// inquiry on an unclaimed listing. Frontend hides the booking CTA in that
// case and falls back to the tracked website redirect (`/r/supplier/:id`).

import type { BookingStatus, CreateBookingBody } from "@shared/suppliers";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
import {
  buildIcsForBooking,
  createBooking,
  getAvailability,
  getBookingById,
  isIsoDate,
  listBookingsForSupplier,
  toBooking,
  updateBookingStatus,
} from "../domain/supplier_bookings";
import { requireAdmin } from "../domain/users";
import { db } from "../db";

const VALID_STATUSES = new Set<BookingStatus>([
  "requested",
  "vendor_seen",
  "confirmed",
  "declined",
  "cancelled",
  "expired",
]);

async function handleAvailability(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  return json(getAvailability(supplierId));
}

async function handleListForSupplier(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  return json({ items: listBookingsForSupplier(supplierId) });
}

interface CreateBookingPayload extends CreateBookingBody {
  /** v1 admin field — admin tests inquiries on behalf of a specific couple.
   *  Phase 3 will drop this and read couple from ctx. */
  couple_id?: number;
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  rateLimit(`user:${admin.id}`, "supplier_bookings.create", {
    capacity: 30,
    refillRate: 1,
  });
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  if (supplierId.length > 80) throw new HttpError(400, "supplier_id too long");

  const body = await readJson<Partial<CreateBookingPayload>>(ctx.req);
  if (typeof body.event_date !== "string" || !isIsoDate(body.event_date)) {
    throw new HttpError(400, "event_date must be 'YYYY-MM-DD'");
  }
  const notes =
    body.notes === undefined || body.notes === null
      ? null
      : typeof body.notes === "string"
        ? body.notes.slice(0, 2000)
        : null;
  const amountHuf =
    body.amount_huf === undefined || body.amount_huf === null
      ? null
      : typeof body.amount_huf === "number" && Number.isFinite(body.amount_huf)
        ? Math.trunc(body.amount_huf)
        : null;
  const coupleId = body.couple_id;
  if (typeof coupleId !== "number" || !Number.isInteger(coupleId)) {
    throw new HttpError(400, "couple_id required (admin-side testing)");
  }
  // Guard that the couple actually exists — otherwise a booking row points
  // at a phantom workspace and survives the FK cascade silently.
  const couple = db
    .prepare("SELECT id FROM couples WHERE id = ?")
    .get(coupleId) as { id: number } | undefined;
  if (!couple) throw new HttpError(404, "Couple not found");

  try {
    const booking = createBooking({
      supplierId,
      coupleId,
      eventDate: body.event_date,
      notes,
      amountHuf,
    });
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: coupleId,
      action: "supplier_booking.created",
      target_kind: "supplier_booking",
      target_id: booking.id,
      after: { supplier_id: supplierId, event_date: body.event_date },
    });
    return json(booking, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("booking_unavailable")) {
      throw new HttpError(409, "Supplier is not claimed — booking unavailable", {
        code: "booking_unavailable",
      });
    }
    throw e;
  }
}

async function handleStatusPatch(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.booking_id ?? "", 10);
  if (!Number.isInteger(id)) throw new HttpError(400, "booking_id required");
  const existing = getBookingById(id);
  if (!existing) throw new HttpError(404, "Booking not found");
  const body = await readJson<{ status?: unknown }>(ctx.req);
  if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status as BookingStatus)) {
    throw new HttpError(
      400,
      "status must be one of: requested, vendor_seen, confirmed, declined, cancelled, expired",
    );
  }
  const updated = updateBookingStatus(id, body.status as BookingStatus);
  if (!updated) throw new HttpError(404, "Booking not found");
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: existing.couple_id,
    action: "supplier_booking.status_changed",
    target_kind: "supplier_booking",
    target_id: id,
    before: { status: existing.status },
    after: { status: body.status },
  });
  return json(updated);
}

/** ICS download for a confirmed booking. Day-event format. Both the couple
 *  side and the vendor side can pull the same URL — we don't gate by role
 *  yet because v1 surface is admin-only. */
async function handleIcs(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.booking_id ?? "", 10);
  if (!Number.isInteger(id)) throw new HttpError(400, "booking_id required");
  const row = getBookingById(id);
  if (!row) throw new HttpError(404, "Booking not found");
  if (row.status !== "confirmed") {
    throw new HttpError(400, "ICS available only for confirmed bookings", {
      code: "not_confirmed",
    });
  }
  // Resolve supplier display name. Curated suppliers live in code; community
  // and claimed entries pull from `listings`. Fallback to the id to guarantee
  // the .ics is always producible.
  const listing = db
    .prepare("SELECT name FROM listings WHERE id = ?")
    .get(row.supplier_id) as { name: string } | undefined;
  const couple = db
    .prepare("SELECT display_name FROM couples WHERE id = ?")
    .get(row.couple_id) as { display_name: string | null } | undefined;
  const ics = buildIcsForBooking({
    booking: toBooking(row),
    supplierName: listing?.name ?? row.supplier_id,
    coupleDisplayName: couple?.display_name ?? null,
  });
  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="weddly-booking-${id}.ics"`,
    },
  });
}

export function registerSupplierBookingRoutes(router: Router) {
  router.get("/api/suppliers/:supplier_id/availability", handleAvailability, true);
  router.get("/api/suppliers/:supplier_id/bookings", handleListForSupplier, true);
  router.post("/api/suppliers/:supplier_id/bookings", handleCreate, true);
  router.patch("/api/bookings/:booking_id", handleStatusPatch, true);
  router.get("/api/bookings/:booking_id/ics", handleIcs, true);
}
