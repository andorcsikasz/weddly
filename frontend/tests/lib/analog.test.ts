import { describe, expect, test } from "bun:test";
import { analogCurves, analogize, dateStamp } from "../../src/lib/analog";

describe("analog film look", () => {
  test("lifts the blacks and rolls off the whites", () => {
    const { r, g, b } = analogCurves();
    for (const c of [r, g, b]) {
      expect(c[0] as number).toBeGreaterThan(8);
      expect(c[255] as number).toBeLessThan(252);
    }
  });

  test("warms highlights and cools shadows", () => {
    const { r, b } = analogCurves();
    expect(r[230] as number).toBeGreaterThan(b[230] as number);
    expect(b[20] as number).toBeGreaterThan(r[20] as number);
  });

  test("darkens corners more than the centre, and adds grain", () => {
    const w = 41;
    const h = 41;
    const data = new Uint8ClampedArray(w * h * 4).fill(128);
    analogize(data, w, h, 42);
    const at = (x: number, y: number) => data[(y * w + x) * 4 + 1] as number;
    const avg = (pts: [number, number][]) =>
      pts.reduce((s, [x, y]) => s + at(x, y), 0) / pts.length;
    const centre = avg([
      [20, 20],
      [19, 20],
      [21, 20],
      [20, 19],
      [20, 21],
    ]);
    const corners = avg([
      [0, 0],
      [40, 0],
      [0, 40],
      [40, 40],
      [1, 1],
    ]);
    expect(corners).toBeLessThan(centre - 15);
    const row = Array.from({ length: 9 }, (_, i) => at(16 + i, 20));
    expect(new Set(row).size).toBeGreaterThan(1);
  });

  test("same seed, same grain", () => {
    const a = new Uint8ClampedArray(16 * 16 * 4).fill(100);
    const b = new Uint8ClampedArray(16 * 16 * 4).fill(100);
    analogize(a, 16, 16, 7);
    analogize(b, 16, 16, 7);
    expect(a).toEqual(b);
  });

  test("prints the date like a film back", () => {
    expect(dateStamp(new Date(2026, 10, 6))).toBe("'26 11 06");
  });
});
