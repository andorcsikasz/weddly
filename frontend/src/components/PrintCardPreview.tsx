// Instant, in-browser preview of the printable cards. Themed entirely from the
// resolved CoupleDesign (the SAME object the server PDF renderer consumes), so
// toggling border / QR / palette / fonts updates the card
// live with zero round-trip. The pdf-lib render stays the source of truth for
// the actual download; this is the "azonnali nézet" the couple edits against.
//
// No raw hex in the component: colours come from the shared catalog via
// toPublicDesign (override-or-palette), reaching the DOM as inline values that
// are design DATA, not authored literals (same pattern as the palette swatches).

import { type CoupleDesign, getBorderCss, toPublicDesign } from "@shared/design";
import { useT } from "../lib/i18n";

/** Which printable the preview renders. */
export type PrintTemplate = "place_card" | "table_number" | "menu" | "schedule";

export function PrintCardPreview({
  design,
  template,
  brideName,
}: {
  design: CoupleDesign;
  template: PrintTemplate;
  brideName: string | null;
}) {
  const { t } = useT();
  const d = toPublicDesign(design);

  // Menu + schedule cards are taller (portrait); place cards + table numbers
  // are landscape.
  const aspect = template === "menu" || template === "schedule" ? "aspect-[3/4]" : "aspect-[3/2]";

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`relative flex ${aspect} w-full max-w-[26rem] flex-col items-center justify-center px-7 py-6 text-center shadow-soft`}
        style={{
          backgroundColor: d.background,
          color: d.text,
          fontFamily: d.body_font,
          border: getBorderCss(design.borderStyle, d.accent),
          borderRadius: 6,
        }}
      >
        {template === "place_card" && (
          <>
            <span
              className="mt-1 text-2xl leading-tight"
              style={{ color: d.text, fontFamily: d.heading_font }}
            >
              {brideName?.trim() || t("design.print_preview.sample_name")}
            </span>
            <span
              className="mt-2 text-[11px] uppercase tracking-[0.18em]"
              style={{ color: d.text }}
            >
              {t("design.print_preview.sample_table")}
            </span>
          </>
        )}

        {template === "table_number" && (
          <>
            <span
              className="text-6xl leading-none tabular-nums"
              style={{ color: d.text, fontFamily: d.heading_font }}
            >
              12
            </span>
            <span
              className="mt-2 text-[11px] uppercase tracking-[0.18em]"
              style={{ color: d.accent_text }}
            >
              {t("design.print_preview.table_label")}
            </span>
          </>
        )}

        {template === "menu" && (
          <>
            <span
              className="mt-1 text-xl uppercase tracking-[0.18em]"
              style={{ color: d.text, fontFamily: d.heading_font }}
            >
              {t("design.print_preview.menu_title")}
            </span>
            <div className="mt-3 flex flex-col gap-2 text-sm" style={{ color: d.text }}>
              {(["menu_starter", "menu_main", "menu_dessert"] as const).map((key) => (
                <span key={key}>{t(`design.print_preview.${key}`)}</span>
              ))}
            </div>
          </>
        )}

        {template === "schedule" && (
          <>
            <span
              className="mt-1 text-xl uppercase tracking-[0.18em]"
              style={{ color: d.text, fontFamily: d.heading_font }}
            >
              {t("design.print_preview.tpl.schedule")}
            </span>
            <div className="mt-3 flex flex-col gap-2.5 text-sm" style={{ color: d.text }}>
              {(
                [
                  { time: "15:00", key: "ceremony" },
                  { time: "18:00", key: "dinner" },
                  { time: "21:00", key: "party" },
                ] as const
              ).map((row) => (
                <span key={row.key} className="flex items-baseline justify-center gap-2">
                  <span className="tabular-nums" style={{ color: d.accent_text }}>
                    {row.time}
                  </span>
                  <span>{t(`design.print_preview.sample_program.${row.key}`)}</span>
                </span>
              ))}
            </div>
          </>
        )}

        {/* QR placeholder when the toggle is on (place cards only support it). */}
        {design.print.qr && template === "place_card" && (
          <span
            className="absolute bottom-2 right-2 grid h-7 w-7 grid-cols-3 grid-rows-3 gap-px rounded-sm p-0.5"
            style={{ backgroundColor: d.accent }}
            aria-hidden
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static decorative grid
                key={i}
                style={{ backgroundColor: i % 2 === 0 ? d.text : "transparent" }}
              />
            ))}
          </span>
        )}
      </div>

      <p className="text-center text-[11px] text-ink-500 dark:text-umber-300">
        {t("design.print_preview.caption")}
      </p>
    </div>
  );
}
