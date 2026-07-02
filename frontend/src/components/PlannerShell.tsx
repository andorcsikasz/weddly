// Planner workspace shell - the authenticated layout for user_type='planner'
// at /app/planner/*. Mirrors VendorShell's structure (sticky header + collapsible
// left nav rail) so the planner workspace reads as a professional command center
// rather than a single screen. The header also carries the greeting, plan chip
// and a notification bell (overdue tasks + pending couple invites) that used to
// live on the dashboard topbar. Page chrome uses the standard horizontal padding.

import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  Languages,
  LayoutDashboard,
  LogOut,
  MailQuestion,
  MessageCircle,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { PlannerInviteView, PlannerProfile, PlannerStats, User } from "@shared/types";
import { useAuth } from "../lib/auth";
import { plannerApi, plannerBillingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
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
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 dark:text-paper-100">
              <AlertTriangle size={15} className="shrink-0 text-red-500" aria-hidden="true" />
              <span>{t("planner_home.notif_overdue").replace("{{n}}", String(overdue))}</span>
            </div>
          )}
          {pendingInvites > 0 && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 dark:text-paper-100">
              <MailQuestion size={15} className="shrink-0 text-amber-500" aria-hidden="true" />
              <span>
                {t("planner_home.notif_invites").replace("{{n}}", String(pendingInvites))}
              </span>
            </div>
          )}
          <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          <Link
            to="/app/planner/messages"
            role="menuitem"
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
  onLogout,
}: {
  user: User;
  avatarUrl: string | null;
  onLogout: () => void;
}) {
  const { t, locale, setLocale } = useT();
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
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-moss-100 text-xs font-semibold uppercase text-moss-800 dark:bg-moss-900/40 dark:text-moss-100">
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
          <Link
            to="/app/planner/settings/account"
            role="menuitem"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-moss-50 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <UserRound size={16} aria-hidden="true" />
            <span>{t("planner_shell.menu_account")}</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setLocale(locale === "hu" ? "en" : "hu");
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-moss-50 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <span className="inline-flex items-center gap-2">
              <Languages size={16} aria-hidden="true" />
              <span>{t("nav.switch_language")}</span>
            </span>
            <span className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {locale} → {locale === "hu" ? "en" : "hu"}
            </span>
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
  const { t } = useT();
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
            {stats && (
              <Link
                to="/app/planner/stats"
                className="hidden items-center gap-1.5 rounded-full border border-moss-200 bg-moss-50 px-3 py-1 text-xs capitalize text-moss-800 transition-colors hover:bg-moss-100 sm:inline-flex dark:border-moss-900 dark:bg-moss-900/30 dark:text-moss-100 dark:hover:bg-moss-900/50"
                title={t("planner_home.topbar_clients_aria")}
                aria-label={`${t("planner_home.topbar_clients_aria")}: ${stats.active_clients}/${stats.max_clients}`}
              >
                <Users size={13} aria-hidden="true" className="text-moss-600 dark:text-moss-300" />
                {`${stats.plan} · ${stats.active_clients}/${stats.max_clients}`}
              </Link>
            )}

            <NotificationBell overdue={stats?.overdue_tasks ?? 0} pendingInvites={invites.length} />

            {user && (
              <PlannerProfileMenu
                user={user}
                avatarUrl={avatarUrl}
                onLogout={() => void onLogout()}
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
