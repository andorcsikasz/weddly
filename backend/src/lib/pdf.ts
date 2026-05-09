// PDF print pipeline. pdf-lib only — no headless browser. All units are mm
// internally; we convert to PDF points (1 mm = 2.83465 pt) at draw time.
//
// Three formats per BLUEPRINT:
//   - A4 seating chart (210×297mm)
//   - A6 place cards (105×148mm), 4 per A4 sheet
//   - A3 large seating chart (297×420mm)

import { type PDFFont, PDFDocument, StandardFonts, rgb } from "pdf-lib";
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

/** Lay tables out on the page. We respect the user-set x_mm/y_mm if both are
 *  positive; otherwise we auto-flow into a grid so a fresh seating plan is still
 *  printable. */
function layoutTables(
  tables: SeatingTable[],
  pageW_mm: number,
  pageH_mm: number,
): Map<number, { x_mm: number; y_mm: number; r_mm: number }> {
  const margin = 20; // mm
  const useUserPos = tables.some((t) => t.x_mm > 0 || t.y_mm > 0);
  const out = new Map<number, { x_mm: number; y_mm: number; r_mm: number }>();
  if (useUserPos) {
    for (const t of tables) {
      out.set(t.id, {
        x_mm: Math.max(margin, Math.min(pageW_mm - margin, t.x_mm)),
        y_mm: Math.max(margin, Math.min(pageH_mm - margin, t.y_mm)),
        r_mm: 22,
      });
    }
    return out;
  }
  // Auto grid.
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const rows = Math.max(1, Math.ceil(tables.length / cols));
  const cellW = (pageW_mm - 2 * margin) / cols;
  const cellH = (pageH_mm - 2 * margin - 30) / rows;
  for (let i = 0; i < tables.length; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.set(tables[i]!.id, {
      x_mm: margin + cellW * (c + 0.5),
      y_mm: margin + 30 + cellH * (r + 0.5),
      r_mm: Math.min(cellW, cellH) * 0.35,
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
    const r = mm(pos.r_mm);

    if (t.shape === "round") {
      page.drawCircle({
        x: cx,
        y: cy,
        size: r,
        borderWidth: 1,
        borderColor: rgb(0.06, 0.09, 0.19),
        color: rgb(0.97, 0.96, 0.92),
      });
    } else if (t.shape === "square") {
      page.drawRectangle({
        x: cx - r,
        y: cy - r,
        width: r * 2,
        height: r * 2,
        borderWidth: 1,
        borderColor: rgb(0.06, 0.09, 0.19),
        color: rgb(0.97, 0.96, 0.92),
      });
    } else {
      // long table: 3:1 width:height
      page.drawRectangle({
        x: cx - r * 1.5,
        y: cy - r * 0.5,
        width: r * 3,
        height: r,
        borderWidth: 1,
        borderColor: rgb(0.06, 0.09, 0.19),
        color: rgb(0.97, 0.96, 0.92),
      });
    }

    const labelText = fitText(helvBold, t.label, 10, r * 1.8);
    const labelW = helvBold.widthOfTextAtSize(labelText, 10);
    page.drawText(labelText, {
      x: cx - labelW / 2,
      y: cy - 2,
      size: 10,
      font: helvBold,
      color: rgb(0.06, 0.09, 0.19),
    });

    // Render guest names beside the table.
    const seats = (seatsByTable.get(t.id) ?? []).sort((a, b) => a.seat_index - b.seat_index);
    for (let i = 0; i < seats.length; i++) {
      const guest = guestById.get(seats[i]!.guest_id);
      if (!guest) continue;
      const ang = (i / Math.max(seats.length, t.seats)) * Math.PI * 2;
      const lx = cx + Math.cos(ang) * (r + 6);
      const ly = cy + Math.sin(ang) * (r + 6);
      const text = fitText(helv, guest.full_name, 7, mm(35));
      page.drawText(text, { x: lx, y: ly, size: 7, font: helv, color: rgb(0.1, 0.14, 0.25) });
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
