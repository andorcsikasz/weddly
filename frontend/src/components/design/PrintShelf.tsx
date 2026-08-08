// The print shelf: every printable card, rendered in the couple's own look.
//
// This replaces two separate lists that never agreed with each other. There
// used to be a grid of text chips at the top of the editor ("which card am I
// designing?") and, far below it, a second grid of description cards with
// download buttons ("Place cards: printable name cards for the tables"). Same
// six things, twice, neither showing what the card looks like, and a couple had
// to hold the mapping between them in their head.
//
// One shelf now. Every tile is the actual card. Picking one puts it on the
// proof desk, and the desk is what downloads.

import type { CoupleDesign } from "@shared/design";
import { useT } from "../../lib/i18n";
import { PrintCardPreview, type PrintEventData, type PrintTemplate } from "../PrintCardPreview";

export const PRINT_TEMPLATES: readonly PrintTemplate[] = [
  "place_card",
  "table_number",
  "menu",
  "invitation",
  "thank_you",
  "schedule",
];

export function PrintShelf({
  design,
  selected,
  onSelect,
  brideName,
  event,
}: {
  design: CoupleDesign;
  selected: PrintTemplate;
  onSelect: (tpl: PrintTemplate) => void;
  brideName: string | null;
  event?: PrintEventData;
}) {
  const { t } = useT();
  return (
    <section>
      <p className="eyebrow mb-2">{t("design.section.cards")}</p>
      <div className="grid grid-cols-3 gap-2.5">
        {PRINT_TEMPLATES.map((tpl) => {
          const active = selected === tpl;
          const name = t(`design.print_preview.tpl.${tpl}`);
          return (
            <button
              key={tpl}
              type="button"
              onClick={() => onSelect(tpl)}
              aria-pressed={active}
              aria-label={name}
              className={`flex flex-col gap-1.5 rounded-xl border p-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${
                active
                  ? "border-ink-900 bg-white ring-1 ring-ink-900 dark:border-paper-100 dark:bg-umber-800 dark:ring-paper-100"
                  : "border-transparent hover:border-paper-400 dark:hover:border-umber-600"
              }`}
            >
              {/* The tile IS the card, at whatever size the column allows.
                  PrintCardPreview is width-driven, so it scales cleanly. */}
              <span className="pointer-events-none block overflow-hidden rounded">
                <PrintCardPreview
                  design={design}
                  template={tpl}
                  brideName={brideName}
                  event={event}
                />
              </span>
              <span className="truncate px-0.5 text-[11px] font-medium text-ink-700 dark:text-paper-100">
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
