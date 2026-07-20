// The Sample Table — the stationer's table, and the first screen of /app/design.
//
// Four finished looks, each rendered as a real invitation carrying the couple's
// own names and their own wedding date. One tap commits the whole world:
// palette, type pairing, ornament language, card layout, date format, button
// chrome, corners, shadow, photo treatment. That commit is the only way those
// things get set, which is what lets the rest of the page shrink from fifteen
// equal-weight option grids down to seven fine-tune rows.
//
// The tiles are comparable because they differ only in the design applied: same
// names, same date, same geometry. That is the whole argument for showing the
// couple's real content here instead of a glyph or a lorem name.

import { type CoupleDesign, STYLE_PRESETS, type StylePresetSlug } from "@shared/design";
import { Check } from "lucide-react";
import { useT } from "../../lib/i18n";
import { ProofCard } from "./ProofCard";

export function SampleTable({
  id,
  open,
  design,
  onChoose,
  brideName,
  groomName,
  weddingDate,
  fallbackName,
  /** A design carrying the given pack, so each tile previews that pack applied
   *  to THIS couple rather than to the catalog's defaults. */
  designForStyle,
}: {
  id: string;
  open: boolean;
  design: CoupleDesign;
  onChoose: (slug: StylePresetSlug) => void;
  brideName: string | null | undefined;
  groomName: string | null | undefined;
  weddingDate: string | null | undefined;
  fallbackName: string;
  designForStyle: (slug: StylePresetSlug) => CoupleDesign;
}) {
  const { t, locale } = useT();
  if (!open) return null;

  return (
    <section
      id={id}
      data-tour-target="design-style"
      className="stationery animate-fade-in rounded-2xl p-4 sm:p-6"
    >
      <p className="eyebrow mb-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
        {t("design.choose")}
        <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
      </p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {STYLE_PRESETS.map((preset) => {
          const active = design.style === preset.slug;
          const name = t(preset.nameKey);
          return (
            <button
              key={preset.slug}
              type="button"
              onClick={() => onChoose(preset.slug)}
              aria-pressed={active}
              aria-label={name}
              className={`group relative flex flex-col gap-2.5 rounded-xl border p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${
                active
                  ? "border-ink-900 bg-white ring-1 ring-ink-900 dark:border-paper-100 dark:bg-umber-800 dark:ring-paper-100"
                  : "border-transparent hover:border-paper-400 dark:hover:border-umber-600"
              }`}
            >
              {active && (
                <span
                  className="absolute right-2 top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                  aria-hidden
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <span
                // Re-keyed on the committed pack so the newly chosen card plays
                // the lift once, and only the chosen one.
                key={active ? `${preset.slug}-on` : preset.slug}
                className={`block overflow-hidden rounded-lg shadow-warm transition group-hover:shadow-pop dark:shadow-none dark:ring-1 dark:ring-umber-700 ${
                  active ? "animate-card-lift" : ""
                }`}
              >
                <ProofCard
                  design={designForStyle(preset.slug)}
                  size="table"
                  brideName={brideName}
                  groomName={groomName}
                  weddingDate={weddingDate}
                  locale={locale}
                  fallbackName={fallbackName}
                />
              </span>
              <span className="truncate px-0.5 font-serif text-lg italic text-ink-900 sm:text-xl dark:text-paper-50">
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
