// The wedding date, set as the wedding date.
//
// Every vendor screen is organised around one fact: which Saturday this is
// about. It was rendered as one more grey cell in one more column, in the same
// face and the same weight as the balance beside it, which is precisely why the
// portal read as an admin template with wedding data in it.
//
// So it gets the workspace's own display face: Cormorant, italic. That idiom is
// a standing user preference for workspace headings, and this is the same
// gesture applied to the one value that deserves it in the vendor portal.
// Deliberately NOT a colour: blush marks what the vendor can act on, and a date
// is not a button. The distinction is carried entirely by the typography, which
// is what makes it survive dark mode, a print stylesheet and a colour-blind
// reader unchanged.
//
// It renders a real `<time datetime>` so the date stays machine-readable, and
// falls back to the caller's own "no date" copy in the ordinary UI sans: an
// absent date must not be dressed up as an occasion.

import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";

type EventDateSize = "sm" | "md" | "lg" | "xl";

/** Sizes are steps of the same treatment, not different treatments. `sm` is the
 *  list cell, `lg` the drawer's own header, `xl` a page hero. */
const SIZE: Record<EventDateSize, string> = {
  sm: "text-[15px] leading-snug",
  md: "text-lg leading-snug",
  lg: "text-2xl leading-tight",
  xl: "text-3xl leading-tight sm:text-4xl",
};

export function EventDate({
  date,
  size = "sm",
  fallback,
  className = "",
}: {
  /** ISO 'YYYY-MM-DD', or null when the booking carries no date. */
  date: string | null;
  size?: EventDateSize;
  /** What to show instead when there is no date. Passed by the caller so the
   *  copy stays in the caller's own namespace. */
  fallback?: string;
  className?: string;
}) {
  const { t, locale } = useT();
  if (!date) {
    return (
      <span className={`text-sm text-ink-400 dark:text-umber-400 ${className}`}>
        {fallback ?? t("vendor.clients.no_event_date")}
      </span>
    );
  }
  return (
    <time
      dateTime={date}
      className={`font-serif italic text-ink-900 dark:text-paper-50 ${SIZE[size]} ${className}`}
    >
      {formatDate(date, locale)}
    </time>
  );
}
