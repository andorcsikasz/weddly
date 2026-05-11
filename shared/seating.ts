// Pure geometry helpers for the seating layout. Used by both the PDF
// renderer (units = PDF points) and the on-screen floor-plan map (units =
// SVG user units). Callers pass in half-dimensions in their own unit; the
// returned chair offsets come back in the same unit.

import type { TableShape } from "./types";

/** Standard chair width in mm — used as the pitch when computing how many
 *  seats fit around a given table. Real banquet chairs sit ~50 cm wide,
 *  but 80 cm of perimeter per chair leaves enough elbow-room that nobody
 *  is bumping arms with their neighbour. */
export const CHAIR_PITCH_MM = 800;

/** Standard banquet defaults for each shape, in millimetres. The editor
 *  snaps to these whenever the user switches shape; the backend uses them
 *  to fill in width/length when the client doesn't send any.
 *
 *  - Round  → Ø 1500  (8-seat banquet round).
 *  - Square → 1600 × 1600.
 *  - Long   → 800 × 1600 (rectangle, "tégla asztal").
 *  - Head   → 900 × 4000 (wider so the whole bridal party fits). */
export function defaultDimsForShape(shape: TableShape): { width_mm: number; length_mm: number } {
  if (shape === "long") return { width_mm: 800, length_mm: 1600 };
  if (shape === "head") return { width_mm: 900, length_mm: 4000 };
  if (shape === "square") return { width_mm: 1600, length_mm: 1600 };
  return { width_mm: 1500, length_mm: 1500 };
}

/** Soft cap on seats given a table's footprint. Round → circumference /
 *  pitch. Head → one long side / pitch (chairs only on the front edge).
 *  Long / Square → full perimeter / pitch. Always at least 1. */
export function maxSeatsForTable(shape: TableShape, width_mm: number, length_mm: number): number {
  if (shape === "round") {
    return Math.max(1, Math.floor((Math.PI * width_mm) / CHAIR_PITCH_MM));
  }
  if (shape === "head") {
    return Math.max(1, Math.floor(length_mm / CHAIR_PITCH_MM));
  }
  return Math.max(1, Math.floor((2 * length_mm + 2 * width_mm) / CHAIR_PITCH_MM));
}

export interface ChairOffset {
  /** Offset from the table centre to the chair centre. */
  dx: number;
  dy: number;
  /** Outward angle from the table centre, in radians. Useful for rotating
   *  a label so it always reads "outwards". */
  angle: number;
}

/** Chair positions around a table, indexed by seat_index (0-based). The
 *  result has exactly `seats` entries even when the table is empty.
 *
 *  Layout per shape:
 *    - round: chairs evenly spaced on the circle of radius rx (= ry).
 *    - square: chairs distributed proportionally across all four sides.
 *    - long: chairs distributed across the two long sides first, with the
 *            two short ends used only when seats > 2 × (long-side capacity)
 *            would otherwise force people uncomfortably close together. We
 *            use a simple rule: at most 1 chair per ~600mm of side. */
export function chairOffsets(
  shape: TableShape,
  seats: number,
  rx: number,
  ry: number,
): ChairOffset[] {
  if (seats <= 0) return [];

  if (shape === "round") {
    const r = rx;
    const out: ChairOffset[] = [];
    for (let i = 0; i < seats; i++) {
      // Start at the top (angle = -π/2) and go clockwise. Chair 1 at top
      // matches how people draw seating plans on paper.
      const angle = -Math.PI / 2 + (i / seats) * Math.PI * 2;
      out.push({ dx: Math.cos(angle) * r, dy: Math.sin(angle) * r, angle });
    }
    return out;
  }

  if (shape === "head") {
    // Head table — guests of honour sit along ONE long side facing the room.
    // Chairs are placed only on the front (top, north) long edge, evenly
    // distributed across the full width. The back of the table sits against
    // a wall / backdrop with no chairs.
    const out: ChairOffset[] = [];
    const longSide = rx * 2;
    for (let i = 0; i < seats; i++) {
      const t = (i + 0.5) / seats;
      out.push({ dx: -rx + longSide * t, dy: -ry, angle: -Math.PI / 2 });
    }
    return out;
  }

  // Rectangle (square or long). Allocate seats across the four sides
  // proportionally to side length, with a minimum of 1 per long side when
  // seats >= 2. We treat "long" as oriented horizontally (width along x).
  const longSide = rx * 2;
  const shortSide = ry * 2;
  const totalPerimeter = (longSide + shortSide) * 2;

  // Seats per side. Start from a perimeter-proportional split, then
  // round, then fix up so the totals match `seats`.
  let topCount = Math.round((seats * longSide) / totalPerimeter);
  let bottomCount = topCount;
  let leftCount = Math.round((seats * shortSide) / totalPerimeter);
  let rightCount = leftCount;
  let total = topCount + bottomCount + leftCount + rightCount;
  // Fix-up: if rounding produced too few/many, adjust the longest sides
  // first so wide tables stay visually balanced.
  while (total < seats) {
    if (longSide >= shortSide) {
      topCount++;
      bottomCount++;
      total += 2;
    } else {
      leftCount++;
      rightCount++;
      total += 2;
    }
    if (total > seats) {
      // Overshoot by 1 — drop one from the smallest side.
      if (rightCount > 0) {
        rightCount--;
        total--;
      } else if (bottomCount > 0) {
        bottomCount--;
        total--;
      }
    }
  }
  while (total > seats) {
    if (shortSide <= longSide && leftCount + rightCount > 0) {
      if (leftCount > 0) {
        leftCount--;
      } else {
        rightCount--;
      }
    } else if (topCount + bottomCount > 0) {
      if (topCount > 0) {
        topCount--;
      } else {
        bottomCount--;
      }
    } else {
      break;
    }
    total--;
  }

  const out: ChairOffset[] = [];
  // Top edge (y = -ry), left → right.
  for (let i = 0; i < topCount; i++) {
    const t = (i + 0.5) / topCount;
    out.push({ dx: -rx + longSide * t, dy: -ry, angle: -Math.PI / 2 });
  }
  // Right edge (x = +rx), top → bottom.
  for (let i = 0; i < rightCount; i++) {
    const t = (i + 0.5) / rightCount;
    out.push({ dx: rx, dy: -ry + shortSide * t, angle: 0 });
  }
  // Bottom edge (y = +ry), right → left (so seat numbers walk around).
  for (let i = 0; i < bottomCount; i++) {
    const t = (i + 0.5) / bottomCount;
    out.push({ dx: rx - longSide * t, dy: ry, angle: Math.PI / 2 });
  }
  // Left edge (x = -rx), bottom → top.
  for (let i = 0; i < leftCount; i++) {
    const t = (i + 0.5) / leftCount;
    out.push({ dx: -rx, dy: ry - shortSide * t, angle: Math.PI });
  }
  return out;
}
