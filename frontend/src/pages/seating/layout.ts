// Pure layout maths for the seating editor's one-click "symmetric" arrange.
// Extracted so it can be unit-tested and simulated without React. The editor
// in SeatingPage.tsx calls computeSymmetricLayout() and then PATCHes each
// table whose position has changed.
//
// Units are millimetres throughout — same as the SeatingTable schema and the
// PDF renderer. The function never mutates inputs; it returns the *target*
// position for every table.

import { CHAIR_BACK_DEPTH_MM, MIN_AISLE_MM, chairOffsets } from "@shared/seating";
import type { SeatingTable } from "@shared/types";

/** Wall margin: how far from the room wall any table (chair-back included)
 *  is allowed to sit. 1.5 m is comfortable for waiter circulation along the
 *  perimeter and matches the head-table top margin. */
export const WALL_MARGIN_MM = 1500;

/** Clearance below the head table before guest tables begin. Matches the
 *  wall margin so the head table sits in a balanced "frame". */
export const HEAD_CLEARANCE_MM = 1500;

/** Axis-aligned bounding box (in mm) of a table including its non-disabled
 *  chair backs, after applying rotation_deg. × seats (`disabled_seats`) are
 *  excluded — they render with an × overlay but don't extend the footprint
 *  because nobody sits there. */
export function tableFootprintMm(tb: SeatingTable): { w: number; h: number } {
  const isRound = tb.shape === "round";
  const isSquare = tb.shape === "square";
  // Mirrors halfDims() in SeatingMap.tsx — round/square are symmetric;
  // long/head orient with their longer side along x.
  const rx = isRound
    ? tb.width_mm / 2
    : isSquare
      ? Math.max(tb.width_mm, tb.length_mm) / 2
      : tb.length_mm / 2;
  const ry = isRound
    ? tb.width_mm / 2
    : isSquare
      ? Math.max(tb.width_mm, tb.length_mm) / 2
      : tb.width_mm / 2;

  const disabled = new Set(tb.disabled_seats ?? []);
  const offsets = chairOffsets(tb.shape, tb.seats, rx, ry);
  let extL = rx;
  let extR = rx;
  let extT = ry;
  let extB = ry;
  for (let i = 0; i < offsets.length; i++) {
    if (disabled.has(i)) continue;
    const c = offsets[i];
    if (!c) continue;
    if (isRound) {
      // Round chairs sit on a circle — treat each one as extending the bbox
      // by CHAIR_BACK_DEPTH_MM in the half-space matching its position.
      if (c.dx < -1) extL = Math.max(extL, -c.dx + CHAIR_BACK_DEPTH_MM);
      if (c.dx > 1) extR = Math.max(extR, c.dx + CHAIR_BACK_DEPTH_MM);
      if (c.dy < -1) extT = Math.max(extT, -c.dy + CHAIR_BACK_DEPTH_MM);
      if (c.dy > 1) extB = Math.max(extB, c.dy + CHAIR_BACK_DEPTH_MM);
    } else {
      if (Math.abs(c.dy + ry) < 1) extT = ry + CHAIR_BACK_DEPTH_MM;
      else if (Math.abs(c.dy - ry) < 1) extB = ry + CHAIR_BACK_DEPTH_MM;
      if (Math.abs(c.dx + rx) < 1) extL = rx + CHAIR_BACK_DEPTH_MM;
      else if (Math.abs(c.dx - rx) < 1) extR = rx + CHAIR_BACK_DEPTH_MM;
    }
  }

  // Symmetric half-extent — keeps the table's centre aligned to the cell
  // centre when the grid lays it out (asymmetric offsets would shift the
  // visual balance).
  const localW = 2 * Math.max(extL, extR);
  const localH = 2 * Math.max(extT, extB);
  const rot = ((tb.rotation_deg ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  return { w: localW * cos + localH * sin, h: localW * sin + localH * cos };
}

export interface SymmetricLayoutInput {
  tables: SeatingTable[];
  roomWidthMm: number;
  roomHeightMm: number;
}

export interface SymmetricLayoutResult {
  /** Target centre position for each table, keyed by table id. */
  positions: Map<number, { x_mm: number; y_mm: number }>;
  /** Diagnostic info — useful for tests and for surfacing warnings later. */
  meta: {
    cols: number;
    rows: number;
    cellWMm: number;
    cellHMm: number;
    minCellWMm: number;
    minCellHMm: number;
    /** True when the room couldn't honour MIN_AISLE_MM on every gap and the
     *  algorithm fell back to ratio-only packing. */
    crowded: boolean;
  };
}

/** Compute target positions for "symmetric" auto-arrange.
 *
 *  Layout: head table (if present) hugs the top wall on the vertical
 *  centreline; guest tables fill a row-major grid below. Each grid cell is
 *  sized to hold the largest guest footprint plus MIN_AISLE_MM, so chairs
 *  from adjacent tables stay walkable apart.
 *
 *  Sizes and rotations are not changed — only x_mm / y_mm. Tables not in the
 *  input are simply absent from the returned map. */
export function computeSymmetricLayout(input: SymmetricLayoutInput): SymmetricLayoutResult {
  const { tables, roomWidthMm, roomHeightMm } = input;
  const positions = new Map<number, { x_mm: number; y_mm: number }>();
  const meta: SymmetricLayoutResult["meta"] = {
    cols: 0,
    rows: 0,
    cellWMm: 0,
    cellHMm: 0,
    minCellWMm: 0,
    minCellHMm: 0,
    crowded: false,
  };
  if (tables.length === 0) return { positions, meta };

  const head = tables.find((tb) => tb.shape === "head") ?? null;
  const guests = tables.filter((tb) => tb.shape !== "head");

  let usedTopMm = WALL_MARGIN_MM;
  if (head) {
    const headRy = head.width_mm / 2;
    positions.set(head.id, {
      x_mm: Math.round(roomWidthMm / 2),
      y_mm: Math.round(WALL_MARGIN_MM + headRy),
    });
    usedTopMm = WALL_MARGIN_MM + head.width_mm + HEAD_CLEARANCE_MM;
  }

  if (guests.length === 0) return { positions, meta };

  const availTop = usedTopMm;
  const availBottom = roomHeightMm - WALL_MARGIN_MM;
  const availLeft = WALL_MARGIN_MM;
  const availRight = roomWidthMm - WALL_MARGIN_MM;
  const availW = Math.max(0, availRight - availLeft);
  const availH = Math.max(0, availBottom - availTop);
  if (availW <= 0 || availH <= 0) return { positions, meta };

  const n = guests.length;
  const ratio = availW / availH;
  const idealCols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * ratio))));

  let maxFootprintW = 0;
  let maxFootprintH = 0;
  for (const g of guests) {
    const fp = tableFootprintMm(g);
    if (fp.w > maxFootprintW) maxFootprintW = fp.w;
    if (fp.h > maxFootprintH) maxFootprintH = fp.h;
  }
  const minCellW = maxFootprintW + MIN_AISLE_MM;
  const minCellH = maxFootprintH + MIN_AISLE_MM;
  const aisleMaxCols = Math.max(1, Math.floor(availW / minCellW));
  const aisleMaxRows = Math.max(1, Math.floor(availH / minCellH));

  let cols: number;
  let rows: number;
  let crowded = false;
  if (aisleMaxCols * aisleMaxRows >= n) {
    cols = Math.min(idealCols, aisleMaxCols);
    rows = Math.ceil(n / cols);
    if (rows > aisleMaxRows) {
      cols = Math.min(aisleMaxCols, Math.ceil(n / aisleMaxRows));
      rows = Math.ceil(n / cols);
    }
  } else {
    cols = idealCols;
    rows = Math.ceil(n / cols);
    crowded = true;
  }
  const cellW = availW / cols;
  const cellH = availH / rows;
  const lastRowCount = n - (rows - 1) * cols;

  for (let i = 0; i < n; i++) {
    const g = guests[i];
    if (!g) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const isLastPartial = r === rows - 1 && lastRowCount < cols;
    const colsInRow = isLastPartial ? lastRowCount : cols;
    const rowOffset = isLastPartial ? ((cols - colsInRow) * cellW) / 2 : 0;
    positions.set(g.id, {
      x_mm: Math.round(availLeft + rowOffset + (c + 0.5) * cellW),
      y_mm: Math.round(availTop + (r + 0.5) * cellH),
    });
  }

  meta.cols = cols;
  meta.rows = rows;
  meta.cellWMm = cellW;
  meta.cellHMm = cellH;
  meta.minCellWMm = minCellW;
  meta.minCellHMm = minCellH;
  meta.crowded = crowded;
  return { positions, meta };
}
