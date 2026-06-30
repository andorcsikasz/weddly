// /app/design — the wedding visual-identity editor. A curated, controlled
// design system (NOT a freeform editor): the couple picks one Wedding Style,
// one Colour Palette and one Font preset from fixed catalogs, plus a few print
// toggles. The selection persists on `couples.design_json` and drives the
// guest page (live preview below) + the printable cards. The concrete colours
// and font stacks all come from `@shared/design`, so the picker and the guest
// page can never drift.

import {
  BORDER_STYLES,
  type BorderStyleSlug,
  BUTTON_STYLES,
  type ButtonStyleSlug,
  getBorderCss,
  COLOR_ROLES,
  type ColorRole,
  type CoupleDesign,
  DATE_FORMATS,
  type StylePreset,
  FONT_FAMILIES,
  FONT_PRESETS,
  type FontFamilySlug,
  type FontPresetSlug,
  formatWeddingDate,
  getFontPreset,
  getPalette,
  getStylePreset,
  IMAGE_TREATMENTS,
  type ImageTreatmentSlug,
  resolveDesign,
  STYLE_PRESETS,
  type StylePresetSlug,
  toPublicDesign,
} from "@shared/design";
import { getContrastRatio } from "@shared/wcag";
import type { Couple } from "@shared/types";
import type { PublicWeddingWebsiteView } from "@shared/wedding_website";
import {
  Check,
  Download,
  Eye,
  Loader2,
  Maximize2,
  Monitor,
  Pencil,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ComingSoon } from "../components/ComingSoon";
import { InfoHint } from "../components/InfoHint";
import { headingTreatmentCss, OrnamentDivider, OrnamentFrame } from "../components/ornaments";
import { PrintCardPreview, type PrintTemplate } from "../components/PrintCardPreview";
import { WeddingSiteView } from "../components/WeddingSiteView";
import { Link, useLocation } from "react-router-dom";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  coupleApi,
  fetchPdfBlob,
  invitationPdfUrl,
  menuPdfUrl,
  placeCardsUrl,
  schedulePdfUrl,
  tableNumbersPdfUrl,
  thankYouPdfUrl,
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
  compact = false,
}: {
  active: boolean;
  onSelect: () => void;
  /** Visible caption under the preview. Omit to render no caption (the font
   *  tiles preview the typeface itself, so a redundant name is dropped). */
  label?: string;
  ariaLabel: string;
  children: React.ReactNode;
  /** Tighter padding + a smaller check badge, for short single-line previews
   *  (date formats) where the full tile padding wastes space and crowds the
   *  text against the badge. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`group relative flex flex-col text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:focus-visible:ring-paper-100 ${
        compact ? "gap-2 rounded-xl border bg-white p-2" : "gap-3 rounded-2xl border bg-white p-3"
      } ${
        active
          ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
          : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
      }`}
    >
      {active && (
        <span
          className={`absolute inline-flex items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900 ${
            compact ? "right-1.5 top-1.5 h-4 w-4" : "right-2 top-2 h-5 w-5"
          }`}
          aria-hidden
        >
          <Check size={compact ? 10 : 12} strokeWidth={3} />
        </span>
      )}
      {children}
      {label && (
        <span className="text-sm font-medium text-ink-900 dark:text-paper-50">{label}</span>
      )}
    </button>
  );
}

/** A whole STYLE PACK previewed as a true mini-card: the pack's palette, its
 *  heading + body fonts WITH the pack's heading treatment (italic / uppercase /
 *  small caps), its ornament language and its card LAYOUT direction — so the
 *  four tiles read as four different worlds at a glance, not four colour swatches.
 *  Mirrors the print-card layouts (centered / asymmetric / framed / corners).
 *  Rendered entirely from the catalog — no authored hex. */
function StyleMoodCard({
  preset,
  sampleName,
  sampleDate,
}: {
  preset: StylePreset;
  sampleName: string;
  sampleDate: string;
}) {
  const palette = getPalette(preset.defaultPalette);
  const fonts = getFontPreset(preset.defaultFonts);
  const bg = palette.background.hex;
  const text = palette.text.hex;
  const accent = palette.accent.hex;
  const headingCss: React.CSSProperties = {
    fontFamily: fonts.headingStack,
    color: text,
    ...headingTreatmentCss(preset.headingStyle),
  };
  const dateCss: React.CSSProperties = { fontFamily: fonts.bodyStack, color: accent };

  return (
    <span
      className="relative flex aspect-[4/5] w-full flex-col overflow-hidden rounded-lg border border-black/5 dark:border-white/10"
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      {/* Frame overlays (oval for Blush, deco corners for Midnight). */}
      <span style={{ color: accent }}>
        <OrnamentFrame slug={preset.ornament} />
      </span>

      {preset.cardLayout === "asymmetric" ? (
        // Monochrome: left-aligned bold uppercase name + a tabular number top-right.
        <span className="flex h-full flex-col justify-between p-3">
          <span className="self-end text-[11px] tabular-nums" style={{ color: text }}>
            12
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="text-left text-lg leading-none" style={headingCss}>
              {sampleName}
            </span>
            <OrnamentDivider slug={preset.ornament} className="h-2 w-10" style={{ color: text }} />
            <span className="text-left text-[10px] tracking-[0.12em]" style={dateCss}>
              {sampleDate}
            </span>
          </span>
        </span>
      ) : (
        // Garden / Blush / Midnight: centred, ornament between name + date.
        <span className="flex h-full flex-col items-center justify-center gap-1.5 px-3 py-4 text-center">
          <span className="text-xl leading-tight" style={headingCss}>
            {sampleName}
          </span>
          <OrnamentDivider slug={preset.ornament} className="h-3 w-16" style={{ color: accent }} />
          <span className="text-[10px] uppercase tracking-[0.18em]" style={dateCss}>
            {sampleDate}
          </span>
        </span>
      )}
    </span>
  );
}

/** A selectable font chip that renders its own label in the font it represents,
 *  so the couple previews the typeface before choosing. `fontFamily` omitted =
 *  the "Use preset" chip (rendered in the UI font). */
/** A font chip that PREVIEWS the typeface: it shows a large "Aa" rendered in
 *  the font it represents (no name text). `label` is the accessible name (the
 *  family name / "use preset") since the visible "Aa" carries no meaning to a
 *  screen reader. */
function FontChip({
  active,
  onClick,
  fontFamily,
  label,
}: {
  active: boolean;
  onClick: () => void;
  fontFamily?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`inline-flex min-w-[3.5rem] flex-col items-center gap-0.5 rounded-xl border px-2 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
        active
          ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
          : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
      }`}
    >
      {/* "Aa" in the actual typeface, with the family name labelled below so the
          couple can identify the font without trial-and-error (audit #12). */}
      <span className="text-xl leading-none" style={fontFamily ? { fontFamily } : undefined}>
        Aa
      </span>
      <span className="max-w-[5rem] truncate text-[9px] leading-tight opacity-70">{label}</span>
    </button>
  );
}

/** Read-only recap of the shared visual identity, shown on the PRINT tab in
 *  place of the full style/colour/font editors. The identity is edited once on
 *  the Guest-site tab and inherited everywhere, so re-showing every control
 *  here only invited "where do I actually change this?" confusion. */
function InheritedSummary({ design }: { design: CoupleDesign }) {
  const { t } = useT();
  const palette = getPalette(design.palette);
  const fonts = getFontPreset(design.fonts);
  const styleName = t(getStylePreset(design.style).nameKey);
  const headingFamily = design.headingFont ?? fonts.headingFamily;
  const bodyFamily = design.bodyFont ?? fonts.bodyFamily;
  const familyName = (slug: FontFamilySlug) =>
    t(FONT_FAMILIES.find((f) => f.slug === slug)?.nameKey ?? "design.family.cormorant");
  return (
    <section className="rounded-2xl border border-paper-300 bg-white p-4 dark:border-umber-700 dark:bg-umber-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("design.print_preview.inherited_title")}
          </h2>
          <p className="mt-0.5 text-base font-medium text-ink-900 dark:text-paper-50">
            {styleName}
          </p>
        </div>
        <Link
          to="/app/design/website"
          className="shrink-0 text-xs font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline dark:text-umber-200 dark:hover:text-paper-50"
        >
          {t("design.print_preview.inherited_change")}
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="flex gap-1.5">
          {COLOR_ROLES.map((role) => (
            <span
              key={role}
              className="h-6 w-6 rounded-md ring-1 ring-black/10 dark:ring-white/10"
              style={{ backgroundColor: design.colors[role] ?? palette[role].hex }}
              title={t(`design.colors.${role}`)}
            />
          ))}
        </div>
        <p className="text-xs text-ink-500 dark:text-umber-300">
          {familyName(headingFamily)} · {familyName(bodyFamily)}
        </p>
      </div>
    </section>
  );
}

export default function DesignPage() {
  const { user } = useAuth();
  const { t, locale } = useT();
  const toast = useToast();

  if (!user?.is_admin) return <ComingSoon />;

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
  // Which surface this is editing is driven by the URL: /app/design/website vs
  // /app/design/print are two sub-pages over the same shared state + auto-save.
  const { pathname } = useLocation();
  const tab: "website" | "print" = pathname.endsWith("/print") ? "print" : "website";
  // Which printable the live print preview shows (Print tab only).
  const [printTemplate, setPrintTemplate] = useState<PrintTemplate>("place_card");
  // On-demand exact-PDF preview (blob: URL shown in an iframe under the live
  // card). Null until the couple asks for it; revoked + recomputed per request.
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewBusy, setPdfPreviewBusy] = useState(false);
  // Per-tile download-in-flight flag, keyed by the printable's slug.
  const [downloading, setDownloading] = useState<string | null>(null);
  // Full-page guest-page preview overlay (Website tab). Open state + which
  // device frame width the preview is shown at (mobile ~390px vs desktop 100%).
  const [fullPreview, setFullPreview] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<"mobile" | "desktop">("desktop");

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

  // Escape closes the full-page preview overlay (only bound while it's open).
  useEffect(() => {
    if (!fullPreview) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setFullPreview(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullPreview]);

  // Picking a style pre-selects its palette + fonts, but the couple can still
  // override either independently afterwards (the catalog defaults are a
  // starting point, not a lock).
  function chooseStyle(slug: StylePresetSlug) {
    const preset = STYLE_PRESETS.find((s) => s.slug === slug);
    if (!preset) return;
    // A style is a full reset: it re-seeds palette + fonts AND drops any
    // custom colour / font-family overrides so the tile is the obvious reset.
    // Styles may also seed website chrome (e.g. the editorial style turns on
    // grayscale photos + sharp/shadowless/outline) via `defaultWeb`.
    setDesign((d) => ({
      ...d,
      style: slug,
      palette: preset.defaultPalette,
      fonts: preset.defaultFonts,
      colors: {},
      headingFont: null,
      bodyFont: null,
      // Each pack also seeds its signature date format + frame (Roman numerals
      // for Midnight Luxe, numeric for Monochrome) so the pack reads coherently
      // the instant it's picked. Still freely overridable afterwards.
      dateFormat: preset.defaultDateFormat,
      borderStyle: preset.defaultBorderStyle,
      web: { ...d.web, ...(preset.defaultWeb ?? {}) },
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
  function chooseButtonStyle(slug: ButtonStyleSlug) {
    setDesign((d) => ({ ...d, web: { ...d.web, buttonStyle: slug } }));
  }
  function chooseImageTreatment(slug: ImageTreatmentSlug) {
    setDesign((d) => ({ ...d, web: { ...d.web, imageTreatment: slug } }));
  }
  function chooseBorderStyle(slug: BorderStyleSlug) {
    // Keep the legacy `print.border` boolean in sync (on/off) so the current
    // PDF path stays consistent until pdf.ts reads the style directly.
    setDesign((d) => ({ ...d, borderStyle: slug, print: { ...d.print, border: slug !== "none" } }));
  }
  function chooseDateFormat(slug: (typeof DATE_FORMATS)[number]["slug"]) {
    setDesign((d) => ({ ...d, dateFormat: slug }));
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

  // Server path for the exact PDF of the currently-selected template.
  const exactPdfPath: Record<PrintTemplate, string> = {
    place_card: placeCardsUrl(),
    table_number: "/api/print/table-numbers",
    menu: "/api/print/menu",
    invitation: invitationPdfUrl,
    thank_you: thankYouPdfUrl,
    schedule: schedulePdfUrl,
  };

  // Fetch the real PDF and show it in the iframe below the live card. Revokes
  // any previous blob URL first so we never leak object URLs.
  async function previewExactPdf() {
    if (pdfPreviewBusy) return;
    setPdfPreviewBusy(true);
    try {
      const blob = await fetchPdfBlob(exactPdfPath[printTemplate]);
      const typed =
        blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
      setPdfPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(typed);
      });
    } catch {
      toast.error(t("design.cards.download_error"));
    } finally {
      setPdfPreviewBusy(false);
    }
  }

  // Base palette for the colour pickers: each input seeds from the custom
  // override if set, else this palette's hex for that role.
  const activePalette = getPalette(design.palette);
  // Resolved final colours (overrides applied) drive the live contrast check.
  const resolvedColors = useMemo(() => toPublicDesign(design), [design]);
  // Warn (never block) when body text or accent text would be hard to read on
  // the chosen background.
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
        venue_city: couple.venue_city,
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
  // The couple's names (or a sample) shown on the style-pack mini-cards, so each
  // pack previews its typography on a real-feeling invitation rather than a glyph.
  const sampleName =
    couple?.bride_name && couple?.groom_name
      ? `${couple.bride_name} & ${couple.groom_name}`
      : t("design.print_preview.sample_couple");

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
      slug: "invitation",
      name: t("design.cards.invitation_name"),
      desc: t("design.cards.invitation_desc"),
      path: invitationPdfUrl,
      filename: "weddly-invitation.pdf",
    },
    {
      slug: "thank_you",
      name: t("design.cards.thank_you_name"),
      desc: t("design.cards.thank_you_desc"),
      path: thankYouPdfUrl,
      filename: "weddly-thank-you.pdf",
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

  // Surface sub-page links — each is its own URL so the two design surfaces are
  // genuinely separate pages (back/forward, deep-link), sharing this state.
  const tabBtn = (key: "website" | "print", label: string) => (
    <Link
      to={`/app/design/${key}`}
      role="tab"
      aria-selected={tab === key}
      className={`flex-1 rounded-full px-4 py-2 text-center text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
        tab === key
          ? "bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
          : "text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <h1 className="font-grotesk font-semibold tracking-tight">{t("design.title")}</h1>
          <InfoHint text={t("design.hint")} />
        </div>
      </header>

      {/* Publish bridge — once the couple has a guest-page slug but hasn't made
          it public yet, nudge them across to the guest-page publish toggle.
          Hidden when already public or no slug exists. */}
      {couple?.slug && couple.is_public === false ? (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-paper-300 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-umber-700 dark:bg-umber-800">
          <p className="text-sm text-ink-700 dark:text-paper-100">{t("design.publish_cta_text")}</p>
          <Link
            to="/app/guest-page"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-paper-50 transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-200 dark:focus-visible:ring-paper-100"
          >
            {t("design.publish_cta_button")}
          </Link>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
          {/* ── Left column: a compact editor panel. The Website / Print
              switcher is pinned at the top (full-width within this column, so
              it never reaches over the preview). In print mode the card-type
              picker comes FIRST so the couple knows which physical card they're
              designing; the COMMON identity (drives BOTH surfaces) sits under a
              "shared identity" label, then the card-specific controls. The big
              live canvas lives in the right column. ───────────────────────── */}
          <div className="space-y-6">
            {/* Surface switcher: Website vs Print. */}
            <div
              role="tablist"
              data-tour-target="design-tabs"
              aria-label={t("design.title")}
              className="flex w-full items-center gap-1 rounded-full border border-paper-300 bg-white p-1 dark:border-umber-700 dark:bg-umber-800"
            >
              {tabBtn("website", t("design.tab.website"))}
              {tabBtn("print", t("design.tab.print"))}
            </div>

            {/* Per-surface heading. In print mode it names the SELECTED card
                ("Asztalszám tervezése") so the editor reads as a card editor,
                not a generic brand panel. */}
            {tab === "print" ? (
              <div>
                <h2 className="font-grotesk text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                  {t("design.print_preview.editing_title", {
                    name: t(`design.print_preview.tpl.${printTemplate}`),
                  })}
                </h2>
                <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
                  {t("design.print_preview.editing_helper")}
                </p>
              </div>
            ) : null}

            {/* Print mode: WHICH card am I designing? This is the first and most
                important choice, so it sits above the shared identity. Real
                card types only (each maps to a live preview + a PDF endpoint). */}
            {tab === "print" && (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                  {t("design.print_preview.template_label")}
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      "place_card",
                      "table_number",
                      "menu",
                      "invitation",
                      "thank_you",
                      "schedule",
                    ] as const
                  ).map((tpl) => {
                    const active = printTemplate === tpl;
                    return (
                      <button
                        key={tpl}
                        type="button"
                        onClick={() => {
                          setPrintTemplate(tpl);
                          setPdfPreviewUrl((p) => {
                            if (p) URL.revokeObjectURL(p);
                            return null;
                          });
                        }}
                        aria-pressed={active}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                          active
                            ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                            : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                        }`}
                      >
                        {active && <Check size={12} strokeWidth={3} aria-hidden />}
                        {t(`design.print_preview.tpl.${tpl}`)}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Shared identity — the common look that drives BOTH surfaces. In
                print mode we label it so the hierarchy (card type → shared
                identity → card specifics) is obvious. */}
            {/* Print tab: the shared identity is edited on the Guest-site tab,
                so here it collapses to a read-only summary with a jump link
                (audit #13) instead of repeating every editing control. */}
            {tab === "print" ? <InheritedSummary design={design} /> : null}
            {tab === "website" && (
              <>
                {/* Wedding style */}
                <section data-tour-target="design-style">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.section.style")}
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    {STYLE_PRESETS.map((s) => (
                      <PresetTile
                        key={s.slug}
                        active={design.style === s.slug}
                        onSelect={() => chooseStyle(s.slug)}
                        ariaLabel={t(s.nameKey)}
                        label={t(s.nameKey)}
                      >
                        {/* Each tile previews its OWN date format (Roman for
                        Midnight, numeric for Monochrome) so the format reads as
                        part of the pack, not a separate choice. */}
                        <StyleMoodCard
                          preset={s}
                          sampleName={sampleName}
                          sampleDate={formatWeddingDate(sampleDateIso, s.defaultDateFormat, locale)}
                        />
                      </PresetTile>
                    ))}
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
                  <div className="mx-auto w-fit max-w-full">
                    {/* Swatch row: each role is a colour block with a pencil badge;
                    clicking it opens the native colour editor (the swatch IS the
                    input label). Reset clears the override back to the palette. */}
                    <div className="flex flex-wrap justify-center gap-4">
                      {COLOR_ROLES.map((role) => {
                        const resolved = design.colors[role] ?? activePalette[role].hex;
                        const overridden = design.colors[role] !== undefined;
                        return (
                          <div key={role} className="flex flex-col items-center gap-1">
                            <label
                              className="relative block h-12 w-12 cursor-pointer rounded-xl border border-paper-300 shadow-soft dark:border-umber-700"
                              style={{ backgroundColor: resolved }}
                              title={t(`design.colors.${role}`)}
                            >
                              <input
                                type="color"
                                value={resolved}
                                onChange={(ev) => chooseColor(role, ev.target.value)}
                                aria-label={t(`design.colors.${role}`)}
                                className="sr-only"
                              />
                              <span className="absolute -bottom-1.5 -right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-paper-200 bg-white text-ink-700 shadow-soft dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100">
                                <Pencil size={11} aria-hidden />
                              </span>
                            </label>
                            <span className="text-[11px] text-ink-600 dark:text-umber-200">
                              {t(`design.colors.${role}`)}
                            </span>
                            {overridden ? (
                              <button
                                type="button"
                                onClick={() => clearColor(role)}
                                className="text-[10px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
                              >
                                {t("design.colors.reset")}
                              </button>
                            ) : (
                              <span className="h-[14px]" aria-hidden />
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
                        ariaLabel={t(f.nameKey)}
                      >
                        <span
                          className="block text-xl leading-tight text-ink-900 dark:text-paper-50"
                          style={{ fontFamily: f.headingStack }}
                          aria-hidden
                        >
                          Anna & Bence
                        </span>
                      </PresetTile>
                    ))}
                  </div>

                  {/* Independent heading / body family overrides on top of the
                  preset, united in one card (a thin divider between the two
                  rows) so the typeface controls read as a single block. Each
                  chip renders its own name in its actual font; only bundled
                  families are offered. The active chip is the EFFECTIVE
                  typeface — the explicit override, or the family the chosen
                  preset resolves to while no override is set — so switching the
                  preset above always re-highlights the right family here.
                  Picking the preset's own family re-links to it (null override),
                  so a later preset change keeps following. */}
                  <div className="mt-3 divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-white p-3 dark:divide-umber-700 dark:border-umber-700 dark:bg-umber-800">
                    {(
                      [
                        [
                          "heading",
                          design.headingFont,
                          chooseHeadingFont,
                          getFontPreset(design.fonts).headingFamily,
                        ] as const,
                        [
                          "body",
                          design.bodyFont,
                          chooseBodyFont,
                          getFontPreset(design.fonts).bodyFamily,
                        ] as const,
                      ] as const
                    ).map(([which, current, setter, presetFamily]) => {
                      const effective = current ?? presetFamily;
                      return (
                        <div key={which} className="py-2 first:pt-0 last:pb-0">
                          <span className="mb-1.5 block text-xs font-medium text-ink-600 dark:text-umber-200">
                            {t(`design.font.${which}_label`)}
                          </span>
                          <div className="flex flex-wrap justify-center gap-2">
                            {FONT_FAMILIES.map((fam) => (
                              <FontChip
                                key={fam.slug}
                                active={effective === fam.slug}
                                // Re-selecting the preset's family clears the override
                                // (null) so it keeps tracking later preset changes.
                                onClick={() => setter(fam.slug === presetFamily ? null : fam.slug)}
                                fontFamily={fam.stack}
                                label={t(fam.nameKey)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
                        ariaLabel={t(df.nameKey)}
                        compact
                      >
                        <span
                          className="flex min-h-[2rem] w-full items-center justify-center whitespace-nowrap text-center font-serif text-sm italic leading-tight tracking-tight text-ink-900 dark:text-paper-50"
                          aria-hidden
                        >
                          {formatWeddingDate(sampleDateIso, df.slug, locale)}
                        </span>
                      </PresetTile>
                    ))}
                  </div>
                </section>
              </>
            )}

            {tab === "website" ? (
              <div className="space-y-6">
                {/* RSVP button look */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.web.button_style_label")}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {BUTTON_STYLES.map((b) => {
                      const active = design.web.buttonStyle === b.slug;
                      return (
                        <button
                          key={b.slug}
                          type="button"
                          onClick={() => chooseButtonStyle(b.slug)}
                          aria-pressed={active}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                            active
                              ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                              : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                          }`}
                        >
                          {active && <Check size={12} strokeWidth={3} aria-hidden />}
                          {t(b.nameKey)}
                        </button>
                      );
                    })}
                  </div>
                </section>
                {/* Photo treatment — full colour vs desaturated black-and-white
                    (the editorial look). */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.web.image_treatment_label")}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {IMAGE_TREATMENTS.map((it) => {
                      const active = design.web.imageTreatment === it.slug;
                      return (
                        <button
                          key={it.slug}
                          type="button"
                          onClick={() => chooseImageTreatment(it.slug)}
                          aria-pressed={active}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                            active
                              ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                              : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                          }`}
                        >
                          {active && <Check size={12} strokeWidth={3} aria-hidden />}
                          {t(it.nameKey)}
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            ) : (
              <div className="space-y-6">
                {/* The card-type picker moved to the top of the panel (above the
                    shared identity); the print branch now starts with the
                    card-specific look controls. */}
                {/* Border style — 4 selectable looks for the card frame
                    (supersedes the old on/off border toggle). Visual tiles: the
                    box shows the actual border in the resolved accent colour. */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.print.border")}
                  </h2>
                  <div className="grid grid-cols-4 gap-2">
                    {BORDER_STYLES.map((b) => {
                      const active = design.borderStyle === b.slug;
                      return (
                        <button
                          key={b.slug}
                          type="button"
                          onClick={() => chooseBorderStyle(b.slug)}
                          aria-pressed={active}
                          aria-label={b.slug}
                          className={`flex h-12 items-center justify-center rounded-xl border bg-white p-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:focus-visible:ring-paper-100 ${
                            active
                              ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
                              : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
                          }`}
                        >
                          <span
                            className="h-7 w-full rounded"
                            style={{ border: getBorderCss(b.slug, resolvedColors.accent) }}
                            aria-hidden
                          />
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Remaining print options. */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("design.section.print")}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {(["ornament", "qr"] as const).map((key) => {
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

                {/* Print tips: a collapsible note so a couple can hand the PDF
                    to a printer without guessing bleed / size / stock (audit #15). */}
                <details className="rounded-2xl border border-paper-200 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900">
                  <summary className="cursor-pointer text-sm font-medium text-ink-700 dark:text-paper-100">
                    {t("design.cards.print_tips_title")}
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-500 dark:text-umber-300">
                    <li>{t("design.cards.print_tips_bleed")}</li>
                    <li>{t("design.cards.print_tips_size")}</li>
                    <li>{t("design.cards.print_tips_stock")}</li>
                  </ul>
                </details>
              </div>
            )}
          </div>

          {/* ── Preview column: a large live canvas. The guest page on the
              Website tab, the print card centred on a "desk" backdrop on the
              Print tab. ───────────────────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            {tab === "print" ? (
              <div className="space-y-3">
                {/* Canvas toolbar: label on the left, exact-PDF toggle on the
                    right (the live card already updates instantly). */}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-200">
                    {t("design.preview_label")}
                  </p>
                  <button
                    type="button"
                    onClick={() => void previewExactPdf()}
                    disabled={pdfPreviewBusy}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full border border-paper-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-paper-400 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600 dark:focus-visible:ring-paper-100"
                  >
                    {pdfPreviewBusy ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <Eye size={14} aria-hidden />
                    )}
                    {t("design.print_preview.preview_exact_pdf")}
                  </button>
                </div>
                {/* The desk: a warm, large backdrop that frames the single card
                    so it reads as a physical object, not a thumbnail. */}
                <div className="grid min-h-[30rem] place-items-center rounded-2xl border border-paper-200 bg-paper-100 p-8 dark:border-umber-700 dark:bg-umber-900">
                  <PrintCardPreview
                    design={design}
                    template={printTemplate}
                    brideName={couple?.bride_name ?? null}
                  />
                </div>
                {pdfPreviewUrl && (
                  <iframe
                    src={pdfPreviewUrl}
                    title={t("design.print_preview.preview_exact_pdf")}
                    className="h-[32rem] w-full rounded-xl border border-paper-200 dark:border-umber-700"
                  />
                )}
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-200">
                    {t("design.preview_label")}
                  </p>
                  {previewView && (
                    <button
                      type="button"
                      onClick={() => setFullPreview(true)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-paper-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-paper-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600 dark:focus-visible:ring-paper-100"
                    >
                      <Maximize2 size={14} aria-hidden />
                      {t("design.full_preview")}
                    </button>
                  )}
                </div>
                {previewView && (
                  <div className="overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700">
                    {/* Full guest page, edge-to-edge so the editorial light/dark
                        bands reach the frame. Below lg it scrolls with the page;
                        on lg+ the sticky aside caps to the viewport and scrolls
                        internally so the whole page stays reachable. */}
                    <div className="lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
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
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {/* Full-page guest-page preview overlay — the SAME previewView through
          <WeddingSiteView>, framed at a mobile or desktop width via the header
          toggle. Escape (bound above) or the close button dismiss it. */}
      {fullPreview && previewView && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-label={t("design.full_preview")}
        >
          <header className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-1 rounded-full border border-white/20 bg-white/10 p-1">
              {(["mobile", "desktop"] as const).map((vp) => {
                const active = previewViewport === vp;
                const Icon = vp === "mobile" ? Smartphone : Monitor;
                return (
                  <button
                    key={vp}
                    type="button"
                    onClick={() => setPreviewViewport(vp)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                      active ? "bg-white text-ink-900" : "text-white/80 hover:text-white"
                    }`}
                  >
                    <Icon size={14} aria-hidden />
                    {t(vp === "mobile" ? "design.preview_mobile" : "design.preview_desktop")}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setFullPreview(false)}
              aria-label={t("design.preview_close")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <X size={18} aria-hidden />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-2 pb-6 sm:px-4">
            <div
              className="mx-auto overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl transition-[max-width] dark:border-umber-700"
              style={{ maxWidth: previewViewport === "mobile" ? 390 : "100%" }}
            >
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
        </div>
      )}
    </>
  );
}
