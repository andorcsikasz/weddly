// /camera early-tester reviews: three cards at a time on desktop (one on a
// phone), stepped sideways with arrows, a swipe, or the progress track. The
// cards slide as one strip so moving a page reads as a single motion.
//
// The eyebrow names the writers as early testers on purpose; see the note in
// lib/camera_reviews.ts before changing it.
import { ArrowLeft, ArrowRight, Star } from "lucide-react";
import { useRef, useState } from "react";
import { CAMERA_REVIEWS_EN, CAMERA_REVIEWS_HU } from "../lib/camera_reviews";
import { useT } from "../lib/i18n";
import { useMediaQuery } from "../lib/useMediaQuery";

const GAP_REM = 1.25;

export function CameraReviews() {
  const { t, locale } = useT();
  const reviews = locale === "hu" ? CAMERA_REVIEWS_HU : CAMERA_REVIEWS_EN;
  const wide = useMediaQuery("(min-width: 768px)");
  const perView = wide ? 3 : 1;
  const pageCount = Math.ceil(reviews.length / perView);
  const [rawPage, setPage] = useState(0);
  // A resize from three-up to one-up (or back) can leave the page past the end.
  const page = Math.min(rawPage, pageCount - 1);
  const go = (next: number) => setPage(Math.max(0, Math.min(pageCount - 1, next)));

  const swipeX = useRef<number | null>(null);

  return (
    <section aria-roledescription="carousel" aria-label={t("camera.reviews_eyebrow")}>
      <div className="flex items-end justify-between gap-6">
        <h2 className="text-2xl font-semibold tracking-tight text-paper-50 sm:text-3xl">
          {t("camera.reviews_eyebrow")}
        </h2>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => go(page - 1)}
            disabled={page === 0}
            aria-label={t("camera.reviews_prev")}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-paper-50 text-umber-950 transition-[transform,opacity] duration-150 active:scale-95 disabled:opacity-30"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(page + 1)}
            disabled={page === pageCount - 1}
            aria-label={t("camera.reviews_next")}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-paper-50 text-umber-950 transition-[transform,opacity] duration-150 active:scale-95 disabled:opacity-30"
          >
            <ArrowRight size={18} aria-hidden="true" />
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
          className="flex transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
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
                className="flex shrink-0 flex-col rounded-2xl bg-paper-50/[0.05] p-6 sm:p-7"
                style={{
                  width: `calc((100% - ${(perView - 1) * GAP_REM}rem) / ${perView})`,
                }}
              >
                <div className="flex gap-0.5 text-paper-50" role="img" aria-label="5/5">
                  {[0, 1, 2, 3, 4].map((s) => (
                    <Star
                      key={s}
                      size={14}
                      fill="currentColor"
                      strokeWidth={0}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                {r.title && (
                  <p className="mt-4 text-base font-semibold leading-snug text-paper-50">
                    {r.title}
                  </p>
                )}
                <p
                  className={`text-sm leading-relaxed text-paper-300 ${r.title ? "mt-2" : "mt-4"}`}
                >
                  {r.body}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Sideways stepper: one segment per page, the current one filled. */}
      <div className="mt-6 flex items-center gap-4">
        <div className="flex flex-1 gap-1.5">
          {Array.from({ length: pageCount }, (_, p) => (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              aria-label={`${p + 1} / ${pageCount}`}
              aria-current={p === page}
              className="group flex h-6 flex-1 items-center"
            >
              <span
                className={`h-[3px] w-full rounded-full transition-colors duration-300 ${
                  p === page ? "bg-paper-50" : "bg-paper-50/15 group-hover:bg-paper-50/35"
                }`}
              />
            </button>
          ))}
        </div>
        <span className="shrink-0 font-grotesk text-xs font-semibold tabular-nums text-paper-400">
          {String(page + 1).padStart(2, "0")} / {String(pageCount).padStart(2, "0")}
        </span>
      </div>
    </section>
  );
}
