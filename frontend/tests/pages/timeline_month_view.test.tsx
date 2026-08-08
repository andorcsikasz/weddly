import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import MonthView from "@/pages/timeline/MonthView";

function renderMonth(currentDate: Date) {
  return render(
    <I18nProvider>
      <MonthView
        currentDate={currentDate}
        today={new Date(2026, 7, 1)}
        tasks={[]}
        supplierById={new Map()}
        onOpenTask={() => {}}
      />
    </I18nProvider>,
  );
}

describe("Timeline MonthView week rows", () => {
  it("renders the complete sixth row for a six-week month", () => {
    // August 2026 starts on Saturday, so its final row begins with Monday 31
    // in ISO week 36 — the exact boundary that used to spill below the card.
    const { container } = renderMonth(new Date(2026, 7, 1));
    const rows = container.querySelectorAll(".grid.flex-1 > div");

    expect(rows).toHaveLength(6);
    expect(rows[5]?.textContent).toContain("36");
    expect(rows[5]?.textContent).toContain("31");
  });

  it("keeps five-week months at five rows", () => {
    const { container } = renderMonth(new Date(2026, 8, 1));

    expect(container.querySelectorAll(".grid.flex-1 > div")).toHaveLength(5);
  });

  it("uses the seven-day responsive grid and hides the ISO week gutter on phones", () => {
    const { container } = renderMonth(new Date(2026, 7, 1));
    const grids = container.querySelectorAll(".timeline-month-grid");

    expect(grids.length).toBeGreaterThan(1);
    expect(grids[0]).toHaveClass("timeline-month-grid");
    expect(grids[1]?.firstElementChild).toHaveClass("hidden", "sm:flex");
    expect(grids[1]?.children[1]).toHaveClass("min-w-0");
  });
});
