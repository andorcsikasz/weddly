// A card frame with a light that runs its border four times and then retires.
// The CSS is in index.css (`.trace-frame`, and the reasoning for one dashed
// outline instead of a rotating gradient or four edge bars); this component
// owns the one piece that has to be JS: starting the laps when the card is
// actually on screen.
//
// Deliberately unopinionated about the card itself. The caller supplies the
// plate as the child (its own background, radius and padding) so the frame can
// sit around a dark block on a pale page without this file knowing either
// colour. Pass the outer radius through `className` AND as `radius` (in px):
// the outline the light travels has to follow the same corners, and CSS radius
// utilities are not readable from the SVG. The child should carry that radius
// minus the 5px ring.

import { type ReactNode, useEffect, useRef } from "react";

export function TracingFrame({
  className = "",
  radius = 16,
  children,
}: {
  className?: string;
  /** The frame's outer corner radius in px. Defaults to `rounded-2xl` (16). */
  radius?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (an old browser, or happy-dom in tests): leave the
    // card in its finished state rather than withholding the animation forever.
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // Once. The laps are a greeting, not a loop, so the observer retires
          // with them and scrolling back up doesn't replay the show.
          entry.target.classList.add("is-tracing");
          obs.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className={`trace-frame ${className}`}>
      <span className="trace-run" aria-hidden="true">
        {/* pathLength=100 makes every dash number in the CSS a percentage of the
            perimeter, whatever size the card is. */}
        <svg width="100%" height="100%" focusable="false">
          {[1, 2, 3, 4, 5].map((layer) => (
            <rect
              key={layer}
              className={`trace-l${layer}`}
              width="100%"
              height="100%"
              rx={radius}
              pathLength={100}
            />
          ))}
        </svg>
      </span>
      {children}
    </div>
  );
}
