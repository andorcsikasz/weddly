// One-shot celebratory confetti burst, shared by the success screens (couple
// onboarding, vendor signup). Extracted from OnboardingWizard so every flow
// rains the same confetti.

import { type CSSProperties, useMemo } from "react";

/** Confetti palette — warm coffee/blush + a green to echo the success check
 *  and a single lemon pop. Full Tailwind class strings so the scanner keeps
 *  them (no raw hex in components). */
const CONFETTI_COLORS = [
  "bg-blush-400",
  "bg-blush-500",
  "bg-sage-400",
  "bg-sage-300",
  "bg-umber-300",
  "bg-lemonade-yellow",
];

/** A one-shot confetti burst that rains down inside the success card. Pieces
 *  are generated once (useMemo) with randomised position, colour, shape and
 *  motion; the fall/spin/fade is driven by the `.confetti-piece` keyframe in
 *  index.css, which is disabled under prefers-reduced-motion. Decorative only
 *  (aria-hidden, pointer-events-none) so it never blocks the CTA. Parent must
 *  be `position: relative` with overflow clipped by this layer. */
export function Confetti() {
  const pieces = useMemo(() => {
    return Array.from({ length: 48 }, (_, i) => {
      const round = Math.random() < 0.45;
      const w = 5 + Math.random() * 5;
      return {
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round,
        // Slightly translucent so overlaps read as soft layers, not hard blocks.
        opacity: 0.8 + Math.random() * 0.2,
        style: {
          left: `${Math.random() * 100}%`,
          width: `${w}px`,
          height: round ? `${w}px` : `${w * 1.7}px`,
          "--cf-drift": `${(Math.random() - 0.5) * 140}px`,
          "--cf-fall": `${360 + Math.random() * 200}px`,
          // Long, staggered, floaty descents read as graceful rather than a dump.
          "--cf-duration": `${3.8 + Math.random() * 2.4}s`,
          "--cf-delay": `${Math.random() * 1.1}s`,
          "--cf-sway": `${10 + Math.random() * 22}px`,
          "--cf-sway-duration": `${1.3 + Math.random() * 1.3}s`,
        } as CSSProperties,
      };
    });
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span key={i} className="confetti-piece absolute top-0" style={p.style}>
          <i
            className={`${p.round ? "rounded-full" : "rounded-[1px]"} ${p.color}`}
            style={{ opacity: p.opacity }}
          />
        </span>
      ))}
    </div>
  );
}
