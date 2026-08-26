// A single country control, replacing a horizontally-scrolling row of chips.
//
// The chip row worked while the catalogue was one or two countries. Past that
// it became a band of a dozen equally-loud pills that pushed the actual vendor
// photos below the fold, scrolled sideways on phones (so the countries past
// Portugal were invisible until you swiped), and gave the current selection no
// more emphasis than the eleven you did not pick. As the directory keeps adding
// countries the row only gets worse.
//
// One button now: it states the current filter, and opens a list. The closed
// state is the answer, the open state is the question.

import { Check, ChevronDown, Globe, type LucideIcon, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface CountryOption {
  code: string;
  label: string;
  count: number;
}

/** Accent/case-insensitive match so typing "buda" or "szekesfehervar" (no
 *  Hungarian diacritics — most people don't bother on a phone keyboard) still
 *  finds "Budapest" / "Székesfehérvár". */
function foldForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function CountryPicker({
  value,
  options,
  onChange,
  allLabel,
  ariaLabel,
  icon: Icon = Globe,
  tone = "brand",
  searchPlaceholder,
  searchEmptyLabel,
  className = "",
}: {
  /** null = every country. */
  value: string | null;
  options: CountryOption[];
  onChange: (code: string | null) => void;
  allLabel: string;
  ariaLabel: string;
  /** Trigger glyph. Defaults to the globe, because countries were the first
   *  and for a while the only facet this control served. It now also runs the
   *  TOWN filter beside it, and both filters behave identically on purpose:
   *  one hand-wired listbox, one set of keyboard semantics, one label pattern,
   *  so the two controls read as a pair rather than as two different ideas
   *  about what a filter is. */
  icon?: LucideIcon;
  /** Closed-state skin. `brand` is the stationery-coffee pill the in-app
   *  directory uses; `ink` is the flat near-black one the public browse page
   *  runs, where every control on the page is monochrome. */
  tone?: "brand" | "ink";
  /** Turns on the type-to-filter search box pinned above the list. Omit for a
   *  short list (countries) where scrolling is already faster than typing; a
   *  town list can run to 60+ rows, where scrolling one at a time is the
   *  slower of the two. */
  searchPlaceholder?: string;
  /** Shown in place of the list when a search matches nothing. */
  searchEmptyLabel?: string;
  /** Extra classes on the root, e.g. `min-w-0 flex-1` so a row of several
   *  pickers can share a fixed-width row on a narrow screen instead of
   *  wrapping — the trigger fills whatever width that leaves it and its own
   *  label truncates rather than pushing a sibling off the row. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Which row the keyboard is on. Index 0 is always the "all countries" row
  // (or, once a search narrows the list, the first surviving row).
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const folded = foldForSearch(query.trim());
  const filteredOptions = useMemo(
    () => (folded ? options.filter((o) => foldForSearch(o.label).includes(folded)) : options),
    [options, folded],
  );
  // The "every X" row stays pinned above the results regardless of the search
  // text — it's a clear-filter action, not a candidate to search for.
  const rows: (CountryOption | null)[] = [null, ...filteredOptions];
  const selected = value === null ? null : (options.find((o) => o.code === value) ?? null);
  const selectedIndex =
    value === null
      ? 0
      : Math.max(
          0,
          rows.findIndex((r) => r?.code === value),
        );

  // Close on an outside press or on scroll-away. Pointerdown rather than click
  // so the menu is gone before the underlying control reacts.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(ev: PointerEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // A search that narrows past the previously-active row would otherwise leave
  // `active` pointing at a row that no longer renders — Enter would then do
  // nothing, silently.
  useEffect(() => {
    if (active >= rows.length) setActive(0);
  }, [active, rows.length]);

  function openMenu() {
    setQuery("");
    setActive(selectedIndex);
    setOpen(true);
    if (searchPlaceholder) requestAnimationFrame(() => searchRef.current?.focus());
  }

  function choose(index: number) {
    const row = rows[index];
    onChange(row === null || row === undefined ? null : row.code);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function onKeyDown(ev: React.KeyboardEvent) {
    if (!open) {
      if (ev.key === "ArrowDown" || ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openMenu();
      }
      return;
    }
    // The search box owns its own keys: Space and Home/End have to type a
    // space and move the text cursor rather than select a row or jump to the
    // list's ends. Only Escape/ArrowUp/ArrowDown/Enter are shared with the
    // list below, matching the combobox pattern (arrow keys browse results
    // while the caret stays in the field).
    const typing = ev.target instanceof HTMLInputElement;
    if (ev.key === "Escape") {
      ev.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActive((i) => (i + 1) % rows.length);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (ev.key === "Home" && !typing) {
      ev.preventDefault();
      setActive(0);
    } else if (ev.key === "End" && !typing) {
      ev.preventDefault();
      setActive(rows.length - 1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      // A search with no surviving row must not fall through to `active`'s
      // stale value — that was still 0 (the pinned "every X" row) from before
      // the last keystroke, so Enter on a typo silently CLEARED the filter
      // instead of doing nothing. Leave the menu open so the search is still
      // there to fix.
      if (typing && folded && filteredOptions.length === 0) return;
      choose(active);
    } else if (ev.key === " " && !typing) {
      ev.preventDefault();
      choose(active);
    }
  }

  return (
    <div ref={rootRef} className={`relative flex min-w-0 ${className}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={`flex min-h-tap w-full min-w-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2 sm:gap-2 sm:px-4 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${
          selected
            ? tone === "ink"
              ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-ink-900"
              : "stationery-coffee border-transparent text-paper-50"
            : tone === "ink"
              ? "border-ink-900/15 bg-transparent text-ink-700 hover:border-ink-900 dark:border-paper-50/20 dark:text-paper-100"
              : "border-umber-600 bg-paper-50 text-ink-700 hover:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
        }`}
      >
        <Icon size={15} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">
          {selected ? selected.label : allLabel}
        </span>
        {/* The count rides along on desktop; dropped below `sm` so three
            pills (country, town, map) plus a search bar can share one row
            on a phone without wrapping — the number is still the first
            thing in the open list. */}
        {selected && (
          <span className="hidden shrink-0 rounded-full bg-paper-100/20 px-1.5 py-0.5 text-[11px] tabular-nums sm:inline-block">
            {selected.count}
          </span>
        )}
        <ChevronDown
          size={15}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {/* A listbox rather than a native <select>: the rows carry a per-country
          count column, and the trigger has to render the selected count too.
          Keyboard and AT semantics are hand-wired above to match. */}
      {open && (
        <div className="absolute left-0 z-40 mt-2 w-64 animate-fade-in overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 shadow-pop dark:border-umber-700 dark:bg-umber-800">
          {searchPlaceholder && (
            <div className="border-b border-paper-200 p-2 dark:border-umber-700">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-400"
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(ev) => {
                    const next = ev.target.value;
                    setQuery(next);
                    // Typing narrows toward a specific town, so Enter should
                    // pick the first match rather than "every town" — the row
                    // that's always pinned at index 0.
                    const nextFiltered = next.trim()
                      ? options.filter((o) =>
                          foldForSearch(o.label).includes(foldForSearch(next.trim())),
                        )
                      : options;
                    setActive(nextFiltered.length > 0 ? 1 : 0);
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  aria-controls={listId}
                  className="min-h-tap w-full rounded-lg border border-paper-300 bg-paper-50 py-2 pl-8 pr-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-300 dark:border-umber-600 dark:bg-umber-900 dark:text-paper-50 dark:placeholder:text-umber-400"
                />
              </div>
            </div>
          )}
          <ul
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-72 overflow-y-auto p-1"
          >
            {rows.map((row, i) => {
              const isSelected = row === null ? value === null : value === row.code;
              return (
                <li key={row?.code ?? "__all"}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => choose(i)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex min-h-tap w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition ${
                      i === active
                        ? "bg-paper-200 dark:bg-umber-700"
                        : "hover:bg-paper-100 dark:hover:bg-umber-700/60"
                    } ${isSelected ? "font-medium text-ink-900 dark:text-paper-50" : "text-ink-700 dark:text-paper-100"}`}
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      {isSelected && <Check size={14} strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="flex-1 truncate">{row === null ? allLabel : row.label}</span>
                    {row !== null && (
                      <span className="shrink-0 text-xs tabular-nums text-ink-400 dark:text-umber-300">
                        {row.count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {searchPlaceholder && folded && filteredOptions.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-400 dark:text-umber-400">
                {searchEmptyLabel ?? null}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
