// Type-in country picker used by onboarding, the profile-page couple
// settings panel, and the create-additional-workspace dialog. The full
// list (shared/country_list.ts) is ~250 entries, so a plain <select>
// would be a wall of options on mobile; this combobox lets the user
// type a few characters and pick from the filtered top matches.
//
// Filtering is diacritic-folded and case-insensitive, scans both the
// locale-aware name (HU or EN) AND the ISO code so "HU" / "magy" /
// "hung" all surface Hungary. The chosen value is the ISO code; the
// rendered text is the locale-aware name.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { COUNTRIES, countryName, type CountryEntry } from "@shared/country_list";
import { useT } from "../lib/i18n";
import { FieldError } from "./ui/FieldError";
import { HelperText } from "./ui/HelperText";

type Props = {
  /** Current value (ISO 3166-1 alpha-2). Empty string when unset. */
  value: string;
  onChange: (next: string) => void;
  label: string;
  helperText?: string;
  errorText?: string;
  /** When true, a "*" badge follows the label. The input itself stays
   *  uncontrolled-required (the parent form gates submit). */
  required?: boolean;
  placeholder?: string;
  /** Optional id override so a parent form can wire <label htmlFor>. */
  id?: string;
};

/** Strip diacritics + lowercase so "Mexikó" and "mexiko" both match. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

const MAX_RESULTS = 12;

export function CountryCombobox({
  value,
  onChange,
  label,
  helperText,
  errorText,
  required = false,
  placeholder,
  id,
}: Props) {
  const { locale } = useT();
  const autoId = useId();
  const inputId = id ?? `country-${autoId}`;
  const listboxId = `${inputId}-listbox`;
  const helperId = helperText ? `${inputId}-help` : undefined;
  const errorId = errorText ? `${inputId}-error` : undefined;

  // The display text in the input. When the user picks an entry, we
  // commit the ISO to `value` and mirror the locale-aware name into
  // `query` so the input shows the readable name (not "HU"). On open,
  // `query` is initialised from `value`.
  const [query, setQuery] = useState(() => (value ? countryName(value, locale) : ""));
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Re-sync display when the controlling `value` changes from outside
  // (e.g. the parent loads a new couple). Re-run on locale flip too so
  // a switch from EN to HU re-renders the name in the new language.
  useEffect(() => {
    setQuery(value ? countryName(value, locale) : "");
  }, [value, locale]);

  // Click-outside collapses the listbox. Pointerdown rather than click
  // so a tap on a suggestion still commits before the blur path fires.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const matches = useMemo<CountryEntry[]>(() => {
    const q = fold(query.trim());
    if (!q) {
      // No query yet: surface a sensible top-of-list (alphabetised by
      // current-locale name).
      const sorted = [...COUNTRIES].sort((a, b) =>
        countryName(a.code, locale).localeCompare(countryName(b.code, locale), locale),
      );
      return sorted.slice(0, MAX_RESULTS);
    }
    // Scored prefix-first, then substring. ISO code prefix (e.g. "HU")
    // beats name substring so a deliberate code lookup lands at index 0.
    const scored: { entry: CountryEntry; score: number }[] = [];
    for (const c of COUNTRIES) {
      const name = fold(countryName(c.code, locale));
      const code = c.code.toLowerCase();
      let score = 0;
      if (code.startsWith(q)) score = 100;
      else if (name.startsWith(q)) score = 90;
      else if (name.includes(q)) score = 50;
      else if (code.includes(q)) score = 40;
      if (score > 0) scored.push({ entry: c, score });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return countryName(a.entry.code, locale).localeCompare(
        countryName(b.entry.code, locale),
        locale,
      );
    });
    return scored.slice(0, MAX_RESULTS).map((s) => s.entry);
  }, [query, locale]);

  // Keep the highlight inside the visible match window. Resets to 0 on
  // every filter change so arrow-down from a clean state lands on the
  // top match.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function commit(code: string) {
    onChange(code);
    setQuery(countryName(code, locale));
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && matches[highlight]) {
        e.preventDefault();
        commit(matches[highlight].code);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  const invalid = Boolean(errorText);
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="block" ref={wrapRef}>
      <label htmlFor={inputId} className="field-label">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-blush-700 dark:text-blush-300">
            *
          </span>
        )}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && matches[highlight] ? `${inputId}-opt-${matches[highlight].code}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Typing invalidates the previous pick until the user
            // re-selects a row. The parent's required-validation will
            // catch an empty submit.
            if (value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`input ${invalid ? "input-invalid" : ""}`}
        />
        {open && matches.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-paper-300 bg-paper-50 py-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
          >
            {matches.map((c, idx) => {
              const active = idx === highlight;
              return (
                <li
                  key={c.code}
                  id={`${inputId}-opt-${c.code}`}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlight(idx)}
                  onPointerDown={(e) => {
                    e.preventDefault(); // keep focus on the input
                    commit(c.code);
                  }}
                  className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${
                    active
                      ? "bg-paper-200 text-ink-900 dark:bg-umber-700 dark:text-paper-50"
                      : "text-ink-800 dark:text-paper-100"
                  }`}
                >
                  <span>{countryName(c.code, locale)}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {c.code}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {helperText && !errorText && <HelperText id={helperId as string}>{helperText}</HelperText>}
      {errorText && <FieldError id={errorId as string}>{errorText}</FieldError>}
    </div>
  );
}
