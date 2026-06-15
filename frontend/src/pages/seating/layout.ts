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

/** Which room wall is the head table hugging (determined by closest wall). */
export type HeadWall = "top" | "bottom" | "left" | "right";

/** Return the wall the head table is currently nearest to. */
export function detectHeadWall(
  head: SeatingTable,
  roomWidthMm: number,
  roomHeightMm: number,
): HeadWall {
  const dTop = head.y_mm;
  const dBottom = roomHeightMm - head.y_mm;
  const dLeft = head.x_mm;
  const dRight = roomWidthMm - head.x_mm;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (dTop === min) return "top";
  if (dBottom === min) return "bottom";
  if (dLeft === min) return "left";
  return "right";
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
 *  Layout strategy:
 *    - Head table (if any) snaps to whichever wall it is currently nearest,
 *      centred on the perpendicular axis so the symmetry axis is the X axis
 *      (horizontal mid-line) when the head is on a side wall, or the Y axis
 *      (vertical mid-line) when it is on the top or bottom wall.
 *    - Guest tables fill a row-major grid in the remaining space. Grid
 *      dimensions are chosen so the most-square cell pattern matches the
 *      available area aspect, then clamped to whatever fits with MIN_AISLE_MM
 *      between every adjacent pair. The largest guest footprint sets the cell
 *      size — every aisle is at least MIN_AISLE_MM.
 *    - When the room is genuinely too small to honour MIN_AISLE everywhere
 *      (crowded mode), the grid overflows into the wall margin on the side
 *      opposite the head rather than overlapping chairs.
 *    - When the grid is smaller than the available area it is centred so
 *      the result reads balanced. With a head table present the grid is
 *      clamped away from the head to preserve HEAD_CLEARANCE_MM.
 *
 *  Sizes and rotations are not changed — only x_mm / y_mm. Tables not in
 *  the input are absent from the returned map. */
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

  // Detect which wall the head table is hugging so we can arrange guest
  // tables symmetrically on the opposite side.
  const headWall = head ? detectHeadWall(head, roomWidthMm, roomHeightMm) : "top";

  // Place head table flush against its wall, centred on the perpendicular axis.
  // `headPerp` is the table's short dimension (the one pointing into the room).
  let availLeft = WALL_MARGIN_MM;
  let availRight = roomWidthMm - WALL_MARGIN_MM;
  let availTop = WALL_MARGIN_MM;
  let availBottom = roomHeightMm - WALL_MARGIN_MM;

  if (head) {
    const headPerp = head.width_mm; // short side, perpendicular to wall
    const headHalfPerp = headPerp / 2;
    switch (headWall) {
      case "top":
        positions.set(head.id, {
          x_mm: Math.round(roomWidthMm / 2),
          y_mm: Math.round(WALL_MARGIN_MM + headHalfPerp),
        });
        availTop = WALL_MARGIN_MM + headPerp + HEAD_CLEARANCE_MM;
        break;
      case "bottom":
        positions.set(head.id, {
          x_mm: Math.round(roomWidthMm / 2),
          y_mm: Math.round(roomHeightMm - WALL_MARGIN_MM - headHalfPerp),
        });
        availBottom = roomHeightMm - WALL_MARGIN_MM - headPerp - HEAD_CLEARANCE_MM;
        break;
      case "right":
        positions.set(head.id, {
          x_mm: Math.round(roomWidthMm - WALL_MARGIN_MM - headHalfPerp),
          y_mm: Math.round(roomHeightMm / 2),
        });
        availRight = roomWidthMm - WALL_MARGIN_MM - headPerp - HEAD_CLEARANCE_MM;
        break;
      case "left":
        positions.set(head.id, {
          x_mm: Math.round(WALL_MARGIN_MM + headHalfPerp),
          y_mm: Math.round(roomHeightMm / 2),
        });
        availLeft = WALL_MARGIN_MM + headPerp + HEAD_CLEARANCE_MM;
        break;
    }
  }

  if (guests.length === 0) return { positions, meta };

  const availW = Math.max(0, availRight - availLeft);
  const availH = Math.max(0, availBottom - availTop);
  if (availW <= 0 || availH <= 0) return { positions, meta };

  const n = guests.length;
  let fpW = 0;
  let fpH = 0;
  for (const g of guests) {
    const fp = tableFootprintMm(g);
    if (fp.w > fpW) fpW = fp.w;
    if (fp.h > fpH) fpH = fp.h;
  }

  // Three capability tiers, picked top-down:
  //   L1 comfortable — every adjacent pair gets ≥ MIN_AISLE between them.
  //   L2 crowded but no-overlap — full aisle won't fit, but tables still
  //      stay inside the room without overlapping.
  //   L3 overflow — even touching tables don't fit; some overlap is
  //      unavoidable. Picked so the L1/L2 fast paths aren't used.
  // Per-axis maxima for each tier (the wall margin already covers the
  // table-to-wall gap, so no extra aisle is reserved at the edges):
  //   aisleMax: cols * fp + (cols - 1) * MIN_AISLE ≤ avail
  //   touchMax: cols * fp ≤ maxGridDim

  // In crowded mode the grid may overflow the wall margin on the side
  // OPPOSITE the head, but must never encroach on the head clearance.
  // Parallel to the head wall both margins are usable → full room extent.
  const maxGridX =
    headWall === "right" || headWall === "left"
      ? availW + WALL_MARGIN_MM // head on a side wall: X is perpendicular, far margin usable
      : roomWidthMm; // head on top/bottom: X is parallel, both margins usable
  const maxGridY =
    headWall === "top" || headWall === "bottom"
      ? availH + WALL_MARGIN_MM // head on top/bottom: Y is perpendicular, far margin usable
      : roomHeightMm; // head on a side wall: Y is parallel, both margins usable

  const aisleMaxCols = Math.max(0, Math.floor((availW + MIN_AISLE_MM) / (fpW + MIN_AISLE_MM)));
  const aisleMaxRows = Math.max(0, Math.floor((availH + MIN_AISLE_MM) / (fpH + MIN_AISLE_MM)));
  const touchMaxCols = Math.max(0, Math.floor(maxGridX / fpW));
  const touchMaxRows = Math.max(0, Math.floor(maxGridY / fpH));

  // Aim for a most-square grid that matches the room and per-table aspect
  // ratios together. A tall table in a wide room still wants more columns
  // than rows.
  const targetRatio = (availW / availH) * (fpH / fpW);
  const idealCols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * targetRatio))));

  let cols: number;
  if (aisleMaxCols >= 1 && aisleMaxRows >= 1 && aisleMaxCols * aisleMaxRows >= n) {
    // L1
    cols = Math.min(idealCols, aisleMaxCols);
    const probeRows = Math.ceil(n / cols);
    if (probeRows > aisleMaxRows) {
      cols = Math.min(aisleMaxCols, Math.ceil(n / aisleMaxRows));
    }
  } else if (touchMaxCols >= 1 && touchMaxRows >= 1 && touchMaxCols * touchMaxRows >= n) {
    // L2 — pick cols ∈ [ceil(n / touchMaxRows), touchMaxCols] so rows fits.
    const lower = Math.max(1, Math.ceil(n / touchMaxRows));
    const upper = Math.max(lower, touchMaxCols);
    cols = Math.min(upper, Math.max(lower, idealCols));
  } else {
    // L3
    cols = Math.min(n, Math.max(1, idealCols));
  }
  const rows = Math.ceil(n / cols);

  // Pitch per axis. Three regimes:
  //   1. Comfortable — room has slack: spread to fill `avail` so aisles are
  //      generous and the grid is symmetric to the walls.
  //   2. Crowded — `avail` can't hold a full MIN_AISLE pitch: use the
  //      MIN_AISLE pitch even though it overflows `avail` into the wall
  //      margin. Better balanced than tight in the centre with dead zones.
  //   3. Severely crowded — even the MIN_AISLE pitch would push tables past
  //      the room walls: clamp pitch to fit inside the room. This gives
  //      up some aisle space (and may overlap chairs in truly impossible
  //      rooms), but keeps tables visually contained so the user sees the
  //      crowding instead of tables flying off the canvas.
  // `maxDim` is the largest the grid extent is allowed to be — bounded by
  // the room on the side parallel to the head wall; bounded by the head
  // clearance on the perpendicular side (see maxGridX / maxGridY above).
  const axisPitch = (count: number, fp: number, avail: number, maxDim: number): number => {
    if (count <= 1) return 0;
    const spreadPitch = (avail - fp) / (count - 1);
    const aislePitch = fp + MIN_AISLE_MM;
    if (spreadPitch >= aislePitch) return spreadPitch;
    const roomCapPitch = (maxDim - fp) / (count - 1);
    return Math.min(aislePitch, roomCapPitch);
  };
  const pitchX = axisPitch(cols, fpW, availW, maxGridX);
  const pitchY = axisPitch(rows, fpH, availH, maxGridY);

  const gridW = (cols - 1) * pitchX + fpW;
  const gridH = (rows - 1) * pitchY + fpH;

  // Centre the grid in the available area, then clamp so the grid never
  // encroaches on the head clearance zone.
  let startX = availLeft + (availW - gridW) / 2;
  let startY = availTop + (availH - gridH) / 2;
  if (head) {
    switch (headWall) {
      case "top":
        if (startY < availTop) startY = availTop;
        break;
      case "bottom":
        if (startY + gridH > availBottom) startY = availBottom - gridH;
        break;
      case "right":
        if (startX + gridW > availRight) startX = availRight - gridW;
        break;
      case "left":
        if (startX < availLeft) startX = availLeft;
        break;
    }
  }

  const lastRowCount = n - (rows - 1) * cols;
  for (let i = 0; i < n; i++) {
    const g = guests[i];
    if (!g) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    // Centre the last row if it isn't full, so "3 + 2 of 3-cols" reads as a
    // tidy 3 + 2 centred rather than 3 + 2 left-aligned.
    const isLastPartial = r === rows - 1 && lastRowCount < cols;
    const colsInRow = isLastPartial ? lastRowCount : cols;
    const rowOffset = isLastPartial ? ((cols - colsInRow) * pitchX) / 2 : 0;
    positions.set(g.id, {
      x_mm: Math.round(startX + rowOffset + fpW / 2 + c * pitchX),
      y_mm: Math.round(startY + fpH / 2 + r * pitchY),
    });
  }

  // `crowded` reflects realised geometry, not which tier we took. L2 layouts
  // that happen to land exactly at MIN_AISLE on every axis aren't crowded —
  // the user still gets a walkable aisle.
  const aisleX = cols > 1 ? pitchX - fpW : Number.POSITIVE_INFINITY;
  const aisleY = rows > 1 ? pitchY - fpH : Number.POSITIVE_INFINITY;
  meta.cols = cols;
  meta.rows = rows;
  meta.cellWMm = pitchX;
  meta.cellHMm = pitchY;
  meta.minCellWMm = fpW + MIN_AISLE_MM;
  meta.minCellHMm = fpH + MIN_AISLE_MM;
  meta.crowded = aisleX < MIN_AISLE_MM || aisleY < MIN_AISLE_MM;
  return { positions, meta };
}
