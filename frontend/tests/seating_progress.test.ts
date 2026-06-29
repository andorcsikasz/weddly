// Unit coverage for the seat-mode progress + naming helpers added with the
// seating UX audit pass. Pure functions, so we lock the edge cases that drive
// the on-screen summary bar and the "name this table" nudge.

import { describe, expect, test } from "bun:test";
import { isDefaultTableLabel, seatingProgress } from "../../shared/seating";

describe("seatingProgress", () => {
  test("typical partial fill rounds the percent", () => {
    const p = seatingProgress(22, 3);
    expect(p).toEqual({ seated: 3, total: 22, remaining: 19, pct: 14, complete: false });
  });

  test("everyone seated reports complete", () => {
    const p = seatingProgress(10, 10);
    expect(p.remaining).toBe(0);
    expect(p.pct).toBe(100);
    expect(p.complete).toBe(true);
  });

  test("no guests never produces NaN or a false 'complete'", () => {
    const p = seatingProgress(0, 0);
    expect(p).toEqual({ seated: 0, total: 0, remaining: 0, pct: 0, complete: false });
  });

  test("seated is clamped to total even if the count overshoots", () => {
    const p = seatingProgress(5, 9);
    expect(p.seated).toBe(5);
    expect(p.remaining).toBe(0);
    expect(p.complete).toBe(true);
  });

  test("negative inputs are floored to zero", () => {
    const p = seatingProgress(-3, -1);
    expect(p).toEqual({ seated: 0, total: 0, remaining: 0, pct: 0, complete: false });
  });
});

describe("isDefaultTableLabel", () => {
  test("matches the auto-generated '<prefix> <n>' shape", () => {
    expect(isDefaultTableLabel("Table 4", "Table")).toBe(true);
    expect(isDefaultTableLabel("Asztal 12", "Asztal")).toBe(true);
    expect(isDefaultTableLabel("  Table 7  ", "Table")).toBe(true);
    expect(isDefaultTableLabel("table 3", "Table")).toBe(true); // case-insensitive
  });

  test("leaves meaningful names alone", () => {
    expect(isDefaultTableLabel("Family", "Table")).toBe(false);
    expect(isDefaultTableLabel("Table of friends", "Table")).toBe(false);
    expect(isDefaultTableLabel("Head table", "Table")).toBe(false);
    expect(isDefaultTableLabel("Table", "Table")).toBe(false); // no number
  });
});
