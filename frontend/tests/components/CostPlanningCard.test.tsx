// Regressions around the cost-planning panel:
//   * the total at the bottom of the card needs to track the slider DURING
//     a drag — not just on release — otherwise the headline number drifts
//     out of sync with the per-row displays while the user is sliding.
//   * stale row-level drag state used to leak past commits and contradict
//     the source-of-truth `lines`. Lifting the drag map up to the card and
//     clearing it whenever `lines` rehydrates is what we're guarding here.

import type { BudgetCategory, BudgetLine } from "@shared/types";
import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CostPlanningCard } from "@/components/CostPlanningCard";
import { I18nProvider } from "@/lib/i18n";

function line(id: number, category: BudgetCategory, planned: number): BudgetLine {
  return {
    id,
    couple_id: 1,
    category,
    label: category,
    planned_huf: planned,
    actual_huf: 0,
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

function setup({
  lines,
  count = 100,
  baseline = 100,
  frozen = new Set<BudgetCategory>(),
  onEditPlanned = mock(async () => {}),
}: {
  lines: BudgetLine[];
  count?: number;
  baseline?: number;
  frozen?: Set<BudgetCategory>;
  onEditPlanned?: (cat: BudgetCategory, planned: number) => Promise<void>;
}) {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CostPlanningCard
          lines={lines}
          baseline={baseline}
          boundsMin={50}
          boundsMax={200}
          cap={null}
          count={count}
          onCountChange={mock(() => {})}
          onEditPlanned={onEditPlanned}
          frozenCategories={frozen}
        />
      </I18nProvider>
    </MemoryRouter>,
  );
}

function totalDigits(): string {
  // Strip non-digits so locale-formatted ("1 000 000") and raw ("1000000")
  // both compare cleanly.
  return (screen.getByTestId("cost-planning-total").textContent ?? "").replace(/\D/g, "");
}

describe("<CostPlanningCard> live total", () => {
  it("updates the total during a category slider drag, not just on release", () => {
    // Venue at 2M anchors `widthAnchor` so the catering slider has room to
    // be dragged up to 500k without being clamped by its own scale.
    const lines = [line(1, "venue", 2_000_000), line(2, "catering", 200_000)];
    setup({ lines, count: 100, baseline: 100 });

    // Pre-drag total: 2M + 200k = 2,200,000.
    expect(totalDigits()).toContain("2200000");

    // Drag the catering slider. fireEvent.change on a range fires the React
    // onChange — same path a real drag step takes.
    const cateringSlider = screen.getByRole("slider", { name: /catering/i });
    fireEvent.change(cateringSlider, { target: { value: 500_000 } });

    // Without the lifted drag state the total stayed at 2.2M until commit.
    // With the fix the total reflects the drag immediately: 2M + 500k = 2.5M.
    expect(totalDigits()).toContain("2500000");
  });

  it("rescales per-guest displays live as the headcount slider moves", () => {
    const lines = [line(1, "catering", 200_000)];
    const { rerender } = setup({ lines, count: 100, baseline: 100 });

    // At count == baseline the display equals the baseline planned amount.
    expect(totalDigits()).toContain("200000");

    // Parent owns the count state, so simulate the slider commit by
    // re-rendering with count=200 (factor=2). Per-guest scaling should
    // double the display.
    rerender(
      <MemoryRouter>
        <I18nProvider>
          <CostPlanningCard
            lines={lines}
            baseline={100}
            boundsMin={50}
            boundsMax={200}
            cap={null}
            count={200}
            onCountChange={mock(() => {})}
            onEditPlanned={mock(async () => {})}
          />
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(totalDigits()).toContain("400000");
  });
});
