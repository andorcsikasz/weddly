// /app/design — the wedding visual-identity editor. A curated, controlled
// design system (NOT a freeform editor): the couple picks one Wedding Style,
// one Colour Palette and one Font preset from fixed catalogs, plus a few print
// toggles. The selection persists on `couples.design_json` and drives the
// guest page (live preview below) + the printable cards. The concrete colours
// and font stacks all come from `@shared/design`, so the picker and the guest
// page can never drift.

import {
  CARD_RADII,
  type CardRadiusSlug,
  COLOR_ROLES,
  type ColorRole,
  type CoupleDesign,
  DATE_FORMATS,
  type ShadowSlug,
  SHADOWS,
  DECOR_STYLES,
  FONT_FAMILIES,
  FONT_PRESETS,
  type FontFamilySlug,
  type FontPresetSlug,
  formatWeddingDate,
  getFontPreset,
  getPalette,
  MONOGRAM_SEPARATORS,
  monogramSeparatorGlyph,
  resolveDesign,
  STYLE_PRESETS,
  type StylePresetSlug,
  toPublicDesign,
} from "@shared/design";
import { getContrastRatio } from "@shared/wcag";
import type { Couple } from "@shared/types";
import type { PublicWeddingWebsiteView } from "@shared/wedding_website";
import { Check, Download, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { PrintCardPreview } from "../components/PrintCardPreview";
import { WeddingSiteView } from "../components/WeddingSiteView";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import {
  coupleApi,
  fetchPdfBlob,
  menuPdfUrl,
  placeCardsUrl,
  schedulePdfUrl,
  tableNumbersPdfUrl,
} from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** A selectable preset tile — large, calm card with a check badge when active.
 *  Used by all three picker sections so they read as one coherent system. */
function PresetTile({
  active,
  onSelect,
  label,
  ariaLabel,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  label: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`group relative flex flex-col gap-3 rounded-2xl border bg-white p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:focus-visible:ring-paper-100 ${
        active
          ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
          : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
      }`}
    >
      {active && (
        <span
          className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
          aria-hidden
        >
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      {children}
      <span className="text-sm font-medium text-ink-900 dark:text-paper-50">{label}</span>
    </button>
  );
}

/** A selectable font chip that renders its own label in the font it represents,
 *  so the couple previews the typeface before choosing. `fontFamily` omitted =
 *  the "Use preset" chip (rendered in the UI font). */
function FontChip({
  active,
  onClick,
  fontFamily,
  children,
}: {
  active: boolean;
  onClick: () => void;
  fontFamily?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={fontFamily ? { fontFamily } : undefined}
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
        active
          ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
          : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
      }`}
    >
      {children}
    </button>
  );
}

export default function DesignPage() {
  const { t, locale } = useT();
  const toast = useToast();

  const [couple, setCouple] = useState<Couple | null>(null);
  const [design, setDesign] = useState<CoupleDesign>(() => resolveDesign(null));
  // Last value confirmed by the server — the debounced auto-save diffs against
  // this so a no-op selection doesn't fire a PATCH.
  const [saved, setSaved] = useState<CoupleDesign>(() => resolveDesign(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Read-only (lapsed plan) is surfaced once, then saving is disabled so the
  // couple can still explore the picker + preview without a toast on every tap.
  const [readOnly, setReadOnly] = useState(false);
  // Which top-level tab is showing: the Style kit pickers, or the Cards &
  // printables download hub. Both share the same persisted design blob.
  const [tab, setTab] = useState<"website" | "print">("website");
  // Per-tile download-in-flight flag, keyed by the printable's slug.
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    coupleApi
      .current()
      .then((r) => {
        if (cancelled || !r.couple) return;
        setCouple(r.couple);
        setDesign(r.couple.design);
        setSaved(r.couple.design);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => JSON.stringify(design) !== JSON.stringify(saved), [design, saved]);

  // Debounced auto-save: ~900ms after the last change, persist the whole
  // design blob. Mirrors GuestPageEditorPage's auto-save. The save closure is
  // fresh each run so the timeout always commits the latest selection.
  const designRef = useRef(design);
  designRef.current = design;
  useEffect(() => {
    if (!couple || !dirty || saving || readOnly) return;
    const id = setTimeout(() => {
      const next = designRef.current;
      setSaving(true);
      coupleApi
        .update({ design: next })
        .then((r) => {
          setCouple(r.couple);
          setSaved(r.couple.design);
          toast.success(t("design.saved"));
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 402) {
            setReadOnly(true);
            toast.error(t("design.save_blocked"));
          } else {
            toast.error(t("design.save_error"));
          }
        })
        .finally(() => setSaving(false));
    }, 900);
    return () => clearTimeout(id);
  }, [couple, dirty, saving, readOnly, design, toast, t]);

  // Picking a style pre-selects its palette + fonts, but the couple can still
  // override either independently afterwards (the catalog defaults are a
  // starting point, not a lock).
  function chooseStyle(slug: StylePresetSlug) {
    const preset = STYLE_PRESETS.find((s) => s.slug === slug);
    if (!preset) return;
    // A style is a full reset: it re-seeds palette + fonts AND drops any
    // custom colour / font-family overrides so the tile is the obvious reset.
    setDesign((d) => ({
      ...d,
      style: slug,
      palette: preset.defaultPalette,
      fonts: preset.defaultFonts,
      colors: {},
      headingFont: null,
      bodyFont: null,
    }));
  }
  function chooseFonts(slug: FontPresetSlug) {
    // Picking a font preset clears the independent family overrides.
    setDesign((d) => ({ ...d, fonts: slug, headingFont: null, bodyFont: null }));
  }
  function chooseColor(role: ColorRole, hex: string) {
    setDesign((d) => ({ ...d, colors: { ...d.colors, [role]: hex.toLowerCase() } }));
  }
  function clearColor(role: ColorRole) {
    setDesign((d) => {
      const colors = { ...d.colors };
      delete colors[role];
      return { ...d, colors };
    });
  }
  function chooseHeadingFont(slug: FontFamilySlug | null) {
    setDesign((d) => ({ ...d, headingFont: slug }));
  }
  function chooseBodyFont(slug: FontFamilySlug | null) {
    setDesign((d) => ({ ...d, bodyFont: slug }));
  }
  function togglePrint(key: "border" | "ornament" | "qr") {
    setDesign((d) => ({ ...d, print: { ...d.print, [key]: !d.print[key] } }));
  }
  function chooseCardRadius(slug: CardRadiusSlug) {
    setDesign((d) => ({ ...d, web: { ...d.web, cardRadius: slug } }));
  }
  function chooseShadow(slug: ShadowSlug) {
    setDesign((d) => ({ ...d, web: { ...d.web, shadow: slug } }));
  }
  function toggleMonogram() {
    setDesign((d) => ({ ...d, monogram: { ...d.monogram, enabled: !d.monogram.enabled } }));
  }
  function chooseSeparator(slug: (typeof MONOGRAM_SEPARATORS)[number]["slug"]) {
    setDesign((d) => ({ ...d, monogram: { ...d.monogram, separator: slug } }));
  }
  function chooseDateFormat(slug: (typeof DATE_FORMATS)[number]["slug"]) {
    setDesign((d) => ({ ...d, dateFormat: slug }));
  }
  function chooseDecor(slug: (typeof DECOR_STYLES)[number]["slug"]) {
    setDesign((d) => ({ ...d, decor: slug }));
  }

  // Download an auth-protected printable PDF as a blob and save it. Same pattern
  // the Schedule + Seating pages use (Bearer token threaded by `fetchPdfBlob`).
  async function downloadCard(slug: string, path: string, filename: string) {
    if (downloading) return;
    setDownloading(slug);
    try {
      const blob = await fetchPdfBlob(path);
      const typed =
        blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
      const url = URL.createObjectURL(typed);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      // Give the browser a beat before revoking (Safari otherwise drops it).
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t("design.cards.download_error"));
    } finally {
      setDownloading(null);
    }
  }

  // Base palette for the colour pickers: each input seeds from the custom
  // override if set, else this palette's hex for that role.
  const activePalette = getPalette(design.palette);
  // Resolved final colours (overrides applied) drive the live contrast check.
  const resolvedColors = useMemo(() => toPublicDesign(design), [design]);
  // Warn (never block) when body text or accent text would be hard to read on
  // the chosen background. Decorative dividers are contrast-exempt and skipped.
  const lowContrast =
    getContrastRatio(resolvedColors.text, resolvedColors.background) < 4.5 ||
    getContrastRatio(resolvedColors.accent_text, resolvedColors.background) < 3;

  // Live guest-page preview through the SAME <WeddingSiteView> guests see, fed
  // the in-progress design so the couple watches the theme update as they pick.
  const previewView: PublicWeddingWebsiteView | null = couple
    ? {
        couple_slug: couple.slug ?? "",
        couple_display_name: couple.display_name,
        bride_name: couple.bride_name,
        groom_name: couple.groom_name,
        wedding_date: couple.wedding_date,
        ceremony_kind: couple.ceremony_kind,
        venue_name: couple.venue_name,
        cover_image_url: couple.cover_image_url,
        guest_page_intro: couple.guest_page_intro,
        useful_info: couple.useful_info,
        location_lat: null,
        location_lng: null,
        location_radius_km: couple.location_radius_km,
        post_rsvp_content: null,
        schedule: [],
        wishlist: null,
        design: toPublicDesign(design),
        fetched_at: Date.now(),
      }
    : null;

  // The date a date-format tile previews: the couple's real date when set,
  // else a representative sample so the tiles always read meaningfully.
  const sampleDateIso = couple?.wedding_date ?? "2027-06-20";

  // The printables hub: one tile per PDF template. Each downloads via the
  // shared `fetchPdfBlob` blob pattern.
  const printables: {
    slug: string;
    name: string;
    desc: string;
    path: string;
    filename: string;
  }[] = [
    {
      slug: "place_cards",
      name: t("design.cards.place_cards_name"),
      desc: t("design.cards.place_cards_desc"),
      path: placeCardsUrl(),
      filename: "weddly-place-cards.pdf",
    },
    {
      slug: "table_numbers",
      name: t("design.cards.table_numbers_name"),
      desc: t("design.cards.table_numbers_desc"),
      path: tableNumbersPdfUrl,
      filename: "weddly-table-numbers.pdf",
    },
    {
      slug: "menu",
      name: t("design.cards.menu_name"),
      desc: t("design.cards.menu_desc"),
      path: menuPdfUrl,
      filename: "weddly-menu.pdf",
    },
    {
      slug: "seating_chart",
      name: t("design.cards.seating_chart_name"),
      desc: t("design.cards.seating_chart_desc"),
      path: "/api/print/seating/a4",
      filename: "weddly-seating-chart.pdf",
    },
    {
      slug: "schedule",
      name: t("design.cards.schedule_name"),
      desc: t("design.cards.schedule_desc"),
      path: schedulePdfUrl,
      filename: "weddly-schedule.pdf",
    },
  ];

  const tabBtn = (key: "website" | "print", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
        tab === key
          ? "bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
          : "text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <h1 className="font-grotesk font-semibold tracking-tight">{t("design.title")}</h1>
          <InfoHint text={t("design.hint")} />
        </div>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("design.subtitle")}</p>
      </header>

      {loading ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          {/* ── Left column: the COMMON identity (drives BOTH surfaces), then
              the Website / Print surface tabs with only surface-specific
              controls. ───────────────────────────────────────────────────── */}
          <div className="space-y-6">
            {/* Wedding style */}
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.style")}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {STYLE_PRESETS.map((s) => {
                  const palette = getPalette(s.defaultPalette);
                  return (
                    <PresetTile
                      key={s.slug}
                      active={design.style === s.slug}
                      onSelect={() => chooseStyle(s.slug)}
                      label={t(s.nameKey)}
                      ariaLabel={t(s.nameKey)}
                    >
                      <span
                        className="flex h-12 overflow-hidden rounded-lg border border-paper-200 dark:border-umber-700"
                        aria-hidden
                      >
                        {[palette.background, palette.accent, palette.primary, palette.text].map(
                          (c) => (
                            <span
                              key={c.hex}
                              className="flex-1"
                              style={{ backgroundColor: c.hex }}
                            />
                          ),
                        )}
                      </span>
                    </PresetTile>
                  );
                })}
              </div>
            </section>

            {/* Colours — the base palette comes from the chosen Wedding Style;
                here the couple fine-tunes any role on top of it. Each input is
                seeded from the resolved colour (override or palette); Reset
                clears the override back to the palette. */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                  {t("design.colors.title")}
                </h2>
                <InfoHint text={t("design.colors.hint")} />
              </div>
              <div className="rounded-2xl border border-paper-300 bg-white p-3 dark:border-umber-700 dark:bg-umber-800">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {COLOR_ROLES.map((role) => {
                    const resolved = design.colors[role] ?? activePalette[role].hex;
                    const overridden = design.colors[role] !== undefined;
                    return (
                      <div key={role} className="flex flex-col gap-1">
                        <label className="flex items-center gap-2 text-xs text-ink-700 dark:text-paper-100">
                          <input
                            type="color"
                            value={resolved}
                            onChange={(ev) => chooseColor(role, ev.target.value)}
                            aria-label={t(`design.colors.${role}`)}
                            className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-paper-300 bg-transparent p-0.5 dark:border-umber-700"
                          />
                          <span className="min-w-0 truncate">{t(`design.colors.${role}`)}</span>
                        </label>
                        {overridden && (
                          <button
                            type="button"
                            onClick={() => clearColor(role)}
                            className="self-start text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
                          >
                            {t("design.colors.reset")}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {lowContrast && (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                    {t("design.colors.low_contrast")}
                  </p>
                )}
              </div>
            </section>

            {/* Fonts */}
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.fonts")}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {FONT_PRESETS.map((f) => (
                  <PresetTile
                    key={f.slug}
                    active={design.fonts === f.slug}
                    onSelect={() => chooseFonts(f.slug)}
                    label={t(f.nameKey)}
                    ariaLabel={t(f.nameKey)}
                  >
                    <span className="flex flex-col" aria-hidden>
                      <span
                        className="text-xl leading-tight text-ink-900 dark:text-paper-50"
                        style={{ fontFamily: f.headingStack }}
                      >
                        Anna & Bence
                      </span>
                      <span
                        className="truncate text-[11px] text-ink-500 dark:text-umber-300"
                        style={{ fontFamily: f.bodyStack }}
                      >
                        {t("design.font_sample_body")}
                      </span>
                    </span>
                  </PresetTile>
                ))}
              </div>

              {/* Independent heading / body family overrides on top of the
                  preset, one row each. Each chip renders its own name in its
                  actual font so the couple sees the typeface before picking.
                  "Use preset" clears the override; only bundled families are
                  offered (no new webfont request). */}
              <div className="mt-3 space-y-3">
                {(
                  [
                    ["heading", design.headingFont, chooseHeadingFont] as const,
                    ["body", design.bodyFont, chooseBodyFont] as const,
                  ] as const
                ).map(([which, current, setter]) => (
                  <div key={which}>
                    <span className="mb-1.5 block text-xs font-medium text-ink-600 dark:text-umber-200">
                      {t(`design.font.${which}_label`)}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <FontChip active={current === null} onClick={() => setter(null)}>
                        {t("design.font.use_preset")}
                      </FontChip>
                      {FONT_FAMILIES.map((fam) => (
                        <FontChip
                          key={fam.slug}
                          active={current === fam.slug}
                          onClick={() => setter(fam.slug)}
                          fontFamily={fam.stack}
                        >
                          {t(fam.nameKey)}
                        </FontChip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Monogram */}
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.monogram")}
              </h2>
              <button
                type="button"
                onClick={toggleMonogram}
                aria-pressed={design.monogram.enabled}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                  design.monogram.enabled
                    ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                    : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                }`}
              >
                {design.monogram.enabled && <Check size={12} strokeWidth={3} aria-hidden />}
                {t("design.monogram.enable")}
              </button>
              {design.monogram.enabled && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-ink-500 dark:text-umber-300">
                    {t("design.monogram.separator_label")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {MONOGRAM_SEPARATORS.map((sep) => {
                      const glyph =
                        sep.slug === "and" ? monogramSeparatorGlyph("and", locale) : sep.glyph;
                      const active = design.monogram.separator === sep.slug;
                      return (
                        <button
                          key={sep.slug}
                          type="button"
                          onClick={() => chooseSeparator(sep.slug)}
                          aria-pressed={active}
                          aria-label={glyph}
                          className={`inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-xl border px-3 font-serif text-base transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                            active
                              ? "border-ink-900 ring-1 ring-ink-900 text-ink-900 dark:border-paper-100 dark:ring-paper-100 dark:text-paper-50"
                              : "border-paper-300 text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                          }`}
                        >
                          {glyph}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* Date format */}
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.date")}
              </h2>
              <div className="grid grid-cols-3 gap-2">
                {DATE_FORMATS.map((df) => (
                  <PresetTile
                    key={df.slug}
                    active={design.dateFormat === df.slug}
                    onSelect={() => chooseDateFormat(df.slug)}
                    label={t(df.nameKey)}
                    ariaLabel={t(df.nameKey)}
                  >
                    <span
                      className="font-serif text-base italic text-ink-900 dark:text-paper-50"
                      aria-hidden
                    >
                      {formatWeddingDate(sampleDateIso, df.slug, locale)}
                    </span>
                  </PresetTile>
                ))}
              </div>
            </section>

            {/* Decorative style */}
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("design.section.decor")}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {DECOR_STYLES.map((dec) => (
                  <PresetTile
                    key={dec.slug}
                    active={design.decor === dec.slug}
                    onSelect={() => chooseDecor(dec.slug)}
                    label={t(dec.nameKey)}
                    ariaLabel={t(dec.nameKey)}
                  >
                    <span
                      className="flex h-8 items-center justify-center text-ink-400 dark:text-umber-300"
                      aria-hidden
                    >
                      {dec.slug === "line" && (
                        <span className="h-px w-16 bg-ink-300 dark:bg-umber-500" />
                      )}
                      {dec.slug === "dots" && (
                        <span className="text-lg tracking-[0.4em]">· · ·</span>
                      )}
                      {dec.slug === "frame" && (
                        <span className="h-7 w-16 rounded border border-ink-300 dark:border-umber-500" />
                      )}
                      {dec.slug === "botanical" && <span className="text-xl">❧</span>}
                    </span>
                  </PresetTile>
                ))}
              </div>
            </section>
            {/* ── Surface tabs: Website vs Print. The common identity above
                drives both; each tab owns only its surface-specific controls. */}
            <div
              role="tablist"
              aria-label={t("design.title")}
              className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-white p-1 dark:border-umber-700 dark:bg-umber-800"
            >
              {tabBtn("website", t("design.tab.website"))}
              {tabBtn("print", t("design.tab.print"))}
            </div>

            {tab === "website" ? (
              <div className="space-y-6">
                <p className="text-sm text-ink-500 dark:text-umber-300">
                  {t("design.website.helper")}
                </p>
                {/* Card corner rounding */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.web.card_radius_label")}
                  </h2>
                  <div className="grid grid-cols-3 gap-2">
                    {CARD_RADII.map((r) => (
                      <PresetTile
                        key={r.slug}
                        active={design.web.cardRadius === r.slug}
                        onSelect={() => chooseCardRadius(r.slug)}
                        label={t(r.nameKey)}
                        ariaLabel={t(r.nameKey)}
                      >
                        <span
                          className="block h-8 w-full border border-paper-300 bg-paper-100 dark:border-umber-600 dark:bg-umber-700"
                          style={{ borderRadius: r.css }}
                          aria-hidden
                        />
                      </PresetTile>
                    ))}
                  </div>
                </section>
                {/* Card elevation / shadow */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.web.shadow_label")}
                  </h2>
                  <div className="grid grid-cols-3 gap-2">
                    {SHADOWS.map((s) => (
                      <PresetTile
                        key={s.slug}
                        active={design.web.shadow === s.slug}
                        onSelect={() => chooseShadow(s.slug)}
                        label={t(s.nameKey)}
                        ariaLabel={t(s.nameKey)}
                      >
                        <span
                          className="block h-8 w-full rounded-lg border border-paper-200 bg-white dark:border-umber-600 dark:bg-umber-700"
                          style={{ boxShadow: s.css === "none" ? undefined : s.css }}
                          aria-hidden
                        />
                      </PresetTile>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Print options — only the toggles that affect the printed
                    card; the live card preview is in the right column. */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.section.print")}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {(["border", "ornament", "qr"] as const).map((key) => {
                      const on = design.print[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => togglePrint(key)}
                          aria-pressed={on}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                            on
                              ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                              : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                          }`}
                        >
                          {on && <Check size={12} strokeWidth={3} aria-hidden />}
                          {t(`design.print.${key}`)}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Downloadable PDFs (the instant preview is the right column;
                    these render the exact print-ready files on demand). */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.cards.downloads_heading")}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {printables.map((card) => {
                      const busy = downloading === card.slug;
                      return (
                        <div
                          key={card.slug}
                          className="flex flex-col gap-2 rounded-2xl border border-paper-300 bg-white p-3 dark:border-umber-700 dark:bg-umber-800"
                        >
                          <h3 className="text-sm font-medium text-ink-900 dark:text-paper-50">
                            {card.name}
                          </h3>
                          <p className="flex-1 text-xs text-ink-500 dark:text-umber-300">
                            {card.desc}
                          </p>
                          <button
                            type="button"
                            onClick={() => downloadCard(card.slug, card.path, card.filename)}
                            disabled={busy || downloading !== null}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-ink-900 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-ink-900 hover:text-paper-50 disabled:cursor-default disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-paper-100 dark:text-paper-50 dark:hover:bg-paper-100 dark:hover:text-umber-900"
                          >
                            {busy ? (
                              <>
                                <Loader2 size={14} className="animate-spin" aria-hidden />
                                {t("design.cards.downloading")}
                              </>
                            ) : (
                              <>
                                <Download size={14} aria-hidden />
                                {t("design.cards.action_download")}
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* ── Preview column: the guest page on the Website tab, the live
              print card on the Print tab. ──────────────────────────────── */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-200">
              {t("design.preview_label")}
            </p>
            {tab === "print" ? (
              <PrintCardPreview
                design={design}
                brideName={couple?.bride_name ?? null}
                groomName={couple?.groom_name ?? null}
                locale={locale}
              />
            ) : (
              previewView && (
                <div className="overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700">
                  {/* Full guest page: below lg it scrolls with the page; on lg+
                      the sticky aside caps to the viewport and scrolls internally
                      so the whole page stays reachable without clipping. */}
                  <div className="p-4 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
                    <WeddingSiteView
                      view={previewView}
                      household={null}
                      tier="public"
                      locale={locale}
                      isPreview={false}
                      showFooter={false}
                    />
                  </div>
                </div>
              )
            )}
          </aside>
        </div>
      )}
    </>
  );
}
