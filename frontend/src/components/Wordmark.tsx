/**
 * Brand wordmark — "WĒDDLY" in wide-tracked serif caps. Used at brand
 * moments (shell headers, footer brand). Inherits `color` from its
 * parent so a `<Link>` can carry hover/active states without the
 * Wordmark fighting them.
 *
 * The visible glyph uses the precomposed "Ē" (U+0112) so the macron
 * renders consistently across rendering engines. `aria-label="Weddly"`
 * keeps screen readers and search-engine alt text reading the plain
 * brand name; visually the user sees the styled wordmark.
 */

type Props = {
  /** Visual size preset. Bigger sizes carry slightly wider tracking so
   *  the caps breathe; smaller sizes pull tracking back so the letters
   *  don't fly apart. */
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

const sizeClasses: Record<NonNullable<Props["size"]>, string> = {
  sm: "text-xs tracking-[0.32em]",
  md: "text-base tracking-[0.38em]",
  lg: "text-xl tracking-[0.42em] sm:text-2xl",
  xl: "text-3xl tracking-[0.46em] sm:text-4xl",
};

export function Wordmark({ size = "md", className = "" }: Props) {
  return (
    <span
      className={`inline-block whitespace-nowrap font-serif font-semibold ${sizeClasses[size]} ${className}`}
      aria-label="Weddly"
    >
      WĒDDLY
    </span>
  );
}
