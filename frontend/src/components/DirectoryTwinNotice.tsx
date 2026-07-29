// "This vendor is already on Weddly" panel.
//
// Rendered under the name field of a form that can create a private
// `couple_suppliers` row, to answer one question: is the business the couple is
// typing already in the directory? If it is, the couple should use THAT entry.
// It carries the photos, address, phone number and reviews their private copy
// never will, and two cards for one venue is what the bug looked like.
//
// Shared by all three such forms: the DIY modal on /app/suppliers, the
// guest-page editor's venue picker, and the vendor pipeline on /app/planning.
// Each passes its own `onUse`, because adopting means something slightly
// different on each. See the twin section in shared/suppliers.ts.
//
// Two intensities, driven by `findSupplierTwins`:
//   - an EXACT name match blocks the save. The form calls this with
//     `blocking`, the only way past is "this is a different vendor", and the
//     primary action adopts the listed one.
//   - a looser (prefix / contained) match is only an offer: the notice shows
//     but the couple's own Save button still works.

import type { DirectorySupplier, SupplierTwin } from "@shared/suppliers";
import { cityDisplayName, supplierCategoryLabel } from "@shared/suppliers";
import { Check, Info } from "lucide-react";
import { useT } from "../lib/i18n";
import { SmartImage } from "./ui";

export function DirectoryTwinNotice({
  twins,
  blocking,
  busy = false,
  onUse,
  onDismiss,
}: {
  /** Best-first directory matches. Rendering is skipped when empty. */
  twins: SupplierTwin<DirectorySupplier>[];
  /** True when an exact match is holding the form's save action. Raises the
   *  tone and reveals the "different vendor" escape. */
  blocking: boolean;
  /** Disables both actions while the adopt round-trip is in flight. */
  busy?: boolean;
  /** Adopt the listed vendor. The caller records the pick and must NOT create
   *  a private row. */
  onUse: (supplier: DirectorySupplier) => void;
  /** Override the block and keep the couple's own entry. Only rendered in
   *  blocking mode — a loose match never stood in the way. */
  onDismiss?: () => void;
}) {
  const { t, locale } = useT();
  if (twins.length === 0) return null;
  const loc = locale === "hu" ? "hu" : "en";

  return (
    <div
      // One neutral panel in both intensities — the blocking state earns a
      // firmer border rather than a hue, since a colour here would read as an
      // error and finding the couple's venue already listed is good news.
      className={`rounded-xl border bg-paper-100/70 px-3 py-2.5 dark:bg-umber-700/40 ${
        blocking ? "border-ink-300 dark:border-umber-500" : "border-paper-300 dark:border-umber-700"
      }`}
      // Announced because it can appear after the couple has already pressed
      // Save — silently swapping the outcome would be the worse bug.
      role="status"
    >
      <p className="flex items-start gap-1.5 text-xs font-medium text-ink-800 dark:text-paper-100">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        {t(blocking ? "suppliers.twin.blocking_title" : "suppliers.twin.title")}
      </p>
      <p className="mt-1 pl-[1.15rem] text-xs text-ink-500 dark:text-umber-300">
        {t("suppliers.twin.body")}
      </p>

      <ul className="mt-2 flex flex-col gap-1.5">
        {twins.map(({ supplier }) => {
          const city = supplier.city ? cityDisplayName(supplier.city) : "";
          return (
            <li
              key={supplier.id}
              className="flex items-center gap-2.5 rounded-lg border border-paper-300 bg-white px-2.5 py-2 dark:border-umber-700 dark:bg-umber-800"
            >
              {supplier.hero_image_url ? (
                <SmartImage
                  src={supplier.hero_image_url}
                  alt=""
                  wrapperClassName="h-9 w-9 shrink-0 rounded-md"
                  className="h-9 w-9 object-cover"
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                  {supplier.name}
                </span>
                <span className="block truncate text-[11px] text-ink-500 dark:text-umber-300">
                  {[supplierCategoryLabel(supplier.category, loc), city]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onUse(supplier)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-800 px-3 py-1.5 text-xs font-semibold text-paper-50 transition hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-white"
              >
                <Check size={12} strokeWidth={3} aria-hidden />
                {t("suppliers.twin.use")}
              </button>
            </li>
          );
        })}
      </ul>

      {blocking && onDismiss && (
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="mt-2 text-xs font-medium text-ink-500 underline underline-offset-2 transition hover:text-ink-800 disabled:opacity-50 dark:text-umber-300 dark:hover:text-paper-100"
        >
          {t("suppliers.twin.different")}
        </button>
      )}
    </div>
  );
}
