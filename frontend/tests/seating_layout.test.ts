// Property tests for the symmetric-arrange layout function. The full
// 50-scenario simulation lives in frontend/scripts/simulate_seating_layout.ts;
// here we lock in the load-bearing invariants so regressions surface on
// `bun test` rather than only in a manual run.

import { describe, expect, test } from "bun:test";
import {
  MIN_AISLE_MM,
  chairOffsets,
  defaultDimsForShape,
  maxSeatsForTable,
  previewHalfDims,
  tableHalfDims,
} from "../../shared/seating";
import type { SeatingTable, TableShape } from "../../shared/types";
import { computeSymmetricLayout, tableFootprintMm } from "../src/pages/seating/layout";

function makeTable(
  id: number,
  shape: TableShape,
  opts: {
    seats?: number;
    rotation_deg?: number;
    disabled_seats?: number[];
    width_mm?: number;
    length_mm?: number;
  } = {},
): SeatingTable {
  const dims = defaultDimsForShape(shape);
  const width_mm = opts.width_mm ?? dims.width_mm;
  const length_mm = opts.length_mm ?? dims.length_mm;
  const seats = opts.seats ?? Math.max(2, maxSeatsForTable(shape, width_mm, length_mm) - 1);
  return {
    id,
    couple_id: 1,
    label: `T${id}`,
    shape,
    seats,
    x_mm: 0,
    y_mm: 0,
    width_mm,
    length_mm,
    is_kids_table: false,
    rotation_deg: opts.rotation_deg ?? 0,
    disabled_seats: opts.disabled_seats ?? [],
    baby_seats: [],
    created_at: 0,
    updated_at: 0,
  };
}

interface Audit {
  wallBreachMm: number;
  worstAisleMm: number;
  headClearanceMm: number;
}

function audit(tables: SeatingTable[], roomWidthMm: number, roomHeightMm: number): Audit {
  const { positions } = computeSymmetricLayout({ tables, roomWidthMm, roomHeightMm });
  const placed = tables
    .map((t) => {
      const p = positions.get(t.id);
      if (!p) return null;
      const fp = tableFootprintMm(t);
      return { table: t, x: p.x_mm, y: p.y_mm, halfW: fp.w / 2, halfH: fp.h / 2 };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  let wallBreachMm = 0;
  for (const p of placed) {
    wallBreachMm = Math.max(
      wallBreachMm,
      -(p.x - p.halfW),
      -(p.y - p.halfH),
      p.x + p.halfW - roomWidthMm,
      p.y + p.halfH - roomHeightMm,
    );
  }

  let worstAisleMm = Number.POSITIVE_INFINITY;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      const gap = Math.max(
        Math.abs(a.x - b.x) - (a.halfW + b.halfW),
        Math.abs(a.y - b.y) - (a.halfH + b.halfH),
      );
      if (gap < worstAisleMm) worstAisleMm = gap;
    }
  }

  let headClearanceMm = Number.POSITIVE_INFINITY;
  const head = placed.find((p) => p.table.shape === "head");
  if (head) {
    const headBottom = head.y + head.halfH;
    for (const p of placed) {
      if (p === head) continue;
      const top = p.y - p.halfH;
      if (top < headBottom) continue;
      const overlapX =
        Math.min(p.x + p.halfW, head.x + head.halfW) - Math.max(p.x - p.halfW, head.x - head.halfW);
      if (overlapX > 0) headClearanceMm = Math.min(headClearanceMm, top - headBottom);
    }
  }

  return { wallBreachMm: Math.max(0, wallBreachMm), worstAisleMm, headClearanceMm };
}

describe("computeSymmetricLayout", () => {
  test("default room of 6 round tables: full aisle, no wall breach", () => {
    const tables = Array.from({ length: 6 }, (_, i) => makeTable(i + 1, "round"));
    const a = audit(tables, 12_000, 9000);
    expect(a.wallBreachMm).toBe(0);
    expect(a.worstAisleMm).toBeGreaterThanOrEqual(MIN_AISLE_MM);
  });

  test("head + 6 round in a comfortable room: head clearance and aisle honoured", () => {
    const tables = [
      makeTable(1, "head"),
      ...Array.from({ length: 6 }, (_, i) => makeTable(i + 2, "round")),
    ];
    const a = audit(tables, 16_000, 12_000);
    expect(a.wallBreachMm).toBe(0);
    expect(a.worstAisleMm).toBeGreaterThanOrEqual(MIN_AISLE_MM);
    expect(a.headClearanceMm).toBeGreaterThanOrEqual(MIN_AISLE_MM);
  });

  test("crowded layouts never overflow the room walls", () => {
    const tables = Array.from({ length: 12 }, (_, i) => makeTable(i + 1, "round"));
    const a = audit(tables, 8000, 6000);
    expect(a.wallBreachMm).toBe(0);
  });

  test("disabled (×) seats don't widen the footprint", () => {
    // 6 round tables in a 10×8 room where chairs on the inner edges are ×.
    // With all 8 chairs enabled the footprint is 2220mm; with most disabled
    // it shrinks, so the algorithm should fit them with room to spare.
    const full = Array.from({ length: 6 }, (_, i) => makeTable(i + 1, "round"));
    const trimmed = Array.from({ length: 6 }, (_, i) =>
      makeTable(i + 1, "round", { seats: 8, disabled_seats: [2, 3, 4, 5, 6, 7] }),
    );
    const fullAudit = audit(full, 10_000, 8000);
    const trimmedAudit = audit(trimmed, 10_000, 8000);
    // Trimmed layout must achieve aisle at least as wide as the full one.
    expect(trimmedAudit.worstAisleMm).toBeGreaterThanOrEqual(fullAudit.worstAisleMm);
  });

  test("rotated tables are spaced based on their post-rotation footprint", () => {
    const tables = Array.from({ length: 4 }, (_, i) =>
      makeTable(i + 1, "long", { rotation_deg: 90 }),
    );
    const a = audit(tables, 12_000, 9000);
    expect(a.wallBreachMm).toBe(0);
    expect(a.worstAisleMm).toBeGreaterThanOrEqual(MIN_AISLE_MM);
  });

  test("crowded flag fires only when aisle was actually broken", () => {
    const comfortable = Array.from({ length: 6 }, (_, i) => makeTable(i + 1, "round"));
    const tight = Array.from({ length: 18 }, (_, i) => makeTable(i + 1, "round"));
    expect(
      computeSymmetricLayout({ tables: comfortable, roomWidthMm: 12_000, roomHeightMm: 9000 }).meta
        .crowded,
    ).toBe(false);
    expect(
      computeSymmetricLayout({ tables: tight, roomWidthMm: 12_000, roomHeightMm: 9000 }).meta
        .crowded,
    ).toBe(true);
  });

  test("empty input returns no positions", () => {
    const result = computeSymmetricLayout({ tables: [], roomWidthMm: 12_000, roomHeightMm: 9000 });
    expect(result.positions.size).toBe(0);
  });

  test("head table sits centred against the top wall", () => {
    const head = makeTable(1, "head");
    const result = computeSymmetricLayout({
      tables: [head],
      roomWidthMm: 12_000,
      roomHeightMm: 9000,
    });
    const pos = result.positions.get(1);
    expect(pos).toBeDefined();
    expect(pos?.x_mm).toBe(6000);
    // Top edge of head sits at WALL_MARGIN (1500 mm).
    expect(pos?.y_mm).toBe(1500 + head.width_mm / 2);
  });
});

// Which edge of the table a chair sits on, derived from its outward angle:
//   -π/2 top, 0 right, +π/2 bottom, π left. Encodes "short vs long side".
function sideOf(c: { angle: number }): "top" | "right" | "bottom" | "left" {
  const a = ((c.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (Math.abs(Math.sin(a) + 1) < 1e-9) return "top";
  if (Math.abs(Math.cos(a) - 1) < 1e-9) return "right";
  if (Math.abs(Math.sin(a) - 1) < 1e-9) return "bottom";
  return "left";
}

// Regression guard for the reported bug: the lower editor card (previewHalfDims)
// and the planner canvas / PDF (tableHalfDims) MUST place every seat index on
// the same side of the table. They diverged when the preview forked its own
// geometry at a fixed 60:22 aspect; now both feed the real ratio to the shared
// chairOffsets, so a given seat index can never land on a different side.
describe("seat geometry: preview never diverges from the canvas/PDF", () => {
  const shapes: TableShape[] = ["round", "square", "long", "head"];
  const seatCounts = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 40];
  for (const shape of shapes) {
    for (const seats of seatCounts) {
      test(`${shape} × ${seats}: identical seat→side allocation`, () => {
        const t = makeTable(1, shape, { seats });
        const canvas = tableHalfDims(t);
        const preview = previewHalfDims(t);
        // Root cause: the preview must preserve the table's real aspect ratio.
        expect(preview.rx / preview.ry).toBeCloseTo(canvas.rx / canvas.ry, 9);
        // Consequence: every seat lands on the same side in both renderers.
        const canvasSides = chairOffsets(shape, seats, canvas.rx, canvas.ry).map(sideOf);
        const previewSides = chairOffsets(shape, seats, preview.rx, preview.ry).map(sideOf);
        expect(previewSides).toEqual(canvasSides);
      });
    }
  }

  test("non-3:1 long tables also agree (the exact user report)", () => {
    // A near-square long table is where the old fixed 60:22 fork hurt most:
    // the real ratio wants seats on the short ends, the fork stripped them.
    const t = makeTable(1, "long", { seats: 12, width_mm: 900, length_mm: 4000 });
    const canvas = tableHalfDims(t);
    const preview = previewHalfDims(t);
    const canvasSides = chairOffsets("long", 12, canvas.rx, canvas.ry).map(sideOf);
    const previewSides = chairOffsets("long", 12, preview.rx, preview.ry).map(sideOf);
    expect(previewSides).toEqual(canvasSides);
  });
});
