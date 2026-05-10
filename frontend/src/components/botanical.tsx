/**
 * Botanical decorative SVG library for the public landing surface.
 *
 * Editorial line-art that whispers, not shouts: eucalyptus stems, floral
 * sprays, arch silhouettes, corner ornaments, watercolour blobs, and
 * ribbon dividers. Designed to sit at 30–60% opacity behind or beside
 * content as the "eye-catching" half of "eye-catching but minimalist".
 *
 * Style: hand-drawn organic line-art with cubic curves. All colour comes
 * from the design tokens via `currentColor` inheritance — wrap each
 * tonal group in a `<g>` with the matching Tailwind text-* class
 * (paper / ink / blush). No raw hex. Every <svg> is `aria-hidden`.
 *
 * Usage:
 *   <EucalyptusStem className="text-paper-400 opacity-50 w-72" />
 *   <BotanicalCorner corner="tr" className="text-blush-300 opacity-40" />
 *   <WatercolorBlob variant={2} className="text-blush-200" />
 */

type Common = { className?: string };

/* ------------------------------------------------------------------ */
/*  EucalyptusStem — curved stem, alternating oval leaves              */
/* ------------------------------------------------------------------ */

/** A single eucalyptus stem: gentle S-curve, 10 alternating oval leaves
 *  along its length. Slight per-leaf jitter in size and rotation keeps
 *  it from feeling stamped. `flip` mirrors the whole thing horizontally. */
export function EucalyptusStem({ className, flip = false }: Common & { flip?: boolean }) {
  // Hand-tuned leaf positions along the stem path. Each leaf alternates
  // sides via the sign on `side` (-1 above the stem, +1 below).
  const leaves: Array<{ t: number; side: -1 | 1; rx: number; ry: number; rot: number }> = [
    { t: 0.08, side: 1, rx: 9, ry: 5, rot: 25 },
    { t: 0.18, side: -1, rx: 11, ry: 6, rot: -30 },
    { t: 0.28, side: 1, rx: 12, ry: 6.5, rot: 28 },
    { t: 0.38, side: -1, rx: 13, ry: 7, rot: -25 },
    { t: 0.48, side: 1, rx: 14, ry: 7, rot: 22 },
    { t: 0.58, side: -1, rx: 13, ry: 6.5, rot: -22 },
    { t: 0.68, side: 1, rx: 12, ry: 6, rot: 20 },
    { t: 0.78, side: -1, rx: 10, ry: 5.5, rot: -28 },
    { t: 0.86, side: 1, rx: 8, ry: 4.5, rot: 24 },
    { t: 0.94, side: -1, rx: 6, ry: 3.5, rot: -22 },
  ];

  // Sample points along a quadratic curve from (10,80) controlling at
  // (150,10) ending at (290,70) — same curve as the <path> below so
  // leaves sit on the stem rather than floating beside it.
  const pointAt = (t: number) => {
    const x = (1 - t) * (1 - t) * 10 + 2 * (1 - t) * t * 150 + t * t * 290;
    const y = (1 - t) * (1 - t) * 80 + 2 * (1 - t) * t * 10 + t * t * 70;
    return { x, y };
  };

  return (
    <svg
      viewBox="0 0 300 120"
      aria-hidden="true"
      className={className}
      transform={flip ? "scale(-1, 1)" : undefined}
    >
      {/* Stem */}
      <g className="text-ink-700">
        <path
          d="M 10 80 Q 150 10 290 70"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>
      {/* Tiny leaf-stem twigs */}
      <g className="text-ink-700">
        {leaves.map((leaf, i) => {
          const { x, y } = pointAt(leaf.t);
          const dx = Math.cos((leaf.rot * Math.PI) / 180) * 6;
          const dy = Math.sin((leaf.rot * Math.PI) / 180) * 6 * leaf.side;
          return (
            <line
              key={`twig-${i}-${leaf.t}`}
              x1={x}
              y1={y}
              x2={x + dx}
              y2={y + dy}
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
          );
        })}
      </g>
      {/* Leaves — soft fill */}
      <g className="text-paper-400">
        {leaves.map((leaf, i) => {
          const { x, y } = pointAt(leaf.t);
          const lx = x + Math.cos((leaf.rot * Math.PI) / 180) * (leaf.rx + 4);
          const ly = y + Math.sin((leaf.rot * Math.PI) / 180) * (leaf.rx + 4) * leaf.side;
          return (
            <ellipse
              key={`leaf-${i}-${leaf.t}`}
              cx={lx}
              cy={ly}
              rx={leaf.rx}
              ry={leaf.ry}
              fill="currentColor"
              transform={`rotate(${leaf.rot * leaf.side} ${lx} ${ly})`}
            />
          );
        })}
      </g>
      {/* Leaf vein hint — single curved line for hand-drawn feel */}
      <g className="text-ink-700">
        {leaves.map((leaf, i) => {
          const { x, y } = pointAt(leaf.t);
          const lx = x + Math.cos((leaf.rot * Math.PI) / 180) * (leaf.rx + 4);
          const ly = y + Math.sin((leaf.rot * Math.PI) / 180) * (leaf.rx + 4) * leaf.side;
          const ang = (leaf.rot * leaf.side * Math.PI) / 180;
          const x1 = lx - Math.cos(ang) * leaf.rx * 0.85;
          const y1 = ly - Math.sin(ang) * leaf.rx * 0.85;
          const x2 = lx + Math.cos(ang) * leaf.rx * 0.85;
          const y2 = ly + Math.sin(ang) * leaf.rx * 0.85;
          return (
            <line
              key={`vein-${i}-${leaf.t}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeWidth="0.6"
              strokeLinecap="round"
              opacity="0.6"
            />
          );
        })}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  FloralSpray — small bouquet, three blooms + leaves + ribbon        */
/* ------------------------------------------------------------------ */

/** A small hand-tied bouquet: three blooms of differing sizes, two
 *  leaves, a curved ribbon at the base. Reads top-to-bottom as
 *  flowers → stems → tied ribbon. */
export function FloralSpray({ className }: Common) {
  return (
    <svg viewBox="0 0 200 260" aria-hidden="true" className={className}>
      {/* Stems gathering toward a tie point at (100, 200) */}
      <g className="text-ink-700">
        <path
          d="M 70 70 C 78 110, 88 160, 100 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M 130 60 C 122 110, 110 160, 100 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M 100 90 C 100 130, 100 170, 100 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>

      {/* Side leaves */}
      <g className="text-paper-400">
        <path
          d="M 100 200 C 70 180, 50 160, 38 130 C 56 142, 78 158, 100 200 Z"
          fill="currentColor"
        />
        <path
          d="M 100 200 C 130 178, 152 160, 162 128 C 144 142, 122 160, 100 200 Z"
          fill="currentColor"
        />
      </g>
      <g className="text-ink-700">
        <path
          d="M 100 200 C 78 180, 60 160, 42 134"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d="M 100 200 C 122 180, 140 162, 158 134"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
          opacity="0.7"
        />
      </g>

      {/* Bloom 1 — large, centre-left peony */}
      <g className="text-blush-300">
        {[0, 60, 120, 180, 240, 300].map((r) => (
          <ellipse
            key={`b1-${r}`}
            cx="70"
            cy="56"
            rx="9"
            ry="14"
            fill="currentColor"
            transform={`rotate(${r} 70 70)`}
          />
        ))}
      </g>
      <g className="text-blush-500">
        <circle cx="70" cy="70" r="5" fill="currentColor" />
      </g>

      {/* Bloom 2 — medium, top-right rose */}
      <g className="text-blush-200">
        <circle cx="130" cy="50" r="14" fill="currentColor" />
      </g>
      <g className="text-blush-400">
        <path
          d="M 130 50 C 122 44, 122 56, 130 56 C 138 56, 138 44, 130 50 Z"
          fill="currentColor"
        />
        <path
          d="M 130 42 C 124 46, 124 54, 130 58"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M 130 42 C 136 46, 136 54, 130 58"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </g>

      {/* Bloom 3 — small, lower bud */}
      <g className="text-blush-300">
        {[0, 72, 144, 216, 288].map((r) => (
          <ellipse
            key={`b3-${r}`}
            cx="100"
            cy="80"
            rx="5"
            ry="9"
            fill="currentColor"
            transform={`rotate(${r} 100 90)`}
          />
        ))}
      </g>
      <g className="text-blush-500">
        <circle cx="100" cy="90" r="3" fill="currentColor" />
      </g>

      {/* Ribbon tie */}
      <g className="text-blush-400">
        <path
          d="M 88 200 C 96 196, 104 196, 112 200 C 110 206, 90 206, 88 200 Z"
          fill="currentColor"
        />
      </g>
      {/* Ribbon tails */}
      <g className="text-blush-400">
        <path
          d="M 92 204 C 84 222, 76 238, 64 248"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M 108 204 C 116 222, 124 240, 138 250"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  ArchSilhouette — wedding-arch line drawing                         */
/* ------------------------------------------------------------------ */

/** Two slim upright stems curving inward to meet at the top centre, with
 *  a few hanging leaves and small blooms. Wide aspect, faint background
 *  motif — best at 25–40% opacity. */
export function ArchSilhouette({ className }: Common) {
  // Hanging foliage anchor points along the arch crown
  const hangs: Array<{ x: number; y: number; len: number }> = [
    { x: 230, y: 36, len: 30 },
    { x: 270, y: 22, len: 50 },
    { x: 300, y: 18, len: 36 },
    { x: 330, y: 22, len: 46 },
    { x: 370, y: 36, len: 28 },
  ];

  return (
    <svg viewBox="0 0 600 220" aria-hidden="true" className={className}>
      {/* Two arch stems — symmetric, meeting at (300, 18) */}
      <g className="text-ink-700">
        <path
          d="M 60 210 C 60 140, 100 70, 300 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M 540 210 C 540 140, 500 70, 300 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>

      {/* Foliage clusters along left stem */}
      <g className="text-paper-400">
        {[
          [86, 170, -25],
          [78, 140, -35],
          [96, 110, -50],
          [128, 80, -65],
          [170, 56, -75],
        ].map(([cx, cy, rot]) => (
          <ellipse
            key={`L-${cx}-${cy}`}
            cx={cx}
            cy={cy}
            rx="14"
            ry="6"
            fill="currentColor"
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        ))}
      </g>
      {/* Foliage clusters along right stem */}
      <g className="text-paper-400">
        {[
          [514, 170, 25],
          [522, 140, 35],
          [504, 110, 50],
          [472, 80, 65],
          [430, 56, 75],
        ].map(([cx, cy, rot]) => (
          <ellipse
            key={`R-${cx}-${cy}`}
            cx={cx}
            cy={cy}
            rx="14"
            ry="6"
            fill="currentColor"
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        ))}
      </g>

      {/* Hanging foliage strands from the crown */}
      <g className="text-ink-700">
        {hangs.map((h, i) => (
          <path
            key={`hang-stem-${i}-${h.x}`}
            d={`M ${h.x} ${h.y} Q ${h.x + 4} ${h.y + h.len / 2} ${h.x - 2} ${h.y + h.len}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        ))}
      </g>
      <g className="text-paper-400">
        {hangs.flatMap((h, i) =>
          [0.3, 0.55, 0.8].map((t, j) => (
            <ellipse
              key={`hang-leaf-${i}-${j}`}
              cx={h.x + 4 * t}
              cy={h.y + h.len * t}
              rx="6"
              ry="3"
              fill="currentColor"
              transform={`rotate(${j % 2 === 0 ? 30 : -30} ${h.x + 4 * t} ${h.y + h.len * t})`}
            />
          )),
        )}
      </g>

      {/* Small blooms scattered at the crown */}
      <g className="text-blush-300">
        <circle cx="290" cy="32" r="5" fill="currentColor" />
        <circle cx="312" cy="40" r="4" fill="currentColor" />
        <circle cx="270" cy="46" r="3.5" fill="currentColor" />
        <circle cx="332" cy="52" r="3.5" fill="currentColor" />
      </g>
      <g className="text-blush-500">
        <circle cx="290" cy="32" r="1.6" fill="currentColor" />
        <circle cx="312" cy="40" r="1.4" fill="currentColor" />
      </g>

      {/* Ground line — soft suggestion */}
      <g className="text-paper-400">
        <path
          d="M 30 212 C 200 208, 400 216, 570 210"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.7"
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  BotanicalCorner — corner ornament, mirrored via SVG transform      */
/* ------------------------------------------------------------------ */

/** A 160×160 corner ornament: curved stem with three leaves and a small
 *  bud. The source path is drawn for top-left; the `corner` prop applies
 *  an SVG transform to mirror it for the other three corners. */
export function BotanicalCorner({
  className,
  corner = "tl",
}: Common & { corner?: "tl" | "tr" | "bl" | "br" }) {
  // Mirror via transform around the centre of the 160×160 viewBox.
  const transform = (() => {
    switch (corner) {
      case "tr":
        return "translate(160, 0) scale(-1, 1)";
      case "bl":
        return "translate(0, 160) scale(1, -1)";
      case "br":
        return "translate(160, 160) scale(-1, -1)";
      default:
        return undefined;
    }
  })();

  return (
    <svg viewBox="0 0 160 160" aria-hidden="true" className={className}>
      <g transform={transform}>
        {/* Main curved stem from corner inward */}
        <g className="text-ink-700">
          <path
            d="M 8 8 C 30 30, 56 52, 88 70 C 110 82, 124 96, 130 116"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>

        {/* Side branch */}
        <g className="text-ink-700">
          <path
            d="M 56 50 C 64 38, 72 30, 86 26"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </g>

        {/* Leaf 1 — pointed almond shape (top of side branch) */}
        <g className="text-paper-400">
          <path d="M 86 26 C 96 18, 110 16, 116 22 C 110 28, 98 32, 86 26 Z" fill="currentColor" />
        </g>
        <g className="text-ink-700">
          <path
            d="M 88 26 C 98 24, 108 24, 114 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            strokeLinecap="round"
            opacity="0.7"
          />
        </g>

        {/* Leaf 2 — mid-stem, larger */}
        <g className="text-paper-400">
          <path
            d="M 88 70 C 100 58, 118 56, 130 64 C 122 76, 102 80, 88 70 Z"
            fill="currentColor"
          />
        </g>
        <g className="text-ink-700">
          <path
            d="M 90 70 C 104 66, 120 66, 128 66"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            strokeLinecap="round"
            opacity="0.7"
          />
        </g>

        {/* Leaf 3 — at the tip, pointing out */}
        <g className="text-paper-400">
          <path
            d="M 130 116 C 140 112, 150 116, 152 128 C 144 130, 134 126, 130 116 Z"
            fill="currentColor"
          />
        </g>

        {/* Small bud near the corner */}
        <g className="text-blush-300">
          <circle cx="34" cy="32" r="4" fill="currentColor" />
          <circle cx="42" cy="22" r="3" fill="currentColor" />
        </g>
        <g className="text-blush-500">
          <circle cx="34" cy="32" r="1.4" fill="currentColor" />
        </g>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  WatercolorBlob — soft organic shape, four variants                 */
/* ------------------------------------------------------------------ */

/** Soft hand-drawn-imperfect blob, four shape variants. Opacity is baked
 *  into the path attribute so the parent only controls colour. Use as a
 *  background wash behind text or imagery. */
export function WatercolorBlob({ variant, className }: { variant: 1 | 2 | 3 | 4 } & Common) {
  const paths = {
    // Wide kidney
    1: "M 60 170 C 40 110, 90 50, 170 50 C 250 50, 320 30, 380 70 C 440 110, 450 200, 380 250 C 310 300, 200 290, 130 270 C 80 256, 80 220, 60 170 Z",
    // Tall pebble
    2: "M 110 60 C 180 30, 290 40, 360 90 C 420 134, 410 220, 350 260 C 280 300, 170 290, 110 240 C 60 200, 50 110, 110 60 Z",
    // Lop-sided drop
    3: "M 80 140 C 90 70, 170 40, 260 60 C 330 76, 410 110, 410 180 C 410 260, 320 290, 220 280 C 130 270, 70 220, 80 140 Z",
    // Crescent-leaning
    4: "M 70 200 C 50 140, 110 60, 200 60 C 290 60, 410 80, 420 160 C 428 230, 360 280, 270 280 C 180 280, 90 270, 70 200 Z",
  };

  return (
    <svg viewBox="0 0 480 320" aria-hidden="true" className={className}>
      <g>
        <path d={paths[variant]} fill="currentColor" fillOpacity="0.35" />
        {/* Inner highlight for hand-painted feel */}
        <path
          d={paths[variant]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeOpacity="0.18"
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Ribbon — flowing horizontal divider                                */
/* ------------------------------------------------------------------ */

/** Gentle S-curved ribbon line, full-width. Reads as a flowing silk
 *  ribbon and works as a section divider. The double-line creates a
 *  subtle dimensional ribbon effect. */
export function Ribbon({ className }: Common) {
  return (
    <svg viewBox="0 0 800 60" aria-hidden="true" className={className} preserveAspectRatio="none">
      {/* Outer ribbon edge */}
      <g className="text-blush-400">
        <path
          d="M 10 30 C 120 6, 240 54, 360 30 C 480 6, 600 54, 720 30 C 750 22, 780 22, 790 26"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
      {/* Inner shadow line — offset slightly to suggest fold */}
      <g className="text-blush-300">
        <path
          d="M 10 36 C 120 12, 240 60, 360 36 C 480 12, 600 60, 720 36 C 750 28, 780 28, 790 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.7"
        />
      </g>
      {/* End-of-ribbon notch on the right */}
      <g className="text-blush-400">
        <path d="M 790 26 L 798 22 L 794 30 L 798 38 L 790 32" fill="currentColor" opacity="0.8" />
      </g>
      {/* Tiny floral accent at left start */}
      <g className="text-blush-500">
        <circle cx="10" cy="30" r="2.5" fill="currentColor" />
      </g>
    </svg>
  );
}
