// Wedding visual-identity catalog — the single source of truth for the
// "Design" feature, shared by both sides via `@shared/design`.
//
// The couple only ever persists a handful of *curated slugs* (a wedding
// style, a colour palette, a font preset) plus a few print toggles — never
// raw hex or font URLs (see `CoupleDesignInput`). The concrete colour values
// and font stacks live HERE, so re-tinting a palette is a code change, not a
// data migration — the same rationale as `CUSTOM_ICON_CHOICES` on the budget
// card. Both the guest page (web) and the printable cards (PDF) read from this
// one catalog, so the two surfaces can never drift.
//
// Web colours are hex (dropped into CSS custom properties on `.wedding-theme`).
// Print colours are the SAME colours as rgb 0..1 triples (what the PDF toolkit
// in `backend/src/domain/pdf.ts` expects), derived from the hex so they match
// exactly.

export type StylePresetSlug =
  | "classic_elegant"
  | "botanical_green"
  | "modern_minimal"
  | "romantic_soft"
  | "rustic_natural"
  | "editorial";

export type PaletteSlug = "botanical_green" | "espresso" | "blush" | "stone_minimal" | "sage_cream";

export type FontPresetSlug = "classic_serif" | "modern_clean" | "soft_romantic";

/** Monogram separator - the glyph between the two initials/names. The "and"
 *  slug resolves to a locale-aware word ("és" / "and") at render time; the rest
 *  are locale-neutral glyphs. See {@link monogramSeparatorGlyph}. */
export type MonogramSeparatorSlug = "amp" | "plus" | "slash" | "and";

/** How the wedding date is rendered across the guest page + printables. The
 *  concrete formatting is locale-aware - see {@link formatWeddingDate}. */
export type DateFormatSlug = "numeric_dot" | "long" | "slash";

/** Decorative detail applied to the guest page + printable cards. Curated, not
 *  freeform - same rationale as the palette/font catalogs. */
export type DecorSlug = "none" | "line" | "botanical" | "dots" | "frame";

/** Minimal per-template print options. Each printable template honours the
 *  subset that makes sense for it (a table number has no QR block). */
export interface DesignPrintOptions {
  /** Hairline frame around the printed card. */
  border: boolean;
  /** Small ornament / divider glyph. */
  ornament: boolean;
  /** QR block, where the template supports it (e.g. the photo-upload card). */
  qr: boolean;
}

/** Persisted shape — exactly what `couples.design_json` holds. Every field is
 *  optional so a partial/legacy blob still parses; {@link resolveDesign} fills
 *  the gaps from {@link DEFAULT_DESIGN}. */
export interface CoupleDesignInput {
  style?: StylePresetSlug;
  palette?: PaletteSlug;
  fonts?: FontPresetSlug;
  monogram?: Partial<MonogramOptions>;
  dateFormat?: DateFormatSlug;
  decor?: DecorSlug;
  print?: Partial<DesignPrintOptions>;
}

/** The wedding monogram - the couple's initials joined by a separator. The
 *  actual initials are derived from the couple's names at render time, so we
 *  only persist the on/off flag + the separator choice (no freeform text). */
export interface MonogramOptions {
  enabled: boolean;
  separator: MonogramSeparatorSlug;
}

/** Fully-resolved shape carried on the `Couple` DTO — always populated. */
export interface CoupleDesign {
  style: StylePresetSlug;
  palette: PaletteSlug;
  fonts: FontPresetSlug;
  monogram: MonogramOptions;
  dateFormat: DateFormatSlug;
  decor: DecorSlug;
  print: DesignPrintOptions;
}

/** One colour value in both web (hex) and print (rgb 0..1) forms. */
export interface ColorPair {
  hex: string;
  rgb: [number, number, number];
}

export interface Palette {
  slug: PaletteSlug;
  /** i18n key, e.g. `design.palette.botanical_green`. */
  nameKey: string;
  primary: ColorPair;
  background: ColorPair;
  accent: ColorPair;
  text: ColorPair;
}

export interface FontPreset {
  slug: FontPresetSlug;
  nameKey: string;
  /** CSS font stacks composed ONLY from already-bundled families (Cormorant
   *  Garamond, Inter, General Sans) — no new webfont / CDN request. */
  headingStack: string;
  bodyStack: string;
}

export interface StylePreset {
  slug: StylePresetSlug;
  nameKey: string;
  /** Picking a style pre-selects these, but the couple can still override the
   *  palette and font independently afterwards. */
  defaultPalette: PaletteSlug;
  defaultFonts: FontPresetSlug;
}

/** hex (`#RRGGBB`) → rgb 0..1 triple, rounded to 3dp. Pure + total. */
function pair(hex: string): ColorPair {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  const round = (n: number) => Math.round((n / 255) * 1000) / 1000;
  return { hex, rgb: [round(r), round(g), round(b)] };
}

export const PALETTES: readonly Palette[] = [
  {
    slug: "botanical_green",
    nameKey: "design.palette.botanical_green",
    primary: pair("#6F8F72"),
    background: pair("#F6F3EC"),
    accent: pair("#D8CDBB"),
    text: pair("#2F332E"),
  },
  {
    slug: "espresso",
    nameKey: "design.palette.espresso",
    primary: pair("#4A3B32"),
    background: pair("#F3EDE6"),
    accent: pair("#A98B6F"),
    text: pair("#2A211C"),
  },
  {
    slug: "blush",
    nameKey: "design.palette.blush",
    primary: pair("#C98B86"),
    background: pair("#FBF6F4"),
    accent: pair("#E4C9C2"),
    text: pair("#3A2E2C"),
  },
  {
    slug: "stone_minimal",
    nameKey: "design.palette.stone_minimal",
    primary: pair("#6B6F73"),
    background: pair("#F5F5F3"),
    accent: pair("#C9C7C1"),
    text: pair("#2C2E30"),
  },
  {
    slug: "sage_cream",
    nameKey: "design.palette.sage_cream",
    primary: pair("#8A9A7B"),
    background: pair("#F7F4EC"),
    accent: pair("#D9D2BE"),
    text: pair("#33372D"),
  },
];

export const FONT_PRESETS: readonly FontPreset[] = [
  {
    slug: "classic_serif",
    nameKey: "design.font.classic_serif",
    headingStack: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
    bodyStack: '"Inter Variable", Inter, system-ui, sans-serif',
  },
  {
    slug: "modern_clean",
    nameKey: "design.font.modern_clean",
    headingStack: '"General Sans", "Helvetica Neue", Inter, system-ui, sans-serif',
    bodyStack: '"Inter Variable", Inter, system-ui, sans-serif',
  },
  {
    slug: "soft_romantic",
    nameKey: "design.font.soft_romantic",
    headingStack: '"Cormorant Garamond", Georgia, serif',
    bodyStack: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
  },
];

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    slug: "classic_elegant",
    nameKey: "design.style.classic_elegant",
    defaultPalette: "stone_minimal",
    defaultFonts: "classic_serif",
  },
  {
    slug: "botanical_green",
    nameKey: "design.style.botanical_green",
    defaultPalette: "botanical_green",
    defaultFonts: "classic_serif",
  },
  {
    slug: "modern_minimal",
    nameKey: "design.style.modern_minimal",
    defaultPalette: "stone_minimal",
    defaultFonts: "modern_clean",
  },
  {
    slug: "romantic_soft",
    nameKey: "design.style.romantic_soft",
    defaultPalette: "blush",
    defaultFonts: "soft_romantic",
  },
  {
    slug: "rustic_natural",
    nameKey: "design.style.rustic_natural",
    defaultPalette: "sage_cream",
    defaultFonts: "classic_serif",
  },
  {
    slug: "editorial",
    nameKey: "design.style.editorial",
    defaultPalette: "espresso",
    defaultFonts: "modern_clean",
  },
];

/** Monogram separators. The glyph for `and` is locale-aware, so it carries no
 *  static glyph here - {@link monogramSeparatorGlyph} resolves it. */
export const MONOGRAM_SEPARATORS: readonly { slug: MonogramSeparatorSlug; glyph: string }[] = [
  { slug: "amp", glyph: "&" },
  { slug: "plus", glyph: "+" },
  { slug: "slash", glyph: "/" },
  { slug: "and", glyph: "" },
];

export const DATE_FORMATS: readonly { slug: DateFormatSlug; nameKey: string }[] = [
  { slug: "numeric_dot", nameKey: "design.date.numeric_dot" },
  { slug: "long", nameKey: "design.date.long" },
  { slug: "slash", nameKey: "design.date.slash" },
];

export const DECOR_STYLES: readonly { slug: DecorSlug; nameKey: string }[] = [
  { slug: "none", nameKey: "design.decor.none" },
  { slug: "line", nameKey: "design.decor.line" },
  { slug: "botanical", nameKey: "design.decor.botanical" },
  { slug: "dots", nameKey: "design.decor.dots" },
  { slug: "frame", nameKey: "design.decor.frame" },
];

export const VALID_STYLES: ReadonlySet<StylePresetSlug> = new Set(STYLE_PRESETS.map((s) => s.slug));
export const VALID_PALETTES: ReadonlySet<PaletteSlug> = new Set(PALETTES.map((p) => p.slug));
export const VALID_FONTS: ReadonlySet<FontPresetSlug> = new Set(FONT_PRESETS.map((f) => f.slug));
export const VALID_SEPARATORS: ReadonlySet<MonogramSeparatorSlug> = new Set(
  MONOGRAM_SEPARATORS.map((s) => s.slug),
);
export const VALID_DATE_FORMATS: ReadonlySet<DateFormatSlug> = new Set(
  DATE_FORMATS.map((d) => d.slug),
);
export const VALID_DECOR: ReadonlySet<DecorSlug> = new Set(DECOR_STYLES.map((d) => d.slug));

/** The Design feature's own default — Botanical Green + classic serif. NULL /
 *  legacy `design_json` rows resolve to this; it drives only the guest page +
 *  wired print templates, NOT the app-shell accent. */
export const DEFAULT_DESIGN: CoupleDesign = {
  style: "botanical_green",
  palette: "botanical_green",
  fonts: "classic_serif",
  monogram: { enabled: true, separator: "amp" },
  dateFormat: "long",
  decor: "line",
  print: { border: true, ornament: false, qr: false },
};

/** Look up a palette by slug; never throws — an unknown slug falls back to the
 *  default palette so a stale slug can't blank out the guest page. */
export function getPalette(slug: PaletteSlug): Palette {
  return PALETTES.find((p) => p.slug === slug) ?? PALETTES[1]!;
}

/** Look up a font preset by slug; never throws (falls back to classic serif). */
export function getFontPreset(slug: FontPresetSlug): FontPreset {
  return FONT_PRESETS.find((f) => f.slug === slug) ?? FONT_PRESETS[0]!;
}

/** Resolve a persisted (possibly partial / malformed) input into a fully
 *  populated {@link CoupleDesign}. Unknown/missing slugs degrade per-field to
 *  {@link DEFAULT_DESIGN}, mirroring how `parseMediaLinksJson` degrades per
 *  slot and `rowToCurrency` degrades to HUF. */
export function resolveDesign(input: CoupleDesignInput | null | undefined): CoupleDesign {
  const i = input ?? {};
  return {
    style: i.style && VALID_STYLES.has(i.style) ? i.style : DEFAULT_DESIGN.style,
    palette: i.palette && VALID_PALETTES.has(i.palette) ? i.palette : DEFAULT_DESIGN.palette,
    fonts: i.fonts && VALID_FONTS.has(i.fonts) ? i.fonts : DEFAULT_DESIGN.fonts,
    monogram: {
      enabled:
        typeof i.monogram?.enabled === "boolean"
          ? i.monogram.enabled
          : DEFAULT_DESIGN.monogram.enabled,
      separator:
        i.monogram?.separator && VALID_SEPARATORS.has(i.monogram.separator)
          ? i.monogram.separator
          : DEFAULT_DESIGN.monogram.separator,
    },
    dateFormat:
      i.dateFormat && VALID_DATE_FORMATS.has(i.dateFormat)
        ? i.dateFormat
        : DEFAULT_DESIGN.dateFormat,
    decor: i.decor && VALID_DECOR.has(i.decor) ? i.decor : DEFAULT_DESIGN.decor,
    print: {
      border: typeof i.print?.border === "boolean" ? i.print.border : DEFAULT_DESIGN.print.border,
      ornament:
        typeof i.print?.ornament === "boolean" ? i.print.ornament : DEFAULT_DESIGN.print.ornament,
      qr: typeof i.print?.qr === "boolean" ? i.print.qr : DEFAULT_DESIGN.print.qr,
    },
  };
}

/** Presentation-only payload exposed on the public wedding-website view — the
 *  resolved hex colours + font stacks, never the internal slugs. The guest
 *  page reads exactly these. */
export interface PublicDesign {
  primary: string;
  background: string;
  accent: string;
  text: string;
  heading_font: string;
  body_font: string;
  /** Monogram on/off + separator slug. The initials are built from the
   *  couple's names by the consumer (guest page / PDF), so no names leak here. */
  monogram_enabled: boolean;
  monogram_separator: MonogramSeparatorSlug;
  date_format: DateFormatSlug;
  decor: DecorSlug;
}

/** Build the public, presentation-only payload from a resolved design. */
export function toPublicDesign(design: CoupleDesign): PublicDesign {
  const palette = getPalette(design.palette);
  const fonts = getFontPreset(design.fonts);
  return {
    primary: palette.primary.hex,
    background: palette.background.hex,
    accent: palette.accent.hex,
    text: palette.text.hex,
    heading_font: fonts.headingStack,
    body_font: fonts.bodyStack,
    monogram_enabled: design.monogram.enabled,
    monogram_separator: design.monogram.separator,
    date_format: design.dateFormat,
    decor: design.decor,
  };
}

/** Locale-aware glyph for a monogram separator. Only `and` differs by locale. */
export function monogramSeparatorGlyph(
  slug: MonogramSeparatorSlug,
  locale: "hu" | "en",
): string {
  if (slug === "and") return locale === "hu" ? "és" : "and";
  return MONOGRAM_SEPARATORS.find((s) => s.slug === slug)?.glyph ?? "&";
}

/** First grapheme of a name, upper-cased - the initial for the monogram. Falls
 *  back to "" for an empty name so a half-filled couple still renders cleanly. */
function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "";
}

/** Build the monogram string (e.g. `A & B`) from the two partner names. Returns
 *  "" when both initials are empty so the consumer can skip the block. */
export function buildMonogram(
  nameA: string | null | undefined,
  nameB: string | null | undefined,
  separator: MonogramSeparatorSlug,
  locale: "hu" | "en",
): string {
  const a = initialOf(nameA);
  const b = initialOf(nameB);
  if (!a && !b) return "";
  const glyph = monogramSeparatorGlyph(separator, locale);
  return [a, glyph, b].filter(Boolean).join(" ");
}

/** Format a wedding date (`YYYY-MM-DD` ISO, or anything `Date` can parse)
 *  per the chosen {@link DateFormatSlug} and locale. Invalid input returns the
 *  raw string unchanged, mirroring the guest page's permissive date handling. */
export function formatWeddingDate(
  iso: string | null | undefined,
  slug: DateFormatSlug,
  locale: "hu" | "en",
): string {
  const raw = (iso ?? "").trim();
  if (!raw) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (slug === "numeric_dot") {
    return locale === "hu"
      ? `${year}.${mo}.${d}.`
      : `${year}.${mo}.${d}`;
  }
  if (slug === "slash") {
    return locale === "hu" ? `${year}/${mo}/${d}` : `${mo}/${d}/${year}`;
  }
  // "long" - month name spelled out, locale word order.
  const monthsHu = [
    "január",
    "február",
    "március",
    "április",
    "május",
    "június",
    "július",
    "augusztus",
    "szeptember",
    "október",
    "november",
    "december",
  ];
  const monthsEn = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const idx = month - 1;
  if (idx < 0 || idx > 11) return raw;
  return locale === "hu"
    ? `${year}. ${monthsHu[idx]} ${day}.`
    : `${monthsEn[idx]} ${day}, ${year}`;
}
