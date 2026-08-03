// The task packs are shared data with two consumers that must agree: the
// schedule wizard reads their lead times, and /app/honeymoon writes their
// titles into planning_items. These pin the couplings that are easy to break
// by editing the data alone.

import "./setup";
import { describe, expect, test } from "bun:test";
import {
  ALL_TASK_PACK_ITEMS,
  HONEYMOON_EXTRA_TASKS,
  HONEYMOON_FLIGHTS_TASK,
  packDueDate,
  TASK_TEMPLATE,
  TASK_TEMPLATE_GROUPS,
} from "@shared/planning_task_packs";

describe("planning task packs: the canonical honeymoon flights task", () => {
  test("resolves, and is a real member of the pack rather than a copy", () => {
    expect(HONEYMOON_FLIGHTS_TASK).toBeTruthy();
    // Identity, not deep equality: the flight-offer save dedupes against this
    // object's titles, so a detached copy would drift the moment the pack is
    // edited.
    expect(ALL_TASK_PACK_ITEMS).toContain(HONEYMOON_FLIGHTS_TASK);
  });

  test("carries both authored titles, which is what makes the dedupe locale-proof", () => {
    // Both writers freeze an ALREADY-LOCALIZED string into planning_items.title,
    // so the only way to recognise "the couple already has this task" across a
    // language switch is to compare against both.
    expect(HONEYMOON_FLIGHTS_TASK.title.hu.length).toBeGreaterThan(0);
    expect(HONEYMOON_FLIGHTS_TASK.title.en.length).toBeGreaterThan(0);
    expect(HONEYMOON_FLIGHTS_TASK.title.hu).not.toBe(HONEYMOON_FLIGHTS_TASK.title.en);
  });

  test("exactly one pack item claims the flights slot", () => {
    // The lookup is by EN title. Two items answering to it would make which one
    // wins an accident of ordering.
    const matches = ALL_TASK_PACK_ITEMS.filter((i) => i.title.en === "Book flights");
    expect(matches).toHaveLength(1);
  });

  test("it sits in the honeymoon group, not the wedding one", () => {
    const honeymoon = TASK_TEMPLATE_GROUPS.find((g) => g.id === "honeymoon");
    expect(honeymoon?.items).toContain(HONEYMOON_FLIGHTS_TASK);
  });
});

describe("planning task packs: lead times", () => {
  test("every pack item carries a lead, so none falls back to a shared date", () => {
    // A missing deadline_days is invisible in the UI and shows up only as the
    // wizard proposing one identical date for a whole group of tasks.
    for (const item of ALL_TASK_PACK_ITEMS) {
      expect(typeof item.deadline_days).toBe("number");
      expect(Number.isFinite(item.deadline_days)).toBe(true);
    }
  });

  test("leads are days BEFORE the wedding, never after", () => {
    for (const item of ALL_TASK_PACK_ITEMS) {
      expect(item.deadline_days).toBeLessThanOrEqual(0);
    }
  });

  test("the honeymoon reserve is spread, not stacked on one day", () => {
    const distinct = new Set(HONEYMOON_EXTRA_TASKS.map((i) => i.deadline_days));
    expect(HONEYMOON_EXTRA_TASKS.length).toBeGreaterThan(1);
    expect(distinct.size).toBeGreaterThan(1);
  });

  test("no duplicate titles across the whole pool", () => {
    // Two items with one title would give the couple the same row twice from a
    // single apply, which is the bug class this pack keeps reintroducing.
    const en = ALL_TASK_PACK_ITEMS.map((i) => i.title.en);
    const hu = ALL_TASK_PACK_ITEMS.map((i) => i.title.hu);
    expect(new Set(en).size).toBe(en.length);
    expect(new Set(hu).size).toBe(hu.length);
  });

  test("ALL_TASK_PACK_ITEMS is exactly the groups plus the reserve", () => {
    expect(ALL_TASK_PACK_ITEMS).toHaveLength(TASK_TEMPLATE.length + HONEYMOON_EXTRA_TASKS.length);
  });
});

describe("planning task packs: packDueDate", () => {
  test("counts backwards from the wedding", () => {
    expect(packDueDate("2027-06-05", -150)).toBe("2027-01-06");
    expect(packDueDate("2027-06-05", -3)).toBe("2027-06-02");
    expect(packDueDate("2027-06-05", 0)).toBe("2027-06-05");
  });

  test("crosses a year boundary rather than clamping inside the month", () => {
    expect(packDueDate("2027-01-10", -30)).toBe("2026-12-11");
  });

  test("handles a leap day without drifting", () => {
    expect(packDueDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  test("no wedding date means no due date, never today", () => {
    // A lead time with nothing to measure from is not a deadline. Dating the
    // row anyway would hand the couple a task that reads as already overdue.
    expect(packDueDate(null, -90)).toBeNull();
    expect(packDueDate(undefined, -90)).toBeNull();
    expect(packDueDate("", -90)).toBeNull();
  });

  test("an unparseable date is null rather than Invalid Date", () => {
    expect(packDueDate("not-a-date", -30)).toBeNull();
  });

  test("every pack item yields a date on or before the wedding", () => {
    const wedding = "2027-06-05";
    for (const item of ALL_TASK_PACK_ITEMS) {
      const due = packDueDate(wedding, item.deadline_days);
      expect(due).not.toBeNull();
      expect(String(due) <= wedding).toBe(true);
    }
  });
});
