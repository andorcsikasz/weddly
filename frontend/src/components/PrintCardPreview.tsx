// Instant, in-browser preview of the printable cards. Themed entirely from the
// resolved CoupleDesign (the SAME object the server PDF renderer consumes), so
// toggling border / QR / palette / fonts updates the card
// live with zero round-trip. The pdf-lib render stays the source of truth for
// the actual download; this is the "azonnali nézet" the couple edits against.
//
// Each style pack speaks its own card LANGUAGE: the four packs branch on
// `card_layout` (centered / asymmetric / framed / corners) so they look
// genuinely different, not just recoloured. The pack's ornament language drives
// the divider + frame motifs and `heading_style` drives the name treatment, all
// resolved from `toPublicDesign` — the same bones the guest page + PDF render.
//
// No raw hex in the component: colours come from the shared catalog via
// toPublicDesign (override-or-palette), reaching the DOM as inline values that
// are design DATA, not authored literals (same pattern as the palette swatches).

import { type CoupleDesign, getBorderCss, toPublicDesign } from "@shared/design";
import { useT } from "../lib/i18n";
import { OrnamentDivider, OrnamentFrame, headingTreatmentCss } from "./ornaments";

/** Which printable the preview renders. */
export type PrintTemplate =
  | "place_card"
  | "table_number"
  | "menu"
  | "schedule"
  | "invitation"
  | "thank_you";

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

  // Menu / schedule / invitation / thank-you cards are taller (portrait); place
  // cards + table numbers are landscape.
  const portrait =
    template === "menu" ||
    template === "schedule" ||
    template === "invitation" ||
    template === "thank_you";
  const aspect = portrait ? "aspect-[3/4]" : "aspect-[3/2]";

  // The pack's personality, resolved once and reused by every template body.
  const hCss = headingTreatmentCss(d.heading_style); // name/heading treatment
  const layout = d.card_layout;
  const isLeft = layout === "asymmetric"; // Monochrome drops the centre axis
  const labelColor = layout === "corners" ? d.accent_text : d.text;

  // Container alignment: every pack centres except Monochrome's left rag.
  const alignCls = isLeft
    ? "items-start justify-center text-left"
    : "items-center justify-center text-center";

  // Card-frame overlay (absolute inset, no layout impact). Blush draws its oval
  // hairline; Midnight drops art-deco corner marks. Garden / Monochrome carry
  // their identity in the divider, so no frame.
  const frame =
    layout === "framed" ? (
      <OrnamentFrame slug={d.ornament} style={{ color: d.accent }} />
    ) : layout === "corners" ? (
      <OrnamentFrame slug="deco" style={{ color: d.accent }} />
    ) : null;

  // The pack's divider motif, coloured from the accent. Sits between the
  // heading and the body on every template; size overridable via className.
  const divider = (className?: string) => (
    <OrnamentDivider slug={d.ornament} className={className} style={{ color: d.accent }} />
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`relative flex ${aspect} w-full max-w-[26rem] flex-col ${alignCls} px-7 py-6 shadow-soft`}
        style={{
          backgroundColor: d.background,
          color: d.text,
          fontFamily: d.body_font,
          border: getBorderCss(design.borderStyle, d.accent),
          borderRadius: 6,
        }}
      >
        {frame}

        {template === "place_card" && (
          <>
            {/* Monochrome's asymmetric tell: a small seat index pinned top-right,
                tabular figures, no centre axis. */}
            {isLeft && (
              <span
                className="absolute right-5 top-5 text-sm tabular-nums"
                style={{ color: d.accent_text }}
                aria-hidden
              >
                01
              </span>
            )}
            <span
              className={`${isLeft ? "text-3xl" : "text-2xl"} mt-1 leading-tight`}
              style={{ color: d.text, fontFamily: d.heading_font, ...hCss }}
            >
              {brideName?.trim() || t("design.print_preview.sample_name")}
            </span>
            {divider("my-3")}
            <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: labelColor }}>
              {t("design.print_preview.sample_table")}
            </span>
          </>
        )}

        {template === "table_number" && (
          <>
            {/* The number is the hero — much larger than the label, styled per
                pack (small-caps/italic/uppercase are harmless on digits). */}
            <span
              className="text-7xl leading-none tabular-nums"
              style={{ color: d.text, fontFamily: d.heading_font, ...hCss }}
            >
              12
            </span>
            {divider("my-2")}
            <span
              className="text-[11px] uppercase tracking-[0.18em]"
              style={{ color: d.accent_text }}
            >
              {t("design.print_preview.table_label")}
            </span>
          </>
        )}

        {template === "menu" && (
          <>
            <span
              className="mt-1 text-xl tracking-[0.12em]"
              style={{ color: d.text, fontFamily: d.heading_font, ...hCss }}
            >
              {t("design.print_preview.menu_title")}
            </span>
            {divider("my-3")}
            <div
              className={`flex flex-col gap-2 text-sm ${isLeft ? "items-start" : "items-center"}`}
              style={{ color: d.text }}
            >
              {(["menu_starter", "menu_main", "menu_dessert"] as const).map((key) => (
                <span key={key}>{t(`design.print_preview.${key}`)}</span>
              ))}
            </div>
          </>
        )}

        {template === "schedule" && (
          <>
            <span
              className="mt-1 text-xl tracking-[0.12em]"
              style={{ color: d.text, fontFamily: d.heading_font, ...hCss }}
            >
              {t("design.print_preview.tpl.schedule")}
            </span>
            {divider("my-3")}
            <div
              className={`flex flex-col gap-2.5 text-sm ${isLeft ? "items-start" : "items-center"}`}
              style={{ color: d.text }}
            >
              {(
                [
                  { time: "15:00", key: "ceremony" },
                  { time: "18:00", key: "dinner" },
                  { time: "21:00", key: "party" },
                ] as const
              ).map((row) => (
                <span
                  key={row.key}
                  className={`flex items-baseline gap-2 ${isLeft ? "justify-start" : "justify-center"}`}
                >
                  <span className="tabular-nums" style={{ color: d.accent_text }}>
                    {row.time}
                  </span>
                  <span>{t(`design.print_preview.sample_program.${row.key}`)}</span>
                </span>
              ))}
            </div>
          </>
        )}

        {template === "invitation" && (
          <>
            <span
              className="text-[11px] uppercase tracking-[0.18em]"
              style={{ color: d.accent_text }}
            >
              {t("design.print_preview.invitation_eyebrow")}
            </span>
            <span
              className="mt-2 text-2xl leading-tight"
              style={{ color: d.text, fontFamily: d.heading_font, ...hCss }}
            >
              {t("design.print_preview.sample_couple")}
            </span>
            {divider("my-3")}
            <span className="text-sm" style={{ color: d.text }}>
              {t("design.print_preview.invitation_line")}
            </span>
            <span
              className="mt-2 text-sm tracking-[0.12em]"
              style={{ color: d.accent_text, fontFamily: d.heading_font, ...hCss }}
            >
              {t("design.print_preview.sample_date")}
            </span>
            <span className="mt-1 text-xs" style={{ color: labelColor }}>
              {t("design.print_preview.invitation_venue")}
            </span>
          </>
        )}

        {template === "thank_you" && (
          <>
            <span
              className="mt-1 text-3xl leading-tight"
              style={{ color: d.text, fontFamily: d.heading_font, ...hCss }}
            >
              {t("design.print_preview.thank_you_title")}
            </span>
            {divider("my-3")}
            <span className="text-sm" style={{ color: d.text }}>
              {t("design.print_preview.thank_you_line")}
            </span>
            <span
              className="mt-2 text-base tracking-[0.12em]"
              style={{ color: d.accent_text, fontFamily: d.heading_font, ...hCss }}
            >
              {t("design.print_preview.sample_couple")}
            </span>
            <span className="mt-1 text-xs" style={{ color: labelColor }}>
              {t("design.print_preview.sample_date")}
            </span>
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
