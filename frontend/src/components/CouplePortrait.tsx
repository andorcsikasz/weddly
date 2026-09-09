// Refined couple-portrait avatar used in testimonials. Each variant has its
// own palette plus distinct hair shapes so the testimonials read as different
// people. Extracted from mockups.tsx (where it lived unused) into its own
// small module so the landing page can import it eagerly without dragging the
// heavy below-the-fold mockup SVGs into the eager payload.
//
// All colours are design tokens: colour groups are wrapped in `<g
// className="text-…">` and inner shapes use `currentColor`.

type CouplePortraitVariant = 1 | 2 | 3;

export function CouplePortrait({
  variant,
  className,
}: {
  variant: CouplePortraitVariant;
  className?: string;
}) {
  const palette =
    variant === 1
      ? {
          bg: "text-umber-100",
          ring: "text-umber-200",
          skinL: "text-umber-200",
          skinR: "text-paper-300",
          hairL: "text-ink-800",
          hairR: "text-umber-700",
          shoulderL: "text-umber-500",
          shoulderR: "text-paper-500",
        }
      : variant === 2
        ? {
            bg: "text-paper-200",
            ring: "text-paper-300",
            skinL: "text-paper-300",
            skinR: "text-umber-200",
            hairL: "text-umber-700",
            hairR: "text-ink-700",
            shoulderL: "text-ink-600",
            shoulderR: "text-umber-300",
          }
        : {
            bg: "text-umber-50",
            ring: "text-umber-200",
            skinL: "text-paper-300",
            skinR: "text-umber-200",
            hairL: "text-ink-800",
            hairR: "text-umber-700",
            shoulderL: "text-paper-500",
            shoulderR: "text-umber-500",
          };
  // Variant-specific hair shapes — same anchor heads but distinct silhouettes.
  const hairLeft =
    variant === 1
      ? "M 22 38 C 22 26, 36 22, 42 26 C 46 24, 50 30, 48 38 C 46 34, 42 32, 38 32 C 34 32, 28 34, 22 38 Z"
      : variant === 2
        ? "M 24 36 C 24 24, 38 22, 44 28 L 46 38 C 42 33, 36 32, 32 33 C 28 34, 25 35, 24 36 Z"
        : "M 22 42 C 20 30, 36 20, 46 28 C 48 32, 48 36, 46 40 C 44 36, 36 34, 30 36 C 26 38, 23 40, 22 42 Z";
  const hairRight =
    variant === 1
      ? "M 50 36 C 50 28, 64 26, 68 32 C 72 32, 72 38, 70 42 C 66 38, 60 36, 56 36 C 53 36, 51 36, 50 36 Z"
      : variant === 2
        ? "M 48 38 C 50 28, 66 26, 70 34 C 71 38, 70 42, 68 44 C 64 40, 58 38, 54 39 C 51 40, 49 40, 48 38 Z"
        : "M 50 36 C 52 28, 66 28, 70 34 C 72 38, 70 42, 68 42 C 64 38, 58 36, 54 37 C 52 38, 50 38, 50 36 Z";
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={className}>
      {/* Frame */}
      <g className={palette.bg}>
        <circle cx="48" cy="48" r="46" fill="currentColor" />
      </g>
      <g className={palette.ring}>
        <circle cx="48" cy="48" r="46" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </g>

      {/* Left figure — back layer */}
      <g className={palette.shoulderL}>
        <path
          d="M 14 90 C 16 70, 28 62, 36 62 C 44 62, 52 68, 54 82 L 54 96 L 14 96 Z"
          fill="currentColor"
        />
      </g>
      <g className={palette.skinL}>
        <ellipse cx="36" cy="40" rx="11" ry="12" fill="currentColor" />
        {/* Neck */}
        <path d="M 32 50 L 32 58 L 40 58 L 40 50 Z" fill="currentColor" />
      </g>
      <g className={palette.hairL}>
        <path d={hairLeft} fill="currentColor" />
      </g>

      {/* Right figure — front layer */}
      <g className={palette.shoulderR}>
        <path
          d="M 42 90 C 44 70, 56 62, 60 62 C 68 62, 80 68, 82 96 L 42 96 Z"
          fill="currentColor"
        />
      </g>
      <g className={palette.skinR}>
        <ellipse cx="60" cy="42" rx="11" ry="12" fill="currentColor" />
        <path d="M 56 52 L 56 60 L 64 60 L 64 52 Z" fill="currentColor" />
      </g>
      <g className={palette.hairR}>
        <path d={hairRight} fill="currentColor" />
      </g>

      {/* Subtle face hints — eyes and small smile arcs */}
      <g className="text-ink-900" opacity="0.78">
        <ellipse cx="33" cy="40" rx="0.9" ry="1.2" fill="currentColor" />
        <ellipse cx="39" cy="40" rx="0.9" ry="1.2" fill="currentColor" />
        <ellipse cx="57" cy="42" rx="0.9" ry="1.2" fill="currentColor" />
        <ellipse cx="63" cy="42" rx="0.9" ry="1.2" fill="currentColor" />
      </g>
      <g className="text-ink-700" opacity="0.55">
        <path
          d="M 33 46 Q 36 48, 39 46"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
        <path
          d="M 57 48 Q 60 50, 63 48"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
      </g>

      {/* Tiny ring/heart between them — wedding cue */}
      <g className="text-umber-600">
        <circle cx="48" cy="58" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </g>
    </svg>
  );
}
