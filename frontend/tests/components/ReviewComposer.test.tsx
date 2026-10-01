// The review composer opens as a rating question: five stars and a word that
// names the rating. Nothing else shows until a star is picked (no seeded
// default, which would inflate every aggregate), and tags are pressable pills
// with an "Add your own" chip that becomes a field.

import { describe, expect, it, mock } from "bun:test";
import type { ReviewSummary } from "@shared/suppliers";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ReviewRatingPicker } from "@/components/ReviewRatingPicker";
import { ReviewSummaryCard } from "@/components/ReviewSummaryCard";
import { ReviewTagPicker } from "@/components/ReviewTagPicker";
import { I18nProvider, useT } from "@/lib/i18n";

function Rating({ onPick }: { onPick: (n: number) => void }) {
  const { t } = useT();
  const [v, setV] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  return (
    <ReviewRatingPicker
      value={v}
      onChange={(n) => {
        setV(n);
        onPick(n);
      }}
      t={t}
    />
  );
}

function Tags() {
  const { t } = useT();
  const [v, setV] = useState<string[]>([]);
  return <ReviewTagPicker value={v} onChange={setV} category="photography" t={t} />;
}

describe("ReviewRatingPicker", () => {
  it("asks first, then names the picked rating", () => {
    const onPick = mock(() => {});
    render(
      <I18nProvider>
        <Rating onPick={onPick} />
      </I18nProvider>,
    );
    expect(screen.getByText("How was it?")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Great" }));
    expect(onPick).toHaveBeenCalledWith(4);
    expect(screen.getByRole("radio", { name: "Great" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("ReviewTagPicker", () => {
  it("toggles a tag and turns 'Add your own' into a field", () => {
    render(
      <I18nProvider>
        <Tags />
      </I18nProvider>,
    );
    const first = screen.getAllByRole("button", { pressed: false })[0]!;
    fireEvent.click(first);
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1/5")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add your own" }));
    const field = screen.getByRole("textbox", { name: "Add your own" });
    fireEvent.change(field, { target: { value: "Calm" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("Calm")).toBeTruthy();
    expect(screen.getByText("2/5")).toBeTruthy();
  });
});

describe("ReviewSummaryCard", () => {
  const empty: ReviewSummary = {
    avg_rating: null,
    reviews_count: 0,
    histogram: [0, 0, 0, 0, 0],
    top_tags: [],
  };
  function Card({ onRate }: { onRate?: (n: number) => void }) {
    const { t } = useT();
    return (
      <ReviewSummaryCard summary={empty} locale="en" t={t} onOpen={() => {}} onRate={onRate} />
    );
  }

  it("rates straight from the card, with no 'be the first' button", () => {
    const onRate = mock(() => {});
    render(
      <I18nProvider>
        <Card onRate={onRate} />
      </I18nProvider>,
    );
    expect(screen.queryByText("Be the first to review")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Excellent" }));
    expect(onRate).toHaveBeenCalledWith(5);
  });

  it("shows no stars to a viewer who cannot review", () => {
    render(
      <I18nProvider>
        <Card />
      </I18nProvider>,
    );
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
