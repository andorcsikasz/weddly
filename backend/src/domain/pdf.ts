// PDF print pipeline. pdf-lib only — no headless browser. All units are mm
// internally; we convert to PDF points (1 mm = 2.83465 pt) at draw time.
//
// Three formats per BLUEPRINT:
//   - A4 seating chart (210×297mm)
//   - A6 place cards (105×148mm), 4 per A4 sheet
//   - A3 large seating chart (297×420mm)

import { type PDFFont, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { chairOffsets } from "@shared/seating";
import type { Guest, SeatAssignment, SeatingTable } from "@shared/types";

const MM_TO_PT = 2.83465;

const FORMATS = {
  a4: { width_mm: 210, height_mm: 297 },
  a3: { width_mm: 297, height_mm: 420 },
  a6: { width_mm: 105, height_mm: 148 },
} as const;

export type PrintFormat = keyof typeof FORMATS;

interface SeatingChartInput {
  format: "a4" | "a3";
  couple_display_name: string;
  wedding_date: string | null;
  tables: SeatingTable[];
  assignments: SeatAssignment[];
  guests: Guest[];
}

function mm(v: number): number {
  return v * MM_TO_PT;
}

/** ASCII-safe rendering for Helvetica (no Cyrillic / extended unicode glyphs).
 *  Replaces unmappable chars with `?` so a guest like "Anna Iván" still renders. */
function safe(text: string): string {
  // Helvetica supports WinAnsi (Latin-1 + a few extras). Strip everything else.
  // Hungarian accented letters (á é í ó ö ő ú ü ű) are all in WinAnsi.
  return text.normalize("NFC").replace(/[^\x20-\xff]/g, "?");
}

function fitText(font: PDFFont, text: string, sizePt: number, maxWidthPt: number): string {
  let s = safe(text);
  if (font.widthOfTextAtSize(s, sizePt) <= maxWidthPt) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, sizePt) > maxWidthPt) {
    s = s.slice(0, -1);
  }
  return `${s.slice(0, -1)}…`;
}

interface TableLayout {
  x_mm: number;
  y_mm: number;
  /** Half-width on the page (x-axis radius after any down-scaling). */
  rx_mm: number;
  /** Half-length on the page (y-axis radius after any down-scaling). */
  ry_mm: number;
}

function tableHalfDims(t: SeatingTable): { rx: number; ry: number } {
  if (t.shape === "round") {
    const r = t.width_mm / 2;
    return { rx: r, ry: r };
  }
  if (t.shape === "square") {
    const s = Math.max(t.width_mm, t.length_mm) / 2;
    return { rx: s, ry: s };
  }
  // long: width is the shorter side, length is the longer side. We orient
  // long tables horizontally on the page so the shape reads "long" at a glance.
  return { rx: t.length_mm / 2, ry: t.width_mm / 2 };
}

/** Lay tables out on the page. If any table has a positive position, we use
 *  the user-set coordinates and render every table at its real-world size. If
 *  no positions are set, we auto-flow into a grid scaled to fit. */
function layoutTables(
  tables: SeatingTable[],
  pageW_mm: number,
  pageH_mm: number,
): Map<number, TableLayout> {
  const margin = 20;
  const headerH = 30;
  const useUserPos = tables.some((t) => t.x_mm > 0 || t.y_mm > 0);
  const out = new Map<number, TableLayout>();

  if (useUserPos) {
    // Find the bounding box of the user-placed tables and scale it to fit
    // the page if necessary, preserving aspect ratio.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tables) {
      const { rx, ry } = tableHalfDims(t);
      minX = Math.min(minX, t.x_mm - rx);
      minY = Math.min(minY, t.y_mm - ry);
      maxX = Math.max(maxX, t.x_mm + rx);
      maxY = Math.max(maxY, t.y_mm + ry);
    }
    const planW = Math.max(1, maxX - minX);
    const planH = Math.max(1, maxY - minY);
    const availW = pageW_mm - 2 * margin;
    const availH = pageH_mm - 2 * margin - headerH;
    const scale = Math.min(1, availW / planW, availH / planH);
    const offsetX = margin + (availW - planW * scale) / 2 - minX * scale;
    const offsetY = margin + headerH + (availH - planH * scale) / 2 - minY * scale;
    for (const t of tables) {
      const { rx, ry } = tableHalfDims(t);
      out.set(t.id, {
        x_mm: t.x_mm * scale + offsetX,
        y_mm: t.y_mm * scale + offsetY,
        rx_mm: rx * scale,
        ry_mm: ry * scale,
      });
    }
    return out;
  }

  // Auto grid — fit a circle of radius cell*0.35 into each cell.
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const rows = Math.max(1, Math.ceil(tables.length / cols));
  const cellW = (pageW_mm - 2 * margin) / cols;
  const cellH = (pageH_mm - 2 * margin - headerH) / rows;
  for (let i = 0; i < tables.length; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const t = tables[i]!;
    const { rx, ry } = tableHalfDims(t);
    const cellRadius = Math.min(cellW, cellH) * 0.35;
    const aspect = rx / ry;
    const fit = Math.min(cellRadius, cellRadius * aspect) / Math.max(rx, ry);
    out.set(t.id, {
      x_mm: margin + cellW * (c + 0.5),
      y_mm: margin + headerH + cellH * (r + 0.5),
      rx_mm: rx * fit,
      ry_mm: ry * fit,
    });
  }
  return out;
}

export async function renderSeatingChartPdf(input: SeatingChartInput): Promise<Uint8Array> {
  const { width_mm, height_mm } = FORMATS[input.format];
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([mm(width_mm), mm(height_mm)]);

  // Header.
  const title = safe(input.couple_display_name);
  page.drawText(title, {
    x: mm(15),
    y: mm(height_mm - 18),
    size: 24,
    font: helvBold,
    color: rgb(0.06, 0.09, 0.19),
  });
  if (input.wedding_date) {
    page.drawText(safe(input.wedding_date), {
      x: mm(15),
      y: mm(height_mm - 26),
      size: 11,
      font: helv,
      color: rgb(0.27, 0.33, 0.48),
    });
  }
  page.drawText("Ültetési rend / Seating chart", {
    x: mm(width_mm - 80),
    y: mm(height_mm - 18),
    size: 11,
    font: helv,
    color: rgb(0.27, 0.33, 0.48),
  });

  const positions = layoutTables(input.tables, width_mm, height_mm);
  const guestById = new Map(input.guests.map((g) => [g.id, g]));
  const seatsByTable = new Map<number, SeatAssignment[]>();
  for (const a of input.assignments) {
    if (!seatsByTable.has(a.table_id)) seatsByTable.set(a.table_id, []);
    seatsByTable.get(a.table_id)!.push(a);
  }

  for (const t of input.tables) {
    const pos = positions.get(t.id);
    if (!pos) continue;
    const cx = mm(pos.x_mm);
    const cy = mm(pos.y_mm);
    const rx = mm(pos.rx_mm);
    const ry = mm(pos.ry_mm);

    if (t.shape === "round") {
      page.drawCircle({
        x: cx,
        y: cy,
        size: rx,
        borderWidth: 1,
        borderColor: rgb(0.06, 0.09, 0.19),
        color: rgb(0.97, 0.96, 0.92),
      });
    } else {
      // square or long — draw an axis-aligned rectangle at the layout dims.
      page.drawRectangle({
        x: cx - rx,
        y: cy - ry,
        width: rx * 2,
        height: ry * 2,
        borderWidth: 1,
        borderColor: rgb(0.06, 0.09, 0.19),
        color: rgb(0.97, 0.96, 0.92),
      });
    }

    const labelText = fitText(helvBold, t.label, 10, Math.min(rx, ry) * 1.8);
    const labelW = helvBold.widthOfTextAtSize(labelText, 10);
    page.drawText(labelText, {
      x: cx - labelW / 2,
      y: cy - 2,
      size: 10,
      font: helvBold,
      color: rgb(0.06, 0.09, 0.19),
    });

    // Render guest names around the table perimeter using the same chair
    // layout as the on-screen map (round = even angles; rectangular = chairs
    // distributed along the long sides first, with end-caps if needed).
    const seats = (seatsByTable.get(t.id) ?? []).sort((a, b) => a.seat_index - b.seat_index);
    const chairs = chairOffsets(t.shape, t.seats, rx, ry);
    for (const a of seats) {
      const offset = chairs[a.seat_index];
      const guest = guestById.get(a.guest_id);
      if (!offset || !guest) continue;
      const text = fitText(helv, guest.full_name, 7, mm(35));
      // Push the label a bit further out than the chair itself to avoid
      // colliding with the table border.
      const padPt = 3;
      const norm = Math.hypot(offset.dx, offset.dy) || 1;
      const px = cx + offset.dx + (offset.dx / norm) * padPt;
      const py = cy + offset.dy + (offset.dy / norm) * padPt;
      page.drawText(text, { x: px, y: py, size: 7, font: helv, color: rgb(0.1, 0.14, 0.25) });
    }
  }

  return pdf.save();
}

interface PlaceCardInput {
  couple_display_name: string;
  wedding_date: string | null;
  guests: Guest[];
  /** When provided, prints the table label below the guest name. */
  tablesByGuestId?: Map<number, string>;
}

/** A6 place cards, 4 to an A4 sheet (2×2). Guests list is consumed in batches. */
export async function renderPlaceCardsPdf(input: PlaceCardInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cardW = FORMATS.a6.width_mm;
  const cardH = FORMATS.a6.height_mm;
  const sheetW = FORMATS.a4.width_mm;
  const sheetH = FORMATS.a4.height_mm;
  // 2 cards across, 2 cards tall.
  const cellW = sheetW / 2;
  const cellH = sheetH / 2;

  const guests = input.guests;
  if (guests.length === 0) {
    // Empty PDF would be weird — emit one blank A4 with a "no guests" note.
    const page = pdf.addPage([mm(sheetW), mm(sheetH)]);
    page.drawText("No guests yet.", {
      x: mm(15),
      y: mm(sheetH - 30),
      size: 14,
      font: helv,
      color: rgb(0.4, 0.4, 0.4),
    });
    return pdf.save();
  }

  for (let i = 0; i < guests.length; i += 4) {
    const page = pdf.addPage([mm(sheetW), mm(sheetH)]);
    for (let slot = 0; slot < 4; slot++) {
      const g = guests[i + slot];
      if (!g) break;
      const col = slot % 2;
      const row = Math.floor(slot / 2);
      const x_mm0 = col * cellW + (cellW - cardW) / 2;
      const y_mm0_top = sheetH - (row + 1) * cellH + (cellH - cardH) / 2;

      // Card border.
      page.drawRectangle({
        x: mm(x_mm0),
        y: mm(y_mm0_top),
        width: mm(cardW),
        height: mm(cardH),
        borderWidth: 0.5,
        borderColor: rgb(0.75, 0.7, 0.55),
        color: rgb(0.99, 0.98, 0.95),
      });

      const name = safe(g.full_name);
      const nameSize = name.length > 18 ? 18 : 24;
      const nameW = helvBold.widthOfTextAtSize(name, nameSize);
      page.drawText(name, {
        x: mm(x_mm0 + cardW / 2) - nameW / 2,
        y: mm(y_mm0_top + cardH / 2 + 4),
        size: nameSize,
        font: helvBold,
        color: rgb(0.06, 0.09, 0.19),
      });

      const tableLabel = input.tablesByGuestId?.get(g.id);
      if (tableLabel) {
        const t = safe(tableLabel);
        const tw = helv.widthOfTextAtSize(t, 11);
        page.drawText(t, {
          x: mm(x_mm0 + cardW / 2) - tw / 2,
          y: mm(y_mm0_top + cardH / 2 - 8),
          size: 11,
          font: helv,
          color: rgb(0.27, 0.33, 0.48),
        });
      }

      // Couple footer
      const footer = safe(input.couple_display_name);
      const fw = helv.widthOfTextAtSize(footer, 8);
      page.drawText(footer, {
        x: mm(x_mm0 + cardW / 2) - fw / 2,
        y: mm(y_mm0_top + 8),
        size: 8,
        font: helv,
        color: rgb(0.45, 0.45, 0.45),
      });
    }
  }
  return pdf.save();
}
