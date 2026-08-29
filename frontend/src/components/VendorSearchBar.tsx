// The directory's front door: one box that takes a business name, a town, or a
// kind of vendor, and offers three ways to go.
//
// The three kinds are matched in two places on purpose. Names and towns come
// from GET /api/public/vendor-search (the server holds the data); CATEGORIES
// are matched here, because their names live in the frontend locale tree in
// three languages and a second copy on the server would drift. Both sides
// score with `searchScore` from shared, so merging them is a sort.
//
// Empty box is not a dead end: the list shows one row for the whole directory,
// and Enter on an empty query goes straight there.

import {
  foldForSearch,
  type PublicVendorSuggestion,
  searchScore,
  VENDOR_SEARCH_LIMIT,
  VENDOR_SEARCH_MIN_CHARS,
} from "@shared/suppliers";
import { ArrowRight, LayoutGrid, MapPin, Search, Store } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { categoryIcon } from "../lib/category_icons";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const DEBOUNCE_MS = 200;

// The landing page's own instance only: a handful of near-universal
// categories (every market has photographers and venues) so the demo never
// types something a thin market has zero results for.
const DEMO_CATEGORIES = ["photography", "venue", "florist", "dj", "catering"] as const;
// The runner types, holds, erases, and moves to the next word — a loop
// that never leaves the page. ~1s before the first keystroke (lets the
// section settle into view), then each word gets its own type/hold/erase
// beat.
const DEMO_WORD_COUNT = 4;
const DEMO_START_DELAY_MS = 1000;
const DEMO_TYPE_BUDGET_MS = 1400;
const DEMO_HOLD_MS = 1100;
const DEMO_ERASE_STEP_MS = 30;
const DEMO_PAUSE_MS = 450;

/** Where picking a row takes the visitor. A vendor has its own public page;
 *  a town and a category are both filters on the browse teaser. */
function hrefFor(s: PublicVendorSuggestion): string {
  if (s.kind === "vendor" && s.id) return `/suppliers/${encodeURIComponent(s.id)}`;
  if (s.kind === "city") {
    const qs = new URLSearchParams({ city: s.label });
    // Carries the town's own country along so the browse page's country
    // filter follows the pick instead of staying on whatever was already
    // selected — see VendorBrowsePage's city-sync effect, the other half of
    // this fix.
    if (s.country) qs.set("country", s.country);
    return `/suppliers/browse?${qs}`;
  }
  if (s.kind === "category" && s.category) {
    return `/suppliers/browse?category=${encodeURIComponent(s.category)}`;
  }
  return "/suppliers/browse";
}

export function VendorSearchBar({
  className = "",
  autoDemo = false,
}: {
  className?: string;
  /** Landing-page only: types an example category into the box on its own,
   *  then — if the visitor never touched the box — hands off to the real
   *  directory. See the effect below for why and how. */
  autoDemo?: boolean;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PublicVendorSuggestion[]>([]);
  // Which row Enter would take. -1 = none highlighted, which is why Enter
  // falls through to "the first row, else the whole directory" below.
  const [active, setActive] = useState(-1);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const trimmed = q.trim();
  const enoughToSearch = trimmed.length >= VENDOR_SEARCH_MIN_CHARS;

  useEffect(() => {
    if (!enoughToSearch) {
      setItems([]);
      setActive(-1);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      supplierApi
        .publicSearch(trimmed)
        .then((res) => {
          if (cancelled) return;
          const folded = foldForSearch(trimmed);
          // Category rows are built here so their labels are in the visitor's
          // own language; the count comes from the server's census so we never
          // offer a category with nothing browsable behind it.
          const catHits: PublicVendorSuggestion[] = [];
          for (const c of res.categories) {
            const label = t(`suppliers.cat.${c.category}`);
            const base = searchScore(label, folded);
            if (base === 0) continue;
            catHits.push({
              kind: "category",
              // Same volume nudge the server applies to towns, so a big
              // category and a big town rank against each other fairly.
              score: base + Math.min(6, Math.log(c.count + 1) * 2),
              label,
              category: c.category,
              count: c.count,
            });
          }
          const merged = [...res.suggestions, ...catHits]
            .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
            .slice(0, VENDOR_SEARCH_LIMIT);
          setItems(merged);
          setActive(-1);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, enoughToSearch, t]);

  // Close on an outside click. Pointerdown rather than click so the panel is
  // gone before a tap lands on whatever is underneath it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // The landing-page "runner": types a handful of example categories into
  // the box on its own, one after another, so the box never sits looking
  // inert on a page a visitor hasn't touched yet. It never navigates —
  // typing an example is a demo, not a decision the visitor made, so the
  // loop just erases each word and moves to the next rather than handing
  // the visitor off to the directory. Any real interaction — a click, a
  // keypress, focusing the input — cancels it permanently for this mount;
  // it never fights a visitor who is actually using the box.
  useEffect(() => {
    if (!autoDemo) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const root = rootRef.current;
    if (!root) return;

    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let tickInterval: ReturnType<typeof setInterval> | null = null;

    function stop() {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      if (tickInterval) clearInterval(tickInterval);
    }

    function onInteract() {
      stop();
    }
    root.addEventListener("pointerdown", onInteract);
    root.addEventListener("focusin", onInteract);
    root.addEventListener("keydown", onInteract);

    // Shuffled once per mount and then looped, so a visitor who lingers
    // sees a handful of different examples cycle rather than one word
    // repeating.
    const sequence = [...DEMO_CATEGORIES].sort(() => Math.random() - 0.5).slice(0, DEMO_WORD_COUNT);
    let wordIndex = 0;

    function typeWord() {
      if (cancelled) return;
      const category = sequence[wordIndex % sequence.length];
      if (!category) return;
      const label = t(`suppliers.cat.${category}`);
      const stepMs = Math.max(55, Math.min(140, DEMO_TYPE_BUDGET_MS / Math.max(label.length, 1)));
      let i = 0;
      tickInterval = setInterval(() => {
        if (cancelled) return;
        i += 1;
        setQ(label.slice(0, i));
        if (i >= label.length) {
          if (tickInterval) clearInterval(tickInterval);
          const holdTimer = setTimeout(() => {
            if (cancelled) return;
            eraseWord(label);
          }, DEMO_HOLD_MS);
          timers.push(holdTimer);
        }
      }, stepMs);
    }

    function eraseWord(label: string) {
      if (cancelled) return;
      let i = label.length;
      tickInterval = setInterval(() => {
        if (cancelled) return;
        i -= 1;
        setQ(label.slice(0, Math.max(i, 0)));
        if (i <= 0) {
          if (tickInterval) clearInterval(tickInterval);
          wordIndex += 1;
          const pauseTimer = setTimeout(() => {
            if (cancelled) return;
            typeWord();
          }, DEMO_PAUSE_MS);
          timers.push(pauseTimer);
        }
      }, DEMO_ERASE_STEP_MS);
    }

    const startTimer = setTimeout(typeWord, DEMO_START_DELAY_MS);
    timers.push(startTimer);

    return () => {
      stop();
      root.removeEventListener("pointerdown", onInteract);
      root.removeEventListener("focusin", onInteract);
      root.removeEventListener("keydown", onInteract);
    };
    // Deliberately one-shot on mount: `t` and `autoDemo` don't change mid-life
    // for this instance, and re-keying on `t` would restart the runner on
    // every locale-tree reload.
  }, [autoDemo]);

  function go(s: PublicVendorSuggestion | null) {
    setOpen(false);
    // A vendor hit leaves the page entirely, so the stale query never shows
    // again; a city/category hit stays on /suppliers/browse (this same
    // component instance), and without this the box kept showing what was
    // TYPED ("Buda") while the pickers beside it already read the picked
    // value ("Budapest") — two answers to "what's filtered right now".
    setQ("");
    navigate(s ? hrefFor(s) : "/suppliers/browse");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (items.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return ((next % items.length) + items.length) % items.length;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Highlighted row wins; otherwise the best match; otherwise everything.
      go(items[active] ?? items[0] ?? null);
      return;
    }
    if (e.key === "Escape") setOpen(false);
  }

  const showPanel = open && (items.length > 0 || !enoughToSearch || trimmed.length > 0);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Near-black outline, not the tan paper-300 hairline it used to wear: on
          a cream page that border read as an absence, and this box is the
          directory's front door. Focus adds a ring rather than thickening the
          border, which would shift the row by a pixel. Dark mode inverts to a
          light outline for the same reason the arrow button does — a near-black
          edge on umber-800 is no edge at all. */}
      <div className="flex items-center gap-2 rounded-full border border-umber-900 bg-white px-4 py-2.5 shadow-soft transition focus-within:ring-2 focus-within:ring-umber-900/20 dark:border-paper-200 dark:bg-umber-800 dark:focus-within:ring-paper-200/25 sm:px-5 sm:py-3">
        <Search
          size={18}
          strokeWidth={1.8}
          aria-hidden
          className="shrink-0 text-umber-500 dark:text-umber-300"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label={t("landing.suppliers_search_label")}
          placeholder={t("landing.suppliers_search_placeholder")}
          className="min-w-0 flex-1 bg-transparent font-grotesk text-base text-umber-900 outline-none placeholder:text-umber-500 dark:text-paper-50 dark:placeholder:text-umber-300 [&::-webkit-search-cancel-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => go(items[active] ?? items[0] ?? null)}
          aria-label={t("landing.suppliers_search_submit")}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-umber-900 text-paper-50 transition hover:bg-umber-800 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-50"
        >
          <ArrowRight size={17} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {showPanel && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("landing.suppliers_search_label")}
          className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-umber-900 bg-white py-1 shadow-pop dark:border-paper-200 dark:bg-umber-800"
        >
          {items.map((s, i) => {
            const Icon =
              s.kind === "vendor"
                ? Store
                : s.kind === "city"
                  ? MapPin
                  : categoryIcon(s.category ?? "other");
            const count = s.count ?? 0;
            const sub =
              s.kind === "vendor"
                ? [s.category ? t(`suppliers.cat.${s.category}`) : null, s.city]
                    .filter(Boolean)
                    .join(" · ")
                : count === 1
                  ? t("landing.suppliers_search_count_one")
                  : t("landing.suppliers_search_count", { n: count });
            return (
              <li key={`${s.kind}-${s.id ?? s.label}`}>
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(s)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === active ? "bg-paper-100 dark:bg-umber-700/60" : ""
                  }`}
                >
                  <Icon
                    size={16}
                    strokeWidth={1.7}
                    aria-hidden
                    className="shrink-0 text-umber-600 dark:text-umber-200"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-grotesk text-sm font-medium text-umber-900 dark:text-paper-50">
                      {s.label}
                    </span>
                    <span className="block truncate font-grotesk text-xs text-umber-600 dark:text-umber-300">
                      {sub}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {/* Always last, always there: the way out of a query that found
              nothing, and the default when the box is empty. */}
          <li>
            <button
              type="button"
              onClick={() => go(null)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paper-100 dark:hover:bg-umber-700/60"
            >
              <LayoutGrid
                size={16}
                strokeWidth={1.7}
                aria-hidden
                className="shrink-0 text-umber-600 dark:text-umber-200"
              />
              <span className="font-grotesk text-sm font-medium text-umber-900 dark:text-paper-50">
                {t("landing.suppliers_search_all")}
              </span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
