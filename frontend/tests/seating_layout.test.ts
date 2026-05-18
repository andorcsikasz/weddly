// Property tests for the symmetric-arrange layout function. The full
// 50-scenario simulation lives in frontend/scripts/simulate_seating_layout.ts;
// here we lock in the load-bearing invariants so regressions surface on
// `bun test` rather than only in a manual run.

import { describe, expect, test } from "bun:test";
import { MIN_AISLE_MM, defaultDimsForShape, maxSeatsForTable } from "../../shared/seating";
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
