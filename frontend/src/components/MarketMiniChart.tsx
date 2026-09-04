// Reactive probability-trend line for a prediction-market question — shared
// by the couple's board manager (MarketsPage, dark) and a guest's own play
// screen (PlayMarketsPage, light), so the "shape" of a question's history
// reads the same on both sides of the board. Fed straight from
// `MarketQuestion.priceHistory` (shared/markets.ts) — every point is a real
// tick the backend recorded inside the same transaction as the bet that
// produced it (see `recordPriceTick`), never interpolated or estimated
// client-side.

import type { MarketPriceTick } from "@shared/markets";

export function MarketMiniChart({
  ticks,
  stroke,
  ariaLabel,
}: {
  ticks: MarketPriceTick[];
  /** Line colour — pass the surface's own accent so the chart reads as part
   *  of the page it's on rather than a foreign widget. */
  stroke: string;
  ariaLabel: string;
}) {
  const w = 100;
  const h = 34;

  // The seeded creation tick means this is only ever hit for data that
  // hasn't loaded yet, not a real "nobody has bet" state — still worth a
  // flat fallback rather than an empty box.
  if (ticks.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label={ariaLabel}>
        <line
          x1="0"
          y1={h / 2}
          x2={w}
          y2={h / 2}
          stroke={stroke}
          strokeWidth="2"
          strokeDasharray="3 3"
          opacity="0.35"
        />
      </svg>
    );
  }

  const first = ticks[0]!.at;
  const last = ticks[ticks.length - 1]!.at;
  const span = Math.max(1, last - first);
  const coords = ticks.map((t) => ({
    x: ((t.at - first) / span) * w,
    y: h - (t.probability / 100) * h,
  }));
  const points = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const end = coords[coords.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-full w-full overflow-visible"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={end.x} cy={end.y} r="2.6" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
