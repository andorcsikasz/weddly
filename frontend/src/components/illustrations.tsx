/**
 * Inline SVG illustrations for the public-facing surface.
 *
 * Style: warm hand-drawn line art with blush accents on paper-tone
 * surfaces, matching the login page aesthetic. All colours come from
 * the design tokens via `currentColor` inheritance — wrap each colour
 * group in a `<g>` with the matching Tailwind text-* class. No raw hex.
 */

type Common = { className?: string };

/** Hero artwork — interlocked rings on a soft terracotta wash with a
 *  small eucalyptus spray. Sized to fit the right column on desktop and
 *  to scale down to ~280px on mobile. */
export function HeroArt({ className }: Common) {
  return (
    <svg viewBox="0 0 480 360" aria-hidden="true" className={className}>
      {/* Soft background wash */}
      <g className="text-blush-100">
        <ellipse cx="300" cy="180" rx="170" ry="150" fill="currentColor" />
      </g>
      <g className="text-paper-200">
        <ellipse cx="160" cy="220" rx="120" ry="90" fill="currentColor" opacity="0.7" />
      </g>

      {/* Confetti dots */}
      <g className="text-blush-300">
        <circle cx="60" cy="60" r="4" fill="currentColor" />
        <circle cx="420" cy="80" r="5" fill="currentColor" />
        <circle cx="100" cy="310" r="4" fill="currentColor" />
        <circle cx="380" cy="300" r="3" fill="currentColor" />
      </g>
      <g className="text-ink-300">
        <circle cx="90" cy="90" r="3" fill="currentColor" />
        <circle cx="440" cy="140" r="3" fill="currentColor" />
        <circle cx="50" cy="200" r="2.5" fill="currentColor" />
      </g>

      {/* Two interlocking rings — back ring */}
      <g className="text-ink-700">
        <circle
          cx="210"
          cy="180"
          r="62"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>
      {/* Front ring (terracotta) — drawn on top, with the back ring's
          intersection partially redrawn over it for a believable weave */}
      <g className="text-blush-500">
        <circle
          cx="290"
          cy="180"
          r="62"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>
      {/* Tiny weave segment so the back ring crosses *over* the front
          on one side, selling the interlock */}
      <g className="text-ink-700">
        <path
          d="M 268 142 A 62 62 0 0 1 270 218"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>

      {/* Eucalyptus spray below the rings */}
      <g className="text-ink-700">
        <path
          d="M 180 280 Q 240 260 320 285"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <g className="text-paper-500">
        {[
          [200, 270, -20],
          [225, 263, -25],
          [250, 260, 0],
          [275, 263, 25],
          [300, 270, 20],
        ].map(([cx, cy, rot]) => (
          <ellipse
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            rx="10"
            ry="5"
            fill="currentColor"
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        ))}
      </g>
    </svg>
  );
}

/** Phase 1 — Plan: calendar with a heart. */
export function PhasePlanArt({ className }: Common) {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className={className}>
      <g className="text-paper-200">
        <rect x="14" y="20" width="52" height="46" rx="6" fill="currentColor" />
      </g>
      <g className="text-blush-300">
        <rect x="14" y="20" width="52" height="12" rx="6" fill="currentColor" />
        <rect x="14" y="26" width="52" height="6" fill="currentColor" />
      </g>
      <g className="text-ink-700">
        <rect
          x="14"
          y="20"
          width="52"
          height="46"
          rx="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <line
          x1="26"
          y1="14"
          x2="26"
          y2="26"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="54"
          y1="14"
          x2="54"
          y2="26"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <g className="text-blush-500">
        <path
          d="M 40 55 C 36 50, 30 51, 30 46 C 30 42, 34 40, 37 43 C 38 41, 41 41, 43 43 C 47 39, 51 42, 51 46 C 51 51, 44 50, 40 55 Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}

/** Phase 2 — Suppliers: a single bloom + leaves. */
export function PhaseSuppliersArt({ className }: Common) {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className={className}>
      <g className="text-paper-300 dark:text-umber-400">
        <path
          d="M 40 64 Q 32 56 28 50"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <ellipse cx="30" cy="52" rx="6" ry="3" fill="currentColor" transform="rotate(-30 30 52)" />
        <ellipse cx="50" cy="56" rx="6" ry="3" fill="currentColor" transform="rotate(35 50 56)" />
      </g>
      <g className="text-ink-700">
        <line
          x1="40"
          y1="40"
          x2="40"
          y2="68"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      {/* Petals — 5 around the centre */}
      <g className="text-blush-300">
        {[0, 72, 144, 216, 288].map((r) => (
          <ellipse
            key={r}
            cx="40"
            cy="26"
            rx="7"
            ry="11"
            fill="currentColor"
            transform={`rotate(${r} 40 36)`}
          />
        ))}
      </g>
      <g className="text-blush-500">
        <circle cx="40" cy="36" r="6" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Phase 3 — Guests: an envelope with a peeking heart. */
export function PhaseGuestsArt({ className }: Common) {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className={className}>
      <g className="text-paper-100">
        <rect x="12" y="24" width="56" height="38" rx="3" fill="currentColor" />
      </g>
      <g className="text-blush-500">
        <path
          d="M 40 36 C 36 31, 30 32, 30 27 C 30 22, 35 21, 40 26 C 45 21, 50 22, 50 27 C 50 32, 44 31, 40 36 Z"
          fill="currentColor"
        />
      </g>
      <g className="text-ink-700">
        <rect
          x="12"
          y="24"
          width="56"
          height="38"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Open flap */}
        <path
          d="M 12 24 L 40 44 L 68 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/** Phase 4 — Seating: a round table seen from above with chairs. */
export function PhaseSeatingArt({ className }: Common) {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className={className}>
      {/* Chairs — small rounded blocks around the table */}
      <g className="text-blush-300">
        {[0, 60, 120, 180, 240, 300].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const cx = 40 + Math.cos(rad) * 26;
          const cy = 40 + Math.sin(rad) * 26;
          return (
            <rect
              key={deg}
              x={cx - 5}
              y={cy - 4}
              width="10"
              height="8"
              rx="2"
              fill="currentColor"
              transform={`rotate(${deg + 90} ${cx} ${cy})`}
            />
          );
        })}
      </g>
      <g className="text-paper-200">
        <circle cx="40" cy="40" r="18" fill="currentColor" />
      </g>
      <g className="text-ink-700">
        <circle cx="40" cy="40" r="18" fill="none" stroke="currentColor" strokeWidth="2" />
      </g>
      <g className="text-blush-500">
        <circle cx="40" cy="40" r="3" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Phase 5 — Aftermath: confetti scatter with a small heart. */
export function PhaseAftermathArt({ className }: Common) {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className={className}>
      <g className="text-blush-500">
        <path
          d="M 40 48 C 35 41, 26 43, 26 35 C 26 30, 32 28, 36 32 C 37 30, 43 30, 44 32 C 48 28, 54 30, 54 35 C 54 43, 45 41, 40 48 Z"
          fill="currentColor"
        />
      </g>
      <g className="text-blush-300">
        <rect
          x="12"
          y="14"
          width="6"
          height="6"
          rx="1.5"
          fill="currentColor"
          transform="rotate(20 15 17)"
        />
        <rect
          x="60"
          y="20"
          width="5"
          height="5"
          rx="1"
          fill="currentColor"
          transform="rotate(-30 62 22)"
        />
        <rect
          x="18"
          y="58"
          width="6"
          height="6"
          rx="1.5"
          fill="currentColor"
          transform="rotate(-15 21 61)"
        />
      </g>
      <g className="text-ink-300 dark:text-umber-400">
        <rect
          x="64"
          y="56"
          width="6"
          height="6"
          rx="1.5"
          fill="currentColor"
          transform="rotate(25 67 59)"
        />
        <rect
          x="50"
          y="14"
          width="5"
          height="5"
          rx="1"
          fill="currentColor"
          transform="rotate(45 52 16)"
        />
        <rect
          x="10"
          y="40"
          width="4"
          height="4"
          rx="1"
          fill="currentColor"
          transform="rotate(-20 12 42)"
        />
      </g>
    </svg>
  );
}

/** Soft curved divider between sections — subtle visual breath without a
 *  hard border. Pass `flip` to invert vertically. */
export function WaveDivider({ className, flip = false }: Common & { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 1440 60"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      style={flip ? { transform: "scaleY(-1)" } : undefined}
    >
      <path
        d="M0,30 C240,60 480,0 720,30 C960,60 1200,0 1440,30 L1440,60 L0,60 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Suppliers section visual — a friendly grid of supplier-category
 *  tiles with little icons (venue, camera, fork+knife, music note,
 *  flower, ring), suggesting what the directory contains. */
export function SuppliersPreview({ className }: Common) {
  return (
    <svg viewBox="0 0 320 280" aria-hidden="true" className={className}>
      <g className="text-paper-200">
        <rect x="0" y="0" width="320" height="280" rx="20" fill="currentColor" />
      </g>
      {/* 6 tiles in a 3x2 grid */}
      {[
        { x: 24, y: 24, kind: "venue" },
        { x: 124, y: 24, kind: "camera" },
        { x: 224, y: 24, kind: "music" },
        { x: 24, y: 144, kind: "flower" },
        { x: 124, y: 144, kind: "fork" },
        { x: 224, y: 144, kind: "ring" },
      ].map((tile) => (
        <g key={tile.kind} transform={`translate(${tile.x}, ${tile.y})`}>
          <g className="text-paper-50">
            <rect width="72" height="112" rx="10" fill="currentColor" />
          </g>
          <g className="text-paper-300">
            <rect
              width="72"
              height="112"
              rx="10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </g>
          <g className="text-blush-500" transform="translate(36, 44)">
            {tile.kind === "venue" && (
              <path
                d="M -14 8 L -14 -2 L 0 -14 L 14 -2 L 14 8 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            )}
            {tile.kind === "camera" && (
              <>
                <rect
                  x="-14"
                  y="-6"
                  width="28"
                  height="18"
                  rx="3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="0" cy="3" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
              </>
            )}
            {tile.kind === "music" && (
              <>
                <line
                  x1="-2"
                  y1="-12"
                  x2="-2"
                  y2="8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="-5" cy="9" r="4" fill="currentColor" />
                <line
                  x1="-2"
                  y1="-12"
                  x2="10"
                  y2="-9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </>
            )}
            {tile.kind === "flower" && (
              <>
                {[0, 72, 144, 216, 288].map((r) => (
                  <ellipse
                    key={r}
                    cx="0"
                    cy="-6"
                    rx="3"
                    ry="6"
                    fill="currentColor"
                    transform={`rotate(${r} 0 0)`}
                  />
                ))}
                <circle cx="0" cy="0" r="2.5" fill="currentColor" />
              </>
            )}
            {tile.kind === "fork" && (
              <>
                <line
                  x1="-6"
                  y1="-12"
                  x2="-6"
                  y2="12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="-9"
                  y1="-12"
                  x2="-9"
                  y2="-2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="-3"
                  y1="-12"
                  x2="-3"
                  y2="-2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M 6 -12 C 11 -12, 11 0, 6 0 L 6 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </>
            )}
            {tile.kind === "ring" && (
              <>
                <circle cx="-4" cy="2" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <circle cx="6" cy="2" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              </>
            )}
          </g>
          <g className="text-paper-500">
            <rect x="14" y="76" width="44" height="4" rx="2" fill="currentColor" />
            <rect x="20" y="86" width="32" height="3" rx="1.5" fill="currentColor" />
          </g>
        </g>
      ))}
    </svg>
  );
}

/** Small art block for the vendors page hero — a stylised storefront
 *  with a hanging sign, terracotta awning, and a flower out front. */
export function VendorHeroArt({ className }: Common) {
  return (
    <svg viewBox="0 0 320 220" aria-hidden="true" className={className}>
      <g className="text-paper-200">
        <ellipse cx="160" cy="180" rx="140" ry="22" fill="currentColor" />
      </g>
      <g className="text-blush-300">
        <path d="M 80 80 L 240 80 L 230 96 L 90 96 Z" fill="currentColor" />
      </g>
      <g className="text-paper-50">
        <rect x="80" y="96" width="160" height="80" fill="currentColor" />
      </g>
      <g className="text-ink-700">
        <rect
          x="80"
          y="80"
          width="160"
          height="96"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect
          x="100"
          y="120"
          width="40"
          height="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect
          x="180"
          y="120"
          width="40"
          height="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <line x1="80" y1="96" x2="240" y2="96" stroke="currentColor" strokeWidth="2" />
      </g>
      <g className="text-blush-500">
        <circle cx="160" cy="116" r="4" fill="currentColor" />
        <text
          x="160"
          y="148"
          textAnchor="middle"
          fontSize="14"
          fontFamily="serif"
          fill="currentColor"
        >
          ♥
        </text>
      </g>
      {/* Small flower out front */}
      <g className="text-blush-500">
        {[0, 72, 144, 216, 288].map((r) => (
          <ellipse
            key={r}
            cx="60"
            cy="160"
            rx="3"
            ry="6"
            fill="currentColor"
            transform={`rotate(${r} 60 166)`}
          />
        ))}
        <circle cx="60" cy="166" r="2.5" fill="currentColor" />
      </g>
      <g className="text-paper-500">
        <line
          x1="60"
          y1="170"
          x2="60"
          y2="180"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
