// The opening question of the review composer, Uber-style: five large stars
// centred on the card with one word under them that names the rating. Hovering
// previews the word, so the stars read as a scale rather than as five
// identical buttons. 0 = nothing chosen yet; the composer keeps everything else
// folded away until a star is picked, and never seeds a default 5 (that would
// inflate every aggregate).

import { Star } from "lucide-react";
import { useState } from "react";

export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export function ReviewRatingPicker({
  value,
  onChange,
  t,
  align = "center",
}: {
  value: 0 | ReviewRating;
  onChange: (n: ReviewRating) => void;
  /** "start" when the picker sits in a left-aligned card (the summary). */
  align?: "center" | "start";
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const [hover, setHover] = useState<0 | ReviewRating>(0);
  const shown = hover || value;
  return (
    <div
      className={`flex flex-col gap-2 py-1 ${align === "start" ? "items-start" : "items-center"}`}
    >
      <div
        className="inline-flex items-center gap-1.5"
        role="radiogroup"
        aria-label={t("suppliers.detail.reviews.yourRating")}
        onMouseLeave={() => setHover(0)}
      >
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t(`suppliers.detail.reviews.ratingWord${n}`)}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            className="rounded-full p-1 leading-none transition-transform duration-150 hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 dark:focus-visible:ring-paper-100"
          >
            <Star
              size={34}
              strokeWidth={1.5}
              aria-hidden
              className={`transition-colors ${
                n <= shown ? "fill-star stroke-star" : "stroke-paper-400 dark:stroke-umber-500"
              }`}
            />
          </button>
        ))}
      </div>
      <p
        aria-live="polite"
        className={`h-5 text-sm transition-colors ${
          shown
            ? "font-semibold text-ink-900 dark:text-paper-50"
            : "text-ink-500 dark:text-umber-300"
        }`}
      >
        {shown
          ? t(`suppliers.detail.reviews.ratingWord${shown}`)
          : t("suppliers.detail.reviews.ratingPrompt")}
      </p>
    </div>
  );
}
