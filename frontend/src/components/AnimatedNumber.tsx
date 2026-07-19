// Count-up number. Animates from the previously-shown value to the new one, so
// a stat that changes (or arrives after a fetch) reads as a value that MOVED
// rather than one that was swapped out.
//
// Reduced motion is handled in JS, not CSS: the global
// `prefers-reduced-motion` rule in index.css clamps animation/transition
// durations, but it cannot stop a requestAnimationFrame loop. So the hook
// checks the media query itself and jumps straight to the final value.

import { useEffect, useRef, useState } from "react";

/** Ease-out cubic — fast start, gentle settle. Matches the ease-out feel of the
 *  fade-in-up/card-lift tokens rather than introducing a new motion character. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Animate `value`, returning the number to paint this frame. Integer-valued
 *  throughout, so a counter never flashes a fractional count and a money amount
 *  stays in whole minor units. */
export function useCountUp(value: number, durationMs = 650): number {
  const [shown, setShown] = useState(value);
  // The value we animated FROM, kept in a ref so starting a new animation
  // mid-flight picks up where the last one visually left off instead of
  // snapping back to zero.
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(value)) return;
    const from = fromRef.current;
    if (from === value || prefersReducedMotion() || durationMs <= 0) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const step = (nowTs: number) => {
      const elapsed = nowTs - start;
      const t = Math.min(1, elapsed / durationMs);
      const next = from + (value - from) * easeOutCubic(t);
      setShown(Math.round(next));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Whatever was on screen when we were interrupted becomes the next
      // animation's starting point.
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return shown;
}

/** A number that counts up to its value. `format` renders the animated number
 *  (money, units, thousands separators); without it the raw integer is shown.
 *  The final value is always exact — the easing only affects the frames in
 *  between, never what the vendor ends up reading. */
export function AnimatedNumber({
  value,
  format,
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const shown = useCountUp(value);
  return <>{format ? format(shown) : String(shown)}</>;
}
