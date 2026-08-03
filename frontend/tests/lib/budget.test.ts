// Guards the concurrency contract behind the budget panel's slider saves.
// The reported bug was "a row jumps back to its pre-edit value when I start
// editing another row": every category write rebuilt the whole `lines` array
// from a snapshot captured before the concurrent edit, so whichever save
// resolved last silently reverted the other one. The plan/commit split plus
// merge-by-id is what fixes it — these tests pin the pure half of that.

import type { BudgetCategory, BudgetLine } from "@shared/types";
import { describe, expect, it } from "bun:test";
import {
  createBudgetWriteQueue,
  isNoopPlan,
  mergeLines,
  planCategoryPaid,
  planCategoryPlanned,
  supplierManagedCategories,
} from "@/lib/budget";

function line(id: number, category: BudgetCategory, planned: number, actual = 0): BudgetLine {
  return {
    id,
    couple_id: 1,
    category,
    label: category,
    planned_huf: planned,
    actual_huf: actual,
    paid_huf: 0,
    supplier_id: null,
    couple_supplier_id: null,
    listing_id: null,
    notes: null,
    per_guest: false,
    icon: null,
    created_at: 0,
    updated_at: 100,
  };
}

describe("planCategoryPlanned", () => {
  it("updates the single line in a category", () => {
    const lines = [line(1, "venue", 300_000), line(2, "catering", 900_000)];
    const plan = planCategoryPlanned("venue", 500_000, lines, "Venue");
    expect(plan.create).toBeNull();
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.id).toBe(1);
    expect(plan.updates[0]?.planned_huf).toBe(500_000);
  });

  it("scales several lines proportionally and folds drift into the first", () => {
    const lines = [line(1, "decor_floral", 100_000), line(2, "decor_floral", 200_000)];
    const plan = planCategoryPlanned("decor_floral", 100_001, lines, "Decor");
    const total = plan.updates.reduce((s, l) => s + l.planned_huf, 0);
    expect(total).toBe(100_001);
  });

  it("asks for a create when the category owns no line yet", () => {
    const plan = planCategoryPlanned("rings", 75_000, [], "Rings");
    expect(plan.updates).toHaveLength(0);
    expect(plan.create).toEqual({
      category: "rings",
      label: "Rings",
      planned_huf: 75_000,
      actual_huf: 0,
    });
  });

  it("is a no-op when the slider is released on the value already stored", () => {
    const lines = [line(1, "venue", 300_000)];
    expect(isNoopPlan(planCategoryPlanned("venue", 300_000, lines, "Venue"))).toBe(true);
  });

  it("leaves rows outside the category alone", () => {
    const lines = [line(1, "venue", 300_000), line(2, "catering", 900_000)];
    const plan = planCategoryPlanned("venue", 400_000, lines, "Venue");
    expect(plan.updates.map((l) => l.id)).toEqual([1]);
  });
});

/** A line mirroring a booked supplier's own record. `PATCH /api/budget/lines/
 *  :id` answers `409 {code:"locked"}` for one of these, so a plan that names
 *  it is a save that cannot land. */
function mirrored(l: BudgetLine, supplierId = "sup-1"): BudgetLine {
  return { ...l, couple_supplier_id: supplierId };
}

describe("planCategoryPlanned against supplier-mirrored lines", () => {
  // The bug: this planner was the only one of the three that did not filter
  // mirrored rows, so the planned slider for any category fed by a booked
  // supplier planned a PATCH the server refuses — a guaranteed 409 on every
  // drag, with the control offered as if nothing were wrong.
  it("scales the free lines only and never names the mirrored one", () => {
    const lines = [mirrored(line(1, "venue", 300_000)), line(2, "venue", 100_000)];
    const plan = planCategoryPlanned("venue", 250_000, lines, "Venue");
    expect(plan.create).toBeNull();
    expect(plan.updates.map((l) => l.id)).toEqual([2]);
    expect(plan.updates[0]?.planned_huf).toBe(250_000);
  });

  it("plans nothing when every line in the category belongs to a supplier", () => {
    const lines = [
      mirrored(line(1, "photo_video", 300_000)),
      mirrored(line(2, "photo_video", 120_000), "sup-2"),
    ];
    const plan = planCategoryPlanned("photo_video", 900_000, lines, "Photo");
    expect(isNoopPlan(plan)).toBe(true);
    expect(plan.updates).toHaveLength(0);
  });

  it("does not invent a free line to absorb a supplier-owned category", () => {
    // Falling through to the create branch would add the whole new total on
    // TOP of the supplier's amount, so the bucket would land on 300k + 900k
    // and the slider would read as having done something else entirely.
    const plan = planCategoryPlanned("venue", 900_000, [mirrored(line(1, "venue", 300_000))], "V");
    expect(plan.create).toBeNull();
  });

  it("still creates the first line for a category that owns none", () => {
    // The create branch is about an EMPTY category, and a supplier-owned one
    // is not empty. Guarding the regression in the other direction.
    const plan = planCategoryPlanned("rings", 75_000, [mirrored(line(1, "venue", 300_000))], "R");
    expect(plan.create?.planned_huf).toBe(75_000);
  });
});

describe("supplierManagedCategories", () => {
  it("locks a category as soon as one of its lines is mirrored", () => {
    const lines = [mirrored(line(1, "venue", 300_000)), line(2, "venue", 100_000)];
    expect(supplierManagedCategories(lines).has("venue")).toBe(true);
  });

  it("leaves a category the couple owns outright alone", () => {
    const lines = [mirrored(line(1, "venue", 300_000)), line(2, "catering", 900_000)];
    const locked = supplierManagedCategories(lines);
    expect(locked.has("catering")).toBe(false);
    expect([...locked]).toEqual(["venue"]);
  });

  it("is empty for a budget with no booked suppliers", () => {
    expect(supplierManagedCategories([line(1, "venue", 300_000)]).size).toBe(0);
  });
});

describe("planCategoryPaid", () => {
  it("never plans a paid amount above the row's own actual", () => {
    const lines = [line(1, "venue", 300_000, 120_000)];
    const plan = planCategoryPaid("venue", 500_000, lines);
    expect(plan.updates[0]?.paid_huf).toBe(120_000);
  });

  it("skips DIY-supplier-owned rows", () => {
    const diy = { ...line(1, "venue", 300_000, 300_000), couple_supplier_id: "9" };
    expect(planCategoryPaid("venue", 100_000, [diy]).updates).toHaveLength(0);
  });
});

describe("mergeLines", () => {
  it("merges by id and keeps untouched rows as they were", () => {
    const prev = [line(1, "venue", 300_000), line(2, "catering", 900_000)];
    // Row 2 was edited elsewhere while row 1's save was in flight — merging
    // row 1's response must not drag row 2 back to its old amount.
    const withEdit = [
      prev[0] as BudgetLine,
      { ...(prev[1] as BudgetLine), planned_huf: 1_200_000 },
    ];
    const merged = mergeLines(withEdit, [{ ...(prev[0] as BudgetLine), planned_huf: 500_000 }]);
    expect(merged.find((l) => l.id === 1)?.planned_huf).toBe(500_000);
    expect(merged.find((l) => l.id === 2)?.planned_huf).toBe(1_200_000);
  });

  it("appends rows the list doesn't know yet", () => {
    const merged = mergeLines([line(1, "venue", 300_000)], [line(7, "rings", 75_000)]);
    expect(merged.map((l) => l.id)).toEqual([1, 7]);
  });

  it("returns the same array when there is nothing to merge", () => {
    const prev = [line(1, "venue", 300_000)];
    expect(mergeLines(prev, [])).toBe(prev);
  });
});

describe("createBudgetWriteQueue", () => {
  it("runs same-key writes in order", async () => {
    const queue = createBudgetWriteQueue();
    const order: string[] = [];
    const slow = queue.run("cat:venue", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("first");
    });
    const fast = queue.run("cat:venue", async () => {
      order.push("second");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["first", "second"]);
  });

  it("marks a superseded write as no longer the latest", async () => {
    const queue = createBudgetWriteQueue();
    const first = queue.run("cat:venue", async () => "old");
    const second = queue.run("cat:venue", async () => "new");
    expect((await first).latest).toBe(false);
    expect((await second).latest).toBe(true);
  });

  it("keeps different keys independent", async () => {
    const queue = createBudgetWriteQueue();
    const a = await queue.run("cat:venue", async () => "a");
    const b = await queue.run("cat:catering", async () => "b");
    expect(a.latest).toBe(true);
    expect(b.latest).toBe(true);
  });

  it("does not strand the queue when a write fails", async () => {
    const queue = createBudgetWriteQueue();
    const failed = queue.run("cat:venue", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    const after = await queue.run("cat:venue", async () => "ok");
    expect(after.result).toBe("ok");
  });
});
