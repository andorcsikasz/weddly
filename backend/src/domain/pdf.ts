// PDF print pipeline. pdf-lib only — no headless browser. All units are mm
// internally; we convert to PDF points (1 mm = 2.83465 pt) at draw time.
//
// Three formats per BLUEPRINT:
//   - A4 seating chart (210×297mm)
//   - 100×50mm place cards, 10 per A4 sheet (2×5)
//   - A3 large seating chart (297×420mm)
//
// Glyph coverage: a Noto Sans subset (Latin / Greek / Cyrillic, Regular +
// Bold) is bundled under `pdf_fonts/` and embedded via @pdf-lib/fontkit at
// render time. Characters outside that script set (CJK, Arabic, …) still
// fall back to '?'. We subset on embed so the PDF carries only the glyphs
// actually rendered, not the full 600 KB family.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { type PDFFont, type PDFPage, PDFDocument, degrees, rgb } from "pdf-lib";
import type { ScheduleEvent } from "@shared/schedule";
import { chairOffsets } from "@shared/seating";
import type { Guest, SeatAssignment, SeatingTable } from "@shared/types";

const FONT_DIR = join(import.meta.dir, "pdf_fonts");
const NOTO_REGULAR = readFileSync(join(FONT_DIR, "NotoSans-Regular.ttf"));
const NOTO_BOLD = readFileSync(join(FONT_DIR, "NotoSans-Bold.ttf"));
const NOTO_SC = readFileSync(join(FONT_DIR, "NotoSansSC-Regular.otf"));

/** True when the codepoint is in the Simplified-Chinese (or shared CJK)
 *  Unicode blocks, i.e. a glyph the Noto Sans SC fallback covers. */
function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) || // CJK Symbols & Punctuation
    (cp >= 0x3400 && cp <= 0x4dbf) || // Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // Basic CJK Unified
    (cp >= 0xff00 && cp <= 0xffef) // Halfwidth & Fullwidth Forms
  );
}

function containsCjk(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(cp)) return true;
  }
  return false;
}

const MM_TO_PT = 2.83465;

const FORMATS = {
  a4: { width_mm: 210, height_mm: 297 },
  a3: { width_mm: 297, height_mm: 420 },
  // Flat 100×50mm place card. 2 across × 5 down on an A4 sheet = 10 per page.
  place_card: { width_mm: 100, height_mm: 50 },
} as const;

export type PrintFormat = keyof typeof FORMATS;

interface SeatingChartInput {
  format: "a4" | "a3";
  couple_display_name: string;
  wedding_date: string | null;
  tables: SeatingTable[];
  assignments: SeatAssignment[];
  guests: Guest[];
  /** Floor-plan dimensions in mm. When provided, the renderer lays the page
   *  out against the actual room rectangle (preserving empty floor space)
   *  and auto-selects landscape vs portrait to maximise scale. Without
   *  these, falls back to a tight bbox around the placed tables. */
  room_width_mm?: number;
  room_height_mm?: number;
}

function mm(v: number): number {
  return v * MM_TO_PT;
}

/** Normalises text + picks the right embedded font for the input. Noto Sans
 *  Latin/Greek/Cyrillic covers most names; Simplified-Chinese names route
 *  through Noto Sans SC. Anything outside either subset still falls back to
 *  '?' because we don't currently bundle Arabic / Devanagari / etc. */
function safe(text: string): string {
  // NFC for diacritic consistency, then map anything truly unsupported to
  // '?'. We DON'T strip CJK any more — that's handled by font selection at
  // draw time. The exclusion ranges below are the scripts neither Noto
  // (Latin+Greek+Cyrillic) nor Noto Sans SC ships.
  return text.normalize("NFC").replace(/[؀-ۿऀ-ॿ぀-ヿ가-힯]/g, "?");
}

interface FontPair {
  regular: PDFFont;
  bold: PDFFont;
  /** Lazily-embedded CJK fallback. We only register the SC font with the
   *  document when an input string actually contains CJK glyphs — otherwise
   *  the full 8 MB face would bloat every Latin-only PDF. */
  getCjk: () => Promise<PDFFont>;
}

async function pickFontAsync(
  pair: FontPair,
  text: string,
  prefer: "regular" | "bold",
): Promise<PDFFont> {
  if (containsCjk(text)) return pair.getCjk();
  return prefer === "bold" ? pair.bold : pair.regular;
}

async function fitText(
  pair: FontPair,
  text: string,
  sizePt: number,
  maxWidthPt: number,
  prefer: "regular" | "bold" = "regular",
): Promise<{ text: string; font: PDFFont }> {
  let s = safe(text);
  const font = await pickFontAsync(pair, s, prefer);
  if (font.widthOfTextAtSize(s, sizePt) <= maxWidthPt) return { text: s, font };
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, sizePt) > maxWidthPt) {
    s = s.slice(0, -1);
  }
  return { text: `${s.slice(0, -1)}…`, font };
}

interface TableLayout {
  x_mm: number;
  y_mm: number;
  /** Half-width on the page (x-axis radius after any down-scaling). */
  rx_mm: number;
  /** Half-length on the page (y-axis radius after any down-scaling). */
  ry_mm: number;
}

/** Scale + offset describing the affine map applied to the user's plan to
 *  fit it on the page. Only meaningful when the user actually placed tables
 *  (i.e. `useUserPos` was true inside `layoutTables`). When `null`, the PDF
 *  used the auto-flow branch and there's no single scale to draw a 50cm
 *  real-world grid against. */
interface PlanTransform {
  /** Page-mm per real-world-mm. */
  scale: number;
  /** Page-mm offset applied AFTER scaling (so page_x = real_x * scale + offsetX). */
  offsetX: number;
  offsetY: number;
  /** Real-world bounding-box used for the fit (inclusive). */
  planMinX: number;
  planMinY: number;
  planMaxX: number;
  planMaxY: number;
}

interface LayoutResult {
  tableLayouts: Map<number, TableLayout>;
  /** Null when the renderer fell back to the auto-flow grid path. */
  transform: PlanTransform | null;
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

/** Lay tables out on the page. Layout strategy:
 *  - If room dimensions are provided, scale the whole room rectangle into
 *    the page so the print mirrors what the couple sees in the editor
 *    (empty floor space preserved). Caller picks page orientation first.
 *  - Else, if any table has a positive position, fit a tight bbox around
 *    the placed tables.
 *  - Else, auto-flow into a grid. */
function layoutTables(
  tables: SeatingTable[],
  pageW_mm: number,
  pageH_mm: number,
  room?: { width_mm: number; height_mm: number },
): LayoutResult {
  const margin = 12;
  const headerH = 22;
  const useUserPos = tables.some((t) => t.x_mm > 0 || t.y_mm > 0);
  const out = new Map<number, TableLayout>();

  if (room && useUserPos) {
    // Render the actual room rectangle so empty floor space is preserved.
    const planW = Math.max(1, room.width_mm);
    const planH = Math.max(1, room.height_mm);
    const availW = pageW_mm - 2 * margin;
    const availH = pageH_mm - 2 * margin - headerH;
    const scale = Math.min(availW / planW, availH / planH);
    const offsetX = margin + (availW - planW * scale) / 2;
    const offsetY = margin + headerH + (availH - planH * scale) / 2;
    for (const t of tables) {
      const { rx, ry } = tableHalfDims(t);
      out.set(t.id, {
        x_mm: t.x_mm * scale + offsetX,
        y_mm: t.y_mm * scale + offsetY,
        rx_mm: rx * scale,
        ry_mm: ry * scale,
      });
    }
    return {
      tableLayouts: out,
      transform: {
        scale,
        offsetX,
        offsetY,
        planMinX: 0,
        planMinY: 0,
        planMaxX: planW,
        planMaxY: planH,
      },
    };
  }

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
    return {
      tableLayouts: out,
      transform: {
        scale,
        offsetX,
        offsetY,
        planMinX: minX,
        planMinY: minY,
        planMaxX: maxX,
        planMaxY: maxY,
      },
    };
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
  return { tableLayouts: out, transform: null };
}

/** Real-world 50-cm dashed grid behind the tables. Lines are spaced at
 *  GRID_STEP_MM in user coordinates, then mapped through `transform` to
 *  page-mm. Faint colour + 1.2 / 2.4 mm dash so it reads as planning paper
 *  without dominating.
 *
 *  Coordinate convention matches the rest of this file: y is used as
 *  pdf-lib's raw y (no flip), so the grid lines up with the same
 *  table-render code. */
const GRID_STEP_MM = 500;
function drawPlanGrid(
  page: PDFPage,
  transform: PlanTransform,
  _pageW_mm: number,
  _pageH_mm: number,
): void {
  const { scale, offsetX, offsetY, planMinX, planMinY, planMaxX, planMaxY } = transform;
  // Snap to the nearest grid line outside the bounding box so the dashes
  // visibly extend past every table without leaving a flat strip.
  const startX = Math.floor(planMinX / GRID_STEP_MM) * GRID_STEP_MM;
  const endX = Math.ceil(planMaxX / GRID_STEP_MM) * GRID_STEP_MM;
  const startY = Math.floor(planMinY / GRID_STEP_MM) * GRID_STEP_MM;
  const endY = Math.ceil(planMaxY / GRID_STEP_MM) * GRID_STEP_MM;
  const xPt = (xMm: number): number => mm(xMm * scale + offsetX);
  const yPt = (yMm: number): number => mm(yMm * scale + offsetY);
  // Darker beige + thicker stroke + chunkier dash so the 50-cm grid reads
  // clearly at print scale. Earlier 0.35 pt / rgb(0.78, …) was almost
  // invisible on glossy paper.
  const colour = rgb(0.6, 0.55, 0.46);
  const dash = [mm(2.5), mm(2.5)];
  for (let x = startX; x <= endX; x += GRID_STEP_MM) {
    page.drawLine({
      start: { x: xPt(x), y: yPt(startY) },
      end: { x: xPt(x), y: yPt(endY) },
      thickness: 0.7,
      color: colour,
      dashArray: dash,
    });
  }
  for (let y = startY; y <= endY; y += GRID_STEP_MM) {
    page.drawLine({
      start: { x: xPt(startX), y: yPt(y) },
      end: { x: xPt(endX), y: yPt(y) },
      thickness: 0.7,
      color: colour,
      dashArray: dash,
    });
  }
}

export async function renderSeatingChartPdf(input: SeatingChartInput): Promise<Uint8Array> {
  const fmt = FORMATS[input.format];
  // Auto-pick portrait vs landscape so the floor plan fills the page. We
  // try both orientations against the room rectangle (or table bbox) and
  // pick whichever yields the larger fit scale. Tall rooms stay portrait;
  // wide rooms flip to landscape automatically.
  let width_mm: number = fmt.width_mm;
  let height_mm: number = fmt.height_mm;
  const roomW = input.room_width_mm ?? 0;
  const roomH = input.room_height_mm ?? 0;
  const useRoom = roomW > 0 && roomH > 0;
  let planW = useRoom ? roomW : 0;
  let planH = useRoom ? roomH : 0;
  if (!useRoom && input.tables.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of input.tables) {
      const { rx, ry } = tableHalfDims(t);
      minX = Math.min(minX, t.x_mm - rx);
      minY = Math.min(minY, t.y_mm - ry);
      maxX = Math.max(maxX, t.x_mm + rx);
      maxY = Math.max(maxY, t.y_mm + ry);
    }
    planW = Math.max(1, maxX - minX);
    planH = Math.max(1, maxY - minY);
  }
  if (planW > 0 && planH > 0) {
    const margin = 12;
    const headerH = 22;
    const portraitFit = Math.min(
      (width_mm - 2 * margin) / planW,
      (height_mm - 2 * margin - headerH) / planH,
    );
    const landscapeFit = Math.min(
      (height_mm - 2 * margin) / planW,
      (width_mm - 2 * margin - headerH) / planH,
    );
    if (landscapeFit > portraitFit) {
      [width_mm, height_mm] = [height_mm, width_mm];
    }
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const helv = await pdf.embedFont(NOTO_REGULAR, { subset: true });
  const helvBold = await pdf.embedFont(NOTO_BOLD, { subset: true });
  // CJK fallback is embedded lazily — only when the input strings actually
  // contain Han / Kana glyphs. Keeps Latin-only PDFs lean (the SC face is
  // ~8 MB and fontkit 1.1.1 hits a writeUInt8-out-of-range bug if we ask it
  // to subset the CFF table under Bun's Buffer shim).
  let cjkFont: PDFFont | null = null;
  const fontPair: FontPair = {
    regular: helv,
    bold: helvBold,
    getCjk: async () => {
      if (cjkFont) return cjkFont;
      cjkFont = await pdf.embedFont(NOTO_SC);
      return cjkFont;
    },
  };
  const page = pdf.addPage([mm(width_mm), mm(height_mm)]);

  // Header. Pick the font dynamically so a CJK couple name still draws.
  const title = safe(input.couple_display_name);
  page.drawText(title, {
    x: mm(15),
    y: mm(height_mm - 14),
    size: 18,
    font: await pickFontAsync(fontPair, title, "bold"),
    color: rgb(0.06, 0.09, 0.19),
  });
  if (input.wedding_date) {
    const dateText = safe(input.wedding_date);
    page.drawText(dateText, {
      x: mm(15),
      y: mm(height_mm - 20),
      size: 10,
      font: await pickFontAsync(fontPair, dateText, "regular"),
      color: rgb(0.27, 0.33, 0.48),
    });
  }
  const header = "Ültetési rend / Seating chart";
  page.drawText(header, {
    x: mm(width_mm - 70),
    y: mm(height_mm - 14),
    size: 10,
    font: await pickFontAsync(fontPair, header, "regular"),
    color: rgb(0.27, 0.33, 0.48),
  });

  const { tableLayouts: positions, transform } = layoutTables(
    input.tables,
    width_mm,
    height_mm,
    useRoom ? { width_mm: roomW, height_mm: roomH } : undefined,
  );

  // Faint 50 cm dashed grid behind the tables — matches the on-screen
  // canvas and gives the couple a real-world ruler when planning the
  // room on paper. Only drawn when the user actually placed the tables
  // (auto-flow renders cell-fitted shapes, no consistent real-world scale).
  if (transform) {
    drawPlanGrid(page, transform, width_mm, height_mm);
    // Room boundary — chunky ink frame matching the SVG editor. Drawn as
    // four lines so we don't overpaint the grid with a fill.
    if (useRoom) {
      const x0 = mm(transform.offsetX);
      const y0 = mm(transform.offsetY);
      const x1 = x0 + mm(roomW * transform.scale);
      const y1 = y0 + mm(roomH * transform.scale);
      const frame = rgb(0.14, 0.19, 0.31);
      const thick = 1.2;
      page.drawLine({
        start: { x: x0, y: y0 },
        end: { x: x1, y: y0 },
        thickness: thick,
        color: frame,
      });
      page.drawLine({
        start: { x: x1, y: y0 },
        end: { x: x1, y: y1 },
        thickness: thick,
        color: frame,
      });
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x0, y: y1 },
        thickness: thick,
        color: frame,
      });
      page.drawLine({
        start: { x: x0, y: y1 },
        end: { x: x0, y: y0 },
        thickness: thick,
        color: frame,
      });
    }
  }
  const guestById = new Map(input.guests.map((g) => [g.id, g]));
  const seatsByTable = new Map<number, SeatAssignment[]>();
  for (const a of input.assignments) {
    if (!seatsByTable.has(a.table_id)) seatsByTable.set(a.table_id, []);
    seatsByTable.get(a.table_id)!.push(a);
  }

  // Brand palette for table + chair rendering — keep these in lockstep with
  // the SVG editor so the print mirrors what the couple sees. Hex sources:
  // ink-800 (#1a2440), paper-50 (#fbfaf5), blush-300 (#eda997),
  // blush-700 (#9d3b27).
  const INK_800 = rgb(0.102, 0.141, 0.251);
  const PAPER_50 = rgb(0.984, 0.98, 0.961);
  const BLUSH_300 = rgb(0.929, 0.663, 0.592);
  const BLUSH_700 = rgb(0.616, 0.231, 0.153);

  // Standard banquet chair size in mm — constant in real-world space.
  // Scaled into page mm via the layout transform so chairs stay proportional
  // to the room (~30% of a 1.5 m round table = 44 cm wide, which matches).
  const CHAIR_W_MM = 440;
  const CHAIR_H_MM = 360;
  const CHAIR_GAP_MM = 60;
  const chairScale = transform ? transform.scale : 1;
  const chairWpt = mm(CHAIR_W_MM * chairScale);
  const chairHpt = mm(CHAIR_H_MM * chairScale);
  const chairGapPt = mm(CHAIR_GAP_MM * chairScale);

  for (const t of input.tables) {
    const pos = positions.get(t.id);
    if (!pos) continue;
    const cx = mm(pos.x_mm);
    const cy = mm(pos.y_mm);
    const rx = mm(pos.rx_mm);
    const ry = mm(pos.ry_mm);

    // NOTE: t.rotation_deg is honoured on the on-screen canvas but renders
    // as 0° here. pdf-lib rotation is around the bottom-left corner — the
    // off-axis math (rotate, then re-center) is tracked for a follow-up.
    const borderW = 1.4;
    if (t.shape === "round") {
      page.drawCircle({
        x: cx,
        y: cy,
        size: rx,
        borderWidth: borderW,
        borderColor: INK_800,
        color: PAPER_50,
      });
    } else {
      // pdf-lib doesn't expose rounded corners on drawRectangle — the
      // strong stroke alone reads correctly at print scale. Future: build
      // an SVG path with arc-corners.
      page.drawRectangle({
        x: cx - rx,
        y: cy - ry,
        width: rx * 2,
        height: ry * 2,
        borderWidth: borderW,
        borderColor: INK_800,
        color: PAPER_50,
      });
    }

    // Chairs — blush rounded rectangles tangent to the perimeter, matching
    // the SVG editor. Centre of each chair sits CHAIR_GAP_MM outside the
    // edge, with its long axis along the table edge.
    const chairs = chairOffsets(t.shape, t.seats, rx, ry);
    const seats = (seatsByTable.get(t.id) ?? []).sort((a, b) => a.seat_index - b.seat_index);
    const seatByIndex = new Map(seats.map((a) => [a.seat_index, a]));
    const disabledSet = new Set(t.disabled_seats ?? []);
    for (let i = 0; i < chairs.length; i++) {
      const c = chairs[i];
      if (!c) continue;
      const isDisabled = disabledSet.has(i);
      const isFilled = seatByIndex.has(i);
      const norm = Math.hypot(c.dx, c.dy) || 1;
      const pushPt = chairHpt / 2 + chairGapPt;
      const px = cx + c.dx + (c.dx / norm) * pushPt;
      const py = cy + c.dy + (c.dy / norm) * pushPt;
      const rotDeg = ((c.angle * 180) / Math.PI + 90) % 360;
      // pdf-lib rotates around the rectangle's bottom-left corner. To rotate
      // around the chair centre, place the bottom-left such that after the
      // rotation the centre lands at (px, py).
      const rad = (rotDeg * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      const blX = px - (chairWpt / 2) * cosR + (chairHpt / 2) * sinR;
      const blY = py - (chairWpt / 2) * sinR - (chairHpt / 2) * cosR;
      const fill = isDisabled ? rgb(0.93, 0.91, 0.85) : isFilled ? INK_800 : BLUSH_300;
      page.drawRectangle({
        x: blX,
        y: blY,
        width: chairWpt,
        height: chairHpt,
        rotate: degrees(rotDeg),
        color: fill,
      });
    }

    // Guest names just outside each filled chair.
    for (const a of seats) {
      const c = chairs[a.seat_index];
      if (!c) continue;
      const guest = guestById.get(a.guest_id);
      if (!guest) continue;
      const norm = Math.hypot(c.dx, c.dy) || 1;
      const pushPt = chairHpt + chairGapPt + 2;
      const px = cx + c.dx + (c.dx / norm) * pushPt;
      const py = cy + c.dy + (c.dy / norm) * pushPt;
      const guestFit = await fitText(fontPair, guest.full_name, 6.5, mm(28));
      const w = guestFit.font.widthOfTextAtSize(guestFit.text, 6.5);
      page.drawText(guestFit.text, {
        x: px - w / 2,
        y: py - 2,
        size: 6.5,
        font: guestFit.font,
        color: INK_800,
      });
    }

    // Table label — large blush text in the centre. Sized to fit the
    // shorter half-dim so it stays inside the table footprint. Min 9pt so
    // names stay legible even on tiny tables; the fitText caller truncates
    // with an ellipsis if it still overflows.
    const maxLabelW = Math.min(rx, ry) * 1.6;
    const labelSize = Math.max(9, Math.min(20, Math.min(rx, ry) * 0.5));
    const labelFit = await fitText(fontPair, t.label, labelSize, maxLabelW, "bold");
    const labelW = labelFit.font.widthOfTextAtSize(labelFit.text, labelSize);
    page.drawText(labelFit.text, {
      x: cx - labelW / 2,
      y: cy - labelSize / 3,
      size: labelSize,
      font: labelFit.font,
      color: BLUSH_700,
    });
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

/** 100×50mm place cards laid out 2×5 on an A4 sheet (10 per page).
 *  At 50mm tall there's no room for the couple footer the larger A6 card
 *  carried — name + table label only. */
export async function renderPlaceCardsPdf(input: PlaceCardInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const helv = await pdf.embedFont(NOTO_REGULAR, { subset: true });
  const helvBold = await pdf.embedFont(NOTO_BOLD, { subset: true });
  // Lazy CJK fallback — see comment in renderSeatingChartPdf.
  let cjkFont: PDFFont | null = null;
  const fontPair: FontPair = {
    regular: helv,
    bold: helvBold,
    getCjk: async () => {
      if (cjkFont) return cjkFont;
      cjkFont = await pdf.embedFont(NOTO_SC);
      return cjkFont;
    },
  };
  const cardW = FORMATS.place_card.width_mm;
  const cardH = FORMATS.place_card.height_mm;
  const sheetW = FORMATS.a4.width_mm;
  const sheetH = FORMATS.a4.height_mm;
  // 2 across × 5 down. Cells centre each card with some cut margin.
  const COLS = 2;
  const ROWS = 5;
  const PER_PAGE = COLS * ROWS;
  const cellW = sheetW / COLS;
  const cellH = sheetH / ROWS;

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

  for (let i = 0; i < guests.length; i += PER_PAGE) {
    const page = pdf.addPage([mm(sheetW), mm(sheetH)]);
    for (let slot = 0; slot < PER_PAGE; slot++) {
      const g = guests[i + slot];
      if (!g) break;
      const col = slot % COLS;
      const row = Math.floor(slot / COLS);
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
      const nameSize = name.length > 22 ? 14 : 18;
      const nameFont = await pickFontAsync(fontPair, name, "bold");
      const nameW = nameFont.widthOfTextAtSize(name, nameSize);
      const tableLabel = input.tablesByGuestId?.get(g.id);
      // Centre the name vertically when there's no table label; nudge it up
      // a bit when a label is present so the two lines sit visually centred.
      const nameY_mm = tableLabel ? y_mm0_top + cardH * 0.55 : y_mm0_top + cardH / 2 - 3;
      page.drawText(name, {
        x: mm(x_mm0 + cardW / 2) - nameW / 2,
        y: mm(nameY_mm),
        size: nameSize,
        font: nameFont,
        color: rgb(0.06, 0.09, 0.19),
      });

      if (tableLabel) {
        const t = safe(tableLabel);
        const tFont = await pickFontAsync(fontPair, t, "regular");
        const tw = tFont.widthOfTextAtSize(t, 10);
        page.drawText(t, {
          x: mm(x_mm0 + cardW / 2) - tw / 2,
          y: mm(y_mm0_top + cardH * 0.22),
          size: 10,
          font: tFont,
          color: rgb(0.27, 0.33, 0.48),
        });
      }
    }
  }
  return pdf.save();
}

interface ScheduleInput {
  couple_display_name: string;
  wedding_date: string | null;
  events: ScheduleEvent[];
}

/** Format minutes-from-midnight as "HH:MM". Wedding-day-local time only —
 *  no timezone juggling. */
function formatHhmm(minutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.floor(minutes)));
  const hh = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Word-wrap `text` to `maxWidthPt` at `sizePt` using the given font, with
 *  the same NFC normalisation as the rest of the PDF. Falls back to greedy
 *  splitting (no hyphenation). Caps at `maxLines` lines (suffixes the last
 *  with an ellipsis when truncated) so a runaway notes field can't push the
 *  next row off the page. */
async function wrapLines(
  pair: FontPair,
  text: string,
  sizePt: number,
  maxWidthPt: number,
  maxLines: number,
  prefer: "regular" | "bold" = "regular",
): Promise<{ lines: string[]; font: PDFFont }> {
  const safeText = safe(text);
  const font = await pickFontAsync(pair, safeText, prefer);
  const words = safeText.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [], font };

  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, sizePt) <= maxWidthPt) {
      line = candidate;
      continue;
    }
    if (line) out.push(line);
    if (out.length >= maxLines) {
      // We've already hit the cap — fold this word into the last line as an ellipsis.
      out[out.length - 1] = `${(out[out.length - 1] ?? "").replace(/[…\s]+$/, "")}…`;
      return { lines: out, font };
    }
    // The word itself overflows — truncate it to fit.
    if (font.widthOfTextAtSize(word, sizePt) > maxWidthPt) {
      let s = word;
      while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, sizePt) > maxWidthPt) {
        s = s.slice(0, -1);
      }
      out.push(`${s.slice(0, -1)}…`);
      line = "";
    } else {
      line = word;
    }
  }
  if (line) out.push(line);
  if (out.length > maxLines) {
    out.length = maxLines;
    out[maxLines - 1] = `${(out[maxLines - 1] ?? "").replace(/[…\s]+$/, "")}…`;
  }
  return { lines: out, font };
}

/** A4 portrait run-of-show. Two columns: time + label/notes/location. One
 *  row per event, sorted by starts_at_minutes (server-side). Adds new pages
 *  as needed when the timeline overflows. */
export async function renderSchedulePdf(input: ScheduleInput): Promise<Uint8Array> {
  const { width_mm: pageW, height_mm: pageH } = FORMATS.a4;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const helv = await pdf.embedFont(NOTO_REGULAR, { subset: true });
  const helvBold = await pdf.embedFont(NOTO_BOLD, { subset: true });
  // Lazy CJK fallback — only embed the SC face when an input string actually
  // needs it. Same pattern as the seating + place-card renderers.
  let cjkFont: PDFFont | null = null;
  const fontPair: FontPair = {
    regular: helv,
    bold: helvBold,
    getCjk: async () => {
      if (cjkFont) return cjkFont;
      cjkFont = await pdf.embedFont(NOTO_SC);
      return cjkFont;
    },
  };

  // Page layout — margins in mm so the print stays predictable across A4
  // printers. The right column is everything left after the time column.
  const marginX = 18;
  const marginTopHeader = 18;
  const headerHeightMm = 32; // couple name + date + table head
  const marginBottom = 18;
  const timeColWidthMm = 28;
  const colGutterMm = 6;
  const contentWidthMm = pageW - 2 * marginX;
  const labelColWidthMm = contentWidthMm - timeColWidthMm - colGutterMm;

  let page = pdf.addPage([mm(pageW), mm(pageH)]);

  async function drawPageHeader(p: typeof page, withTableHead = true): Promise<void> {
    const title = safe(input.couple_display_name);
    p.drawText(title, {
      x: mm(marginX),
      y: mm(pageH - marginTopHeader),
      size: 22,
      font: await pickFontAsync(fontPair, title, "bold"),
      color: rgb(0.06, 0.09, 0.19),
    });
    if (input.wedding_date) {
      const date = safe(input.wedding_date);
      p.drawText(date, {
        x: mm(marginX),
        y: mm(pageH - marginTopHeader - 7),
        size: 11,
        font: await pickFontAsync(fontPair, date, "regular"),
        color: rgb(0.27, 0.33, 0.48),
      });
    }
    const subhead = "Időbeosztás / Run of show";
    p.drawText(subhead, {
      x: mm(pageW - marginX - 60),
      y: mm(pageH - marginTopHeader),
      size: 11,
      font: await pickFontAsync(fontPair, subhead, "regular"),
      color: rgb(0.27, 0.33, 0.48),
    });

    if (withTableHead) {
      // Column headings + separator just above the first row.
      const headY_mm = pageH - marginTopHeader - 18;
      const timeHead = "Idő / Time";
      p.drawText(timeHead, {
        x: mm(marginX),
        y: mm(headY_mm),
        size: 9,
        font: await pickFontAsync(fontPair, timeHead, "bold"),
        color: rgb(0.4, 0.45, 0.6),
      });
      const labelHead = "Esemény / Event";
      p.drawText(labelHead, {
        x: mm(marginX + timeColWidthMm + colGutterMm),
        y: mm(headY_mm),
        size: 9,
        font: await pickFontAsync(fontPair, labelHead, "bold"),
        color: rgb(0.4, 0.45, 0.6),
      });
      p.drawRectangle({
        x: mm(marginX),
        y: mm(headY_mm - 2),
        width: mm(contentWidthMm),
        height: 0.6,
        color: rgb(0.7, 0.75, 0.85),
      });
    }
  }

  await drawPageHeader(page);

  if (input.events.length === 0) {
    const note = "Nincs még esemény / No events yet.";
    page.drawText(safe(note), {
      x: mm(marginX),
      y: mm(pageH - marginTopHeader - 32),
      size: 12,
      font: await pickFontAsync(fontPair, note, "regular"),
      color: rgb(0.4, 0.45, 0.6),
    });
    return pdf.save();
  }

  // First row starts just below the column heads. Each row's "top" is the
  // y-coord (in mm) of the row's first baseline; we move downward as we
  // draw and break to a new page when we'd cross marginBottom.
  let cursorTopMm = pageH - marginTopHeader - headerHeightMm + 8;

  for (let i = 0; i < input.events.length; i++) {
    const ev = input.events[i]!;
    // Build the right-column wrapped lines first so we know how tall this
    // row will be before deciding whether it fits on the current page.
    const timeText = ev.duration_minutes
      ? `${formatHhmm(ev.starts_at_minutes)}–${formatHhmm(
          Math.min(1439, ev.starts_at_minutes + ev.duration_minutes),
        )}`
      : formatHhmm(ev.starts_at_minutes);
    const labelWrap = await wrapLines(fontPair, ev.label, 12, mm(labelColWidthMm), 2, "bold");
    const subBits: string[] = [];
    if (ev.location) subBits.push(ev.location);
    if (ev.notes) subBits.push(ev.notes);
    const subWrap = await wrapLines(
      fontPair,
      subBits.join(" — "),
      9,
      mm(labelColWidthMm),
      3,
      "regular",
    );

    const labelLineH = 5.5; // mm per line at 12pt
    const subLineH = 4.2; // mm per line at 9pt
    const rowHeightMm =
      Math.max(labelLineH * Math.max(1, labelWrap.lines.length), 6) +
      subLineH * subWrap.lines.length +
      4; // padding between rows

    if (cursorTopMm - rowHeightMm < marginBottom) {
      page = pdf.addPage([mm(pageW), mm(pageH)]);
      await drawPageHeader(page);
      cursorTopMm = pageH - marginTopHeader - headerHeightMm + 8;
    }

    // Time column — single line.
    const safeTime = safe(timeText);
    page.drawText(safeTime, {
      x: mm(marginX),
      y: mm(cursorTopMm),
      size: 12,
      font: await pickFontAsync(fontPair, safeTime, "bold"),
      color: rgb(0.06, 0.09, 0.19),
    });

    // Label column — wrapped, multiple lines if needed.
    let lineY = cursorTopMm;
    for (const line of labelWrap.lines) {
      page.drawText(line, {
        x: mm(marginX + timeColWidthMm + colGutterMm),
        y: mm(lineY),
        size: 12,
        font: labelWrap.font,
        color: rgb(0.06, 0.09, 0.19),
      });
      lineY -= labelLineH;
    }
    for (const line of subWrap.lines) {
      page.drawText(line, {
        x: mm(marginX + timeColWidthMm + colGutterMm),
        y: mm(lineY),
        size: 9,
        font: subWrap.font,
        color: rgb(0.34, 0.4, 0.55),
      });
      lineY -= subLineH;
    }

    cursorTopMm -= rowHeightMm;
  }

  return pdf.save();
}
