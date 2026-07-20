// One fine-tune row.
//
// The rule this component enforces: a row's current value is RENDERED, never
// named. The colour row shows the palette as a bar, the type row shows the
// couple's names in the live face, the date row shows their real date in that
// format. Text is the fallback for the one row (Sections) that has no picture.
// That is why the page can carry seven controls in the space the old editor
// spent on two, and why nothing needs a helper sentence underneath it.
//
// A row is one of two shapes:
//   - a SWITCH row: label + switch, no body, no disclosure. Monogram, Dividers.
//   - a SWAP row: label + rendered value + chevron, opening one body at a time.
//
// A swap body always leads with a before/now pair. Comparison is the actual
// question being asked here ("is this better than what I had"), and answering
// it by memory across a 300ms repaint is what made the old grids feel like
// guesswork.

import type { CoupleDesign } from "@shared/design";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { type Locale, useT } from "../../lib/i18n";
import { Switch } from "../ui";
import { ProofCard } from "./ProofCard";

export type TuneRowId =
  | "colors"
  | "fonts"
  | "date"
  | "monogram"
  | "dividers"
  | "cards"
  | "sections"
  | "border";

export function TuneRow({
  id,
  label,
  value,
  open,
  onToggle,
  children,
  /** The design as it was when this row opened, for the before/now pair. */
  before,
  now,
  onRevert,
  couple,
  locale,
  fallbackName,
}: {
  id: TuneRowId;
  label: string;
  /** The rendered current value. A node, not a string, on purpose. */
  value: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  before: CoupleDesign | null;
  now: CoupleDesign;
  onRevert: () => void;
  couple: { bride_name: string | null; groom_name: string | null; wedding_date: string | null };
  locale: Locale;
  fallbackName: string;
}) {
  const { t } = useT();
  const bodyId = `tune-body-${id}`;
  const changed = before !== null && JSON.stringify(before) !== JSON.stringify(now);

  return (
    <div className="scroll-mt-24" id={`tune-${id}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-tap w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-paper-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-300 dark:hover:bg-umber-800/60 dark:focus-visible:ring-paper-100"
      >
        <span className="shrink-0 text-sm font-medium text-ink-900 dark:text-paper-50">
          {label}
        </span>
        <span className="flex min-w-0 flex-1 justify-end">{value}</span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-ink-400 transition-transform dark:text-umber-300 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={bodyId}
          className="animate-fade-in space-y-4 bg-paper-50 px-4 py-4 dark:bg-umber-900/40"
        >
          {before && (
            <div className="flex animate-fade-in-up items-end gap-4">
              {(
                [
                  ["before", before],
                  ["after", now],
                ] as const
              ).map(([which, d]) => (
                <div key={which} className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400 dark:text-umber-300">
                    {t(`design.swap.${which}`)}
                  </span>
                  <span className="block w-24 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/15">
                    <ProofCard
                      design={d}
                      size="pair"
                      brideName={couple.bride_name}
                      groomName={couple.groom_name}
                      weddingDate={couple.wedding_date}
                      locale={locale}
                      fallbackName={fallbackName}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}

          {children}

          <div className="flex items-center justify-end gap-2 pt-1">
            {changed && (
              <button type="button" onClick={onRevert} className="btn btn-ghost btn-sm">
                {t("design.swap.revert")}
              </button>
            )}
            <button type="button" onClick={onToggle} className="btn btn-primary btn-sm">
              {t("design.swap.done")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A row with no body: the whole control is the switch. Same geometry as a swap
 *  row so the list reads as one thing. */
export function TuneSwitchRow({
  label,
  value,
  checked,
  onChange,
  disabled,
  children,
}: {
  label: string;
  /** Rendered specimen of what the switch turns on (a monogram, a divider). */
  value?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Sub-choices that only exist while the switch is on (the monogram's
   *  separator). Revealed in place rather than behind a second disclosure: if
   *  turning something on immediately raises one follow-up question, hiding
   *  that question behind another tap is just a tap. */
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex min-h-tap items-center gap-3 px-4 py-2.5">
        <span className="shrink-0 text-sm font-medium text-ink-900 dark:text-paper-50">
          {label}
        </span>
        <span className="flex min-w-0 flex-1 justify-end">{value}</span>
        <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      </div>
      {checked && children && <div className="animate-fade-in px-4 pb-3">{children}</div>}
    </div>
  );
}

/** The horizontally scrolling option rail every swap body uses. One tab stop,
 *  snap points, no visible scrollbar. */
export function TuneRail({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}
