// Vendor workspace shell — the authenticated layout for role='vendor' users at
// /vendor/*. Mirrors AppShell's structure (sticky header with the wordmark +
// account menu + logout, a left nav rail) but is intentionally lean: vendors
// have seven primary surfaces, not the couple's twenty. Page chrome uses the
// standard horizontal padding (px-4 sm:px-6 lg:px-8 xl:px-10) so content isn't
// pressed to the edge.
//
// Below md the rail is replaced by a fixed bottom tab bar, the same 4-tabs-plus-
// More anatomy the couple /app has. The rail used to WRAP on a phone: six
// labelled tabs across two or three rows, above the page, on every screen, so a
// vendor opening any surface read the navigation before the work. The bar is
// icon-first (a one-word label under each glyph) and the two secondary surfaces
// — Statisztika, Vélemények — move into the More sheet, which is also where the
// header's preview + share buttons go, since a 360px header cannot hold five
// circular controls beside the wordmark.

import {
  BarChart3,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Home,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Share2,
  Star,
  Store,
  Sun,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { VendorPlan } from "@shared/vendor_plan";
import { useAuth } from "../lib/auth";
import {
  VENDOR_ACCOUNT_STALE_EVENT,
  VENDOR_STATS_STALE_EVENT,
  vendorBillingApi,
  vendorListingApi,
  vendorStatsApi,
} from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useNotifSeen } from "../lib/useNotifSeen";
import { useTheme } from "../lib/useTheme";
import { FeedbackDialog } from "./FeedbackDialog";
import { VendorPointsChip, VendorPointsRail, useVendorPoints } from "./VendorPointsRail";
import { VendorShareDialog } from "./VendorShareDialog";
import { VendorDemoOverlay } from "./VendorDemoOverlay";
import { Wordmark } from "./Wordmark";

type VendorNavItem = {
  to: string;
  labelKey: string;
  icon: ReactNode;
  end?: boolean;
  /** Rides the phone bottom bar. Exactly four carry it; everything else lands
   *  in the More sheet, which keeps the bar at 4 tabs + More on a 360px screen
   *  (72px per slot — enough for a 18px glyph and a one-word label). */
  tab?: boolean;
};

// Six work surfaces, and only work surfaces. Settings is deliberately NOT one
// of them: it is account housekeeping, not a place a vendor works, and it is
// already one click away from the profile chip at the foot of the rail and the
// profile menu in the header. Billing rides along inside it (the Csomag tab).
const VENDOR_ITEMS: VendorNavItem[] = [
  {
    to: "/vendor",
    labelKey: "vendor.nav.dashboard",
    icon: <LayoutDashboard size={18} />,
    end: true,
    tab: true,
  },
  { to: "/vendor/clients", labelKey: "vendor.nav.clients", icon: <Users size={18} />, tab: true },
  {
    to: "/vendor/calendar",
    labelKey: "vendor.nav.calendar",
    icon: <CalendarDays size={18} />,
    tab: true,
  },
  { to: "/vendor/listing", labelKey: "vendor.nav.listing", icon: <Store size={18} />, tab: true },
  { to: "/vendor/stats", labelKey: "vendor.nav.stats", icon: <BarChart3 size={18} /> },
  { to: "/vendor/reviews", labelKey: "vendor.nav.reviews", icon: <Star size={18} /> },
];

// localStorage key for the desktop nav rail collapsed/expanded preference.
const NAV_COLLAPSED_KEY = "weddly.vendor_nav_collapsed";

/** Shared styling for the header's circular icon buttons (share, theme, bell).
 *  They sit on the steel bar, so everything inverts: paper glyphs, a lighter
 *  steel hover wash instead of the page's paper-200, and a focus ring offset
 *  against the BAR colour rather than the page. Kept in one constant because
 *  the bell lives in its own component and would otherwise drift. */
const HEADER_ICON_BTN =
  "inline-flex h-11 w-11 items-center justify-center rounded-full text-paper-100 transition-colors hover:bg-steel-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-paper-100 focus-visible:ring-offset-2 focus-visible:ring-offset-steel-700 dark:hover:bg-steel-800 dark:focus-visible:ring-offset-steel-900";

/** Header notification bell, mirroring the planner shell's: live counts from
 *  the stats rollup (new inquiries + confirmed events in the next 7 days),
 *  every row a link, and a per-device seen-watermark so the dot clears when
 *  the panel is opened and re-arms when a count rises again. */
function VendorNotificationBell({
  newInquiries,
  upcomingWeek,
  newReviews,
  unreadMessages,
  ready,
}: {
  newInquiries: number;
  upcomingWeek: number;
  newReviews: number;
  unreadMessages: number;
  ready: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasNotifications =
    newInquiries > 0 || upcomingWeek > 0 || newReviews > 0 || unreadMessages > 0;
  const { dot, markSeen } = useNotifSeen(
    "weddly.vendor_notif_seen",
    {
      inquiries: newInquiries,
      upcoming: upcomingWeek,
      reviews: newReviews,
      // Unlike the other three this count is server-truth (booking_messages
      // .seen_at), so the watermark only decides whether the DOT re-arms.
      messages: unreadMessages,
    },
    ready,
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleOpen() {
    setOpen((v) => {
      if (!v) markSeen();
      return !v;
    });
  }

  const rowClass =
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleOpen}
        className={`relative ${HEADER_ICON_BTN}`}
        aria-label={t("vendor.notif.aria")}
        title={t("vendor.notif.heading")}
      >
        <Bell size={18} aria-hidden="true" />
        {/* Ringed against the steel bar so the dot still reads as a separate
            mark rather than a smudge on the bell. */}
        {dot && (
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-steel-700 dark:ring-steel-900" />
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] origin-top-right rounded-2xl border border-paper-300 bg-white p-2 font-grotesk shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
            {t("vendor.notif.heading")}
          </p>
          <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          {!hasNotifications && (
            <p className="px-3 py-3 text-sm text-ink-500 dark:text-umber-300">
              {t("vendor.notif.none")}
            </p>
          )}
          {newInquiries > 0 && (
            <Link
              to="/vendor/clients"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={rowClass}
            >
              <Inbox
                size={15}
                className="shrink-0 text-ink-400 dark:text-paper-400"
                aria-hidden="true"
              />
              <span>{t("vendor.notif.new_inquiries", { count: String(newInquiries) })}</span>
            </Link>
          )}
          {unreadMessages > 0 && (
            <Link
              to="/vendor/clients"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={rowClass}
            >
              <MessageCircle
                size={15}
                className="shrink-0 text-ink-400 dark:text-paper-400"
                aria-hidden="true"
              />
              <span>{t("vendor.notif.unread_messages", { count: String(unreadMessages) })}</span>
            </Link>
          )}
          {upcomingWeek > 0 && (
            <Link to="/vendor" role="menuitem" onClick={() => setOpen(false)} className={rowClass}>
              <CalendarClock
                size={15}
                className="shrink-0 text-ink-400 dark:text-paper-400"
                aria-hidden="true"
              />
              <span>{t("vendor.notif.upcoming_week", { count: String(upcomingWeek) })}</span>
            </Link>
          )}
          {newReviews > 0 && (
            <Link
              to="/vendor/reviews"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={rowClass}
            >
              <Star
                size={15}
                className="shrink-0 text-ink-400 dark:text-paper-400"
                aria-hidden="true"
              />
              <span>{t("vendor.notif.new_reviews", { count: String(newReviews) })}</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// Up-to-two-letter initials from the business name, for the profile-chip avatar.
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  const first = (words[0] ?? "")[0] ?? "";
  const second = (words[1] ?? "")[0] ?? "";
  return (first + second).toUpperCase();
}

/** Right-aligned identity control for the vendor header — the same dropdown
 *  the planner shell has, so the two pro workspaces read consistently:
 *  business name + email header, the plan (Csomag) row with a FREE/PRO chip,
 *  settings, back-to-landing, feedback, sign out. */
function VendorProfileMenu({
  displayName,
  email,
  plan,
  onLogout,
  onOpenFeedback,
}: {
  displayName: string;
  email: string | null;
  plan: VendorPlan | null;
  onLogout: () => void;
  onOpenFeedback: () => void;
}) {
  const { t } = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-close on navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on path change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const itemClass =
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("vendor.shell.menu_label")}
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex h-9 items-center gap-2 rounded-full pl-1 pr-2 text-paper-50 transition-colors hover:bg-steel-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-paper-100 focus-visible:ring-offset-2 focus-visible:ring-offset-steel-700 dark:hover:bg-steel-800 dark:focus-visible:ring-offset-steel-900"
      >
        {/* The avatar inverts on the steel bar. A steel-600 chip on a steel-700
            header is a one-step difference nobody can see, so it goes light and
            becomes the brightest thing in the row, which is right: it is the
            control the vendor reaches for most. */}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-50 text-xs font-semibold uppercase text-steel-700 dark:bg-paper-100 dark:text-steel-900">
          {initialsOf(displayName)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {displayName}
        </span>
        <ChevronDown size={15} aria-hidden="true" className="text-steel-200" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-1rem)] origin-top-right rounded-2xl border border-paper-300 bg-white p-2 font-grotesk shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
              {displayName}
            </p>
            {email && <p className="truncate text-xs text-ink-500 dark:text-umber-300">{email}</p>}
          </div>
          <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          {plan && (
            <Link
              to="/vendor/settings/billing"
              role="menuitem"
              className={`${itemClass} justify-between`}
            >
              <span className="inline-flex items-center gap-2">
                <CreditCard size={16} aria-hidden="true" />
                <span>{t("vendor.shell.menu_plan")}</span>
              </span>
              <span className="text-xs font-medium text-ink-500 dark:text-paper-400">
                {t(plan === "pro" ? "vendor.plan.pro_label" : "vendor.plan.free_label")}
              </span>
            </Link>
          )}
          <Link to="/vendor/settings" role="menuitem" className={itemClass}>
            <Settings size={16} aria-hidden="true" />
            <span>{t("vendor.shell.menu_settings")}</span>
          </Link>
          <Link to="/" role="menuitem" className={itemClass}>
            <Home size={16} aria-hidden="true" />
            <span>{t("profile.menu_landing")}</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenFeedback();
            }}
            className={`${itemClass} w-full`}
          >
            <MessageCircle size={16} aria-hidden="true" />
            <span>{t("landing.nav_feedback")}</span>
          </button>
          <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className={`${itemClass} w-full`}
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{t("common.sign_out")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** One slot in the phone bottom bar: the glyph, an optional count badge, and a
 *  one-word label under it. The label stays because a bare glyph row is only
 *  self-evident once you already know the app — but it is 10px and truncating,
 *  so the icon is what carries the row at 360px. */
function VendorTabLink({
  to,
  icon,
  label,
  end,
  badgeCount,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  end?: boolean;
  badgeCount?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] ${
          isActive ? "text-blush-600 dark:text-blush-300" : "text-ink-500 dark:text-paper-400"
        }`
      }
    >
      <span className="relative inline-flex">
        {icon}
        {badgeCount && badgeCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-blush-500 px-1 py-0.5 text-[9px] font-semibold leading-none text-white"
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        ) : null}
      </span>
      <span className="w-full truncate text-center">{label}</span>
    </NavLink>
  );
}

/** Bottom sheet behind the bar's More tab: the nav destinations that didn't
 *  make the four tabs, plus the header actions that don't fit a phone header.
 *  Portal-mounted so it floats over the fixed bar with its own backdrop. */
function VendorMoreSheet({
  items,
  actions,
  title,
  closeLabel,
  onClose,
  translate,
}: {
  items: VendorNavItem[];
  actions: Array<{
    key: string;
    label: string;
    icon: ReactNode;
    /** Internal route, unless `external` — then a new tab, so an editor full of
     *  unsaved changes survives the trip to the public page. */
    to?: string;
    external?: boolean;
    onClick?: () => void;
  }>;
  title: string;
  closeLabel: string;
  onClose: () => void;
  translate: (key: string) => string;
}) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const actionClass =
    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800";

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 backdrop-blur-sm md:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="safe-edges w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t border-paper-300 bg-paper-50 px-4 pb-3 pt-4 shadow-pop dark:border-umber-700 dark:bg-umber-900 dark:text-paper-100"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-grotesk text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border px-2 text-center text-xs ${
                    isActive
                      ? "border-blush-300 bg-blush-50 text-blush-700 dark:border-blush-400/40 dark:bg-blush-500/15 dark:text-blush-200"
                      : "border-paper-300 text-ink-700 hover:bg-paper-200 dark:border-umber-700 dark:text-paper-200 dark:hover:bg-umber-800"
                  }`
                }
              >
                {item.icon}
                <span className="w-full truncate">{translate(item.labelKey)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        {actions.length > 0 && (
          <div className="mt-3 border-t border-paper-300 pt-2 dark:border-umber-700">
            {actions.map((action) =>
              action.to ? (
                <Link
                  key={action.key}
                  to={action.to}
                  {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  onClick={onClose}
                  className={actionClass}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </Link>
              ) : (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => {
                    onClose();
                    action.onClick?.();
                  }}
                  className={actionClass}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function VendorShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Best-effort fetch of the vendor's business name for the header. A vendor
  // without a listing yet just sees the brand fallback — never blocks render.
  const [businessName, setBusinessName] = useState<string | null>(null);
  // Listing id + name build the public profile URL behind the header's share
  // button. Null until the fetch lands (or forever, for an account with no
  // listing yet), which is exactly when the button should not be there.
  const [listing, setListing] = useState<{ id: string; name: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      vendorListingApi
        .me()
        .then((view) => {
          if (cancelled) return;
          setBusinessName(view.account.display_name);
          setListing({ id: view.listing.id, name: view.listing.name });
        })
        .catch(() => {
          /* no listing/account yet — fall back to the generic label */
        });
    };
    load();
    // A rename from either settings tab is the one edit that must show up here
    // immediately: the header IS the name, so a stale one reads as "the save
    // did nothing", which is what the two-name split used to feel like.
    window.addEventListener(VENDOR_ACCOUNT_STALE_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(VENDOR_ACCOUNT_STALE_EVENT, load);
    };
  }, []);

  // Derived FREE/PRO plan for the profile menu's Csomag chip. Fetched once;
  // a failed fetch just hides the plan row.
  const [plan, setPlan] = useState<VendorPlan | null>(null);
  useEffect(() => {
    let cancelled = false;
    vendorBillingApi
      .get()
      .then((res) => {
        if (!cancelled) setPlan(res.plan);
      })
      .catch(() => {
        /* no sub row yet / network — the menu simply omits the chip */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Feedback dialog, opened from the profile menu (same home as the planner
  // and couple shells).
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Phone bottom bar's More sheet.
  const [moreOpen, setMoreOpen] = useState(false);

  // Weddly Points — fetched once here and handed to both surfaces: the rail
  // block from md up, the header chip below it.
  const points = useVendorPoints();

  // New-inquiry badge on the Ügyfelek nav item: inquiries still 'requested'
  // that the vendor has never OPENED (`supplier_bookings.vendor_seen_at`, so
  // the same lead doesn't badge again on their phone). It used to count every
  // 'requested' row, which meant a vendor who read a lead and left the status
  // alone — nothing forces them to triage — carried the badge forever and the
  // number stopped meaning anything. Re-fetched on every route change inside
  // the shell, plus on VENDOR_STATS_STALE_EVENT so opening a client clears its
  // share immediately. Best-effort; a failed fetch just hides the badge.
  const { pathname } = useLocation();
  // Bumped by the staleness event to force the fetch effect to re-run.
  const [statsNonce, setStatsNonce] = useState(0);
  useEffect(() => {
    const onStale = () => setStatsNonce((n) => n + 1);
    window.addEventListener(VENDOR_STATS_STALE_EVENT, onStale);
    return () => window.removeEventListener(VENDOR_STATS_STALE_EVENT, onStale);
  }, []);
  const [newInquiries, setNewInquiries] = useState(0);
  // Confirmed events in the next 7 days, for the header bell.
  const [upcomingWeek, setUpcomingWeek] = useState(0);
  // Published reviews from the last 30 days, also for the bell.
  const [newReviews, setNewReviews] = useState(0);
  // Unseen couple messages across every client. Server-truth, not derived from
  // a status column.
  const [unreadMessages, setUnreadMessages] = useState(0);
  // Stays false until the first stats fetch lands, so the bell's seen-watermark
  // never sees the transient all-zero mount state (and never on fetch failure;
  // the counts are unknown then, not zero).
  const [statsReady, setStatsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    vendorStatsApi
      .get()
      .then((stats) => {
        if (cancelled) return;
        setNewInquiries(stats.new_inquiries);
        const weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
        setUpcomingWeek(stats.upcoming.filter((u) => u.event_date <= weekEnd).length);
        setNewReviews(stats.reviews_recent);
        setUnreadMessages(stats.unread_messages);
        setStatsReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setNewInquiries(0);
          setUpcomingWeek(0);
          setNewReviews(0);
          setUnreadMessages(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, statsNonce]);

  // The sheet is portal-mounted, so a tap that navigates would otherwise leave
  // it open on top of the page it just opened.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Warm-dark mode, shared with the other shells via localStorage. Like the
  // couple /app, the vendor workspace defaults to dark on first visit.
  const [theme, setTheme] = useTheme("dark");

  // Desktop nav rail collapse state, persisted across sessions. Default expanded.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === "1");
    } catch {
      /* localStorage unavailable - keep the expanded default */
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* best-effort persistence */
      }
      return next;
    });
  }

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const displayName = businessName ?? t("vendor.nav.brand_fallback");

  return (
    <div className="min-h-screen overflow-x-clip bg-white dark:bg-umber-900">
      <VendorDemoOverlay />
      {/* The chrome carries the portal's steel accent rather than sitting on
          the same white as the page. A vendor lives in this thing all day and a
          white bar over white content gave the app no edge at all: the sticky
          header was invisible until you scrolled something under it. Steel-700
          is dark enough for paper-50 text to clear AA at this size, so the
          wordmark and every icon simply invert.

          The bar is opaque, not the usual /90 + blur: a translucent dark strip
          picks up whatever colour scrolls beneath it, which reads as a bug on a
          surface this saturated. */}
      <header className="sticky top-0 z-30 border-b border-steel-800 bg-steel-700 dark:border-steel-800 dark:bg-steel-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <Link
            to="/vendor"
            className="inline-flex h-11 items-center rounded-lg text-paper-50 transition-colors hover:text-steel-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-paper-100 focus-visible:ring-offset-2 focus-visible:ring-offset-steel-700 dark:focus-visible:ring-offset-steel-900"
          >
            <Wordmark size="sm" />
          </Link>
          <div className="flex items-center gap-1">
            {/* "See my page as a couple sees it" is the same task on every
                screen, so it lives here rather than being re-invented per page:
                it used to be a text link on Hirdetésem and a second one inside
                the Vélemények empty state, and existed nowhere else. New tab,
                so an editor full of unsaved changes survives the trip. */}
            {/* Both this and Share drop off the phone header and reappear in
                the More sheet: five 44px controls plus the wordmark and the
                avatar do not fit 360px, and these are the two a vendor reaches
                for least often. */}
            {listing && (
              <Link
                to={`/vendors/${listing.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`hidden md:inline-flex ${HEADER_ICON_BTN}`}
                aria-label={t("vendor_home.preview_open")}
                title={t("vendor_home.preview_open")}
              >
                <ExternalLink size={18} aria-hidden="true" />
              </Link>
            )}
            {/* Share the public profile. Sits with the other header actions
                because "send someone my Weddly page" is not a task that belongs
                to any one page — it used to exist only on Vélemények, pointed
                at the review composer. */}
            {listing && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className={`hidden md:inline-flex ${HEADER_ICON_BTN}`}
                aria-label={t("vendor.share.title")}
                title={t("vendor.share.title")}
              >
                <Share2 size={18} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={HEADER_ICON_BTN}
              aria-label={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
              title={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
            >
              {theme === "dark" ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
            </button>
            {/* Phone only: from md the same score is a block in the rail, and
                two copies of one number in one viewport is one too many. */}
            <VendorPointsChip points={points} className="md:hidden" />
            <VendorNotificationBell
              newInquiries={newInquiries}
              upcomingWeek={upcomingWeek}
              newReviews={newReviews}
              unreadMessages={unreadMessages}
              ready={statsReady}
            />
            <VendorProfileMenu
              displayName={displayName}
              email={user?.email ?? null}
              plan={plan}
              onLogout={() => void onLogout()}
              onOpenFeedback={() => setFeedbackOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* The gap widens only from lg, where this flex turns into a real
          sidebar-plus-content row. At md the rail is still the wrapped tab row
          above the page, and 32px there would just push content down a screen
          that has no height to spare. The phone's extra bottom padding clears
          the fixed tab bar (56px + the home-indicator inset). */}
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 md:pb-12 lg:flex-row lg:gap-8 lg:px-8 xl:max-w-screen-2xl xl:px-10">
        {/* Left rail from lg (collapsible icon rail); a wrapped tab row at md.
            Below md the fixed bottom bar replaces it entirely. The width
            animates between expanded (14rem) and collapsed (4rem); collapse
            applies to lg+ only. */}
        <aside
          className={`hidden shrink-0 transition-[width] duration-200 ease-out md:block ${
            collapsed ? "lg:w-16" : "lg:w-56"
          }`}
        >
          {/* Mobile: wrap the tabs across rows so none get pushed off-screen
              (a horizontal scroller silently clipped the later tabs with no
              affordance). Desktop: the vertical, sticky rail.
              The row gap is deliberately wider than the column gap: once the
              tabs wrap (roughly 660-700px, a tablet or a narrowed window) a
              4px gap left the second row sitting on the first, and the points
              block landed against the last tab with nothing between them. */}
          <nav className="flex flex-wrap gap-x-1 gap-y-2 lg:sticky lg:top-20 lg:flex-col lg:flex-nowrap lg:gap-0.5 lg:overflow-visible">
            {/* Collapse toggle at the TOP of the rail - desktop only. */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={
                collapsed ? t("vendor.nav.expand_sidebar") : t("vendor.nav.collapse_sidebar")
              }
              title={collapsed ? t("vendor.nav.expand_sidebar") : t("vendor.nav.collapse_sidebar")}
              className={`mb-1 hidden shrink-0 items-center gap-3 rounded-xl py-2 text-sm text-ink-600 transition-colors hover:bg-paper-100 lg:flex dark:text-paper-300 dark:hover:bg-umber-800 ${
                collapsed ? "justify-center px-0" : "px-3"
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen
                  size={18}
                  aria-hidden="true"
                  className="text-ink-400 dark:text-paper-400"
                />
              ) : (
                <PanelLeftClose
                  size={18}
                  aria-hidden="true"
                  className="text-ink-400 dark:text-paper-400"
                />
              )}
              <span className={collapsed ? "hidden" : ""}>{t("vendor.nav.collapse_sidebar")}</span>
            </button>

            {VENDOR_ITEMS.map((item) => {
              const label = t(item.labelKey);
              const badge = item.to === "/vendor/clients" && newInquiries > 0 ? newInquiries : null;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    `relative flex shrink-0 items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                      collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3"
                    } ${
                      // The accent marks WHERE YOU ARE and nothing else in this
                      // rail. A tinted pill rather than a solid one: the label
                      // is what you read, the colour only has to say "this row".
                      isActive
                        ? "bg-blush-50 text-blush-700 dark:bg-blush-500/15 dark:text-blush-200 [&_svg]:text-blush-600 dark:[&_svg]:text-blush-300"
                        : "text-ink-800 hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800 [&_svg]:text-ink-400 dark:[&_svg]:text-paper-400"
                    }`
                  }
                >
                  {item.icon}
                  <span className={collapsed ? "lg:hidden" : ""}>{label}</span>
                  {badge !== null && (
                    <span
                      aria-label={t("vendor.nav.new_inquiries", { count: String(badge) })}
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blush-500 px-1.5 text-[11px] font-semibold leading-none text-white ${
                        collapsed ? "lg:absolute lg:-right-0.5 lg:-top-0.5 lg:ml-0" : "ml-auto"
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </NavLink>
              );
            })}

            {/* Weddly Points, docked under the nav. Collapses to the ring
                alone on the icon rail; stays a full block on mobile, where
                there is no collapsed state. */}
            <VendorPointsRail collapsed={collapsed} points={points} />

            {/* No profile chip at the foot of the rail: the same avatar, the
                same business name and the same route already sit in the header
                menu, top right, on every screen. Two copies of one control made
                the rail end on account housekeeping rather than on the work. */}
          </nav>
        </aside>
        <main id="main-content" className="min-w-0 flex-1 focus:outline-none">
          {children}
        </main>
      </div>

      {/* Phone bottom bar — the four tab-flagged surfaces plus More. Opaque
          rather than translucent, like the header: a see-through strip over a
          photo grid (the listing editor's gallery) reads as a rendering fault.
          `translateZ` keeps iOS Safari from recompositing the bar every time
          the address bar slides. */}
      <nav
        style={{ transform: "translateZ(0)", willChange: "transform" }}
        className="safe-edges fixed bottom-0 left-0 right-0 z-30 border-t border-paper-300 bg-paper-50 md:hidden dark:border-umber-700 dark:bg-umber-900"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 px-2 py-1.5">
          {VENDOR_ITEMS.filter((item) => item.tab).map((item) => (
            <VendorTabLink
              key={item.to}
              to={item.to}
              end={item.end}
              icon={item.icon}
              label={t(item.labelKey)}
              badgeCount={item.to === "/vendor/clients" ? newInquiries : 0}
            />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] ${
              moreOpen ? "text-blush-600 dark:text-blush-300" : "text-ink-500 dark:text-paper-400"
            }`}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
            <span className="w-full truncate text-center">{t("vendor.nav.more")}</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <VendorMoreSheet
          items={VENDOR_ITEMS.filter((item) => !item.tab)}
          actions={[
            ...(listing
              ? [
                  {
                    key: "preview",
                    label: t("vendor_home.preview_open"),
                    icon: <ExternalLink size={18} aria-hidden="true" />,
                    to: `/vendors/${listing.id}`,
                    external: true,
                  },
                  {
                    key: "share",
                    label: t("vendor.share.title"),
                    icon: <Share2 size={18} aria-hidden="true" />,
                    onClick: () => setShareOpen(true),
                  },
                ]
              : []),
            {
              key: "settings",
              label: t("vendor.shell.menu_settings"),
              icon: <Settings size={18} aria-hidden="true" />,
              to: "/vendor/settings",
            },
          ]}
          title={t("vendor.nav.more_sheet_title")}
          closeLabel={t("a11y.close")}
          onClose={() => setMoreOpen(false)}
          translate={t}
        />
      )}

      {listing && (
        <VendorShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          listingId={listing.id}
          listingName={listing.name}
        />
      )}

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        source="app"
        context={pathname}
      />
    </div>
  );
}

/** Route-layout wrapper. Mount at the parent `/vendor` route so the shell stays
 *  mounted across vendor navigation; child pages return their content only. */
export function VendorShellLayout() {
  return (
    <VendorShell>
      <Outlet />
    </VendorShell>
  );
}
