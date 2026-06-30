/**
 * Style-pack ornament library — the four design "languages" rendered as
 * palette-driven SVG. Unlike `botanical.tsx` (Tailwind-class landing art),
 * every shape here inherits a SINGLE colour from `currentColor`, so the
 * consumer drives it from the active palette with an inline
 * `style={{ color: accent }}`. The same four slugs are drawn by the PDF
 * renderer (`backend/src/domain/pdf.ts`) with equivalent vector ops, so the
 * web preview and the printed card never drift.
 *
 *   <OrnamentDivider slug="botanical" style={{ color: accent }} />   // section / card divider
 *   <span className="relative …"><OrnamentFrame slug="oval" /></span>  // card frame overlay
 *
 * Ornament → role:
 *   botanical → thin sprig divider (Garden)
 *   none      → minimal hairline rule (Monochrome — "geometric thin rule")
 *   oval      → row-of-dots divider + oval hairline FRAME on cards (Blush)
 *   deco      → art-deco diamond divider + corner marks on cards (Midnight)
 */

import type { HeadingStyleSlug } from "@shared/design";
import type { OrnamentSlug } from "@shared/design";

/** Map a pack's heading treatment to the CSS a heading element applies on top
 *  of its font stack. Shared by the style tiles, the guest page, and the print
 *  preview so the pack's typographic personality reads identically everywhere.
 *  `null`/absent → no extra treatment. */
export function headingTreatmentCss(
  slug: HeadingStyleSlug | null | undefined,
): React.CSSProperties {
  switch (slug) {
    case "italic":
      return { fontStyle: "italic" };
    case "uppercase":
      return { textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 };
    case "small_caps":
      // The SC font already draws small caps; the property reinforces it on the
      // fallback face and tracks the letters out for the black-tie feel.
      return { fontVariant: "small-caps", letterSpacing: "0.08em" };
    default:
      return {};
  }
}

type DividerProps = { slug: OrnamentSlug; className?: string; style?: React.CSSProperties };

/** A horizontal divider motif keyed to the pack's ornament language. Sits
 *  between the heading and the body on cards / between sections on the web. */
export function OrnamentDivider({ slug, className, style }: DividerProps) {
  const common = {
    className,
    style: { color: "currentColor", ...style },
    "aria-hidden": true,
  } as const;
  switch (slug) {
    case "botanical":
      return (
        <svg viewBox="0 0 120 16" width="120" height="16" fill="none" {...common}>
          <path d="M10 8 H110" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
          {/* central sprig: a few small leaves either side of the midpoint */}
          {[-18, -10, 10, 18].map((dx, i) => (
            <ellipse
              key={dx}
              cx={60 + dx}
              cy={8 + (i % 2 === 0 ? -3.5 : 3.5)}
              rx="6"
              ry="2.4"
              fill="currentColor"
              opacity="0.85"
              transform={`rotate(${dx < 0 ? -28 : 28} ${60 + dx} ${8 + (i % 2 === 0 ? -3.5 : 3.5)})`}
            />
          ))}
          <circle cx="60" cy="8" r="1.6" fill="currentColor" />
        </svg>
      );
    case "deco":
      return (
        <svg viewBox="0 0 120 16" width="120" height="16" fill="none" {...common}>
          <path d="M8 8 H46" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
          <path d="M74 8 H112" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
          {/* open diamond + flanking ticks: art-deco rule */}
          <path
            d="M60 2 L66 8 L60 14 L54 8 Z"
            stroke="currentColor"
            strokeWidth="0.9"
            fill="none"
          />
          <circle cx="60" cy="8" r="1.3" fill="currentColor" />
          <path
            d="M48 8 h3 M69 8 h3"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinecap="round"
          />
        </svg>
      );
    case "oval":
      return (
        <svg viewBox="0 0 120 16" width="120" height="16" fill="none" {...common}>
          {[44, 60, 76].map((cx) => (
            <circle key={cx} cx={cx} cy="8" r="1.8" fill="currentColor" />
          ))}
        </svg>
      );
    default:
      // "none" — a single short geometric rule (Monochrome's restraint).
      return (
        <svg viewBox="0 0 120 16" width="120" height="16" fill="none" {...common}>
          <path d="M40 8 H80" stroke="currentColor" strokeWidth="1.6" strokeLinecap="butt" />
        </svg>
      );
  }
}

type FrameProps = { slug: OrnamentSlug; className?: string; style?: React.CSSProperties };

/** A card FRAME overlay — absolutely positioned inset, no layout impact.
 *  Render inside a `position: relative` card. Returns null for packs whose
 *  identity lives in the divider, not a frame (Garden / Monochrome). */
export function OrnamentFrame({ slug, className, style }: FrameProps) {
  if (slug === "oval") {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        className={`pointer-events-none absolute inset-[8%] h-[84%] w-[84%] ${className ?? ""}`}
        style={{ color: "currentColor", ...style }}
      >
        <ellipse
          cx="50"
          cy="50"
          rx="48"
          ry="46"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (slug === "deco") {
    // Four L-shaped corner marks (art-deco). Each corner is a small bracket.
    const corner = (transform: string, key: string) => (
      <path
        key={key}
        d="M2 14 V2 H14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        transform={transform}
        vectorEffect="non-scaling-stroke"
      />
    );
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        className={`pointer-events-none absolute inset-[6%] h-[88%] w-[88%] ${className ?? ""}`}
        style={{ color: "currentColor", ...style }}
      >
        {corner("translate(0,0)", "tl")}
        {corner("translate(100,0) scale(-1,1)", "tr")}
        {corner("translate(0,100) scale(1,-1)", "bl")}
        {corner("translate(100,100) scale(-1,-1)", "br")}
      </svg>
    );
  }
  return null;
}
