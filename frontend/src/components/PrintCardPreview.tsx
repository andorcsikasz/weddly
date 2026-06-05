// Instant, in-browser preview of a printable place card. Themed entirely from
// the resolved CoupleDesign (the SAME object the server PDF renderer consumes),
// so toggling border / QR / decor / palette / monogram updates the card live
// with zero round-trip. The pdf-lib render stays the source of truth for the
// actual download; this is the "azonnali nézet" the couple edits against.
//
// No raw hex in the component: colours come from the shared catalog via
// toPublicDesign (override-or-palette), reaching the DOM as inline values that
// are design DATA, not authored literals (same pattern as the palette swatches).

import { type CoupleDesign, buildMonogram, toPublicDesign } from "@shared/design";
import type { Locale } from "../lib/i18n";
import { useT } from "../lib/i18n";

/** Decorative divider mirroring WeddingSiteView's decor glyphs, tinted with the
 *  resolved accent so web + print read as one decor system. */
function DecorDivider({ decor, color }: { decor: CoupleDesign["decor"]; color: string }) {
  if (decor === "none") return null;
  if (decor === "line") {
    return <span className="block h-px w-16" style={{ backgroundColor: color }} aria-hidden />;
  }
  if (decor === "dots") {
    return (
      <span className="text-sm tracking-[0.4em]" style={{ color }} aria-hidden>
        · · ·
      </span>
    );
  }
  if (decor === "botanical") {
    return (
      <span className="text-lg leading-none" style={{ color }} aria-hidden>
        {"❧︎"}
      </span>
    );
  }
  // "frame" has no inline divider; the inset frame is drawn on the card itself.
  return null;
}

export function PrintCardPreview({
  design,
  brideName,
  groomName,
  locale,
}: {
  design: CoupleDesign;
  brideName: string | null;
  groomName: string | null;
  locale: Locale;
}) {
  const { t } = useT();
  const d = toPublicDesign(design);
  const monogram = design.monogram.enabled
    ? buildMonogram(brideName, groomName, design.monogram.separator, locale)
    : "";
  const sampleName = brideName?.trim() || t("design.print_preview.sample_name");

  return (
    <div className="flex flex-col items-center gap-3">
      {/* The card. Aspect roughly matches a folded place card; border + frame
          honour the print toggles so the couple sees them before downloading. */}
      <div
        className="relative flex aspect-[3/2] w-full max-w-[20rem] flex-col items-center justify-center px-6 py-5 text-center shadow-soft"
        style={{
          backgroundColor: d.background,
          color: d.text,
          fontFamily: d.body_font,
          border: design.print.border ? `1px solid ${d.accent}` : "1px solid transparent",
          borderRadius: 6,
        }}
      >
        {/* "frame" decor: a hairline inset box. */}
        {design.decor === "frame" && (
          <span
            className="pointer-events-none absolute inset-2 rounded"
            style={{ border: `1px solid ${d.accent}` }}
            aria-hidden
          />
        )}

        {monogram && (
          <span
            className="text-sm tracking-[0.2em]"
            style={{ color: d.accent_text, fontFamily: d.heading_font }}
            aria-hidden
          >
            {monogram}
          </span>
        )}

        <span
          className="mt-1 text-2xl leading-tight"
          style={{ color: d.text, fontFamily: d.heading_font }}
        >
          {sampleName}
        </span>

        <span className="mt-2 flex items-center justify-center">
          <DecorDivider decor={design.decor} color={d.accent} />
        </span>

        <span className="mt-2 text-[11px] uppercase tracking-[0.18em]" style={{ color: d.text }}>
          {t("design.print_preview.sample_table")}
        </span>

        {/* QR placeholder when the toggle is on, bottom-right. */}
        {design.print.qr && (
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
