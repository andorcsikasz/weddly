// Room geometry for the public seating tool: table counts, the even guest
// spread, and chair numbering that matches what the plan draws.

import { describe, expect, it } from "bun:test";
import {
  chairOffsets,
  guestsPerTable,
  planRoom,
  TABLE_KINDS,
  TABLE_SPECS,
  tableCountFor,
} from "@/lib/seating_room";

describe("seating room", () => {
  it("needs enough tables for everyone", () => {
    expect(tableCountFor(100, "round8")).toBe(13);
    expect(tableCountFor(100, "round10")).toBe(10);
    expect(tableCountFor(5, "banquet12")).toBe(1);
  });

  it("spreads guests evenly instead of leaving one lonely table", () => {
    const counts = guestsPerTable(100, 13);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("gives every table one chair per seat, numbered 1..n", () => {
    for (const kind of TABLE_KINDS) {
      expect(chairOffsets(TABLE_SPECS[kind])).toHaveLength(TABLE_SPECS[kind].seats);
      const plan = planRoom(123, kind, 4);
      expect(plan.tables).toHaveLength(plan.tableCount);
      const taken = plan.tables.flatMap((t) => t.chairs).filter((c) => c.taken).length;
      expect(taken).toBe(123);
      expect(plan.spare).toBe(plan.totalSeats - 123);
      for (const t of plan.tables) {
        expect(t.chairs.map((c) => c.number)).toEqual(
          Array.from({ length: TABLE_SPECS[kind].seats }, (_, i) => i + 1),
        );
        for (const c of t.chairs) {
          expect(c.x).toBeGreaterThan(0);
          expect(c.x).toBeLessThan(plan.width);
          expect(c.y).toBeLessThan(plan.height);
        }
      }
    }
  });
});
