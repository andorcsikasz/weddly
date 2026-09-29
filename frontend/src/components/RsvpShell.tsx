// Page chrome shared by the two public RSVP routes: `/rsvp` (the slug + code
// check-in) and `/rsvp/:code` (the legacy single-guest link). Both used to
// carry their own copy of the same `FullPage` wrapper and wordmark row, which
// is exactly the shape that lets two screens of one form drift apart.
//
// The wrapper is where the ANALOG BACKDROP lives — a treated photograph behind
// the guest's form (see `.rsvp-backdrop` / `.rsvp-grain` in index.css). It
// paints two fixed layers plus one z-10 content column, so nothing in the form
// has to know a backdrop exists. Both layers sit at z-0 and the column at z-10
// rather than leaning on paint order, because the sticky kiosk hotspot in
// RsvpCheckinPage is `position: fixed` and would otherwise race the backdrop
// for the same stacking context.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { Wordmark } from "./Wordmark";
import { useT } from "../lib/i18n";

/** Page wrapper: the analog backdrop + the centred form column.
 *
 *  `pb-32` reserves space at the bottom so the iOS soft keyboard doesn't park
 *  itself over the submit button when a guest taps a meal / dietary input —
 *  they can scroll past the form and still see the CTA. */
export function RsvpShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-full">
      <div className="rsvp-backdrop" aria-hidden="true" />
      <div className="rsvp-grain" aria-hidden="true" />
      <div className="relative z-10 px-4 pb-32 pt-8 sm:pt-16">
        <div className="mx-auto max-w-md">{children}</div>
      </div>
    </div>
  );
}

/** The row above the form: wordmark on the left, language on the right.
 *
 *  Both sit directly on the photograph, so they are light-on-dark and the
 *  backdrop's own top scrim is what carries their contrast — which is why
 *  neither carries a background of its own. */
export function RsvpTopBar({ kiosk = false }: { kiosk?: boolean }) {
  const { t } = useT();
  return (
    <div className="mb-6 flex items-center justify-between">
      {kiosk ? (
        // Kiosk: the wordmark stays visible for orientation but is no longer a
        // navigation target — one tap can't escape to the marketing site.
        <span aria-label="Weddly" className="inline-block !text-paper-50">
          <Wordmark size="sm" />
        </span>
      ) : (
        <Link
          to="/"
          aria-label={t("common.back_home_aria")}
          className="inline-block !text-paper-50 transition-colors hover:!text-white"
        >
          <Wordmark size="sm" />
        </Link>
      )}
      {!kiosk && (
        <LocaleSwitcher buttonClassName="btn-ghost btn-sm !text-paper-50 hover:!bg-paper-50/15" />
      )}
    </div>
  );
}
