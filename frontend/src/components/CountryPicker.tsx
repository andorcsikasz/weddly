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

import { Check, ChevronDown, Globe } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface CountryOption {
  code: string;
  label: string;
  count: number;
}

export function CountryPicker({
  value,
  options,
  onChange,
  allLabel,
  ariaLabel,
  tone = "brand",
}: {
  /** null = every country. */
  value: string | null;
  options: CountryOption[];
  onChange: (code: string | null) => void;
  allLabel: string;
  ariaLabel: string;
  /** Closed-state skin. `brand` is the stationery-coffee pill the in-app
   *  directory uses; `ink` is the flat near-black one the public browse page
   *  runs, where every control on the page is monochrome. */
  tone?: "brand" | "ink";
}) {
  const [open, setOpen] = useState(false);
  // Which row the keyboard is on. Index 0 is always the "all countries" row.
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const rows: (CountryOption | null)[] = [null, ...options];
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

  function openMenu() {
    setActive(selectedIndex);
    setOpen(true);
  }

  function choose(index: number) {
    const row = rows[index];
    onChange(row === null || row === undefined ? null : row.code);
    setOpen(false);
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
    } else if (ev.key === "Home") {
      ev.preventDefault();
      setActive(0);
    } else if (ev.key === "End") {
      ev.preventDefault();
      setActive(rows.length - 1);
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      choose(active);
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={`inline-flex min-h-tap items-center gap-2 rounded-full border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${
          selected
            ? tone === "ink"
              ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-ink-900"
              : "stationery-coffee border-transparent text-paper-50"
            : tone === "ink"
              ? "border-ink-900/15 bg-transparent text-ink-700 hover:border-ink-900 dark:border-paper-50/20 dark:text-paper-100"
              : "border-umber-600 bg-paper-50 text-ink-700 hover:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
        }`}
      >
        <Globe size={15} aria-hidden />
        <span>{selected ? selected.label : allLabel}</span>
        {selected && (
          <span className="rounded-full bg-paper-100/20 px-1.5 py-0.5 text-[11px] tabular-nums">
            {selected.count}
          </span>
        )}
        <ChevronDown
          size={15}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {/* A listbox rather than a native <select>: the rows carry a per-country
          count column, and the trigger has to render the selected count too.
          Keyboard and AT semantics are hand-wired above to match. */}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 z-40 mt-2 max-h-80 w-64 animate-fade-in overflow-y-auto rounded-2xl border border-paper-300 bg-paper-50 p-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
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
        </ul>
      )}
    </div>
  );
}
