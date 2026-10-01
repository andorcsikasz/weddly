// Uber-style search: a 36px round icon at rest that grows into the full field
// when clicked, and shrinks back when it is left empty. Lifted out of the
// Guests toolbar so every guest-list search behaves the same way.
//
// ONE element, never swapped: the input itself is the icon button while
// closed (only the glyph shows) and grows into the field when focused.
// Because nothing mounts or unmounts, closing is the same width transition as
// opening, run backwards, and the click that opens it is a click into the
// input. It starts open when a query is already set (a shared ?q= link), so
// the filter narrowing the list is never hidden behind an icon.

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ExpandingSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
  clearLabel,
  openClassName = "w-full basis-full sm:basis-auto",
  tourTarget,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  clearLabel: string;
  /** Width classes while open; closed is always the 36px pill. */
  openClassName?: string;
  tourTarget?: string;
}) {
  const [open, setOpen] = useState(value !== "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  // A query set from outside (a chip's clear-all, a URL) re-opens or lets the
  // field close like a typed one would.
  useEffect(() => {
    if (value !== "") setOpen(true);
  }, [value]);

  return (
    <div
      data-tour-target={tourTarget}
      className={`relative min-w-0 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        open ? openClassName : "w-9 shrink-0"
      }`}
    >
      <Search
        size={14}
        aria-hidden
        className={`pointer-events-none absolute left-[11px] top-1/2 z-10 -translate-y-1/2 transition-colors ${
          open ? "text-ink-400 dark:text-umber-300" : "text-ink-600 dark:text-paper-100"
        }`}
      />
      <input
        ref={inputRef}
        type="search"
        className={`input !min-h-0 h-9 rounded-full !py-0 pl-9 [&::-webkit-search-cancel-button]:appearance-none dark:bg-umber-800 ${
          open
            ? "pr-9"
            : "cursor-pointer !pr-0 text-transparent caret-transparent placeholder:text-transparent hover:border-paper-400"
        }`}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-expanded={open}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value) setOpen(false);
        }}
      />
      {open && value !== "" && (
        <button
          type="button"
          /* Ground the pointer so the input's blur (which closes the field
           *  when it is empty) can't fire between the touch and the click.
           *  Keeping focus in the field while clearing also lets the user
           *  keep typing. */
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label={clearLabel}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
