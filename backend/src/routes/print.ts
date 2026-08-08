// Couple-scoped PDF endpoints. All return application/pdf with attachment headers.

import { db } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser, parseDesignJson } from "../domain/couples";
import { recordExport } from "../domain/exports";
import { type Ctx, HttpError, requireAuth, type Router } from "../lib/http";
import { listByCoupleId as listCoupleSuppliers } from "../domain/couple_suppliers";
import { parseMenuCard } from "@shared/menu_card";
import { getUserById } from "../domain/users";
import { renderPrintableCardPdf, renderSchedulePdf, renderSeatingChartPdf } from "../domain/pdf";
import { listScheduleEvents } from "../domain/schedule";
import { listGuestsByCouple, toGuest } from "../domain/guests";
import type { GuestRow } from "../domain/guests";
import type { SeatAssignment, SeatingTable, TableShape } from "@shared/types";
import {
  buildPrintableCardDocument,
  type PrintableCardSource,
  type PrintCardType,
  weddingTimezoneForCountry,
} from "@shared/print_cards";
import { isUiLocale } from "@shared/locales";

interface TableRow {
  id: number;
  couple_id: number;
  label: string;
  shape: string;
  seats: number;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  length_mm: number;
  rotation_deg: number | null;
  disabled_seats_json: string | null;
  baby_seats_json: string | null;
  is_kids_table: number | null;
  created_at: number;
  updated_at: number;
}

function parseIntList(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

interface AssignRow {
  id: number;
  table_id: number;
  seat_index: number;
  guest_id: number;
}

function loadTables(coupleId: number): SeatingTable[] {
  const rows = db
    .prepare("SELECT * FROM seating_tables WHERE couple_id = ? ORDER BY id ASC")
    .all(coupleId) as TableRow[];
  return rows.map((r) => {
    const disabled = parseIntList(r.disabled_seats_json);
    const disabledSet = new Set(disabled);
    const baby = parseIntList(r.baby_seats_json).filter((n) => !disabledSet.has(n));
    return {
      id: r.id,
      couple_id: r.couple_id,
      label: r.label,
      shape: (r.shape === "long" || r.shape === "square" ? r.shape : "round") as TableShape,
      seats: r.seats,
      x_mm: r.x_mm,
      y_mm: r.y_mm,
      width_mm: r.width_mm,
      length_mm: r.length_mm,
      rotation_deg: ((((r.rotation_deg ?? 0) % 360) + 360) % 360) | 0,
      is_kids_table: Boolean(r.is_kids_table),
      disabled_seats: disabled,
      baby_seats: baby,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
}

function loadAssignments(coupleId: number): SeatAssignment[] {
  const rows = db
    .prepare(
      `SELECT sa.* FROM seat_assignments sa
       JOIN seating_tables st ON st.id = sa.table_id
       WHERE st.couple_id = ?`,
    )
    .all(coupleId) as AssignRow[];
  return rows.map((r) => ({
    id: r.id,
    table_id: r.table_id,
    seat_index: r.seat_index,
    guest_id: r.guest_id,
  }));
}

function pdfResponse(
  filename: string,
  body: Uint8Array,
  meta?: { cardType: PrintCardType; revision: string },
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      ...(meta
        ? {
            "X-Weddly-Card-Type": meta.cardType,
            "X-Weddly-Data-Revision": meta.revision,
          }
        : {}),
    },
  });
}

function revisionOf(
  cardType: PrintCardType,
  coupleUpdatedAt: number,
  relevantState: readonly unknown[],
): string {
  // FNV-1a is not a security boundary; it is a compact deterministic cache/
  // parity token. Include relationship state too (seat assignments have no
  // updated_at column), otherwise moving a guest could change the PDF without
  // changing its advertised revision.
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(JSON.stringify(relevantState))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${cardType}:${coupleUpdatedAt}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function cardSource<T extends PrintCardType>(
  couple: NonNullable<ReturnType<typeof getCoupleForUser>>,
  userId: number,
  cardType: T,
  dataRevision: string,
  patch: Partial<PrintableCardSource> = {},
): PrintableCardSource & { cardType: T } {
  const rawLocale = getUserById(userId)?.locale;
  const locale = isUiLocale(rawLocale) ? rawLocale : "en";
  return {
    workspaceId: String(couple.id),
    // The current domain has one wedding event per workspace. Keeping both ids
    // explicit makes the cache key safe if that changes later.
    eventId: String(couple.id),
    dataRevision,
    locale,
    timezone: weddingTimezoneForCountry(couple.country),
    theme: parseDesignJson(couple.design_json),
    coupleName: couple.display_name,
    brideName: couple.bride_name,
    groomName: couple.groom_name,
    weddingDate: couple.wedding_date,
    venueName: couple.venue_name,
    venueCity: couple.venue_city,
    ...patch,
    cardType,
  };
}

async function handleSeatingChart(ctx: Ctx, fmt: "a4" | "a3"): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const tables = loadTables(couple.id);
  const assignments = loadAssignments(couple.id);
  const guests = listGuestsByCouple(couple.id);
  // Optional room dimensions — when the client sends both, the renderer
  // auto-picks page orientation to fit the room AND draws the floor plan
  // against the real venue rectangle instead of a tight bbox.
  const roomWRaw = Number(ctx.url.searchParams.get("room_w"));
  const roomHRaw = Number(ctx.url.searchParams.get("room_h"));
  const room_width_mm =
    Number.isFinite(roomWRaw) && roomWRaw >= 1000 && roomWRaw <= 100_000
      ? Math.round(roomWRaw)
      : undefined;
  const room_height_mm =
    Number.isFinite(roomHRaw) && roomHRaw >= 1000 && roomHRaw <= 100_000
      ? Math.round(roomHRaw)
      : undefined;
  const pdf = await renderSeatingChartPdf({
    format: fmt,
    couple_display_name: couple.display_name,
    wedding_date: couple.wedding_date,
    tables,
    assignments,
    guests,
    room_width_mm,
    room_height_mm,
  });
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.seating_chart",
    target_kind: "couple",
    target_id: couple.id,
    after: { format: fmt, table_count: tables.length, guest_count: guests.length },
  });
  const filename = `seating-${fmt}.pdf`;
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "seating_pdf",
    format: fmt,
    filename,
    contentType: "application/pdf",
    body: pdf,
  });
  return pdfResponse(filename, pdf);
}

async function handlePlaceCards(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  // `?only=confirmed` filters to guests who said "yes" — useful for printing
  // place cards only for guests who'll actually attend. Default behaviour is
  // unchanged (every guest gets a card).
  const onlyConfirmed = ctx.url.searchParams.get("only") === "confirmed";

  // `?guest_ids=12,47,99` — comma-separated explicit guest list. Deduped +
  // capped at 200 so a runaway URL can't OOM the renderer. Unknown ids are
  // silently skipped; the request only 404s if NO id resolves to a real
  // guest. When both filters are present we intersect.
  const GUEST_IDS_CAP = 200;
  const rawGuestIds = ctx.url.searchParams.get("guest_ids");
  let requestedIds: Set<number> | null = null;
  if (rawGuestIds && rawGuestIds.trim()) {
    const parsed = new Set<number>();
    for (const part of rawGuestIds.split(",")) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0) parsed.add(n);
      if (parsed.size >= GUEST_IDS_CAP) break;
    }
    requestedIds = parsed;
  }

  const guestRows = db
    .prepare("SELECT * FROM guests WHERE couple_id = ? ORDER BY full_name")
    .all(couple.id) as GuestRow[];

  // Apply guest_ids first so we can 404 when zero ids resolve to real rows
  // in this couple. Unknown ids are silently dropped.
  let filtered = guestRows;
  if (requestedIds) {
    const knownRows = filtered.filter((r) => requestedIds!.has(r.id));
    if (knownRows.length === 0) {
      throw new HttpError(404, "No matching guests for guest_ids", {
        code: "no_matching_guests",
      });
    }
    filtered = knownRows;
  }
  // Now intersect with the confirmed filter. The empty PDF behind
  // ?only=confirmed when every guest is rsvp=no is a legitimate result.
  if (onlyConfirmed) filtered = filtered.filter((r) => r.rsvp_status === "yes");
  const guests = filtered.map(toGuest);

  // Build a guestId → table label map for the second line on the place card.
  const tables = loadTables(couple.id);
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const assignments = loadAssignments(couple.id);
  const tablesByGuestId = new Map<number, string>();
  for (const a of assignments) {
    const t = tableById.get(a.table_id);
    if (t) tablesByGuestId.set(a.guest_id, t.label);
  }

  const revision = revisionOf("place_card", couple.updated_at, [
    couple.design_json,
    ...guests.map((guest) => [guest.id, guest.updated_at, guest.full_name]),
    ...tables.map((table) => [table.id, table.updated_at, table.label]),
    ...assignments.map((assignment) => [
      assignment.guest_id,
      assignment.table_id,
      assignment.seat_index,
    ]),
  ]);
  const documents =
    guests.length > 0
      ? guests.map((guest) =>
          buildPrintableCardDocument(
            cardSource(couple, userId, "place_card", revision, {
              guestName: guest.full_name,
              guestTableLabel: tablesByGuestId.get(guest.id) ?? null,
            }),
          ),
        )
      : [buildPrintableCardDocument(cardSource(couple, userId, "place_card", revision))];
  const pdf = await renderPrintableCardPdf(documents);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.place_cards",
    target_kind: "couple",
    target_id: couple.id,
    after: { guest_count: guests.length },
  });
  const filename = "place-cards-a4.pdf";
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "place_cards_pdf",
    format: null,
    filename,
    contentType: "application/pdf",
    body: pdf,
  });
  return pdfResponse(filename, pdf, { cardType: "place_card", revision });
}

async function handleTableNumbers(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const tables = loadTables(couple.id);
  const revision = revisionOf("table_number", couple.updated_at, [
    couple.design_json,
    ...tables.map((table) => [table.id, table.updated_at, table.label]),
  ]);
  const documents =
    tables.length > 0
      ? tables.map((table) =>
          buildPrintableCardDocument(
            cardSource(couple, userId, "table_number", revision, { tableLabel: table.label }),
          ),
        )
      : [buildPrintableCardDocument(cardSource(couple, userId, "table_number", revision))];
  const pdf = await renderPrintableCardPdf(documents);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.table_numbers",
    target_kind: "couple",
    target_id: couple.id,
    after: { table_count: tables.length },
  });
  const filename = "table-numbers-a6.pdf";
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "table_numbers_pdf",
    format: null,
    filename,
    contentType: "application/pdf",
    body: pdf,
  });
  return pdfResponse(filename, pdf, { cardType: "table_number", revision });
}

async function handleMenu(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const revision = revisionOf("menu", couple.updated_at, [
    couple.design_json,
    couple.display_name,
    couple.bride_name,
    couple.groom_name,
    couple.wedding_date,
    couple.menu_card,
  ]);
  const document = buildPrintableCardDocument(
    cardSource(couple, userId, "menu", revision, {
      menuCourses: parseMenuCard(couple.menu_card).courses,
    }),
  );
  const pdf = await renderPrintableCardPdf([document]);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.menu",
    target_kind: "couple",
    target_id: couple.id,
    after: {},
  });
  const filename = "menu-a5.pdf";
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "menu_pdf",
    format: null,
    filename,
    contentType: "application/pdf",
    body: pdf,
  });
  return pdfResponse(filename, pdf, { cardType: "menu", revision });
}

async function handleInvitation(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const revision = revisionOf("invitation", couple.updated_at, [
    couple.design_json,
    couple.display_name,
    couple.bride_name,
    couple.groom_name,
    couple.wedding_date,
    couple.venue_name,
    couple.venue_city,
  ]);
  const document = buildPrintableCardDocument(cardSource(couple, userId, "invitation", revision));
  const pdf = await renderPrintableCardPdf([document]);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.invitation",
    target_kind: "couple",
    target_id: couple.id,
    after: {},
  });
  const filename = "invitation-a5.pdf";
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "invitation_pdf",
    format: null,
    filename,
    contentType: "application/pdf",
    body: pdf,
  });
  return pdfResponse(filename, pdf, { cardType: "invitation", revision });
}

async function handleThankYou(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const revision = revisionOf("thank_you", couple.updated_at, [
    couple.design_json,
    couple.display_name,
    couple.bride_name,
    couple.groom_name,
    couple.wedding_date,
  ]);
  const document = buildPrintableCardDocument(cardSource(couple, userId, "thank_you", revision));
  const pdf = await renderPrintableCardPdf([document]);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.thank_you",
    target_kind: "couple",
    target_id: couple.id,
    after: {},
  });
  const filename = "thank-you-a6.pdf";
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "thank_you_pdf",
    format: null,
    filename,
    contentType: "application/pdf",
    body: pdf,
  });
  return pdfResponse(filename, pdf, { cardType: "thank_you", revision });
}

async function handleScheduleCard(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const events = listScheduleEvents(couple.id);
  const revision = revisionOf("schedule", couple.updated_at, [
    couple.design_json,
    couple.display_name,
    couple.bride_name,
    couple.groom_name,
    couple.wedding_date,
    ...events.map((event) => [
      event.id,
      event.updated_at,
      event.label,
      event.starts_at_minutes,
      event.is_key_moment,
    ]),
  ]);
  const document = buildPrintableCardDocument(
    cardSource(couple, userId, "schedule", revision, { schedule: events }),
  );
  const pdf = await renderPrintableCardPdf([document]);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.schedule_card",
    target_kind: "couple",
    target_id: couple.id,
    after: { event_count: document.content.entries.length, revision },
  });
  const filename = "schedule-card-a5.pdf";
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "schedule_pdf",
    format: null,
    filename,
    contentType: "application/pdf",
    body: pdf,
  });
  return pdfResponse(filename, pdf, { cardType: "schedule", revision });
}

async function handleSchedule(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const events = listScheduleEvents(couple.id);
  const supplierNames: Record<string, string> = {};
  for (const s of listCoupleSuppliers(couple.id)) supplierNames[s.id] = s.name;
  const pdf = await renderSchedulePdf({
    couple_display_name: couple.display_name,
    wedding_date: couple.wedding_date,
    events,
    supplier_names: supplierNames,
  });
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.schedule",
    target_kind: "couple",
    target_id: couple.id,
    after: { event_count: events.length },
  });
  const filename = "schedule-a4.pdf";
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "schedule_pdf",
    format: null,
    filename,
    contentType: "application/pdf",
    body: pdf,
  });
  return pdfResponse(filename, pdf);
}

export function registerPrintRoutes(router: Router) {
  router.get("/api/print/seating/a4", (ctx) => handleSeatingChart(ctx, "a4"), true);
  router.get("/api/print/seating/a3", (ctx) => handleSeatingChart(ctx, "a3"), true);
  router.get("/api/print/place-cards", handlePlaceCards, true);
  router.get("/api/print/table-numbers", handleTableNumbers, true);
  router.get("/api/print/menu", handleMenu, true);
  router.get("/api/print/invitation", handleInvitation, true);
  router.get("/api/print/thank-you", handleThankYou, true);
  router.get("/api/print/schedule-card", handleScheduleCard, true);
  router.get("/api/print/schedule", handleSchedule, true);
}
