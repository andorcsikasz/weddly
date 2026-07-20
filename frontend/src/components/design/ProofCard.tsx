// The ProofCard — the single visual object on /app/design.
//
// It renders the couple's REAL names and their REAL wedding date through a
// given `CoupleDesign`: that design's palette (with per-role overrides), its
// typefaces, its heading treatment, its ornament language, its card layout and
// its date format. Every control on the design page is expressed as this card
// changing. If a control can't be shown as a change to this card, that control
// doesn't earn a place on the page.
//
// It generalises the old `StyleMoodCard` (which only ever took a StylePreset,
// so it could preview the four packs but never the couple's live, customised
// look). Same four `cardLayout` branches, fed from `toPublicDesign` instead.
//
// Specimen type is set inline in px on purpose. These are miniature renderings
// of a printed card, not UI text, so they are deliberately exempt from the
// `html.density-*` accessibility scale, which bumps `text-[10px]`/`text-[11px]`
// utilities. The surrounding labels DO scale; the specimen must not, or the
// four tiles stop being comparable.

import { type CoupleDesign, formatWeddingDate, toPublicDesign } from "@shared/design";
import type { Locale } from "@/lib/i18n";
import { headingTreatmentCss, OrnamentDivider, OrnamentFrame } from "../ornaments";

/** How big a rendering is asked for. Each size pins its own type sizes so a
 *  card stays readable from a 32px stamp up to a 26rem desk proof. */
export type ProofSize = "table" | "pair" | "chip" | "strip" | "stamp" | "desk";

/** `card` = a printed invitation. `site` = a three-band mini guest page, the
 *  only rendering that can show card corners + shadow, which are website-only. */
export type ProofSurface = "card" | "site";

const SIZE: Record<
  ProofSize,
  { heading: number; date: number; divider: string; pad: string; initialsOver: number }
> = {
  // `initialsOver` = name length past which we drop to initials. The numbers
  // are the usable inner width divided by the heading size at ~0.5em average
  // advance, NOT round guesses: a long Hungarian pair ("Krisztina & Szabolcs",
  // 20 chars) is the common case here, not an edge one, and it clips silently
  // under overflow-hidden if the threshold is generous.
  //
  // desk and table stay unlimited on purpose. They have the room to WRAP, and a
  // long name breaking over two centred lines is what a real invitation does.
  // The small sizes cannot wrap inside their box, so they abbreviate instead.
  desk: { heading: 30, date: 12, divider: "h-4 w-24", pad: "px-6 py-7", initialsOver: Infinity },
  table: { heading: 22, date: 10, divider: "h-3 w-16", pad: "px-3 py-4", initialsOver: Infinity },
  pair: { heading: 15, date: 8, divider: "h-2.5 w-12", pad: "px-2.5 py-3", initialsOver: 14 },
  chip: { heading: 12, date: 7, divider: "h-2 w-9", pad: "px-2 py-2.5", initialsOver: 13 },
  strip: { heading: 9, date: 6, divider: "h-1.5 w-6", pad: "px-1.5 py-2", initialsOver: 11 },
  stamp: { heading: 7, date: 0, divider: "h-1 w-4", pad: "px-1 py-1.5", initialsOver: 0 },
};

export function ProofCard({
  design,
  size,
  surface = "card",
  brideName,
  groomName,
  weddingDate,
  locale,
  fallbackName,
  className,
}: {
  design: CoupleDesign;
  size: ProofSize;
  surface?: ProofSurface;
  brideName: string | null | undefined;
  groomName: string | null | undefined;
  /** ISO date. Null falls back to a representative date so the card is never blank. */
  weddingDate: string | null | undefined;
  locale: Locale;
  /** Shown when the couple hasn't named themselves yet (a translated sample). */
  fallbackName: string;
  className?: string;
}) {
  const d = toPublicDesign(design);
  const s = SIZE[size];

  const full = brideName && groomName ? `${brideName} & ${groomName}` : fallbackName;
  const initials =
    brideName && groomName
      ? `${[...brideName][0] ?? ""} & ${[...groomName][0] ?? ""}`
      : fallbackName;
  const name = full.length > s.initialsOver ? initials : full;
  const date = formatWeddingDate(weddingDate ?? "2027-06-20", d.date_format, locale);

  const headingCss: React.CSSProperties = {
    fontFamily: d.heading_font,
    color: d.text,
    fontSize: s.heading,
    lineHeight: 1.15,
    ...headingTreatmentCss(d.heading_style),
  };
  const dateCss: React.CSSProperties = {
    fontFamily: d.body_font,
    color: d.accent_text,
    fontSize: s.date,
  };

  const shell = `relative flex w-full flex-col overflow-hidden ${
    surface === "card" && (d.card_layout === "asymmetric" || size === "stamp")
      ? "aspect-[3/4]"
      : "aspect-[4/5]"
  } ${className ?? ""}`;

  if (surface === "site") return <SiteProof d={d} name={name} date={date} s={s} shell={shell} />;

  return (
    <span className={shell} style={{ backgroundColor: d.background }} aria-hidden>
      {/* Frame overlays: the oval for Blush, the deco corners for Noir. */}
      <span style={{ color: d.accent }}>
        <OrnamentFrame slug={d.ornament} />
      </span>

      {d.card_layout === "asymmetric" ? (
        // Editorial: left-aligned bold name, a tabular table number top right.
        <span className={`flex h-full flex-col justify-between ${s.pad}`}>
          <span className="self-end tabular-nums" style={{ color: d.text, fontSize: s.date }}>
            12
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="text-left" style={headingCss}>
              {name}
            </span>
            <OrnamentDivider slug={d.ornament} className={s.divider} style={{ color: d.text }} />
            <span className="text-left tracking-[0.12em]" style={dateCss}>
              {date}
            </span>
          </span>
        </span>
      ) : (
        // Garden / Blush / Noir: centred, ornament between the name and the date.
        <span
          className={`flex h-full flex-col items-center justify-center gap-1.5 text-center ${s.pad}`}
        >
          <span style={headingCss}>{name}</span>
          {size !== "stamp" && (
            <OrnamentDivider slug={d.ornament} className={s.divider} style={{ color: d.accent }} />
          )}
          {s.date > 0 && (
            <span className="uppercase tracking-[0.18em]" style={dateCss}>
              {date}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** The website counterpart: a three-band mini guest page. This is the only
 *  rendering that can honestly show card corners + shadow, which never reach a
 *  printed card, so it backs the "Cards" fine-tune row and the print-tab stamp. */
function SiteProof({
  d,
  name,
  date,
  s,
  shell,
}: {
  d: ReturnType<typeof toPublicDesign>;
  name: string;
  date: string;
  s: (typeof SIZE)[ProofSize];
  shell: string;
}) {
  return (
    <span className={shell} style={{ backgroundColor: d.background }} aria-hidden>
      {/* Hero band: the names over the page background. */}
      <span className="flex flex-1 flex-col items-center justify-center gap-1 px-2 text-center">
        <span
          style={{
            fontFamily: d.heading_font,
            color: d.text,
            fontSize: s.heading,
            lineHeight: 1.15,
            ...headingTreatmentCss(d.heading_style),
          }}
        >
          {name}
        </span>
        {s.date > 0 && (
          <span
            className="uppercase tracking-[0.18em]"
            style={{ fontFamily: d.body_font, color: d.accent_text, fontSize: s.date }}
          >
            {date}
          </span>
        )}
      </span>
      {/* Inverted band: the schedule strip, the palette's most dramatic moment. */}
      <span className="h-[14%] w-full" style={{ backgroundColor: d.text }} />
      {/* Two content cards, carrying the LIVE corner radius + shadow. */}
      <span className="flex flex-1 items-center justify-center gap-1.5 px-2">
        {[0, 1].map((i) => (
          <span
            key={i}
            className="h-[62%] flex-1"
            style={{
              backgroundColor: d.primary,
              borderRadius: d.website_card_radius,
              boxShadow: d.website_shadow,
              opacity: 0.9,
            }}
          />
        ))}
      </span>
    </span>
  );
}
