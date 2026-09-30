// Dashboard spending donuts: paid-vs-planned progress + category breakdown.
// Asserts the paid % math, the top-N + "Other" rollup in the legend, and the
// empty state. The donut geometry itself is SVG and not asserted here — the
// numbers next to it are what couples actually read.

import type { BudgetCategory, BudgetLine } from "@shared/types";
import { describe, expect, it } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
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
    listing_id: null,
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

  it("mounts both faces in one box so the card cannot resize on a flip", () => {
    // The flip used to mount only the active face, so the card resized from
    // "donut + 3 rows" to "a list of 4+" and the dashboard row jumped out from
    // under the pointer mid-click. Both faces now share one grid cell with the
    // inactive one `invisible`, so the box is always the taller of the two.
    //
    // happy-dom has no layout engine (every rect is 0×0), so the assertion that
    // can actually fail here is the STRUCTURE: both faces mounted at once, as
    // siblings in the same parent, exactly one of them hidden.
    renderCharts([line("venue", 600, 150), line("catering", 400, 100)]);

    const ring = screen.getByText("25%").closest("div.col-start-1");
    const details = screen.getByText("Avg per item").closest("div.col-start-1");
    expect(ring).toBeTruthy();
    expect(details).toBeTruthy();
    expect(ring?.parentElement).toBe(details?.parentElement);

    // Before the flip: front readable, back present but invisible.
    expect(ring?.className).not.toContain("invisible");
    expect(details?.className).toContain("invisible");
    // One hidden face, not two: a `hidden` or `display:none` face would take the
    // box with it, and an `opacity-0` one would stay clickable.
    expect(screen.getByText("Avg per item").closest(".invisible")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /view details/i }));

    // After it the roles swap and the card is untouched — still one box, one face.
    expect(details?.className).not.toContain("invisible");
    expect(ring?.className).toContain("invisible");
    expect(screen.getByText("Avg per item")).toBeVisible();
    expect(ring?.parentElement).toBe(details?.parentElement);
  });
});
