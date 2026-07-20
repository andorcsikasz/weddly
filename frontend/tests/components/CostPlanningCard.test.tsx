// Regressions around the cost-planning panel:
//   * the total at the bottom of the card needs to track the slider DURING
//     a drag — not just on release — otherwise the headline number drifts
//     out of sync with the per-row displays while the user is sliding.
//   * stale row-level drag state used to leak past commits and contradict
//     the source-of-truth `lines`. Lifting the drag map up to the card and
//     retiring each entry when its own commit lands is what we're guarding.
//   * a released slider has to SAVE. It used to commit only on mouseup over
//     the track, so releasing outside it (or a cancelled touch) dropped the
//     edit entirely while the preview still showed the new amount — the
//     "it looked saved, then jumped back" report.
//   * one row's pending edit must survive another row's drag.

import type { BudgetCategory, BudgetLine } from "@shared/types";
import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

/** Slightly longer than the panel's COMMIT_DELAY_MS so a scheduled save has
 *  definitely fired. Kept as a literal rather than importing the constant —
 *  the point of the test is the observable behaviour, not the exact delay. */
const AFTER_DEBOUNCE_MS = 500;
// Wrapped in act() because the timer that fires inside the window settles the
// row's drag preview, i.e. it updates state outside an event handler.
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe("<CostPlanningCard> slider commits", () => {
  it("saves a drag that never gets a pointerup on the track", async () => {
    const onEditPlanned = mock(async () => {});
    setup({ lines: [line(1, "venue", 300_000)], onEditPlanned });

    // No pointerup/keyup: the gesture ended off the slider, which used to
    // mean the amount was never persisted at all.
    fireEvent.change(screen.getByRole("slider", { name: /venue/i }), {
      target: { value: 500_000 },
    });
    expect(onEditPlanned).not.toHaveBeenCalled();

    await wait(AFTER_DEBOUNCE_MS);
    expect(onEditPlanned).toHaveBeenCalledTimes(1);
    expect(onEditPlanned.mock.calls[0]).toEqual(["venue", 500_000]);
  });

  it("flushes on pointerup instead of waiting out the debounce", async () => {
    const onEditPlanned = mock(async () => {});
    setup({ lines: [line(1, "venue", 300_000)], onEditPlanned });

    const slider = screen.getByRole("slider", { name: /venue/i });
    fireEvent.change(slider, { target: { value: 500_000 } });
    fireEvent.pointerUp(slider);
    expect(onEditPlanned).toHaveBeenCalledTimes(1);

    // The flush cancels the pending timer — no duplicate PATCH afterwards.
    await wait(AFTER_DEBOUNCE_MS);
    expect(onEditPlanned).toHaveBeenCalledTimes(1);
  });

  it("ignores a pointerup that follows no change", () => {
    const onEditPlanned = mock(async () => {});
    setup({ lines: [line(1, "venue", 300_000)], onEditPlanned });
    fireEvent.pointerUp(screen.getByRole("slider", { name: /venue/i }));
    expect(onEditPlanned).not.toHaveBeenCalled();
  });

  it("keeps a pending row's amount when another row's drag starts", () => {
    // The regression: drag state was a single {category, value} slot, so
    // touching a second slider erased the first row's uncommitted value and
    // it snapped back to `lines` — visibly "jumping back" mid-edit.
    const lines = [line(1, "venue", 300_000), line(2, "photo_video", 400_000)];
    setup({ lines, count: 100, baseline: 100 });

    const venue = screen.getByRole("slider", { name: /venue/i }) as HTMLInputElement;
    const photo = screen.getByRole("slider", { name: /photo/i }) as HTMLInputElement;
    fireEvent.change(venue, { target: { value: 1_000_000 } });
    fireEvent.change(photo, { target: { value: 600_000 } });

    expect(venue.value).toBe("1000000");
    expect(photo.value).toBe("600000");
    // …and the card total reflects both, not one of them reverted.
    expect(totalDigits()).toContain("1600000");
  });
});
