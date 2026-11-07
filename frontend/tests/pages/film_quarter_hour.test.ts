import { describe, expect, test } from "bun:test";
import { snapToQuarterHour } from "../../src/pages/MediaPage";

describe("film times snap to the quarter hour", () => {
  test("rounds to the nearest 00, 15, 30 or 45", () => {
    expect(snapToQuarterHour("2026-10-17T12:07")).toBe("2026-10-17T12:00");
    expect(snapToQuarterHour("2026-10-17T12:08")).toBe("2026-10-17T12:15");
    expect(snapToQuarterHour("2026-10-17T12:44")).toBe("2026-10-17T12:45");
    expect(snapToQuarterHour("2026-10-17T12:30")).toBe("2026-10-17T12:30");
  });
  test("rolls over the hour and the day", () => {
    expect(snapToQuarterHour("2026-10-17T12:53")).toBe("2026-10-17T13:00");
    expect(snapToQuarterHour("2026-10-17T23:58")).toBe("2026-10-18T00:00");
  });
  test("leaves an empty or broken value alone", () => {
    expect(snapToQuarterHour("")).toBe("");
    expect(snapToQuarterHour("nope")).toBe("nope");
  });
});
