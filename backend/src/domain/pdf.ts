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
import {
  type CoupleDesign,
  type FontFamilySlug,
  type FontPresetSlug,
  formatWeddingDate,
  getPalette,
  getStylePreset,
} from "@shared/design";
import type { ScheduleEvent } from "@shared/schedule";
import { chairOffsets, tableHalfDims } from "@shared/seating";
import type { Guest, MenuCard, SeatAssignment, SeatingTable } from "@shared/types";
import type { PrintableCardDocument } from "@shared/print_cards";

const FONT_DIR = join(import.meta.dir, "pdf_fonts");
const NOTO_REGULAR = readFileSync(join(FONT_DIR, "NotoSans-Regular.ttf"));
const NOTO_BOLD = readFileSync(join(FONT_DIR, "NotoSans-Bold.ttf"));
const NOTO_SC = readFileSync(join(FONT_DIR, "NotoSansSC-Regular.otf"));

// fontkit's layout() picks a ligature/contextual-alternate glyph per its own
// shaping rules, but CustomFontEmbedder.widthOfTextAtSize sums each glyph's
// standalone advanceWidth (pdf-lib@1.17.1) rather than the shaped run's
// actual positions. For most substitutions the two agree; for CormorantGaramond
// -Italic's "ta" contextual alternate they don't, and the mismatch is only
// visible once pdf-lib bakes the (wrong) width into the printed PDF's glyph
// spacing — "asztal" rendered as "aszt   al" on every card in that pack.
// Ligatures buy a print name card nothing; disabling them removes the whole
// bug class rather than special-casing one pack's one word pair.
const NO_LIGATURE_FEATURES = {
  liga: false,
  calt: false,
  dlig: false,
  clig: false,
  hlig: false,
} as const;

// Style-pack display fonts. Cormorant Garamond, Cormorant SC and EB Garamond
// use the official static OTF builds and MUST be embedded whole. fontkit 1.1.1
// corrupts their CFF subset (text operators remain but most outlines vanish),
// while the full OTF is valid in Poppler, Preview and Acrobat. The other static
// TrueType faces subset correctly and stay small.
const readFont = (f: string) => readFileSync(join(FONT_DIR, f));
interface PdfFontFile {
  bytes: Buffer;
  subset: boolean;
}
const subsetFont = (file: string): PdfFontFile => ({ bytes: readFont(file), subset: true });
const fullFont = (file: string): PdfFontFile => ({ bytes: readFont(file), subset: false });
const PACK_FONT_FILES: Partial<
  Record<FontPresetSlug, { heading: PdfFontFile; body: PdfFontFile }>
> = {
  garden_serif: {
    heading: fullFont("CormorantGaramond-Italic.otf"),
    body: subsetFont("Jost-Light.ttf"),
  },
  mono_sans: { heading: subsetFont("DMSans-Bold.ttf"), body: subsetFont("DMSans-Regular.ttf") },
  blush_bodoni: {
    heading: subsetFont("BodoniModa-SemiBold.ttf"),
    body: subsetFont("CrimsonText-Regular.ttf"),
  },
  noir_smallcaps: {
    heading: fullFont("CormorantSC-SemiBold.otf"),
    body: fullFont("EBGaramond-Regular.otf"),
  },
};

const FAMILY_FONT_FILES: Partial<Record<FontFamilySlug, PdfFontFile>> = {
  cormorant: fullFont("CormorantGaramond-Italic.otf"),
  cormorant_italic: fullFont("CormorantGaramond-Italic.otf"),
  dm_sans: subsetFont("DMSans-Regular.ttf"),
  jost: subsetFont("Jost-Light.ttf"),
  bodoni_moda: subsetFont("BodoniModa-Regular.ttf"),
  crimson_text: subsetFont("CrimsonText-Regular.ttf"),
  cormorant_sc: fullFont("CormorantSC-SemiBold.otf"),
  eb_garamond: fullFont("EBGaramond-Regular.otf"),
};

/** True when every codepoint is inside the Latin / Latin-Extended blocks the
 *  pack fonts cover (Basic Latin, Latin-1, Latin Ext-A/B, punctuation). A name
 *  with any other script must fall back to Noto so it doesn't render as tofu. */
function isLatinSafe(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const ok =
      cp <= 0x024f || // Basic Latin + Latin-1 + Latin Ext-A/B
      (cp >= 0x2000 && cp <= 0x206f) || // General Punctuation (en/em dash, quotes, ·)
      cp === 0x20ac || // €
      (cp >= 0x2c60 && cp <= 0x2c7f); // Latin Extended-C
    if (!ok) return false;
  }
  return true;
}

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
  a5: { width_mm: 148, height_mm: 210 },
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
  /** The active style pack's heading + body display faces, embedded when the
   *  pack bundles them (the four new packs). Null on legacy presets, where the
   *  card falls back to Noto so it still renders cleanly. */
  packHeading?: PDFFont;
  packBody?: PDFFont;
}

async function pickFontAsync(
  pair: FontPair,
  text: string,
  prefer: "regular" | "bold",
): Promise<PDFFont> {
  if (containsCjk(text)) return pair.getCjk();
  return prefer === "bold" ? pair.bold : pair.regular;
}

/** Pick the pack's DISPLAY face (heading or body) for text that carries the
 *  card's typographic identity — couple name, table number, menu title, dates.
 *  Falls back to the robust Noto/CJK path when the pack ships no display face
 *  (legacy presets) or the text leaves the Latin range the pack covers. */
async function pickDisplayAsync(
  pair: FontPair,
  text: string,
  role: "heading" | "body",
): Promise<PDFFont> {
  if (containsCjk(text)) return pair.getCjk();
  const face = role === "heading" ? pair.packHeading : pair.packBody;
  if (face && isLatinSafe(text)) return face;
  // No pack face (or non-Latin text): headings read as bold Noto, body regular.
  return role === "heading" ? pair.bold : pair.regular;
}

/** Wrap display text using the exact embedded face that will be drawn. The
 *  size is reduced until the requested line budget fits, but characters are
 *  never truncated. An unbroken long token is split at glyph boundaries.
 *
 *  `maxLines` is a fitting target, not a destructive cap: if text still needs
 *  more rows at the minimum readable size, every row is returned. Callers must
 *  then paginate or reserve the measured height. Printed stationery may grow
 *  to another page; it must never silently lose something the couple typed. */
async function wrapDisplayText(
  pair: FontPair,
  text: string,
  role: "heading" | "body",
  startSize: number,
  minSize: number,
  maxWidthPt: number,
  maxLines: number,
  fontOverride?: PDFFont,
): Promise<{ font: PDFFont; lines: string[]; size: number }> {
  const value = safe(text);
  const font = fontOverride ?? (await pickDisplayAsync(pair, value, role));
  const wrapAtSize = (size: number): string[] => {
    const lines: string[] = [];
    let line = "";
    for (const word of value.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidthPt) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      if (font.widthOfTextAtSize(word, size) <= maxWidthPt) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const glyph of Array.from(word)) {
        if (chunk && font.widthOfTextAtSize(`${chunk}${glyph}`, size) > maxWidthPt) {
          lines.push(chunk);
          chunk = glyph;
        } else {
          chunk += glyph;
        }
      }
      line = chunk;
    }
    if (line) lines.push(line);
    return lines;
  };

  let size = startSize;
  let lines = wrapAtSize(size);
  while (lines.length > maxLines && size > minSize) {
    size = Math.max(minSize, size - 0.5);
    lines = wrapAtSize(size);
  }
  return { font, lines, size };
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
 *  real-world grid against.
 *
 *  Coordinate convention: editor Y grows DOWN (top = 0); PDF Y grows UP.
 *  We invert Y at layout time so the page reads right-side-up.
 *    page_x = (real_x - planMinX) * scale + offsetX
 *    page_y = topPdfY            - (real_y - planMinY) * scale
 *  `offsetY` stores topPdfY, i.e. the PDF y-coordinate of the top of the
 *  plan box (where the editor's planMinY lives). */
interface PlanTransform {
  /** Page-mm per real-world-mm. */
  scale: number;
  /** PDF x-coordinate of the LEFT edge of the plan box (planMinX maps here). */
  offsetX: number;
  /** PDF y-coordinate of the TOP edge of the plan box (planMinY maps here). */
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

/** Axis-aligned half-extents of a table's ROTATED footprint. The body spans
 *  ±rx / ±ry in its own frame; turning it by rotation_deg sweeps that box
 *  into a larger axis-aligned bbox (|cos|·rx + |sin|·ry per axis). Round
 *  tables are rotation-invariant. Used only for page-fit bboxes — the drawn
 *  body keeps its unrotated half-dims and is rotated at draw time. At 0° this
 *  returns exactly `tableHalfDims` (cos 0 = 1, sin 0 = 0), so unrotated
 *  layouts are unchanged. */
function tableBboxHalfDims(t: SeatingTable): { rx: number; ry: number } {
  const { rx, ry } = tableHalfDims(t);
  if (t.shape === "round") return { rx, ry };
  const rad = (t.rotation_deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { rx: rx * c + ry * s, ry: rx * s + ry * c };
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

  // Plan area lives below the title strip at the top of the page. In PDF
  // coords (Y-up) that means: top edge sits at pageH - margin - headerH,
  // bottom edge sits at margin.
  const planTopY = pageH_mm - margin - headerH;
  const planBottomY = margin;
  const availW = pageW_mm - 2 * margin;
  const availH = planTopY - planBottomY;

  if (room && useUserPos) {
    // Render the actual room rectangle so empty floor space is preserved.
    const planW = Math.max(1, room.width_mm);
    const planH = Math.max(1, room.height_mm);
    const scale = Math.min(availW / planW, availH / planH);
    const offsetX = margin + (availW - planW * scale) / 2;
    // offsetY = PDF y of the TOP of the plan; editor row 0 lands here.
    const offsetY = planTopY - (availH - planH * scale) / 2;
    for (const t of tables) {
      const { rx, ry } = tableHalfDims(t);
      out.set(t.id, {
        x_mm: t.x_mm * scale + offsetX,
        // Y-flip: editor y grows DOWN, PDF y grows UP. Subtract.
        y_mm: offsetY - t.y_mm * scale,
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
      const { rx, ry } = tableBboxHalfDims(t);
      minX = Math.min(minX, t.x_mm - rx);
      minY = Math.min(minY, t.y_mm - ry);
      maxX = Math.max(maxX, t.x_mm + rx);
      maxY = Math.max(maxY, t.y_mm + ry);
    }
    const planW = Math.max(1, maxX - minX);
    const planH = Math.max(1, maxY - minY);
    const scale = Math.min(1, availW / planW, availH / planH);
    const offsetX = margin + (availW - planW * scale) / 2 - minX * scale;
    const offsetY = planTopY - (availH - planH * scale) / 2 + minY * scale;
    for (const t of tables) {
      const { rx, ry } = tableHalfDims(t);
      out.set(t.id, {
        x_mm: t.x_mm * scale + offsetX,
        y_mm: offsetY - t.y_mm * scale,
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

  // Auto grid — fit a circle of radius cell*0.35 into each cell. Row 0 sits
  // at the TOP of the plan area in PDF coords (Y-up).
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const rows = Math.max(1, Math.ceil(tables.length / cols));
  const cellW = availW / cols;
  const cellH = availH / rows;
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
      y_mm: planTopY - cellH * (r + 0.5),
      rx_mm: rx * fit,
      ry_mm: ry * fit,
    });
  }
  return { tableLayouts: out, transform: null };
}

/** Subtle 1-metre planning grid behind the tables. Lines are spaced at
 *  GRID_STEP_MM in real-world coords, mapped through `transform` to PDF
 *  points via the Y-flipped projection (editor y-down → PDF y-up).
 *
 *  Earlier drafts used a 50-cm chunky dashed grid in mid-beige; that read
 *  fine on screen but DOMINATED the print, fighting the tables for
 *  attention. The new grid is a 1 m hairline in a soft paper tone — a
 *  ruler hint, not a focal element. */
const GRID_STEP_MM = 1000;
function drawPlanGrid(
  page: PDFPage,
  transform: PlanTransform,
  _pageW_mm: number,
  _pageH_mm: number,
): void {
  const { scale, offsetX, offsetY, planMinX, planMinY, planMaxX, planMaxY } = transform;
  // Snap to the nearest grid line at or beyond the bounding box so the
  // grid visibly extends past every table edge.
  const startX = Math.ceil(planMinX / GRID_STEP_MM) * GRID_STEP_MM;
  const endX = Math.floor(planMaxX / GRID_STEP_MM) * GRID_STEP_MM;
  const startY = Math.ceil(planMinY / GRID_STEP_MM) * GRID_STEP_MM;
  const endY = Math.floor(planMaxY / GRID_STEP_MM) * GRID_STEP_MM;
  const xPt = (xMm: number): number => mm(xMm * scale + offsetX);
  // Y-up flip: editor y grows DOWN; PDF y grows UP from the bottom.
  const yPt = (yMm: number): number => mm(offsetY - (yMm - planMinY) * scale);
  // paper-300 (#e3d9bf) — barely-there hairline. 0.25 pt = the thinnest
  // stroke that still prints cleanly on a 600 dpi laser.
  const colour = rgb(0.89, 0.85, 0.75);
  const thickness = 0.25;
  for (let x = startX; x <= endX; x += GRID_STEP_MM) {
    page.drawLine({
      start: { x: xPt(x), y: yPt(planMinY) },
      end: { x: xPt(x), y: yPt(planMaxY) },
      thickness,
      color: colour,
    });
  }
  for (let y = startY; y <= endY; y += GRID_STEP_MM) {
    page.drawLine({
      start: { x: xPt(planMinX), y: yPt(y) },
      end: { x: xPt(planMaxX), y: yPt(y) },
      thickness,
      color: colour,
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
      const { rx, ry } = tableBboxHalfDims(t);
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
  const helv = await pdf.embedFont(NOTO_REGULAR, { subset: true, features: NO_LIGATURE_FEATURES });
  const helvBold = await pdf.embedFont(NOTO_BOLD, { subset: true, features: NO_LIGATURE_FEATURES });
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
      cjkFont = await pdf.embedFont(NOTO_SC, { features: NO_LIGATURE_FEATURES });
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

  // Hairline 1 m planning grid behind the tables — a ruler hint, not a
  // focal element. Only drawn when the user actually placed the tables;
  // auto-flow's cell-fitted shapes don't share a single real-world scale.
  if (transform) {
    drawPlanGrid(page, transform, width_mm, height_mm);
    // Room boundary — soft ink frame around the venue rectangle. Y-up:
    // transform.offsetY is the TOP edge; bottom = offsetY - roomH * scale.
    if (useRoom) {
      const xLeft = mm(transform.offsetX);
      const xRight = mm(transform.offsetX + roomW * transform.scale);
      const yTop = mm(transform.offsetY);
      const yBot = mm(transform.offsetY - roomH * transform.scale);
      const frame = rgb(0.27, 0.33, 0.48); // ink-500 — softer than the table strokes
      const thick = 0.6;
      page.drawLine({
        start: { x: xLeft, y: yTop },
        end: { x: xRight, y: yTop },
        thickness: thick,
        color: frame,
      });
      page.drawLine({
        start: { x: xRight, y: yTop },
        end: { x: xRight, y: yBot },
        thickness: thick,
        color: frame,
      });
      page.drawLine({
        start: { x: xRight, y: yBot },
        end: { x: xLeft, y: yBot },
        thickness: thick,
        color: frame,
      });
      page.drawLine({
        start: { x: xLeft, y: yBot },
        end: { x: xLeft, y: yTop },
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

  // Brand palette — keep these in lockstep with the SVG editor so the
  // print mirrors what the couple sees. Hex sources:
  // ink-700 #243150, ink-800 #1a2440, paper-50 #fbfaf5, paper-300 #e3d9bf,
  // blush-300 #eda997, blush-700 #9d3b27.
  const INK_700 = rgb(0.141, 0.192, 0.314);
  const INK_800 = rgb(0.102, 0.141, 0.251);
  const PAPER_50 = rgb(0.984, 0.98, 0.961);
  const PAPER_300 = rgb(0.89, 0.85, 0.75);
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
  const chairTooSmallForGlyph = chairHpt < 5; // sub-5pt chairs can't carry a digit

  for (const t of input.tables) {
    const pos = positions.get(t.id);
    if (!pos) continue;
    const cx = mm(pos.x_mm);
    const cy = mm(pos.y_mm);
    const rx = mm(pos.rx_mm);
    const ry = mm(pos.ry_mm);

    // Table rotation — mirrors the canvas, which rotates the whole table
    // group (body + chairs + seat numbers) around the centre (cx, cy) by
    // rotation_deg, clockwise on screen (SVG Y-down `rotate()`). Same recipe
    // here: rotate table-local offsets in the SVG frame FIRST, then Y-flip
    // into PDF coords. On paper (Y-up) a clockwise-on-screen turn is a
    // NEGATIVE pdf-lib angle, hence the sign flips below. Text (table label,
    // seat numbers, guest names) stays upright, matching the canvas'
    // counter-rotation of text nodes.
    const rot = ((t.rotation_deg % 360) + 360) % 360;
    const cosT = Math.cos((rot * Math.PI) / 180);
    const sinT = Math.sin((rot * Math.PI) / 180);
    /** Rotate a table-local (Y-down, SVG-convention) offset by the table
     *  rotation. Caller Y-flips the result into PDF coords. At 0° this is
     *  the identity, so unrotated tables draw exactly as before. */
    const rotSvg = (dx: number, dy: number): { dx: number; dy: number } => ({
      dx: dx * cosT - dy * sinT,
      dy: dx * sinT + dy * cosT,
    });

    const borderW = 1;
    if (t.shape === "round") {
      // A circle is rotation-invariant — only its chair ring turns (below).
      page.drawCircle({
        x: cx,
        y: cy,
        size: rx,
        borderWidth: borderW,
        borderColor: INK_800,
        color: PAPER_50,
      });
    } else if (rot === 0) {
      page.drawRectangle({
        x: cx - rx,
        y: cy - ry,
        width: rx * 2,
        height: ry * 2,
        borderWidth: borderW,
        borderColor: INK_800,
        color: PAPER_50,
      });
    } else {
      // pdf-lib rotates around the rect's OWN (x, y) anchor — its bottom-left
      // corner — not the centre. Pre-rotate the centre→corner offset
      // (-rx, -ry) by the PDF angle and anchor the rect there, so the visual
      // pivot is the table centre. Same trick as the chairs below.
      const rad = (-rot * Math.PI) / 180; // PDF Y-up: clockwise-on-paper = negative
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      page.drawRectangle({
        x: cx - rx * cosR + ry * sinR,
        y: cy - rx * sinR - ry * cosR,
        width: rx * 2,
        height: ry * 2,
        rotate: degrees(-rot),
        borderWidth: borderW,
        borderColor: INK_800,
        color: PAPER_50,
      });
    }

    // Chairs — blush rounded rectangles tangent to the perimeter, matching
    // the SVG editor. The chair's CENTRE sits CHAIR_GAP_MM outside the
    // edge, with its long axis along the table edge.
    //
    // Y is flipped vs. the editor: chairOffsets returns (dx, dy) in the
    // SVG Y-down convention, but PDF Y grows UP. We negate dy for the
    // position AND the rotation so chairs land where the user placed them
    // and orient outwards correctly.
    //
    // Outward push direction: use the chair's `angle` field (which encodes
    // the edge-perpendicular direction) rather than normalising (dx, dy).
    // For rectangular tables this matters — a chair on the top edge
    // pushes straight UP regardless of where along the edge it sits.
    const chairs = chairOffsets(t.shape, t.seats, rx, ry);
    const seats = (seatsByTable.get(t.id) ?? []).sort((a, b) => a.seat_index - b.seat_index);
    const seatByIndex = new Map(seats.map((a) => [a.seat_index, a]));
    const disabledSet = new Set(t.disabled_seats ?? []);
    for (let i = 0; i < chairs.length; i++) {
      const c = chairs[i];
      if (!c) continue;
      const isDisabled = disabledSet.has(i);
      const isFilled = seatByIndex.has(i);
      const outX = Math.cos(c.angle);
      const outY_svg = Math.sin(c.angle); // SVG Y-down
      const pushPt = chairHpt / 2 + chairGapPt;
      // Table-local chair centre in the SVG frame, turned by the table
      // rotation, then Y-flipped: editor dy flips sign in PDF coords.
      const local = rotSvg(c.dx + outX * pushPt, c.dy + outY_svg * pushPt);
      const px = cx + local.dx;
      const py = cy - local.dy;
      // Chair orientation: edge-perpendicular angle PLUS the table rotation,
      // negated as a block for PDF's Y-up (counterclockwise-positive) frame.
      const rotDeg = -((c.angle * 180) / Math.PI + 90 + rot);
      const rad = (rotDeg * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      const blX = px - (chairWpt / 2) * cosR + (chairHpt / 2) * sinR;
      const blY = py - (chairWpt / 2) * sinR - (chairHpt / 2) * cosR;
      const fill = isDisabled ? PAPER_300 : isFilled ? INK_800 : BLUSH_300;
      page.drawRectangle({
        x: blX,
        y: blY,
        width: chairWpt,
        height: chairHpt,
        rotate: degrees(rotDeg),
        color: fill,
      });
      // Seat number on the chair — same as the SVG editor. Skipped when
      // the chair is sub-5pt tall (the digit wouldn't read at print scale).
      if (!isDisabled && !chairTooSmallForGlyph) {
        const num = String(i + 1);
        const numSize = Math.max(5, chairHpt * 0.6);
        const numW = helvBold.widthOfTextAtSize(num, numSize);
        page.drawText(num, {
          x: px - numW / 2,
          y: py - numSize * 0.35,
          size: numSize,
          font: helvBold,
          color: isFilled ? PAPER_50 : INK_700,
        });
      }
    }

    // Guest names just outside each filled chair. Push past the chair's
    // outer edge AND past half its tangential width — for chairs sitting
    // at table corners (e.g. round seat 3 at 45°) the chair is rotated,
    // so its tangential footprint sweeps into the horizontal text region.
    // Without the extra chairWpt/2 buffer, dark "Á" characters would land
    // on a dark filled chair and disappear.
    for (const a of seats) {
      const c = chairs[a.seat_index];
      if (!c) continue;
      const guest = guestById.get(a.guest_id);
      if (!guest) continue;
      const outX = Math.cos(c.angle);
      const outY_svg = Math.sin(c.angle);
      const namePush = chairHpt + chairGapPt + chairWpt / 2 + 4;
      // Position follows the rotated chair; the text itself stays upright
      // (horizontal), matching the canvas' counter-rotated labels.
      const local = rotSvg(c.dx + outX * namePush, c.dy + outY_svg * namePush);
      const px = cx + local.dx;
      const py = cy - local.dy;
      const guestFit = await fitText(fontPair, guest.full_name, 7, mm(28));
      const w = guestFit.font.widthOfTextAtSize(guestFit.text, 7);
      page.drawText(guestFit.text, {
        x: px - w / 2,
        y: py - 2.5,
        size: 7,
        font: guestFit.font,
        color: INK_800,
      });
    }

    // Table label — blush text centred inside the table. Sizing rules:
    //   - Width: long/head tables size against the LONG axis (~85% of
    //     length). Round/square get 2.4× the short axis, i.e. roughly
    //     diameter + chair-gap, so a "Table 5" fits even when the round
    //     is small on the page.
    //   - Height: tied to the SHORT axis so a single line still fits
    //     inside the table footprint. Capped at 14pt — earlier 22pt cap
    //     overpowered the layout on big tables; 14pt gives a calmer,
    //     stationery-style hierarchy alongside the chairs.
    //   - Floor: 10pt is the print-legibility floor. Below that, the
    //     label visually overlaps chair gaps at extreme room scales —
    //     acceptable tradeoff for keeping names readable.
    const isElongated = t.shape === "long" || t.shape === "head";
    const shortDim = Math.min(rx, ry);
    const longDim = Math.max(rx, ry);
    const widthBudget = isElongated ? longDim * 1.7 : shortDim * 2.4;
    const labelSize = Math.max(10, Math.min(14, shortDim * 0.65));
    const labelFit = await fitText(fontPair, t.label, labelSize, widthBudget, "bold");
    const labelW = labelFit.font.widthOfTextAtSize(labelFit.text, labelSize);
    page.drawText(labelFit.text, {
      x: cx - labelW / 2,
      y: cy - labelSize * 0.32,
      size: labelSize,
      font: labelFit.font,
      color: BLUSH_700,
    });
  }

  return pdf.save();
}

/** Resolve a design's palette into the rgb() colours the PDF toolkit wants.
 *  The shared catalog already normalises hex → rgb 0..1, which is exactly the
 *  shape pdf-lib's `rgb()` consumes, so this is a thin adapter. */
function designColors(design: CoupleDesign): {
  primary: ReturnType<typeof rgb>;
  background: ReturnType<typeof rgb>;
  accent: ReturnType<typeof rgb>;
  text: ReturnType<typeof rgb>;
} {
  const p = getPalette(design.palette);
  return {
    primary: rgb(...p.primary.rgb),
    background: rgb(...p.background.rgb),
    accent: rgb(...p.accent.rgb),
    text: rgb(...p.text.rgb),
  };
}

interface PlaceCardInput {
  couple_display_name: string;
  wedding_date: string | null;
  /** Partner names - used to build the monogram via the shared catalog. */
  bride_name: string;
  groom_name: string;
  /** Resolved visual identity. Drives palette, monogram, border. */
  design: CoupleDesign;
  guests: Array<Pick<Guest, "id" | "full_name">>;
  /** When provided, prints the table label below the guest name. */
  tablesByGuestId?: Map<number, string>;
}

/** 100×50mm place cards laid out 2×5 on an A4 sheet (10 per page).
 *  At 50mm tall there's no room for the couple footer the larger A6 card
 *  carried — name + table label only. */
export async function renderPlaceCardsPdf(input: PlaceCardInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fontPair = await buildFontPair(pdf, input.design);
  const { regular: helv } = fontPair;
  // Resolved visual identity - palette colours, border, pack ornament + layout.
  const colors = designColors(input.design);
  const pack = getStylePreset(input.design.style);

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
      const box = { x: x_mm0, y: y_mm0_top, w: cardW, h: cardH };
      const cxPt = mm(x_mm0 + cardW / 2);

      // Card background + frame per the borderStyle enum, then the pack's frame
      // ornament (oval for Blush, deco corners for Midnight).
      drawCardFrame(page, box, input.design, colors);
      if (pack.cardLayout === "framed") drawOvalFrame(page, box, colors.accent);
      if (pack.cardLayout === "corners") drawDecoCorners(page, box, colors.accent);

      const name = headingText(safe(g.full_name), input.design);
      const nameLayout = await wrapDisplayText(
        fontPair,
        name,
        "heading",
        name.length > 22 ? 13 : 17,
        7,
        mm(cardW - 16),
        3,
        // Very long display-face runs exposed a CFF/ToUnicode edge at a
        // wrapped line boundary (the leading glyph could disappear in print).
        // Noto is still fully embedded and is the lossless fallback used for
        // every non-Latin name as well.
        name.length > 60 ? fontPair.bold : undefined,
      );
      const nameLineMm = (nameLayout.size * 1.18) / MM_TO_PT;
      const tableLabel = input.tablesByGuestId?.get(g.id);

      const drawName = (centreYmm: number, leftAligned: boolean) => {
        const firstBaseline = centreYmm + ((nameLayout.lines.length - 1) * nameLineMm) / 2;
        for (const [lineIndex, line] of nameLayout.lines.entries()) {
          const width = nameLayout.font.widthOfTextAtSize(line, nameLayout.size);
          page.drawText(line, {
            x: leftAligned ? mm(x_mm0 + 8) : cxPt - width / 2,
            y: mm(firstBaseline - lineIndex * nameLineMm),
            size: nameLayout.size,
            font: nameLayout.font,
            color: colors.text,
            ...headingDrawOptions(input.design),
          });
        }
      };

      const tableLayout = tableLabel
        ? await wrapDisplayText(fontPair, tableLabel, "body", 9.5, 5.5, mm(cardW - 16), 2)
        : null;
      const tableLineMm = tableLayout ? (tableLayout.size * 1.2) / MM_TO_PT : 0;
      const drawTableLabel = (centreYmm: number, rightAligned: boolean) => {
        if (!tableLayout) return;
        const firstBaseline = centreYmm + ((tableLayout.lines.length - 1) * tableLineMm) / 2;
        for (const [lineIndex, line] of tableLayout.lines.entries()) {
          const width = tableLayout.font.widthOfTextAtSize(line, tableLayout.size);
          page.drawText(line, {
            x: rightAligned ? mm(x_mm0 + cardW - 8) - width : cxPt - width / 2,
            y: mm(firstBaseline - lineIndex * tableLineMm),
            size: tableLayout.size,
            font: tableLayout.font,
            color: colors.primary,
          });
        }
      };

      if (pack.cardLayout === "asymmetric") {
        // Monochrome: name left-rag, table label pinned top-right. No centre axis.
        drawName(y_mm0_top + cardH * 0.4, true);
        drawTableLabel(y_mm0_top + cardH - 12, true);
      } else if (tableLabel) {
        // Garden / Blush / Midnight: centred name, ornament, label below.
        drawName(y_mm0_top + cardH * 0.6, false);
        // Garden's botanical sprig sits between the name and the table label.
        if (input.design.print.ornament && pack.cardLayout === "centered") {
          drawOrnament(page, pack.ornament, cxPt, mm(y_mm0_top + cardH * 0.46), 28, colors.accent);
        }
        drawTableLabel(y_mm0_top + cardH * 0.22, false);
      } else {
        // No table label yet: nothing to divide, so the name alone sits at
        // true centre. Drawing the ornament anyway used to land it almost
        // exactly on the name's own baseline (both landed within 1mm of each
        // other), overlapping the name's descenders on every guest whose
        // name has one ("Nagy", "Varga", "Márton"…).
        drawName(y_mm0_top + cardH / 2, false);
      }
    }
  }
  return pdf.save();
}

/** Shared font-pair builder for the single-card design templates. Embeds the
 *  Noto Sans subset + a lazy CJK fallback, plus — when `design` selects one of
 *  the four packs — that pack's heading + body display faces, so the printed
 *  card speaks the same typographic language as the guest page. */
async function buildFontPair(pdf: PDFDocument, design?: CoupleDesign): Promise<FontPair> {
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(NOTO_REGULAR, {
    subset: true,
    features: NO_LIGATURE_FEATURES,
  });
  const bold = await pdf.embedFont(NOTO_BOLD, { subset: true, features: NO_LIGATURE_FEATURES });
  let cjkFont: PDFFont | null = null;
  const pack = design ? PACK_FONT_FILES[design.fonts] : undefined;
  const headingFile = design?.headingFont ? FAMILY_FONT_FILES[design.headingFont] : pack?.heading;
  const bodyFile = design?.bodyFont ? FAMILY_FONT_FILES[design.bodyFont] : pack?.body;
  const packHeading = headingFile
    ? await pdf.embedFont(headingFile.bytes, {
        subset: headingFile.subset,
        features: NO_LIGATURE_FEATURES,
      })
    : undefined;
  const packBody = bodyFile
    ? await pdf.embedFont(bodyFile.bytes, {
        subset: bodyFile.subset,
        features: NO_LIGATURE_FEATURES,
      })
    : undefined;
  return {
    regular,
    bold,
    packHeading,
    packBody,
    getCjk: async () => {
      if (cjkFont) return cjkFont;
      cjkFont = await pdf.embedFont(NOTO_SC, { features: NO_LIGATURE_FEATURES });
      return cjkFont;
    },
  };
}

/** Apply the only heading treatment that changes text content. The real
 *  Cormorant SC face handles small caps itself and the Garden face is italic. */
function headingText(text: string, design: CoupleDesign): string {
  const style = getStylePreset(design.style).headingStyle;
  return style === "uppercase" ? text.toUpperCase() : text;
}

/** Kept as a draw-options hook so every heading call stays uniform. Italic and
 *  small caps are real embedded faces; no synthetic transform is necessary. */
function headingDrawOptions(design: CoupleDesign): { ySkew?: ReturnType<typeof degrees> } {
  void design;
  return {};
}

/** Draw the card frame honouring the borderStyle enum (none / hairline / double
 *  / thick). The background always paints; the frame is an inset stroke (or two
 *  for "double"). Mirrors `getBorderCss` on the web so the two surfaces agree. */
function drawCardFrame(
  page: PDFPage,
  box: { x: number; y: number; w: number; h: number },
  design: CoupleDesign,
  colors: { background: ReturnType<typeof rgb>; accent: ReturnType<typeof rgb> },
): void {
  page.drawRectangle({
    x: mm(box.x),
    y: mm(box.y),
    width: mm(box.w),
    height: mm(box.h),
    color: colors.background,
  });
  const widths: Record<CoupleDesign["borderStyle"], number> = {
    none: 0,
    hairline: 0.5,
    double: 0.5,
    thick: 1.4,
  };
  const w = widths[design.borderStyle];
  if (w <= 0) return;
  page.drawRectangle({
    x: mm(box.x),
    y: mm(box.y),
    width: mm(box.w),
    height: mm(box.h),
    borderWidth: w,
    borderColor: colors.accent,
    color: undefined,
  });
  if (design.borderStyle === "double") {
    const inset = 1.4;
    page.drawRectangle({
      x: mm(box.x + inset),
      y: mm(box.y + inset),
      width: mm(box.w - 2 * inset),
      height: mm(box.h - 2 * inset),
      borderWidth: 0.5,
      borderColor: colors.accent,
      color: undefined,
    });
  }
}

/** Draw the pack's ornament motif, centred horizontally on `cxPt`, baseline at
 *  `yPt`, spanning roughly `widthMm`. The four ornament languages mirror the
 *  web `OrnamentDivider` so the card and the guest page read as one identity. */
function drawOrnament(
  page: PDFPage,
  ornament: ReturnType<typeof getStylePreset>["ornament"],
  cxPt: number,
  yPt: number,
  widthMm: number,
  color: ReturnType<typeof rgb>,
): void {
  const half = mm(widthMm / 2);
  if (ornament === "none") {
    page.drawLine({
      start: { x: cxPt - mm(8), y: yPt },
      end: { x: cxPt + mm(8), y: yPt },
      thickness: 1.4,
      color,
    });
    return;
  }
  if (ornament === "oval") {
    for (const dx of [-mm(5), 0, mm(5)]) {
      page.drawCircle({ x: cxPt + dx, y: yPt, size: 0.9, color });
    }
    return;
  }
  if (ornament === "deco") {
    // thin rule each side of a small open diamond
    page.drawLine({
      start: { x: cxPt - half, y: yPt },
      end: { x: cxPt - mm(4), y: yPt },
      thickness: 0.5,
      color,
    });
    page.drawLine({
      start: { x: cxPt + mm(4), y: yPt },
      end: { x: cxPt + half, y: yPt },
      thickness: 0.5,
      color,
    });
    const d = mm(1.8);
    page.drawLine({
      start: { x: cxPt, y: yPt + d },
      end: { x: cxPt + d, y: yPt },
      thickness: 0.6,
      color,
    });
    page.drawLine({
      start: { x: cxPt + d, y: yPt },
      end: { x: cxPt, y: yPt - d },
      thickness: 0.6,
      color,
    });
    page.drawLine({
      start: { x: cxPt, y: yPt - d },
      end: { x: cxPt - d, y: yPt },
      thickness: 0.6,
      color,
    });
    page.drawLine({
      start: { x: cxPt - d, y: yPt },
      end: { x: cxPt, y: yPt + d },
      thickness: 0.6,
      color,
    });
    return;
  }
  // botanical: a thin line with a few small leaves either side of centre.
  page.drawLine({
    start: { x: cxPt - half, y: yPt },
    end: { x: cxPt + half, y: yPt },
    thickness: 0.5,
    color,
  });
  for (const dx of [-mm(6), -mm(3.5), mm(3.5), mm(6)]) {
    page.drawEllipse({
      x: cxPt + dx,
      y: yPt + (dx < 0 ? mm(1) : -mm(1)),
      xScale: mm(1.8),
      yScale: mm(0.7),
      rotate: degrees(dx < 0 ? 28 : -28),
      color,
    });
  }
}

/** Four art-deco L-corner marks just inside the card box (the Midnight pack's
 *  "corners" layout). Each corner is two short strokes meeting at right-angle. */
function drawDecoCorners(
  page: PDFPage,
  box: { x: number; y: number; w: number; h: number },
  color: ReturnType<typeof rgb>,
): void {
  const inset = 4;
  const len = 6;
  const x0 = box.x + inset;
  const x1 = box.x + box.w - inset;
  const y0 = box.y + inset;
  const y1 = box.y + box.h - inset;
  const L = (ax: number, ay: number, bx: number, by: number) =>
    page.drawLine({
      start: { x: mm(ax), y: mm(ay) },
      end: { x: mm(bx), y: mm(by) },
      thickness: 0.7,
      color,
    });
  // top-left
  L(x0, y1, x0 + len, y1);
  L(x0, y1, x0, y1 - len);
  // top-right
  L(x1, y1, x1 - len, y1);
  L(x1, y1, x1, y1 - len);
  // bottom-left
  L(x0, y0, x0 + len, y0);
  L(x0, y0, x0, y0 + len);
  // bottom-right
  L(x1, y0, x1 - len, y0);
  L(x1, y0, x1, y0 + len);
}

/** Oval hairline frame inscribed in the card box (the Blush pack's "framed"
 *  layout). pdf-lib has no ellipse-stroke primitive that fits a rect exactly,
 *  so we draw a thin-stroked ellipse sized to the box with a small margin. */
function drawOvalFrame(
  page: PDFPage,
  box: { x: number; y: number; w: number; h: number },
  color: ReturnType<typeof rgb>,
): void {
  page.drawEllipse({
    x: mm(box.x + box.w / 2),
    y: mm(box.y + box.h / 2),
    xScale: mm(box.w / 2 - 5),
    yScale: mm(box.h / 2 - 4),
    borderWidth: 0.5,
    borderColor: color,
    color: undefined,
  });
}

interface TableNumbersInput {
  bride_name: string;
  groom_name: string;
  design: CoupleDesign;
  tables: Array<Pick<SeatingTable, "label"> & { footer?: string }>;
}

/** A6 table-number cards - one per seating table, a big centred label with a
 *  small monogram on top. Palette and border match the place cards so
 *  the two sit together as a set. One card per A6 page.
 *
 *  Landscape, not portrait: this is a fold-in-half tent card that stands on
 *  the table like the place cards beside it, and the couple-facing preview
 *  has always drawn it wide. A portrait A6 here read as upright stationery
 *  when it's meant to sit sideways in front of a centrepiece. */
export async function renderTableNumbersPdf(input: TableNumbersInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fontPair = await buildFontPair(pdf, input.design);
  const { regular: helv } = fontPair;
  const colors = designColors(input.design);
  const pack = getStylePreset(input.design.style);

  // A6 landscape = 148x105mm.
  const W = 148;
  const H = 105;

  if (input.tables.length === 0) {
    const page = pdf.addPage([mm(W), mm(H)]);
    page.drawText("No tables yet.", {
      x: mm(12),
      y: mm(H - 24),
      size: 14,
      font: helv,
      color: rgb(0.4, 0.4, 0.4),
    });
    return pdf.save();
  }

  const box = { x: 6, y: 6, w: W - 12, h: H - 12 };
  // Footer and ornament anchor the bottom of the card; the hero label centres
  // in whatever band is left above them, so a wrapped 2-3 line label (a table
  // can be named "Nagyszülők és keresztszülők", not just a number) never
  // reads as pushed to one edge the way a fixed offset tuned for one line did.
  const footerY = 14;
  const ornamentY = 25;
  const heroBandBottom = ornamentY + 8;
  const heroBandTop = H - 12;
  for (const t of input.tables) {
    const page = pdf.addPage([mm(W), mm(H)]);
    const cxPt = mm(W / 2);

    // Background + frame per borderStyle, then the pack's frame ornament.
    drawCardFrame(page, box, input.design, colors);
    if (pack.cardLayout === "framed") drawOvalFrame(page, box, colors.accent);
    if (pack.cardLayout === "corners") drawDecoCorners(page, box, colors.accent);

    // The label is the hero. A table is often called something longer than a
    // number ("Nagyszülők és keresztszülők"), so fit it as a centred block.
    // The former non-Latin branch truncated at 64pt *before* trying a smaller
    // size, which made edited Greek/Cyrillic labels end in an ellipsis.
    const label = headingText(t.label, input.design);
    const hero = await wrapDisplayText(
      fontPair,
      label,
      "heading",
      56,
      14,
      mm(W - 32),
      3,
      label.length > 60 ? fontPair.bold : undefined,
    );
    const heroLineMm = (hero.size * 1.12) / MM_TO_PT;
    // A baseline centred on the band still reads top-heavy: a cap-height
    // serif sits almost entirely above its baseline, so the "empty" space
    // below (baseline down to the ornament) looks bigger than the space
    // above even though the two are numerically equal. Nudge down by a
    // fraction of the font size, same idiom as the single-line portrait
    // layout this replaced.
    const heroCentreY = (heroBandBottom + heroBandTop) / 2 - hero.size * 0.14;
    const firstBaseline = heroCentreY + ((hero.lines.length - 1) * heroLineMm) / 2;
    for (const [lineIndex, line] of hero.lines.entries()) {
      const width = hero.font.widthOfTextAtSize(line, hero.size);
      page.drawText(line, {
        x: cxPt - width / 2,
        y: mm(firstBaseline - lineIndex * heroLineMm),
        size: hero.size,
        font: hero.font,
        color: colors.text,
        ...headingDrawOptions(input.design),
      });
    }
    // Pack ornament divider under the number (centred packs), gated by toggle.
    if (input.design.print.ornament && pack.cardLayout !== "asymmetric") {
      drawOrnament(page, pack.ornament, cxPt, mm(ornamentY), 36, colors.accent);
    }
    if (t.footer) {
      const footer = safe(t.footer);
      const footerFont = await pickDisplayAsync(fontPair, footer, "body");
      const footerSize = 9;
      const footerW = footerFont.widthOfTextAtSize(footer, footerSize);
      page.drawText(footer, {
        x: cxPt - footerW / 2,
        y: mm(footerY),
        size: footerSize,
        font: footerFont,
        color: colors.primary,
      });
    }
  }

  return pdf.save();
}

interface MenuInput {
  couple_display_name: string;
  wedding_date: string | null;
  bride_name: string;
  groom_name: string;
  design: CoupleDesign;
  /** What the couple typed at /app/design. Empty courses = they haven't, and
   *  the card falls back to blank writing rules. */
  menu_card: MenuCard;
  /** Drives the printed strings ("Menü" vs "Menu" and the fallback course
   *  labels). These used to be hardcoded English, so a Hungarian couple
   *  printed an English menu card for a Hungarian wedding. */
  locale: PrintLocale;
  /** Canonical document values. Set by renderPrintableCardPdf; optional only
   *  for the legacy direct renderer API. */
  date_text?: string;
  copy?: { heading: string; courses: readonly string[]; emptyMessage?: string };
}

/** Printed-card copy, per locale. Deliberately tiny and local to the PDF layer
 *  rather than pulled from the frontend i18n trees: the renderer runs on the
 *  server with no `t()`, and these are the only words it ever draws. */
type PrintLocale = "hu" | "en" | "es";
const MENU_COPY: Record<PrintLocale, { heading: string; courses: string[] }> = {
  hu: { heading: "Menü", courses: ["Előétel", "Főétel", "Desszert"] },
  en: { heading: "Menu", courses: ["Starter", "Main", "Dessert"] },
  es: { heading: "Menú", courses: ["Entrante", "Principal", "Postre"] },
};

export function printLocale(raw: string | null | undefined): PrintLocale {
  return raw === "hu" || raw === "es" ? raw : "en";
}

/** A5 menu card in the wedding style: monogram, couple name, date, then the
 *  courses. When the couple has written a menu it prints their dishes; when
 *  they haven't it keeps the original card of labelled writing rules to fill
 *  in by hand, which is a real thing to print and avoids inventing dishes for
 *  somebody's wedding. Content stays on one A5 page while it fits; a maximum-
 *  size edited menu continues onto additional matching A5 pages rather than
 *  drawing below the trim edge. */
export async function renderMenuPdf(input: MenuInput): Promise<Uint8Array> {
  const { width_mm: W, height_mm: H } = FORMATS.a5;
  const pdf = await PDFDocument.create();
  const fontPair = await buildFontPair(pdf, input.design);
  const colors = designColors(input.design);
  const pack = getStylePreset(input.design.style);
  const dateText =
    input.date_text ?? formatWeddingDate(input.wedding_date, input.design.dateFormat, input.locale);

  const cxPt = mm(W / 2);
  const box = { x: 8, y: 8, w: W - 16, h: H - 16 };
  const nameSafe = headingText(safe(input.couple_display_name), input.design);
  const copy = input.copy ?? MENU_COPY[input.locale];
  const heading = headingText(copy.heading, input.design);
  const headingFont = await pickDisplayAsync(fontPair, heading, "heading");

  /** Draw the repeated stationery header and return the first content
   *  baseline. For ordinary names every coordinate is unchanged, preserving
   *  the reviewed one-page raster. Long edited names consume real header
   *  height and the menu paginator receives the reduced content area. */
  const addMenuPage = async (): Promise<{ page: PDFPage; startY: number }> => {
    const page = pdf.addPage([mm(W), mm(H)]);
    drawCardFrame(page, box, input.design, colors);
    if (pack.cardLayout === "framed") drawOvalFrame(page, box, colors.accent);
    if (pack.cardLayout === "corners") drawDecoCorners(page, box, colors.accent);

    const name = await wrapDisplayText(
      fontPair,
      nameSafe,
      "heading",
      22,
      7,
      mm(W - 28),
      3,
      nameSafe.length > 60 ? fontPair.bold : undefined,
    );
    const nameLineMm = (name.size * 1.16) / MM_TO_PT;
    const firstNameY = H - 40 + ((name.lines.length - 1) * nameLineMm) / 2;
    for (const [lineIndex, line] of name.lines.entries()) {
      const width = name.font.widthOfTextAtSize(line, name.size);
      page.drawText(line, {
        x: cxPt - width / 2,
        y: mm(firstNameY - lineIndex * nameLineMm),
        size: name.size,
        font: name.font,
        color: colors.text,
        ...headingDrawOptions(input.design),
      });
    }
    const lastNameY = firstNameY - (name.lines.length - 1) * nameLineMm;

    let dateY = H - 49;
    if (dateText) {
      dateY = Math.min(dateY, lastNameY - 8);
      const date = await wrapDisplayText(fontPair, dateText, "body", 11, 7, mm(W - 32), 2);
      const dateLineMm = (date.size * 1.15) / MM_TO_PT;
      for (const [lineIndex, line] of date.lines.entries()) {
        const width = date.font.widthOfTextAtSize(line, date.size);
        page.drawText(line, {
          x: cxPt - width / 2,
          y: mm(dateY - lineIndex * dateLineMm),
          size: date.size,
          font: date.font,
          color: colors.primary,
        });
      }
      dateY -= (date.lines.length - 1) * dateLineMm;
    }

    const ornamentY = Math.min(H - 57, (dateText ? dateY : lastNameY) - 8);
    if (input.design.print.ornament) {
      drawOrnament(page, pack.ornament, cxPt, mm(ornamentY), 40, colors.accent);
    }

    const headingY = Math.min(H - 68, ornamentY - 11);
    const headingWidth = headingFont.widthOfTextAtSize(heading, 13);
    page.drawText(heading, {
      x: cxPt - headingWidth / 2,
      y: mm(headingY),
      size: 13,
      font: headingFont,
      color: colors.primary,
      ...headingDrawOptions(input.design),
    });
    return { page, startY: headingY - 20 };
  };

  const written = input.menu_card.courses;
  let { page, startY } = await addMenuPage();
  let yMm = startY;

  if (written.length === 0) {
    const empty = safe(
      ("emptyMessage" in copy ? copy.emptyMessage : undefined) ?? "No menu added yet",
    );
    const emptyFont = await pickDisplayAsync(fontPair, empty, "body");
    const emptyW = emptyFont.widthOfTextAtSize(empty, 11);
    page.drawText(empty, {
      x: cxPt - emptyW / 2,
      y: mm(yMm),
      size: 11,
      font: emptyFont,
      color: colors.text,
    });
    return pdf.save();
  }

  // The couple's own menu. Spacing is derived from how much they wrote. If the
  // minimum readable spacing cannot contain it, add another fully styled A5
  // page and keep drawing; no course title or dish is discarded.
  const laidOut = await Promise.all(
    written.map(async (course) => ({
      course,
      title: course.title
        ? await wrapDisplayText(
            fontPair,
            headingText(course.title, input.design),
            "heading",
            11,
            8,
            mm(W - 32),
            1,
          )
        : null,
      lines: await Promise.all(
        course.lines.map((line) =>
          wrapDisplayText(
            fontPair,
            line,
            "body",
            9.5,
            7,
            mm(W - 32),
            2,
            line.length > 60 ? fontPair.regular : undefined,
          ),
        ),
      ),
    })),
  );
  const rows = laidOut.reduce(
    (count, item) =>
      count +
      (item.title?.lines.length ?? 0) +
      item.lines.reduce((sum, line) => sum + line.lines.length, 0),
    0,
  );
  const bottomMm = 22;
  const available = yMm - bottomMm;
  const gap = Math.max(5, Math.min(9, available / Math.max(rows + written.length, 1)));

  const newPage = async () => {
    const next = await addMenuPage();
    page = next.page;
    startY = next.startY;
    yMm = startY;
  };

  const ensureLine = async () => {
    if (yMm < bottomMm) await newPage();
  };

  for (const item of laidOut) {
    const itemRows =
      (item.title?.lines.length ?? 0) +
      item.lines.reduce((sum, line) => sum + line.lines.length, 0);
    const itemHeight = itemRows * gap + gap * 0.6;
    // Keep a whole course together when it can fit on a fresh page. A single
    // exceptionally large course is allowed to split line-by-line below.
    if (itemHeight <= startY - bottomMm && yMm - itemHeight < bottomMm) {
      await newPage();
    }
    if (item.title) {
      for (const titleLine of item.title.lines) {
        await ensureLine();
        const width = item.title.font.widthOfTextAtSize(titleLine, item.title.size);
        page.drawText(titleLine, {
          x: cxPt - width / 2,
          y: mm(yMm),
          size: item.title.size,
          font: item.title.font,
          color: colors.primary,
          ...headingDrawOptions(input.design),
        });
        yMm -= gap;
      }
    }
    for (const line of item.lines) {
      for (const wrappedLine of line.lines) {
        await ensureLine();
        const width = line.font.widthOfTextAtSize(wrappedLine, line.size);
        page.drawText(wrappedLine, {
          x: cxPt - width / 2,
          y: mm(yMm),
          size: line.size,
          font: line.font,
          color: colors.text,
        });
        yMm -= gap;
      }
    }
    // Breathing room between courses, and the pack's own divider when the
    // couple has ornaments on. Not after the last course: a rule under the
    // final dish reads as a cut-off card.
    yMm -= gap * 0.6;
    if (item !== laidOut[laidOut.length - 1] && input.design.print.ornament) {
      if (yMm - gap < bottomMm) {
        await newPage();
      } else {
        drawOrnament(page, pack.ornament, cxPt, mm(yMm + gap * 0.2), 22, colors.accent);
        yMm -= gap;
      }
    }
  }

  return pdf.save();
}

interface InvitationInput {
  couple_display_name: string;
  wedding_date: string | null;
  bride_name: string;
  groom_name: string;
  design: CoupleDesign;
  /** Venue lines — only rendered when present (no invented placeholder data). */
  venue_name: string | null;
  venue_city: string | null;
  date_text?: string;
  copy?: { eyebrow: string; line: string; rsvp: string };
}

/** A5 portrait invitation in the wedding style — the pack's frame + ornament,
 *  a small eyebrow, the couple names as the hero, an ornament divider, an
 *  "invite you" line, the date and the venue. Following the menu renderer's
 *  precedent, the fixed labels are short English strings; the date + venue
 *  lines only draw when the value is present (project rule: no fake data). */
export async function renderInvitationPdf(input: InvitationInput): Promise<Uint8Array> {
  const { width_mm: W, height_mm: H } = FORMATS.a5;
  const pdf = await PDFDocument.create();
  const fontPair = await buildFontPair(pdf, input.design);
  const colors = designColors(input.design);
  const pack = getStylePreset(input.design.style);
  const dateText =
    input.date_text ?? formatWeddingDate(input.wedding_date, input.design.dateFormat, "en");
  const copy = input.copy ?? {
    eyebrow: "Together with their families",
    line: "invite you to celebrate",
    rsvp: "RSVP",
  };

  const page = pdf.addPage([mm(W), mm(H)]);
  const cxPt = mm(W / 2);
  const box = { x: 8, y: 8, w: W - 16, h: H - 16 };
  // Monochrome (asymmetric) drops the centre axis and left-rags the lines.
  const isAsym = pack.cardLayout === "asymmetric";
  const leftXmm = 18;

  drawCardFrame(page, box, input.design, colors);
  if (pack.cardLayout === "framed") drawOvalFrame(page, box, colors.accent);
  if (pack.cardLayout === "corners") drawDecoCorners(page, box, colors.accent);

  // Draw a centred (or left-ragged for Monochrome) text block in the pack
  // face. Short copy stays on the exact historical baseline; long edited
  // names/venues wrap around it instead of running beyond the paper edge.
  const drawLine = async (
    text: string,
    sizePt: number,
    yMm: number,
    role: "heading" | "body",
    color: ReturnType<typeof rgb>,
  ): Promise<void> => {
    const s = role === "heading" ? headingText(safe(text), input.design) : safe(text);
    const layout = await wrapDisplayText(
      fontPair,
      s,
      role,
      sizePt,
      7,
      mm(W - 28),
      4,
      s.length > 60 ? (role === "heading" ? fontPair.bold : fontPair.regular) : undefined,
    );
    const lineMm = (layout.size * 1.18) / MM_TO_PT;
    const firstBaseline = yMm + ((layout.lines.length - 1) * lineMm) / 2;
    for (const [lineIndex, line] of layout.lines.entries()) {
      const width = layout.font.widthOfTextAtSize(line, layout.size);
      page.drawText(line, {
        x: isAsym ? mm(leftXmm) : cxPt - width / 2,
        y: mm(firstBaseline - lineIndex * lineMm),
        size: layout.size,
        font: layout.font,
        color,
        ...(role === "heading" ? headingDrawOptions(input.design) : {}),
      });
    }
  };

  // Eyebrow.
  await drawLine(copy.eyebrow, 9.5, H - 36, "body", colors.primary);

  // Couple names — the hero. The block helper preserves every character even
  // at the 200-character profile limit.
  await drawLine(input.couple_display_name, 26, H - 58, "heading", colors.text);

  // Ornament divider under the names, gated by the Ornament toggle.
  if (input.design.print.ornament) {
    drawOrnament(
      page,
      pack.ornament,
      isAsym ? mm(leftXmm + 20) : cxPt,
      mm(H - 67),
      44,
      colors.accent,
    );
  }

  // Invite line.
  await drawLine(copy.line, 12, H - 82, "body", colors.text);

  // Date — only when present.
  if (dateText) await drawLine(dateText, 14, H - 98, "heading", colors.primary);

  // Venue name + city — each only when present. The canonical card document
  // currently supplies the already-combined venue in `venue_name`; wrapping
  // here therefore keeps the browser's complete line and the PDF in parity.
  if (input.venue_name) await drawLine(input.venue_name, 12, H - 114, "body", colors.text);
  if (input.venue_city) await drawLine(input.venue_city, 10.5, H - 124, "body", colors.primary);

  // RSVP eyebrow pinned near the foot of the card.
  await drawLine(copy.rsvp, 9.5, 24, "body", colors.primary);

  return pdf.save();
}

interface ThankYouInput {
  couple_display_name: string;
  wedding_date: string | null;
  bride_name: string;
  groom_name: string;
  design: CoupleDesign;
  date_text?: string;
  copy?: { heading: string; line: string };
}

/** A6 thank-you card matching the place-card / table-number set — a fixed
 *  "Thank you" heading, an ornament divider, a "for celebrating with us" line,
 *  the couple names and the date. One card per A6 page. */
export async function renderThankYouPdf(input: ThankYouInput): Promise<Uint8Array> {
  const W = 105;
  const H = 148;
  const pdf = await PDFDocument.create();
  const fontPair = await buildFontPair(pdf, input.design);
  const colors = designColors(input.design);
  const pack = getStylePreset(input.design.style);
  const dateText =
    input.date_text ?? formatWeddingDate(input.wedding_date, input.design.dateFormat, "en");
  const copy = input.copy ?? { heading: "Thank you", line: "for celebrating with us" };

  const page = pdf.addPage([mm(W), mm(H)]);
  const cxPt = mm(W / 2);
  const box = { x: 6, y: 6, w: W - 12, h: H - 12 };
  const isAsym = pack.cardLayout === "asymmetric";
  const leftXmm = 14;

  drawCardFrame(page, box, input.design, colors);
  if (pack.cardLayout === "framed") drawOvalFrame(page, box, colors.accent);
  if (pack.cardLayout === "corners") drawDecoCorners(page, box, colors.accent);

  const drawLine = async (
    text: string,
    sizePt: number,
    yMm: number,
    role: "heading" | "body",
    color: ReturnType<typeof rgb>,
  ): Promise<void> => {
    const s = role === "heading" ? headingText(safe(text), input.design) : safe(text);
    const layout = await wrapDisplayText(
      fontPair,
      s,
      role,
      sizePt,
      7,
      mm(W - 22),
      4,
      s.length > 60 ? (role === "heading" ? fontPair.bold : fontPair.regular) : undefined,
    );
    const lineMm = (layout.size * 1.18) / MM_TO_PT;
    const firstBaseline = yMm + ((layout.lines.length - 1) * lineMm) / 2;
    for (const [lineIndex, line] of layout.lines.entries()) {
      const width = layout.font.widthOfTextAtSize(line, layout.size);
      page.drawText(line, {
        x: isAsym ? mm(leftXmm) : cxPt - width / 2,
        y: mm(firstBaseline - lineIndex * lineMm),
        size: layout.size,
        font: layout.font,
        color,
        ...(role === "heading" ? headingDrawOptions(input.design) : {}),
      });
    }
  };

  // "Thank you" — the hero. Shrink to fit the narrow A6 width.
  const thanksSafe = headingText(safe(copy.heading), input.design);
  const thanksFont = await pickDisplayAsync(fontPair, thanksSafe, "heading");
  let thanksSize = 30;
  while (thanksSize > 16 && thanksFont.widthOfTextAtSize(thanksSafe, thanksSize) > mm(W - 20))
    thanksSize -= 1;
  const thanksW = thanksFont.widthOfTextAtSize(thanksSafe, thanksSize);
  page.drawText(thanksSafe, {
    x: isAsym ? mm(leftXmm) : cxPt - thanksW / 2,
    y: mm(H - 48),
    size: thanksSize,
    font: thanksFont,
    color: colors.text,
    ...headingDrawOptions(input.design),
  });

  // Ornament divider, gated by the Ornament toggle.
  if (input.design.print.ornament) {
    drawOrnament(
      page,
      pack.ornament,
      isAsym ? mm(leftXmm + 20) : cxPt,
      mm(H - 60),
      40,
      colors.accent,
    );
  }

  // "for celebrating with us" line.
  await drawLine(copy.line, 10.5, H - 74, "body", colors.text);

  // Couple names.
  await drawLine(input.couple_display_name, 16, H - 92, "heading", colors.primary);

  // Date — only when present.
  if (dateText) await drawLine(dateText, 11, H - 104, "body", colors.primary);

  return pdf.save();
}

type PlaceCardDocument = Extract<PrintableCardDocument, { cardType: "place_card" }>;
type TableNumberDocument = Extract<PrintableCardDocument, { cardType: "table_number" }>;
type MenuDocument = Extract<PrintableCardDocument, { cardType: "menu" }>;
type InvitationDocument = Extract<PrintableCardDocument, { cardType: "invitation" }>;
type ThankYouDocument = Extract<PrintableCardDocument, { cardType: "thank_you" }>;
type ScheduleCardDocument = Extract<PrintableCardDocument, { cardType: "schedule" }>;

/** Decorative A5 schedule card. This is deliberately separate from the A4
 *  operational Run of show below: no Weddly header, suppliers, notes or table
 *  columns, and it uses the same theme primitives as every other card. */
async function renderScheduleCardPdf(input: ScheduleCardDocument): Promise<Uint8Array> {
  const { width_mm: W, height_mm: H } = FORMATS.a5;
  const pdf = await PDFDocument.create();
  const fontPair = await buildFontPair(pdf, input.theme);
  const colors = designColors(input.theme);
  const pack = getStylePreset(input.theme.style);
  const page = pdf.addPage([mm(W), mm(H)]);
  const cxPt = mm(W / 2);
  const box = { x: 8, y: 8, w: W - 16, h: H - 16 };
  const isAsym = pack.cardLayout === "asymmetric";
  const leftPt = mm(18);

  drawCardFrame(page, box, input.theme, colors);
  if (pack.cardLayout === "framed") drawOvalFrame(page, box, colors.accent);
  if (pack.cardLayout === "corners") drawDecoCorners(page, box, colors.accent);

  const drawCentred = async (
    text: string,
    size: number,
    yMm: number,
    role: "heading" | "body",
    color: ReturnType<typeof rgb>,
  ) => {
    const value = role === "heading" ? headingText(safe(text), input.theme) : safe(text);
    const font = await pickDisplayAsync(fontPair, value, role);
    let fittedSize = size;
    while (fittedSize > 8 && font.widthOfTextAtSize(value, fittedSize) > mm(W - 36)) {
      fittedSize -= 0.5;
    }
    const width = font.widthOfTextAtSize(value, fittedSize);
    page.drawText(value, {
      x: isAsym ? leftPt : cxPt - width / 2,
      y: mm(yMm),
      size: fittedSize,
      font,
      color,
      ...(role === "heading" ? headingDrawOptions(input.theme) : {}),
    });
  };

  await drawCentred(input.content.heading, 22, H - 38, "heading", colors.text);
  if (input.content.coupleName) {
    await drawCentred(input.content.coupleName, 11, H - 48, "body", colors.primary);
  }
  if (input.content.date) {
    await drawCentred(input.content.date, 10, H - 56, "body", colors.primary);
  }
  if (input.theme.print.ornament) {
    drawOrnament(page, pack.ornament, isAsym ? mm(38) : cxPt, mm(H - 66), 40, colors.accent);
  }

  if (input.content.entries.length === 0) {
    await drawCentred(input.content.emptyMessage, 11, H - 92, "body", colors.text);
    return pdf.save();
  }

  let yMm = H - 88;
  for (const entry of input.content.entries) {
    const time = safe(entry.time);
    const label = safe(entry.label);
    const timeFont = await pickDisplayAsync(fontPair, time, "body");
    const timeSize = 11;
    const labelLayout = await wrapDisplayText(
      fontPair,
      label,
      "body",
      12,
      8,
      mm(W - 58),
      2,
      label.length > 60 ? fontPair.regular : undefined,
    );
    const rowLeft = isAsym ? leftPt : mm(25);
    page.drawText(time, {
      x: rowLeft,
      y: mm(yMm),
      size: timeSize,
      font: timeFont,
      color: colors.primary,
    });
    for (const [lineIndex, line] of labelLayout.lines.entries()) {
      page.drawText(line, {
        x: rowLeft + mm(24),
        y: mm(yMm - lineIndex * 5),
        size: labelLayout.size,
        font: labelLayout.font,
        color: colors.text,
      });
    }
    // Reserve the height actually drawn. At the 200-character label limit the
    // wrapper may legitimately need more than its two-line fitting target;
    // using a binary 22/26mm decrement made the next edited event overwrite it.
    yMm -= Math.max(22, labelLayout.lines.length * 5 + 6);
  }

  return pdf.save();
}

/** Single entry point used by every Printed cards endpoint. The runtime guard
 *  prevents a stale registry or caller from silently rendering the first
 *  document with a different card type. */
export async function renderPrintableCardPdf(
  documents: readonly PrintableCardDocument[],
): Promise<Uint8Array> {
  if (documents.length === 0) throw new Error("A printable-card document is required");
  const first = documents[0]!;
  if (documents.some((document) => document.cardType !== first.cardType)) {
    throw new Error("Cannot mix printed-card types in one export");
  }

  switch (first.cardType) {
    case "place_card": {
      const cards = documents as readonly PlaceCardDocument[];
      const tablesByGuestId = new Map<number, string>();
      const guests = cards.map((card, index) => {
        if (card.content.tableLabel) tablesByGuestId.set(index + 1, card.content.tableLabel);
        return { id: index + 1, full_name: card.content.guestName };
      });
      return renderPlaceCardsPdf({
        couple_display_name: "",
        wedding_date: null,
        bride_name: "",
        groom_name: "",
        design: first.theme,
        guests,
        tablesByGuestId,
      });
    }
    case "table_number": {
      const cards = documents as readonly TableNumberDocument[];
      return renderTableNumbersPdf({
        bride_name: "",
        groom_name: "",
        design: first.theme,
        tables: cards.map((card) => ({
          label: card.content.tableLabel,
          footer: card.content.footer,
        })),
      });
    }
    case "menu": {
      const card = first as MenuDocument;
      return renderMenuPdf({
        couple_display_name: card.content.coupleName,
        wedding_date: null,
        bride_name: "",
        groom_name: "",
        design: card.theme,
        menu_card: { courses: [...card.content.courses] },
        locale: card.locale === "hu" || card.locale === "es" ? card.locale : "en",
        date_text: card.content.date,
        copy: {
          heading: card.content.heading,
          courses: card.content.emptyCourseLabels,
          emptyMessage: card.content.emptyMessage,
        },
      });
    }
    case "invitation": {
      const card = first as InvitationDocument;
      return renderInvitationPdf({
        couple_display_name: card.content.coupleName,
        wedding_date: null,
        bride_name: "",
        groom_name: "",
        design: card.theme,
        venue_name: card.content.venue,
        venue_city: null,
        date_text: card.content.date,
        copy: {
          eyebrow: card.content.eyebrow,
          line: card.content.line,
          rsvp: card.content.rsvp,
        },
      });
    }
    case "thank_you": {
      const card = first as ThankYouDocument;
      return renderThankYouPdf({
        couple_display_name: card.content.coupleName,
        wedding_date: null,
        bride_name: "",
        groom_name: "",
        design: card.theme,
        date_text: card.content.date,
        copy: { heading: card.content.heading, line: card.content.line },
      });
    }
    case "schedule":
      return renderScheduleCardPdf(first as ScheduleCardDocument);
  }
}

interface ScheduleInput {
  couple_display_name: string;
  wedding_date: string | null;
  events: ScheduleEvent[];
  /** Maps `couple_supplier_id` → supplier name so a run-sheet beat can print
   *  which supplier owns it. Missing ids render without a name. */
  supplier_names?: Record<string, string>;
}

/** Format wedding-day-local minutes as "HH:MM". Day-2 rows (minutes >= 1440)
 *  get a trailing `+1` so the PDF reader can tell post-midnight events apart
 *  from the morning ones — same convention as the on-screen day-2 badge. */
function formatHhmm(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const dayTwo = m >= 1440;
  const wall = m % 1440;
  const hh = Math.floor(wall / 60)
    .toString()
    .padStart(2, "0");
  const mm = (wall % 60).toString().padStart(2, "0");
  return dayTwo ? `${hh}:${mm}+1` : `${hh}:${mm}`;
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
  const helv = await pdf.embedFont(NOTO_REGULAR, { subset: true, features: NO_LIGATURE_FEATURES });
  const helvBold = await pdf.embedFont(NOTO_BOLD, { subset: true, features: NO_LIGATURE_FEATURES });
  // Lazy CJK fallback — only embed the SC face when an input string actually
  // needs it. Same pattern as the seating + place-card renderers.
  let cjkFont: PDFFont | null = null;
  const fontPair: FontPair = {
    regular: helv,
    bold: helvBold,
    getCjk: async () => {
      if (cjkFont) return cjkFont;
      cjkFont = await pdf.embedFont(NOTO_SC, { features: NO_LIGATURE_FEATURES });
      return cjkFont;
    },
  };

  // Page layout — margins in mm so the print stays predictable across A4
  // printers. The right column is everything left after the time column.
  const marginX = 18;
  const marginTopHeader = 16;
  const headerHeightMm = 34; // brand strip + couple name + date + table head
  const marginBottom = 20; // leaves room for the footer brand line
  const footerHeightMm = 10;
  const timeColWidthMm = 28;
  const colGutterMm = 6;
  const contentWidthMm = pageW - 2 * marginX;
  const labelColWidthMm = contentWidthMm - timeColWidthMm - colGutterMm;

  let page = pdf.addPage([mm(pageW), mm(pageH)]);

  // Draws the WEDDLY wordmark letter-by-letter so we can manually space it
  // to match the brand's spaced-caps feel (pdf-lib has no letter-spacing).
  function drawWordmark(p: typeof page, x: number, y: number, f: PDFFont): void {
    const letters = "WEDDLY";
    const size = 10;
    const gap = mm(1.6); // extra spacing between characters
    let cx = x;
    for (const ch of letters) {
      p.drawText(ch, { x: cx, y, size, font: f, color: rgb(0.06, 0.09, 0.19) });
      cx += f.widthOfTextAtSize(ch, size) + gap;
    }
  }

  async function drawPageHeader(p: typeof page, withTableHead = true): Promise<void> {
    // Brand mark — top-right corner
    const markFont = helvBold;
    const brandX = mm(pageW - marginX - 28);
    const brandY = mm(pageH - marginTopHeader);
    drawWordmark(p, brandX, brandY, markFont);
    const tagline = "wedding planning";
    p.drawText(tagline, {
      x: brandX,
      y: brandY - mm(4.5),
      size: 6.5,
      font: helv,
      color: rgb(0.5, 0.54, 0.65),
    });

    // Couple name — left side, larger than before
    const title = safe(input.couple_display_name);
    p.drawText(title, {
      x: mm(marginX),
      y: mm(pageH - marginTopHeader),
      size: 26,
      font: await pickFontAsync(fontPair, title, "bold"),
      color: rgb(0.06, 0.09, 0.19),
    });
    // Date + subtitle below the name
    const dateY = pageH - marginTopHeader - 9;
    if (input.wedding_date) {
      const date = safe(input.wedding_date);
      p.drawText(date, {
        x: mm(marginX),
        y: mm(dateY),
        size: 11,
        font: await pickFontAsync(fontPair, date, "regular"),
        color: rgb(0.33, 0.39, 0.55),
      });
    }
    const subhead = "Időbeosztás / Run of show";
    p.drawText(subhead, {
      x: mm(marginX),
      y: mm(dateY - 5.5),
      size: 9,
      font: await pickFontAsync(fontPair, subhead, "regular"),
      color: rgb(0.5, 0.54, 0.65),
    });

    // Thick rule separating header from content
    p.drawRectangle({
      x: mm(marginX),
      y: mm(pageH - marginTopHeader - 20),
      width: mm(contentWidthMm),
      height: 1.4,
      color: rgb(0.16, 0.2, 0.38),
    });

    if (withTableHead) {
      // Column headings + light separator just above the first row.
      const headY_mm = pageH - marginTopHeader - 24;
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
        height: 0.5,
        color: rgb(0.78, 0.82, 0.9),
      });
    }

    // Footer brand line at the very bottom
    const footerText = "weddly.hu";
    const footerSize = 7;
    const footerW = helv.widthOfTextAtSize(footerText, footerSize);
    p.drawText(footerText, {
      x: mm(pageW / 2) - footerW / 2,
      y: mm(footerHeightMm),
      size: footerSize,
      font: helv,
      color: rgb(0.65, 0.68, 0.75),
    });
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
  let cursorTopMm = pageH - marginTopHeader - headerHeightMm + 4;

  for (let i = 0; i < input.events.length; i++) {
    const ev = input.events[i]!;
    // Build the right-column wrapped lines first so we know how tall this
    // row will be before deciding whether it fits on the current page.
    const timeText = ev.duration_minutes
      ? `${formatHhmm(ev.starts_at_minutes)}–${formatHhmm(ev.starts_at_minutes + ev.duration_minutes)}`
      : formatHhmm(ev.starts_at_minutes);
    const labelWrap = await wrapLines(fontPair, ev.label, 12, mm(labelColWidthMm), 2, "bold");
    const subBits: string[] = [];
    // Run-sheet first: who runs this beat + which supplier, then place + notes.
    const supplierName = ev.couple_supplier_id
      ? input.supplier_names?.[ev.couple_supplier_id]
      : undefined;
    if (ev.responsible) subBits.push(ev.responsible);
    if (supplierName) subBits.push(supplierName);
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
      cursorTopMm = pageH - marginTopHeader - headerHeightMm + 4;
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
