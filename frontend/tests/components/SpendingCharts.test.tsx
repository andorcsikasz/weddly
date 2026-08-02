// Dashboard spending donuts: paid-vs-planned progress + category breakdown.
// Asserts the paid % math, the top-N + "Other" rollup in the legend, and the
// empty state. The donut geometry itself is SVG and not asserted here — the
// numbers next to it are what couples actually read.

import type { BudgetCategory, BudgetLine } from "@shared/types";
import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SpendingCharts } from "@/components/SpendingCharts";
import { I18nProvider, useT } from "@/lib/i18n";
import { formatHufCompact } from "@/lib/format";

let nextId = 1;
function line(category: BudgetCategory, planned: number, actual = 0): BudgetLine {
  return {
    id: nextId++,
    couple_id: 1,
    category,
    label: category,
    planned_huf: planned,
    actual_huf: actual,
    paid_huf: 0,
    supplier_id: null,
    couple_supplier_id: null,
    notes: null,
    per_guest: false,
    icon: null,
    created_at: 0,
    updated_at: 0,
  };
}

function Harness({ lines }: { lines: BudgetLine[] }) {
  const { t } = useT();
  return <SpendingCharts lines={lines} currency="EUR" locale="en" t={t} />;
}

function renderCharts(lines: BudgetLine[]) {
  return render(
    // SpendingCharts links through to the budget table, so it needs a router
    // in context. Without one every test here died on react-router's
    // "Cannot destructure property 'basename' from null" before reaching an
    // assertion — one missing wrapper reading as four separate failures.
    <MemoryRouter>
      <I18nProvider>
        <Harness lines={lines} />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("<SpendingCharts>", () => {
  it("shows the paid percentage of the planned total", () => {
    // 250 paid of 1000 planned → 25%.
    renderCharts([line("venue", 600, 150), line("catering", 400, 100)]);
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("renders 0% paid when nothing is paid yet", () => {
    renderCharts([line("venue", 1_000_000)]);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("collapses categories beyond the top six into an Other slice", () => {
    // 8 categories with planned cost → 6 named slices + one "Other".
    const lines = [
      line("venue", 800),
      line("catering", 700),
      line("photo_video", 600),
      line("music_dj", 500),
      line("decor_floral", 400),
      line("attire", 300),
      line("rings", 200), // → Other
      line("transport", 100), // → Other
    ];
    renderCharts(lines);
    // "Other" appears twice by design: once as the donut segment's SVG
    // <title> (its accessible name) and once as the legend row. Assert the
    // ROLLED-UP AMOUNT instead, which is the actual behaviour under test and
    // which neither a stray label nor a second legend could fake: 200 + 100.
    const otherRow = screen
      .getAllByText(/^Other$/)
      .map((el) => el.closest("li"))
      .find((li): li is HTMLLIElement => li !== null);
    expect(otherRow).toBeTruthy();
    expect(otherRow?.textContent).toContain(formatHufCompact(300, "en"));
    // A top category is shown by its own label.
    expect(screen.getAllByText(/Venue/i).length).toBeGreaterThan(0);
  });

  it("shows the empty state when there are no planned costs", () => {
    renderCharts([line("venue", 0)]);
    expect(screen.getByText(/Add planned costs to see/i)).toBeInTheDocument();
  });
});
