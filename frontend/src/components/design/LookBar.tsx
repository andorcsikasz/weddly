// The Look Bar — the committed visual identity, held in one dark warm band.
//
// It is the page's anchor: once a look is chosen the whole Sample Table folds
// into this row, which carries (left to right) a live Stamp of the OTHER
// surface, the look's name, its palette as a weighted bar, and the couple's
// names set in the live heading face. Four different facts, none of them a
// label, all of them the thing itself.
//
// The Stamp is what makes the cross-surface promise visible: while you style
// the guest site it shows the printed card, and vice versa. Tapping it crosses
// over. That is why the old read-only "inherited identity" recap card on the
// print tab could be deleted outright rather than restyled.
//
// Deliberately NOT a <details>/<summary>: the row holds three independent
// controls (Stamp, Undo, Change), and nesting buttons inside a <summary> gives
// them conflicting activation semantics. A real disclosure button with
// aria-expanded/aria-controls is the honest markup here.

import type { CoupleDesign } from "@shared/design";
import { ChevronDown, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { PaletteBar } from "./PaletteBar";
import { ProofCard } from "./ProofCard";
import type { ColorRole } from "@shared/design";

export function LookBar({
  design,
  lookName,
  colors,
  overridden,
  headingFont,
  brideName,
  groomName,
  weddingDate,
  fallbackName,
  surface,
  open,
  onToggle,
  onUndo,
  panelId,
}: {
  design: CoupleDesign;
  lookName: string;
  colors: Record<ColorRole, string>;
  overridden: Partial<Record<ColorRole, boolean>>;
  headingFont: string;
  brideName: string | null | undefined;
  groomName: string | null | undefined;
  weddingDate: string | null | undefined;
  fallbackName: string;
  /** Which surface is being edited. The Stamp always shows the OTHER one. */
  surface: "website" | "print";
  open: boolean;
  onToggle: () => void;
  /** Present only while a pack switch is reversible. */
  onUndo?: () => void;
  panelId: string;
}) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const names = brideName && groomName ? `${brideName} & ${groomName}` : fallbackName;
  const crossLabel = surface === "website" ? t("design.stamp.to_print") : t("design.stamp.to_site");

  return (
    <div className="stationery-coffee flex items-center gap-3 rounded-2xl px-3 py-3 sm:gap-4 sm:px-4">
      {/* The Stamp: a live miniature of the surface you are NOT looking at. */}
      <button
        type="button"
        onClick={() => navigate(`/app/design/${surface === "website" ? "print" : "website"}`)}
        title={crossLabel}
        aria-label={crossLabel}
        className="shrink-0 rounded-[0.3rem] ring-1 ring-paper-100/25 transition hover:ring-paper-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-100"
      >
        <span className="block w-9 overflow-hidden rounded-[0.3rem] sm:w-11">
          <ProofCard
            design={design}
            size="stamp"
            surface={surface === "website" ? "card" : "site"}
            brideName={brideName}
            groomName={groomName}
            weddingDate={weddingDate}
            locale={locale}
            fallbackName={fallbackName}
          />
        </span>
      </button>

      {/* Name + palette + type specimen. Truncation order matters: the palette
          bar survives every width because it is the fastest read of the three. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="truncate font-serif text-xl italic tracking-tight text-paper-50 sm:text-2xl">
          {lookName}
        </p>
        <PaletteBar colors={colors} overridden={overridden} className="max-w-56" />
        <p
          className="hidden truncate text-sm text-paper-200 sm:block"
          style={{ fontFamily: headingFont }}
        >
          {names}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-paper-200 transition hover:bg-paper-100/10 hover:text-paper-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-100 sm:px-3"
          >
            <RotateCcw size={13} aria-hidden />
            <span className="hidden sm:inline">{t("design.undo")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-paper-100/30 px-3 text-xs font-medium text-paper-50 transition hover:border-paper-100/60 hover:bg-paper-100/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-100 sm:px-4 sm:text-sm"
        >
          {t("design.look.change")}
          <ChevronDown
            size={14}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </div>
    </div>
  );
}
