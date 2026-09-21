// The couple-facing vendor page, laid out as a business PROFILE (the shape
// couples already know from booking marketplaces): a header with the rating and
// the vendor's answer for THEIR wedding date, a photo mosaic, a sticky section
// nav, then two columns. The main column reads packages (guide prices, each row
// a quote request), about, videos, reviews, availability and Q&A; the sticky
// right card carries the decision (inquire, like, pick) and the contact facts.
//
// Admins see the same page plus the operational extras (bookings list, admin
// meta). The route is behind <RequireAuth>; the admin-only data calls are
// skipped for couples.

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
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Banknote,
  BedDouble,
  Bookmark,
  BookmarkCheck,
  Brush,
  Building2,
  Bus,
  Cake,
  CalendarCheck,
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
  Heart,
  Lightbulb,
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
  showsCapacity,
  showsSpokenLanguages,
} from "@shared/suppliers";
import type { ListingPackage } from "@shared/listing_packages";
import { pickListingBlurb } from "@shared/listing_language";
import { packagePriceSummary } from "@shared/listing_pricing";
import type { Currency } from "@shared/types";
import { canonicalListingId, vendorPublicId } from "@shared/vendor_slug";
import { Pill } from "../components/admin";
import { ClaimListingModal } from "../components/ClaimListingModal";
import { ComposeDialog } from "../components/OutreachInbox";
import { ReportSupplierDialog } from "../components/ReportSupplierDialog";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { ReviewsSection } from "../components/ReviewsSection";
import { ReviewSummaryCard } from "../components/ReviewSummaryCard";
import { StarRow } from "../components/StarRow";
import { statedGuestCount } from "../lib/budget";
import { formatDate as formatYmd, intlLocale } from "../lib/format";
import { formatPackagePrice } from "../lib/listingPricing";
import { VendorPackageList } from "../components/VendorPackageCards";
import { LazyVideoPlayer } from "../components/VideoEmbed";
import { Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
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
import { useActiveSection, useScrolledPast } from "../lib/use_scroll_spy";
import { type WeddingDayStatus, weddingDayStatus } from "../lib/wedding_day_status";
import {
  readSaved as readSavedStore,
  setSaved as setSavedStore,
  subscribeSaved,
} from "../lib/supplier_saved";
import {
  readSelection,
  type SelectionMap,
  setSelection,
  subscribeSelection,
} from "../lib/supplier_selection";

// Lazy so the OpenStreetMap embed modal only loads when the user opens the map.
const SupplierMapModal = lazyWithReload(() => import("../components/SupplierMapModal"));

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

// Per-category glyph for the empty-state hero. Mirrors the mapping in
// SuppliersPage.tsx so the placeholder reads as "same brand, this category".
import { CATEGORY_ICON } from "../lib/category_icons";

const VISIBILITIES: CommentVisibility[] = ["admin_internal", "public", "vendor_only"];

// Anchors of the in-page sections the sticky nav jumps between. The Q&A section
// keeps its own `COMMENTS_ANCHOR_ID`, which the admin panel's counter already
// links to.
const SECTION_PACKAGES = "supplier-packages";
const SECTION_ABOUT = "supplier-about";
const SECTION_VIDEOS = "supplier-videos";
const SECTION_REVIEWS = "supplier-reviews";
const SECTION_AVAILABILITY = "supplier-availability";
/** A section counts as "current" once its top edge has passed this line, in px
 *  below the viewport top: the app header (~69px) plus the section nav (~49px)
 *  plus a little air. */
const SECTION_SCROLL_LINE = 150;

function formatDate(unixMs: number, locale: Locale): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
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
  // `?review=1` (RateVendorsPage's post-wedding nudge, same deep link the
  // public page's share/campaign links use) opens the reviews modal straight
  // to the composer instead of leaving the couple to find the CTA themselves.
  const [searchParams] = useSearchParams();
  const wantsReview = searchParams.get("review") === "1";

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
  // The headcount the couple has actually stated (null when they haven't), so a
  // per-guest package price can be scaled to THEIR wedding.
  const [coupleGuests, setCoupleGuests] = useState<number | null>(null);
  const [bookings, setBookings] = useState<SupplierBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  // The reviews list + composer live behind this modal now (see
  // ReviewSummaryCard); `wantsReview` opens it on arrival.
  const [reviewsOpen, setReviewsOpen] = useState(wantsReview);
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

  // Once loaded, upgrade a bare id in the address bar (`c17`) to the pretty,
  // name-based one (`oreg-tolgy-kastely-fogado-c17`) — the same slug the
  // Share button already produces for the public page (see `shareVendor`
  // below), so a URL copied straight from the bar reads as the business
  // rather than an opaque id too. `vendorPublicId` is a no-op for curated
  // slugs, so this only fires for `v{N}` / `c{N}` listings. `replace: true`
  // keeps the upgrade out of back-button history.
  useEffect(() => {
    if (!detail) return;
    const pretty = vendorPublicId(detail.id, detail.name);
    if (pretty === supplierIdRaw) return;
    const qs = searchParams.toString();
    navigate(`/app/suppliers/${encodeURIComponent(pretty)}${qs ? `?${qs}` : ""}`, {
      replace: true,
    });
  }, [detail, supplierIdRaw, searchParams, navigate]);

  // The canonical id the data currently in state was fetched for (`v12` /
  // `c17`), so the address-bar upgrade above — which changes `supplierId` to
  // the pretty, name-based form pointing at the SAME listing — doesn't cost a
  // second round trip for data we already have.
  const lastFetchedIdRef = useRef<string | null>(null);

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
      lastFetchedIdRef.current = d.id;
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
    if (!supplierId) return;
    const canonical = canonicalListingId(supplierId) ?? supplierId;
    if (canonical === lastFetchedIdRef.current) return;
    setLoading(true);
    void refresh();
  }, [supplierId, refresh]);

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
        setCoupleGuests(r.couple ? statedGuestCount(r.couple) : null);
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
    if (coupleId === null) {
      toast.info(t("suppliers.save_no_couple"));
      return;
    }
    if (savedKey === null) return;
    setSavedSet(setSavedStore(coupleId, savedKey, !savedSet.has(savedKey)));
  }, [coupleId, savedKey, savedSet, t, toast]);

  // "Our pick" state: the OTHER half of the directory's two-glyph vocabulary,
  // and a different promise from the heart above. The shortlist is cheap and
  // plural; `couple_picks` holds exactly ONE supplier per category ("this is
  // our photographer"), so picking here replaces whoever held the category.
  // Same server-side store the grid writes (`supplier_selection` →
  // `PUT /api/picks/:category`), which is why the card and this page can never
  // disagree, and why the partner's device sees it too. It lives here at all
  // because a couple who arrived from search lands on THIS page: the pick was
  // only settable back on the grid they may never return to.
  const [selection, setSelectionState] = useState<SelectionMap>({});
  useEffect(() => {
    if (coupleId === null) return;
    setSelectionState(readSelection(coupleId));
    return subscribeSelection(coupleId, (next) => setSelectionState(next));
  }, [coupleId]);
  // Keyed on the RESOLVED listing id for the same reason the shortlist is: a
  // pretty slug would store a pick the grid can't match.
  const pickCategory = detail?.category ?? null;
  const isPicked =
    pickCategory !== null && savedKey !== null && selection[pickCategory] === savedKey;
  const togglePicked = useCallback(async () => {
    if (coupleId === null) {
      toast.info(t("suppliers.save_no_couple"));
      return;
    }
    if (pickCategory === null || savedKey === null) return;
    // Un-picking the venue here wipes the couple-row copy Kulcsinfó/the
    // public guest page/the run sheet read (venue_sync.ts on the backend)
    // with no warning about what disappears, so it asks for confirmation right
    // here instead of a silent one-click un-save.
    if (isPicked && pickCategory === "venue") {
      const ok = await confirm({
        title: t("venue_picker.remove_confirm_title"),
        body: t("venue_picker.remove_confirm_body"),
        confirmLabel: t("venue_picker.remove_confirm_action"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!ok) return;
    }
    setSelectionState(setSelection(coupleId, pickCategory, isPicked ? null : savedKey));
  }, [coupleId, isPicked, pickCategory, savedKey, t, toast, confirm]);

  // Outreach compose modal — opens with the current supplier pre-attached
  // so the user can write a tailored inquiry without re-picking a vendor.
  const [composeOpen, setComposeOpen] = useState(false);
  // A pre-written message for the composer (a quote request for one package).
  // Null opens it blank, exactly as the Send inquiry button always has.
  const [composeDraft, setComposeDraft] = useState<{
    subjectKey: string;
    bodyKey: string;
    vars: Record<string, string | number>;
  } | null>(null);
  const openCompose = useCallback((pkg?: ListingPackage) => {
    setComposeDraft(
      pkg
        ? {
            subjectKey: "suppliers.detail.packages.requestSubject",
            bodyKey: "suppliers.detail.packages.requestBody",
            vars: { package: pkg.name },
          }
        : null,
    );
    setComposeOpen(true);
  }, []);

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
    const url = `${window.location.origin}/suppliers/${encodeURIComponent(
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

  // Profile-page chrome: the sticky section nav lights the section the reader is
  // in, and the booking card grows a name + rating once the H1 has scrolled away.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleGone = useScrolledPast(titleRef, detail?.id ?? null);
  const calendarShown = availability?.calendar_public !== false;
  const navIds = [
    ...(detail && detail.packages.length > 0 ? [SECTION_PACKAGES] : []),
    SECTION_ABOUT,
    ...(detail && detail.videos.length > 0 ? [SECTION_VIDEOS] : []),
    SECTION_REVIEWS,
    ...(calendarShown ? [SECTION_AVAILABILITY] : []),
    COMMENTS_ANCHOR_ID,
  ];
  const activeSection = useActiveSection(navIds, SECTION_SCROLL_LINE);
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);

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
  // `has_contact_email`, NEVER `contact_email`. The address itself is nulled on
  // every couple-facing payload (owner rule, 2026-07-31 — a mailbox is never
  // shown to a user), so a truthiness check on the value is a check that can
  // only ever be false: this disabled the Send inquiry button on all 356
  // listings at once, on desktop AND in the mobile sticky bar, leaving the
  // vendor page — the most discoverable way into outreach — with a dead primary
  // CTA and Messages ▸ Outreach as the only working door. The boolean is the
  // whole vocabulary the payload has for "there is a deliverable mailbox here",
  // and it agrees with what the send actually requires: `resolveSupplierContacts`
  // refuses a listing with no `contact_email` (400 `supplier_no_email`).
  const canInquire = detail.has_contact_email;
  const inquireLabel = t("suppliers.detail.cta.sendInquiry");
  const saveLabel = t(isSaved ? "suppliers.detail.cta.savedActive" : "suppliers.detail.cta.save");
  // Same aria pair the directory card uses, so a screen reader hears one
  // vocabulary across both surfaces.
  const saveAria = t(isSaved ? "suppliers.unsave_aria" : "suppliers.save_aria");
  const pickLabel = t(isPicked ? "suppliers.unpick_aria" : "suppliers.pick_aria");
  const shareLabel = t("suppliers.detail.cta.share");
  const priceSummary = packagePriceSummary(detail.packages);
  // The vendor's answer for THIS couple's day, when we can honestly give one.
  const weddingStatus = weddingDayStatus(availability, weddingDate);
  const weddingDateLabel = weddingDate ? formatYmd(weddingDate.slice(0, 10), locale) : "";
  const navItems = [
    ...(detail.packages.length > 0
      ? [{ id: SECTION_PACKAGES, label: t("suppliers.detail.packages.title") }]
      : []),
    { id: SECTION_ABOUT, label: t("suppliers.detail.about.title") },
    ...(detail.videos.length > 0
      ? [{ id: SECTION_VIDEOS, label: t("suppliers.detail.videos.title") }]
      : []),
    { id: SECTION_REVIEWS, label: t("suppliers.detail.reviews.title") },
    ...(calendarShown
      ? [{ id: SECTION_AVAILABILITY, label: t("suppliers.detail.busy.title") }]
      : []),
    { id: COMMENTS_ANCHOR_ID, label: t("suppliers.detail.comments.title") },
  ];

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

      {/* ─── HEADER ─────────────────────────────────────────────────────────
          Title first, then the photos, the way a business profile reads on the
          booking marketplaces couples already know: who, how good, where, and
          (the one thing a wedding adds) whether they are free on OUR day. */}
      <header>
        <div className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
          {t(`suppliers.cat.${detail.category}`)} · {detail.city}
        </div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1
            ref={titleRef}
            className="inline-flex flex-wrap items-center gap-x-2 text-3xl font-bold leading-tight tracking-tight text-ink-900 dark:text-paper-50 sm:text-4xl"
          >
            <span>{detail.name}</span>
            {detail.vendor_account_id !== null && (
              <VerifiedBadge size={28} complete={detail.listing_complete} />
            )}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {/* Community-report action, only for user-submitted tips (never a
                claimed vendor). Sits with share as one pair of round buttons. */}
            {detail.source === "community" && (
              <button
                type="button"
                onClick={() => setReporting({ id: Number(detail.id.slice(1)), name: detail.name })}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 text-ink-500 transition hover:border-ink-400 hover:bg-paper-100 hover:text-ink-700 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-500 dark:hover:bg-umber-700"
                aria-label={t("suppliers.report.aria_label")}
                title={t("suppliers.report.aria_label")}
              >
                <Flag size={16} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={shareVendor}
              aria-label={shareLabel}
              title={shareLabel}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-transparent text-ink-600 transition hover:border-ink-300 hover:bg-paper-100/70 hover:text-ink-800 dark:border-umber-700 dark:text-umber-200 dark:hover:border-umber-500 dark:hover:bg-umber-800"
            >
              <Share2 size={16} aria-hidden />
            </button>
          </div>
        </div>
        {detail.company_name && detail.company_name !== detail.name && (
          <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{detail.company_name}</p>
        )}

        {/* Row 1: rating, the wedding-day verdict, where. The rating lives here
            and only here (the sidebar's duplicate was removed long ago); the
            count scrolls to the reviews. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {ratingDisplay !== null && ratingAvg !== null ? (
            <button
              type="button"
              onClick={() => scrollToSection(SECTION_REVIEWS)}
              className="inline-flex items-center gap-2 rounded-md text-sm transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
            >
              <span className="font-semibold text-ink-900 dark:text-paper-50">{ratingDisplay}</span>
              <StarRow
                value={Math.round(ratingAvg)}
                size={16}
                ariaLabel={t("suppliers.detail.starsAria", { rating: ratingDisplay, max: 5 })}
              />
              <span className="text-ink-600 dark:text-umber-200">
                {t("suppliers.detail.reviewsCount", { n: ratingCount })}
              </span>
            </button>
          ) : (
            <span className="text-sm italic text-ink-500 dark:text-umber-300">
              {t("suppliers.detail.info.ratingEmpty")}
            </span>
          )}
          {weddingStatus && (
            <WeddingDayNote
              status={weddingStatus}
              date={weddingDateLabel}
              t={t}
              className="rounded-2xl px-3 py-1"
            />
          )}
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md text-sm text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:text-umber-200 dark:hover:text-paper-50"
          >
            <MapPin size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
            <span>{detail.city}</span>
            <span className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2 dark:text-paper-50">
              {t("suppliers.detail.map.open")}
            </span>
          </button>
        </div>

        {/* Row 2: the quick facts. `price_band` is a manual, cooldown-protected
            signal; the exact figure below it comes straight from the vendor's
            own packages and is what earns trust before a couple inquires. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          {detail.price_band !== null && <PriceBandDots band={detail.price_band} t={t} />}
          {priceSummary && (
            <button
              type="button"
              onClick={() => scrollToSection(SECTION_PACKAGES)}
              className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-ink-900 transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:text-paper-50"
            >
              <Banknote size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
              {formatPackagePrice(
                priceSummary.range,
                priceSummary.mode,
                detail.currency,
                locale,
                t,
              )}
            </button>
          )}
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
              {(detail.spoken_languages ?? []).map((c) => languageLabel(c, locale)).join(", ")}
            </span>
          )}
          {detail.venue_style && (
            <Pill tone="muted">{t(`suppliers.venue_style.${detail.venue_style}`)}</Pill>
          )}
          {/* Verified vendors carry the BadgeCheck next to the name; unclaimed
              listings keep a quiet muted pill so the missing state still has a
              clear label, not silence. */}
          {detail.vendor_account_id === null && (
            <Pill tone="muted">{t("suppliers.detail.unclaimed")}</Pill>
          )}
        </div>
      </header>

      {/* ─── PHOTOS ─────────────────────────────────────────────────────────
          Always renders SOMETHING: the mosaic, or a paper-toned placeholder so
          the page never opens with bare text on white (which also nudges an
          unclaimed listing toward the claim flow). */}
      <div className="mt-5">
        <VendorGallery
          layout="mosaic"
          images={detail.gallery_urls ?? []}
          name={detail.name}
          positionsY={detail.gallery_positions_y}
          emptyState={<HeroImage detail={detail} t={t} src={null} />}
        />
      </div>

      {/* ─── SECTION NAV ────────────────────────────────────────────────────
          Sticks under the app header (~69px) and lights the section in view.
          Only the sections this listing actually has. */}
      <nav
        aria-label={t("suppliers.detail.sectionsAria")}
        className="sticky top-[69px] z-20 mt-6 border-b border-paper-300 bg-paper-50/95 backdrop-blur dark:border-umber-700 dark:bg-umber-900/95"
      >
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => {
            const on = item.id === activeSection;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                aria-current={on ? "true" : undefined}
                className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-400 ${
                  on
                    ? "border-ink-900 font-semibold text-ink-900 dark:border-paper-50 dark:text-paper-50"
                    : "border-transparent text-ink-500 hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-100"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ─── MAIN COLUMN ────────────────────────────────────────────────── */}
        <main className="min-w-0">
          {/* Packages (árajánlat): the vendor's guide prices, laid out as a menu
              of rows. The place a service list sits on a booking profile, but
              a wedding vendor sells packages, not 30-minute slots, so each row
              asks for a QUOTE (pre-filled with the package) instead of booking a
              time. Structured pricing, the legacy price_text fallback and the
              attached PDF all live in <VendorPackageList>. */}
          {detail.packages.length > 0 && (
            <section id={SECTION_PACKAGES} className="mb-12 scroll-mt-36">
              <h2 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-paper-50">
                {t("suppliers.detail.packages.title")}
              </h2>
              <p className="mb-4 mt-1 text-sm text-ink-500 dark:text-umber-300">
                {t("suppliers.detail.packages.subtitle")}
              </p>
              <VendorPackageList
                packages={detail.packages}
                currency={detail.currency}
                capacityMin={detail.capacity_min}
                capacityMax={detail.capacity_max}
                couplesGuests={coupleGuests}
                locale={locale}
                t={t}
                onRequest={canInquire ? openCompose : undefined}
              />
            </section>
          )}

          {/* About / blurb */}
          <section id={SECTION_ABOUT} className="mb-12 scroll-mt-36">
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-paper-50">
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
            {/* The full street address, one click from the map. */}
            <button
              type="button"
              onClick={() => setMapOpen(true)}
              title={t("suppliers.detail.map.open")}
              className="mt-5 inline-flex items-start gap-2 rounded-lg text-left text-sm text-ink-800 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-100 dark:hover:text-paper-50"
            >
              <MapPin
                size={16}
                aria-hidden
                className="mt-0.5 shrink-0 text-ink-500 dark:text-umber-400"
              />
              <span>{detail.address ? `${detail.city} · ${detail.address}` : detail.city}</span>
            </button>
          </section>

          {/* Videos, a responsive grid (1 col on mobile, 2 from sm up) of lazy,
              click-to-play embeds. Renders only when the vendor added at least
              one. */}
          {detail.videos.length > 0 && (
            <section id={SECTION_VIDEOS} className="mb-12 scroll-mt-36">
              <h2 className="mb-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-paper-50">
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

          {/* Reviews: the average + 1-5★ bars, then the latest few in their own
              words. The full list and the composer open in a modal so the page
              doesn't scroll through every review to reach the calendar. */}
          <section id={SECTION_REVIEWS} className="mb-12 scroll-mt-36">
            <ReviewSummaryCard
              summary={detail.reviews_summary}
              locale={locale}
              t={t}
              onOpen={() => setReviewsOpen(true)}
            />
            <ReviewSnippets
              reviews={reviews ?? []}
              locale={locale}
              t={t}
              onOpen={() => setReviewsOpen(true)}
            />
          </section>
          <Dialog
            open={reviewsOpen}
            onClose={() => setReviewsOpen(false)}
            title={`${t("suppliers.detail.reviews.title")} (${ratingCount})`}
            role="dialog"
            closeOnBackdrop
            size="lg"
          >
            <ReviewsSection
              subject={{ kind: "supplier", id: supplierId }}
              reviews={reviews ?? []}
              avg={ratingAvg}
              count={ratingCount}
              canReview={canReview}
              alreadyReviewed={alreadyReviewed}
              category={detail.category}
              onChange={refresh}
              currency={coupleCurrency}
              isAdmin={isAdmin}
              hideHeader
            />
          </Dialog>

          {/* Availability. In the main column now (it was a sidebar card): the
              booking card beside it stays put while the couple reads the month,
              so the decision still sits next to the calendar. Drops out
              entirely for a vendor who publishes no calendar. */}
          {calendarShown && (
            <section id={SECTION_AVAILABILITY} className="mb-12 scroll-mt-36">
              <h2 className="mb-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-paper-50">
                {t("suppliers.detail.busy.title")}
              </h2>
              <div className="max-w-md">
                <BusyCalendarCard
                  availability={availability}
                  weddingDate={weddingDate}
                  locale={locale}
                  t={t}
                />
              </div>
            </section>
          )}

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
              availability from the calendar section instead. */}
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

        {/* ─── BOOKING CARD (sticky on lg+) ───────────────────────────────────
            One card: the decision (inquire, like, pick) and the facts that
            support it (the wedding-day verdict, address, phone, website). Below
            `lg` it falls to the end of the page; the fixed bar at the bottom
            keeps the same three actions in thumb reach. */}
        <aside className="lg:sticky lg:top-[8.5rem] lg:self-start">
          <BookingCard
            detail={detail}
            t={t}
            showIdentity={titleGone}
            ratingDisplay={ratingDisplay}
            ratingAvg={ratingAvg}
            ratingCount={ratingCount}
            weddingStatus={weddingStatus}
            weddingDateLabel={weddingDateLabel}
            nextAvailable={availability?.next_available ?? null}
            locale={locale}
            isSaved={isSaved}
            isPicked={isPicked}
            saveText={saveLabel}
            saveAria={saveAria}
            pickLabel={pickLabel}
            canInquire={canInquire}
            inquireLabel={inquireLabel}
            onToggleSaved={toggleSaved}
            onTogglePicked={togglePicked}
            onInquire={() => openCompose()}
            onOpenMap={() => setMapOpen(true)}
          />
        </aside>
      </div>

      {/* Mobile sticky action bar. On <lg the right rail is far below the
          fold (after reviews + Q&A + bookings + admin meta), which leaves
          the user with no persistent CTA. The bar pins Send inquiry, save
          and pick to the bottom of the viewport so the conversion path is
          always one thumb-reach away. `pb-24` on the outer container reserves
          the height so this never occludes the last article. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-paper-200 bg-paper-50/95 px-4 py-3 backdrop-blur lg:hidden dark:border-umber-700 dark:bg-umber-900/95">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          {/* Same two glyphs as the desktop row and as the directory card. The
              save used to be a solid sage fill here, which both stole the
              picked treatment AND put a second solid button beside the one
              blush CTA. A tinted plate with the filled heart says "saved"
              without competing with Send inquiry. */}
          <button
            type="button"
            onClick={toggleSaved}
            aria-pressed={isSaved}
            aria-label={saveAria}
            data-testid="supplier-save-toggle-mobile"
            className={
              isSaved
                ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-blush-300 bg-blush-50 text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300"
                : "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
            }
          >
            <Heart
              size={18}
              aria-hidden
              className={isSaved ? "fill-blush-500 text-blush-500" : ""}
            />
          </button>
          <button
            type="button"
            onClick={togglePicked}
            aria-pressed={isPicked}
            aria-label={pickLabel}
            data-testid="supplier-pick-toggle-mobile"
            className={
              isPicked
                ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sage-400 bg-sage-50 text-sage-700 dark:border-sage-600 dark:bg-sage-600/20 dark:text-sage-200"
                : "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
            }
          >
            {isPicked ? (
              <BookmarkCheck size={18} aria-hidden className="fill-sage-200" />
            ) : (
              <Bookmark size={18} aria-hidden />
            )}
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
            onClick={() => openCompose()}
            disabled={!canInquire}
            // Same explanation the desktop row carries. The bar renders below
            // `lg`, which includes hover-capable narrow desktops, so a greyed
            // CTA that says nothing is avoidable here too.
            title={canInquire ? undefined : t("suppliers.detail.cta.inquireDisabled")}
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
          initialDraft={composeDraft ?? undefined}
          onClose={() => setComposeOpen(false)}
          onSent={(campaign) => {
            setComposeOpen(false);
            // Say which of the two actually happened. An unclaimed listing only
            // ever gets an email, and calling that "sent" the same way as a
            // lead sitting in a vendor's client list is how a couple ends up
            // waiting on a reply from a dashboard nobody owns.
            const landed = campaign.messages.some((m) => m.delivery === "in_account");
            toast.success(
              t(
                landed
                  ? "suppliers.detail.cta.inquireSent"
                  : "suppliers.detail.cta.inquireSentEmail",
              ),
            );
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
  const blurb = pickListingBlurb(detail, locale);
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
    // The id is the jump target for the admin panel's comment counter, which
    // was a dead number sitting a screen below the thread it counts.
    <section id={COMMENTS_ANCHOR_ID} className="mb-12 scroll-mt-36">
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-ink-900 dark:text-paper-50">
        {t("suppliers.detail.comments.title")}
      </h2>

      {/* Q&A composer is admin-only in this cut. The visibility dropdown
          (admin_internal / public / vendor_only) is a moderation control, and
          couple-authored questions are a separate Phase-3 surface. */}
      {isAdmin && (
        <div className="mb-6 rounded-xl border border-ink-200/60 bg-paper-50 p-5 dark:border-umber-700/60 dark:bg-umber-800/40">
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
                  <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
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
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
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
                <div className="font-medium text-ink-900 dark:text-paper-50">{b.event_date}</div>
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
      <section className="mb-10 rounded-xl border border-ink-200/60 bg-paper-50 p-6 dark:border-umber-700/60 dark:bg-umber-800/40">
        <div className="mb-4 flex items-start gap-3">
          <ShieldCheck
            size={22}
            aria-hidden
            className="mt-0.5 shrink-0 text-paper-600 dark:text-paper-400"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
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
    <section className="mb-10 rounded-xl border border-ink-200/60 bg-paper-50 p-6 dark:border-umber-700/60 dark:bg-umber-800/40">
      <div className="mb-4 flex items-start gap-3">
        <ShieldCheck
          size={22}
          aria-hidden
          className="mt-0.5 shrink-0 text-paper-600 dark:text-paper-400"
        />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
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

function SidebarCard({ children }: { children: React.ReactNode }) {
  return (
    // Shared card elevation: a soft drop shadow lifts the card off the cream
    // page instead of a hard 1px border (dark mode keeps a faint ring since
    // shadows vanish on dark surfaces). Same radius + padding as the package
    // rows so the whole page reads as one system.
    <div className="rounded-2xl bg-white p-5 shadow-elevated ring-1 ring-black/[0.04] dark:bg-umber-900 dark:shadow-none dark:ring-umber-600">
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
      className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl border-2 border-dashed border-paper-300 sm:aspect-[2.3/1] bg-paper-100 dark:border-umber-700 dark:bg-umber-800/60"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Wordmark size="lg" className="text-ink-700 dark:text-paper-100" />
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

/** Tone per wedding-day verdict. Sage / amber / rose are the same three the
 *  calendar below uses for free / partly booked / booked, so the header chip and
 *  the month grid cannot disagree about what a colour means. */
const WEDDING_DAY_TONE: Record<WeddingDayStatus, string> = {
  free: "bg-sage-50 text-sage-700 dark:bg-sage-600/20 dark:text-sage-200",
  partial: "bg-amber-100/70 text-amber-800 dark:bg-amber-500/25 dark:text-amber-100",
  busy: "bg-rose-100/80 text-rose-800 dark:bg-rose-500/25 dark:text-rose-100",
};

/** The vendor's answer for the couple's own wedding date, as one line. */
function WeddingDayNote({
  status,
  date,
  t,
  className = "",
}: {
  status: WeddingDayStatus;
  date: string;
  t: (k: string, vars?: Record<string, string | number>) => string;
  className?: string;
}) {
  return (
    <span
      data-testid="wedding-day-note"
      data-status={status}
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${WEDDING_DAY_TONE[status]} ${className}`}
    >
      <CalendarCheck size={14} aria-hidden className="shrink-0" />
      {t(`suppliers.detail.weddingDay.${status}`, { date })}
    </span>
  );
}

/** The latest few written reviews, in the reviewers' own words, under the
 *  average + histogram. Clicking any of them opens the full list. */
function ReviewSnippets({
  reviews,
  locale,
  t,
  onOpen,
}: {
  reviews: SupplierReview[];
  locale: Locale;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onOpen: () => void;
}) {
  const latest = reviews
    .filter((r) => r.published && r.body && r.body.trim().length > 0)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 3);
  if (latest.length === 0) return null;
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-3">
      {latest.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={onOpen}
            className="flex h-full w-full flex-col rounded-2xl border border-paper-300 bg-white p-4 text-left transition hover:border-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:border-umber-600 dark:bg-umber-900 dark:hover:border-umber-500"
          >
            <span className="flex items-center justify-between gap-2">
              <StarRow value={r.rating} size={14} />
              <span className="text-xs text-ink-500 dark:text-umber-300">
                {formatDate(r.created_at, locale)}
              </span>
            </span>
            <span className="mt-2 line-clamp-4 text-sm leading-relaxed text-ink-700 dark:text-paper-100">
              {r.body}
            </span>
            <span className="mt-3 text-xs font-medium text-ink-600 dark:text-umber-200">
              {r.author.display_name}
              {r.verified ? ` · ${t("suppliers.detail.reviews.verifiedBadge")}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The sticky right-hand card: the decision (inquire, like, pick) and the facts
 *  that support it. Merges what used to be three cards (address, contact,
 *  actions) so it fits beside the content without outgrowing the viewport; the
 *  calendar moved into the main column for the same reason. */
function BookingCard({
  detail,
  t,
  locale,
  showIdentity,
  ratingDisplay,
  ratingAvg,
  ratingCount,
  weddingStatus,
  weddingDateLabel,
  nextAvailable,
  isSaved,
  isPicked,
  saveText,
  saveAria,
  pickLabel,
  canInquire,
  inquireLabel,
  onToggleSaved,
  onTogglePicked,
  onInquire,
  onOpenMap,
}: {
  detail: SupplierDetail;
  t: (k: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
  /** The page's own H1 has scrolled away, so the card says whose it is. */
  showIdentity: boolean;
  ratingDisplay: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  weddingStatus: WeddingDayStatus | null;
  weddingDateLabel: string;
  nextAvailable: string | null;
  isSaved: boolean;
  isPicked: boolean;
  saveText: string;
  saveAria: string;
  pickLabel: string;
  canInquire: boolean;
  inquireLabel: string;
  onToggleSaved: () => void;
  onTogglePicked: () => void;
  onInquire: () => void;
  onOpenMap: () => void;
}) {
  const hasContact = Boolean(detail.website || detail.contact_phone || detail.contact_phone_alt);
  const address = detail.address ? `${detail.city} · ${detail.address}` : detail.city;
  const rowLink =
    "flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60";

  return (
    <SidebarCard>
      {showIdentity && (
        <div className="mb-4 border-b border-paper-200 pb-4 dark:border-umber-700">
          <p className="text-lg font-bold leading-snug text-ink-900 dark:text-paper-50">
            {detail.name}
          </p>
          {ratingDisplay !== null && ratingAvg !== null && (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className="font-semibold text-ink-900 dark:text-paper-50">{ratingDisplay}</span>
              <StarRow value={Math.round(ratingAvg)} size={14} />
              <span className="text-ink-500 dark:text-umber-300">({ratingCount})</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onInquire}
          disabled={!canInquire}
          title={canInquire ? undefined : t("suppliers.detail.cta.inquireDisabled")}
          className="btn-accent w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={16} aria-hidden />
          {inquireLabel}
        </button>
        {/* The two-glyph vocabulary the directory uses: a blush HEART is the
            shortlist, a sage BOOKMARK is THE pick for the category. Kept as its
            own tinted strip so the pair reads as a group beside the one solid
            CTA above it. */}
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-paper-100 p-1.5 dark:bg-umber-800/50">
          <button
            type="button"
            onClick={onToggleSaved}
            aria-pressed={isSaved}
            aria-label={saveAria}
            title={saveAria}
            data-testid="supplier-save-toggle"
            className={
              isSaved
                ? "inline-flex items-center justify-center gap-1.5 rounded-full border border-blush-300 bg-blush-50 px-3 py-1.5 text-sm font-medium text-blush-700 transition hover:border-blush-400 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300"
                : "inline-flex items-center justify-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1.5 text-sm text-ink-600 transition hover:border-blush-300 hover:bg-blush-50 hover:text-blush-700 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-200 dark:hover:border-blush-400/40 dark:hover:bg-blush-400/15 dark:hover:text-blush-300"
            }
          >
            <Heart
              size={16}
              aria-hidden
              className={isSaved ? "fill-blush-500 text-blush-500" : ""}
            />
            {saveText}
          </button>
          <button
            type="button"
            onClick={onTogglePicked}
            aria-pressed={isPicked}
            aria-label={pickLabel}
            title={pickLabel}
            data-testid="supplier-pick-toggle"
            className={
              isPicked
                ? "inline-flex items-center justify-center gap-1.5 rounded-full border border-sage-400 bg-sage-50 px-3 py-1.5 text-sm font-medium text-sage-700 transition hover:border-sage-500 dark:border-sage-600 dark:bg-sage-600/20 dark:text-sage-200"
                : "inline-flex items-center justify-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1.5 text-sm text-ink-600 transition hover:border-sage-400 hover:bg-sage-50 hover:text-sage-700 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-200 dark:hover:border-sage-600 dark:hover:bg-sage-600/20 dark:hover:text-sage-300"
            }
          >
            {isPicked ? (
              <BookmarkCheck size={16} aria-hidden className="fill-sage-200" />
            ) : (
              <Bookmark size={16} aria-hidden />
            )}
            {pickLabel}
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-0.5 border-t border-paper-200 pt-3 dark:border-umber-700">
        {/* Whether they are free on OUR day: the live status line of a booking
            card. Without a stated wedding date (or a calendar we can trust) the
            next free date stands in, and without that, nothing. */}
        {weddingStatus ? (
          <WeddingDayNote
            status={weddingStatus}
            date={weddingDateLabel}
            t={t}
            className="mb-1 w-full rounded-xl px-3 py-2.5"
          />
        ) : nextAvailable ? (
          <SidebarRow
            icon={<CalendarCheck size={14} aria-hidden />}
            value={t("suppliers.detail.calendar.nextAvailable", {
              date: formatYmd(nextAvailable, locale),
            })}
          />
        ) : null}

        {/* The whole address row is the map trigger; couples expect to click an
            address and see it on a map. */}
        <button
          type="button"
          onClick={onOpenMap}
          title={t("suppliers.detail.map.open")}
          className="-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 text-left transition hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:hover:bg-umber-800/60 dark:focus-visible:ring-paper-100"
        >
          <SidebarRow icon={<MapPin size={14} aria-hidden />} value={address} />
        </button>

        {!hasContact && (
          <p className="px-2 py-1.5 text-sm italic text-ink-500 dark:text-umber-300">
            {t("suppliers.detail.contact.empty")}
          </p>
        )}
        {detail.website && (
          <a
            href={`/r/supplier/${encodeURIComponent(detail.id)}`}
            target="_blank"
            rel="noreferrer noopener"
            className={rowLink}
          >
            <Globe size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
            {t("suppliers.detail.contact.website")}
          </a>
        )}
        {/* No email row. A vendor's mailbox is never shown to a couple (the API
            sends null for every viewer); writing to them goes through the
            inquiry flow, which delivers to that address without publishing it. */}
        {detail.contact_phone && (
          <a href={`tel:${detail.contact_phone}`} className={rowLink}>
            <Phone size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
            {detail.contact_phone}
          </a>
        )}
        {/* Second published line, when a business runs one. No label: the icon
            already says "phone", and which desk answers is not something we can
            state accurately for every listing. */}
        {detail.contact_phone_alt && (
          <a href={`tel:${detail.contact_phone_alt}`} className={rowLink}>
            <Phone size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
            {detail.contact_phone_alt}
          </a>
        )}
      </div>
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
  const weddingIso = weddingDate ? weddingDate.slice(0, 10) : null;

  // The vendor publishes no availability. Drawing the grid anyway would show a
  // month with every day clear, which is a promise about their diary that nobody
  // made: the honest rendering of "we don't know" is no calendar at all. Still
  // null while the payload is in flight, so the card only disappears on a real
  // answer.
  if (availability && !availability.calendar_public) return null;

  return (
    <SidebarCard>
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
              } ${isToday && inMonth && !isBlocked && !isPartial ? "ring-1 ring-rose-400" : ""} ${
                weddingIso === iso && inMonth ? "ring-2 ring-blush-500" : ""
              }`}
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
        {weddingIso && (
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded ring-2 ring-blush-500" />
            {t("suppliers.detail.busy.legendWedding")}
          </div>
        )}
      </div>
    </SidebarCard>
  );
}

// ─── Admin meta ──────────────────────────────────────────────────────────────

/** Anchor shared by the Q&A section and the admin panel's counter. */
const COMMENTS_ANCHOR_ID = "supplier-comments";

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
          {/* A count with nothing behind it is a dead end: the thread it counts
              is on this same page, a screen up. Scroll there rather than
              re-rendering the comments inside a read-only meta panel. Zero
              stays plain text, since there is nothing to jump to. */}
          <dd>
            {detail.comments_count ? (
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById(COMMENTS_ANCHOR_ID);
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="inline-flex items-center gap-1 font-medium text-rose-600 underline-offset-2 transition-colors hover:underline dark:text-rose-300"
              >
                {detail.comments_count}
                <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            ) : (
              (detail.comments_count ?? "-")
            )}
          </dd>
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
