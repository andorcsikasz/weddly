// /camera early-tester reviews: three cards at a time on desktop (one on a
// phone), stepped sideways with the arrows or a swipe. The
// cards slide as one strip so moving a page reads as a single motion.
//
// The footnote names the writers as early testers on purpose; see the note in
// lib/camera_reviews.ts before changing it.
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useRef, useState } from "react";
import { CAMERA_REVIEWS } from "../lib/camera_reviews";
import { useT } from "../lib/i18n";
import { useMediaQuery } from "../lib/useMediaQuery";

const GAP_REM = 1.25;

export function CameraReviews() {
  const { t } = useT();
  const reviews = CAMERA_REVIEWS;
  const wide = useMediaQuery("(min-width: 768px)");
  const perView = wide ? 3 : 1;
  const pageCount = Math.ceil(reviews.length / perView);
  const [rawPage, setPage] = useState(0);
  // A resize from three-up to one-up (or back) can leave the page past the end.
  const page = Math.min(rawPage, pageCount - 1);
  const go = (next: number) => setPage(Math.max(0, Math.min(pageCount - 1, next)));

  const swipeX = useRef<number | null>(null);

  return (
    <section aria-roledescription="carousel" aria-label={t("camera.reviews_title")}>
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-paper-50 sm:text-3xl">
            {t("camera.reviews_title")}
          </h2>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => go(page - 1)}
            disabled={page === 0}
            aria-label={t("camera.reviews_prev")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-paper-50/20 bg-paper-50/[0.06] text-paper-100 transition-[transform,opacity,background-color] duration-150 hover:bg-paper-50/[0.12] active:scale-95 disabled:opacity-30"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(page + 1)}
            disabled={page === pageCount - 1}
            aria-label={t("camera.reviews_next")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-paper-50/20 bg-paper-50/[0.06] text-paper-100 transition-[transform,opacity,background-color] duration-150 hover:bg-paper-50/[0.12] active:scale-95 disabled:opacity-30"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className="mt-8 touch-pan-y overflow-hidden"
        onPointerDown={(e) => {
          swipeX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (swipeX.current === null) return;
          const dx = e.clientX - swipeX.current;
          swipeX.current = null;
          if (Math.abs(dx) > 40) go(page + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => {
          swipeX.current = null;
        }}
      >
        <ul
          className="flex items-start transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{
            gap: `${GAP_REM}rem`,
            transform: `translateX(calc(-${page} * (100% + ${GAP_REM}rem)))`,
          }}
        >
          {reviews.map((r, i) => {
            const visible = Math.floor(i / perView) === page;
            return (
              <li
                key={r.body}
                aria-hidden={!visible}
                className="shrink-0 self-start rounded-xl border border-paper-50/10 bg-paper-50/[0.07] p-5 sm:p-6"
                style={{
                  width: `calc((100% - ${(perView - 1) * GAP_REM}rem) / ${perView})`,
                }}
              >
                {r.title && (
                  <p className="text-base font-semibold leading-snug text-paper-50">{r.title}</p>
                )}
                <div
                  className="mt-2 flex gap-0.5 text-star"
                  role="img"
                  aria-label={`${r.rating}/5`}
                >
                  {Array.from({ length: r.rating }, (_, s) => (
                    <Star
                      key={s}
                      size={16}
                      fill="currentColor"
                      strokeWidth={0}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <div className="my-4 border-t border-dashed border-paper-50/15" />
                <p className="text-[15px] leading-relaxed text-paper-200">{r.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Who wrote these. Kept on the page because a review from someone
          connected to the business has to say so (see lib/camera_reviews.ts). */}
      <p className="mt-5 text-xs text-paper-500">{t("camera.reviews_disclosure")}</p>
    </section>
  );
}
