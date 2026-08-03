// A couple's initials, set as a monogram.
//
// The vendor's client list used to open with a column of plain names, which is
// the one place a directory of weddings looks exactly like a directory of
// invoices. A monogram is the oldest mark in this trade, it costs one chip of
// space, and it gives a vendor scanning twenty rows something to recognise
// before they have read a single word.
//
// It is TEXT, so it is allowed the chip the portal denies a decorative icon
// (see CLAUDE.md: "no tinted plate behind an icon" is about icons drawn on the
// surface; letters need a field to sit on). The chip stays on the neutral
// paper/umber scale on purpose: blush marks what the vendor can act on, and a
// monogram is not a button. What makes it Weddly rather than a grey avatar is
// the FACE, not a colour: Cormorant, the same display serif the workspace uses
// for its headings and the stationery uses for its covers.

import { type Locale, useT } from "../lib/i18n";
import { intlLocale } from "../lib/format";

/** Splits a display name into the people in it. `&` is what the app itself
 *  writes ("Allie & Noah"), `+` is what couples type, and both survive a
 *  missing space around them. */
const PARTNER_SPLIT = /\s*[&+]\s*|\s+és\s+|\s+and\s+|\s+y\s+/i;

/** The first LETTER of a word, or null when it has none. `\p{L}` rather than
 *  `[A-Za-z]` for the same reason `foldName` keeps it (see CLAUDE.md): folding
 *  to ASCII empties out 王芳 / Ольга / محمد, and an empty monogram on a real
 *  name is worse than no monogram at all. */
function firstLetter(word: string): string | null {
  const m = /\p{L}/u.exec(word);
  return m ? m[0] : null;
}

/** Up to two initials for a couple's display name.
 *
 *  One per person when the name names two people, otherwise the first letters
 *  of the first two words, otherwise the single letter there is. Returns an
 *  empty string when there is no letter anywhere, and the caller draws nothing
 *  rather than an empty circle. */
export function coupleInitials(name: string, locale: Locale = "en"): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "";
  const parts = trimmed
    .split(PARTNER_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const letters: string[] = [];
  if (parts.length >= 2) {
    for (const part of parts) {
      const l = firstLetter(part);
      if (l) letters.push(l);
      if (letters.length === 2) break;
    }
  } else {
    for (const word of trimmed.split(/\s+/)) {
      const l = firstLetter(word);
      if (l) letters.push(l);
      if (letters.length === 2) break;
    }
  }
  return letters.join("").toLocaleUpperCase(intlLocale(locale));
}

type MonogramSize = "sm" | "md" | "lg";

const SIZE: Record<MonogramSize, string> = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-lg",
};

export function CoupleMonogram({
  name,
  size = "sm",
  className = "",
}: {
  name: string;
  size?: MonogramSize;
  className?: string;
}) {
  const { locale } = useT();
  const initials = coupleInitials(name, locale);
  if (initials.length === 0) return null;
  return (
    <span
      // The name is already rendered beside every use of this, so the chip adds
      // nothing for a screen reader and would only make the row read twice.
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full border border-paper-300 bg-paper-100 font-serif font-medium leading-none tracking-[0.06em] text-ink-700 dark:border-umber-600 dark:bg-umber-700 dark:text-paper-200 ${SIZE[size]} ${className}`}
    >
      {initials}
    </span>
  );
}
