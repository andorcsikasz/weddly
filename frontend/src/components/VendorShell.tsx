// Vendor workspace shell — the authenticated layout for role='vendor' users at
// /vendor/*. Mirrors AppShell's structure (sticky header with the wordmark +
// account menu + logout, a left nav rail) but is intentionally lean: vendors
// have six primary surfaces, not the couple's twenty. The nav rail collapses to
// a horizontal scroller on mobile. Page chrome uses the standard horizontal
// padding (px-4 sm:px-6 lg:px-8 xl:px-10) so content isn't pressed to the edge.

import {
  BarChart3,
  Bell,
  CalendarClock,
  ChevronDown,
  CreditCard,
  Home,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Store,
  Sun,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { VendorPlan } from "@shared/vendor_plan";
import { useAuth } from "../lib/auth";
import { vendorBillingApi, vendorListingApi, vendorStatsApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useNotifSeen } from "../lib/useNotifSeen";
import { useTheme } from "../lib/useTheme";
import { FeedbackDialog } from "./FeedbackDialog";
import { VendorDemoOverlay } from "./VendorDemoOverlay";
import { Wordmark } from "./Wordmark";

type VendorNavItem = { to: string; labelKey: string; icon: ReactNode; end?: boolean };

// Billing is reachable through Settings (the Csomag tab) + the profile menu,
// so the rail stays at five primary surfaces.
const VENDOR_ITEMS: VendorNavItem[] = [
  {
    to: "/vendor",
    labelKey: "vendor.nav.dashboard",
    icon: <LayoutDashboard size={18} />,
    end: true,
  },
  { to: "/vendor/clients", labelKey: "vendor.nav.clients", icon: <Users size={18} /> },
  { to: "/vendor/listing", labelKey: "vendor.nav.listing", icon: <Store size={18} /> },
  { to: "/vendor/stats", labelKey: "vendor.nav.stats", icon: <BarChart3 size={18} /> },
  { to: "/vendor/settings", labelKey: "vendor.nav.settings", icon: <Settings size={18} /> },
];

// localStorage key for the desktop nav rail collapsed/expanded preference.
const NAV_COLLAPSED_KEY = "weddly.vendor_nav_collapsed";

/** Header notification bell, mirroring the planner shell's: live counts from
 *  the stats rollup (new inquiries + confirmed events in the next 7 days),
 *  every row a link, and a per-device seen-watermark so the dot clears when
 *  the panel is opened and re-arms when a count rises again. */
function VendorNotificationBell({
  newInquiries,
  upcomingWeek,
  ready,
}: {
  newInquiries: number;
  upcomingWeek: number;
  ready: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasNotifications = newInquiries > 0 || upcomingWeek > 0;
  const { dot, markSeen } = useNotifSeen(
    "weddly.vendor_notif_seen",
    { inquiries: newInquiries, upcoming: upcomingWeek },
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
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100"
        aria-label={t("vendor.notif.aria")}
        title={t("vendor.notif.heading")}
      >
        <Bell size={18} aria-hidden="true" />
        {dot && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />}
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
              <Inbox size={15} className="shrink-0 text-blush-500" aria-hidden="true" />
              <span>{t("vendor.notif.new_inquiries", { count: String(newInquiries) })}</span>
            </Link>
          )}
          {upcomingWeek > 0 && (
            <Link to="/vendor" role="menuitem" onClick={() => setOpen(false)} className={rowClass}>
              <CalendarClock size={15} className="shrink-0 text-steel-500" aria-hidden="true" />
              <span>{t("vendor.notif.upcoming_week", { count: String(upcomingWeek) })}</span>
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
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-steel-50 dark:text-paper-100 dark:hover:bg-umber-700";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("vendor.shell.menu_label")}
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex h-9 items-center gap-2 rounded-full pl-1 pr-2 text-ink-700 transition-colors hover:bg-steel-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-steel-500 focus-visible:ring-offset-2 dark:text-paper-100 dark:hover:bg-umber-800 dark:focus-visible:ring-steel-300"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-steel-600 text-xs font-semibold uppercase text-paper-50">
          {initialsOf(displayName)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {displayName}
        </span>
        <ChevronDown size={15} aria-hidden="true" className="text-ink-500 dark:text-umber-300" />
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
              <span className="text-xs font-medium text-steel-700 dark:text-steel-300">
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

export function VendorShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Best-effort fetch of the vendor's business name for the header. A vendor
  // without a listing yet just sees the brand fallback — never blocks render.
  const [businessName, setBusinessName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    vendorListingApi
      .me()
      .then((view) => {
        if (!cancelled) setBusinessName(view.account.display_name);
      })
      .catch(() => {
        /* no listing/account yet — fall back to the generic label */
      });
    return () => {
      cancelled = true;
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

  // New-inquiry badge on the Ügyfelek nav item: the count of bookings still in
  // 'requested' (the vendor hasn't looked yet). Re-fetched on every route
  // change inside the shell, so opening a client and moving it along clears
  // the badge on the next navigation without a reload. Best-effort; a failed
  // fetch just hides the badge.
  const { pathname } = useLocation();
  const [newInquiries, setNewInquiries] = useState(0);
  // Confirmed events in the next 7 days, for the header bell.
  const [upcomingWeek, setUpcomingWeek] = useState(0);
  // Stays false until the first stats fetch lands, so the bell's seen-watermark
  // never sees the transient all-zero mount state (and never on fetch failure —
  // the counts are unknown then, not zero).
  const [statsReady, setStatsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    vendorStatsApi
      .get()
      .then((stats) => {
        if (cancelled) return;
        setNewInquiries(stats.by_status.requested ?? 0);
        const weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
        setUpcomingWeek(stats.upcoming.filter((u) => u.event_date <= weekEnd).length);
        setStatsReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setNewInquiries(0);
          setUpcomingWeek(0);
        }
      });
    return () => {
      cancelled = true;
    };
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
    <div className="min-h-full overflow-x-clip">
      <VendorDemoOverlay />
      <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <Link
            to="/vendor"
            className="inline-flex h-11 items-center text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
          >
            <Wordmark size="sm" />
          </Link>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100"
              aria-label={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
              title={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
            >
              {theme === "dark" ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
            </button>
            <VendorNotificationBell
              newInquiries={newInquiries}
              upcomingWeek={upcomingWeek}
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

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pb-12 pt-6 sm:px-6 lg:flex-row lg:px-8 xl:max-w-screen-2xl xl:px-10">
        {/* Left rail on desktop (collapsible icon rail); horizontal scroller on
            mobile. The width animates between expanded (14rem) and collapsed
            (4rem); collapse applies to lg+ only. */}
        <aside
          className={`shrink-0 transition-[width] duration-200 ease-out ${
            collapsed ? "lg:w-16" : "lg:w-56"
          }`}
        >
          <nav className="flex gap-0.5 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">
            {/* Collapse toggle at the TOP of the rail - desktop only. */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={
                collapsed ? t("vendor.nav.expand_sidebar") : t("vendor.nav.collapse_sidebar")
              }
              title={collapsed ? t("vendor.nav.expand_sidebar") : t("vendor.nav.collapse_sidebar")}
              className={`mb-1 hidden shrink-0 items-center gap-3 rounded-xl py-2 text-sm text-ink-600 transition-colors hover:bg-steel-50 lg:flex dark:text-paper-300 dark:hover:bg-steel-600/15 ${
                collapsed ? "justify-center px-0" : "px-3"
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen
                  size={18}
                  aria-hidden="true"
                  className="text-steel-700 dark:text-steel-300"
                />
              ) : (
                <PanelLeftClose
                  size={18}
                  aria-hidden="true"
                  className="text-steel-700 dark:text-steel-300"
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
                    `relative flex shrink-0 items-center gap-3 rounded-xl py-2 text-sm transition-colors ${
                      collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3"
                    } ${
                      isActive
                        ? "bg-steel-600 text-white [&_svg]:text-white"
                        : "text-ink-700 hover:bg-steel-50 dark:text-paper-200 dark:hover:bg-steel-600/15 [&_svg]:text-steel-700 dark:[&_svg]:text-steel-300"
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

            {/* Profile chip - desktop only. */}
            <div className="mt-1 hidden border-t border-paper-300 pt-1 lg:block dark:border-umber-700">
              <Link
                to="/vendor/settings"
                title={collapsed ? displayName : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-xl py-2 text-sm text-ink-700 transition-colors hover:bg-steel-50 dark:text-paper-200 dark:hover:bg-steel-600/15 ${
                  collapsed ? "justify-center px-0" : "px-3"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-steel-100 text-xs font-semibold text-steel-700">
                  {initialsOf(displayName)}
                </span>
                <span className={`truncate ${collapsed ? "hidden" : ""}`}>{displayName}</span>
              </Link>
            </div>
          </nav>
        </aside>
        <main id="main-content" className="min-w-0 flex-1 focus:outline-none">
          {children}
        </main>
      </div>

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
