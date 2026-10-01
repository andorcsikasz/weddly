// Room layout for the public seating-chart tool: how many tables a headcount
// needs, how the guests spread across them, and where every table and chair
// sits in a top-down floor plan. Pure geometry, no React, so the tool's
// pictograms and its final room plan draw from one definition.
//
// Units are centimetres, roughly: a round table of 8 is 150 cm across. That
// keeps the proportions honest enough to read as a real room.

export type TableKind = "round8" | "round10" | "rect10" | "banquet12";

export const TABLE_KINDS: readonly TableKind[] = ["round8", "round10", "rect10", "banquet12"];

interface RoundSpec {
  shape: "round";
  seats: number;
  radius: number;
}
interface RectSpec {
  shape: "rect";
  seats: number;
  width: number;
  height: number;
  /** Chairs along each long side; the rest sit one per end. */
  perSide: number;
}
export type TableSpec = RoundSpec | RectSpec;

export const TABLE_SPECS: Record<TableKind, TableSpec> = {
  round8: { shape: "round", seats: 8, radius: 75 },
  round10: { shape: "round", seats: 10, radius: 90 },
  rect10: { shape: "rect", seats: 10, width: 220, height: 90, perSide: 4 },
  banquet12: { shape: "rect", seats: 12, width: 290, height: 85, perSide: 5 },
};

export const CHAIR_R = 20;
/** Gap between the table edge and a chair's centre. */
const CHAIR_GAP = 32;
/** Walking space around each table, on top of its chairs. */
const AISLE = 70;

export interface Chair {
  x: number;
  y: number;
  /** 1-based, clockwise from the top (or the top-left of a long table). */
  number: number;
  taken: boolean;
}

export interface PlacedTable {
  number: number;
  cx: number;
  cy: number;
  spec: TableSpec;
  guests: number;
  chairs: Chair[];
}

export interface RoomPlan {
  width: number;
  height: number;
  danceFloor: { x: number; y: number; width: number; height: number };
  tables: PlacedTable[];
  tableCount: number;
  totalSeats: number;
  spare: number;
}

export function tableCountFor(guests: number, kind: TableKind): number {
  return Math.max(1, Math.ceil(guests / TABLE_SPECS[kind].seats));
}

/** Footprint of one table with its chairs and aisle, as a grid cell. */
export function cellSize(spec: TableSpec): { w: number; h: number } {
  const reach = CHAIR_GAP + CHAIR_R;
  if (spec.shape === "round") {
    const d = 2 * (spec.radius + reach) + AISLE;
    return { w: d, h: d };
  }
  return { w: spec.width + 2 * reach + AISLE, h: spec.height + 2 * reach + AISLE };
}

/** Chair centres relative to the table centre, clockwise from the top. */
export function chairOffsets(spec: TableSpec): { x: number; y: number }[] {
  if (spec.shape === "round") {
    const ring = spec.radius + CHAIR_GAP;
    return Array.from({ length: spec.seats }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / spec.seats;
      return { x: Math.round(ring * Math.cos(a)), y: Math.round(ring * Math.sin(a)) };
    });
  }
  const { width, height, perSide } = spec;
  const step = width / perSide;
  const xs = Array.from({ length: perSide }, (_, i) => -width / 2 + step * (i + 0.5));
  const top = xs.map((x) => ({ x, y: -height / 2 - CHAIR_GAP }));
  const right = { x: width / 2 + CHAIR_GAP, y: 0 };
  const bottom = [...xs].reverse().map((x) => ({ x, y: height / 2 + CHAIR_GAP }));
  const left = { x: -width / 2 - CHAIR_GAP, y: 0 };
  return [...top, right, ...bottom, left];
}

/**
 * Guests spread evenly, the way a planner seats a room: 100 guests at tables
 * of 8 is 13 tables of 7 or 8, never twelve full tables and one lonely guest.
 */
export function guestsPerTable(guests: number, tables: number): number[] {
  const base = Math.floor(guests / tables);
  const extra = guests % tables;
  return Array.from({ length: tables }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Lays the tables out in a grid sized to the column count the caller can
 * fit, with a dance floor across the top. The last row is centred.
 */
export function planRoom(guests: number, kind: TableKind, columns: number): RoomPlan {
  const spec = TABLE_SPECS[kind];
  const tableCount = tableCountFor(guests, kind);
  const cols = Math.max(1, Math.min(columns, tableCount));
  const rows = Math.ceil(tableCount / cols);
  const cell = cellSize(spec);
  const pad = 40;
  const floorH = 150;
  const width = cols * cell.w + 2 * pad;
  const top = pad + floorH + 40;
  const height = top + rows * cell.h + pad;
  const counts = guestsPerTable(guests, tableCount);
  const offsets = chairOffsets(spec);

  const tables: PlacedTable[] = counts.map((n, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? tableCount - row * cols : cols;
    const rowShift = ((cols - inRow) * cell.w) / 2;
    const cx = pad + rowShift + col * cell.w + cell.w / 2;
    const cy = top + row * cell.h + cell.h / 2;
    return {
      number: i + 1,
      cx,
      cy,
      spec,
      guests: n,
      chairs: offsets.map((o, c) => ({ x: cx + o.x, y: cy + o.y, number: c + 1, taken: c < n })),
    };
  });

  const floorW = Math.min(width - 2 * pad, Math.max(360, cell.w * 2));
  return {
    width,
    height,
    danceFloor: { x: (width - floorW) / 2, y: pad, width: floorW, height: floorH },
    tables,
    tableCount,
    totalSeats: tableCount * spec.seats,
    spare: tableCount * spec.seats - guests,
  };
}
