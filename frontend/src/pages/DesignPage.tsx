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
  buildMonogram,
  BUTTON_STYLES,
  type ButtonStyleSlug,
  CARD_RADII,
  type CardRadiusSlug,
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
  MONOGRAM_SEPARATORS,
  PALETTES,
  type PaletteSlug,
  resolveDesign,
  SHADOWS,
  type ShadowSlug,
  STYLE_PRESETS,
  type StylePresetSlug,
  toPublicDesign,
  WEBSITE_SECTIONS,
  type WebsiteSectionSlug,
} from "@shared/design";
import { getContrastRatio } from "@shared/wcag";
import type { Couple } from "@shared/types";
import type { PublicWeddingScheduleEntry, PublicWeddingWebsiteView } from "@shared/wedding_website";
import type { WishlistEntry } from "@shared/wishlist";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Maximize2,
  Monitor,
  Pencil,
  Smartphone,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InfoHint } from "../components/InfoHint";
import { headingTreatmentCss, OrnamentDivider, OrnamentFrame } from "../components/ornaments";
import { PrintCardPreview, type PrintTemplate } from "../components/PrintCardPreview";
import { WeddingSiteView } from "../components/WeddingSiteView";
import { Link, useLocation } from "react-router-dom";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import {
  coupleApi,
  fetchPdfBlob,
  invitationPdfUrl,
  menuPdfUrl,
  placeCardsUrl,
  schedulePdfUrl,
  scheduleApi,
  tableNumbersPdfUrl,
  thankYouPdfUrl,
  wishlistApi,
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
  /** Visible caption under the preview. Omit for swatch-only tiles where the
   *  preview speaks for itself — the name stays in the tooltip + aria-label. */
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
      title={label ? undefined : ariaLabel}
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
        <span className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
          {label}
        </span>
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
      className={`relative flex w-full flex-col items-center justify-center gap-0.5 rounded-xl border bg-white px-1.5 py-2.5 text-ink-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:text-paper-50 dark:focus-visible:ring-paper-100 ${
        active
          ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
          : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
      }`}
    >
      {/* Active state is a ring + badge (NOT an inverted fill) so the specimen
          keeps its true weight and colour while selected. */}
      {active && (
        <span
          className="absolute right-1 top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
          aria-hidden
        >
          <Check size={9} strokeWidth={3} />
        </span>
      )}
      {/* "Aa" in the actual typeface IS the preview. At sm+ the family name
          lives in the tooltip + aria-label (it would truncate to noise at
          six-up width); below sm the grid drops to 3-up and the name becomes a
          visible caption, since touch devices have no hover tooltips. */}
      <span
        className="flex h-7 items-center text-xl leading-none"
        style={fontFamily ? { fontFamily } : undefined}
      >
        Aa
      </span>
      <span className="w-full truncate text-center text-[10px] text-ink-500 sm:hidden dark:text-umber-300">
        {label}
      </span>
    </button>
  );
}

/** One numbered "studio chapter" of the website editor: a native <details>
 *  disclosure styled as an editorial worksheet. The summary row always shows a
 *  live readout of the chapter's current choice (pack name + colour dots,
 *  family names, hidden-section count) so a collapsed chapter still
 *  communicates. Native details/summary keeps keyboard + AT semantics free;
 *  the open state is mirrored into React via onToggle so re-renders don't
 *  fight the user's toggle. */
function Chapter({
  num,
  title,
  readout,
  defaultOpen,
  children,
}: {
  num: string;
  title: string;
  readout?: React.ReactNode;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(ev) => setOpen(ev.currentTarget.open)}
      className="group rounded-2xl border border-paper-200 bg-paper-50/60 dark:border-umber-700 dark:bg-umber-900/40"
    >
      <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 [&::-webkit-details-marker]:hidden dark:focus-visible:ring-paper-100">
        <span className="flex min-w-0 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ink-400 dark:text-umber-300">
            {num}
          </span>
          <span className="font-serif text-xl italic tracking-tight text-ink-900 dark:text-paper-50">
            {title}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {readout}
          <ChevronDown
            size={16}
            className="text-ink-400 transition-transform group-open:rotate-180 dark:text-umber-300"
            aria-hidden
          />
        </span>
      </summary>
      <div className="space-y-6 px-4 pb-5 pt-1">{children}</div>
    </details>
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
  // The viewport toggle is shared by the inline sticky preview and the overlay.
  const [fullPreview, setFullPreview] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<"mobile" | "desktop">("desktop");
  // Quiet ambient "Saved" flash next to the page title (replaces the old
  // success toast, which fired on every debounced auto-save).
  const [savedFlash, setSavedFlash] = useState(false);
  // Snapshot taken right before a style-pack switch. A pack switch reseeds
  // palette/fonts/date/chrome (destructive), so a one-shot Undo pill restores
  // the pre-switch design. Cleared by any other edit or after 15s.
  const [styleSnapshot, setStyleSnapshot] = useState<CoupleDesign | null>(null);
  // Truthful preview data: the couple's real schedule + wishlist so the dark
  // schedule band and the themed cards actually render while styling. Empty
  // until fetched; the preview falls back to labelled sample beats.
  const [previewSchedule, setPreviewSchedule] = useState<PublicWeddingScheduleEntry[]>([]);
  const [previewWishlist, setPreviewWishlist] = useState<WishlistEntry[]>([]);
  // Which photo slot has an upload/delete in flight (1 | 2 | null).
  const [photoBusy, setPhotoBusy] = useState<1 | 2 | null>(null);
  // Below lg only chapter 01 starts open (small screens scroll past the whole
  // editor); at lg+ all chapters start open. Read once at mount.
  const [lgUp] = useState(
    () =>
      typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches,
  );

  useEffect(() => {
    let cancelled = false;
    coupleApi
      .current()
      .then((r) => {
        if (cancelled || !r.couple) return;
        setCouple(r.couple);
        setDesign(r.couple.design);
        setSaved(r.couple.design);
        // Lapsed plans are read-only; derive it upfront from the billing
        // snapshot instead of waiting for the first PATCH to 402.
        setReadOnly(!r.couple.billing.entitled);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // The couple's real content for the preview. Failures degrade silently to
    // the sample beats; design edits never refetch (they only swap the theme).
    scheduleApi
      .list()
      .then((r) => {
        if (cancelled) return;
        setPreviewSchedule(
          r.events.map((ev) => ({
            id: ev.id,
            label: ev.label,
            starts_at_minutes: ev.starts_at_minutes,
            duration_minutes: ev.duration_minutes,
            location: ev.location,
            notes: ev.notes,
            is_key_moment: ev.is_key_moment,
          })),
        );
      })
      .catch(() => {});
    wishlistApi
      .list()
      .then((r) => {
        if (cancelled) return;
        setPreviewWishlist(
          r.items.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            kind: item.kind,
            target_amount_minor: item.target_amount_minor,
            currency: item.currency,
            url: item.url,
            image_url: item.image_url,
            interest_count: item.interest_count,
            pledged_amount_minor: item.pledged_amount_minor,
            viewer_has_interest: false,
            viewer_pledged_amount_minor: null,
          })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Key-order-proof dirty check: both sides pass through resolveDesign so a
  // reordered-but-equal blob never triggers a phantom PATCH.
  const dirty = useMemo(
    () => JSON.stringify(resolveDesign(design)) !== JSON.stringify(resolveDesign(saved)),
    [design, saved],
  );

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
          // Quiet ambient indicator instead of a toast per save.
          setSavedFlash(true);
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

  // The "Saved" flash clears itself after a beat, so the status line only
  // announces the settled transition (at most one SR announcement per edit).
  useEffect(() => {
    if (!savedFlash) return;
    const id = setTimeout(() => setSavedFlash(false), 2000);
    return () => clearTimeout(id);
  }, [savedFlash]);

  // Flush-on-leave: navigating away inside the 900ms debounce window used to
  // silently drop the last edit. Fire-and-forget the pending design on unmount.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const coupleLoadedRef = useRef(false);
  coupleLoadedRef.current = couple !== null;
  useEffect(() => {
    return () => {
      if (coupleLoadedRef.current && dirtyRef.current && !readOnlyRef.current) {
        coupleApi.update({ design: designRef.current }).catch(() => {});
      }
    };
  }, []);

  // Revoke the exact-PDF blob URL on unmount too (previously it was only
  // revoked on refetch / template switch, leaking the last object URL).
  const pdfPreviewUrlRef = useRef(pdfPreviewUrl);
  pdfPreviewUrlRef.current = pdfPreviewUrl;
  useEffect(() => {
    return () => {
      if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    };
  }, []);

  // The style-pack Undo pill is one-shot: it expires after 15s (any other
  // edit also clears it via the handlers below).
  useEffect(() => {
    if (!styleSnapshot) return;
    const id = setTimeout(() => setStyleSnapshot(null), 15000);
    return () => clearTimeout(id);
  }, [styleSnapshot]);

  // Focus + scroll management for the full-page preview overlay: it's a real
  // modal (portal below), so trap Tab inside, focus the close button on open,
  // lock body scroll, and restore focus on close. Escape still dismisses.
  const overlayRef = useRef<HTMLDivElement>(null);
  const overlayCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!fullPreview) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    overlayCloseRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setFullPreview(false);
        return;
      }
      if (ev.key !== "Tab") return;
      const root = overlayRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute("disabled"));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
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
    // The reset is destructive, so snapshot the outgoing design for the
    // one-shot Undo pill (comparison taps are the primary gesture here).
    setStyleSnapshot(designRef.current);
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
  function undoStyle() {
    if (!styleSnapshot) return;
    setDesign(styleSnapshot);
    setStyleSnapshot(null);
  }
  function choosePalette(slug: PaletteSlug) {
    setStyleSnapshot(null);
    // Re-picking a palette drops the per-role overrides, mirroring the style
    // reset semantics (the palette is the new base layer).
    setDesign((d) => ({ ...d, palette: slug, colors: {} }));
  }
  function chooseFonts(slug: FontPresetSlug) {
    setStyleSnapshot(null);
    // Picking a font preset clears the independent family overrides.
    setDesign((d) => ({ ...d, fonts: slug, headingFont: null, bodyFont: null }));
  }
  function chooseColor(role: ColorRole, hex: string) {
    setStyleSnapshot(null);
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
    setStyleSnapshot(null);
    setDesign((d) => ({ ...d, headingFont: slug }));
  }
  function chooseBodyFont(slug: FontFamilySlug | null) {
    setStyleSnapshot(null);
    setDesign((d) => ({ ...d, bodyFont: slug }));
  }
  function togglePrint(key: "border" | "ornament" | "qr") {
    setDesign((d) => ({ ...d, print: { ...d.print, [key]: !d.print[key] } }));
  }
  function chooseButtonStyle(slug: ButtonStyleSlug) {
    setStyleSnapshot(null);
    setDesign((d) => ({ ...d, web: { ...d.web, buttonStyle: slug } }));
  }
  function chooseImageTreatment(slug: ImageTreatmentSlug) {
    setStyleSnapshot(null);
    setDesign((d) => ({ ...d, web: { ...d.web, imageTreatment: slug } }));
  }
  function chooseCardRadius(slug: CardRadiusSlug) {
    setStyleSnapshot(null);
    setDesign((d) => ({ ...d, web: { ...d.web, cardRadius: slug } }));
  }
  function chooseShadow(slug: ShadowSlug) {
    setStyleSnapshot(null);
    setDesign((d) => ({ ...d, web: { ...d.web, shadow: slug } }));
  }
  function toggleSection(slug: WebsiteSectionSlug) {
    setStyleSnapshot(null);
    setDesign((d) => {
      const hiddenSections = d.web.hiddenSections.includes(slug)
        ? d.web.hiddenSections.filter((s) => s !== slug)
        : [...d.web.hiddenSections, slug];
      return { ...d, web: { ...d.web, hiddenSections } };
    });
  }
  function chooseMonogram(patch: Partial<CoupleDesign["monogram"]>) {
    setStyleSnapshot(null);
    setDesign((d) => ({ ...d, monogram: { ...d.monogram, ...patch } }));
  }
  function chooseVenueMap(on: boolean) {
    setStyleSnapshot(null);
    setDesign((d) => ({ ...d, web: { ...d.web, venueMap: on } }));
  }
  function chooseBorderStyle(slug: BorderStyleSlug) {
    // Keep the legacy `print.border` boolean in sync (on/off) so the current
    // PDF path stays consistent until pdf.ts reads the style directly.
    setDesign((d) => ({ ...d, borderStyle: slug, print: { ...d.print, border: slug !== "none" } }));
  }
  function chooseDateFormat(slug: (typeof DATE_FORMATS)[number]["slug"]) {
    setStyleSnapshot(null);
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

  // Chapter-summary readouts + shared control helpers (website tab).
  const activeFontPreset = getFontPreset(design.fonts);
  const effectiveHeadingFamily = design.headingFont ?? activeFontPreset.headingFamily;
  const effectiveBodyFamily = design.bodyFont ?? activeFontPreset.bodyFamily;
  const familyLabel = (slug: FontFamilySlug) =>
    t(FONT_FAMILIES.find((f) => f.slug === slug)?.nameKey ?? "design.family.cormorant");
  const roleHex: Record<ColorRole, string> = {
    primary: resolvedColors.primary,
    background: resolvedColors.background,
    accent: resolvedColors.accent,
    text: resolvedColors.text,
  };
  const hiddenCount = design.web.hiddenSections.length;
  // The monogram chips preview the couple's REAL initials; a sample "A & B"
  // covers the not-yet-named case so the chips never render empty.
  const monogramSpecimen = (slug: (typeof MONOGRAM_SEPARATORS)[number]["slug"]) =>
    buildMonogram(couple?.bride_name, couple?.groom_name, slug, locale) ||
    buildMonogram("A", "B", slug, locale);
  // Shared selectable-control classes so the chapters' chips + tiles read as
  // one system (mirrors PresetTile's ring-active state).
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
      active
        ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
        : "border-paper-300 bg-white text-ink-700 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
    }`;
  const specimenTileCls = (active: boolean) =>
    `flex items-center justify-center rounded-xl border bg-white px-2 py-2.5 text-ink-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:text-paper-50 dark:focus-visible:ring-paper-100 ${
      active
        ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
        : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
    }`;
  // The RSVP-button sample chips + mini wells render inside a `.wedding-theme`
  // scope fed the SAME resolved values the guest page gets, so the previews
  // are truthful (btn classes + fonts resolve exactly as on /w/:slug).
  const themedWellStyle = {
    "--wt-primary": resolvedColors.primary,
    "--wt-accent": resolvedColors.accent,
    "--wt-accent-text": resolvedColors.accent_text,
    "--wt-bg": resolvedColors.background,
    "--wt-text": resolvedColors.text,
    "--wt-heading-font": resolvedColors.heading_font,
    "--wt-body-font": resolvedColors.body_font,
    backgroundColor: resolvedColors.background,
  } as React.CSSProperties;
  const rsvpSampleClass = (slug: ButtonStyleSlug) =>
    slug === "outline" ? "btn-outline" : slug === "flat" ? "btn-primary" : "btn-primary btn-lifted";

  // Upload / clear one of the two optional fixed-slot site photos. The server
  // returns the refreshed couple, so the live preview updates immediately.
  async function uploadSitePhotoSlot(slot: 1 | 2, file: File) {
    if (photoBusy) return;
    setPhotoBusy(slot);
    try {
      const r = await coupleApi.uploadSitePhoto(slot, file);
      setCouple(r.couple);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 402
          ? t("design.save_blocked")
          : t("design.web.photo_upload_error"),
      );
    } finally {
      setPhotoBusy(null);
    }
  }
  async function removeSitePhoto(slot: 1 | 2) {
    if (photoBusy) return;
    setPhotoBusy(slot);
    try {
      const r = await coupleApi.deleteSitePhoto(slot);
      setCouple(r.couple);
    } catch {
      toast.error(t("design.save_error"));
    } finally {
      setPhotoBusy(null);
    }
  }
  const hasVenueCoords = couple?.location_lat != null && couple?.location_lng != null;

  // Copy the live guest-page URL (finish card, public sites only).
  async function copyGuestLink() {
    if (!couple?.slug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/w/${couple.slug}`);
      toast.success(t("design.finish.link_copied"));
    } catch {
      // Clipboard unavailable (permissions/insecure context): stay silent, the
      // visible URL in the View-live link still covers the share moment.
    }
  }

  // Labelled sample content for couples who haven't authored a schedule or
  // wishlist yet — without it the dark schedule band (the palette's most
  // dramatic expression) and the themed cards (the ONLY consumers of the
  // rounding + shadow controls) would never render while styling.
  const sampleSchedule = useMemo<PublicWeddingScheduleEntry[]>(
    () => [
      {
        id: -1,
        label: t("design.print_preview.sample_program.ceremony"),
        starts_at_minutes: 960,
        duration_minutes: null,
        location: null,
        notes: null,
        is_key_moment: true,
      },
      {
        id: -2,
        label: t("design.print_preview.sample_program.dinner"),
        starts_at_minutes: 1140,
        duration_minutes: null,
        location: null,
        notes: null,
        is_key_moment: true,
      },
      {
        id: -3,
        label: t("design.print_preview.sample_program.party"),
        starts_at_minutes: 1290,
        duration_minutes: null,
        location: null,
        notes: null,
        is_key_moment: true,
      },
    ],
    [t],
  );
  const sampleWishlist = useMemo<WishlistEntry[]>(
    () => [
      {
        id: -1,
        title: t("design.preview_sample.gift_1"),
        description: null,
        kind: "gift",
        target_amount_minor: null,
        currency: null,
        url: null,
        image_url: null,
        interest_count: 0,
        pledged_amount_minor: 0,
        viewer_has_interest: false,
        viewer_pledged_amount_minor: null,
      },
      {
        id: -2,
        title: t("design.preview_sample.gift_2"),
        description: null,
        kind: "gift",
        target_amount_minor: null,
        currency: null,
        url: null,
        image_url: null,
        interest_count: 0,
        pledged_amount_minor: 0,
        viewer_has_interest: false,
        viewer_pledged_amount_minor: null,
      },
    ],
    [t],
  );
  const usingSampleContent = previewSchedule.length === 0 || previewWishlist.length === 0;

  // Live guest-page preview through the SAME <WeddingSiteView> guests see, fed
  // the in-progress design so the couple watches the theme update as they pick.
  // Schedule + wishlist are the couple's REAL content (fetched once at mount),
  // degrading to the labelled samples above so the preview is never emptier
  // than what guests will actually see.
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
        site_image_1_url: couple.site_image_1_url,
        site_image_2_url: couple.site_image_2_url,
        guest_page_intro: couple.guest_page_intro,
        useful_info: couple.useful_info,
        // The embedded venue map only renders in the preview when the couple
        // turned the public-map toggle on (keeps leaflet out of the editor
        // bundle path otherwise, and mirrors what public visitors will see).
        location_lat: design.web.venueMap ? (couple.location_lat ?? null) : null,
        location_lng: design.web.venueMap ? (couple.location_lng ?? null) : null,
        location_radius_km: couple.location_radius_km,
        post_rsvp_content: null,
        schedule: previewSchedule.length > 0 ? previewSchedule : sampleSchedule,
        wishlist: previewWishlist.length > 0 ? previewWishlist : sampleWishlist,
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
  // Compact "A & B" used by the font-preset tiles — the full names wrap to two
  // lines and crowd the grid, while the initials still show off the typeface
  // (cap, ampersand) on a single tidy row.
  const sampleInitials =
    couple?.bride_name && couple?.groom_name
      ? `${[...couple.bride_name][0] ?? ""} & ${[...couple.groom_name][0] ?? ""}`
      : "A & B";

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
  // Real navigation semantics: these are URL sub-pages, not ARIA tabs, so the
  // switcher is a <nav> and the active link carries aria-current="page".
  const tabBtn = (key: "website" | "print", label: string) => (
    <Link
      to={`/app/design/${key}`}
      aria-current={tab === key ? "page" : undefined}
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
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-grotesk font-semibold tracking-tight">{t("design.title")}</h1>
          <InfoHint text={t("design.hint")} />
        </div>
        {/* Ambient save status (replaces the per-save success toast). Announced
            politely: only the settled "Saved" transition updates the text. */}
        <p
          role="status"
          aria-live="polite"
          className="flex min-h-5 items-center gap-1.5 text-xs text-ink-400 dark:text-umber-300"
        >
          {saving ? (
            <>
              <Loader2 size={12} className="animate-spin" aria-hidden />
              {t("design.saving")}
            </>
          ) : savedFlash ? (
            <>
              <Check size={12} aria-hidden />
              {t("design.saved")}
            </>
          ) : readOnly ? (
            t("design.save_blocked")
          ) : null}
        </p>
      </header>

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
            <nav
              data-tour-target="design-tabs"
              aria-label={t("design.title")}
              className="flex w-full items-center gap-1 rounded-full border border-paper-300 bg-white p-1 dark:border-umber-700 dark:bg-umber-800"
            >
              {tabBtn("website", t("design.tab.website"))}
              {tabBtn("print", t("design.tab.print"))}
            </nav>

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
                <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
                  {t("design.print_preview.content_hint")}{" "}
                  <Link
                    to="/app/guest-page"
                    className="font-medium text-ink-700 underline-offset-2 hover:text-ink-900 hover:underline dark:text-paper-100 dark:hover:text-paper-50"
                  >
                    {t("design.print_preview.content_change")}
                  </Link>
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
                {/* ── Chapter 01 — Style: the packs + the palette picker. ── */}
                <Chapter
                  num="01"
                  title={t("design.group.style")}
                  defaultOpen={true}
                  readout={
                    <span className="flex items-center gap-2">
                      <span className="hidden text-xs text-ink-500 sm:inline dark:text-umber-300">
                        {t(getStylePreset(design.style).nameKey)}
                      </span>
                      <span className="flex gap-1" aria-hidden>
                        {COLOR_ROLES.map((role) => (
                          <span
                            key={role}
                            className="h-3 w-3 rounded-full ring-1 ring-black/10 dark:ring-white/20"
                            style={{ backgroundColor: roleHex[role] }}
                          />
                        ))}
                      </span>
                    </span>
                  }
                >
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
                            sampleDate={formatWeddingDate(
                              sampleDateIso,
                              s.defaultDateFormat,
                              locale,
                            )}
                          />
                        </PresetTile>
                      ))}
                    </div>
                    {/* One-shot undo after a pack switch: the switch reseeds
                        palette/fonts/date/chrome, so comparison taps must be
                        reversible. Cleared by any other edit or after 15s. */}
                    {styleSnapshot && (
                      <button
                        type="button"
                        onClick={undoStyle}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-paper-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600 dark:focus-visible:ring-paper-100"
                      >
                        <Undo2 size={12} aria-hidden />
                        {t("design.undo")}
                      </button>
                    )}
                  </section>

                  {/* Colour palette — every curated palette, the four pack
                      palettes first, the legacy catalog behind a divider. A
                      palette re-tints every role the couple hasn't pinned. */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.section.palette")}
                    </h2>
                    {/* Swatch-only tiles: the colours ARE the label (name in
                        tooltip + aria-label), so 4-up / 5-up grids stay calm. */}
                    <div className="grid grid-cols-4 gap-2">
                      {PALETTES.slice(0, 4).map((p) => (
                        <PresetTile
                          key={p.slug}
                          compact
                          active={design.palette === p.slug}
                          onSelect={() => choosePalette(p.slug)}
                          ariaLabel={t(p.nameKey)}
                        >
                          <span
                            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-black/5 dark:border-white/10"
                            style={{ backgroundColor: p.background.hex }}
                            aria-hidden
                          >
                            <span
                              className="h-4 w-4 rounded-full"
                              style={{ backgroundColor: p.primary.hex }}
                            />
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: p.accent.hex }}
                            />
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: p.text.hex }}
                            />
                          </span>
                        </PresetTile>
                      ))}
                    </div>
                    <p className="mb-2 mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400 dark:text-umber-300">
                      <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
                      {t("design.section.palette_more")}
                      <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
                    </p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {PALETTES.slice(4).map((p) => (
                        <PresetTile
                          key={p.slug}
                          compact
                          active={design.palette === p.slug}
                          onSelect={() => choosePalette(p.slug)}
                          ariaLabel={t(p.nameKey)}
                        >
                          <span
                            className="flex h-10 w-full items-center justify-center gap-1 rounded-lg border border-black/5 dark:border-white/10"
                            style={{ backgroundColor: p.background.hex }}
                            aria-hidden
                          >
                            <span
                              className="h-3.5 w-3.5 rounded-full"
                              style={{ backgroundColor: p.primary.hex }}
                            />
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: p.accent.hex }}
                            />
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: p.text.hex }}
                            />
                          </span>
                        </PresetTile>
                      ))}
                    </div>
                  </section>
                </Chapter>

                {/* ── Chapter 02 — Typography: presets, families, date. ──── */}
                <Chapter
                  num="02"
                  title={t("design.group.typography")}
                  defaultOpen={lgUp}
                  readout={
                    <span className="hidden max-w-40 truncate text-xs text-ink-500 sm:inline dark:text-umber-300">
                      {familyLabel(effectiveHeadingFamily)} · {familyLabel(effectiveBodyFamily)}
                    </span>
                  }
                >
                  {/* Fonts */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.section.fonts")}
                    </h2>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {FONT_PRESETS.map((f) => (
                        <PresetTile
                          key={f.slug}
                          active={design.fonts === f.slug}
                          onSelect={() => chooseFonts(f.slug)}
                          ariaLabel={t(f.nameKey)}
                        >
                          <span
                            className="block truncate text-2xl leading-tight text-ink-900 dark:text-paper-50"
                            style={{ fontFamily: f.headingStack }}
                            aria-hidden
                          >
                            {sampleInitials}
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
                            {/* Six-up so all twelve families fit in two rows per
                              category (heading + body), cutting the picker's
                              height roughly in half — the "Aa" itself is the
                              preview; the full family name lives in the tooltip
                              + aria-label since it would truncate at this width. */}
                            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                              {FONT_FAMILIES.map((fam) => (
                                <FontChip
                                  key={fam.slug}
                                  active={effective === fam.slug}
                                  // Re-selecting the preset's family clears the override
                                  // (null) so it keeps tracking later preset changes.
                                  onClick={() =>
                                    setter(fam.slug === presetFamily ? null : fam.slug)
                                  }
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

                  {/* Date format — a 2×2 grid so every option gets equal weight
                   *  (the old 3-up grid orphaned the 4th tile on its own row). Each
                   *  tile leads with the formatted sample date and captions it with
                   *  the format's name, so the choices read as one unified set. */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.section.date")}
                    </h2>
                    <div className="grid grid-cols-2 gap-2.5">
                      {DATE_FORMATS.map((df) => {
                        const active = design.dateFormat === df.slug;
                        return (
                          <button
                            key={df.slug}
                            type="button"
                            onClick={() => chooseDateFormat(df.slug)}
                            aria-pressed={active}
                            aria-label={t(df.nameKey)}
                            className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-white px-3 py-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:focus-visible:ring-paper-100 ${
                              active
                                ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
                                : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
                            }`}
                          >
                            {active && (
                              <span
                                className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                                aria-hidden
                              >
                                <Check size={10} strokeWidth={3} />
                              </span>
                            )}
                            {/* The sample date renders in the couple's RESOLVED
                              heading font + pack treatment (not a hardcoded
                              italic serif) so a Monochrome couple isn't picking
                              between four alien italic dates. */}
                            <span
                              className="w-full whitespace-nowrap text-base leading-tight tracking-tight text-ink-900 dark:text-paper-50"
                              style={{
                                fontFamily: resolvedColors.heading_font,
                                ...headingTreatmentCss(resolvedColors.heading_style),
                              }}
                              aria-hidden
                            >
                              {formatWeddingDate(sampleDateIso, df.slug, locale)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </Chapter>

                {/* ── Chapter 03 — Details: monogram, chrome, sections, and
                    the demoted freeform colour overrides. ─────────────────── */}
                <Chapter
                  num="03"
                  title={t("design.group.details")}
                  defaultOpen={lgUp}
                  readout={
                    hiddenCount > 0 ? (
                      <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] font-medium text-ink-600 dark:bg-umber-800 dark:text-umber-200">
                        {hiddenCount}
                      </span>
                    ) : undefined
                  }
                >
                  {/* Monogram — the chips ARE the specimen: the couple's real
                      initials in the resolved heading font, per separator. */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.section.monogram")}
                    </h2>
                    <div className="rounded-2xl border border-paper-300 bg-white p-3 dark:border-umber-700 dark:bg-umber-800">
                      <button
                        type="button"
                        onClick={() => chooseMonogram({ enabled: !design.monogram.enabled })}
                        aria-pressed={design.monogram.enabled}
                        className={chipCls(design.monogram.enabled)}
                      >
                        {design.monogram.enabled && <Check size={12} strokeWidth={3} aria-hidden />}
                        {t("design.monogram.enable")}
                      </button>
                      {design.monogram.enabled && (
                        <div className="mt-3">
                          <div className="grid grid-cols-4 gap-1.5">
                            {MONOGRAM_SEPARATORS.map((sep) => {
                              const active = design.monogram.separator === sep.slug;
                              return (
                                <button
                                  key={sep.slug}
                                  type="button"
                                  onClick={() => chooseMonogram({ separator: sep.slug })}
                                  aria-pressed={active}
                                  aria-label={monogramSpecimen(sep.slug)}
                                  className={specimenTileCls(active)}
                                >
                                  <span
                                    className="whitespace-nowrap text-lg leading-none"
                                    style={{ fontFamily: resolvedColors.heading_font }}
                                    aria-hidden
                                  >
                                    {monogramSpecimen(sep.slug)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* RSVP button look — each tile is the ACTUAL button class on
                      a mini well painted with the resolved palette. */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.web.button_style_label")}
                    </h2>
                    <div className="grid grid-cols-3 gap-2">
                      {BUTTON_STYLES.map((b) => {
                        const active = design.web.buttonStyle === b.slug;
                        return (
                          <PresetTile
                            key={b.slug}
                            compact
                            active={active}
                            onSelect={() => chooseButtonStyle(b.slug)}
                            ariaLabel={t(b.nameKey)}
                            label={t(b.nameKey)}
                          >
                            <span
                              className="wedding-theme pointer-events-none flex h-12 w-full items-center justify-center overflow-hidden rounded-lg border border-black/5 dark:border-white/10"
                              style={themedWellStyle}
                              aria-hidden
                            >
                              <span
                                className={`${rsvpSampleClass(b.slug)} scale-[0.72] whitespace-nowrap`}
                              >
                                {t("wedding_site.rsvp_cta")}
                              </span>
                            </span>
                          </PresetTile>
                        );
                      })}
                    </div>
                  </section>

                  {/* Photo treatment — the couple's real cover (or a palette
                      swatch) shown in colour vs desaturated, so the tiles show
                      the treatment instead of naming it. */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.web.image_treatment_label")}
                    </h2>
                    <div className="grid grid-cols-2 gap-2">
                      {IMAGE_TREATMENTS.map((it) => {
                        const active = design.web.imageTreatment === it.slug;
                        const filter = it.slug === "grayscale" ? "grayscale(1)" : "none";
                        return (
                          <PresetTile
                            key={it.slug}
                            compact
                            active={active}
                            onSelect={() => chooseImageTreatment(it.slug)}
                            ariaLabel={t(it.nameKey)}
                            label={t(it.nameKey)}
                          >
                            {couple?.cover_image_url ? (
                              <img
                                src={couple.cover_image_url}
                                alt=""
                                className="h-14 w-full rounded-lg object-cover"
                                style={{ filter }}
                                aria-hidden
                              />
                            ) : (
                              <span
                                className="h-14 w-full rounded-lg"
                                style={{
                                  background: `linear-gradient(135deg, ${resolvedColors.primary}, ${resolvedColors.accent})`,
                                  filter,
                                }}
                                aria-hidden
                              />
                            )}
                          </PresetTile>
                        );
                      })}
                    </div>
                    {/* Two OPTIONAL fixed-slot photos: slot 1 lands after the
                        welcome band, slot 2 before the RSVP ask. Upload swaps
                        the tile to the image with a remove badge. */}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {([1, 2] as const).map((slot) => {
                        const url =
                          slot === 1 ? couple?.site_image_1_url : couple?.site_image_2_url;
                        const busy = photoBusy === slot;
                        return (
                          <div key={slot} className="relative">
                            {url ? (
                              <>
                                <img
                                  src={url}
                                  alt={t("design.web.photo_slot", { n: slot })}
                                  className="h-20 w-full rounded-xl border border-paper-300 object-cover dark:border-umber-700"
                                />
                                <button
                                  type="button"
                                  onClick={() => void removeSitePhoto(slot)}
                                  disabled={busy}
                                  aria-label={t("design.web.photo_remove")}
                                  className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-paper-200 bg-white text-ink-700 shadow-soft transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:focus-visible:ring-paper-100"
                                >
                                  {busy ? (
                                    <Loader2 size={12} className="animate-spin" aria-hidden />
                                  ) : (
                                    <X size={12} aria-hidden />
                                  )}
                                </button>
                              </>
                            ) : (
                              <label
                                className={`flex h-20 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-paper-400 text-ink-400 transition focus-within:ring-2 focus-within:ring-ink-300 hover:border-ink-400 hover:text-ink-600 dark:border-umber-600 dark:text-umber-300 dark:focus-within:ring-paper-100 dark:hover:text-umber-100 ${
                                  busy || readOnly ? "cursor-default opacity-60" : ""
                                }`}
                              >
                                {busy ? (
                                  <Loader2 size={16} className="animate-spin" aria-hidden />
                                ) : (
                                  <ImagePlus size={16} aria-hidden />
                                )}
                                <span className="text-[10px] font-medium">
                                  {t("design.web.photo_slot", { n: slot })}
                                </span>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="sr-only"
                                  disabled={busy || readOnly}
                                  onChange={(ev) => {
                                    const f = ev.target.files?.[0];
                                    if (f) void uploadSitePhotoSlot(slot, f);
                                    ev.target.value = "";
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Card rounding — true mini-card shapes in the palette. */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.web.card_radius_label")}
                    </h2>
                    <div className="grid grid-cols-3 gap-2">
                      {CARD_RADII.map((r) => {
                        const active = design.web.cardRadius === r.slug;
                        return (
                          <PresetTile
                            key={r.slug}
                            compact
                            active={active}
                            onSelect={() => chooseCardRadius(r.slug)}
                            ariaLabel={t(r.nameKey)}
                            label={t(r.nameKey)}
                          >
                            <span
                              className="flex h-12 w-full items-center justify-center rounded-lg bg-paper-100 dark:bg-umber-900"
                              aria-hidden
                            >
                              <span
                                className="h-8 w-16 border bg-white dark:bg-umber-800"
                                style={{
                                  borderRadius: r.css,
                                  borderColor: resolvedColors.accent,
                                }}
                              />
                            </span>
                          </PresetTile>
                        );
                      })}
                    </div>
                  </section>

                  {/* Card shadow — the actual box-shadow on a mini card. */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.web.shadow_label")}
                    </h2>
                    <div className="grid grid-cols-3 gap-2">
                      {SHADOWS.map((s) => {
                        const active = design.web.shadow === s.slug;
                        return (
                          <PresetTile
                            key={s.slug}
                            compact
                            active={active}
                            onSelect={() => chooseShadow(s.slug)}
                            ariaLabel={t(s.nameKey)}
                            label={t(s.nameKey)}
                          >
                            <span
                              className="flex h-12 w-full items-center justify-center rounded-lg bg-paper-100 dark:bg-umber-900"
                              aria-hidden
                            >
                              <span
                                className="h-8 w-16 rounded-lg border border-paper-200 bg-white dark:border-umber-700 dark:bg-umber-800"
                                style={{ boxShadow: s.css }}
                              />
                            </span>
                          </PresetTile>
                        );
                      })}
                    </div>
                  </section>

                  {/* Visible sections — hide/show the optional guest-page
                      blocks. Hiding is real and immediate in the preview. */}
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t("design.web.sections_label")}
                    </h2>
                    <ul className="divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-white dark:divide-umber-700 dark:border-umber-700 dark:bg-umber-800">
                      {WEBSITE_SECTIONS.map((s) => {
                        const hidden = design.web.hiddenSections.includes(s.slug);
                        return (
                          <li
                            key={s.slug}
                            className="flex items-center justify-between gap-3 px-3 py-1.5"
                          >
                            <span
                              className={`text-sm ${
                                hidden
                                  ? "text-ink-400 line-through decoration-ink-300 dark:text-umber-400 dark:decoration-umber-600"
                                  : "text-ink-900 dark:text-paper-50"
                              }`}
                            >
                              {t(s.nameKey)}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleSection(s.slug)}
                              aria-pressed={!hidden}
                              aria-label={t(s.nameKey)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-600 transition hover:bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:text-umber-200 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
                            >
                              {hidden ? (
                                <EyeOff size={16} aria-hidden />
                              ) : (
                                <Eye size={16} aria-hidden />
                              )}
                            </button>
                          </li>
                        );
                      })}
                      {/* Public venue map opt-in: reveals the exact pin (and
                          the embedded map) to everyone, not just confirmed
                          guests. Disabled until the couple has set a venue
                          location; the reveal is server-gated. */}
                      <li className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <span
                          className={`text-sm ${
                            design.web.venueMap
                              ? "text-ink-900 dark:text-paper-50"
                              : "text-ink-400 dark:text-umber-400"
                          }`}
                        >
                          {t("design.web.venue_map_label")}
                        </span>
                        <button
                          type="button"
                          onClick={() => chooseVenueMap(!design.web.venueMap)}
                          disabled={!hasVenueCoords}
                          aria-pressed={design.web.venueMap}
                          aria-label={t("design.web.venue_map_label")}
                          title={
                            hasVenueCoords ? undefined : t("design.web.venue_map_needs_location")
                          }
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-600 transition hover:bg-paper-100 disabled:cursor-default disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:text-umber-200 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
                        >
                          {design.web.venueMap ? (
                            <Eye size={16} aria-hidden />
                          ) : (
                            <EyeOff size={16} aria-hidden />
                          )}
                        </button>
                      </li>
                    </ul>
                  </section>

                  {/* Advanced: freeform per-role colour overrides, demoted to a
                      collapsed disclosure. The palette picker above is the
                      curated colour path; raw hex is the escape hatch. */}
                  <details className="rounded-2xl border border-paper-200 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900">
                    <summary className="cursor-pointer text-sm font-medium text-ink-700 dark:text-paper-100">
                      {t("design.colors.advanced_label")}
                    </summary>
                    <div className="mt-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <InfoHint text={t("design.colors.hint")} />
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-white px-2 py-0.5 text-[11px] font-medium text-ink-600 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-200">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: activePalette.accent.hex }}
                            aria-hidden
                          />
                          {t("design.colors.base_label")} {t(activePalette.nameKey)}
                        </span>
                      </div>
                      {/* Swatch row: each role is a colour block with a pencil
                          badge; clicking opens the native colour editor (the
                          swatch IS the input label, with a focus-within ring
                          for keyboard users). */}
                      <div className="flex flex-wrap gap-4">
                        {COLOR_ROLES.map((role) => {
                          const resolved = design.colors[role] ?? activePalette[role].hex;
                          const overridden = design.colors[role] !== undefined;
                          return (
                            <div key={role} className="flex flex-col items-center gap-1">
                              <label
                                className="relative block h-12 w-12 cursor-pointer rounded-xl border border-paper-300 shadow-soft focus-within:ring-2 focus-within:ring-ink-300 dark:border-umber-700 dark:focus-within:ring-paper-100"
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
                              {/* Fixed-height reset row so toggling an override
                                  never shifts the grid. */}
                              <span className="flex h-6 items-center gap-1">
                                {overridden && (
                                  <>
                                    <span
                                      className="h-3 w-3 rounded-full border border-paper-300 dark:border-umber-700"
                                      style={{ backgroundColor: activePalette[role].hex }}
                                      title={`${t("design.colors.original")}: ${activePalette[role].hex}`}
                                      aria-hidden
                                    />
                                    <button
                                      type="button"
                                      onClick={() => clearColor(role)}
                                      className="px-1 py-0.5 text-[10px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
                                    >
                                      {t("design.colors.reset")}
                                    </button>
                                  </>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {lowContrast && (
                        <p
                          role="status"
                          className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
                        >
                          <AlertTriangle size={12} aria-hidden />
                          {t("design.colors.low_contrast")}
                          {Object.keys(design.colors).length > 0 && (
                            <button
                              type="button"
                              onClick={() => setDesign((d) => ({ ...d, colors: {} }))}
                              className="font-medium underline underline-offset-2"
                            >
                              {t("design.colors.fix_contrast")}
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                  </details>
                </Chapter>

                {/* ── Finish line — see it big, then publish / share it. ──── */}
                <div className="rounded-2xl border border-paper-300 bg-white p-4 dark:border-umber-700 dark:bg-umber-800">
                  <h2 className="font-serif text-xl italic tracking-tight text-ink-900 dark:text-paper-50">
                    {t("design.finish.title")}
                  </h2>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFullPreview(true)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-paper-300 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-paper-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600 dark:focus-visible:ring-paper-100"
                    >
                      <Maximize2 size={14} aria-hidden />
                      {t("design.full_preview")}
                    </button>
                    {couple?.slug && couple.is_public === false && (
                      <Link
                        to="/app/guest-page"
                        className="inline-flex items-center justify-center gap-1.5 rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-paper-50 transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-200 dark:focus-visible:ring-paper-100"
                      >
                        {t("design.publish_cta_button")}
                      </Link>
                    )}
                    {couple?.slug && couple.is_public && (
                      <>
                        <a
                          href={`/w/${couple.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-paper-50 transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-200 dark:focus-visible:ring-paper-100"
                        >
                          <ExternalLink size={14} aria-hidden />
                          {t("design.finish.view_live")}
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyGuestLink()}
                          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-paper-300 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-paper-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600 dark:focus-visible:ring-paper-100"
                        >
                          <Copy size={14} aria-hidden />
                          {t("design.finish.copy_link")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {tab === "website" ? null : (
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
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-200">
                      {t("design.preview_label")}
                    </p>
                    {usingSampleContent && (
                      <span className="rounded-full border border-paper-300 bg-paper-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-300">
                        {t("design.preview_sample_chip")}
                      </span>
                    )}
                  </div>
                  {previewView && (
                    <div className="flex items-center gap-1.5">
                      {/* Inline viewport toggle: couples design for their
                          guests' phones, so phone-width is one click, not a
                          full-screen detour. Shares state with the overlay. */}
                      <div className="flex items-center gap-0.5 rounded-full border border-paper-300 p-0.5 dark:border-umber-700">
                        {(["mobile", "desktop"] as const).map((vp) => {
                          const active = previewViewport === vp;
                          const Icon = vp === "mobile" ? Smartphone : Monitor;
                          return (
                            <button
                              key={vp}
                              type="button"
                              onClick={() => setPreviewViewport(vp)}
                              aria-pressed={active}
                              aria-label={t(
                                vp === "mobile"
                                  ? "design.preview_mobile"
                                  : "design.preview_desktop",
                              )}
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                                active
                                  ? "bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                                  : "text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                              }`}
                            >
                              <Icon size={13} aria-hidden />
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => setFullPreview(true)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-paper-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-paper-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600 dark:focus-visible:ring-paper-100"
                      >
                        <Maximize2 size={14} aria-hidden />
                        {t("design.full_preview")}
                      </button>
                    </div>
                  )}
                </div>
                {previewView && (
                  <div
                    className={
                      previewViewport === "mobile"
                        ? "rounded-2xl border border-paper-200 bg-paper-100 p-4 dark:border-umber-700 dark:bg-umber-900"
                        : "overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700"
                    }
                  >
                    {/* Full guest page, edge-to-edge so the editorial light/dark
                        bands reach the frame. Below lg it scrolls with the page;
                        on lg+ the sticky aside caps to the viewport and scrolls
                        internally so the whole page stays reachable. The inner
                        wrapper is inert: the preview is a look-check, so its
                        links/buttons must not join the editor's tab order. */}
                    <div className="lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
                      <div
                        inert
                        className={
                          previewViewport === "mobile"
                            ? "mx-auto max-w-[390px] overflow-hidden rounded-xl border border-paper-200 shadow-soft dark:border-umber-700"
                            : undefined
                        }
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
                    <p className="sr-only">{t("design.preview_sr_note")}</p>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {/* Mobile: below lg the preview column stacks under the whole editor, so
          phones would design blind. A floating pill opens the full-screen
          preview, defaulting to the phone frame at editor-stacked widths. */}
      {tab === "website" && !loading && previewView && !fullPreview && (
        <button
          type="button"
          onClick={() => {
            if (
              typeof window.matchMedia === "function" &&
              window.matchMedia("(max-width: 1023px)").matches
            ) {
              setPreviewViewport("mobile");
            }
            setFullPreview(true);
          }}
          className="fixed bottom-20 right-4 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-ink-900 px-5 text-sm font-medium text-paper-50 shadow-pop transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 md:bottom-6 lg:hidden dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-200 dark:focus-visible:ring-paper-100"
        >
          <Eye size={16} aria-hidden />
          {t("design.preview_open")}
        </button>
      )}

      {/* Full-page guest-page preview overlay — the SAME previewView through
          <WeddingSiteView>, framed at a mobile or desktop width via the header
          toggle. A real modal: portal to <body>, focus trapped (effect above),
          body scroll locked, Escape or the close button dismiss it. */}
      {fullPreview &&
        previewView &&
        createPortal(
          <div
            ref={overlayRef}
            className="fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur-md"
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
                ref={overlayCloseRef}
                onClick={() => setFullPreview(false)}
                aria-label={t("design.preview_close")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <X size={18} aria-hidden />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-2 pb-6 sm:px-4">
              <div
                inert
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
          </div>,
          document.body,
        )}
    </>
  );
}
