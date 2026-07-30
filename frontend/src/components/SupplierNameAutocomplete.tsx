// Typeahead over the directory for a field where a couple types a vendor's
// NAME. Sits on the guest-page "Add a venue" form today; the same three fields
// elsewhere (the DIY modal, the planning pipeline, BookedSupplierCard) can take
// it as-is, which is why it holds no venue-specific knowledge.
//
// It is the friendly half of a job the duplicate check already does severely.
// `findSupplierTwins` waits until a name is nearly complete and then WARNS that
// the business is already listed; by then the couple has typed a full record
// they are about to be told not to save. Suggesting from the third character
// turns the same information into an offer, and the pick returns a real listing
// with an address, a pin and a phone instead of a blank private row.
//
// Matching folds through `foldSupplierName`, the same helper the duplicate
// check uses, so "sari" finds "Sári", "Hertelendy Kastély Kft." matches without
// its legal form, and the suggestion list can never disagree with the warning
// that follows it.
//
// Hand-rolled combobox, no UI library: the keyboard contract is the one
// AddressAutocomplete (the very next field on that form) and Combobox already
// use. ArrowUp/Down move, Enter picks, Escape closes, blur closes.

import { Building2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { foldSupplierName } from "@shared/suppliers";
import { useT } from "../lib/i18n";

/** The minimum a candidate needs. Structural rather than `DirectorySupplier`
 *  so a caller can pass whatever row shape it already holds. */
export interface NameSuggestion {
  id: string;
  name: string;
  city: string;
}

/** Three characters, where the duplicate check's loose match needs six. A
 *  suggestion costs a glance and is dismissed by typing on; a warning costs a
 *  decision, so it is right for the two to have different thresholds. */
const MIN_CHARS = 3;
const MAX_SUGGESTIONS = 6;

/** Rank: a name that STARTS with what was typed first, then one where the query
 *  starts a later word, then a bare substring. Without the tiers, typing "kas"
 *  puts "Zichy Kastély" above "Kastélyszálló" on nothing but alphabet. */
function rank(folded: string, q: string): number | null {
  if (folded.startsWith(q)) return 3;
  if (folded.includes(` ${q}`)) return 2;
  if (folded.includes(q)) return 1;
  return null;
}

export function suggestByName<T extends NameSuggestion>(
  query: string,
  options: readonly T[],
  limit = MAX_SUGGESTIONS,
): T[] {
  const q = foldSupplierName(query);
  if (q.length < MIN_CHARS) return [];
  const scored: { item: T; score: number }[] = [];
  for (const o of options) {
    const folded = foldSupplierName(o.name);
    if (!folded) continue;
    const score = rank(folded, q);
    if (score === null) continue;
    scored.push({ item: o, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map((s) => s.item);
}

export function SupplierNameAutocomplete<T extends NameSuggestion>({
  id,
  label,
  value,
  options,
  onChange,
  onPick,
  placeholder,
  maxLength,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  /** What to search. The caller already holds the catalogue it cares about. */
  options: readonly T[];
  onChange: (value: string) => void;
  /** Picked an existing listing. Typing on is always still valid: the
   *  suggestions are an accelerator, never a constraint. */
  onPick: (item: T) => void;
  placeholder?: string;
  maxLength?: number;
  /** One line under the list saying what picking does, since "use the listing"
   *  and "type your own" lead to genuinely different records. */
  hint?: string;
}) {
  const { t } = useT();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // A pick sets the input to the listing's name, which would immediately match
  // itself and reopen the list. Suppressed until the next keystroke.
  const justPicked = useRef(false);

  const matches = useMemo(() => suggestByName(value, options), [value, options]);

  useEffect(() => {
    setActive(-1);
  }, []);

  const visible = open && !justPicked.current && matches.length > 0;

  function pick(item: T) {
    justPicked.current = true;
    setOpen(false);
    setActive(-1);
    onPick(item);
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        className="input"
        value={value}
        onChange={(e) => {
          justPicked.current = false;
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        // A blur that lands ON a suggestion would close the list before the
        // click registers, so the close waits a frame.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!visible) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            const item = matches[active];
            if (item) pick(item);
          } else if (e.key === "Escape") {
            setOpen(false);
            setActive(-1);
          }
        }}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      />
      {visible && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-paper-300 bg-white shadow-pop dark:border-umber-700 dark:bg-umber-800">
          <ul id={listId} role="listbox" aria-label={label}>
            {matches.map((m, i) => (
              <li key={m.id} role="none">
                <button
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  // pointerdown, not click: the input's blur fires first and
                  // would otherwise close the list out from under the press.
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pick(m);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                    i === active
                      ? "bg-paper-100 dark:bg-umber-700"
                      : "hover:bg-paper-100 dark:hover:bg-umber-700"
                  }`}
                >
                  <Building2
                    size={15}
                    aria-hidden="true"
                    className="shrink-0 text-ink-400 dark:text-umber-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900 dark:text-paper-50">
                      {m.name}
                    </span>
                    {m.city && (
                      <span className="block truncate text-xs text-ink-500 dark:text-umber-300">
                        {m.city}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                    {t("venue_picker.suggestion_use")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {hint && (
            <p className="border-t border-paper-200 px-3 py-2 text-[11px] leading-snug text-ink-500 dark:border-umber-700 dark:text-umber-300">
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
