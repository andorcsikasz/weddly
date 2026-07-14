import type { ReactNode } from "react";

/** Responsive column count that fits ALL tiles on one line at the widest
 *  breakpoint (2-up on phones, then N-up), so a 7- or 8-status bar stops
 *  wrapping into an orphan second row. Literal class strings so Tailwind's JIT
 *  actually emits them. */
function gridColsClass(n: number): string {
  switch (n) {
    case 1:
      return "grid-cols-1";
    case 2:
      return "grid-cols-2";
    case 3:
      return "grid-cols-2 sm:grid-cols-3";
    case 4:
      return "grid-cols-2 sm:grid-cols-4";
    case 5:
      return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
    case 6:
      return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6";
    case 7:
      return "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7";
    case 8:
      return "grid-cols-2 sm:grid-cols-4 lg:grid-cols-8";
    default:
      return "grid-cols-2 sm:grid-cols-4 lg:grid-cols-8";
  }
}

/** One tile in a {@link StatFilter}: a count headline, an optional icon, and a
 *  label. `active` drives the koromfekete fill. */
export interface StatFilterSegment {
  key: string;
  label: string;
  count: number;
  /** Optional glyph shown top-right; inherits the tile's text colour. */
  icon?: ReactNode;
  active: boolean;
}

/** Uber-style segmented stat bar that doubles as a filter (the pattern the
 *  vendor-waitlist inbox introduced): each tile shows its count as the headline
 *  with the label beneath, and the active tile flips to a koromfekete fill so
 *  the current selection reads at a glance on either theme. Presentation-only —
 *  the parent owns selection, so it works for single-select (tablist) and
 *  multi-select (toggle group) alike. */
export function StatFilter({
  ariaLabel,
  segments,
  onSelect,
  multiSelect = false,
}: {
  ariaLabel: string;
  segments: StatFilterSegment[];
  onSelect: (key: string) => void;
  /** true → each tile toggles independently (aria-pressed); false → single
   *  active tab (aria-selected). */
  multiSelect?: boolean;
}) {
  return (
    <div
      role={multiSelect ? "group" : "tablist"}
      aria-label={ariaLabel}
      className={`mb-5 grid gap-2 ${gridColsClass(segments.length)}`}
    >
      {segments.map((s) => (
        <button
          key={s.key}
          type="button"
          role={multiSelect ? undefined : "tab"}
          aria-selected={multiSelect ? undefined : s.active}
          aria-pressed={multiSelect ? s.active : undefined}
          onClick={() => onSelect(s.key)}
          className={`flex min-h-tap flex-col items-start justify-center gap-0.5 rounded-2xl px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 ${
            s.active
              ? "bg-neutral-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
              : "bg-paper-50 text-umber-900 ring-1 ring-ink-100 hover:bg-paper-100 dark:bg-umber-900 dark:text-paper-100 dark:ring-umber-700 dark:hover:bg-umber-800"
          }`}
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="font-grotesk text-2xl font-semibold leading-none tabular-nums">
              {s.count}
            </span>
            {s.icon && (
              <span aria-hidden className={s.active ? "opacity-80" : "opacity-45"}>
                {s.icon}
              </span>
            )}
          </span>
          <span
            className={`text-[11px] font-medium uppercase tracking-[0.08em] ${
              s.active ? "text-paper-200 dark:text-umber-700" : "text-umber-500 dark:text-umber-300"
            }`}
          >
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}
