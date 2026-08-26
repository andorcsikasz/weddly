import "./setup";
import { describe, expect, test } from "bun:test";
import {
  TIMELINE_PHASES,
  WEDDING_TIMELINE,
  compressLeadDays,
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

  test("every item belongs to a known phase, and every phase has items", () => {
    const phaseIds = new Set(TIMELINE_PHASES.map((p) => p.id));
    for (const item of WEDDING_TIMELINE) {
      expect(phaseIds.has(item.phase), item.key).toBe(true);
    }
    for (const phase of TIMELINE_PHASES) {
      const count = WEDDING_TIMELINE.filter((i) => i.phase === phase.id).length;
      expect(count, phase.id).toBeGreaterThan(0);
    }
  });

  test("with todayIso, a short runway compresses the lead instead of landing in the past", () => {
    // Wedding is only 90 days out; a naive 450-day lead would be 360 days in
    // the past. Compressed, the due date must land between today and the
    // wedding day.
    const r = timelineDatesFor(
      "2026-09-12",
      { lead: { days: 450 }, windowDays: 0 },
      { todayIso: "2026-06-14" },
    );
    expect(r).not.toBeNull();
    expect(r!.due_date >= "2026-06-14").toBe(true);
    expect(r!.due_date <= "2026-09-12").toBe(true);
  });

  test("with todayIso, a lead that already lands in the future is untouched", () => {
    // Plenty of runway (200 days) for a 30-day lead — no compression needed.
    const withToday = timelineDatesFor(
      "2026-09-12",
      { lead: { days: 30 }, windowDays: 0 },
      { todayIso: "2026-02-24" },
    );
    const withoutToday = timelineDatesFor("2026-09-12", { lead: { days: 30 }, windowDays: 0 });
    expect(withToday?.due_date).toBe(withoutToday?.due_date);
  });

  test("without todayIso, the plain calendar subtraction is unchanged (may land in the past)", () => {
    const r = timelineDatesFor("2026-09-12", { lead: { days: 450 }, windowDays: 0 });
    expect(r?.due_date).toBe("2025-06-19");
  });

  test("full standard runway (450+ days) needs no compression", () => {
    const r = timelineDatesFor(
      "2028-01-01",
      { lead: { days: 450 }, windowDays: 0 },
      { todayIso: "2026-06-01" },
    );
    expect(r?.due_date).toBe("2026-10-08");
  });

  test("a compressed item's due date is never later than an unclamped item that naturally comes after it", () => {
    // Wedding 100 days out. A "6-9 months before" item (315-day lead) has to
    // clamp; a "2-3 months before" item (75-day lead) fits on its own and
    // must keep its natural, later due date. The clamped (earlier-phase) item
    // must still land on or before the untouched (later-phase) one.
    const opts = { todayIso: "2026-06-14" };
    const early = timelineDatesFor("2026-09-12", { lead: { days: 315 }, windowDays: 0 }, opts);
    const late = timelineDatesFor("2026-09-12", { lead: { days: 75 }, windowDays: 0 }, opts);
    expect(early?.due_date).toBe("2026-06-14"); // clamped to today
    expect(late?.due_date).toBe("2026-06-29"); // untouched: 2026-09-12 − 75 days
    expect(early!.due_date <= late!.due_date).toBe(true);
  });

  test("every WEDDING_TIMELINE item stays within [today, wedding day] on a tight runway", () => {
    const todayIso = "2026-06-14";
    const weddingIso = "2026-09-12"; // 90 days out
    for (const item of WEDDING_TIMELINE) {
      const r = timelineDatesFor(weddingIso, item, { todayIso });
      expect(r, item.key).not.toBeNull();
      expect(r!.due_date >= todayIso, item.key).toBe(true);
      expect(r!.due_date <= weddingIso, item.key).toBe(true);
    }
  });

  test("items are grouped by phase in runway order", () => {
    // The array order must keep each phase's items contiguous so the generator
    // can render grouped sections straight from WEDDING_TIMELINE.
    const order = TIMELINE_PHASES.map((p) => p.id);
    const seen: string[] = [];
    for (const item of WEDDING_TIMELINE) {
      if (seen[seen.length - 1] !== item.phase) seen.push(item.phase);
    }
    expect(seen).toEqual(order.filter((id) => seen.includes(id)));
    // no phase appears in two separate runs
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("compressLeadDays", () => {
  test("never touches a zero or negative lead (day-of / after-wedding tasks)", () => {
    expect(compressLeadDays(0, 10)).toBe(0);
    expect(compressLeadDays(-7, 10)).toBe(-7);
  });

  test("a lead that already fits inside the runway left is untouched", () => {
    expect(compressLeadDays(450, 450)).toBe(450);
    expect(compressLeadDays(450, 1000)).toBe(450);
    expect(compressLeadDays(30, 60)).toBe(30);
    expect(compressLeadDays(30, 30)).toBe(30);
  });

  test("a lead that doesn't fit clamps to exactly the days left", () => {
    expect(compressLeadDays(450, 100)).toBe(100);
    expect(compressLeadDays(150, 100)).toBe(100);
    expect(compressLeadDays(31, 30)).toBe(30);
  });

  test("clamping can never invert two leads' relative order", () => {
    // A lead that fits (75) must never end up with a smaller compressed value
    // than a lead that had to be clamped down from something much bigger
    // (315) — the exact regression a proportional scale-down against a fixed
    // reference runway used to produce (see the compressLeadDays doc comment).
    const daysLeft = 100;
    const fits = compressLeadDays(75, daysLeft);
    const clamped = compressLeadDays(315, daysLeft);
    expect(fits).toBe(75);
    expect(clamped).toBe(100);
    expect(clamped).toBeGreaterThanOrEqual(fits);
  });

  test("a wedding that's already here or past compresses every positive lead to zero", () => {
    expect(compressLeadDays(450, 0)).toBe(0);
    expect(compressLeadDays(30, -5)).toBe(0);
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
