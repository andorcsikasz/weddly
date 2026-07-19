// Popover date field — the app's answer to `<input type="date">`.
//
// `CalendarPicker` is deliberately just a grid: it renders inside a
// `position: relative` wrapper and leaves open/close, click-outside and Escape
// to its parent. Every caller that wanted a plain date input therefore had to
// re-implement that shell, which is why the vendor surfaces kept reaching for
// the native control instead — and native date inputs drag in the browser's own
// calendar glyph and popup, which look different in every browser and match
// nothing else in the app.
//
// This wraps the grid in that missing shell so a date field is a one-liner.

import { CalendarDays, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarPicker } from "./CalendarPicker";

/** Render an ISO 'YYYY-MM-DD' in the user's locale. Parsed as UTC midnight so
 *  the displayed day can't shift under a negative timezone offset. */
function formatIso(iso: string, locale: "hu" | "en"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function DateField({
  label,
  value,
  onChange,
  locale,
  min,
  placeholder,
  disabled = false,
  clearable = false,
  id,
}: {
  /** Visible field label. Omit for a bare trigger (the caller owns the label). */
  label?: string;
  /** Current value as ISO-8601 (YYYY-MM-DD), or "" / null for empty. */
  value: string | null;
  /** Called with the picked YYYY-MM-DD, or "" when cleared. */
  onChange: (ymd: string) => void;
  locale: "hu" | "en";
  /** Earliest selectable date as ISO-8601. */
  min?: string;
  /** Shown on the trigger while empty. */
  placeholder?: string;
  disabled?: boolean;
  /** Show an inline clear button once a date is set. */
  clearable?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const fieldId = id ?? autoId;

  // Click-outside + Escape, the shell CalendarPicker deliberately doesn't own.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const has = Boolean(value);

  return (
    <div className="w-full">
      {label && (
        <label className="field-label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          id={fieldId}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="input flex w-full items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CalendarDays
            size={15}
            aria-hidden="true"
            className="shrink-0 text-ink-400 dark:text-umber-300"
          />
          <span className={has ? "" : "text-ink-400 dark:text-umber-300"}>
            {has && value ? formatIso(value, locale) : (placeholder ?? "")}
          </span>
        </button>
        {clearable && has && !disabled && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={locale === "hu" ? "Dátum törlése" : "Clear date"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
        {open && (
          <CalendarPicker
            value={value || null}
            min={min}
            locale={locale}
            onSelect={(ymd) => {
              onChange(ymd);
              setOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
