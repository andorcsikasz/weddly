// Reactive probability-trend line for a prediction-market question — shared
// by the couple's board manager (MarketsPage, dark) and a guest's own play
// screen (PlayMarketsPage, light), so the "shape" of a question's history
// reads the same on both sides of the board. Fed straight from
// `MarketQuestion.priceHistory` (shared/markets.ts) — every point is a real
// tick the backend recorded inside the same transaction as the bet that
// produced it (see `recordPriceTick`), never interpolated or estimated
// client-side.
//
// Deliberately just the line: no numbers or labels sit on top of it (owner
// direction) — the big percentage and the trend chip above the chart already
// carry that reading, and the pool/closes-at row below carries the rest. The
// one bit of extra context is a faint dashed line at the 50/50 coin-flip
// mark, so a glance shows which side of even the room currently favours.

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
  const mid = h / 2;

  // The seeded creation tick means this is only ever hit for data that
  // hasn't loaded yet, not a real "nobody has bet" state — still worth a
  // flat fallback rather than an empty box.
  if (ticks.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label={ariaLabel}>
        <line
          x1="0"
          y1={mid}
          x2={w}
          y2={mid}
          stroke={stroke}
          strokeWidth="2"
          strokeDasharray="3 3"
          opacity="0.5"
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
  const area = `0,${h} ${points} ${w},${h}`;
  const end = coords[coords.length - 1]!;

  const gradId = `mchart-${stroke.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-full w-full overflow-visible"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        x1="0"
        y1={mid}
        x2={w}
        y2={mid}
        stroke="currentColor"
        opacity="0.16"
        strokeWidth="1"
        strokeDasharray="2 3"
        vectorEffect="non-scaling-stroke"
      />
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={end.x}
        cy={end.y}
        r="4.5"
        fill={stroke}
        opacity="0.22"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={end.x} cy={end.y} r="2.4" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
