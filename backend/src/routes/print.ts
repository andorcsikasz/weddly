// Couple-scoped PDF endpoints. All return application/pdf with attachment headers.

import { db } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { recordExport } from "../domain/exports";
import { type Ctx, HttpError, requireAuth, type Router } from "../lib/http";
import { renderPlaceCardsPdf, renderSeatingChartPdf } from "../domain/pdf";
import { listGuestsByCouple, toGuest } from "../domain/guests";
import type { GuestRow } from "../domain/guests";
import type { SeatAssignment, SeatingTable, TableShape } from "@shared/types";

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

function pdfResponse(filename: string, body: Uint8Array): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function handleSeatingChart(ctx: Ctx, fmt: "a4" | "a3"): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const tables = loadTables(couple.id);
  const assignments = loadAssignments(couple.id);
  const guests = listGuestsByCouple(couple.id);
  const pdf = await renderSeatingChartPdf({
    format: fmt,
    couple_display_name: couple.display_name,
    wedding_date: couple.wedding_date,
    tables,
    assignments,
    guests,
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
  const guestRows = db
    .prepare("SELECT * FROM guests WHERE couple_id = ? ORDER BY full_name")
    .all(couple.id) as GuestRow[];
  const filtered = onlyConfirmed ? guestRows.filter((r) => r.rsvp_status === "yes") : guestRows;
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

  const pdf = await renderPlaceCardsPdf({
    couple_display_name: couple.display_name,
    wedding_date: couple.wedding_date,
    guests,
    tablesByGuestId,
  });
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.place_cards",
    target_kind: "couple",
    target_id: couple.id,
    after: { guest_count: guests.length },
  });
  const filename = "place-cards-a6.pdf";
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "place_cards_pdf",
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
}
