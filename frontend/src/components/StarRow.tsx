// The 5-star glyph row. Its own module rather than a named export off
// ReviewsSection: a directory card wants the stars and nothing else, and
// importing them from the reviews module would pull the composer, the API
// client and the confirm dialog into every card that shows a rating.

import { Star } from "lucide-react";

export function StarRow({
  value,
  size = 14,
  ariaLabel,
}: {
  value: number;
  size?: number;
  /** Optional spoken label (e.g. "4 out of 5"). Skipped on decorative rows
   *  rendered next to a separately-narrated numeric rating. */
  ariaLabel?: string;
}) {
  // Filled stars use the warm `paper-500` token (#bfae7b — the project's
  // gold/oat accent). Rose / amber would both work universally but rose
  // collides with the error/blush palette, and amber isn't in the design
  // tokens; paper is the in-palette match for the universal "rating star"
  // convention. Inactive strokes stay light so the row reads as a coherent
  // 5-slot scale.
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          aria-hidden
          className={
            n <= value ? "fill-star stroke-star" : "stroke-paper-300 dark:stroke-umber-500"
          }
        />
      ))}
    </span>
  );
}
