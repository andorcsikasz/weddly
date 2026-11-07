// A miniature of the guest page's opening screen, for the style picker on the
// website tab.
//
// The printed-card proof cannot show what makes the four templates different
// (where the photo sits and how it is framed), so on the website surface each
// tile draws its pack's hero composition instead: the couple's real names and
// date, in the pack's type and colours, around the photo the page would really
// open on. Same rule as ProofCard: tiles differ only in the design applied.

import {
  type CoupleDesign,
  formatWeddingDate,
  type HeroLayoutSlug,
  toPublicDesign,
} from "@shared/design";
import type { CSSProperties } from "react";
import type { Locale } from "@/lib/i18n";
import { headingTreatmentCss } from "../ornaments";

export function HeroProof({
  design,
  photoUrl,
  brideName,
  groomName,
  weddingDate,
  locale,
  fallbackName,
}: {
  design: CoupleDesign;
  /** The photo the page would open on (the couple's cover, or the pack's
   *  suggestion when picking the pack would fill an empty cover). */
  photoUrl: string | null;
  brideName: string | null | undefined;
  groomName: string | null | undefined;
  weddingDate: string | null | undefined;
  locale: Locale;
  fallbackName: string;
}) {
  const d = toPublicDesign(design);
  const layout: HeroLayoutSlug = d.website_hero_layout;
  const name = brideName && groomName ? `${brideName} & ${groomName}` : fallbackName;
  const date = formatWeddingDate(weddingDate ?? "2027-06-20", d.date_format, locale);
  const nameCss: CSSProperties = {
    fontFamily: d.heading_font,
    color: d.text,
    fontSize: 17,
    lineHeight: 1.1,
    ...headingTreatmentCss(d.heading_style),
  };
  const dateCss: CSSProperties = {
    fontFamily: d.body_font,
    color: d.accent_text,
    fontSize: 8,
  };
  const photo = photoUrl ? (
    <img src={photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
  ) : (
    <span className="block h-full w-full" style={{ backgroundColor: d.accent, opacity: 0.45 }} />
  );

  return (
    <span
      className="relative flex aspect-[4/5] w-full flex-col overflow-hidden"
      style={{ backgroundColor: d.background }}
      aria-hidden
    >
      {layout === "overlay" &&
        (photoUrl ? (
          <span className="relative h-full w-full">
            {photo}
            <span className="absolute inset-0 bg-black/25" />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center">
              <span style={{ ...nameCss, color: "white" }}>{name}</span>
              <span className="uppercase tracking-[0.18em]" style={{ ...dateCss, color: "white" }}>
                {date}
              </span>
            </span>
          </span>
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            <span style={nameCss}>{name}</span>
            <span className="uppercase tracking-[0.18em]" style={dateCss}>
              {date}
            </span>
          </span>
        ))}

      {layout === "split" && (
        <span className="grid h-full grid-cols-2">
          <span className="overflow-hidden">{photo}</span>
          <span className="flex flex-col items-center justify-center gap-1.5 px-1.5 text-center">
            <span style={{ ...nameCss, fontSize: 14 }}>{name}</span>
            <span className="h-px w-5" style={{ backgroundColor: d.accent }} />
            <span style={dateCss}>{date}</span>
          </span>
        </span>
      )}

      {layout === "arch" && (
        <span className="flex h-full flex-col items-center gap-2 px-3 pt-3 text-center">
          <span style={{ ...nameCss, fontSize: 12 }}>{name}</span>
          <span className="relative w-[64%] flex-1">
            <span
              className="absolute -inset-1 rounded-t-full border"
              style={{ borderColor: d.accent }}
            />
            <span className="absolute inset-0 overflow-hidden rounded-t-full">{photo}</span>
          </span>
          <span className="pb-2.5 tracking-[0.12em]" style={dateCss}>
            {date}
          </span>
        </span>
      )}

      {layout === "editorial" && (
        <span className="flex h-full flex-col px-2.5 pt-2.5">
          <span
            className="border-y py-0.5 text-[6px] uppercase tracking-[0.2em]"
            style={{ borderColor: d.accent, color: d.text, fontFamily: d.body_font }}
          >
            {date}
          </span>
          <span
            className="mt-1.5 text-left"
            style={{ ...nameCss, fontSize: 24, lineHeight: 0.92, letterSpacing: "-0.02em" }}
          >
            {brideName && groomName ? (
              <>
                {brideName}
                <br />
                <span style={{ color: d.accent_text, fontStyle: "italic" }}>&amp; </span>
                {groomName}
              </>
            ) : (
              name
            )}
          </span>
          <span className="mt-2 flex-1 overflow-hidden">{photo}</span>
        </span>
      )}

      {layout === "poster" && (
        <span className="flex h-full flex-col items-center gap-2 px-4 pt-4 text-center">
          <span className="relative w-full flex-1 border p-1" style={{ borderColor: d.accent }}>
            <span className="block h-full w-full overflow-hidden">{photo}</span>
          </span>
          <span style={{ ...nameCss, fontSize: 14 }}>{name}</span>
          <span className="pb-2.5 uppercase tracking-[0.16em]" style={dateCss}>
            {date}
          </span>
        </span>
      )}
    </span>
  );
}
