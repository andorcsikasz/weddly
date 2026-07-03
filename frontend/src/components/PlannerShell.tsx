// Planner workspace shell - the authenticated layout for user_type='planner'
// at /app/planner/*. Mirrors VendorShell's structure (sticky header + collapsible
// left nav rail) so the planner workspace reads as a professional command center
// rather than a single screen. The header carries a language toggle, a
// notification bell (overdue tasks + pending couple invites) and the profile
// menu, where the plan/clients chip now lives. Page chrome uses the standard
// horizontal padding.

import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  Home,
  Languages,
  LayoutDashboard,
  LogOut,
  MailQuestion,
  MessageCircle,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { PlannerInviteView, PlannerProfile, PlannerStats, User } from "@shared/types";
import { useAuth } from "../lib/auth";
import { plannerApi, plannerBillingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useTheme } from "../lib/useTheme";
import { FeedbackDialog } from "./FeedbackDialog";
import { PlannerDemoOverlay } from "./PlannerDemoOverlay";
import { Wordmark } from "./Wordmark";

type PlannerNavItem = { to: string; labelKey: string; icon: ReactNode; end?: boolean };

const PLANNER_ITEMS: PlannerNavItem[] = [
  {
    to: "/app/planner",
    labelKey: "planner_nav.dashboard",
    icon: <LayoutDashboard size={18} />,
    end: true,
  },
  { to: "/app/planner/clients", labelKey: "planner_nav.clients", icon: <Users size={18} /> },
  {
    to: "/app/planner/calendar",
    labelKey: "planner_nav.calendar",
    icon: <CalendarDays size={18} />,
  },
  { to: "/app/planner/stats", labelKey: "planner_nav.stats", icon: <BarChart3 size={18} /> },
  {
    to: "/app/planner/messages",
    labelKey: "planner_nav.messages",
    icon: <MessageSquare size={18} />,
  },
  { to: "/app/planner/settings", labelKey: "planner_nav.settings", icon: <Settings size={18} /> },
];

const NAV_COLLAPSED_KEY = "weddly.planner_nav_collapsed";

function NotificationBell({
  overdue,
  pendingInvites,
}: {
  overdue: number;
  pendingInvites: number;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasNotifications = overdue > 0 || pendingInvites > 0;

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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-umber-700 transition-colors hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800"
        aria-label={t("planner_home.topbar_notif_aria")}
      >
        <Bell size={18} />
        {hasNotifications && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] origin-top-right rounded-2xl border border-paper-300 bg-white p-2 font-grotesk shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
            {t("planner_home.notif_heading")}
          </p>
          <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          {!hasNotifications && (
            <p className="px-3 py-3 text-sm text-ink-500 dark:text-umber-300">
              {t("planner_home.notif_none")}
            </p>
          )}
          {overdue > 0 && (
            <Link
              to="/app/planner/calendar?mode=tasks"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
            >
              <AlertTriangle size={15} className="shrink-0 text-red-500" aria-hidden="true" />
              <span>{t("planner_home.notif_overdue").replace("{{n}}", String(overdue))}</span>
            </Link>
          )}
          {pendingInvites > 0 && (
            <Link
              to="/app/planner/clients"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
            >
              <MailQuestion size={15} className="shrink-0 text-amber-500" aria-hidden="true" />
              <span>
                {t("planner_home.notif_invites").replace("{{n}}", String(pendingInvites))}
              </span>
            </Link>
          )}
          <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          <Link
            to="/app/planner/messages"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <MessageCircle size={16} aria-hidden="true" />
            <span>{t("planner_home.notif_messages_link")}</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function getInitials(fullName: string, email: string): string {
  const source = (fullName ?? "").trim() || email || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return (first + last).toUpperCase();
  }
  const single = parts[0] ?? "";
  return single.slice(0, 2).toUpperCase() || "?";
}

/** Right-aligned identity control for the planner header. An avatar (planner
 *  photo when set, else initials) plus the planner's name opens a lightweight
 *  dropdown - account settings + sign out - mirroring the couple /app
 *  ProfileMenu pattern so the two shells read consistently. */
function PlannerProfileMenu({
  user,
  avatarUrl,
  stats,
  onLogout,
  onOpenFeedback,
}: {
  user: User;
  avatarUrl: string | null;
  stats: PlannerStats | null;
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

  const initials = getInitials(user.full_name, user.email);
  const firstName = (user.full_name ?? "").split(" ")[0] ?? "";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("planner_shell.menu_label")}
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex h-9 items-center gap-2 rounded-full pl-1 pr-2 text-ink-700 transition-colors hover:bg-moss-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:ring-offset-2 dark:text-paper-100 dark:hover:bg-umber-800 dark:focus-visible:ring-moss-300"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-moss-200 dark:ring-umber-700"
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-moss-600 text-xs font-semibold uppercase text-paper-50 dark:bg-moss-500">
            {initials}
          </span>
        )}
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {firstName || user.email}
        </span>
        <ChevronDown size={15} aria-hidden="true" className="text-umber-500 dark:text-umber-300" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-1rem)] origin-top-right rounded-2xl border border-paper-300 bg-white p-2 font-grotesk shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
              {user.full_name || user.email}
            </p>
            <p className="truncate text-xs text-ink-500 dark:text-umber-300">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          {stats && (
            <Link
              to="/app/planner/stats"
              role="menuitem"
              title={t("planner_home.topbar_clients_aria")}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-moss-50 dark:text-paper-100 dark:hover:bg-umber-700"
            >
              <span className="inline-flex items-center gap-2">
                <Users size={16} aria-hidden="true" />
                <span>{t("planner_shell.menu_plan")}</span>
              </span>
              <span className="text-xs font-medium capitalize text-moss-800 dark:text-moss-100">
                {`${stats.plan} · ${stats.active_clients}/${stats.max_clients}`}
              </span>
            </Link>
          )}
          <Link
            to="/app/planner/settings/account"
            role="menuitem"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-moss-50 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <UserRound size={16} aria-hidden="true" />
            <span>{t("planner_shell.menu_account")}</span>
          </Link>
          {/* Same escape hatches the couple-side ProfileMenu offers: back to
           *  the public landing + the feedback dialog (hosted by the shell). */}
          <Link
            to="/"
            role="menuitem"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-moss-50 dark:text-paper-100 dark:hover:bg-umber-700"
          >
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
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-moss-50 dark:text-paper-100 dark:hover:bg-umber-700"
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
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-moss-50 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{t("common.sign_out")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function PlannerShell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [stats, setStats] = useState<PlannerStats | null>(null);
  const [invites, setInvites] = useState<PlannerInviteView[]>([]);
  // Planner photo for the header avatar. Fetched once (not per-navigation) -
  // it rarely changes, and the menu falls back to initials until it lands.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // Read-only when the planner's subscription has lapsed — surfaces a banner
  // linking to billing so the 402 gate on mutations isn't a silent dead end.
  const [readOnly, setReadOnly] = useState(false);
  // Feedback dialog, opened from the profile menu (same home as /app).
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Warm-dark mode, shared with the other shells via localStorage. Like the
  // couple /app, the planner workspace defaults to dark on first visit.
  const [theme, setTheme] = useTheme("dark");

  useEffect(() => {
    let cancelled = false;
    Promise.all([plannerApi.stats(), plannerApi.listInvites()])
      .then(([s, i]) => {
        if (cancelled) return;
        setStats(s.stats);
        setInvites(i.invites);
      })
      .catch(() => {
        /* fresh planner / network - header just shows the brand + zero state */
      });
    return () => {
      cancelled = true;
    };
    // Re-pull on navigation so counts stay roughly fresh as the planner works.
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    plannerBillingApi
      .status()
      .then((r) => {
        if (!cancelled) setReadOnly(!r.billing.entitled);
      })
      .catch(() => {
        /* fresh planner / network - assume entitled, the gate is server-side */
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    plannerApi
      .getProfile()
      .then((p: PlannerProfile) => {
        if (!cancelled) setAvatarUrl(p.planner_avatar_url);
      })
      .catch(() => {
        /* no profile yet / network - the menu just shows initials */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === "1");
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* best-effort */
      }
      return next;
    });
  }

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-full overflow-x-clip bg-paper-50 dark:bg-umber-950">
      <PlannerDemoOverlay />
      <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/app/planner"
              className="inline-flex h-11 items-center text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
            >
              <Wordmark size="sm" />
            </Link>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-umber-700 transition-colors hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800"
              title={`${t("nav.switch_language")} (${locale} → ${locale === "hu" ? "en" : "hu"})`}
              aria-label={t("nav.switch_language")}
            >
              <Languages size={18} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-umber-700 transition-colors hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800"
              aria-label={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
              title={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
            >
              {theme === "dark" ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
            </button>

            <NotificationBell overdue={stats?.overdue_tasks ?? 0} pendingInvites={invites.length} />

            {user && (
              <PlannerProfileMenu
                user={user}
                avatarUrl={avatarUrl}
                stats={stats}
                onLogout={() => void onLogout()}
                onOpenFeedback={() => setFeedbackOpen(true)}
              />
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pb-12 pt-6 sm:px-6 lg:flex-row lg:px-8 xl:max-w-screen-2xl xl:px-10">
        <aside
          className={`shrink-0 transition-[width] duration-200 ease-out ${
            collapsed ? "lg:w-16" : "lg:w-56"
          }`}
        >
          <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">
            {/* Collapse toggle - top of the rail, desktop only. */}
            <div className="mb-1 hidden border-b border-paper-300 pb-1 lg:block dark:border-umber-700">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                aria-label={
                  collapsed ? t("planner_nav.expand_sidebar") : t("planner_nav.collapse_sidebar")
                }
                className={`flex w-full shrink-0 items-center gap-3 rounded-xl py-2 text-sm text-ink-600 transition-colors hover:bg-moss-50 dark:text-paper-300 dark:hover:bg-umber-800 ${
                  collapsed ? "justify-center px-0" : "px-3"
                }`}
              >
                {collapsed ? (
                  <PanelLeftOpen size={18} aria-hidden="true" />
                ) : (
                  <PanelLeftClose size={18} aria-hidden="true" />
                )}
                <span className={collapsed ? "hidden" : ""}>
                  {t("planner_nav.collapse_sidebar")}
                </span>
              </button>
            </div>

            {PLANNER_ITEMS.map((item) => {
              const label = t(item.labelKey);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    `flex shrink-0 items-center gap-3 rounded-xl py-2 text-sm transition-colors ${
                      collapsed ? "lg:justify-center lg:px-0 px-3" : "px-3"
                    } ${
                      isActive
                        ? "bg-moss-100 font-medium text-moss-900 dark:bg-moss-900/40 dark:text-moss-100"
                        : "text-ink-700 hover:bg-moss-50 dark:text-paper-200 dark:hover:bg-umber-800"
                    }`
                  }
                >
                  {item.icon}
                  <span className={collapsed ? "lg:hidden" : ""}>{label}</span>
                </NavLink>
              );
            })}
          </nav>
        </aside>
        <main id="main-content" className="min-w-0 flex-1 focus:outline-none">
          {readOnly && (
            <Link
              to="/app/planner/billing"
              className="mx-4 mt-4 flex items-center gap-2 rounded-xl border border-blush-200 bg-blush-50 px-4 py-2.5 text-sm text-blush-700 transition hover:border-blush-300 lg:mx-6 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300 dark:hover:border-blush-400/60"
            >
              <AlertTriangle size={15} className="shrink-0" />
              <span>{t("planner_billing.state_readonly")}</span>
            </Link>
          )}
          {children}
        </main>
      </div>

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        source="app"
        context={location.pathname}
      />
    </div>
  );
}

/** Route-layout wrapper. Mount at the parent `/app/planner` route so the shell
 *  stays mounted across planner navigation; child pages return content only. */
export function PlannerShellLayout() {
  return (
    <PlannerShell>
      <Outlet />
    </PlannerShell>
  );
}
