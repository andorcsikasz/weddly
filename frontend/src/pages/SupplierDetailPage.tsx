// Admin-only supplier detail page. v1 surface for the locked-in spec, now in
// the editorial two-column layout: main scroll column on the left (hero,
// about, reviews, Q&A, bookings, admin meta) and a sticky right rail with
// the Información / Kapcsolat / Foglaltság cards. Inspired by the reference
// vendor pages couples already browse on competitor sites — same shape so the
// design transfers cleanly when the page opens up to couples in Phase 3.
//
// Route is wrapped in <RequireAdmin> at App.tsx, so this page assumes
// `user.is_admin === true`. The data-fetching layer still calls admin-only
// endpoints — a Phase-3 flip is a single auth-rule edit on the backend +
// removing the RequireAdmin wrap.

import {
  type ComponentType,
  type SVGProps,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  BadgeCheck,
  BedDouble,
  Bookmark,
  BookmarkCheck,
  Brush,
  Building2,
  Bus,
  Cake,
  Calendar as CalendarIcon,
  Camera,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Disc3,
  FileText,
  Flag,
  Flower2,
  Gem,
  Globe,
  Hand,
  Lightbulb,
  Mail,
  MapPin,
  PartyPopper,
  Phone,
  Pizza,
  Send,
  Share2,
  ShieldCheck,
  Shirt,
  Sparkles,
  Speaker,
  Star,
  PenTool,
  StickyNote,
  Tent,
  Trash2,
  Users,
  Speech,
  Wine,
} from "lucide-react";
import type {
  CommentVisibility,
  SupplierAvailability,
  SupplierBooking,
  SupplierCategory,
  SupplierComment,
  SupplierDetail,
  SupplierReview,
} from "@shared/suppliers";
import {
  COMMENT_BODY_MAX_CHARS,
  isVendorSelfServeBlocked,
  languageLabel,
  REVIEW_BODY_MAX_CHARS,
  showsCapacity,
  showsSpokenLanguages,
} from "@shared/suppliers";
import type { Currency } from "@shared/types";
import { vendorPublicId } from "@shared/vendor_slug";
import { Pill } from "../components/admin";
import { ClaimListingModal } from "../components/ClaimListingModal";
import { ComposeDialog } from "../components/OutreachInbox";
import { ReportSupplierDialog } from "../components/ReportSupplierDialog";
import { ReviewSpendFields } from "../components/ReviewSpendFields";
import { ReviewSpendLine } from "../components/ReviewSpendLine";
import { ReviewTagPicker } from "../components/ReviewTagPicker";
import { intlLocale, localeCurrency } from "../lib/format";
import { reviewTagLabel } from "../lib/reviewTags";
import { VendorPackageGrid } from "../components/VendorPackageCards";
import { LazyVideoPlayer } from "../components/VideoEmbed";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { VendorGallery } from "../components/VendorGallery";
import { Wordmark } from "../components/Wordmark";
import { ApiError } from "../lib/api";
import { lazyWithReload } from "../lib/lazy_reload";
import { useAuth } from "../lib/auth";
import {
  coupleApi,
  reviewApi,
  supplierApi,
  supplierBookingApi,
  supplierCommentApi,
} from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";
import {
  readSaved as readSavedStore,
  setSaved as setSavedStore,
  subscribeSaved,
} from "../lib/supplier_saved";

// Lazy so the OpenStreetMap embed modal only loads when the user opens the map.
const SupplierMapModal = lazyWithReload(() => import("../components/SupplierMapModal"));

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

// Per-category glyph for the empty-state hero. Mirrors the mapping in
// SuppliersPage.tsx so the placeholder reads as "same brand, this category".
import { CATEGORY_ICON } from "../lib/category_icons";

const VISIBILITIES: CommentVisibility[] = ["admin_internal", "public", "vendor_only"];

function formatDate(unixMs: number, locale: Locale): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function StarRow({
  value,
  size = 14,
  ariaLabel,
}: {
  value: number;
  size?: number;
  /** Optional spoken label (e.g. "4 out of 5"). Skipped on decorative rows
   *  rendered next to a separately-narrated numeric rating. */
  ariaLabel?: string;
}) {
  // Filled stars use the warm `paper-500` token (#bfae7b — the project's
  // gold/oat accent). Rose / amber would both work universally but rose
  // collides with the error/blush palette, and amber isn't in the design
  // tokens; paper is the in-palette match for the universal "rating star"
  // convention. Inactive strokes stay light so the row reads as a coherent
  // 5-slot scale.
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          aria-hidden
          className={
            n <= value ? "fill-star stroke-star" : "stroke-paper-300 dark:stroke-umber-500"
          }
        />
      ))}
    </span>
  );
}

function StarPicker({
  value,
  onChange,
}: {
  /** 0 = nothing picked yet (all glyphs hollow). Once the user clicks a
   *  star, `value` becomes that number and the submit button unlocks. */
  value: 0 | 1 | 2 | 3 | 4 | 5;
  onChange: (n: 1 | 2 | 3 | 4 | 5) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n as 1 | 2 | 3 | 4 | 5)}
          className="p-0.5 leading-none transition"
        >
          <Star
            size={24}
            aria-hidden
            className={n <= value ? "fill-star stroke-star" : "stroke-paper-300 hover:stroke-star"}
          />
        </button>
      ))}
    </div>
  );
}

export default function SupplierDetailPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isAdmin = user?.is_admin ?? false;
  const { supplier_id: supplierIdRaw } = useParams<{ supplier_id: string }>();
  const supplierId = supplierIdRaw ?? "";

  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [reviews, setReviews] = useState<SupplierReview[] | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [comments, setComments] = useState<SupplierComment[] | null>(null);
  const [availability, setAvailability] = useState<SupplierAvailability | null>(null);
  // The viewing couple's wedding date, so the busy calendar can open on the
  // wedding month rather than today. Best-effort: a null (non-couple viewer /
  // failed fetch) just leaves the calendar on the current month.
  const [weddingDate, setWeddingDate] = useState<string | null>(null);
  // The viewing couple's id — keys the shared server-side shortlist so the
  // "saved" state matches the directory grid + the partner's device.
  const [coupleId, setCoupleId] = useState<number | null>(null);
  // The couple's own currency, for the review composer's spend field. Deriving
  // it from the UI language turned a HUF amount into euros the moment someone
  // switched the interface to English, with the number left untouched.
  const [coupleCurrency, setCoupleCurrency] = useState<Currency | null>(null);
  const [bookings, setBookings] = useState<SupplierBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  // Report dialog (community listings only). Holds the numeric id + name.
  const [reporting, setReporting] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    if (!detail) {
      document.title = "Supplier";
      return;
    }
    // Couples see the bare supplier name; the "Admin view" suffix is an
    // internal label and stays admin-only.
    document.title = isAdmin ? `${detail.name} · ${t("suppliers.detail.adminTitle")}` : detail.name;
  }, [detail, isAdmin, t]);

  const refresh = useCallback(async () => {
    if (!supplierId) return;
    try {
      // The per-couple bookings LIST stays admin-only (operational moderation
      // view). Couples skip that call entirely — fetching it would 403 and
      // reject the whole Promise.all.
      const [d, rs, cs, av] = await Promise.all([
        supplierApi.detail(supplierId),
        reviewApi.list(supplierId, { limit: 50 }),
        supplierCommentApi.list(supplierId, { limit: 50 }),
        supplierBookingApi.availability(supplierId),
      ]);
      setDetail(d);
      setReviews(rs.items);
      setCanReview(rs.can_review);
      setAlreadyReviewed(rs.already_reviewed);
      setComments(cs.items);
      setAvailability(av);
      setBookings(isAdmin ? (await supplierBookingApi.list(supplierId)).items : []);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Load failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [supplierId, toast, isAdmin]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Count a profile open. Keyed on the RESOLVED listing id (`v12` /
  // `aranybastya`), not the route param: a pretty slug would land the event on
  // an id no listing owns and get dropped by the ingest whitelist. Same event
  // the public `/vendors/:id` page fires, so the vendor's reach number counts a
  // logged-in couple opening the profile exactly like an anonymous visitor.
  // Admins are skipped: moderation traffic would inflate the reach number we
  // show the vendor. Fire-and-forget; a failed ping is never worth surfacing.
  const viewedId = detail?.id;
  useEffect(() => {
    if (!viewedId || isAdmin) return;
    supplierApi.recordEvents([{ supplier_id: viewedId, type: "view" }]).catch(() => undefined);
  }, [viewedId, isAdmin]);

  // Wedding date (busy-calendar default month) + couple id (keys the saved
  // shortlist). Fetched once, best-effort.
  useEffect(() => {
    let cancelled = false;
    void coupleApi
      .current()
      .then((r) => {
        if (cancelled) return;
        setWeddingDate(r.couple?.wedding_date ?? null);
        setCoupleId(r.couple?.id ?? null);
        setCoupleCurrency(r.couple?.currency ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Saved-to-shortlist state — the SAME per-couple, server-side store the
  // directory grid uses (`supplier_saved`), so the save state matches the card
  // and the partner's device. (It used to read a device-local localStorage key
  // that the directory has since migrated + cleared, which is why "saved" on the
  // card showed as "not saved" here.)
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (coupleId === null) return;
    setSavedSet(readSavedStore(coupleId));
    return subscribeSaved(coupleId, (next) => setSavedSet(next));
  }, [coupleId]);
  // Key the shortlist by the RESOLVED id (`v12` / `aranybastya`), not the route
  // param — which may be a pretty slug (`magyar-foto-v12`) that wouldn't match
  // the id the directory saves under.
  const savedKey = detail?.id ?? null;
  const isSaved = savedKey !== null && savedSet.has(savedKey);
  const toggleSaved = useCallback(() => {
    if (coupleId === null || savedKey === null) return;
    setSavedSet(setSavedStore(coupleId, savedKey, !savedSet.has(savedKey)));
  }, [coupleId, savedKey, savedSet]);

  // Outreach compose modal — opens with the current supplier pre-attached
  // so the user can write a tailored inquiry without re-picking a vendor.
  const [composeOpen, setComposeOpen] = useState(false);

  // Share the vendor with someone outside Weddly. Native share sheet first
  // (the real "send to a friend" affordance on mobile — a dismissed sheet
  // rejects with AbortError, which we swallow); desktop / unsupported falls
  // back to a clipboard copy + toast. The link is the vendor page URL; the
  // share text carries the name so the message reads well even unopened.
  const shareVendor = useCallback(async () => {
    if (!detail) return;
    // Share the PUBLIC vendor page (`/vendors/:id`), not the auth-gated in-app
    // URL — the whole point is that someone outside Weddly can open it. Use the
    // pretty, name-based public id (`magyar-foto-v12`) so the shared link reads
    // as the business, not an opaque `v12`.
    const url = `${window.location.origin}/vendors/${encodeURIComponent(
      vendorPublicId(detail.id, detail.name),
    )}`;
    const shareText = t("suppliers.detail.cta.shareText", { name: detail.name });
    const copyToClipboard = async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("no_clipboard");
        await navigator.clipboard.writeText(url);
        toast.success(t("suppliers.detail.cta.shareCopied"));
      } catch {
        toast.error(t("common.error_generic"));
      }
    };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: detail.name, text: shareText, url });
      } catch (e) {
        // AbortError is the user closing the sheet — their decision, no toast.
        // ANY other rejection (a desktop browser that advertises the API and
        // then refuses it, a payload the OS declines) used to leave the button
        // doing visibly nothing at all, which reads as broken. Fall back to the
        // clipboard so a click always ends in something the user can see.
        if (!(e instanceof DOMException && e.name === "AbortError")) await copyToClipboard();
      }
      return;
    }
    await copyToClipboard();
  }, [detail, t, toast]);

  if (loading || !detail) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <Skeleton className="mb-4 h-8 w-1/2" />
        <Skeleton className="mb-2 h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const ratingAvg = detail.reviews_summary.avg_rating;
  const ratingCount = detail.reviews_summary.reviews_count;
  const ratingDisplay =
    ratingAvg !== null && ratingCount >= 3
      ? locale === "hu"
        ? ratingAvg.toFixed(1).replace(".", ",")
        : ratingAvg.toFixed(1)
      : null;
  const canInquire = Boolean(detail.contact_email);
  const inquireLabel = t("suppliers.detail.cta.sendInquiry");
  const saveLabel = t(isSaved ? "suppliers.detail.cta.savedActive" : "suppliers.detail.cta.save");
  const shareLabel = t("suppliers.detail.cta.share");

  return (
    // data-admin-shell opts every h1..h6 inside into the sans typography
    // override defined in index.css. Mirrors the /app/admin/* shell so the
    // admin operational view reads as a tool. Couples get the editorial
    // typography (Cormorant headings) the rest of /app uses.
    <div
      data-admin-shell={isAdmin ? "true" : undefined}
      className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-6 xl:px-10"
    >
      <button
        type="button"
        onClick={() => {
          // navigate(-1) sends a deep-link user back to about:blank; fall
          // through to the directory index when there's nothing to pop.
          if (window.history.length > 1) navigate(-1);
          else navigate("/app/suppliers");
        }}
        className="mb-4 inline-flex items-center gap-1 rounded-md text-sm text-ink-500 transition hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:text-umber-300 dark:hover:text-umber-100"
      >
        <ChevronLeft size={14} aria-hidden />
        {t("suppliers.detail.back")}
      </button>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ─── MAIN COLUMN ────────────────────────────────────────────────── */}
        <main className="min-w-0">
          {/* Hero. Always renders SOMETHING — a 16:9 photo when the vendor
              uploaded one, or a paper-toned monogram placeholder so the
              page never opens with bare text on white. The placeholder
              also carries a quiet "claim listing to add photos" hint when
              the vendor hasn't claimed yet, turning an empty slot into an
              acquisition surface. */}
          <section className="mb-10">
            <VendorGallery
              images={detail.gallery_urls ?? []}
              name={detail.name}
              positionsY={detail.gallery_positions_y}
              emptyState={<HeroImage detail={detail} t={t} src={null} />}
            />
            <div className="mt-5 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t(`suppliers.cat.${detail.category}`)} · {detail.city}
            </div>
            <h1 className="mt-1 inline-flex flex-wrap items-center gap-x-2 text-3xl font-bold leading-tight tracking-tight text-ink-900 dark:text-cream-50 sm:text-4xl">
              <span>{detail.name}</span>
              {detail.vendor_account_id !== null && (
                <BadgeCheck
                  size={28}
                  aria-label={t("suppliers.detail.verifiedAria")}
                  className="shrink-0 fill-verified stroke-white"
                />
              )}
            </h1>
            {detail.company_name && detail.company_name !== detail.name && (
              <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{detail.company_name}</p>
            )}
            {/* Single rating row — the sidebar's duplicate RATING row was
                removed (it was repeating this exact value two columns
                away). Source of truth lives here, in the header. */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {ratingDisplay !== null && ratingAvg !== null ? (
                <span className="inline-flex items-center gap-2 text-sm">
                  <StarRow
                    value={Math.round(ratingAvg)}
                    size={16}
                    ariaLabel={t("suppliers.detail.starsAria", {
                      rating: ratingDisplay,
                      max: 5,
                    })}
                  />
                  <span className="font-medium text-ink-900 dark:text-cream-50">
                    {ratingDisplay}
                  </span>
                  <span className="text-ink-500 dark:text-umber-300">·</span>
                  <span className="text-ink-600 dark:text-umber-200">
                    {t("suppliers.detail.reviewsCount", { n: ratingCount })}
                  </span>
                </span>
              ) : (
                <span className="text-sm italic text-ink-500 dark:text-umber-300">
                  {t("suppliers.detail.info.ratingEmpty")}
                </span>
              )}
              {detail.price_band !== null && <PriceBandDots band={detail.price_band} t={t} />}
              {/* Guest capacity + venue style — captured on the listing but
                  previously only shown on the compact directory card. Surface
                  them here too so the detail page (and its shared public twin)
                  carries the same "worth knowing" facts. */}
              {showsCapacity(detail) && (
                <span className="inline-flex items-center gap-1 text-sm text-ink-600 dark:text-umber-200">
                  <Users size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
                  {detail.capacity_min && detail.capacity_max
                    ? t("suppliers.capacity_range", {
                        min: detail.capacity_min,
                        max: detail.capacity_max,
                      })
                    : t("suppliers.capacity_max_only", { max: detail.capacity_max ?? 0 })}
                </span>
              )}
              {showsSpokenLanguages(detail) && (
                <span className="inline-flex items-center gap-1 text-sm text-ink-600 dark:text-umber-200">
                  <Speech size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
                  {(detail.spoken_languages ?? [])
                    .map((c) =>
                      languageLabel(c, locale === "hu" ? "hu" : locale === "es" ? "es" : "en"),
                    )
                    .join(", ")}
                </span>
              )}
              {detail.venue_style && (
                <Pill tone="muted">{t(`suppliers.venue_style.${detail.venue_style}`)}</Pill>
              )}
              {/* Verified vendors get the BadgeCheck next to the name (above);
                  unclaimed listings keep a quiet muted pill so the missing
                  state still carries a clear label, not silence. */}
              {detail.vendor_account_id === null && (
                <Pill tone="muted">{t("suppliers.detail.unclaimed")}</Pill>
              )}
            </div>

            {/* Primary actions. Send inquiry is the sole conversion target,
                so it stays the one solid accent-filled button. Save + share
                are demoted to quiet outline secondaries that don't compete
                for the eye. All three render on desktop here AND in the
                sticky bottom bar on mobile (see end of this file). */}
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setComposeOpen(true)}
                disabled={!canInquire}
                title={canInquire ? undefined : t("suppliers.detail.cta.inquireDisabled")}
                className="btn-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={14} aria-hidden />
                {inquireLabel}
              </button>
              <button
                type="button"
                onClick={toggleSaved}
                aria-pressed={isSaved}
                className={
                  isSaved
                    ? "inline-flex items-center gap-1.5 rounded-full border border-sage-400 bg-sage-50 px-3 py-1.5 text-sm font-medium text-sage-700 transition hover:border-sage-500 dark:border-sage-600 dark:bg-sage-600/20 dark:text-sage-200"
                    : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-transparent px-3 py-1.5 text-sm text-ink-600 transition hover:border-ink-300 hover:bg-paper-100/70 hover:text-ink-800 dark:border-umber-700 dark:text-umber-200 dark:hover:border-umber-500 dark:hover:bg-umber-800"
                }
              >
                {isSaved ? (
                  <BookmarkCheck size={14} aria-hidden />
                ) : (
                  <Bookmark size={14} aria-hidden />
                )}
                {saveLabel}
              </button>
              <button
                type="button"
                onClick={shareVendor}
                aria-label={shareLabel}
                title={shareLabel}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300 bg-transparent text-ink-600 transition hover:border-ink-300 hover:bg-paper-100/70 hover:text-ink-800 dark:border-umber-700 dark:text-umber-200 dark:hover:border-umber-500 dark:hover:bg-umber-800"
              >
                <Share2 size={14} aria-hidden />
              </button>
            </div>

            {/* Vendor contact (website / email / phone) lives solely in the
                sidebar Kapcsolat card — not duplicated under the CTA. The only
                thing that surfaces here is the community-report action, and
                only for user-submitted tips (never a claimed vendor). */}
            {detail.source === "community" && (
              <div className="mt-3 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setReporting({ id: Number(detail.id.slice(1)), name: detail.name })
                  }
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300 text-ink-500 transition hover:border-ink-400 hover:bg-paper-100 hover:text-ink-700 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-500 dark:hover:bg-umber-700"
                  aria-label={t("suppliers.report.aria_label")}
                  title={t("suppliers.report.aria_label")}
                >
                  <Flag size={16} aria-hidden />
                </button>
              </div>
            )}
          </section>

          {/* Videos — reference reel, directly after the photo gallery. A
              responsive grid (1 col on mobile, 2 from sm up) of lazy,
              click-to-play embeds. Renders only when the vendor added at
              least one. */}
          {detail.videos.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
                {t("suppliers.detail.videos.title")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {detail.videos.map((v, i) => (
                  <LazyVideoPlayer
                    key={v.id}
                    video={v}
                    title={t("suppliers.detail.videos.playAria", {
                      name: detail.name,
                      n: i + 1,
                    })}
                  />
                ))}
              </div>
            </section>
          )}

          {/* About / blurb */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
              {t("suppliers.detail.about.title")}
            </h2>
            <BlurbBody detail={detail} locale={locale} t={t} />
            {detail.reviews_summary.top_tags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {detail.reviews_summary.top_tags.map((tt) => (
                  <span
                    key={tt.tag}
                    className="inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                  >
                    {t(`suppliers.reviewTags.${tt.tag}`)}
                    <span className="tabular-nums text-ink-400 dark:text-umber-300">
                      · {tt.count}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Packages (árajánlat) — the vendor's published price offers, as a
              scannable comparison grid. Card layout, spec parsing, the
              recommended anchor and the empty-state fallback all live in the
              shared <VendorPackageGrid> (also used by the public page). */}
          {detail.packages.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
                {t("suppliers.detail.packages.title")}
              </h2>
              <VendorPackageGrid packages={detail.packages} t={t} />
            </section>
          )}

          {/* Reviews */}
          <ReviewsSection
            supplierId={supplierId}
            reviews={reviews ?? []}
            avg={ratingAvg}
            count={ratingCount}
            canReview={canReview}
            alreadyReviewed={alreadyReviewed}
            category={detail.category}
            onChange={refresh}
            confirm={confirm}
            toast={toast}
            locale={locale}
            currency={coupleCurrency}
            isAdmin={isAdmin}
            t={t}
          />

          {/* Q&A */}
          <CommentsSection
            supplierId={supplierId}
            comments={comments ?? []}
            onChange={refresh}
            confirm={confirm}
            toast={toast}
            locale={locale}
            isAdmin={isAdmin}
            t={t}
          />

          {/* Bookings list — admin-only operational view. Couples read
              availability from the right-rail busy calendar instead. */}
          {isAdmin && <BookingsSection bookings={bookings} bookable={detail.bookable} t={t} />}

          {/* Owner-side claim CTA. Renders only on unclaimed listings; once
              vendor_account_id is set, the slot disappears. Armed-confirm
              pattern (first click arms, second click fires) calls the
              existing /api/vendor/claim/start flow, which emails the
              listing's contact_email AND records a listing_claims row
              admins can see in the moderation queue. */}
          {detail.vendor_account_id === null && (
            <ClaimCtaSection
              supplierId={detail.id}
              listingName={detail.name}
              category={detail.category}
              t={t}
            />
          )}

          {/* Admin meta — internal ids / source / redirect. Admin-only. */}
          {isAdmin && <AdminMetaSection detail={detail} t={t} />}
        </main>

        {/* ─── SIDEBAR (sticky on lg+) ───────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <InfoCard detail={detail} t={t} onOpenMap={() => setMapOpen(true)} />
          <ContactCard detail={detail} t={t} />
          <BusyCalendarCard
            availability={availability}
            weddingDate={weddingDate}
            locale={locale}
            t={t}
          />
        </aside>
      </div>

      {/* Mobile sticky action bar. On <lg the right rail is far below the
          fold (after reviews + Q&A + bookings + admin meta), which leaves
          the user with no persistent CTA. The bar pins Send inquiry + Save
          to the bottom of the viewport so the conversion path is always
          one thumb-reach away. `pb-24` on the outer container reserves
          the height so this never occludes the last article. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-paper-200 bg-paper-50/95 px-4 py-3 backdrop-blur lg:hidden dark:border-umber-700 dark:bg-umber-900/95">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <button
            type="button"
            onClick={toggleSaved}
            aria-pressed={isSaved}
            aria-label={saveLabel}
            className={
              isSaved
                ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sage-600 bg-sage-600 text-white dark:border-sage-600 dark:bg-sage-600 dark:text-white"
                : "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
            }
          >
            {isSaved ? <BookmarkCheck size={18} aria-hidden /> : <Bookmark size={18} aria-hidden />}
          </button>
          <button
            type="button"
            onClick={shareVendor}
            aria-label={shareLabel}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
          >
            <Share2 size={18} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            disabled={!canInquire}
            className="btn-accent flex-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} aria-hidden />
            {inquireLabel}
          </button>
        </div>
      </div>

      {composeOpen && (
        <ComposeDialog
          initialSuppliers={[{ id: detail.id, name: detail.name, city: detail.city }]}
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false);
            toast.success(t("suppliers.detail.cta.inquireSent"));
          }}
        />
      )}

      {mapOpen && (
        <Suspense fallback={null}>
          <SupplierMapModal
            name={detail.name}
            lat={detail.lat}
            lng={detail.lng}
            address={detail.address}
            city={detail.city}
            onClose={() => setMapOpen(false)}
          />
        </Suspense>
      )}

      <ReportSupplierDialog
        supplierId={reporting?.id ?? null}
        supplierName={reporting?.name ?? ""}
        onClose={() => setReporting(null)}
        onReported={({ autoHidden }) => {
          // A report that flips the listing to hidden makes this detail page
          // a dead end — send the user back to the directory.
          if (autoHidden) navigate("/app/suppliers");
        }}
      />
    </div>
  );
}

// ─── Main-column sections ────────────────────────────────────────────────────

function BlurbBody({
  detail,
  locale,
  t,
}: {
  detail: SupplierDetail;
  locale: Locale;
  t: (k: string) => string;
}) {
  const blurb = (locale === "hu" ? detail.blurb_hu : detail.blurb_en).trim();
  if (!blurb) {
    return (
      <p className="text-sm italic text-ink-500 dark:text-umber-300">
        {t("suppliers.detail.about.empty")}
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-700 dark:text-paper-100">
      {blurb.split(/\n\s*\n/).map((para, i) => (
        <p key={i}>{para.trim()}</p>
      ))}
    </div>
  );
}

interface SectionCtx {
  supplierId: string;
  onChange: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
  confirm: ReturnType<typeof useConfirm>;
  locale: Locale;
  /** True only for Weddly admins. Gates the moderation affordances (compose,
   *  publish, delete, internal-visibility controls) that couples never see. */
  isAdmin: boolean;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

function ReviewsSection({
  reviews,
  avg,
  count,
  canReview,
  alreadyReviewed,
  category,
  ...ctx
}: SectionCtx & {
  reviews: SupplierReview[];
  avg: number | null;
  count: number;
  canReview: boolean;
  alreadyReviewed: boolean;
  category: SupplierCategory;
  /** The reviewing couple's currency; null for a viewer without a workspace. */
  currency: Currency | null;
}) {
  const { supplierId, onChange, toast, confirm, locale, isAdmin, t, currency } = ctx;
  // Default 0 = no rating picked yet. Stars render as hollow glyphs and the
  // Beküldés button stays disabled until the user actually clicks one.
  // Avoids the "everyone defaults to 5 stars" trap that inflates aggregates.
  const [rating, setRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountNote, setAmountNote] = useState("");
  const [published, setPublished] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (rating === 0) return; // guard: button is also disabled but be defensive
    setSubmitting(true);
    try {
      // `published` is an admin (editorial) lever; couple reviews go live
      // immediately server-side, and sending the field would 403.
      await reviewApi.create(supplierId, {
        rating,
        body: body.trim() || null,
        tags,
        amount_paid: amount,
        // The couple's currency, never the interface language. Only a viewer
        // with no workspace falls back to the locale guess.
        amount_currency: currency ?? localeCurrency(locale as Locale),
        amount_note: amountNote.trim() || null,
        ...(isAdmin ? { published } : {}),
      });
      setBody("");
      setTags([]);
      setAmount(null);
      setAmountNote("");
      setRating(0);
      setPublished(false);
      toast.success(t("suppliers.detail.reviews.submitted"));
      await onChange();
    } catch (e) {
      const code = e instanceof ApiError ? (e.detail as { code?: string } | undefined)?.code : null;
      const msg =
        code === "already_reviewed"
          ? t("suppliers.detail.reviews.alreadyReviewed")
          : e instanceof Error
            ? e.message
            : "Submit failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    const ok = await confirm({
      title: t("suppliers.detail.reviews.deleteConfirmTitle"),
      body: t("suppliers.detail.reviews.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await reviewApi.remove(id);
      await onChange();
      toast.success(t("suppliers.detail.reviews.deleted"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
          {t("suppliers.detail.reviews.title")} ({count})
        </h2>
        {avg !== null && count >= 3 && (
          <span className="inline-flex items-center gap-2 text-sm">
            <StarRow value={Math.round(avg)} size={14} />
            <span className="font-medium">{avg.toFixed(1)}</span>
          </span>
        )}
      </div>

      {/* Composer opens for admins (editorial voice) and for any verified user
          who hasn't already reviewed this supplier. Engaged couples additionally
          earn the "Verified" badge; everyone else posts an unbadged review. */}
      {!isAdmin && !canReview && (
        <p className="mb-6 text-sm italic text-ink-500 dark:text-umber-300">
          {alreadyReviewed
            ? t("suppliers.detail.reviews.alreadyReviewedNote")
            : t("suppliers.detail.reviews.eligibilityHint")}
        </p>
      )}
      {(isAdmin || canReview) && (
        <div className="mb-6 rounded-xl border border-ink-200/60 bg-cream-50 p-5 dark:border-umber-700/60 dark:bg-umber-800/40">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm text-ink-600 dark:text-umber-200">
              {t("suppliers.detail.reviews.yourRating")}:
            </span>
            <StarPicker value={rating} onChange={setRating} />
          </div>
          <textarea
            className="mb-3 w-full rounded-md border border-ink-200 bg-white p-3 text-sm dark:border-umber-700 dark:bg-umber-900"
            placeholder={t("suppliers.detail.reviews.bodyPlaceholder")}
            maxLength={REVIEW_BODY_MAX_CHARS}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <ReviewSpendFields
            amount={amount}
            note={amountNote}
            onAmount={setAmount}
            onNote={setAmountNote}
            locale={locale as Locale}
            currency={currency}
            t={t}
          />
          <ReviewTagPicker value={tags} onChange={setTags} category={category} t={t} />
          <div className="flex items-center justify-between">
            {/* Draft/publish is an editorial (admin) lever; couple reviews go
                live immediately, so they get no checkbox to wonder about. */}
            {isAdmin ? (
              <label className="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-umber-200">
                <input
                  type="checkbox"
                  checked={published}
                  onChange={(e) => setPublished(e.target.checked)}
                />
                {t("suppliers.detail.reviews.publishedLabel")}
              </label>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={submitting || rating === 0}
              onClick={submit}
              title={rating === 0 ? t("suppliers.detail.reviews.pickStarFirst") : undefined}
              className="btn-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "…" : t("suppliers.detail.reviews.submit")}
            </button>
          </div>
        </div>
      )}

      {reviews.length === 0 ? (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.reviews.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <StarRow value={r.rating} size={14} />
                  <span className="text-sm font-medium text-ink-900 dark:text-cream-50">
                    {r.author.display_name}
                  </span>
                  {r.editorial && <Pill tone="violet">Editorial</Pill>}
                  {/* "Verified" is now the engagement-proof badge only — an open
                      community/visitor review (verified=false) wears no badge,
                      so the label keeps meaning "actually worked with them". */}
                  {!r.editorial && r.verified && (
                    <Pill tone="sage">{t("suppliers.detail.reviews.verifiedBadge")}</Pill>
                  )}
                  {!r.published && <Pill tone="blush">Draft</Pill>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    {formatDate(r.created_at, locale)}
                  </span>
                  {(isAdmin || r.own) && (
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                      className="text-ink-400 hover:text-rose-600 dark:text-umber-400"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              {r.body && (
                <p className="mb-2 whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
                  {r.body}
                </p>
              )}
              <ReviewSpendLine review={r} locale={locale as Locale} />
              {r.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-700 dark:bg-umber-700/40 dark:text-umber-100"
                    >
                      {reviewTagLabel(tag, t)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentsSection({ comments, ...ctx }: SectionCtx & { comments: SupplierComment[] }) {
  const { supplierId, onChange, toast, confirm, locale, isAdmin, t } = ctx;
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<CommentVisibility>("admin_internal");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await supplierCommentApi.create(supplierId, { body: body.trim(), visibility });
      setBody("");
      toast.success(t("suppliers.detail.comments.submitted"));
      await onChange();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Submit failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    const ok = await confirm({
      title: t("suppliers.detail.comments.deleteConfirmTitle"),
      body: t("suppliers.detail.comments.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await supplierCommentApi.remove(id);
      await onChange();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
    }
  };

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
        {t("suppliers.detail.comments.title")}
      </h2>

      {/* Q&A composer is admin-only in this cut. The visibility dropdown
          (admin_internal / public / vendor_only) is a moderation control, and
          couple-authored questions are a separate Phase-3 surface. */}
      {isAdmin && (
        <div className="mb-6 rounded-xl border border-ink-200/60 bg-cream-50 p-5 dark:border-umber-700/60 dark:bg-umber-800/40">
          <textarea
            className="mb-3 w-full rounded-md border border-ink-200 bg-white p-3 text-sm dark:border-umber-700 dark:bg-umber-900"
            placeholder={t("suppliers.detail.comments.placeholder")}
            maxLength={COMMENT_BODY_MAX_CHARS}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as CommentVisibility)}
              className="rounded-md border border-ink-200 bg-white px-2 py-1 text-sm dark:border-umber-700 dark:bg-umber-900"
            >
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(`suppliers.detail.comments.visibility.${v}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={submitting || !body.trim()}
              onClick={submit}
              className="btn-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "…" : t("suppliers.detail.comments.submit")}
            </button>
          </div>
        </div>
      )}

      {comments.length === 0 ? (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.comments.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink-900 dark:text-cream-50">
                    {c.author.display_name}
                  </span>
                  {c.author.is_admin && <Pill tone="violet">Weddly</Pill>}
                  {/* Visibility tier is an internal moderation label. */}
                  {isAdmin && (
                    <Pill tone="muted">
                      {t(`suppliers.detail.comments.visibility.${c.visibility}`)}
                    </Pill>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    {formatDate(c.created_at, locale)}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                      className="text-ink-400 hover:text-rose-600 dark:text-umber-400"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              <p className="whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BookingsSection({
  bookings,
  bookable,
  t,
}: {
  bookings: SupplierBooking[];
  bookable: boolean;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  if (!bookable && bookings.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
        {t("suppliers.detail.calendar.title")}
      </h2>
      {bookings.length === 0 ? (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.calendar.noBookings")}
        </p>
      ) : (
        <ul className="space-y-2">
          {bookings.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-xl border border-ink-200/60 bg-white p-4 text-sm dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div>
                <div className="font-medium text-ink-900 dark:text-cream-50">{b.event_date}</div>
                <div className="text-xs text-ink-500 dark:text-umber-300">
                  {t(`suppliers.detail.calendar.status.${b.status}`)}
                </div>
              </div>
              {b.status === "confirmed" && (
                <a
                  href={supplierBookingApi.icsUrl(b.id)}
                  download
                  className="text-xs text-rose-600 underline"
                >
                  {t("suppliers.detail.calendar.downloadIcs")}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Owner-side claim CTA ───────────────────────────────────────────────────

/** Renders for unclaimed listings only. Opens the shared claim modal, which
 *  collects the claimer's email, fires vendor-claim/start, and notifies the
 *  admins. Single entry point keeps this surface consistent with the directory
 *  page's "this is mine" button.
 *
 *  On a wedding-planner card it swaps the claim button for the planner signup:
 *  claiming would mint a vendor account, which the API now refuses anyway, and
 *  a button that always errors is worse than the right door. */
function ClaimCtaSection({
  supplierId,
  listingName,
  category,
  t,
}: {
  supplierId: string;
  listingName: string;
  category: string;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const [open, setOpen] = useState(false);

  if (isVendorSelfServeBlocked(category)) {
    return (
      <section className="mb-10 rounded-xl border border-ink-200/60 bg-cream-50 p-6 dark:border-umber-700/60 dark:bg-umber-800/40">
        <div className="mb-4 flex items-start gap-3">
          <ShieldCheck
            size={22}
            aria-hidden
            className="mt-0.5 shrink-0 text-paper-600 dark:text-paper-400"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-cream-50">
              {t("suppliers.detail.claim.plannerTitle")}
            </h2>
            <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
              {t("suppliers.detail.claim.plannerBody")}
            </p>
          </div>
        </div>
        <Link
          to="/planners"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blush-600 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-blush-700"
        >
          {t("suppliers.detail.claim.plannerCta")}
        </Link>
      </section>
    );
  }

  return (
    <section className="mb-10 rounded-xl border border-ink-200/60 bg-cream-50 p-6 dark:border-umber-700/60 dark:bg-umber-800/40">
      <div className="mb-4 flex items-start gap-3">
        <ShieldCheck
          size={22}
          aria-hidden
          className="mt-0.5 shrink-0 text-paper-600 dark:text-paper-400"
        />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-cream-50">
            {t("suppliers.detail.claim.sectionTitle")}
          </h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {t("suppliers.detail.claim.sectionBody")}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blush-600 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-blush-700"
      >
        <ShieldCheck size={16} aria-hidden />
        {t("suppliers.detail.claim.button")}
      </button>
      <ClaimListingModal
        listingId={open ? supplierId : null}
        listingName={listingName}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}

// ─── Right-rail sidebar cards ────────────────────────────────────────────────

function SidebarCard({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  /** Optional. Section header dropped entirely when omitted, used by the
   *  Address and Contact cards where the rows already say what they are
   *  (pin + street, phone + number, etc.). The Foglaltság card keeps a
   *  title because the month nav needs context. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    // Shared card elevation: a soft drop shadow lifts the card off the cream
    // page instead of a hard 1px border (dark mode keeps a faint ring since
    // shadows vanish on dark surfaces). Same radius + padding as the package
    // cards so the whole page reads as one system.
    <div className="rounded-2xl bg-white p-5 shadow-elevated ring-1 ring-black/[0.04] dark:bg-umber-900 dark:shadow-none dark:ring-umber-600">
      {title && (
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-cream-50">
          {icon}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function SidebarRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  /** Optional micro-label. When omitted, the row collapses to one line:
   *  `icon + value`. Labels were dropping value when every row carried an
   *  all-caps stamp ("LOCATION", "RATING") that simply re-named the icon
   *  next to it. */
  label?: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="mt-0.5 text-ink-500 dark:text-umber-400">{icon}</span>
      <div className="min-w-0 flex-1">
        {label && <div className="text-xs text-ink-500 dark:text-umber-400">{label}</div>}
        <div className="text-sm text-ink-800 dark:text-umber-100">{value}</div>
      </div>
    </div>
  );
}

/** 16:9 hero. When a vendor has uploaded a `hero_image_url` we render it;
 *  otherwise we draw a paper-toned monogram card so the page never opens
 *  on bare text. The empty state doubles as an acquisition surface: a
 *  small hint nudges unclaimed listings toward the vendor-claim flow. */
function HeroImage({
  detail,
  t,
  src,
}: {
  detail: SupplierDetail;
  t: (k: string) => string;
  /** The image to show big — the active thumbnail, or the hero when none is
   *  selected. Null (no photos at all) falls through to the monogram card. */
  src: string | null;
}) {
  if (src) {
    return (
      <div className="overflow-hidden rounded-2xl">
        {/* 16/9 crops harder than the thumbnail strip does, so the vendor's
            chosen band matters most here. Unframed photos stay centred. */}
        <img
          src={src}
          alt={detail.name}
          className="aspect-[16/9] w-full object-cover"
          style={{ objectPosition: `50% ${detail.gallery_positions_y?.[src] ?? 50}%` }}
        />
      </div>
    );
  }
  // Unified empty-state hero: Weddly wordmark + the category glyph on a
  // paper-toned card. Same template for every supplier (only the glyph
  // varies by category), so unclaimed listings read as "Weddly placeholder
  // for this category" rather than as a bespoke per-supplier monogram.
  const CategoryGlyph = CATEGORY_ICON[detail.category];
  return (
    <div
      role="img"
      aria-label={t("suppliers.detail.hero.noPhotoAria")}
      className="flex aspect-[16/9] w-full items-center justify-center rounded-2xl border-2 border-dashed border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800/60"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Wordmark size="lg" className="text-ink-700 dark:text-cream-100" />
        <CategoryGlyph
          size={72}
          strokeWidth={1.25}
          aria-hidden
          className="text-paper-600 dark:text-umber-400"
        />
        <div className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
          {t(
            detail.vendor_account_id
              ? "suppliers.detail.hero.noPhotoYet"
              : "suppliers.detail.hero.noPhotoClaim",
          )}
        </div>
      </div>
    </div>
  );
}

/** Five-dot price-band display. Active dots in `paper-600` (gold-oat),
 *  inactive in `paper-300` — same scale the directory filter uses, just
 *  rendered as a self-explanatory glyph row instead of "$  PRICE BAND
 *  $$$". The wrapper carries the semantic label so screen readers still
 *  hear "Price band: 3 of 5" without forcing sighted users to read it. */
function PriceBandDots({
  band,
  t,
}: {
  band: 1 | 2 | 3 | 4 | 5;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <span
      role="img"
      aria-label={t("suppliers.detail.priceBandAria", { band, max: 5 })}
      className="inline-flex items-center gap-0.5 font-mono text-sm"
      title={t("suppliers.detail.priceBandAria", { band, max: 5 })}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          aria-hidden
          className={
            n <= band ? "text-paper-700 dark:text-paper-300" : "text-paper-300 dark:text-umber-600"
          }
        >
          $
        </span>
      ))}
    </span>
  );
}

/** Right-rail info card. Slimmer than the original — CATEGORY moved out
 *  (duplicated the kicker above the H1), RATING moved out (duplicated the
 *  header chip), PRICE BAND moved into the header next to the rating
 *  (where it can sit as a single glyph row). What's left is just the one
 *  fact the header doesn't carry: the full street address. */
function InfoCard({
  detail,
  t,
  onOpenMap,
}: {
  detail: SupplierDetail;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onOpenMap: () => void;
}) {
  const value = detail.address ? `${detail.city} · ${detail.address}` : detail.city;
  return (
    <SidebarCard>
      {/* The whole address row is the map trigger — couples expect to click an
       *  address and see it on a map. The button stays full-width and left-
       *  aligned so it reads as the same row, just interactive. */}
      <button
        type="button"
        onClick={onOpenMap}
        title={t("suppliers.detail.map.open")}
        className="-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 text-left transition hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:hover:bg-umber-800/60 dark:focus-visible:ring-paper-100"
      >
        <SidebarRow icon={<MapPin size={14} aria-hidden />} value={value} />
      </button>
    </SidebarCard>
  );
}

function ContactCard({
  detail,
  t,
}: {
  detail: SupplierDetail;
  t: (k: string) => string;
}) {
  const hasAny = Boolean(
    detail.website || detail.contact_email || detail.contact_phone || detail.contact_phone_alt,
  );
  return (
    <SidebarCard>
      {!hasAny && (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.contact.empty")}
        </p>
      )}
      {detail.website && (
        <a
          href={`/r/supplier/${encodeURIComponent(detail.id)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
        >
          <Globe size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
          {t("suppliers.detail.contact.website")}
        </a>
      )}
      {detail.contact_email && (
        <a
          href={`mailto:${detail.contact_email}`}
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
        >
          <Mail size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
          {detail.contact_email}
        </a>
      )}
      {detail.contact_phone && (
        <a
          href={`tel:${detail.contact_phone}`}
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
        >
          <Phone size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
          {detail.contact_phone}
        </a>
      )}
      {/* Second published line, when a business runs one. No label: the icon
          already says "phone", and which desk answers is not something we can
          state accurately for every listing. */}
      {detail.contact_phone_alt && (
        <a
          href={`tel:${detail.contact_phone_alt}`}
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
        >
          <Phone size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
          {detail.contact_phone_alt}
        </a>
      )}
    </SidebarCard>
  );
}

// ─── Mini busy-calendar ──────────────────────────────────────────────────────

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function BusyCalendarCard({
  availability,
  weddingDate,
  locale,
  t,
}: {
  availability: SupplierAvailability | null;
  /** ISO wedding date; the calendar opens on this month when set (couples care
   *  about availability around the wedding, not today). Null → current month. */
  weddingDate: string | null;
  locale: Locale;
  t: (k: string) => string;
}) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState<{ year: number; month: number }>({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

  // Jump to the wedding month once, when the date is known (it may arrive after
  // the first render). A ref guards it so a couple browsing other months isn't
  // yanked back — and so a later re-render can't re-apply the default.
  const appliedWeddingMonth = useRef(false);
  useEffect(() => {
    if (appliedWeddingMonth.current || !weddingDate) return;
    const d = new Date(weddingDate);
    if (Number.isNaN(d.getTime())) return;
    appliedWeddingMonth.current = true;
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }, [weddingDate]);

  const blocked = useMemo(
    () => new Set(availability?.unavailable_dates ?? []),
    [availability?.unavailable_dates],
  );
  const partial = useMemo(
    () => new Set(availability?.partial_dates ?? []),
    [availability?.partial_dates],
  );

  const monthLabel = useMemo(() => {
    const d = new Date(cursor.year, cursor.month, 1);
    return new Intl.DateTimeFormat(intlLocale(locale), {
      month: "long",
      year: "numeric",
    }).format(d);
  }, [cursor, locale]);

  // Build a 6-row × 7-col grid starting on Monday (HU + EN both treat Monday
  // as week-start in this admin context; couples reading the public site can
  // get a Sunday-start later if EU/US locale flips).
  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.year, cursor.month, 1);
    // JS getDay: 0=Sun..6=Sat. We want Mon=0..Sun=6.
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(cursor.year, cursor.month, 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [cursor]);

  const dayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
      weekday: "narrow",
    });
    // 2026-05-25 is a Monday — use it as the anchor for Mon..Sun ordering.
    const monday = new Date(2026, 4, 25);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return fmt.format(d);
    });
  }, [locale]);

  const goto = (offset: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + offset, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const hasAny = blocked.size > 0 || partial.size > 0;

  return (
    <SidebarCard
      icon={<CalendarIcon size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />}
      title={t("suppliers.detail.busy.title")}
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => goto(-1)}
          aria-label={t("suppliers.detail.busy.prevMonth")}
          className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:text-umber-300 dark:hover:bg-umber-800"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <span className="text-sm font-medium capitalize text-ink-800 dark:text-umber-100">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => goto(1)}
          aria-label={t("suppliers.detail.busy.nextMonth")}
          className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:text-umber-300 dark:hover:bg-umber-800"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-ink-500 dark:text-umber-300">
        {dayLabels.map((l, i) => (
          <div key={i} className="py-1 uppercase">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.month;
          const iso = ymd(d);
          const isBlocked = blocked.has(iso);
          // Partial (certain-hours) blocks get a distinct amber marker; a full
          // block always wins if a day is somehow in both sets.
          const isPartial = !isBlocked && partial.has(iso);
          const isToday = ymd(d) === ymd(today);
          return (
            <div
              key={i}
              className={`flex h-8 items-center justify-center rounded text-xs transition ${
                !inMonth
                  ? "text-ink-300 dark:text-umber-500"
                  : isBlocked
                    ? "bg-rose-200/70 font-medium text-rose-800 line-through dark:bg-rose-500/40 dark:text-rose-50"
                    : isPartial
                      ? "bg-amber-200/60 font-medium text-amber-800 dark:bg-amber-500/35 dark:text-amber-50"
                      : "text-ink-700 dark:text-umber-100"
              } ${isToday && inMonth && !isBlocked && !isPartial ? "ring-1 ring-rose-400" : ""}`}
              title={isBlocked || isPartial ? iso : undefined}
            >
              {d.getDate()}
            </div>
          );
        })}
      </div>
      <div className="mt-3 space-y-1.5 text-[11px] text-ink-500 dark:text-umber-300">
        {!hasAny ? (
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded bg-rose-200/70 dark:bg-rose-500/40" />
            {t("suppliers.detail.busy.empty")}
          </div>
        ) : (
          <>
            {blocked.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded bg-rose-200/70 dark:bg-rose-500/40" />
                {t("suppliers.detail.busy.legendBooked")}
              </div>
            )}
            {partial.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded bg-amber-200/60 dark:bg-amber-500/35" />
                {t("suppliers.detail.busy.legendPartial")}
              </div>
            )}
          </>
        )}
      </div>
    </SidebarCard>
  );
}

// ─── Admin meta ──────────────────────────────────────────────────────────────

function AdminMetaSection({
  detail,
  t,
}: {
  detail: SupplierDetail;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <section className="mt-10 rounded-xl border border-dashed border-ink-300/60 bg-ink-50/40 p-5 text-sm dark:border-umber-600/60 dark:bg-umber-800/30">
      <h2 className="mb-3 font-grotesk text-base font-medium tracking-tight text-ink-700 dark:text-paper-100">
        {t("suppliers.detail.adminMeta.title")}
      </h2>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.id")}
          </dt>
          <dd className="font-mono">{detail.id}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.source")}
          </dt>
          <dd>{detail.source}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.vendorAccount")}
          </dt>
          <dd>{detail.vendor_account_id ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.commentsCount")}
          </dt>
          <dd>{detail.comments_count ?? "-"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.redirect")}
          </dt>
          <dd>
            <code className="font-mono">/r/supplier/{detail.id}</code>
          </dd>
        </div>
      </dl>
    </section>
  );
}
