// /app/design — the wedding visual-identity editor. A curated, controlled
// design system (NOT a freeform editor): the couple picks one Wedding Style,
// one Colour Palette and one Font preset from fixed catalogs, plus a few print
// toggles. The selection persists on `couples.design_json` and drives the
// guest page (live preview below) + the printable cards. The concrete colours
// and font stacks all come from `@shared/design`, so the picker and the guest
// page can never drift.

import {
  applyStylePreset,
  BORDER_STYLES,
  CARD_FEELS,
  type CardFeelSlug,
  getCardFeel,
  type BorderStyleSlug,
  buildMonogram,
  getBorderCss,
  COLOR_ROLES,
  type ColorRole,
  type CoupleDesign,
  DATE_FORMATS,
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
  ImagePlus,
  Loader2,
  Maximize2,
  Monitor,
  Pencil,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InfoHint } from "../components/InfoHint";
import { LookBar } from "../components/design/LookBar";
import { PhotoDock } from "../components/design/PhotoDock";
import { PrintShelf } from "../components/design/PrintShelf";
import { ProofCard } from "../components/design/ProofCard";
import { TuneRail, TuneRow, type TuneRowId, TuneSwitchRow } from "../components/design/TuneRow";
import { PaletteBar, roleColors } from "../components/design/PaletteBar";
import { SampleTable } from "../components/design/SampleTable";
import { headingTreatmentCss, OrnamentDivider } from "../components/ornaments";
import { PrintCardPreview, type PrintTemplate } from "../components/PrintCardPreview";
import { WeddingSiteView } from "../components/WeddingSiteView";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Switch, useConfirm, useToast } from "../components/ui";
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

/** Share/publish actions render icon-first and stay collapsed to just the
 *  glyph; the label slides open inline when you hover or keyboard-focus the
 *  button (the pill itself widens — no floating tooltip). `!gap-0` kills the
 *  base `.btn` gap so the collapsed state hugs the icon; the label carries its
 *  own left margin only once expanded. */
const expandBtn = "group !gap-0";
const expandLabel =
  "max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-out group-hover:ml-2 group-hover:max-w-[12rem] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[12rem] group-focus-visible:opacity-100";

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

export default function DesignPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();

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
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
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
  // palette/fonts/date/chrome (destructive), so the Look Bar carries an Undo
  // that restores the pre-switch design. It does NOT expire and is NOT cleared
  // by later edits: a couple who tries a pack, tweaks two things and then wants
  // their old world back was the whole reason the snapshot exists.
  const [styleSnapshot, setStyleSnapshot] = useState<CoupleDesign | null>(null);
  // Is the Sample Table expanded? It opens by default only for a couple who has
  // never committed a look, so a returning couple lands on their own identity
  // rather than on the picker they already used.
  const [styleTableOpen, setStyleTableOpen] = useState(false);
  // Exactly one fine-tune row is open at a time. Mirrored into location.hash so
  // "/app/design/website#sections" is a valid answer to a support question and
  // the back button closes a swap.
  const [openRow, setOpenRow] = useState<TuneRowId | null>(null);
  // The design as it was when the current row opened, so the row can show a
  // truthful before/now pair and offer a one-tap revert.
  const [rowBefore, setRowBefore] = useState<CoupleDesign | null>(null);
  // Truthful preview data: the couple's real schedule + wishlist so the dark
  // schedule band and the themed cards actually render while styling. Empty
  // until fetched; the preview falls back to labelled sample beats.
  const [previewSchedule, setPreviewSchedule] = useState<PublicWeddingScheduleEntry[]>([]);
  const [previewWishlist, setPreviewWishlist] = useState<WishlistEntry[]>([]);
  // Which photo slot has an upload/delete in flight (1 | 2 | null).
  const [photoBusy, setPhotoBusy] = useState<1 | 2 | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
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
        // A couple still sitting on the untouched default has never made the
        // one decision this page is about, so open the Sample Table for them.
        setStyleTableOpen(
          JSON.stringify(resolveDesign(r.couple.design)) === JSON.stringify(resolveDesign(null)),
        );
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

  // Deep link: a hash names an open fine-tune row. Landing on
  // /app/design/website#sections opens that row and scrolls to it, and the
  // browser back button closes an open swap.
  useEffect(() => {
    const id = hash.replace("#", "") as TuneRowId | "";
    if (!id) {
      setOpenRow(null);
      return;
    }
    setOpenRow((prev) => {
      if (prev === id) return prev;
      setRowBefore(designRef.current);
      return id;
    });
    // Scroll only when the hash brought us here, not on every re-render.
    document.getElementById(`tune-${id}`)?.scrollIntoView({ block: "center" });
  }, [hash]);

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

  // Picking a style commits a whole world (palette, type pairing, date format,
  // frame, button chrome, corners, shadow, photo treatment). That is the point:
  // it is the only bold decision on the page. Because it also DISCARDS any
  // hand-set colours or typefaces, a couple who has customised is asked first.
  async function chooseStyle(slug: StylePresetSlug) {
    if (slug === designRef.current.style) {
      setStyleTableOpen(false);
      return;
    }
    const d = designRef.current;
    const customised =
      Object.keys(d.colors).length > 0 || d.headingFont !== null || d.bodyFont !== null;
    if (customised) {
      const ok = await confirm({
        title: t("design.style_switch_confirm.title"),
        body: t("design.style_switch_confirm.body"),
        confirmLabel: t("design.style_switch_confirm.confirm"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    // Snapshot the outgoing design so the Look Bar's Undo can restore it.
    // Comparison taps are the primary gesture here, so the snapshot has no
    // expiry: it survives until the next pack commit or an explicit undo.
    setStyleSnapshot(designRef.current);
    setDesign((prev) => applyStylePreset(prev, slug));
    setStyleTableOpen(false);
  }
  // Opening a row snapshots the design so the body can show a truthful
  // before/now pair, and pushes the row id into the hash so the swap is
  // linkable and the back button closes it.
  function toggleRow(id: TuneRowId) {
    const opening = openRow !== id;
    setRowBefore(opening ? designRef.current : null);
    setOpenRow(opening ? id : null);
    navigate({ hash: opening ? `#${id}` : "" }, { replace: !opening });
  }
  function revertRow() {
    if (!rowBefore) return;
    // Deliberately a plain setDesign, not draft state: the autosave effect is
    // guarded on `saving`, so a revert landing inside an in-flight PATCH is
    // simply scheduled after it resolves. The couple sees one extra save, not
    // a lost edit.
    setDesign(rowBefore);
  }
  function undoStyle() {
    if (!styleSnapshot) return;
    setDesign(styleSnapshot);
    setStyleSnapshot(null);
  }
  function choosePalette(slug: PaletteSlug) {
    // Re-picking a palette drops the per-role overrides, mirroring the style
    // reset semantics (the palette is the new base layer).
    setDesign((d) => ({ ...d, palette: slug, colors: {} }));
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
  function chooseImageTreatment(slug: ImageTreatmentSlug) {
    setDesign((d) => ({ ...d, web: { ...d.web, imageTreatment: slug } }));
  }
  // Corners and shadow used to be two independent three-way controls: nine
  // combinations, of which the four looks use exactly three, and eight of which
  // nobody could describe the difference between. One choice now, named after
  // what it feels like, seeded straight from the pack.
  function chooseCardFeel(slug: CardFeelSlug) {
    const feel = CARD_FEELS.find((f) => f.slug === slug);
    if (!feel) return;
    setDesign((d) => ({
      ...d,
      web: { ...d.web, cardRadius: feel.radius, shadow: feel.shadow },
    }));
  }
  function toggleSection(slug: WebsiteSectionSlug) {
    setDesign((d) => {
      const hiddenSections = d.web.hiddenSections.includes(slug)
        ? d.web.hiddenSections.filter((s) => s !== slug)
        : [...d.web.hiddenSections, slug];
      return { ...d, web: { ...d.web, hiddenSections } };
    });
  }
  // The venue map is opt-IN (not a hideable section): turning it on reveals the
  // exact venue to ANYONE with the page link, not just confirmed guests, so
  // enabling needs the couple's venue coords and an explicit confirm. Disabling
  // is safe and immediate. Same field + trust boundary as the guest-page
  // editor's privacy toggle (design.web.venueMap, server-gated in
  // routes/public_wedding.ts): this just surfaces it where sections are chosen.
  const hasVenueCoords = couple?.location_lat != null && couple?.location_lng != null;
  async function toggleVenueMap() {
    if (design.web.venueMap) {
      setDesign((d) => ({ ...d, web: { ...d.web, venueMap: false } }));
      return;
    }
    if (!hasVenueCoords) {
      toast.error(t("design.web.map_needs_location"));
      return;
    }
    const ok = await confirm({
      title: t("design.web.map_confirm_title"),
      body: t("design.web.map_confirm_body"),
      confirmLabel: t("design.web.map_confirm_cta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setDesign((d) => ({ ...d, web: { ...d.web, venueMap: true } }));
  }
  function chooseMonogram(patch: Partial<CoupleDesign["monogram"]>) {
    setDesign((d) => ({ ...d, monogram: { ...d.monogram, ...patch } }));
  }
  // One switch, both surfaces. These were two separate controls on two separate
  // tabs writing the same idea ("draw the decorative dividers"), and nobody
  // wants ornaments on the invitation but not the website.
  function chooseOrnaments(on: boolean) {
    setDesign((d) => ({
      ...d,
      web: { ...d.web, ornaments: on },
      print: { ...d.print, ornament: on },
    }));
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

  // Readouts + shared control helpers for the fine-tune list.
  const activeFontPreset = getFontPreset(design.fonts);
  const effectiveHeadingFamily = design.headingFont ?? activeFontPreset.headingFamily;
  const paletteRoleColors = roleColors(resolvedColors);
  const overriddenRoles: Partial<Record<ColorRole, boolean>> = {
    primary: design.colors.primary !== undefined,
    background: design.colors.background !== undefined,
    accent: design.colors.accent !== undefined,
    text: design.colors.text !== undefined,
  };
  const customColorCount = Object.keys(design.colors).length;
  // Null when a stored blob carries a corner/shadow combination the editor no
  // longer offers, so no tile shows a selection ring it hasn't earned.
  const activeCardFeel = getCardFeel(design.web);
  const hiddenCount = design.web.hiddenSections.length;
  // The monogram chips preview the couple's REAL initials; a sample "A & B"
  // covers the not-yet-named case so the chips never render empty.
  const monogramSpecimen = (slug: (typeof MONOGRAM_SEPARATORS)[number]["slug"]) =>
    buildMonogram(couple?.bride_name, couple?.groom_name, slug, locale) ||
    buildMonogram("A", "B", slug, locale);
  // Selection is always a ring plus a badge, never an inverted fill: every
  // selectable thing on this page is a specimen, and a fill would recolour the
  // very thing being judged.
  const specimenTileCls = (active: boolean) =>
    `flex items-center justify-center rounded-xl border bg-white px-2 py-2.5 text-ink-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:text-paper-50 dark:focus-visible:ring-paper-100 ${
      active
        ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
        : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
    }`;
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
  async function chooseSitePhotoPreset(slot: 1 | 2, slug: string) {
    if (photoBusy) return;
    setPhotoBusy(slot);
    try {
      const r = await coupleApi.chooseSitePhotoPreset(slot, slug);
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

  // The cover (hero) image. Same server-returns-the-couple contract as the site
  // photos, so the live preview updates in place. Removal PATCHes the field null.
  async function uploadCoverImage(file: File) {
    if (coverBusy) return;
    setCoverBusy(true);
    try {
      const r = await coupleApi.uploadCover(file);
      setCouple(r.couple);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 402
          ? t("design.save_blocked")
          : t("design.web.photo_upload_error"),
      );
    } finally {
      setCoverBusy(false);
    }
  }
  async function removeCoverImage() {
    if (coverBusy) return;
    setCoverBusy(true);
    try {
      const r = await coupleApi.update({ cover_image_url: null });
      setCouple(r.couple);
    } catch {
      toast.error(t("design.save_error"));
    } finally {
      setCoverBusy(false);
    }
  }

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
  // Memoized: this object used to be rebuilt on every render, which fully
  // reconciled the 1300-line <WeddingSiteView> on every single tap in the
  // editor. It only ever depends on the couple, the design and the two content
  // lists, none of which change while a tile is being hovered.
  const previewView: PublicWeddingWebsiteView | null = useMemo(
    () =>
      couple
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
        : null,
    [couple, design, previewSchedule, previewWishlist, sampleSchedule, sampleWishlist],
  );

  // The date a date-format tile previews: the couple's real date when set,
  // else a representative sample so the tiles always read meaningfully.
  const sampleDateIso = couple?.wedding_date ?? "2027-06-20";
  // Compact "A & B" used by the font-preset tiles — the full names wrap to two
  // lines and crowd the grid, while the initials still show off the typeface
  // (cap, ampersand) on a single tidy row.
  const sampleInitials =
    couple?.bride_name && couple?.groom_name
      ? `${[...couple.bride_name][0] ?? ""} & ${[...couple.groom_name][0] ?? ""}`
      : "A & B";
  // The three identity bits every ProofCard on the page needs, bundled so the
  // seven rows don't each thread four props through.
  const sampleCoupleName = t("design.print_preview.sample_couple");
  const previewCouple = {
    bride_name: couple?.bride_name ?? null,
    groom_name: couple?.groom_name ?? null,
    wedding_date: couple?.wedding_date ?? null,
  };

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
        <div className="space-y-6">
          {/* Surface switcher: Guest site vs Cards. Full-page width, above the
              editor/preview split, because it governs BOTH columns. */}
          <nav
            data-tour-target="design-tabs"
            aria-label={t("design.title")}
            className="flex w-full max-w-sm items-center gap-1 rounded-full border border-paper-300 bg-white p-1 dark:border-umber-700 dark:bg-umber-800"
          >
            {tabBtn("website", t("design.tab.website"))}
            {tabBtn("print", t("design.tab.print"))}
          </nav>

          {/* ── The committed look, and the table it was chosen from. Both
              surfaces share this: the identity is one decision, made once, and
              the Stamp keeps the other surface continuously in view. ─────── */}
          <LookBar
            design={design}
            lookName={t(getStylePreset(design.style).nameKey)}
            colors={roleColors(resolvedColors)}
            overridden={{
              primary: design.colors.primary !== undefined,
              background: design.colors.background !== undefined,
              accent: design.colors.accent !== undefined,
              text: design.colors.text !== undefined,
            }}
            headingFont={resolvedColors.heading_font}
            brideName={couple?.bride_name}
            groomName={couple?.groom_name}
            weddingDate={couple?.wedding_date}
            fallbackName={t("design.print_preview.sample_couple")}
            surface={tab}
            open={styleTableOpen}
            onToggle={() => setStyleTableOpen((o) => !o)}
            onUndo={styleSnapshot ? undoStyle : undefined}
            panelId="design-sample-table"
          />
          <SampleTable
            id="design-sample-table"
            open={styleTableOpen}
            design={design}
            onChoose={(slug) => void chooseStyle(slug)}
            brideName={couple?.bride_name}
            groomName={couple?.groom_name}
            weddingDate={couple?.wedding_date}
            fallbackName={t("design.print_preview.sample_couple")}
            designForStyle={(slug) => applyStylePreset(design, slug)}
          />

          <div className="grid gap-8 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
            {/* ── Left column: the editor. In print mode the card-type picker
                comes FIRST so the couple knows which physical card they're
                designing, then the card-specific controls. The big live canvas
                lives in the right column. ───────────────────────────────── */}
            <div className="space-y-6">
              {tab === "print" && (
                <PrintShelf
                  design={design}
                  selected={printTemplate}
                  onSelect={(tpl) => {
                    setPrintTemplate(tpl);
                    setPdfPreviewUrl((p) => {
                      if (p) URL.revokeObjectURL(p);
                      return null;
                    });
                  }}
                  brideName={couple?.bride_name ?? null}
                />
              )}

              {tab === "website" && (
                <>
                  <PhotoDock
                    slot1Url={couple?.site_image_1_url}
                    slot2Url={couple?.site_image_2_url}
                    coverUrl={couple?.cover_image_url}
                    treatment={design.web.imageTreatment}
                    onTreatment={chooseImageTreatment}
                    onUpload={(slot, file) => void uploadSitePhotoSlot(slot, file)}
                    onChoosePreset={(slot, slug) => void chooseSitePhotoPreset(slot, slug)}
                    onRemove={(slot) => void removeSitePhoto(slot)}
                    onCoverUpload={(file) => void uploadCoverImage(file)}
                    onCoverRemove={() => void removeCoverImage()}
                    coverBusy={coverBusy}
                    busySlot={photoBusy}
                    readOnly={readOnly}
                  />

                  {/* ── The fine-tune list. Seven rows, each showing its own
                      answer as a rendering rather than a word, one open at a
                      time. This replaced three accordion "chapters" holding
                      fourteen labelled option grids. ─────────────────────── */}
                  <section>
                    <p className="eyebrow mb-2">{t("design.tune.heading")}</p>
                    <div className="overflow-hidden rounded-2xl border border-paper-300 bg-white shadow-soft dark:border-umber-600 dark:bg-umber-800 dark:shadow-none">
                      <div className="divide-y divide-paper-200 dark:divide-umber-700">
                        {/* Colours. One rail of every palette: the old 4 + 11
                            tier split implied the first four were better, when
                            they were only the ones the packs happened to seed. */}
                        <TuneRow
                          id="colors"
                          label={t("design.tune.colors")}
                          value={
                            <PaletteBar
                              colors={paletteRoleColors}
                              overridden={overriddenRoles}
                              className="max-w-40"
                            />
                          }
                          open={openRow === "colors"}
                          onToggle={() => toggleRow("colors")}
                          before={rowBefore}
                          now={design}
                          onRevert={revertRow}
                          couple={previewCouple}
                          locale={locale}
                          fallbackName={sampleCoupleName}
                        >
                          <TuneRail>
                            {PALETTES.map((p) => {
                              const active = design.palette === p.slug;
                              return (
                                <button
                                  key={p.slug}
                                  type="button"
                                  onClick={() => choosePalette(p.slug)}
                                  aria-pressed={active}
                                  aria-label={t(p.nameKey)}
                                  title={t(p.nameKey)}
                                  className={`relative shrink-0 snap-start rounded-lg border p-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                                    active
                                      ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
                                      : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
                                  }`}
                                >
                                  <PaletteBar
                                    colors={{
                                      primary: p.primary.hex,
                                      background: p.background.hex,
                                      accent: p.accent.hex,
                                      text: p.text.hex,
                                    }}
                                    className="!h-8 !w-20 !rounded"
                                  />
                                </button>
                              );
                            })}
                          </TuneRail>

                          {/* Raw hex is the escape hatch, not the path. */}
                          <details className="rounded-xl border border-paper-300 bg-white px-3 py-2 dark:border-umber-700 dark:bg-umber-800">
                            <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-medium text-ink-700 dark:text-paper-100">
                              {t("design.colors_custom.open")}
                              {customColorCount > 0 && (
                                <span className="badge badge-paper">
                                  {t("design.colors_custom.count", { n: customColorCount })}
                                </span>
                              )}
                            </summary>
                            <div className="mt-3 flex flex-wrap gap-4">
                              {COLOR_ROLES.map((role) => {
                                const resolved = design.colors[role] ?? activePalette[role].hex;
                                const overridden = design.colors[role] !== undefined;
                                return (
                                  <div key={role} className="flex flex-col items-center gap-1">
                                    <label
                                      className="relative block h-12 w-12 cursor-pointer rounded-xl border border-paper-300 shadow-soft focus-within:ring-2 focus-within:ring-ink-300 dark:border-umber-700 dark:focus-within:ring-paper-100"
                                      style={{ backgroundColor: resolved }}
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
                                    {/* Fixed height so toggling an override
                                        never shifts the row. */}
                                    <span className="flex h-6 items-center gap-1">
                                      {overridden && (
                                        <button
                                          type="button"
                                          onClick={() => clearColor(role)}
                                          className="px-1 py-0.5 text-[10px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
                                        >
                                          {t("design.colors.reset")}
                                        </button>
                                      )}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {lowContrast && (
                              <p
                                role="status"
                                className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-blush-700 dark:text-blush-300"
                              >
                                <AlertTriangle size={12} aria-hidden />
                                {t("design.colors.low_contrast")}
                                {customColorCount > 0 && (
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
                          </details>
                        </TuneRow>

                        {/* Fonts. The value is the couple's names in the live
                            heading face, so the row IS the specimen. */}
                        <TuneRow
                          id="fonts"
                          label={t("design.tune.fonts")}
                          value={
                            <span
                              className="truncate text-sm text-ink-500 dark:text-umber-300"
                              style={{ fontFamily: resolvedColors.heading_font }}
                            >
                              {sampleInitials}
                            </span>
                          }
                          open={openRow === "fonts"}
                          onToggle={() => toggleRow("fonts")}
                          before={rowBefore}
                          now={design}
                          onRevert={revertRow}
                          couple={previewCouple}
                          locale={locale}
                          fallbackName={sampleCoupleName}
                        >
                          <TuneRail>
                            {FONT_PRESETS.map((f) => {
                              const active = design.fonts === f.slug;
                              return (
                                <button
                                  key={f.slug}
                                  type="button"
                                  onClick={() => chooseFonts(f.slug)}
                                  aria-pressed={active}
                                  aria-label={t(f.nameKey)}
                                  title={t(f.nameKey)}
                                  className={`flex h-14 w-24 shrink-0 snap-start items-center justify-center rounded-lg border bg-white px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:focus-visible:ring-paper-100 ${
                                    active
                                      ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
                                      : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
                                  }`}
                                >
                                  <span
                                    className="truncate text-xl leading-tight text-ink-900 dark:text-paper-50"
                                    style={{ fontFamily: f.headingStack }}
                                    aria-hidden
                                  >
                                    {sampleInitials}
                                  </span>
                                </button>
                              );
                            })}
                          </TuneRail>

                          {/* The heading face can be swapped independently of
                              the pairing. The body face cannot any more: it is
                              the half of a type pairing that a couple has no
                              way to judge in isolation, and every override we
                              saw broke the pairing it was overriding. */}
                          <details className="rounded-xl border border-paper-300 bg-white px-3 py-2 dark:border-umber-700 dark:bg-umber-800">
                            <summary className="cursor-pointer text-sm font-medium text-ink-700 dark:text-paper-100">
                              {t("design.font.heading_label")}
                            </summary>
                            <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                              {FONT_FAMILIES.map((fam) => (
                                <FontChip
                                  key={fam.slug}
                                  active={effectiveHeadingFamily === fam.slug}
                                  // Re-picking the pairing's own family clears
                                  // the override, so it keeps tracking later
                                  // pack changes instead of freezing.
                                  onClick={() =>
                                    chooseHeadingFont(
                                      fam.slug === activeFontPreset.headingFamily ? null : fam.slug,
                                    )
                                  }
                                  fontFamily={fam.stack}
                                  label={t(fam.nameKey)}
                                />
                              ))}
                            </div>
                          </details>
                        </TuneRow>

                        {/* Date. Every option renders the couple's real date. */}
                        <TuneRow
                          id="date"
                          label={t("design.tune.date")}
                          value={
                            <span
                              className="truncate text-sm text-ink-500 dark:text-umber-300"
                              style={{
                                fontFamily: resolvedColors.heading_font,
                                ...headingTreatmentCss(resolvedColors.heading_style),
                              }}
                            >
                              {formatWeddingDate(sampleDateIso, design.dateFormat, locale)}
                            </span>
                          }
                          open={openRow === "date"}
                          onToggle={() => toggleRow("date")}
                          before={rowBefore}
                          now={design}
                          onRevert={revertRow}
                          couple={previewCouple}
                          locale={locale}
                          fallbackName={sampleCoupleName}
                        >
                          <TuneRail>
                            {DATE_FORMATS.map((df) => {
                              const active = design.dateFormat === df.slug;
                              return (
                                <button
                                  key={df.slug}
                                  type="button"
                                  onClick={() => chooseDateFormat(df.slug)}
                                  aria-pressed={active}
                                  aria-label={t(df.nameKey)}
                                  title={t(df.nameKey)}
                                  className={`flex h-14 shrink-0 snap-start items-center justify-center whitespace-nowrap rounded-lg border bg-white px-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:focus-visible:ring-paper-100 ${
                                    active
                                      ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
                                      : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
                                  }`}
                                >
                                  <span
                                    className="text-base leading-tight text-ink-900 dark:text-paper-50"
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
                          </TuneRail>
                        </TuneRow>

                        {/* Monogram. The row value is the live monogram, and
                            the separators appear in place once it is on. */}
                        <TuneSwitchRow
                          label={t("design.tune.monogram")}
                          checked={design.monogram.enabled}
                          onChange={(on) => chooseMonogram({ enabled: on })}
                          value={
                            design.monogram.enabled ? (
                              <span
                                className="truncate text-sm text-ink-500 dark:text-umber-300"
                                style={{ fontFamily: resolvedColors.heading_font }}
                              >
                                {monogramSpecimen(design.monogram.separator)}
                              </span>
                            ) : undefined
                          }
                        >
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
                        </TuneSwitchRow>

                        {/* Dividers. One switch now drives BOTH the guest page
                            and the printed cards: they were two controls on two
                            tabs writing the same idea. Hidden entirely for a
                            pack with no ornament language, where it does
                            nothing at all. */}
                        {getStylePreset(design.style).ornament !== "none" && (
                          <TuneSwitchRow
                            label={t("design.tune.dividers")}
                            checked={design.web.ornaments}
                            onChange={chooseOrnaments}
                            value={
                              <OrnamentDivider
                                slug={getStylePreset(design.style).ornament}
                                className="h-3 w-16 text-ink-400 dark:text-umber-300"
                              />
                            }
                          />
                        )}

                        {/* Cards: corners and shadow as one named feel. */}
                        <TuneRow
                          id="cards"
                          label={t("design.tune.cards")}
                          value={
                            <span className="truncate text-sm text-ink-500 dark:text-umber-300">
                              {activeCardFeel ? t(`design.card_feel.${activeCardFeel}`) : ""}
                            </span>
                          }
                          open={openRow === "cards"}
                          onToggle={() => toggleRow("cards")}
                          before={rowBefore}
                          now={design}
                          onRevert={revertRow}
                          couple={previewCouple}
                          locale={locale}
                          fallbackName={sampleCoupleName}
                        >
                          <TuneRail>
                            {CARD_FEELS.map((feel) => {
                              const active = activeCardFeel === feel.slug;
                              return (
                                <button
                                  key={feel.slug}
                                  type="button"
                                  onClick={() => chooseCardFeel(feel.slug)}
                                  aria-pressed={active}
                                  aria-label={t(feel.nameKey)}
                                  title={t(feel.nameKey)}
                                  className={`shrink-0 snap-start rounded-lg border p-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                                    active
                                      ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
                                      : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
                                  }`}
                                >
                                  <span className="block w-20 overflow-hidden rounded">
                                    <ProofCard
                                      design={{
                                        ...design,
                                        web: {
                                          ...design.web,
                                          cardRadius: feel.radius,
                                          shadow: feel.shadow,
                                        },
                                      }}
                                      size="chip"
                                      surface="site"
                                      brideName={couple?.bride_name}
                                      groomName={couple?.groom_name}
                                      weddingDate={couple?.wedding_date}
                                      locale={locale}
                                      fallbackName={sampleCoupleName}
                                    />
                                  </span>
                                </button>
                              );
                            })}
                          </TuneRail>
                        </TuneRow>

                        {/* Sections. The only row with no picture to show, so
                            it is the only one whose value is a number. */}
                        <TuneRow
                          id="sections"
                          label={t("design.tune.sections")}
                          value={
                            <span className="text-sm tabular-nums text-ink-500 dark:text-umber-300">
                              {WEBSITE_SECTIONS.length - hiddenCount} / {WEBSITE_SECTIONS.length}
                            </span>
                          }
                          open={openRow === "sections"}
                          onToggle={() => toggleRow("sections")}
                          before={rowBefore}
                          now={design}
                          onRevert={revertRow}
                          couple={previewCouple}
                          locale={locale}
                          fallbackName={sampleCoupleName}
                        >
                          <ul className="divide-y divide-paper-200 overflow-hidden rounded-xl border border-paper-300 bg-white dark:divide-umber-700 dark:border-umber-700 dark:bg-umber-800">
                            {WEBSITE_SECTIONS.map((sec) => {
                              const hidden = design.web.hiddenSections.includes(sec.slug);
                              return (
                                <li
                                  key={sec.slug}
                                  className="flex min-h-tap items-center justify-between gap-3 px-3 py-1.5"
                                >
                                  <span
                                    className={`text-sm ${
                                      hidden
                                        ? "text-ink-400 line-through decoration-ink-300 dark:text-umber-400 dark:decoration-umber-600"
                                        : "text-ink-900 dark:text-paper-50"
                                    }`}
                                  >
                                    {t(sec.nameKey)}
                                  </span>
                                  <Switch
                                    checked={!hidden}
                                    onChange={() => toggleSection(sec.slug)}
                                    label={t(sec.nameKey)}
                                  />
                                </li>
                              );
                            })}
                            {/* Venue map: an opt-in, not a hideable section, so
                                it sits below a heavier divider with a one-line
                                caption about the privacy trade. */}
                            <li className="flex min-h-tap items-center justify-between gap-3 border-t-2 border-paper-200 px-3 py-2 dark:border-umber-700">
                              <span className="min-w-0">
                                <span
                                  className={`block text-sm ${
                                    design.web.venueMap
                                      ? "text-ink-900 dark:text-paper-50"
                                      : "text-ink-500 dark:text-umber-300"
                                  }`}
                                >
                                  {t("design.web.map_label")}
                                </span>
                                <span className="mt-0.5 block text-xs text-ink-400 dark:text-umber-400">
                                  {hasVenueCoords
                                    ? t("design.web.map_confirm_body")
                                    : t("design.web.map_needs_location")}
                                </span>
                              </span>
                              <Switch
                                checked={design.web.venueMap}
                                onChange={() => void toggleVenueMap()}
                                disabled={!hasVenueCoords && !design.web.venueMap}
                                label={t("design.web.map_label")}
                              />
                            </li>
                          </ul>
                        </TuneRow>
                      </div>
                    </div>
                  </section>

                  {/* Publish / share. The old "Happy with the look?" card asked
                      a question nobody answers; these are just the two things
                      you do once the look is right. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFullPreview(true)}
                      className={`btn btn-outline btn-sm ${expandBtn}`}
                    >
                      <Maximize2 size={14} aria-hidden />
                      <span className={expandLabel}>{t("design.full_preview")}</span>
                    </button>
                    {couple?.slug && couple.is_public === false && (
                      <Link to="/app/guest-page" className="btn btn-primary btn-sm">
                        {t("design.publish_cta_button")}
                      </Link>
                    )}
                    {couple?.slug && couple.is_public && (
                      <>
                        <a
                          href={`/w/${couple.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`btn btn-primary btn-sm ${expandBtn}`}
                        >
                          <ExternalLink size={14} aria-hidden />
                          <span className={expandLabel}>
                            {t("design.finish.view_live")}
                          </span>
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyGuestLink()}
                          className={`btn btn-outline btn-sm ${expandBtn}`}
                        >
                          <Copy size={14} aria-hidden />
                          <span className={expandLabel}>
                            {t("design.finish.copy_link")}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {tab === "print" && (
                <>
                  {/* Same fine-tune vocabulary as the guest tab, so the two
                      surfaces read as one tool. Dividers is literally the same
                      switch: it writes both surfaces. */}
                  <section>
                    <p className="eyebrow mb-2">{t("design.tune.heading")}</p>
                    <div className="overflow-hidden rounded-2xl border border-paper-300 bg-white shadow-soft dark:border-umber-600 dark:bg-umber-800 dark:shadow-none">
                      <div className="divide-y divide-paper-200 dark:divide-umber-700">
                        <TuneRow
                          id="border"
                          label={t("design.tune.border")}
                          value={
                            <span
                              className="h-4 w-16 rounded"
                              style={{
                                border: getBorderCss(design.borderStyle, resolvedColors.accent),
                              }}
                              aria-hidden
                            />
                          }
                          open={openRow === "border"}
                          onToggle={() => toggleRow("border")}
                          before={rowBefore}
                          now={design}
                          onRevert={revertRow}
                          couple={previewCouple}
                          locale={locale}
                          fallbackName={sampleCoupleName}
                        >
                          <TuneRail>
                            {BORDER_STYLES.map((b) => {
                              const active = design.borderStyle === b.slug;
                              return (
                                <button
                                  key={b.slug}
                                  type="button"
                                  onClick={() => chooseBorderStyle(b.slug)}
                                  aria-pressed={active}
                                  aria-label={t(b.nameKey)}
                                  title={t(b.nameKey)}
                                  className={`flex h-14 w-24 shrink-0 snap-start items-center justify-center rounded-lg border bg-white p-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:bg-umber-800 dark:focus-visible:ring-paper-100 ${
                                    active
                                      ? "border-ink-900 ring-1 ring-ink-900 dark:border-paper-100 dark:ring-paper-100"
                                      : "border-paper-300 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-600"
                                  }`}
                                >
                                  <span
                                    className="h-8 w-full rounded"
                                    style={{ border: getBorderCss(b.slug, resolvedColors.accent) }}
                                    aria-hidden
                                  />
                                </button>
                              );
                            })}
                          </TuneRail>
                        </TuneRow>

                        {getStylePreset(design.style).ornament !== "none" && (
                          <TuneSwitchRow
                            label={t("design.tune.dividers")}
                            checked={design.web.ornaments}
                            onChange={chooseOrnaments}
                            value={
                              <OrnamentDivider
                                slug={getStylePreset(design.style).ornament}
                                className="h-3 w-16 text-ink-400 dark:text-umber-300"
                              />
                            }
                          />
                        )}
                      </div>
                    </div>
                  </section>

                  {/* The seating chart is produced by the seating editor, not
                      designed here, so it stays a plain download rather than a
                      shelf tile that pretends to be styleable. */}
                  <button
                    type="button"
                    onClick={() =>
                      downloadCard(
                        "seating_chart",
                        "/api/print/seating/a4",
                        "weddly-seating-chart.pdf",
                      )
                    }
                    disabled={downloading !== null}
                    className="btn btn-outline btn-sm"
                  >
                    {downloading === "seating_chart" ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <Download size={14} aria-hidden />
                    )}
                    {t("design.cards.seating_chart_name")}
                  </button>

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
                </>
              )}
            </div>

            {/* ── Preview column: a large live canvas. The guest page on the
                Website tab, the print card centred on a "desk" backdrop on the
                Print tab. Below lg it does not render at all: the stacked
                1300-line guest page under the editor was never a preview, and
                mounting WeddingSiteView twice was the page's worst render
                cost. Phones reach it through the full-screen overlay. The
                print card is cheap and small, so it still stacks on phones. */}
            <aside
              className={`lg:sticky lg:top-6 lg:self-start ${
                tab === "website" ? "hidden lg:block" : ""
              }`}
            >
              {tab === "print" ? (
                <div className="space-y-3">
                  <p className="eyebrow">{t(`design.print_preview.tpl.${printTemplate}`)}</p>
                  {/* The desk: a warm, large backdrop that frames the single card
                      so it reads as a physical object, not a thumbnail. The two
                      actions live ON the desk, next to the card they act on,
                      rather than in a downloads grid halfway down the page. */}
                  <div className="rounded-2xl border border-paper-200 bg-paper-100 p-6 dark:border-umber-700 dark:bg-umber-900">
                    <div className="grid min-h-[24rem] place-items-center">
                      <span className="block w-full max-w-[26rem] shadow-warm dark:shadow-none">
                        <PrintCardPreview
                          design={design}
                          template={printTemplate}
                          brideName={couple?.bride_name ?? null}
                        />
                      </span>
                    </div>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          downloadCard(
                            printTemplate,
                            exactPdfPath[printTemplate],
                            `weddly-${printTemplate.replace("_", "-")}.pdf`,
                          )
                        }
                        disabled={downloading !== null}
                        className="btn btn-primary btn-sm"
                      >
                        {downloading === printTemplate ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden />
                        ) : (
                          <Download size={14} aria-hidden />
                        )}
                        {t("design.cards.action_download")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void previewExactPdf()}
                        disabled={pdfPreviewBusy}
                        className="btn btn-outline btn-sm"
                      >
                        {pdfPreviewBusy ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden />
                        ) : (
                          <Eye size={14} aria-hidden />
                        )}
                        {t("design.print_preview.preview_exact_pdf")}
                      </button>
                    </div>
                    {/* The card's TEXT is content, edited elsewhere. One link,
                        replacing three helper paragraphs that said so. */}
                    <p className="mt-3 text-center text-xs text-ink-500 dark:text-umber-300">
                      <Link
                        to="/app/guest-page"
                        className="underline-offset-2 hover:text-ink-900 hover:underline dark:hover:text-paper-50"
                      >
                        {t("design.print_preview.content_change")}
                      </Link>
                    </p>
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
