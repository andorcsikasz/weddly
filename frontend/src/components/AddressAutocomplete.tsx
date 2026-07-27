// Google-style address typeahead over the backend geocoder proxy
// (geoApi.addressSuggest → Photon/OSM). A controlled text input that, after a
// short typing pause, shows the top suggestions in a listbox; picking one
// hands the structured suggestion to the parent so sibling fields (city,
// postal code) fill in one gesture. Free typing always stays valid; the
// suggestions are an accelerator, never a constraint.
//
// Hand-rolled combobox (no UI library per the house rules), keyboard
// contract matching components/Combobox.tsx: ArrowUp/Down move, Enter picks,
// Escape closes, blur closes without picking.

import { MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AddressSuggestion } from "@shared/geo";
import { geoApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 3;

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Fired when the user picks a suggestion, AFTER onChange(address line).
   *  Fill the sibling fields (city, postal code) here. */
  onPick: (s: AddressSuggestion) => void;
  /** "city" asks the geocoder for populated places only and writes the town
   *  name (not a street line) into the input, so a field that stores a bare
   *  city ends up with one canonical spelling per town. */
  kind?: "address" | "city";
  /** Inline validation message, rendered under the input and wired to
   *  aria-describedby / aria-invalid. */
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
};

export function AddressAutocomplete({
  id,
  label,
  value,
  onChange,
  onPick,
  kind = "address",
  error,
  required,
  placeholder,
  maxLength,
  disabled,
}: Props) {
  const { t, locale } = useT();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const listboxId = useId();
  // Out-of-order guard + "the last edit was a pick" suppressor: picking a
  // suggestion writes the input value, which must not spawn a new search.
  const requestSeq = useRef(0);
  const suppressNext = useRef(false);

  useEffect(() => {
    if (suppressNext.current) {
      suppressNext.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      geoApi
        .addressSuggest(q, locale, kind)
        .then((r) => {
          if (requestSeq.current !== seq) return;
          setSuggestions(r.suggestions);
          setHighlighted(-1);
          setOpen(r.suggestions.length > 0);
        })
        .catch(() => {
          // Upstream hiccup or rate limit: typing stays fully usable.
          if (requestSeq.current === seq) setOpen(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, locale, kind]);

  function pick(s: AddressSuggestion) {
    suppressNext.current = true;
    onChange(kind === "city" ? (s.city ?? s.label) : (s.address ?? s.label));
    onPick(s);
    setOpen(false);
    setSuggestions([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      const s = suggestions[highlighted];
      if (s) {
        e.preventDefault();
        pick(s);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span className="text-blush-600"> *</span>}
      </label>
      <input
        id={id}
        type="text"
        className={`input ${error ? "border-blush-500 dark:border-blush-400" : ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={highlighted >= 0 ? `${listboxId}-${highlighted}` : undefined}
        aria-autocomplete="list"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}_err` : undefined}
        aria-required={required || undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
      />
      {/* Under its own field, not at the foot of the form: the message has to
          sit where the eye already is when the input is rejected. */}
      {error && (
        <p
          id={`${id}_err`}
          role="alert"
          className="mt-1 text-sm text-blush-700 dark:text-blush-300"
        >
          {error}
        </p>
      )}
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-paper-300 bg-white shadow-lg dark:border-umber-700 dark:bg-umber-800"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.label}
              role="option"
              aria-selected={i === highlighted}
              id={`${listboxId}-${i}`}
            >
              <button
                type="button"
                tabIndex={-1}
                // mousedown, not click: the input's blur would close the list
                // before a click event could land.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm ${
                  i === highlighted
                    ? "bg-paper-100 text-ink-900 dark:bg-umber-700 dark:text-paper-50"
                    : "text-ink-800 dark:text-paper-100"
                }`}
              >
                <MapPin
                  size={15}
                  aria-hidden="true"
                  className="shrink-0 text-umber-400 dark:text-umber-300"
                />
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          ))}
          <li
            aria-hidden="true"
            className="border-t border-paper-200 px-3.5 py-1.5 text-[10px] text-umber-400 dark:border-umber-700 dark:text-umber-400"
          >
            {t("geo.address_attribution")}
          </li>
        </ul>
      )}
    </div>
  );
}
