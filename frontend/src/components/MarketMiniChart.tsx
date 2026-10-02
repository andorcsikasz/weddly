// Reactive probability-trend line for a prediction-market question — shared
// by the couple's board manager (MarketsPage, dark) and a guest's own play
// screen (PlayMarketsPage, light), so the "shape" of a question's history
// reads the same on both sides of the board. Fed straight from
// `MarketQuestion.priceHistory` (shared/markets.ts) — every point is a real
// tick the backend recorded inside the same transaction as the bet that
// produced it (see `recordPriceTick`), never interpolated or estimated
// client-side.
//
// The look follows the public /games teaser's live chart: faint gridlines with
// small 0 / 50 / 100% labels at the right edge, the dashed 50% coin-flip mark,
// a gradient under the line and a pulsing dot at the latest price. The scale is
// FIXED at 0..100 here (unlike the teaser's auto-zoom), because a guest reading
// two questions side by side must be able to compare their heights.
//
// THE OPENING STATE IS A REAL PICTURE, NOT A PLACEHOLDER. Before a second tick
// exists the chart used to be one faint dashed stroke, which read as "broken"
// rather than "nobody has bet yet". It now draws the opening odds as a line
// across the whole chart, a hollow marker where the market opened, and the live
// dot pulsing at the right edge: the shape of a market waiting for its first
// move. The level comes from the one tick there is, or from `current` (the
// question's own probability) when there is none.

import type { MarketPriceTick } from "@shared/markets";

const W = 100;
const H = 34;
const GRID = [0, 25, 50, 75, 100] as const;
const LABELS = [100, 50, 0] as const;

const yOf = (probability: number) => H - (Math.min(100, Math.max(0, probability)) / 100) * H;

export function MarketMiniChart({
  ticks,
  stroke,
  ariaLabel,
  current = 50,
}: {
  ticks: MarketPriceTick[];
  /** Line colour — pass the surface's own accent so the chart reads as part
   *  of the page it's on rather than a foreign widget. */
  stroke: string;
  ariaLabel: string;
  /** The question's probability right now, used for the opening picture when
   *  there is no tick to read it from. */
  current?: number;
}) {
  const opening = ticks.length < 2;
  const level = ticks[0]?.probability ?? current;

  let coords: { x: number; y: number }[];
  if (opening) {
    coords = [
      { x: 0, y: yOf(level) },
      { x: W, y: yOf(level) },
    ];
  } else {
    const first = ticks[0]!.at;
    const last = ticks[ticks.length - 1]!.at;
    const span = Math.max(1, last - first);
    coords = ticks.map((t) => ({ x: ((t.at - first) / span) * W, y: yOf(t.probability) }));
  }
  const points = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${points} ${W},${H}`;
  const start = coords[0]!;
  const end = coords[coords.length - 1]!;
  const gradId = `mchart-${stroke.replace(/[^a-zA-Z0-9]/g, "")}-${opening ? "o" : "l"}`;

  // The line is stretched to the container (`preserveAspectRatio="none"`),
  // which would squash an SVG <circle> into an oval — so the dots and the
  // labels are HTML laid over the same coordinates instead.
  return (
    <div className="relative h-full w-full pr-8">
      <div className="relative h-full w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-full w-full overflow-visible"
          role="img"
          aria-label={ariaLabel}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={opening ? "0.18" : "0.32"} />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {GRID.map((g) => (
            <line
              key={g}
              x1="0"
              x2={W}
              y1={yOf(g)}
              y2={yOf(g)}
              stroke="currentColor"
              opacity={g === 50 ? 0.28 : 0.08}
              strokeWidth="1"
              strokeDasharray={g === 50 ? "3 4" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polygon points={area} fill={`url(#${gradId})`} />
          <polyline
            points={points}
            fill="none"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={opening ? 0.75 : 1}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {opening && (
          // Where the market opened: a hollow ring, so it reads as the starting
          // line rather than as a second live price.
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-transparent"
            style={{
              left: `${(start.x / W) * 100}%`,
              top: `${(start.y / H) * 100}%`,
              borderColor: stroke,
            }}
          />
        )}

        {/* The latest price, with a ping ring: in the opening state this is the
            market waiting for its first move. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${(end.x / W) * 100}%`, top: `${(end.y / H) * 100}%` }}
        >
          <span
            className="absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping"
            style={{ background: stroke }}
          />
          <span
            className="relative block h-[9px] w-[9px] rounded-full"
            style={{
              background: stroke,
              boxShadow: `0 0 0 4px color-mix(in srgb, ${stroke} 22%, transparent)`,
            }}
          />
        </span>
      </div>

      {/* Scale labels at the right edge, outside the plot so the line never
          runs under them. */}
      {LABELS.map((g) => (
        <span
          key={g}
          aria-hidden="true"
          className="pointer-events-none absolute right-0 -translate-y-1/2 text-[10px] font-medium tabular-nums opacity-45"
          style={{ top: `${(yOf(g) / H) * 100}%` }}
        >
          {g}%
        </span>
      ))}
    </div>
  );
}
