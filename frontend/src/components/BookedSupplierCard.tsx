// "Már foglaltam" card on /app/suppliers. Renders at the start of the cards
// grid when both the supplier group AND its sub-category are active, so the
// context (which category the couple is booking for) is unambiguous.
//
// Two paths:
//   - Type a name that matches an existing directory entry → dropdown
//     suggests the match; clicking adopts it as the couple's pick (via
//     supplier_selection.setSelection) and the card collapses. No new
//     community submission is created — the couple just confirmed they
//     booked an entry that already exists.
//   - Type a name that doesn't match → "Beküldés tippként" submits via the
//     existing SubmitSupplierModal flow, pre-pinned to the active category
//     and pre-filled with the typed name. From the admin queue's
//     perspective these land exactly like a "Tipp leadása" submission —
//     same review process, same gating.
//
// The card is invisible until activeGroup && activeCat both flip on; the
// SuppliersPage wraps the render in a guard so the directory grid stays
// uncluttered until the couple narrows in on a sub-category.

import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
import { Bookmark, Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { setSelection } from "../lib/supplier_selection";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";

/** Diacritic-folded lower-case match — copied from SuppliersPage's local
 *  helper since the page-level version isn't exported. Tiny enough that the
 *  duplication is cheaper than refactoring it into shared/. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function BookedSupplierCard({
  coupleId,
  category,
  categoryLabel,
  items,
  pickedId,
  onPickExisting,
  onAddNew,
}: {
  /** Couple workspace this card writes picks against. Null when the couple
   *  hasn't loaded yet — the card renders disabled in that case. */
  coupleId: number | null;
  /** The active sub-category. Picks land in this slot, and submissions are
   *  pre-pinned to it on the modal. */
  category: SupplierCategory;
  /** Human-readable category label for the subtitle copy. */
  categoryLabel: string;
  /** Full directory (curated + community), used for the autocomplete match
   *  list. We filter to the active category client-side. */
  items: DirectorySupplier[];
  /** The currently-picked supplier id for this category, if any. Used to
   *  show "this is already your pick" feedback when the dropdown match
   *  equals the existing selection. */
  pickedId: string | null;
  /** Notify the parent that the user adopted an existing directory entry
   *  so it can update its local `selection` state for instant feedback. */
  onPickExisting: (supplier: DirectorySupplier) => void;
  /** Open the SubmitSupplierModal with the typed name + active category
   *  pre-filled. Triggered by the "Beküldés tippként" CTA. */
  onAddNew: (typedName: string) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Filter the directory by the active category + the typed text. Empty
  // input → no dropdown. Cap at 5 visible so the card doesn't push the
  // sibling supplier cards down a long way.
  const queryNorm = useMemo(() => fold(name.trim()), [name]);
  const matches = useMemo<DirectorySupplier[]>(() => {
    if (!queryNorm) return [];
    return items
      .filter((s) => s.category === category)
      .filter((s) => fold(`${s.name} ${s.city}`).includes(queryNorm))
      .slice(0, 5);
  }, [queryNorm, items, category]);

  const adoptExisting = (s: DirectorySupplier) => {
    if (coupleId === null) return;
    setSelection(coupleId, category, s.id);
    onPickExisting(s);
    toast.success(t("suppliers.bookedCard.toast_added", { name: s.name }));
    setName("");
    setPickerOpen(false);
  };

  const submitAsNew = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    onAddNew(trimmed);
  };

  const disabled = coupleId === null;

  return (
    <article
      // Dashed paper-toned border distinguishes the card from real supplier
      // entries (which use solid borders). `auto-rows-fr` on the parent
      // grid stretches this to match neighbouring card heights.
      className="relative flex h-full flex-col rounded-2xl border-2 border-dashed border-paper-400 bg-paper-50/70 p-4 transition hover:border-paper-500 dark:border-umber-600 dark:bg-umber-800/40"
      aria-label={t("suppliers.bookedCard.title")}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-paper-200 text-ink-700 dark:bg-umber-700 dark:text-paper-100"
        >
          <Bookmark size={14} />
        </span>
        <h3 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("suppliers.bookedCard.title")}
        </h3>
      </div>
      <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
        {t("suppliers.bookedCard.subtitle", { category: categoryLabel })}
      </p>
      <div className="relative mt-3">
        <label className="sr-only" htmlFor="booked-supplier-name">
          {t("suppliers.bookedCard.input_label")}
        </label>
        <input
          ref={inputRef}
          id="booked-supplier-name"
          type="text"
          autoComplete="off"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setPickerOpen(true);
          }}
          onFocus={() => setPickerOpen(true)}
          // Delay the close so a mousedown on a suggestion lands before
          // the dropdown unmounts.
          onBlur={() => window.setTimeout(() => setPickerOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) {
              e.preventDefault();
              adoptExisting(matches[0]!);
            } else if (e.key === "Escape") {
              setPickerOpen(false);
            }
          }}
          disabled={disabled}
          placeholder={t("suppliers.bookedCard.placeholder")}
          className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
        />
        {pickerOpen && queryNorm && !disabled && (
          <div
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-paper-300 bg-white py-1 shadow-lg dark:border-umber-700 dark:bg-umber-800"
          >
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink-500 dark:text-umber-300">
                {t("suppliers.bookedCard.no_match")}
              </p>
            ) : (
              matches.map((s) => {
                const alreadyPicked = pickedId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={alreadyPicked}
                    // mousedown fires before the input's blur → click would
                    // race the dropdown's unmount. mousedown wins cleanly.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      adoptExisting(s);
                    }}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm transition hover:bg-paper-100 dark:hover:bg-umber-700"
                  >
                    <span className="truncate font-medium text-ink-800 dark:text-paper-100">
                      {s.name}
                    </span>
                    <span className="shrink-0 text-xs text-ink-500 dark:text-umber-300">
                      {alreadyPicked
                        ? t("suppliers.bookedCard.match_already_picked")
                        : s.city}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-500 dark:text-umber-300">
        {queryNorm && matches.length === 0
          ? t("suppliers.bookedCard.no_match_help")
          : t("suppliers.bookedCard.input_help")}
      </p>
      {/* mt-auto pins the submit row to the bottom regardless of dropdown
          state, so the card's outer footprint stays steady inside the
          equal-height grid. */}
      <div className="mt-auto pt-3">
        <button
          type="button"
          onClick={submitAsNew}
          disabled={disabled || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-ink-400 hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-700"
        >
          <Send size={12} aria-hidden />
          {t("suppliers.bookedCard.submit_as_new")}
        </button>
      </div>
    </article>
  );
}
