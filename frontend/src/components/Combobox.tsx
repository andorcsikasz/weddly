// Hand-rolled typeahead combobox. No third-party UI dep (the design system
// is bespoke — see CLAUDE.md). Powers the supplier-search and city-filter
// fields: free typing plus a Google-style suggestion list the user can
// arrow through or click. The parent owns `value` and computes `options`
// from it; this component owns only the open/active/keyboard state.

import type { ComponentType, ReactNode, SVGProps } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

export interface ComboOption {
  /** Stable unique key (also the value passed back on select). */
  id: string;
  /** Primary display text — the typed fragment is bolded inside it. */
  label: string;
  /** Muted secondary text shown to the right (e.g. a type tag or city). */
  hint?: string;
  /** Optional leading icon for the row. */
  icon?: ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;
}

/** Diacritic fold that preserves length (1:1 on Hungarian accents) so the
 *  highlight index maps cleanly back onto the original label. */
const HU_FOLD: Record<string, string> = {
  á: "a",
  é: "e",
  í: "i",
  ó: "o",
  ö: "o",
  ő: "o",
  ú: "u",
  ü: "u",
  ű: "u",
};
function fold(s: string): string {
  return s.toLowerCase().replace(/[áéíóöőúüű]/g, (c) => HU_FOLD[c] ?? c);
}

/** Bold the run of `label` that matches `query` (diacritic-insensitive). */
function Highlight({ label, query }: { label: string; query: string }) {
  const q = fold(query.trim());
  if (!q) return <>{label}</>;
  const idx = fold(label).indexOf(q);
  if (idx < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, idx)}
      <span className="font-semibold text-ink-900 dark:text-paper-50">
        {label.slice(idx, idx + q.length)}
      </span>
      {label.slice(idx + q.length)}
    </>
  );
}

export function Combobox({
  value,
  onChange,
  onSelect,
  options,
  ariaLabel,
  placeholder,
  leadingIcon: LeadingIcon,
  className,
  inputClassName,
  onClear,
  suffix,
}: {
  value: string;
  onChange: (next: string) => void;
  onSelect: (option: ComboOption) => void;
  /** Suggestions for the current `value`, already filtered + capped by the parent. */
  options: ComboOption[];
  ariaLabel: string;
  placeholder?: string;
  leadingIcon?: ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;
  /** Extra classes for the wrapper <div> (width, flex behaviour). */
  className?: string;
  /** Extra classes for the <input> (border, height, padding). */
  inputClassName?: string;
  /** When provided, a × button appears while `value` is non-empty. */
  onClear?: () => void;
  /** Muted overlay pinned to the right of the field (e.g. "+25 km"). */
  suffix?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  // Reset the active row whenever the option set changes so the highlight
  // never points past the end of a shrunken list.
  useEffect(() => setActive(0), [options.length, options[0]?.id]);

  // Close on any click outside the field + its dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const showList = open && options.length > 0;

  function commit(option: ComboOption | undefined) {
    if (!option) return;
    onSelect(option);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => (options.length ? (a + 1) % options.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (options.length ? (a - 1 + options.length) % options.length : 0));
    } else if (e.key === "Enter") {
      if (showList) {
        e.preventDefault();
        commit(options[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const hasClear = !!onClear && value.length > 0;

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      {LeadingIcon && (
        <LeadingIcon
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
          aria-hidden
        />
      )}
      <input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={inputClassName}
      />
      {(suffix || hasClear) && (
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {suffix && (
            <span className="pointer-events-none whitespace-nowrap text-xs font-medium tabular-nums text-ink-500 dark:text-umber-200">
              {suffix}
            </span>
          )}
          {hasClear && (
            <button
              type="button"
              onClick={() => {
                onClear?.();
                setOpen(false);
              }}
              aria-label={ariaLabel}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </div>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-30 max-h-80 overflow-auto rounded-2xl border border-umber-600 bg-paper-50 py-1 shadow-lg dark:border-umber-700 dark:bg-umber-800"
        >
          {options.map((opt, i) => {
            const Icon = opt.icon;
            return (
              <li key={opt.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // Keep the input focused: select on mousedown before blur fires.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(opt);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${
                    i === active
                      ? "bg-paper-200 text-ink-900 dark:bg-umber-700 dark:text-paper-50"
                      : "text-ink-700 dark:text-paper-100"
                  }`}
                >
                  {Icon && (
                    <Icon
                      size={15}
                      className="shrink-0 text-ink-400 dark:text-umber-300"
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <Highlight label={opt.label} query={value} />
                  </span>
                  {opt.hint && (
                    <span className="shrink-0 text-xs text-ink-400 dark:text-umber-300">
                      {opt.hint}
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
