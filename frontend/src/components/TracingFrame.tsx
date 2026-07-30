// A card frame with a light that runs its border four times and then retires.
// The CSS is in index.css (`.trace-frame`, and the reasoning for four separate
// edge segments instead of one rotating gradient); this component owns the one
// piece that has to be JS: starting the laps when the card is actually on
// screen.
//
// Deliberately unopinionated about the card itself. The caller supplies the
// plate as the child (its own background, radius and padding) so the frame can
// sit around a dark block on a pale page without this file knowing either
// colour. Pass the outer radius through `className`; the child should carry the
// same radius minus the 2px ring.

import { type ReactNode, useEffect, useRef } from "react";

export function TracingFrame({
  className = "",
  children,
}: {
  className?: string;
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
        <i className="trace-run-top" />
        <i className="trace-run-right" />
        <i className="trace-run-bottom" />
        <i className="trace-run-left" />
      </span>
      {children}
    </div>
  );
}
