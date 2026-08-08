import { Suspense, type ReactNode, useEffect, useRef, useState } from "react";

type Props = {
  children: ReactNode;
  /** CSS aspect-ratio value (e.g. "640 / 440"). Reserves the right amount
   *  of space before children mount, so layout doesn't shift on scroll. */
  aspectRatio?: string;
  /** Margin around the viewport that still counts as "visible" — mounts
   *  children slightly before they scroll into view so the user never
   *  catches an empty box. */
  rootMargin?: string;
  className?: string;
};

/** Renders `children` only after the placeholder enters (or nearly enters)
 *  the viewport. Saves the initial-paint render cost of large below-fold
 *  components — most useful for the heavy product-mockup SVGs.
 *
 *  Falls back to immediate mount when IntersectionObserver isn't
 *  available (older browsers, SSR). Once mounted, the children stay
 *  mounted — there's no unmount on scroll-out. */
export function LazyMount({ children, aspectRatio, rootMargin = "1200px 0px", className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () =>
      typeof window === "undefined" ||
      !("IntersectionObserver" in window) ||
      // Phone momentum scrolling can cross several reserved mockup boxes
      // before an observer callback is painted. Mounting the two landing
      // mockups eagerly on the true phone layout avoids a blank scroll beat;
      // larger screens still get the below-fold render saving.
      window.matchMedia?.("(max-width: 767px)").matches === true,
  );

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [visible, rootMargin]);

  // Suspense boundary so React.lazy children (heavy below-fold SVG mockups
  // imported via dynamic import in LandingPage) can resolve their chunk
  // without an external Suspense wrapper at the call site. The aspect-ratio
  // div above already reserves layout space, so a `null` fallback during
  // chunk fetch keeps the page from jumping.
  return (
    <div ref={ref} className={className} style={aspectRatio ? { aspectRatio } : undefined}>
      {visible ? <Suspense fallback={null}>{children}</Suspense> : null}
    </div>
  );
}
