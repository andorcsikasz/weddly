// Reactive probability-trend line for a prediction-market question — shared
// by the couple's board manager (MarketsPage, dark) and a guest's own play
// screen (PlayMarketsPage, light), so the "shape" of a question's history
// reads the same on both sides of the board. Fed straight from
// `MarketQuestion.priceHistory` (shared/markets.ts) — every point is a real
// tick the backend recorded inside the same transaction as the bet that
// produced it (see `recordPriceTick`), never interpolated or estimated
// client-side.
//
// `showTrades` overlays the room's most recent bets as small floating "+N"
// chips along the line, Polymarket-card style — reconstructed by
// `recentMarketTrades` straight from the same ticks the line already draws
// (see its own comment for why that's real data, not a decorative
// flourish), so a caller opts in rather than the component inventing
// activity nobody placed. Only worth the visual weight on a tall "hero"
// chart, not the compact previews elsewhere.

import { recentMarketTrades, type MarketPriceTick } from "@shared/markets";

// Same green/red the split-bar and outcome buttons already use in
// GamesConsole.css (Yes/No, not this component's own `stroke`, which is the
// LINE's colour and varies per surface) — kept as literals here rather than
// importing that stylesheet's tokens because this component also renders on
// the guest's plain Tailwind page, which never loads it.
const TRADE_COLOR: Record<"yes" | "no", string> = { yes: "#1fbf7a", no: "#db2f42" };
const MAX_TRADE_CHIPS = 4;

export function MarketMiniChart({
  ticks,
  stroke,
  ariaLabel,
  showTrades = false,
  tradeTitle,
}: {
  ticks: MarketPriceTick[];
  /** Line colour — pass the surface's own accent so the chart reads as part
   *  of the page it's on rather than a foreign widget. */
  stroke: string;
  ariaLabel: string;
  showTrades?: boolean;
  /** A localized native-tooltip string for one "+N" chip — the chip's own
   *  number needs no translation, but its unit ("pts on Yes") does, and
   *  this component has no `t()` of its own. Only read when `showTrades`. */
  tradeTitle?: (side: "yes" | "no", amount: number) => string;
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
  const trades = showTrades ? recentMarketTrades(ticks, MAX_TRADE_CHIPS) : [];

  return (
    <div className="relative h-full w-full">
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
      {trades.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
          {trades.map((trade, i) => {
            const left = ((trade.at - first) / span) * 100;
            const top = (1 - trade.probability / 100) * 100;
            return (
              <span
                key={`${trade.at}-${i}`}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  backgroundColor: TRADE_COLOR[trade.side],
                }}
                title={tradeTitle?.(trade.side, trade.amount)}
              >
                +{trade.amount}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
