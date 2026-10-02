// The market chart's OPENING state is a picture, not a placeholder: before a
// second price tick exists it must still draw the opening odds as a line at the
// right height, mark where the market opened, and show the live dot, instead of
// the faint dashed stroke that read as "the chart is broken".

import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { MarketMiniChart } from "@/components/MarketMiniChart";

const polylineYs = (container: HTMLElement) =>
  (container.querySelector("polyline")?.getAttribute("points") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((p) => Number(p.split(",")[1]));

describe("MarketMiniChart", () => {
  it("draws the opening odds as a flat line at their height when nobody has bet", () => {
    const { container } = render(
      <MarketMiniChart ticks={[]} stroke="#2388ff" ariaLabel="chart" current={50} />,
    );
    const ys = polylineYs(container);
    expect(ys).toHaveLength(2);
    // 50% sits exactly halfway down the 34-unit plot.
    expect(ys[0]).toBeCloseTo(17, 1);
    expect(ys[1]).toBeCloseTo(17, 1);
    // A hollow opening marker (bordered, transparent) on top of the live dot.
    expect(container.querySelector("span.border-2")).not.toBeNull();
    expect(container.querySelector("line[stroke-dasharray]")).not.toBeNull();
  });

  it("reads the level off the single tick when there is one", () => {
    const { container } = render(
      <MarketMiniChart
        ticks={[{ at: 1, probability: 0 }]}
        stroke="#2388ff"
        ariaLabel="chart"
        current={50}
      />,
    );
    // 0% is the bottom of the plot, whatever `current` says.
    for (const y of polylineYs(container)) expect(y).toBeCloseTo(34, 1);
  });

  it("plots every tick once there is a history, and drops the opening marker", () => {
    const { container } = render(
      <MarketMiniChart
        ticks={[
          { at: 0, probability: 50 },
          { at: 10, probability: 70 },
          { at: 20, probability: 40 },
        ]}
        stroke="#2388ff"
        ariaLabel="chart"
      />,
    );
    expect(polylineYs(container)).toHaveLength(3);
    expect(container.querySelector("span.border-2")).toBeNull();
  });

  it("labels the fixed 0 / 50 / 100% scale", () => {
    const { getByText } = render(<MarketMiniChart ticks={[]} stroke="#2388ff" ariaLabel="chart" />);
    for (const label of ["0%", "50%", "100%"]) expect(getByText(label)).toBeTruthy();
  });
});
