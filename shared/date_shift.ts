// Moving a plan when the wedding day moves. Pure date arithmetic, no DB and no
// clock, shared by the backend (the shift itself) and the frontend (the offer
// that asks first).
//
// Every date here is an ISO calendar day (YYYY-MM-DD) and is handled in UTC, so
// a shift never lands a day off across a DST boundary.

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoToUtcMs(iso: string): number | null {
  if (!ISO_DAY_RE.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Whole days from `from` to `to` (positive when `to` is later). Null when
 *  either side is not a calendar day. */
export function daysBetweenIso(from: string, to: string): number | null {
  const a = isoToUtcMs(from);
  const b = isoToUtcMs(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / DAY_MS);
}

/** `iso` moved by `days` calendar days. Returns the input unchanged when it
 *  is not a calendar day, so a malformed row is left alone rather than
 *  rewritten into something worse. */
export function shiftIsoDate(iso: string, days: number): string {
  const ms = isoToUtcMs(iso);
  if (ms === null) return iso;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

export interface HoneymoonShiftSuggestion {
  start: string;
  end: string | null;
  /** `moved`: the wedding moved since the trip was booked around it, so the
   *  trip moves by the same number of days. `before_wedding`: nothing tells us
   *  what the trip was planned against, but it starts before the wedding,
   *  so it is offered the day after, keeping its length. */
  reason: "moved" | "before_wedding";
}

/** What the honeymoon should become, given where the wedding is now. Null when
 *  there is nothing to suggest: no wedding date, no trip start, or a trip that
 *  already fits.
 *
 *  `anchor` is the wedding date the trip dates were last saved against
 *  (`couples.honeymoon_anchor_wedding_date`). When it differs from today's
 *  wedding date the whole trip slides by the difference, which keeps "we fly
 *  out two days after" true. Without an anchor the only thing we can say for
 *  sure is that a trip starting before the wedding is wrong. */
export function suggestHoneymoonShift(input: {
  weddingDate: string | null;
  start: string | null;
  end: string | null;
  anchor: string | null;
}): HoneymoonShiftSuggestion | null {
  const { weddingDate, start, end, anchor } = input;
  if (!weddingDate || !start) return null;

  if (anchor && anchor !== weddingDate) {
    const delta = daysBetweenIso(anchor, weddingDate);
    if (delta !== null && delta !== 0) {
      return {
        start: shiftIsoDate(start, delta),
        end: end ? shiftIsoDate(end, delta) : null,
        reason: "moved",
      };
    }
  }

  if (start < weddingDate) {
    const length = end ? daysBetweenIso(start, end) : null;
    const nextStart = shiftIsoDate(weddingDate, 1);
    return {
      start: nextStart,
      end: length !== null && length >= 0 ? shiftIsoDate(nextStart, length) : end,
      reason: "before_wedding",
    };
  }

  return null;
}
