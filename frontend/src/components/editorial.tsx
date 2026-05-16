/**
 * Editorial typography library — the dramatic typographic moments that
 * break up the landing page's body of text and give it the rhythm of a
 * fashion magazine spread instead of a brochure.
 *
 * These components are deliberately oversized, unanimated, and quiet
 * about colour. They lean on the warm display serif (Cormorant Garamond)
 * and the paper / ink / blush palette to do the work, in the spirit of
 * Stripe / Linear / Vercel marketing surfaces filtered through editorial
 * print conventions (drop-caps, watermark numerals, full-bleed pull-
 * quotes).
 *
 * Composition rules:
 * - Drop them between existing sections of LandingPage as visual
 *   "breath" — they intentionally don't repeat the standard eyebrow +
 *   headline + body rhythm.
 * - Every component accepts an extra `className` so the caller can pin,
 *   pad, or align it inside its parent.
 * - `WatermarkNumeral` requires a `relative` parent; the rest are
 *   block-level and self-contained.
 * - No motion: every component must read as finished when fully static.
 *
 * Tokens: paper / ink / blush only. No raw hex.
 */

import type { ReactNode } from "react";

// ─────────────────────────── WatermarkNumeral ───────────────────────────

type WatermarkPosition = "tl" | "tr" | "bl" | "br";

const watermarkPositionClasses: Record<WatermarkPosition, string> = {
  // Pulled outside the parent's padding box on the smaller axis so the
  // glyph reads as a watermark rather than a caption.
  tl: "top-0 left-0 -translate-y-6 -translate-x-2",
  tr: "top-0 right-0 -translate-y-6 translate-x-2",
  bl: "bottom-0 left-0 translate-y-6 -translate-x-2",
  br: "bottom-0 right-0 translate-y-6 translate-x-2",
};

type WatermarkNumeralProps = {
  /** The glyphs to render — typically a section number like "02" or a
   *  single digit like "5". Strings are accepted so callers can pass
   *  things like "01." or roman numerals. */
  value: string;
  /** Which corner of the (relative) parent to anchor to. Default: tl. */
  position?: WatermarkPosition;
  className?: string;
};

/** A huge italic serif numeral floated behind content as a watermark.
 *  Parent must be `relative`; the numeral is absolutely positioned,
 *  non-interactive, and aria-hidden so it doesn't pollute SR output. */
export function WatermarkNumeral({
  value,
  position = "tl",
  className = "",
}: WatermarkNumeralProps) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute select-none font-serif italic leading-none text-paper-200 dark:text-umber-800 text-[16rem] sm:text-[20rem] lg:text-[24rem] ${watermarkPositionClasses[position]} ${className}`}
    >
      {value}
    </span>
  );
}

// ─────────────────────────── PullQuote ───────────────────────────

type PullQuoteProps = {
  quote: string;
  attribution?: string;
  className?: string;
};

/** Full-bleed editorial pull-quote: hairline rule, italic display
 *  serif at hero scale, then a quiet uppercase attribution. Use to
 *  interrupt a wall of text with a single emotional line. */
export function PullQuote({ quote, attribution, className = "" }: PullQuoteProps) {
  return (
    <blockquote className={`mx-auto flex flex-col items-center text-center ${className}`}>
      <span className="block h-px w-32 bg-paper-400 dark:bg-umber-600" aria-hidden="true" />
      <p className="mt-8 max-w-4xl font-serif text-4xl italic leading-[1.15] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
        {quote}
      </p>
      {attribution ? (
        <footer className="mt-8 text-xs font-medium uppercase tracking-[0.32em] text-ink-500 dark:text-umber-300 sm:text-sm">
          {attribution}
        </footer>
      ) : null}
    </blockquote>
  );
}

// ─────────────────────────── TwoLineHeadline ───────────────────────────

type HeadlineSize = "md" | "lg" | "xl";

const headlineSizeClasses: Record<HeadlineSize, string> = {
  md: "text-4xl sm:text-5xl",
  lg: "text-5xl sm:text-6xl lg:text-[4.5rem]",
  xl: "text-6xl sm:text-7xl lg:text-[6rem]",
};

type TwoLineHeadlineProps = {
  /** Roman / upright opening line. */
  line1: string;
  /** Italic closing line, sits on its own line for the editorial accent. */
  line2: string;
  size?: HeadlineSize;
  className?: string;
};

/** A single h2 split into two display lines: the second one italic for
 *  the accent every editorial spread leans on. */
export function TwoLineHeadline({
  line1,
  line2,
  size = "lg",
  className = "",
}: TwoLineHeadlineProps) {
  return (
    <h2
      className={`font-serif leading-[1.05] tracking-tight text-ink-900 dark:text-paper-50 ${headlineSizeClasses[size]} ${className}`}
    >
      <span className="block">{line1}</span>
      <span className="block italic">{line2}</span>
    </h2>
  );
}

// ─────────────────────────── DropCap ───────────────────────────

type DropCapProps = {
  /** Plain string body. The first character is lifted into a serif
   *  drop-cap; the remainder flows around it. */
  children: string;
  className?: string;
};

/** Paragraph with a large italic serif drop-cap on the first letter.
 *
 *  Implementation note: we split the string in JS rather than relying
 *  on `::first-letter`. The pseudo-element approach is finicky across
 *  browsers (Safari's interpretation of the "first letter" disagrees
 *  with Chromium when the paragraph starts with a quotation mark, and
 *  Tailwind's arbitrary-variant `first-letter:` requires a custom
 *  config tweak to pick up `font-serif`). The split approach is
 *  deterministic and renders identically everywhere. */
export function DropCap({ children, className = "" }: DropCapProps) {
  const text = children ?? "";
  const first = text.slice(0, 1);
  const rest = text.slice(1);
  return (
    <p
      className={`text-base leading-relaxed text-ink-700 dark:text-paper-100 sm:text-lg ${className}`}
    >
      <span
        aria-hidden="true"
        className="float-left mr-3 mt-1 font-serif text-7xl leading-none text-blush-700 dark:text-blush-300 sm:text-8xl"
      >
        {first}
      </span>
      {rest}
    </p>
  );
}

// ─────────────────────────── Marquee ───────────────────────────

type MarqueeProps = {
  /** Items joined with a middle-dot separator. Static — no motion. */
  items: string[];
  className?: string;
};

/** A quiet horizontal strip of repeating tagline text used as an
 *  editorial separator between sections. Static by design — the
 *  rhythm comes from typography, not animation. */
export function Marquee({ items, className = "" }: MarqueeProps) {
  return (
    <div
      className={`overflow-hidden whitespace-nowrap text-center font-serif text-sm italic text-paper-500 dark:text-umber-300 sm:text-base ${className}`}
    >
      {items.join(" · ")}
    </div>
  );
}

// ─────────────────────────── SectionLabel ───────────────────────────

type SectionLabelOrientation = "horizontal" | "vertical";

type SectionLabelProps = {
  /** Section number, e.g. "02" or "02.1". Rendered italic serif. */
  num: string;
  /** Uppercase eyebrow label that sits next to (or under) the numeral. */
  label: string;
  orientation?: SectionLabelOrientation;
  className?: string;
};

/** Editorial section-number block — italic serif numeral, hairline
 *  rule, uppercase letter-spaced eyebrow. Horizontal by default; the
 *  vertical orientation is useful as a column-edge label on wide
 *  layouts. Heavier and more deliberate than the existing inline
 *  SectionEyebrow on LandingPage. */
export function SectionLabel({
  num,
  label,
  orientation = "horizontal",
  className = "",
}: SectionLabelProps) {
  if (orientation === "vertical") {
    return (
      <span className={`inline-flex flex-col items-center gap-3 ${className}`}>
        <NumeralGlyph value={num} />
        <span className="h-10 w-px bg-paper-400 dark:bg-umber-600" aria-hidden="true" />
        <EyebrowGlyph label={label} vertical />
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <NumeralGlyph value={num} />
      <span className="h-px w-8 bg-paper-400 dark:bg-umber-600" aria-hidden="true" />
      <EyebrowGlyph label={label} />
    </span>
  );
}

// ─────────────────────────── internal helpers ───────────────────────────

function NumeralGlyph({ value }: { value: string }): ReactNode {
  return (
    <span className="font-serif text-base italic text-blush-700 dark:text-blush-300">{value}</span>
  );
}

function EyebrowGlyph({ label, vertical = false }: { label: string; vertical?: boolean }) {
  return (
    <span
      className={`text-xs font-semibold uppercase tracking-[0.25em] text-ink-700 dark:text-paper-100 ${
        vertical ? "[writing-mode:vertical-rl] rotate-180" : ""
      }`}
    >
      {label}
    </span>
  );
}
