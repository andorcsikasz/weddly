import { describe, expect, test } from "bun:test";
import {
  type ChecklistColumnLayout,
  type ChecklistLayoutMetric,
  planChecklistPdfPages,
} from "../../src/domain/wedding_checklist_pdf";

function sectionMetrics(sectionIndex: number, heights: number[]): ChecklistLayoutMetric[] {
  return heights.map((height, itemIndex) => ({
    height,
    sectionIndex,
    itemIndex,
    sectionLength: heights.length,
    headerHeight: 10,
    continuationHeaderHeight: 14,
  }));
}

function expectHeaderHasTasks(metrics: ChecklistLayoutMetric[], column: ChecklistColumnLayout) {
  let groupStart = column.start;
  for (let index = column.start + 1; index <= column.end; index += 1) {
    const startsNextGroup =
      index === column.end || metrics[index]?.sectionIndex !== metrics[index - 1]?.sectionIndex;
    if (!startsNextGroup) continue;

    const first = metrics[groupStart];
    if (!first) throw new Error("Missing layout fixture metric");
    const taskCount = index - groupStart;
    const remainingInSection = first.sectionLength - first.itemIndex;
    expect(taskCount).toBeGreaterThanOrEqual(Math.min(2, remainingInSection));
    groupStart = index;
  }
}

describe("wedding checklist PDF pagination", () => {
  test("balances every physical page by measured height without orphaning headings", () => {
    const metrics = [
      ...sectionMetrics(0, [28, 12, 22, 14, 18, 30, 12, 16, 24, 14, 20]),
      ...sectionMetrics(1, [15, 25, 12, 30, 18, 14, 22, 28, 12, 17, 26, 13, 19]),
      ...sectionMetrics(2, [24, 14, 31, 12, 18, 27, 15, 23, 16, 29, 13]),
    ];

    const pages = planChecklistPdfPages(metrics, 100, 100);
    expect(pages.length).toBeGreaterThanOrEqual(3);

    let nextTask = 0;
    let hasContinuation = false;
    for (const page of pages) {
      expect(page.left.start).toBe(nextTask);
      expect(page.left.end).toBeGreaterThan(page.left.start);
      expect(page.left.height).toBeLessThanOrEqual(100);
      expectHeaderHasTasks(metrics, page.left);
      hasContinuation ||= (metrics[page.left.start]?.itemIndex ?? 0) > 0;

      if (page.right) {
        expect(page.right.start).toBe(page.left.end);
        expect(page.right.end).toBeGreaterThan(page.right.start);
        expect(page.right.height).toBeLessThanOrEqual(100);
        expectHeaderHasTasks(metrics, page.right);
        hasContinuation ||= (metrics[page.right.start]?.itemIndex ?? 0) > 0;
        nextTask = page.right.end;
      } else {
        nextTask = page.left.end;
      }
    }

    expect(nextTask).toBe(metrics.length);
    expect(hasContinuation).toBe(true);

    const secondPage = pages[1];
    expect(secondPage?.right).not.toBeNull();
    const secondPageDifference = Math.abs(
      (secondPage?.left.height ?? 0) - (secondPage?.right?.height ?? 0),
    );
    expect(secondPageDifference).toBeLessThanOrEqual(20);
    expect((secondPage?.left.end ?? 0) - (secondPage?.left.start ?? 0)).not.toBe(
      (secondPage?.right?.end ?? 0) - (secondPage?.right?.start ?? 0),
    );
  });
});
