// The one currency picker, shared by onboarding (budget step), the Budget page
// header, and the profile settings panel. Replaced three separate segmented
// pill rows: those were fine for 3 currencies but a 12-wide band wraps into a
// wall on mobile and buries the choice on desktop.
//
// Uber-minimal trigger: the glyph + code the user already recognises ("Ft HUF")
// and nothing else — no "Currency:" caption, the name lives in the menu and the
// aria-label. Row names come from Intl (`currencyName`), so adding a currency
// to CURRENCY_META needs zero new translation keys.
//
// APG listbox-in-a-button pattern: the trigger is the single tab stop; the menu
// takes over arrow keys once open.

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CURRENCIES, type Currency } from "@shared/types";
import { currencyName, currencySymbol } from "../lib/format";
import { useT } from "../lib/i18n";

/** Menu width in px — must track `min-w-[15rem]` on the listbox below. Used to
 *  decide which edge to anchor to BEFORE the menu paints. */
const MENU_WIDTH_PX = 240;
/** Keep this much air between the menu and the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

type Props = {
  value: Currency;
  onChange: (next: Currency) => void;
  /** Accessible name for the control (visually hidden). */
  label: string;
  /** `compact` trims the trigger for inline page headers. */
  size?: "default" | "compact";
};

export function CurrencySelect({ value, onChange, label, size = "default" }: Props) {
  const { locale } = useT();
  const autoId = useId();
  const listboxId = `currency-${autoId}-listbox`;
  const [open, setOpen] = useState(false);
  // Which row the keyboard is on. Kept separate from `value`: arrowing through
  // the menu should preview-highlight without committing, so Escape can back
  // out on the original choice.
  const [activeIdx, setActiveIdx] = useState(() => Math.max(0, CURRENCIES.indexOf(value)));
  const [alignRight, setAlignRight] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  // Re-seed the highlight from the committed value each time the menu opens, so
  // reopening never lands on wherever the last aborted arrow-through ended.
  useEffect(() => {
    if (open) setActiveIdx(Math.max(0, CURRENCIES.indexOf(value)));
  }, [open, value]);

  useEffect(() => {
    if (open) optionRefs.current[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  // Anchor to whichever edge keeps the menu on screen. These triggers usually
  // sit at the right end of a `justify-between` header, where a left-anchored
  // 240px menu runs off a phone screen and clips the rows. Measured per open
  // rather than passed in by each call site, so a caller can't get it wrong —
  // and so the same instance re-decides after a rotate/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAlignRight(rect.left + MENU_WIDTH_PX > window.innerWidth - VIEWPORT_MARGIN_PX);
  }, [open]);

  // Dismiss on outside pointer / focus escape. Bound only while open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(ev: PointerEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function commit(next: Currency) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(ev: React.KeyboardEvent) {
    if (!open) {
      // Down/Up/Enter/Space all open the menu, per the APG combobox pattern.
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(ev.key)) {
        ev.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (ev.key === "Escape" || ev.key === "Tab") {
      setOpen(false);
      if (ev.key === "Escape") {
        ev.preventDefault();
        triggerRef.current?.focus();
      }
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiveIdx((i) => (i + 1) % CURRENCIES.length);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiveIdx((i) => (i - 1 + CURRENCIES.length) % CURRENCIES.length);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      setActiveIdx(0);
    } else if (ev.key === "End") {
      ev.preventDefault();
      setActiveIdx(CURRENCIES.length - 1);
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      const next = CURRENCIES[activeIdx];
      if (next) commit(next);
    } else if (/^[a-z]$/i.test(ev.key)) {
      // Typeahead: "j" jumps to JPY. Matches the code, which is what anyone
      // typing at a currency list is reaching for.
      const from = (activeIdx + 1) % CURRENCIES.length;
      const order = [...CURRENCIES.slice(from), ...CURRENCIES.slice(0, from)];
      const hit = order.find((c) => c.startsWith(ev.key.toUpperCase()));
      if (hit) setActiveIdx(CURRENCIES.indexOf(hit));
    }
  }

  const activeId = open ? `${listboxId}-${CURRENCIES[activeIdx] ?? value}` : undefined;

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeId}
        aria-label={`${label}: ${currencyName(value, locale)}`}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper-50 font-medium text-ink-900 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:hover:bg-umber-700 ${
          size === "compact"
            ? "min-h-[44px] px-3 text-sm sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs"
            : "min-h-[44px] px-4 text-sm"
        }`}
      >
        <span aria-hidden="true">{currencySymbol(value, locale)}</span>
        <span className="tabular-nums text-ink-500 dark:text-umber-300" aria-hidden="true">
          {value}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-400 transition-transform dark:text-umber-400 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          // max-h + scroll: 12 rows overflows a short viewport, and the menu
          // must never push the page taller than the fold on a phone.
          className={`absolute z-30 mt-1 max-h-72 min-w-[15rem] overflow-y-auto rounded-2xl border border-ink-200 bg-paper-50 py-1 shadow-lg dark:border-umber-700 dark:bg-umber-800 ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          {CURRENCIES.map((c, i) => {
            const selected = c === value;
            return (
              <li
                key={c}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                id={`${listboxId}-${c}`}
                role="option"
                aria-selected={selected}
                // Pointer-select on mousedown would fire before the trigger's
                // click handler and reopen the menu; keep it on click.
                onClick={() => commit(c)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm ${
                  i === activeIdx
                    ? "bg-paper-100 dark:bg-umber-700"
                    : "bg-transparent dark:bg-transparent"
                }`}
              >
                <span
                  className="w-8 shrink-0 text-center text-ink-500 dark:text-umber-300"
                  aria-hidden="true"
                >
                  {currencySymbol(c, locale)}
                </span>
                {/* Name only — the glyph is already the badge to the left, so
                    repeating it as "Euró (€)" is noise. The name is what
                    separates the three "kr" currencies from each other. */}
                <span className="flex-1 text-ink-900 dark:text-paper-50">
                  {currencyName(c, locale)}
                </span>
                {selected && (
                  <Check
                    className="h-4 w-4 shrink-0 text-ink-900 dark:text-paper-50"
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
