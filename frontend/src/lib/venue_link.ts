// Where a couple's venue label links to.
//
// Two surfaces render "the venue" as something the couple can click — the
// dashboard Kulcsinfó card and the run-sheet summary header — and both have to
// make the same call about WHICH page it opens. The awkward case is a couple
// who typed a new venue name over a still-attached directory pick: they changed
// venues without re-picking, so the old vendor's detail page is the wrong
// place to land. That detach rule lives here rather than in either component,
// so the two can't drift into disagreeing about the same venue.

/** Diacritic-folded lower-case, for comparing a typed venue name against the
 *  picked vendor's name ("Hertelendy Kastely" must match "Hertelendy Kastély"). */
export function foldVenueName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** True when the couple's typed venue name has drifted from the directory pick
 *  still attached to the venue category — treat the pick as stale. False when
 *  either side is empty (nothing to contradict). */
export function venueDetachedFromPick(
  typedName: string | null | undefined,
  pickedName: string | null | undefined,
): boolean {
  if (!typedName || !pickedName) return false;
  return foldVenueName(typedName) !== foldVenueName(pickedName);
}

/** The venue label's href: a directory vendor's own card when we have one,
 *  otherwise the vendors hub. Free-text, DIY and detached venues take the
 *  fallback, so the label is always clickable and never lends a stale vendor's
 *  page to a differently-named venue. */
export function venueVendorHref(supplierId: string | null | undefined): string {
  return supplierId ? `/app/suppliers/${encodeURIComponent(supplierId)}` : "/app/vendors";
}
