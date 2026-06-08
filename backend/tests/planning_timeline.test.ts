import "./setup";
import { describe, expect, test } from "bun:test";
import {
  WEDDING_TIMELINE,
  summarizeTimeline,
  timelineDatesFor,
  timelineStatus,
} from "@shared/planning_timeline";

describe("timelineDatesFor", () => {
  test("subtracts whole months on a calendar basis", () => {
    // 6 months before 2026-09-12 → 2026-03-12.
    const r = timelineDatesFor("2026-09-12", { lead: { months: 6 }, windowDays: 30 });
    expect(r).not.toBeNull();
    expect(r?.due_date).toBe("2026-03-12");
    // start_date = due − windowDays.
    expect(r?.start_date).toBe("2026-02-10");
  });

  test("clamps the day on short target months", () => {
    // 2026-03-31 − 1 month must land on Feb 28, not roll into March.
    const r = timelineDatesFor("2026-03-31", { lead: { months: 1 }, windowDays: 0 });
    expect(r?.due_date).toBe("2026-02-28");
  });

  test("subtracts exact days for short-fuse tasks", () => {
    const r = timelineDatesFor("2026-09-12", { lead: { days: 42 }, windowDays: 21 });
    expect(r?.due_date).toBe("2026-08-01");
    expect(r?.start_date).toBe("2026-07-11");
  });

  test("returns null when the wedding date is missing or malformed", () => {
    expect(timelineDatesFor(null, { lead: { months: 6 }, windowDays: 30 })).toBeNull();
    expect(timelineDatesFor("", { lead: { months: 6 }, windowDays: 30 })).toBeNull();
    expect(timelineDatesFor("2026-13-01", { lead: { months: 6 }, windowDays: 30 })).toBeNull();
    expect(timelineDatesFor("2026-02-30", { lead: { months: 1 }, windowDays: 0 })).toBeNull();
  });

  test("every template item resolves against a real wedding date", () => {
    for (const item of WEDDING_TIMELINE) {
      const r = timelineDatesFor("2027-06-05", item);
      expect(r, item.key).not.toBeNull();
      // start is on or before due.
      expect(r!.start_date <= r!.due_date, item.key).toBe(true);
    }
  });

  test("template keys are unique", () => {
    const keys = WEDDING_TIMELINE.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("timelineStatus", () => {
  const today = "2026-06-08";

  test("done wins regardless of date", () => {
    expect(timelineStatus("2026-01-01", true, today)).toBe("done");
    expect(timelineStatus(null, true, today)).toBe("done");
  });

  test("no due date is undated", () => {
    expect(timelineStatus(null, false, today)).toBe("undated");
  });

  test("a past due date is overdue", () => {
    expect(timelineStatus("2026-06-07", false, today)).toBe("overdue");
  });

  test("within the horizon is due_soon, on the boundary inclusive", () => {
    expect(timelineStatus("2026-06-08", false, today)).toBe("due_soon"); // today
    expect(timelineStatus("2026-06-29", false, today, 21)).toBe("due_soon"); // +21 boundary
  });

  test("beyond the horizon is upcoming", () => {
    expect(timelineStatus("2026-06-30", false, today, 21)).toBe("upcoming");
  });
});

describe("summarizeTimeline", () => {
  test("counts overdue + due_soon and ignores done/upcoming/undated", () => {
    const today = "2026-06-08";
    const tasks = [
      { due_date: "2026-05-01", done: false }, // overdue
      { due_date: "2026-04-01", done: true }, // done → ignored
      { due_date: "2026-06-10", done: false }, // due_soon
      { due_date: "2026-12-01", done: false }, // upcoming
      { due_date: null, done: false }, // undated → ignored
    ];
    expect(summarizeTimeline(tasks, today)).toEqual({
      overdue: 1,
      dueSoon: 1,
      needsAttention: 2,
    });
  });
});
