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

import {
  PRINT_CARD_TYPES,
  type PrintableCardDocument,
  type PrintCardType,
} from "@shared/print_cards";
import { useT } from "../../lib/i18n";
import { PrintCardPreview, type PrintTemplate } from "../PrintCardPreview";

export const PRINT_TEMPLATES: readonly PrintTemplate[] = PRINT_CARD_TYPES;

export function PrintShelf({
  documents,
  selected,
  onSelect,
}: {
  documents: Readonly<Record<PrintCardType, PrintableCardDocument>>;
  selected: PrintTemplate;
  onSelect: (tpl: PrintTemplate) => void;
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
              {/* A fixed portrait canvas makes every grid row and label align.
                  Landscape cards are centred inside it; nothing is clipped by
                  the selection tile, including the offset paper stack. The
                  inner span needs its own w-full: PrintCardPreview's root has
                  no explicit width, and a `place-items-center` grid item with
                  no declared width shrinks to fit-content, which (per spec)
                  resolves the percentage widths deeper in the card as 0 —
                  every line then wraps one character at a time. */}
              <span className="pointer-events-none grid aspect-[3/4] w-full place-items-center overflow-visible rounded p-0.5">
                <span className="block w-full">
                  <PrintCardPreview document={documents[tpl]} thumbnail />
                </span>
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
