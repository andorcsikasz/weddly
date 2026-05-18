// Simulation harness for the seating-editor "symmetric arrange" feature.
// Generates 50 wedding scenarios with varying table counts, shapes, sizes,
// rotations, and disabled seats; runs computeSymmetricLayout(); then audits
// the output against UX checks:
//
//   1. WALL CLEARANCE  — every table's chair-back stays ≥ 0 from each wall.
//                        (WALL_MARGIN_MM is the *target*; we report any
//                        actual breach of the wall.)
//   2. AISLE WIDTH     — every neighbouring pair has ≥ MIN_AISLE_MM gap
//                        between their bounding boxes.
//   3. HEAD CLEARANCE  — head-table bottom to nearest guest top extent
//                        is ≥ MIN_AISLE_MM.
//   4. BALANCE         — last-row offset reads centred (already enforced
//                        in algorithm; we just confirm).
//   5. SPACE WASTE     — fraction of room area not used by the bounding
//                        rectangle of placed tables — too low ≈ cramped,
//                        too high ≈ tables clumped in centre with dead
//                        zones near the walls.
//
// Run with: bun frontend/scripts/simulate_seating_layout.ts

import {
  CHAIR_BACK_DEPTH_MM,
  MIN_AISLE_MM,
  defaultDimsForShape,
  maxSeatsForTable,
} from "../../shared/seating";
import type { SeatingTable, TableShape } from "../../shared/types";
import {
  HEAD_CLEARANCE_MM,
  WALL_MARGIN_MM,
  computeSymmetricLayout,
  tableFootprintMm,
} from "../src/pages/seating/layout";

// ─── Scenario generation ───────────────────────────────────────────────────

interface Scenario {
  name: string;
  roomWidthMm: number;
  roomHeightMm: number;
  tables: SeatingTable[];
}

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

function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  let nextId = 1;
  const id = () => nextId++;

  // Intimate weddings: 1–4 tables, small rooms.
  out.push({
    name: "intimate 1 round, 6×6",
    roomWidthMm: 6000,
    roomHeightMm: 6000,
    tables: [makeTable(id(), "round")],
  });
  out.push({
    name: "intimate 2 round, 6×6",
    roomWidthMm: 6000,
    roomHeightMm: 6000,
    tables: [makeTable(id(), "round"), makeTable(id(), "round")],
  });
  out.push({
    name: "intimate 3 round, 7×6",
    roomWidthMm: 7000,
    roomHeightMm: 6000,
    tables: [makeTable(id(), "round"), makeTable(id(), "round"), makeTable(id(), "round")],
  });
  out.push({
    name: "intimate 4 round, 8×7",
    roomWidthMm: 8000,
    roomHeightMm: 7000,
    tables: Array.from({ length: 4 }, () => makeTable(id(), "round")),
  });

  // Default room (12×9 m) with growing counts.
  for (const n of [5, 6, 8, 10, 12, 15, 18, 20]) {
    out.push({
      name: `default room, ${n} round`,
      roomWidthMm: 12_000,
      roomHeightMm: 9000,
      tables: Array.from({ length: n }, () => makeTable(id(), "round")),
    });
  }

  // With a head table.
  out.push({
    name: "head + 6 round, 12×9",
    roomWidthMm: 12_000,
    roomHeightMm: 9000,
    tables: [makeTable(id(), "head"), ...Array.from({ length: 6 }, () => makeTable(id(), "round"))],
  });
  out.push({
    name: "head + 10 round, 12×9",
    roomWidthMm: 12_000,
    roomHeightMm: 9000,
    tables: [
      makeTable(id(), "head"),
      ...Array.from({ length: 10 }, () => makeTable(id(), "round")),
    ],
  });
  out.push({
    name: "head + 14 round, 14×10",
    roomWidthMm: 14_000,
    roomHeightMm: 10_000,
    tables: [
      makeTable(id(), "head"),
      ...Array.from({ length: 14 }, () => makeTable(id(), "round")),
    ],
  });
  out.push({
    name: "head + 20 round, 16×12",
    roomWidthMm: 16_000,
    roomHeightMm: 12_000,
    tables: [
      makeTable(id(), "head"),
      ...Array.from({ length: 20 }, () => makeTable(id(), "round")),
    ],
  });

  // Mixed shapes.
  out.push({
    name: "mixed long+round, 12×9",
    roomWidthMm: 12_000,
    roomHeightMm: 9000,
    tables: [
      makeTable(id(), "long"),
      makeTable(id(), "round"),
      makeTable(id(), "long"),
      makeTable(id(), "round"),
      makeTable(id(), "round"),
      makeTable(id(), "long"),
    ],
  });
  out.push({
    name: "mixed all shapes, 14×10",
    roomWidthMm: 14_000,
    roomHeightMm: 10_000,
    tables: [
      makeTable(id(), "head"),
      makeTable(id(), "round"),
      makeTable(id(), "long"),
      makeTable(id(), "square"),
      makeTable(id(), "round"),
      makeTable(id(), "long"),
      makeTable(id(), "round"),
      makeTable(id(), "square"),
    ],
  });

  // Rotated tables (uncommon but supported).
  out.push({
    name: "rotated longs 90°, 12×9",
    roomWidthMm: 12_000,
    roomHeightMm: 9000,
    tables: [
      makeTable(id(), "long", { rotation_deg: 90 }),
      makeTable(id(), "long", { rotation_deg: 90 }),
      makeTable(id(), "long", { rotation_deg: 90 }),
      makeTable(id(), "long", { rotation_deg: 90 }),
    ],
  });
  out.push({
    name: "rotated mix 45°, 12×9",
    roomWidthMm: 12_000,
    roomHeightMm: 9000,
    tables: [
      makeTable(id(), "round", { rotation_deg: 45 }),
      makeTable(id(), "long", { rotation_deg: 45 }),
      makeTable(id(), "round", { rotation_deg: 45 }),
      makeTable(id(), "long", { rotation_deg: 45 }),
      makeTable(id(), "round", { rotation_deg: 45 }),
      makeTable(id(), "long", { rotation_deg: 45 }),
    ],
  });

  // Disabled seats — should NOT widen the footprint, so layout can pack
  // tables tighter. We expect aisle to still be ≥ MIN_AISLE_MM at active
  // chair-backs.
  out.push({
    name: "round w/ all seats × except 2, 10×8",
    roomWidthMm: 10_000,
    roomHeightMm: 8000,
    tables: Array.from({ length: 6 }, () =>
      makeTable(id(), "round", { seats: 8, disabled_seats: [2, 3, 4, 5, 6, 7] }),
    ),
  });

  // Big rooms with large counts.
  out.push({
    name: "big ballroom 25 round, 20×15",
    roomWidthMm: 20_000,
    roomHeightMm: 15_000,
    tables: Array.from({ length: 25 }, () => makeTable(id(), "round")),
  });
  out.push({
    name: "big ballroom head + 30 round, 22×16",
    roomWidthMm: 22_000,
    roomHeightMm: 16_000,
    tables: [
      makeTable(id(), "head"),
      ...Array.from({ length: 30 }, () => makeTable(id(), "round")),
    ],
  });

  // Cramped — too many tables for the room (expect crowded=true).
  out.push({
    name: "cramped 12 round in 8×6",
    roomWidthMm: 8000,
    roomHeightMm: 6000,
    tables: Array.from({ length: 12 }, () => makeTable(id(), "round")),
  });
  out.push({
    name: "cramped 20 round in 10×8",
    roomWidthMm: 10_000,
    roomHeightMm: 8000,
    tables: Array.from({ length: 20 }, () => makeTable(id(), "round")),
  });

  // Very wide vs very tall rooms — algorithm should pick cols/rows that
  // match the aspect ratio.
  out.push({
    name: "very wide 8 round, 20×8",
    roomWidthMm: 20_000,
    roomHeightMm: 8000,
    tables: Array.from({ length: 8 }, () => makeTable(id(), "round")),
  });
  out.push({
    name: "very tall 8 round, 8×20",
    roomWidthMm: 8000,
    roomHeightMm: 20_000,
    tables: Array.from({ length: 8 }, () => makeTable(id(), "round")),
  });

  // Large tables.
  out.push({
    name: "10 huge rounds (2m), 16×12",
    roomWidthMm: 16_000,
    roomHeightMm: 12_000,
    tables: Array.from({ length: 10 }, () =>
      makeTable(id(), "round", { width_mm: 2000, length_mm: 2000, seats: 10 }),
    ),
  });

  // Long head + many round (typical large wedding).
  out.push({
    name: "long head (5m) + 18 round, 18×12",
    roomWidthMm: 18_000,
    roomHeightMm: 12_000,
    tables: [
      makeTable(id(), "head", { length_mm: 5000, width_mm: 900 }),
      ...Array.from({ length: 18 }, () => makeTable(id(), "round")),
    ],
  });

  // Single column edge case.
  out.push({
    name: "narrow room 5 round, 5×12",
    roomWidthMm: 5000,
    roomHeightMm: 12_000,
    tables: Array.from({ length: 5 }, () => makeTable(id(), "round")),
  });

  // Tiny round tables.
  out.push({
    name: "12 small rounds (1m) 10×8",
    roomWidthMm: 10_000,
    roomHeightMm: 8000,
    tables: Array.from({ length: 12 }, () =>
      makeTable(id(), "round", { width_mm: 1000, length_mm: 1000, seats: 4 }),
    ),
  });

  // Just-fits boundary cases.
  out.push({
    name: "2 round, 5×5",
    roomWidthMm: 5000,
    roomHeightMm: 5000,
    tables: [makeTable(id(), "round"), makeTable(id(), "round")],
  });
  out.push({
    name: "3 round, 6×5",
    roomWidthMm: 6000,
    roomHeightMm: 5000,
    tables: Array.from({ length: 3 }, () => makeTable(id(), "round")),
  });

  // Square tables.
  out.push({
    name: "6 square, 12×9",
    roomWidthMm: 12_000,
    roomHeightMm: 9000,
    tables: Array.from({ length: 6 }, () => makeTable(id(), "square")),
  });

  // Long tables only.
  out.push({
    name: "6 long, 12×9",
    roomWidthMm: 12_000,
    roomHeightMm: 9000,
    tables: Array.from({ length: 6 }, () => makeTable(id(), "long")),
  });

  // Many sizes mixed.
  for (let i = 0; i < 8; i++) {
    const w = 10_000 + i * 1000;
    const h = 7000 + (i % 3) * 1500;
    const n = 4 + i * 2;
    const shapes: TableShape[] = ["round", "long", "square", "round"];
    out.push({
      name: `mix#${i + 1} ${n} tables ${w / 1000}×${h / 1000}`,
      roomWidthMm: w,
      roomHeightMm: h,
      tables: Array.from({ length: n }, (_, j) =>
        makeTable(id(), shapes[j % shapes.length] as TableShape),
      ),
    });
  }

  return out;
}

// ─── Audit ────────────────────────────────────────────────────────────────

interface Audit {
  wallBreachMm: number; // max protrusion past wall (mm); 0 if none
  worstAisleMm: number; // smallest neighbour gap (mm); Infinity if no neighbours
  headClearanceMm: number; // head-bottom to nearest guest-top (mm); Infinity if no head
  wasteRatio: number; // 1 - usedBox / roomArea
  positionedCount: number;
  crowded: boolean;
}

function audit(scenario: Scenario): {
  result: ReturnType<typeof computeSymmetricLayout>;
  a: Audit;
} {
  const result = computeSymmetricLayout({
    tables: scenario.tables,
    roomWidthMm: scenario.roomWidthMm,
    roomHeightMm: scenario.roomHeightMm,
  });

  const placed = scenario.tables
    .map((t) => {
      const p = result.positions.get(t.id);
      if (!p) return null;
      const fp = tableFootprintMm(t);
      return {
        table: t,
        x: p.x_mm,
        y: p.y_mm,
        halfW: fp.w / 2,
        halfH: fp.h / 2,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  let wallBreachMm = 0;
  for (const p of placed) {
    const left = p.x - p.halfW;
    const top = p.y - p.halfH;
    const right = p.x + p.halfW;
    const bottom = p.y + p.halfH;
    wallBreachMm = Math.max(
      wallBreachMm,
      -left, // negative left means past left wall
      -top,
      right - scenario.roomWidthMm,
      bottom - scenario.roomHeightMm,
    );
  }

  // Pairwise gap = max(0, axis-separation - sum-half-extents) along the
  // dominant separation axis (the one with greater normalized distance).
  let worstAisleMm = Number.POSITIVE_INFINITY;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      const gapX = dx - (a.halfW + b.halfW);
      const gapY = dy - (a.halfH + b.halfH);
      // If overlapping in both axes, gap is negative (overlap).
      // If separated in either axis, gap is positive on that axis.
      const gap = Math.max(gapX, gapY);
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
      if (top >= headBottom) {
        // Horizontal overlap with head x-range?
        const overlapX =
          Math.min(p.x + p.halfW, head.x + head.halfW) -
          Math.max(p.x - p.halfW, head.x - head.halfW);
        if (overlapX > 0) {
          const gap = top - headBottom;
          if (gap < headClearanceMm) headClearanceMm = gap;
        }
      }
    }
  }

  // Used bounding box (smallest rect that contains all footprints).
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.halfW);
    minY = Math.min(minY, p.y - p.halfH);
    maxX = Math.max(maxX, p.x + p.halfW);
    maxY = Math.max(maxY, p.y + p.halfH);
  }
  const usedArea = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  const roomArea = scenario.roomWidthMm * scenario.roomHeightMm;
  const wasteRatio = roomArea > 0 ? 1 - usedArea / roomArea : 1;

  return {
    result,
    a: {
      wallBreachMm: Math.max(0, wallBreachMm),
      worstAisleMm,
      headClearanceMm,
      wasteRatio,
      positionedCount: placed.length,
      crowded: result.meta.crowded,
    },
  };
}

// ─── Run ──────────────────────────────────────────────────────────────────

function fmt(mm: number): string {
  if (!isFinite(mm)) return "  n/a";
  return `${Math.round(mm).toString().padStart(5)}mm`;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

const all = scenarios();
console.log(`Running ${all.length} scenarios…\n`);

let totalBreaches = 0;
let totalAisleViolations = 0;
let totalHeadViolations = 0;
let totalCrowded = 0;
const wasteValues: number[] = [];

const header =
  "  #  | scenario                                 |  n |  room   | grid |  wall  | aisle  | head   | waste";
console.log(header);
console.log("-".repeat(header.length));

for (let i = 0; i < all.length; i++) {
  const sc = all[i]!;
  const { result, a } = audit(sc);
  const grid = `${result.meta.cols}×${result.meta.rows}`;
  const wallStatus = a.wallBreachMm > 0 ? `!${fmt(a.wallBreachMm)}` : "  ok  ";
  const aisleStatus =
    a.worstAisleMm === Number.POSITIVE_INFINITY
      ? "  n/a "
      : a.worstAisleMm < MIN_AISLE_MM
        ? `!${fmt(a.worstAisleMm)}`
        : ` ${fmt(a.worstAisleMm)}`;
  const headStatus =
    a.headClearanceMm === Number.POSITIVE_INFINITY
      ? "  n/a "
      : a.headClearanceMm < MIN_AISLE_MM
        ? `!${fmt(a.headClearanceMm)}`
        : ` ${fmt(a.headClearanceMm)}`;
  const flags = a.crowded ? " [crowded]" : "";

  if (a.wallBreachMm > 0) totalBreaches++;
  if (a.worstAisleMm !== Number.POSITIVE_INFINITY && a.worstAisleMm < MIN_AISLE_MM)
    totalAisleViolations++;
  if (a.headClearanceMm !== Number.POSITIVE_INFINITY && a.headClearanceMm < MIN_AISLE_MM)
    totalHeadViolations++;
  if (a.crowded) totalCrowded++;
  wasteValues.push(a.wasteRatio);

  const idx = `${i + 1}`.padStart(3);
  const name = sc.name.padEnd(40).slice(0, 40);
  const n = `${sc.tables.length}`.padStart(3);
  const room = `${sc.roomWidthMm / 1000}×${sc.roomHeightMm / 1000}`.padStart(7);
  const gridP = grid.padStart(5);
  console.log(
    `${idx}  | ${name} | ${n} | ${room} | ${gridP} | ${wallStatus} | ${aisleStatus} | ${headStatus} | ${fmtPct(
      a.wasteRatio,
    ).padStart(6)}${flags}`,
  );
}

wasteValues.sort((a, b) => a - b);
const median = wasteValues[Math.floor(wasteValues.length / 2)] ?? 0;
console.log("\n─── Summary ───");
console.log(`  scenarios:           ${all.length}`);
console.log(`  wall breaches:       ${totalBreaches}`);
console.log(`  aisle < ${MIN_AISLE_MM}mm:     ${totalAisleViolations}`);
console.log(`  head < ${MIN_AISLE_MM}mm:      ${totalHeadViolations}`);
console.log(`  crowded fallbacks:   ${totalCrowded}`);
console.log(`  median space waste:  ${fmtPct(median)}`);
console.log(`  max space waste:     ${fmtPct(wasteValues[wasteValues.length - 1] ?? 0)}`);
console.log(`  min space waste:     ${fmtPct(wasteValues[0] ?? 0)}`);
console.log(
  `\nConstants: WALL_MARGIN=${WALL_MARGIN_MM} HEAD_CLEAR=${HEAD_CLEARANCE_MM} MIN_AISLE=${MIN_AISLE_MM} CHAIR_BACK=${CHAIR_BACK_DEPTH_MM}`,
);
