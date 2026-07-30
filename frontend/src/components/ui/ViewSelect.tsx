import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type ViewSelectOption<T extends string> = {
  value: T;
  label: string;
  /** Optional glyph. When every option carries one the trigger can drop its
   *  label on a narrow screen (see `compact`) and still say what you are
   *  looking at, which a bare chevron cannot. */
  icon?: ReactNode;
};

/** Which fill the selected row in the menu wears. Mirrors `SegmentedTone`:
 *  `ink` is the app-wide default (warm, matches the couple workspace), `steel`
 *  belongs to the vendor portal, which has used it since the calendar shipped. */
export type ViewSelectTone = "ink" | "steel";

const TONE_ACTIVE: Record<ViewSelectTone, string> = {
  ink: "bg-blush-100 text-blush-800 dark:bg-blush-900/40 dark:text-blush-100",
  steel: "bg-steel-100 text-steel-800 dark:bg-steel-900/60 dark:text-steel-100",
};

/** The toolbar view picker: a pill-shaped trigger showing the current view and
 *  a small menu of the rest. Grew out of the vendor calendar, where it sits
 *  beside "Ma" and the calendar/tasks SegmentedControl — same 34px pill height,
 *  same border, so a toolbar reads as one row of controls.
 *
 *  Why a menu and not a segmented control: this picks ONE of five or six
 *  named ranges. A segmented control has to render every option at all times,
 *  which either shrinks them to cryptic shorthand (1D / 1W / 3M) or overflows
 *  a card header. The trigger showing the CURRENT view is also the answer to
 *  "what am I looking at", which shorthand chips never give.
 *
 *  Closes on outside pointerdown, on Escape (returning focus to the trigger),
 *  and on pick. */
export function ViewSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  tone = "ink",
  className,
  compact = false,
}: {
  value: T;
  options: ReadonlyArray<ViewSelectOption<T>>;
  onChange: (v: T) => void;
  ariaLabel: string;
  tone?: ViewSelectTone;
  className?: string;
  /** Below sm, show the current option's icon alone. Only meaningful when the
   *  options carry icons; the label is still announced via `title` and the
   *  trigger's aria-label, and the menu always spells every option out. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      // Escape without this leaves focus on a button that no longer exists.
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`relative${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `${ariaLabel}: ${current.label}` : ariaLabel}
        title={current?.label}
        className={`inline-flex items-center gap-1.5 rounded-full border border-paper-300 py-1.5 text-sm text-ink-700 transition-colors hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:border-umber-700 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100 ${
          compact ? "px-2.5 sm:px-3.5" : "px-3.5"
        }`}
      >
        {current?.icon}
        {current ? (
          <span className={compact ? "hidden sm:inline" : undefined}>{current.label}</span>
        ) : null}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={ariaLabel}
          className="absolute right-0 z-50 mt-2 w-44 origin-top-right rounded-xl border border-paper-300 bg-white p-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                opt.value === value
                  ? TONE_ACTIVE[tone]
                  : "text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
              }`}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
