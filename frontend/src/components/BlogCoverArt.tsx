// Default blog cover art. One unified composition used across every post
// that doesn't have a hand-uploaded cover image: paper background, thin
// inner frame, huge faded WĒDDLY watermark, category eyebrow top-left,
// italic serif numeral top-right, eucalyptus sprig bottom-right. The
// result reads like a series of magazine inside-covers, so the blog feed
// keeps its unity even before the admin uploads bespoke imagery.
//
// All colours match Tailwind tokens (paper-100/300/400/500, ink-500,
// blush-700) so light/dark mode are handled by swapping the SVG fills
// via CSS classes rather than per-instance overrides.

/** Visible eyebrow above the wordmark. Pass the post's category in the
 *  active locale. */
interface BlogCoverArtProps {
  /** Category eyebrow (top-left). Pass the post's locale-specific label. */
  category?: string;
  /** Italic numeral (top-right). Pass the post's index in the feed; we
   *  zero-pad to two digits. Omit to render the wordmark on its own. */
  index?: number;
  className?: string;
}

export function BlogCoverArt({ category, index, className }: BlogCoverArtProps) {
  const numeral = index != null ? String(index).padStart(2, "0") : null;
  return (
    <svg
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={className}
    >
      {/* Paper background. Light mode uses paper-100; the dark-mode swap
          happens via a CSS class on the parent (BlogCover handles it). */}
      <rect width="800" height="500" fill="#f6f2e7" />

      {/* Thin inner frame so the cover reads as a "page" rather than a
          floating block. paper-300 line, 24px inset on all sides. */}
      <rect
        x="32"
        y="32"
        width="736"
        height="436"
        fill="none"
        stroke="#e3d9bf"
        strokeWidth="1.2"
      />

      {/* Faded wordmark, big italic serif, centred. paper-300 fill so it
          sits behind the category + numeral without competing for attention. */}
      <text
        x="400"
        y="290"
        textAnchor="middle"
        fontFamily="Cormorant, 'Cormorant Garamond', Georgia, serif"
        fontStyle="italic"
        fontWeight="500"
        fontSize="140"
        letterSpacing="6"
        fill="#e3d9bf"
      >
        Wēddly
      </text>

      {/* Single italic ampersand-ish flourish under the wordmark, very
          quiet. blush-700 thin line that hints at the brand accent. */}
      <line
        x1="350"
        y1="332"
        x2="450"
        y2="332"
        stroke="#9d3b27"
        strokeWidth="0.8"
        opacity="0.5"
      />

      {/* Category eyebrow top-left. Tracked uppercase sans, ink-500. */}
      {category ? (
        <text
          x="60"
          y="80"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="13"
          letterSpacing="3.2"
          fontWeight="600"
          fill="#46577a"
        >
          {category.toUpperCase()}
        </text>
      ) : null}

      {/* Italic serif numeral top-right. paper-500. */}
      {numeral ? (
        <text
          x="740"
          y="90"
          textAnchor="end"
          fontFamily="Cormorant, 'Cormorant Garamond', Georgia, serif"
          fontStyle="italic"
          fontSize="42"
          fill="#bfae7b"
        >
          {numeral}
        </text>
      ) : null}

      {/* Small eucalyptus sprig bottom-right. paper-500 stem + leaves.
          Five leaves alternating along a short curve, hand-tuned positions. */}
      <g transform="translate(560, 380)" fill="#bfae7b" stroke="#bfae7b">
        <path d="M 0 50 Q 80 20 170 60" fill="none" strokeWidth="1.2" strokeLinecap="round" />
        {/* leaves: ellipses rotated to follow stem direction */}
        <ellipse cx="22" cy="40" rx="11" ry="5" transform="rotate(-15 22 40)" opacity="0.78" />
        <ellipse cx="48" cy="32" rx="13" ry="6" transform="rotate(8 48 32)" opacity="0.84" />
        <ellipse cx="78" cy="28" rx="14" ry="6.5" transform="rotate(-12 78 28)" opacity="0.86" />
        <ellipse cx="110" cy="34" rx="13" ry="6" transform="rotate(14 110 34)" opacity="0.82" />
        <ellipse cx="140" cy="44" rx="11" ry="5.5" transform="rotate(-10 140 44)" opacity="0.78" />
        <ellipse cx="162" cy="55" rx="8" ry="4" transform="rotate(18 162 55)" opacity="0.72" />
      </g>

      {/* Brand mark bottom-left: small italic serif "wēddly · since 2026"
          line as the magazine masthead foot. paper-500. */}
      <text
        x="60"
        y="450"
        fontFamily="Cormorant, 'Cormorant Garamond', Georgia, serif"
        fontStyle="italic"
        fontSize="20"
        fill="#bfae7b"
      >
        wēddly
      </text>
      <text
        x="120"
        y="450"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="11"
        letterSpacing="2"
        fill="#bfae7b"
      >
        · esküvős magazin
      </text>
    </svg>
  );
}
