// The vendor photo viewer, shared by the in-app supplier detail page and the
// public /vendors/:id page. Both used to carry their own copy of "hero image +
// thumbnail strip that swaps it", which drifted and gave a vendor's portfolio
// no way to be seen at full size.
//
// Three things the strip alone didn't do:
//   - Arrows on the photo itself. A thumbnail rail is a jump list, not a way to
//     walk through a portfolio. They sit on the photo from sm up; on touch the
//     rail is the navigation, and the lightbox takes ← / →.
//   - Zoom. The card crops to 16/9 so the page keeps its rhythm, which means a
//     portrait shot is mostly hidden. The lightbox shows the whole frame,
//     uncropped, on a dark ground.
//   - One active state. The gold frame marks the shown photo in the rail; it is
//     the only accent in the component, everything else is ink on paper.

import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../lib/i18n";

export interface VendorGalleryProps {
  /** Gallery URLs in display order, hero first. Empty renders `emptyState`. */
  images: string[];
  /** Vendor name — drives the alt text. */
  name: string;
  /** Per-URL vertical framing the vendor dragged, 0-100. Absent = centred. */
  positionsY?: Record<string, number>;
  /** Shown when there are no photos at all (the monogram placeholder card). */
  emptyState: ReactNode;
}

/** Circular control that floats over the photo. Same size and weight for the
 *  arrows and the zoom so the three read as one set. */
const OVERLAY_BUTTON =
  "grid h-10 w-10 place-items-center rounded-full bg-paper-50/85 text-ink-900 shadow-soft backdrop-blur transition hover:bg-paper-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 disabled:pointer-events-none disabled:opacity-0";

export function VendorGallery({ images, name, positionsY, emptyState }: VendorGalleryProps) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const count = images.length;
  // Clamp rather than reset: navigating between vendors remounts with a new
  // list, and a stale index would point past the end.
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;
  const current = images[safeIndex];

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      // Wraps, so the arrows never dead-end on a short portfolio.
      setIndex((i) => (Math.min(i, count - 1) + delta + count) % count);
    },
    [count],
  );

  // Keep the active thumbnail in view when the arrows or the keyboard move the
  // selection — otherwise the rail silently falls out of sync with the photo.
  useEffect(() => {
    const rail = railRef.current;
    const thumb = thumbRefs.current[safeIndex];
    if (!rail || !thumb) return;
    const delta = thumb.getBoundingClientRect().left - rail.getBoundingClientRect().left;
    const target = rail.scrollLeft + delta - rail.clientWidth / 2 + thumb.offsetWidth / 2;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
  }, [safeIndex]);

  // Arrow keys drive the gallery only while the lightbox is open. Binding them
  // globally on the page would hijack ← / → from every other control.
  useEffect(() => {
    if (!zoomed) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setZoomed(false);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [zoomed, go]);

  if (count === 0 || !current) return <>{emptyState}</>;

  const framing = (url: string) => `50% ${positionsY?.[url] ?? 50}%`;
  const many = count > 1;

  return (
    <div>
      <div className="group relative overflow-hidden rounded-2xl bg-paper-100 dark:bg-umber-800">
        {/* 16/9 keeps every vendor card the same height down the page; the
            vendor's dragged band decides which slice of a tall photo survives
            the crop. The lightbox is where the full frame lives. */}
        <img
          src={current}
          alt={`${name} ${safeIndex + 1}`}
          className="aspect-[16/9] w-full object-cover"
          style={{ objectPosition: framing(current) }}
        />

        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label={t("suppliers.detail.gallery_zoom")}
          className={`absolute right-3 top-3 ${OVERLAY_BUTTON}`}
        >
          <ZoomIn size={18} aria-hidden />
        </button>

        {/* sm+ only, but always visible there rather than on hover: an arrow
            that appears only once the pointer is over the photo is an arrow
            most people never find. On touch the rail below is the navigation. */}
        {many && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t("suppliers.detail.gallery_prev")}
              className={`absolute left-3 top-1/2 hidden -translate-y-1/2 sm:grid ${OVERLAY_BUTTON}`}
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t("suppliers.detail.gallery_next")}
              className={`absolute right-3 top-1/2 hidden -translate-y-1/2 sm:grid ${OVERLAY_BUTTON}`}
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </>
        )}
      </div>

      {many && (
        <div
          ref={railRef}
          className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((url, i) => {
            const shown = i === safeIndex;
            return (
              <button
                // Index-keyed on purpose: a portfolio can legitimately repeat a
                // URL (same photo re-uploaded), and a duplicate key would drop
                // a thumbnail.
                key={`${url}-${i}`}
                type="button"
                ref={(el) => {
                  thumbRefs.current[i] = el;
                }}
                onClick={() => setIndex(i)}
                aria-current={shown ? "true" : undefined}
                aria-label={t("suppliers.detail.gallery_show_aria", { n: i + 1 })}
                className={`shrink-0 overflow-hidden rounded-xl border-2 transition ${
                  shown
                    ? "border-paper-500"
                    : "border-paper-300 hover:border-paper-400 dark:border-umber-600 dark:hover:border-umber-500"
                }`}
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className={`h-20 w-20 object-cover transition sm:h-24 sm:w-24 ${
                    shown ? "" : "opacity-70 hover:opacity-100"
                  }`}
                  style={{ objectPosition: framing(url) }}
                />
              </button>
            );
          })}
        </div>
      )}

      {zoomed &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col bg-ink-950/95 backdrop-blur-sm"
            onMouseDown={(e) => {
              // Backdrop click closes; clicks on the photo or a control don't.
              if (e.target === e.currentTarget) setZoomed(false);
            }}
          >
            <div className="flex justify-end p-4">
              <button
                type="button"
                onClick={() => setZoomed(false)}
                aria-label={t("common.dismiss")}
                className="grid h-11 w-11 place-items-center rounded-full bg-paper-50/10 text-paper-50 transition hover:bg-paper-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-50"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            <div
              className="flex min-h-0 flex-1 items-center justify-center px-4 pb-6"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setZoomed(false);
              }}
            >
              {/* object-contain, no crop and no framing offset: the whole point
                  of the zoom is the frame the vendor actually shot. */}
              <img
                src={current}
                alt={`${name} ${safeIndex + 1}`}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
            {many && (
              <div className="flex items-center justify-center gap-6 pb-8">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label={t("suppliers.detail.gallery_prev")}
                  className="grid h-11 w-11 place-items-center rounded-full bg-paper-50/10 text-paper-50 transition hover:bg-paper-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-50"
                >
                  <ChevronLeft size={20} aria-hidden />
                </button>
                <span className="text-sm tabular-nums text-paper-200/80">
                  {safeIndex + 1} / {count}
                </span>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label={t("suppliers.detail.gallery_next")}
                  className="grid h-11 w-11 place-items-center rounded-full bg-paper-50/10 text-paper-50 transition hover:bg-paper-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-50"
                >
                  <ChevronRight size={20} aria-hidden />
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
