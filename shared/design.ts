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
//
// On top of the curated presets, the couple can override individual colours
// (any `#RRGGBB`) and pick the heading / body font family independently. The
// presets stay the base layer; overrides are stored sparsely so changing the
// palette still re-tints every role the couple hasn't explicitly pinned.

import type { UiLocale } from "./locales";
import { getContrastRatio } from "./wcag";

export type StylePresetSlug =
  // ── Active "style pack" identities (the four curated worlds). ──
  | "garden_romance"
  | "modern_monochrome"
  | "blush_romantic"
  | "midnight_luxe"
  // ── Legacy slugs kept for back-compat: a couple who picked one of these
  //    before the pack redesign keeps validating? No — they're NOT in
  //    STYLE_PRESETS, so their stored style degrades to the default while
  //    their palette/fonts still render (see resolveDesign + the note above
  //    STYLE_PRESETS). They stay in the union only so old blobs type-check. ──
  | "classic_elegant"
  | "botanical_green"
  | "modern_minimal"
  | "romantic_soft"
  | "rustic_natural"
  | "editorial"
  | "black_tie_editorial"
  | "mediterranean_terracotta"
  | "blue_porcelain";

export type PaletteSlug =
  // ── Style-pack palettes (the four curated worlds). ──
  | "garden"
  | "mono_ink"
  | "blush_rose"
  | "noir"
  // ── Legacy palettes (kept renderable for back-compat). ──
  | "botanical_green"
  | "espresso"
  | "blush"
  | "stone_minimal"
  | "sage_cream"
  | "champagne"
  | "terracotta"
  | "blue_porcelain"
  | "ink_gold"
  | "noir_ivory"
  | "midnight";

export type FontPresetSlug =
  // ── Style-pack pairings. ──
  | "garden_serif"
  | "mono_sans"
  | "blush_bodoni"
  | "noir_smallcaps"
  // ── Legacy presets (kept for back-compat). ──
  | "classic_serif"
  | "modern_clean"
  | "soft_romantic";

/** A single bundled font family the couple can assign to the heading or body
 *  independently (the editable layer on top of the font PRESETS). The list is
 *  restricted to families already @font-face'd in index.css or available as a
 *  system stack - no new webfont / CDN request. */
export type FontFamilySlug =
  | "cormorant"
  | "inter"
  | "general_sans"
  | "system_serif"
  | "system_sans"
  // ── Style-pack families (self-hosted woff2; see index.css). ──
  | "cormorant_italic"
  | "dm_sans"
  | "jost"
  | "bodoni_moda"
  | "crimson_text"
  | "cormorant_sc"
  | "eb_garamond";

/** The four colour roles a couple can override individually on top of a chosen
 *  palette. An override is a `#RRGGBB` string; absence means "use the palette". */
export type ColorRole = "primary" | "background" | "accent" | "text";

/** `#RRGGBB` validator shared by the resolver + the PATCH boundary. */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Monogram separator - the glyph between the two initials/names. The "and"
 *  slug resolves to a locale-aware word ("és" / "and") at render time; the rest
 *  are locale-neutral glyphs. See {@link monogramSeparatorGlyph}. */
export type MonogramSeparatorSlug = "amp" | "plus" | "slash" | "and";

/** How the wedding date is rendered across the guest page + printables. The
 *  concrete formatting is locale-aware - see {@link formatWeddingDate}.
 *  `numeric_md` is the year-less variant (MM.DD) for couples who want the
 *  poster date without the year. */
export type DateFormatSlug = "numeric_dot" | "numeric_md" | "long" | "slash" | "roman";

/** The ornament "language" a style pack speaks - drives the divider / frame /
 *  corner marks rendered on both the guest page and the printed cards. The
 *  concrete vector is resolved per slug by the renderers (web SVG + PDF ops),
 *  so the two surfaces stay in lock-step. */
export type OrnamentSlug = "botanical" | "none" | "oval" | "deco";

/** The layout DIRECTION a style pack's cards take - the structural personality
 *  (centered-formal vs asymmetric-editorial vs framed vs dark-corner-marked).
 *  Read by {@link PrintCardPreview} and the PDF renderer to branch the layout. */
export type CardLayoutSlug = "centered" | "asymmetric" | "framed" | "corners";

/** Optional typographic treatment a pack applies to its HEADINGS on top of the
 *  font stack (italic for Garden, uppercase for the Monochrome grotesk, small
 *  caps for Midnight). Absent = render the heading as-is. */
export type HeadingStyleSlug = "italic" | "uppercase" | "small_caps";

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
  /** Per-role colour overrides on top of the chosen palette. Sparse: only the
   *  roles the couple actually customised. Each value is a `#RRGGBB` string. */
  colors?: Partial<Record<ColorRole, string>>;
  /** Independent heading / body font-family overrides on top of the font
   *  preset. `undefined`/`null` means "use the preset's stack". */
  headingFont?: FontFamilySlug | null;
  bodyFont?: FontFamilySlug | null;
  monogram?: Partial<MonogramOptions>;
  dateFormat?: DateFormatSlug;
  /** Card border / frame style. Supersedes `print.border`. */
  borderStyle?: BorderStyleSlug;
  print?: Partial<DesignPrintOptions>;
  /** Website-only chrome (guest page; never touches print). */
  web?: Partial<DesignWebsiteOptions>;
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
  /** Validated sparse colour overrides (only roles the couple customised, each
   *  a lowercased `#RRGGBB`). The palette supplies any role not present here. */
  colors: Partial<Record<ColorRole, string>>;
  /** Heading / body font-family overrides, or null to use the preset stack. */
  headingFont: FontFamilySlug | null;
  bodyFont: FontFamilySlug | null;
  monogram: MonogramOptions;
  dateFormat: DateFormatSlug;
  borderStyle: BorderStyleSlug;
  print: DesignPrintOptions;
  web: DesignWebsiteOptions;
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
  /** The {@link FontFamilySlug} each stack maps to, so the per-family picker can
   *  highlight the typeface a preset resolves to while no override is set. */
  headingFamily: FontFamilySlug;
  bodyFamily: FontFamilySlug;
}

export interface StylePreset {
  slug: StylePresetSlug;
  nameKey: string;
  /** Picking a style pre-selects palette + fonts, but the couple can still
   *  override either independently afterwards. */
  defaultPalette: PaletteSlug;
  defaultFonts: FontPresetSlug;
  /** The pack's ornament language - botanical sprig / none / oval frame / art
   *  deco corners. Drives the guest-page dividers + the printed-card ornaments. */
  ornament: OrnamentSlug;
  /** The pack's card layout direction (centered / asymmetric / framed /
   *  corners). Drives {@link PrintCardPreview} + the PDF card renderers. */
  cardLayout: CardLayoutSlug;
  /** Optional heading treatment the pack applies on top of its heading font. */
  headingStyle?: HeadingStyleSlug;
  /** Date format the pack seeds when picked (Roman numerals for Midnight Luxe,
   *  numeric for Monochrome, long for the romantic packs). */
  defaultDateFormat: DateFormatSlug;
  /** Card frame the pack seeds when picked - most packs carry their identity in
   *  the ornament, not a rectangular border, so this is usually "none". */
  defaultBorderStyle: BorderStyleSlug;
  /** Optional website-chrome defaults a style seeds when picked (e.g. the
   *  editorial style turns on grayscale photos + sharp, shadowless, outline
   *  chrome). Omitted on styles that keep today's web defaults. */
  defaultWeb?: Partial<DesignWebsiteOptions>;
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

// Each palette anchors one wedding STYLE, so they're deliberately far apart in
// hue + mood (sage green vs porcelain blue vs terracotta) — that distance is
// what makes the style presets read as genuinely different worlds, not tints of
// the same look. Most keep a near-black text on a light background so contrast
// stays WCAG-safe; `midnight` is the deliberate inverse (warm ivory text on a
// near-black background) for the dark "Black Tie" style. The accent_text
// fallback in toPublicDesign handles any low-contrast primary either way, and
// the guest page's bands flip automatically (a dark palette's "dark" band
// renders light, preserving the alternating rhythm).
export const PALETTES: readonly Palette[] = [
  // ── The four style-pack palettes (deliberately far apart: warm-ivory garden
  //    green, pure-white monochrome, blush rose, dark champagne-on-noir). ──
  {
    // Garden Romance: warm ivory, deep garden green, antique gold.
    slug: "garden",
    nameKey: "design.palette.garden",
    primary: pair("#2C3E2D"),
    background: pair("#F5F0E8"),
    accent: pair("#A8906A"),
    text: pair("#2C3E2D"),
  },
  {
    // Modern Monochrome: pure white, ink black, cool silver-grey hairline.
    slug: "mono_ink",
    nameKey: "design.palette.mono_ink",
    primary: pair("#0A0A0A"),
    background: pair("#FFFFFF"),
    accent: pair("#D4D4D4"),
    text: pair("#0A0A0A"),
  },
  {
    // Blush Romantic: powder pink-white, burgundy rose, soft blush.
    slug: "blush_rose",
    nameKey: "design.palette.blush_rose",
    primary: pair("#7B3B52"),
    background: pair("#FEF1F1"),
    accent: pair("#E8B4C0"),
    text: pair("#4A2030"),
  },
  {
    // Midnight Luxe: the dark pack - champagne gold on warm near-black, antique
    // gold hairlines, cream text. The guest page flips its bands automatically.
    slug: "noir",
    nameKey: "design.palette.noir",
    primary: pair("#E2C97E"),
    background: pair("#18120E"),
    accent: pair("#C5A44F"),
    text: pair("#F2E8D5"),
  },
  {
    slug: "botanical_green",
    nameKey: "design.palette.botanical_green",
    primary: pair("#6F8F72"),
    background: pair("#F4F1E8"),
    accent: pair("#D6CBB5"),
    text: pair("#243128"),
  },
  {
    // Warm specialty-coffee browns — the house favourite accent family.
    slug: "espresso",
    nameKey: "design.palette.espresso",
    primary: pair("#4A3B32"),
    background: pair("#F3EDE6"),
    accent: pair("#A98B6F"),
    text: pair("#2A211C"),
  },
  {
    // Romantic powder: warm off-white, dusty rose, soft blush accent.
    slug: "blush",
    nameKey: "design.palette.blush",
    primary: pair("#C9827F"),
    background: pair("#FFF7F4"),
    accent: pair("#E8C9C3"),
    text: pair("#3A2A27"),
  },
  {
    // Modern minimal: cool near-white, graphite ink, pale stone accent.
    slug: "stone_minimal",
    nameKey: "design.palette.stone_minimal",
    primary: pair("#111111"),
    background: pair("#FAFAF7"),
    accent: pair("#DAD7CD"),
    text: pair("#1A1A1A"),
  },
  {
    // Repurposed as the RUSTIC sand/olive palette: kraft-paper warmth.
    slug: "sage_cream",
    nameKey: "design.palette.sage_cream",
    primary: pair("#8A6F4D"),
    background: pair("#F3EBDD"),
    accent: pair("#A3A883"),
    text: pair("#3A3328"),
  },
  {
    // Classic elegant: champagne ivory, warm charcoal, antique-gold accent.
    slug: "champagne",
    nameKey: "design.palette.champagne",
    primary: pair("#2B2620"),
    background: pair("#F7F2E8"),
    accent: pair("#BFA46F"),
    text: pair("#1E1A16"),
  },
  {
    // Mediterranean terracotta: sun-warmed clay with an olive accent.
    slug: "terracotta",
    nameKey: "design.palette.terracotta",
    primary: pair("#C96F4A"),
    background: pair("#FAF0E6"),
    accent: pair("#8E9A65"),
    text: pair("#2E211B"),
  },
  {
    // Blue porcelain: cool ivory, deep delft blue, pale china-blue accent.
    slug: "blue_porcelain",
    nameKey: "design.palette.blue_porcelain",
    primary: pair("#2F4A6D"),
    background: pair("#F7F5EF"),
    accent: pair("#B8C7D9"),
    text: pair("#1B2430"),
  },
  {
    // Editorial black-tie: near-black ink on warm ivory with antique gold.
    // Magazine contrast, the most dramatic palette in the set.
    slug: "ink_gold",
    nameKey: "design.palette.ink_gold",
    primary: pair("#161311"),
    background: pair("#F7F1E7"),
    accent: pair("#A67C52"),
    text: pair("#1A1411"),
  },
  {
    // Black-tie monochrome: near-black ink on warm ivory with a soft greige
    // hairline accent (used for 1px rules only — never text). The "Black Tie
    // Editorial" preset's base; pairs with grayscale photos for the high-end
    // black-and-white magazine look.
    slug: "noir_ivory",
    nameKey: "design.palette.noir_ivory",
    primary: pair("#16140F"),
    background: pair("#F6F2EA"),
    accent: pair("#B9B2A6"),
    text: pair("#16140F"),
  },
  {
    // Midnight: the only DARK-background palette. Warm ivory on near-black ink
    // with antique gold, for a candlelit black-tie evening look. Inverts the
    // usual light-page assumption — the guest page flips its bands automatically
    // so the rhythm still alternates.
    slug: "midnight",
    nameKey: "design.palette.midnight",
    primary: pair("#C9A96C"), // Antique gold (headings / eyebrows on the dark bg)
    background: pair("#16130F"), // Deep warm near-black
    accent: pair("#9E8455"), // Muted bronze (hairlines / dividers)
    text: pair("#F2EBDB"), // Warm ivory
  },
];

export const FONT_PRESETS: readonly FontPreset[] = [
  // ── Style-pack pairings (each pack's defining typography). ──
  {
    // Garden: libegő italic Cormorant heading over airy Jost Light body.
    slug: "garden_serif",
    nameKey: "design.font.garden_serif",
    headingStack: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
    bodyStack: '"Jost", "Century Gothic", "Futura", system-ui, sans-serif',
    headingFamily: "cormorant_italic",
    bodyFamily: "jost",
  },
  {
    // Monochrome: one strong grotesk for heading + body (heading goes bold/caps).
    slug: "mono_sans",
    nameKey: "design.font.mono_sans",
    headingStack: '"DM Sans", "Helvetica Neue", Inter, system-ui, sans-serif',
    bodyStack: '"DM Sans", "Helvetica Neue", Inter, system-ui, sans-serif',
    headingFamily: "dm_sans",
    bodyFamily: "dm_sans",
  },
  {
    // Blush: high-contrast Bodoni heading over a warm Crimson Text book body.
    slug: "blush_bodoni",
    nameKey: "design.font.blush_bodoni",
    headingStack: '"Bodoni Moda", "Didot", "Bodoni MT", Georgia, serif',
    bodyStack: '"Crimson Text", Georgia, "Times New Roman", serif',
    headingFamily: "bodoni_moda",
    bodyFamily: "crimson_text",
  },
  {
    // Midnight: gold small-caps Cormorant SC heading over classic Garamond body.
    slug: "noir_smallcaps",
    nameKey: "design.font.noir_smallcaps",
    headingStack: '"Cormorant SC", "Cormorant Garamond", Georgia, serif',
    bodyStack: '"EB Garamond", Garamond, Georgia, "Times New Roman", serif',
    headingFamily: "cormorant_sc",
    bodyFamily: "eb_garamond",
  },
  {
    slug: "classic_serif",
    nameKey: "design.font.classic_serif",
    headingStack: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
    bodyStack: '"Inter Variable", Inter, system-ui, sans-serif',
    headingFamily: "cormorant",
    bodyFamily: "inter",
  },
  {
    slug: "modern_clean",
    nameKey: "design.font.modern_clean",
    headingStack: '"General Sans", "Helvetica Neue", Inter, system-ui, sans-serif',
    bodyStack: '"Inter Variable", Inter, system-ui, sans-serif',
    headingFamily: "general_sans",
    bodyFamily: "inter",
  },
  {
    slug: "soft_romantic",
    nameKey: "design.font.soft_romantic",
    headingStack: '"Cormorant Garamond", Georgia, serif',
    bodyStack: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
    headingFamily: "cormorant",
    bodyFamily: "cormorant",
  },
];

/** Individually-assignable font families (the editable layer). Stacks are
 *  copied verbatim from {@link FONT_PRESETS} / tailwind.config.js so NO new
 *  family name (and therefore no new webfont request) is introduced. */
export const FONT_FAMILIES: readonly { slug: FontFamilySlug; nameKey: string; stack: string }[] = [
  {
    slug: "cormorant",
    nameKey: "design.family.cormorant",
    stack: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
  },
  {
    slug: "inter",
    nameKey: "design.family.inter",
    stack: '"Inter Variable", Inter, system-ui, sans-serif',
  },
  {
    slug: "general_sans",
    nameKey: "design.family.general_sans",
    stack: '"General Sans", "Helvetica Neue", Inter, system-ui, sans-serif',
  },
  {
    slug: "system_serif",
    nameKey: "design.family.system_serif",
    stack: 'Georgia, "Times New Roman", Times, serif',
  },
  {
    slug: "system_sans",
    nameKey: "design.family.system_sans",
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  },
  // ── Style-pack families (self-hosted woff2; @font-face in index.css). ──
  {
    // Garden heading - rendered italic via the pack's headingStyle.
    slug: "cormorant_italic",
    nameKey: "design.family.cormorant_italic",
    stack: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
  },
  {
    slug: "dm_sans",
    nameKey: "design.family.dm_sans",
    stack: '"DM Sans", "Helvetica Neue", Inter, system-ui, sans-serif',
  },
  {
    slug: "jost",
    nameKey: "design.family.jost",
    stack: '"Jost", "Century Gothic", "Futura", system-ui, sans-serif',
  },
  {
    slug: "bodoni_moda",
    nameKey: "design.family.bodoni_moda",
    stack: '"Bodoni Moda", "Didot", "Bodoni MT", Georgia, serif',
  },
  {
    slug: "crimson_text",
    nameKey: "design.family.crimson_text",
    stack: '"Crimson Text", Georgia, "Times New Roman", serif',
  },
  {
    // Noir heading - the SC face renders small caps natively.
    slug: "cormorant_sc",
    nameKey: "design.family.cormorant_sc",
    stack: '"Cormorant SC", "Cormorant Garamond", Georgia, serif',
  },
  {
    slug: "eb_garamond",
    nameKey: "design.family.eb_garamond",
    stack: '"EB Garamond", Garamond, Georgia, "Times New Roman", serif',
  },
];

/** Resolve a font-family slug to its CSS stack; falls back to Cormorant. */
export function getFontFamilyStack(slug: FontFamilySlug): string {
  return FONT_FAMILIES.find((f) => f.slug === slug)?.stack ?? FONT_FAMILIES[0]!.stack;
}

// The four "style packs" - deliberately distinct WORLDS, not tints of one look.
// Each bundles its own palette, typography, ornament language, card layout, date
// format and button style so the choice reads as a real personality switch at a
// glance (garden organic / monochrome editorial / blush romantic / midnight
// gala). Removed/renamed slugs stay in StylePresetSlug for backward-compat: a
// legacy couple's stored style just degrades to the default selection while
// their palette/fonts render unchanged (rendering reads those fields directly).
export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    // Garden Romance - late-afternoon kertiparti: organic, italic serif, gold.
    slug: "garden_romance",
    nameKey: "design.style.garden_romance",
    defaultPalette: "garden",
    defaultFonts: "garden_serif",
    ornament: "botanical",
    cardLayout: "centered",
    headingStyle: "italic",
    defaultDateFormat: "long",
    defaultBorderStyle: "none",
    defaultWeb: { buttonStyle: "outline", cardRadius: "soft", shadow: "soft" },
  },
  {
    // Modern Monochrome - gallery wedding: pure white, bold grotesk, asymmetric.
    slug: "modern_monochrome",
    nameKey: "design.style.modern_monochrome",
    defaultPalette: "mono_ink",
    defaultFonts: "mono_sans",
    ornament: "none",
    cardLayout: "asymmetric",
    headingStyle: "uppercase",
    defaultDateFormat: "numeric_dot",
    defaultBorderStyle: "none",
    defaultWeb: {
      buttonStyle: "flat",
      cardRadius: "sharp",
      shadow: "none",
      imageTreatment: "grayscale",
    },
  },
  {
    // Blush Romantic - candlelit peonies: blush pink, Bodoni, oval frame.
    slug: "blush_romantic",
    nameKey: "design.style.blush_romantic",
    defaultPalette: "blush_rose",
    defaultFonts: "blush_bodoni",
    ornament: "oval",
    cardLayout: "framed",
    defaultDateFormat: "long",
    defaultBorderStyle: "none",
    defaultWeb: { buttonStyle: "lifted", cardRadius: "full", shadow: "soft" },
  },
  {
    // Midnight Luxe - black-tie gala: gold on near-black, small caps, deco corners.
    slug: "midnight_luxe",
    nameKey: "design.style.midnight_luxe",
    defaultPalette: "noir",
    defaultFonts: "noir_smallcaps",
    ornament: "deco",
    cardLayout: "corners",
    headingStyle: "small_caps",
    defaultDateFormat: "roman",
    defaultBorderStyle: "none",
    defaultWeb: { buttonStyle: "outline", cardRadius: "sharp", shadow: "none" },
  },
];

/** Look up a style preset by slug; never throws - an unknown/legacy slug falls
 *  back to the first pack so a stale style can't blank out the per-pack render. */
export function getStylePreset(slug: StylePresetSlug): StylePreset {
  return STYLE_PRESETS.find((s) => s.slug === slug) ?? STYLE_PRESETS[0]!;
}

/** Commit a style pack onto a design. A pack is a FULL reset, not a tint: it
 *  re-seeds the palette + font pairing, drops every per-role colour and
 *  font-family override, and seeds the pack's signature date format, card frame
 *  and website chrome (button style, corners, shadow, photo treatment).
 *
 *  This lives here rather than in the editor page because it defines what a
 *  pack MEANS. The design page needs it twice - once to commit the tap, once to
 *  render each Sample Table tile - and those two must agree exactly, or a tile
 *  would advertise a look the tap doesn't produce. */
export function applyStylePreset(design: CoupleDesign, slug: StylePresetSlug): CoupleDesign {
  const preset = STYLE_PRESETS.find((s) => s.slug === slug);
  if (!preset) return design;
  return {
    ...design,
    style: slug,
    palette: preset.defaultPalette,
    fonts: preset.defaultFonts,
    colors: {},
    headingFont: null,
    bodyFont: null,
    dateFormat: preset.defaultDateFormat,
    borderStyle: preset.defaultBorderStyle,
    web: { ...design.web, ...(preset.defaultWeb ?? {}) },
  };
}

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
  { slug: "numeric_md", nameKey: "design.date.numeric_md" },
  { slug: "long", nameKey: "design.date.long" },
  { slug: "slash", nameKey: "design.date.slash" },
  { slug: "roman", nameKey: "design.date.roman" },
];

export const ORNAMENTS: readonly { slug: OrnamentSlug }[] = [
  { slug: "botanical" },
  { slug: "none" },
  { slug: "oval" },
  { slug: "deco" },
];
export const VALID_ORNAMENTS: ReadonlySet<OrnamentSlug> = new Set(ORNAMENTS.map((o) => o.slug));

export const VALID_STYLES: ReadonlySet<StylePresetSlug> = new Set(STYLE_PRESETS.map((s) => s.slug));
export const VALID_PALETTES: ReadonlySet<PaletteSlug> = new Set(PALETTES.map((p) => p.slug));
export const VALID_FONTS: ReadonlySet<FontPresetSlug> = new Set(FONT_PRESETS.map((f) => f.slug));
export const VALID_FONT_FAMILIES: ReadonlySet<FontFamilySlug> = new Set(
  FONT_FAMILIES.map((f) => f.slug),
);
export const COLOR_ROLES: readonly ColorRole[] = ["primary", "background", "accent", "text"];
export const VALID_SEPARATORS: ReadonlySet<MonogramSeparatorSlug> = new Set(
  MONOGRAM_SEPARATORS.map((s) => s.slug),
);
export const VALID_DATE_FORMATS: ReadonlySet<DateFormatSlug> = new Set(
  DATE_FORMATS.map((d) => d.slug),
);

/** Card border / frame style — a COMMON flat field that supersedes the legacy
 *  on/off `print.border` boolean (folded in {@link resolveDesign}). Drives the
 *  printable cards (and, later, the guest-page cards). */
export type BorderStyleSlug = "none" | "hairline" | "double" | "thick";

export const BORDER_STYLES: readonly { slug: BorderStyleSlug; nameKey: string }[] = [
  { slug: "none", nameKey: "design.border.none" },
  { slug: "hairline", nameKey: "design.border.hairline" },
  { slug: "double", nameKey: "design.border.double" },
  { slug: "thick", nameKey: "design.border.thick" },
];
export const VALID_BORDER_STYLES: ReadonlySet<BorderStyleSlug> = new Set(
  BORDER_STYLES.map((b) => b.slug),
);

/** CSS `border` shorthand for a style + colour. "none" → no border. */
export function getBorderCss(slug: BorderStyleSlug, color: string): string {
  switch (slug) {
    case "none":
      return "none";
    case "double":
      return `3px double ${color}`;
    case "thick":
      return `2px solid ${color}`;
    default:
      return `1px solid ${color}`;
  }
}

// ─── Website-only design (the `web` sub-object) ────────────────────────────
// Surface-scoped chrome that affects ONLY the guest page, never the printed
// cards (pdf.ts never reads design.web). Each control resolves to a concrete
// CSS value HERE so the component just drops it into a CSS custom property -
// no raw CSS/length literals authored in WeddingSiteView.

/** Corner rounding of the guest-page cards. */
export type CardRadiusSlug = "sharp" | "soft" | "full";
/** Card elevation on the guest page. */
export type ShadowSlug = "none" | "soft" | "pop";
/** Look of the guest-page RSVP call-to-action button. */
export type ButtonStyleSlug = "lifted" | "flat" | "outline";
/** Guest-page sections the couple may hide. RSVP is intentionally NOT hideable
 *  (a couple shouldn't be able to silently turn off responses). */
export type WebsiteSectionSlug = "intro" | "schedule" | "menu" | "useful_info" | "wishlist";
/** Photo rendering on the guest page. "grayscale" desaturates cover/venue
 *  imagery for the black-and-white editorial look; "none" is full colour. */
export type ImageTreatmentSlug = "none" | "grayscale";
/** How the venue block stacks its name and its map. "stacked" is the classic
 *  full-width map under the venue name; "side" puts the two next to each other
 *  on a wide screen, where the map goes SQUARE because a 16:9 strip next to a
 *  short text column reads as a banner rather than a place. Below the breakpoint
 *  "side" degrades to "stacked" on its own — two 160px columns are worse than
 *  one of each. */
export type VenueLayoutSlug = "stacked" | "side";

export const CARD_RADII: readonly { slug: CardRadiusSlug; nameKey: string; css: string }[] = [
  { slug: "sharp", nameKey: "design.web.card_radius.sharp", css: "0.375rem" },
  { slug: "soft", nameKey: "design.web.card_radius.soft", css: "1rem" },
  { slug: "full", nameKey: "design.web.card_radius.full", css: "1.5rem" },
];

export const SHADOWS: readonly { slug: ShadowSlug; nameKey: string; css: string }[] = [
  { slug: "none", nameKey: "design.web.shadow.none", css: "none" },
  {
    slug: "soft",
    nameKey: "design.web.shadow.soft",
    css: "0 1px 2px 0 rgba(16, 24, 48, 0.04), 0 1px 4px 0 rgba(16, 24, 48, 0.06)",
  },
  {
    slug: "pop",
    nameKey: "design.web.shadow.pop",
    css: "0 10px 25px -8px rgba(16, 24, 48, 0.16), 0 2px 6px -2px rgba(16, 24, 48, 0.10)",
  },
];

export const BUTTON_STYLES: readonly { slug: ButtonStyleSlug; nameKey: string }[] = [
  { slug: "lifted", nameKey: "design.web.button_style.lifted" },
  { slug: "flat", nameKey: "design.web.button_style.flat" },
  { slug: "outline", nameKey: "design.web.button_style.outline" },
];

export const WEBSITE_SECTIONS: readonly { slug: WebsiteSectionSlug; nameKey: string }[] = [
  { slug: "intro", nameKey: "design.web.section.intro" },
  { slug: "schedule", nameKey: "design.web.section.schedule" },
  { slug: "menu", nameKey: "design.web.section.menu" },
  { slug: "useful_info", nameKey: "design.web.section.useful_info" },
  { slug: "wishlist", nameKey: "design.web.section.wishlist" },
];

export const IMAGE_TREATMENTS: readonly { slug: ImageTreatmentSlug; nameKey: string }[] = [
  { slug: "none", nameKey: "design.web.image_treatment.none" },
  { slug: "grayscale", nameKey: "design.web.image_treatment.grayscale" },
];

export const VENUE_LAYOUTS: readonly { slug: VenueLayoutSlug; nameKey: string }[] = [
  { slug: "stacked", nameKey: "design.web.venue_layout.stacked" },
  { slug: "side", nameKey: "design.web.venue_layout.side" },
];

/** Curated, people-free background photos a couple can drop into a guest-page
 *  photo slot instead of uploading their own. Each entry is a static JPEG served
 *  from `frontend/public/design-photos/<file>` (reachable at `/design-photos/…`
 *  in every build). The `file` is the whole contract shared across the fence:
 *  the backend whitelists these slugs and writes `curatedPhotoUrl(slug)` into
 *  the same `site_image_N_url` TEXT column an upload uses, so the guest page
 *  renders one identically to the other and the grayscale treatment applies to
 *  both. Additive-only: never rename or drop a `file`, or a couple who picked it
 *  loses their image. Add new art by appending a row and dropping the photo in. */
export type CuratedPhotoSlug =
  | "reception_pergola"
  | "reception_candlelit"
  | "place_setting"
  | "greenery_arch"
  | "draped_arch"
  | "pampas_candles"
  | "candle_still"
  | "dried_flowers"
  | "eucalyptus"
  | "eucalyptus_light"
  | "wedding_cake"
  | "ceremony_aisle";

export const CURATED_SITE_PHOTOS: readonly {
  slug: CuratedPhotoSlug;
  file: string;
  nameKey: string;
}[] = [
  {
    slug: "reception_pergola",
    file: "01-reception-pergola.jpg",
    nameKey: "design.web.photo_art.reception_pergola",
  },
  {
    slug: "reception_candlelit",
    file: "02-reception-candlelit.jpg",
    nameKey: "design.web.photo_art.reception_candlelit",
  },
  {
    slug: "place_setting",
    file: "03-place-setting.jpg",
    nameKey: "design.web.photo_art.place_setting",
  },
  {
    slug: "greenery_arch",
    file: "04-greenery-arch.jpg",
    nameKey: "design.web.photo_art.greenery_arch",
  },
  { slug: "draped_arch", file: "05-draped-arch.jpg", nameKey: "design.web.photo_art.draped_arch" },
  {
    slug: "pampas_candles",
    file: "06-pampas-candles.jpg",
    nameKey: "design.web.photo_art.pampas_candles",
  },
  { slug: "candle_still", file: "07-candle.jpg", nameKey: "design.web.photo_art.candle_still" },
  {
    slug: "dried_flowers",
    file: "08-dried-flowers.jpg",
    nameKey: "design.web.photo_art.dried_flowers",
  },
  { slug: "eucalyptus", file: "09-eucalyptus.jpg", nameKey: "design.web.photo_art.eucalyptus" },
  {
    slug: "eucalyptus_light",
    file: "10-eucalyptus-light.jpg",
    nameKey: "design.web.photo_art.eucalyptus_light",
  },
  // 11-12 fill the two subjects the first ten never covered: the cake and the
  // ceremony itself. Sourced people-free like the rest — a stock couple on a
  // couple's OWN wedding page reads as a placeholder nobody removed.
  // 11: Felix Manuel Almonte Ulloa via Unsplash (Unsplash License).
  {
    slug: "wedding_cake",
    file: "11-wedding-cake.jpg",
    nameKey: "design.web.photo_art.wedding_cake",
  },
  // 12: Feyza Yıldırım via Pexels (Pexels License).
  {
    slug: "ceremony_aisle",
    file: "12-ceremony-aisle.jpg",
    nameKey: "design.web.photo_art.ceremony_aisle",
  },
];

export const VALID_CURATED_PHOTO_SLUGS: ReadonlySet<CuratedPhotoSlug> = new Set(
  CURATED_SITE_PHOTOS.map((p) => p.slug),
);

/** The public URL a curated slug resolves to, single-sourced so the frontend
 *  thumbnail and the value the backend stores can never drift. Returns null for
 *  an unknown slug so callers fail closed rather than build a dead path. */
export function curatedPhotoUrl(slug: string): string | null {
  const found = CURATED_SITE_PHOTOS.find((p) => p.slug === slug);
  return found ? `/design-photos/${found.file}` : null;
}

// ── Cover / guest-page image upload constraints ──────────────────────────────
// Single source of truth for the limits the backend enforces AND the frontend
// communicates up-front + pre-checks, so a couple learns "too large, use under
// 4 MB" before a failed round trip instead of after a generic error.
export const COVER_IMAGE_MAX_MB = 4;
export const COVER_IMAGE_MAX_BYTES = COVER_IMAGE_MAX_MB * 1024 * 1024;
/** MIME types the cover/photo uploader accepts (also the `<input accept>`). */
export const COVER_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const COVER_IMAGE_ACCEPT = COVER_IMAGE_MIME_TYPES.join(",");

/** Client-side pre-check mirroring the server's gate, so the UI can explain the
 *  problem before uploading. Returns null when the file is acceptable. */
export function coverImageRejectReason(file: {
  size: number;
  type: string;
}): "too_large" | "wrong_type" | null {
  if (file.size > COVER_IMAGE_MAX_BYTES) return "too_large";
  if (!(COVER_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return "wrong_type";
  return null;
}

/** The three corner + shadow pairings the four style packs actually use.
 *
 *  `cardRadius` and `shadow` are stored separately and stay separate, because
 *  old blobs carry combinations that are no longer offered and we never rewrite
 *  a couple's stored value. But they are not two independent questions: nine
 *  combinations exist, the packs use three, and nobody can describe the
 *  difference between "sharp corners with a strong shadow" and "sharp corners
 *  with a soft shadow" without looking. So the editor offers these three, named
 *  after how the card feels, and a stored off-pairing simply matches none of
 *  them until the couple picks one. */
export type CardFeelSlug = "sharp" | "soft" | "round";
export const CARD_FEELS: readonly {
  slug: CardFeelSlug;
  nameKey: string;
  radius: CardRadiusSlug;
  shadow: ShadowSlug;
}[] = [
  { slug: "sharp", nameKey: "design.card_feel.sharp", radius: "sharp", shadow: "none" },
  { slug: "soft", nameKey: "design.card_feel.soft", radius: "soft", shadow: "soft" },
  { slug: "round", nameKey: "design.card_feel.round", radius: "full", shadow: "soft" },
];

/** Which pairing a design currently sits on, or null for a stored combination
 *  the editor no longer offers (so no tile shows a false selection ring). */
export function getCardFeel(web: DesignWebsiteOptions): CardFeelSlug | null {
  return (
    CARD_FEELS.find((f) => f.radius === web.cardRadius && f.shadow === web.shadow)?.slug ?? null
  );
}

export const VALID_CARD_RADII: ReadonlySet<CardRadiusSlug> = new Set(CARD_RADII.map((r) => r.slug));
export const VALID_SHADOWS: ReadonlySet<ShadowSlug> = new Set(SHADOWS.map((s) => s.slug));
export const VALID_BUTTON_STYLES: ReadonlySet<ButtonStyleSlug> = new Set(
  BUTTON_STYLES.map((b) => b.slug),
);
export const VALID_WEBSITE_SECTIONS: ReadonlySet<WebsiteSectionSlug> = new Set(
  WEBSITE_SECTIONS.map((s) => s.slug),
);
export const VALID_IMAGE_TREATMENTS: ReadonlySet<ImageTreatmentSlug> = new Set(
  IMAGE_TREATMENTS.map((i) => i.slug),
);
export const VALID_VENUE_LAYOUTS: ReadonlySet<VenueLayoutSlug> = new Set(
  VENUE_LAYOUTS.map((v) => v.slug),
);

/** Website-only options (guest page chrome). Always fully populated on the
 *  resolved design; absent in legacy blobs (filled from DEFAULT_DESIGN.web). */
export interface DesignWebsiteOptions {
  cardRadius: CardRadiusSlug;
  shadow: ShadowSlug;
  buttonStyle: ButtonStyleSlug;
  /** Sections the couple chose to hide (deduped, validated). */
  hiddenSections: WebsiteSectionSlug[];
  /** Photo rendering — desaturate cover/venue imagery or leave full colour. */
  imageTreatment: ImageTreatmentSlug;
  /** Show the pack's intermediate decorative dividers (the ornament "seams"
   *  drawn between guest-page sections). On by default; couples who want a
   *  cleaner page can turn them off — same on/off spirit as the monogram. */
  ornaments: boolean;
  /** Opt-in: show the embedded venue map (exact pin) to EVERYONE, not just
   *  confirmed guests. Off by default — the privacy buffer stays the public
   *  face until the couple explicitly flips this. The public-wedding endpoint
   *  reads it server-side to decide whether to expose the coordinates. */
  venueMap: boolean;
  /** Venue name over the map, or the two side by side (square map). Only ever
   *  visible when `venueMap` is on and the couple has coordinates. */
  venueLayout: VenueLayoutSlug;
}

/** Resolve a card-radius slug to its CSS length; never throws. */
export function getCardRadiusCss(slug: CardRadiusSlug): string {
  return CARD_RADII.find((r) => r.slug === slug)?.css ?? CARD_RADII[1]!.css;
}
/** Resolve a shadow slug to its CSS box-shadow; never throws. */
export function getShadowCss(slug: ShadowSlug): string {
  return SHADOWS.find((s) => s.slug === slug)?.css ?? SHADOWS[1]!.css;
}

/** The Design feature's own default — Classic Elegant (champagne + classic
 *  serif). NULL / legacy `design_json` rows resolve to this; it drives only the
 *  guest page + wired print templates, NOT the app-shell accent. */
export const DEFAULT_DESIGN: CoupleDesign = {
  style: "garden_romance",
  palette: "garden",
  fonts: "garden_serif",
  colors: {},
  headingFont: null,
  bodyFont: null,
  monogram: { enabled: true, separator: "amp" },
  dateFormat: "long",
  borderStyle: "none",
  print: { border: false, ornament: true, qr: false },
  // Garden Romance is the broad-appeal default: a NULL/legacy `design_json`
  // resolves to this coherent pack (outline buttons, soft cards, botanical
  // ornament). Legacy couples who stored a palette/fonts still render those.
  web: {
    cardRadius: "soft",
    shadow: "soft",
    buttonStyle: "outline",
    hiddenSections: [],
    imageTreatment: "none",
    ornaments: true,
    venueMap: false,
    venueLayout: "stacked",
  },
};

/** Look up a palette by slug; never throws — an unknown slug falls back to the
 *  default palette so a stale slug can't blank out the guest page. */
export function getPalette(slug: PaletteSlug): Palette {
  return PALETTES.find((p) => p.slug === slug) ?? PALETTES[0]!;
}

/** Relative ink coverage of each colour role on the guest page, used to draw a
 *  palette as ONE weighted bar instead of four equal dots. These numbers
 *  describe the page TEMPLATE (how much of a rendered guest page is background
 *  vs body text vs headings vs accent), not any individual palette, so they are
 *  constant across palettes by construction. Sums to 100. */
export const PALETTE_ROLE_WEIGHTS: Record<ColorRole, number> = {
  background: 62,
  text: 20,
  primary: 12,
  accent: 6,
};

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
  // Keep only valid `#RRGGBB` overrides, lowercased. Unknown roles / malformed
  // values are dropped so a bad blob can never poison the resolved colours.
  const colors: Partial<Record<ColorRole, string>> = {};
  for (const role of COLOR_ROLES) {
    const v = i.colors?.[role];
    if (typeof v === "string" && HEX_COLOR_RE.test(v)) colors[role] = v.toLowerCase();
  }
  return {
    style: i.style && VALID_STYLES.has(i.style) ? i.style : DEFAULT_DESIGN.style,
    palette: i.palette && VALID_PALETTES.has(i.palette) ? i.palette : DEFAULT_DESIGN.palette,
    fonts: i.fonts && VALID_FONTS.has(i.fonts) ? i.fonts : DEFAULT_DESIGN.fonts,
    colors,
    headingFont: i.headingFont && VALID_FONT_FAMILIES.has(i.headingFont) ? i.headingFont : null,
    bodyFont: i.bodyFont && VALID_FONT_FAMILIES.has(i.bodyFont) ? i.bodyFont : null,
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
    // Border style supersedes the legacy `print.border` boolean: an explicit
    // slug wins; otherwise fold the old boolean (true → hairline, false → none);
    // otherwise the default.
    borderStyle:
      i.borderStyle && VALID_BORDER_STYLES.has(i.borderStyle)
        ? i.borderStyle
        : typeof i.print?.border === "boolean"
          ? i.print.border
            ? "hairline"
            : "none"
          : DEFAULT_DESIGN.borderStyle,
    print: {
      border: typeof i.print?.border === "boolean" ? i.print.border : DEFAULT_DESIGN.print.border,
      ornament:
        typeof i.print?.ornament === "boolean" ? i.print.ornament : DEFAULT_DESIGN.print.ornament,
      qr: typeof i.print?.qr === "boolean" ? i.print.qr : DEFAULT_DESIGN.print.qr,
    },
    web: {
      cardRadius:
        i.web?.cardRadius && VALID_CARD_RADII.has(i.web.cardRadius)
          ? i.web.cardRadius
          : DEFAULT_DESIGN.web.cardRadius,
      shadow:
        i.web?.shadow && VALID_SHADOWS.has(i.web.shadow) ? i.web.shadow : DEFAULT_DESIGN.web.shadow,
      buttonStyle:
        i.web?.buttonStyle && VALID_BUTTON_STYLES.has(i.web.buttonStyle)
          ? i.web.buttonStyle
          : DEFAULT_DESIGN.web.buttonStyle,
      // Keep only known section slugs, deduped, so a bad blob can't poison it.
      hiddenSections: Array.isArray(i.web?.hiddenSections)
        ? [...new Set(i.web.hiddenSections.filter((s) => VALID_WEBSITE_SECTIONS.has(s)))]
        : [],
      imageTreatment:
        i.web?.imageTreatment && VALID_IMAGE_TREATMENTS.has(i.web.imageTreatment)
          ? i.web.imageTreatment
          : DEFAULT_DESIGN.web.imageTreatment,
      ornaments:
        typeof i.web?.ornaments === "boolean" ? i.web.ornaments : DEFAULT_DESIGN.web.ornaments,
      venueMap: typeof i.web?.venueMap === "boolean" ? i.web.venueMap : DEFAULT_DESIGN.web.venueMap,
      venueLayout:
        i.web?.venueLayout && VALID_VENUE_LAYOUTS.has(i.web.venueLayout)
          ? i.web.venueLayout
          : DEFAULT_DESIGN.web.venueLayout,
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
  /** Contrast-safe colour for small accent TEXT (eyebrows, monogram) on the
   *  background: the brand primary when it clears 3:1, else the body text
   *  colour. The raw `accent` stays for 1px dividers/borders (contrast-exempt). */
  accent_text: string;
  heading_font: string;
  body_font: string;
  /** Monogram on/off + separator slug. The initials are built from the
   *  couple's names by the consumer (guest page / PDF), so no names leak here. */
  monogram_enabled: boolean;
  monogram_separator: MonogramSeparatorSlug;
  date_format: DateFormatSlug;
  /** The active style pack's ornament language + card layout + heading
   *  treatment, resolved from the chosen style. Both the guest page and the
   *  print preview branch on these so the pack's personality reads on every
   *  surface (a custom palette/font override never changes the pack's bones). */
  ornament: OrnamentSlug;
  card_layout: CardLayoutSlug;
  heading_style: HeadingStyleSlug | null;
  /** Website-only chrome, resolved to concrete CSS the guest page drops into
   *  `--wt-*` custom properties. Never read by the PDF renderer. */
  website_card_radius: string;
  website_shadow: string;
  /** RSVP button look (slug; the guest page maps it to a class). */
  website_button_style: ButtonStyleSlug;
  /** Sections the couple hid; the guest page skips these. */
  website_hidden_sections: WebsiteSectionSlug[];
  /** Photo rendering on the guest page (full colour or desaturated). */
  website_image_treatment: ImageTreatmentSlug;
  /** Draw the intermediate ornament dividers between sections, or omit them
   *  for a cleaner page. */
  website_ornaments: boolean;
  /** Venue name over the map, or side by side with a square map. */
  website_venue_layout: VenueLayoutSlug;
}

/** Build the public, presentation-only payload from a resolved design. */
export function toPublicDesign(design: CoupleDesign): PublicDesign {
  const palette = getPalette(design.palette);
  const fonts = getFontPreset(design.fonts);
  const style = getStylePreset(design.style);
  // Per-role custom override falls back to the palette hex.
  const primary = design.colors.primary ?? palette.primary.hex;
  const background = design.colors.background ?? palette.background.hex;
  const accent = design.colors.accent ?? palette.accent.hex;
  const text = design.colors.text ?? palette.text.hex;
  // Independent family override falls back to the preset's stack.
  const headingFont = design.headingFont
    ? getFontFamilyStack(design.headingFont)
    : fonts.headingStack;
  const bodyFont = design.bodyFont ? getFontFamilyStack(design.bodyFont) : fonts.bodyStack;
  // Accent TEXT must stay legible: prefer the brand primary, fall back to the
  // body text colour when primary-on-background drops below 3:1.
  const accentText = getContrastRatio(primary, background) >= 3 ? primary : text;
  return {
    primary,
    background,
    accent,
    text,
    accent_text: accentText,
    heading_font: headingFont,
    body_font: bodyFont,
    monogram_enabled: design.monogram.enabled,
    monogram_separator: design.monogram.separator,
    date_format: design.dateFormat,
    ornament: style.ornament,
    card_layout: style.cardLayout,
    heading_style: style.headingStyle ?? null,
    website_card_radius: getCardRadiusCss(design.web.cardRadius),
    website_shadow: getShadowCss(design.web.shadow),
    website_button_style: design.web.buttonStyle,
    website_hidden_sections: design.web.hiddenSections,
    website_image_treatment: design.web.imageTreatment,
    website_ornaments: design.web.ornaments,
    website_venue_layout: design.web.venueLayout,
  };
}

/** Locale-aware glyph for a monogram separator. Only `and` differs by locale. */
export function monogramSeparatorGlyph(slug: MonogramSeparatorSlug, locale: UiLocale): string {
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
  locale: UiLocale,
): string {
  const a = initialOf(nameA);
  const b = initialOf(nameB);
  if (!a && !b) return "";
  const glyph = monogramSeparatorGlyph(separator, locale);
  return [a, glyph, b].filter(Boolean).join(" ");
}

/** Classic additive Roman numerals for 1..3999 (covers any month + any wedding
 *  year). Out-of-range input returns the arabic number unchanged. Pure + total. */
export function toRomanNumeral(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 4000) return String(n);
  const table: readonly [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let rest = n;
  let out = "";
  for (const [value, symbol] of table) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

/** Format a wedding date (`YYYY-MM-DD` ISO, or anything `Date` can parse)
 *  per the chosen {@link DateFormatSlug} and locale. Invalid input returns the
 *  raw string unchanged, mirroring the guest page's permissive date handling. */
export function formatWeddingDate(
  iso: string | null | undefined,
  slug: DateFormatSlug,
  locale: UiLocale,
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
    return locale === "hu" ? `${year}.${mo}.${d}.` : `${year}.${mo}.${d}`;
  }
  if (slug === "numeric_md") {
    // Year-less numeric (MM.DD) - the date as a monogram-like mark.
    return locale === "hu" ? `${mo}.${d}.` : `${mo}.${d}`;
  }
  if (slug === "slash") {
    return locale === "hu" ? `${year}/${mo}/${d}` : `${mo}/${d}/${year}`;
  }
  if (slug === "roman") {
    // Locale-neutral black-tie format: arabic day · roman month · roman year
    // (e.g. 10 · VI · MMXXVII). The Midnight Luxe pack's signature.
    return `${day} · ${toRomanNumeral(month)} · ${toRomanNumeral(year)}`;
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
  return locale === "hu" ? `${year}. ${monthsHu[idx]} ${day}.` : `${monthsEn[idx]} ${day}, ${year}`;
}
