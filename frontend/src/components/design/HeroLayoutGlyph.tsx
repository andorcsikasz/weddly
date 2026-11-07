// A thumbnail sketch of a guest-page opening screen, one per hero layout.
//
// The fine-tune rows render their value instead of naming it, so the layout
// picker draws each composition: where the photo sits (a filled block in the
// couple's own accent) and where the names go (two text lines in their text
// colour). Pure SVG, so it costs nothing and scales to any chip size.

import type { HeroLayoutSlug } from "@shared/design";

export function HeroLayoutGlyph({
  layout,
  colors,
  className = "",
}: {
  layout: HeroLayoutSlug;
  colors: { background: string; text: string; accent: string };
  className?: string;
}) {
  const photo = { fill: colors.accent, opacity: 0.85 };
  const ink = { fill: colors.text };
  return (
    <svg viewBox="0 0 64 44" className={className} aria-hidden role="presentation">
      <rect width="64" height="44" fill={colors.background} />
      {layout === "overlay" && (
        <>
          <rect width="64" height="44" {...photo} />
          <rect x="18" y="17" width="28" height="4" rx="1" fill={colors.background} />
          <rect x="24" y="25" width="16" height="2" rx="1" fill={colors.background} />
        </>
      )}
      {layout === "split" && (
        <>
          <rect width="30" height="44" {...photo} />
          <rect x="37" y="16" width="20" height="4" rx="1" {...ink} />
          <rect x="41" y="24" width="12" height="2" rx="1" {...ink} />
        </>
      )}
      {layout === "arch" && (
        <>
          <rect x="22" y="5" width="20" height="3" rx="1" {...ink} />
          <path d="M23 44 V24 A9 9 0 0 1 41 24 V44 Z" {...photo} />
        </>
      )}
      {layout === "editorial" && (
        <>
          <rect x="6" y="5" width="34" height="7" rx="1" {...ink} />
          <rect x="12" y="14" width="30" height="7" rx="1" {...ink} />
          <rect x="6" y="26" width="52" height="18" {...photo} />
        </>
      )}
      {layout === "poster" && (
        <>
          <rect
            x="21"
            y="4"
            width="22"
            height="26"
            fill="none"
            stroke={colors.accent}
            strokeWidth="0.8"
          />
          <rect x="23" y="6" width="18" height="22" {...photo} />
          <rect x="20" y="34" width="24" height="4" rx="1" {...ink} />
        </>
      )}
    </svg>
  );
}
