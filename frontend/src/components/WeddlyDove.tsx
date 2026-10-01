import { DOVE_PATH, DOVE_TRANSFORM, DOVE_VIEWBOX } from "./dovePath";

/** Just the Weddly dove, in `currentColor`. Decorative: the text beside it
 *  already says Weddly. */
export function WeddlyDove({ className }: { className?: string }) {
  return (
    <svg viewBox={DOVE_VIEWBOX} className={className} fill="currentColor" aria-hidden="true">
      <path transform={DOVE_TRANSFORM} d={DOVE_PATH} />
    </svg>
  );
}
