// Authenticated shell: top bar + sidebar (desktop) / bottom tabs (mobile).
import {
  CalendarClock,
  Camera,
  ChefHat,
  ClipboardList,
  Heart,
  Image as ImageIcon,
  Inbox,
  Languages,
  LayoutDashboard,
  LayoutList,
  MessageCircle,
  Moon,
  Plane,
  ShieldCheck,
  Sun,
  UserCog,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { FeedbackDialog } from "./FeedbackDialog";
import { ProfileMenu } from "./ProfileMenu";
import { Wordmark } from "./Wordmark";

type NavItem = { to: string; labelKey: string; tabKey?: string; icon: ReactNode };

const ITEMS: NavItem[] = [
  {
    to: "/app",
    labelKey: "nav.dashboard",
    tabKey: "nav.tab_dashboard",
    icon: <LayoutDashboard size={18} />,
  },
  {
    to: "/app/guests",
    labelKey: "nav.guests",
    tabKey: "nav.tab_guests",
    icon: <Users size={18} />,
  },
  {
    to: "/app/budget",
    labelKey: "nav.budget",
    tabKey: "nav.tab_budget",
    icon: <UtensilsCrossed size={18} />,
  },
  // Workflow order: book Szolgáltatók first (caterer drives most line items),
  // then Tervezés for free-form tasks/ideas, then Programterv to lay out the
  // wedding day, then Ültetés once the RSVPs + run-of-show settle.
  {
    to: "/app/suppliers",
    labelKey: "nav.suppliers",
    tabKey: "nav.tab_suppliers",
    icon: <Heart size={18} />,
  },
  // Free-form planning surface — desktop-only so the mobile bottom nav stays
  // at the 5 core flows. Two tabs inside: tasks + ideas. The wedding-day
  // run-of-show lives on its own page at /app/schedule (richer model + PDF).
  {
    to: "/app/planning",
    labelKey: "nav.planning",
    icon: <ClipboardList size={18} />,
  },
  // Day-of run-of-show — desktop sidebar only. The page also surfaces on the
  // dashboard via the day-of mode when daysUntil <= 1.
  {
    to: "/app/schedule",
    labelKey: "nav.schedule",
    icon: <CalendarClock size={18} />,
  },
  {
    to: "/app/seating",
    labelKey: "nav.seating",
    tabKey: "nav.tab_seating",
    icon: <ChefHat size={18} />,
  },
  // Post-wedding "follow-up" entries — desktop sidebar only; bottom mobile
  // nav stays at 5 items via `slice(0, 5)` further down.
  {
    to: "/app/honeymoon",
    labelKey: "nav.honeymoon",
    icon: <Plane size={18} />,
  },
  // Visual inspiration — pre-wedding companion to /app/media. Embeds a
  // Pinterest board the couple links; no backend, URL stored in localStorage.
  {
    to: "/app/moodboard",
    labelKey: "nav.moodboard",
    icon: <ImageIcon size={18} />,
  },
  {
    to: "/app/media",
    labelKey: "nav.media",
    icon: <Camera size={18} />,
  },
];

/** Admin nav — replaces the couple-facing rail when the user has flipped
 *  into admin view via the ProfileMenu. Distinct purple styling + striped
 *  texture so admin surfaces read as visually separate from couple pages. */
const ADMIN_ITEMS: NavItem[] = [
  {
    to: "/app/admin/suppliers",
    labelKey: "admin.nav_suppliers",
    tabKey: "admin.nav_suppliers",
    icon: <ShieldCheck size={18} />,
  },
  {
    to: "/app/admin/users",
    labelKey: "admin.nav_users",
    tabKey: "admin.nav_users",
    icon: <UserCog size={18} />,
  },
  {
    to: "/app/admin/categories",
    labelKey: "admin.nav_taxonomy",
    tabKey: "admin.nav_taxonomy",
    icon: <LayoutList size={18} />,
  },
  {
    to: "/app/admin/vendor-waitlist",
    labelKey: "admin.nav_waitlist",
    tabKey: "admin.nav_waitlist",
    icon: <Inbox size={18} />,
  },
  {
    to: "/app/admin/feedback",
    labelKey: "admin.nav_feedback",
    tabKey: "admin.nav_feedback",
    icon: <MessageCircle size={18} />,
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useT();
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const { user } = useAuth();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Track previous auth state so we only fire the localStorage sweep on
  // the user → null transition (sign-out), not on the initial null-loading
  // pass that happens before /api/auth/me resolves.
  const prevUserId = useRef<number | null>(null);

  // ── Warm-dark mode toggle ────────────────────────────────────────────
  // Theme preference is shared with PublicShell via `localStorage["weddly.theme"]`,
  // so toggling on the landing carries into /app and vice versa. Class lives
  // on <html> so portals (Toasts, Dialogs, maps) inherit it automatically.
  // We deliberately do NOT remove the `dark` class on unmount — that would
  // strip the preference when navigating between shells. PublicShell re-applies
  // it on its own mount.
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem("weddly.theme") === "light" ? "light" : "dark";
  });
  useEffect(() => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    try {
      window.localStorage.setItem("weddly.theme", theme);
    } catch {
      /* localStorage blocked — fine, the user's choice just won't persist */
    }
  }, [theme]);

  // ── Workspace handoff cleanup ────────────────────────────────────────
  // When the user signs out, wipe every `weddly.*` localStorage key so
  // the next person on this device doesn't inherit the previous tenant's
  // local prefs (saved suppliers, onboarding draft, dismissed banners,
  // locale). The session token itself is cleared by `setSession(null)`
  // in AuthProvider — this just sweeps the rest.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (prevUserId.current !== null && user === null) {
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i);
          if (k && k.startsWith("weddly.") && k !== "weddly.token") {
            keys.push(k);
          }
        }
        keys.forEach((k) => localStorage.removeItem(k));
      } catch {
        /* localStorage blocked in some embeds — fail soft */
      }
    }
    prevUserId.current = user?.id ?? null;
  }, [user]);

  // ── Route-change focus management ────────────────────────────────────
  // SR users land in the new content rather than reading the chrome again.
  // We only move focus if no other element has explicitly taken it (e.g.
  // a deep-link autofocused input). Skipping the very first paint keeps
  // initial-load behaviour quiet.
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    const el = mainRef.current;
    if (!el) return;
    // If an input/button in the new route grabbed focus during mount, leave it.
    if (
      document.activeElement &&
      document.activeElement !== document.body &&
      el.contains(document.activeElement)
    ) {
      return;
    }
    el.focus({ preventScroll: true });
  }, [location.pathname]);

  // View mode is derived from the URL: `/app/admin/*` paths flip the entire
  // shell into admin view (purple rail, admin-only nav). The ProfileMenu
  // exposes a single toggle to enter or exit this view. We only show the
  // admin rail when the user is actually an admin — otherwise a stray
  // /app/admin URL would render the admin chrome around a redirect.
  const inAdminView = user?.is_admin === true && location.pathname.startsWith("/app/admin");
  const displayItems = inAdminView ? ADMIN_ITEMS : ITEMS;

  return (
    <div className="min-h-full">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-paper-100 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:outline-none focus:ring-2 focus:ring-ink-500 focus:ring-offset-2 dark:bg-paper-100 dark:text-umber-900 dark:focus:ring-blush-400"
      >
        {t("landing.skip_to_main")}
      </a>
      <header className="sticky top-0 z-20 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link
            to="/"
            className="text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
          >
            <Wordmark size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm inline-flex items-center"
              aria-label={t("landing.nav_feedback")}
              title={t("landing.nav_feedback")}
              onClick={() => setFeedbackOpen(true)}
            >
              <MessageCircle size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm inline-flex items-center"
              onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
              aria-label={t("nav.switch_language")}
              title={locale === "hu" ? t("nav.switch_to_en") : t("nav.switch_to_hu")}
            >
              <Languages size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm inline-flex items-center gap-1.5"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
              title={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
            >
              {theme === "dark" ? (
                <Sun size={14} aria-hidden="true" />
              ) : (
                <Moon size={14} aria-hidden="true" />
              )}
            </button>
            <ProfileMenu />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 pb-24 pt-6 sm:pb-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          {inAdminView ? (
            <nav className="sticky top-20 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-violet-950 dark:text-violet-300">
                <ShieldCheck size={11} aria-hidden="true" />
                {t("admin.nav_label")}
              </div>
              {displayItems.map((item) => (
                <AdminSideLink key={item.to} to={item.to} icon={item.icon}>
                  {t(item.labelKey)}
                </AdminSideLink>
              ))}
            </nav>
          ) : (
            <nav className="sticky top-20 flex flex-col gap-1">
              {displayItems.map((item) => (
                <SideLink key={item.to} to={item.to} icon={item.icon}>
                  {t(item.labelKey)}
                </SideLink>
              ))}
            </nav>
          )}
        </aside>
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 min-w-0 focus:outline-none"
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav — only items with an explicit `tabKey` get a slot,
          capped at 5 to keep the row legible on narrow viewports. In admin
          view the bar swaps to the 5 admin pages and inverts to a violet
          tint to mirror the desktop rail. */}
      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-20 border-t backdrop-blur lg:hidden border-paper-300 bg-paper-50/95 dark:border-umber-700 dark:bg-umber-900/95">
        <div className="mx-auto grid max-w-md grid-cols-5 px-2 py-2">
          {displayItems
            .filter((item) => item.tabKey)
            .slice(0, 5)
            .map((item) => (
              <BottomLink
                key={item.to}
                to={item.to}
                icon={item.icon}
                variant={inAdminView ? "admin" : "default"}
              >
                {t(item.tabKey ?? item.labelKey)}
              </BottomLink>
            ))}
        </div>
      </nav>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} source="app" />
    </div>
  );
}

function SideLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/app"}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
          isActive
            ? "stationery-dark text-paper-100 dark:!bg-blush-400 dark:!text-umber-900 dark:!bg-none"
            : "text-ink-700 hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
        }`
      }
    >
      {icon}
      <span>{children}</span>
    </NavLink>
  );
}

/** Sidebar link for admin pages. Inactive rows read as the regular
 *  neutral nav (ink-700) so the rail doesn't shout violet across every
 *  item; the active row alone fills a deep violet pill that signals
 *  "you are here". */
function AdminSideLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
          isActive
            ? "bg-violet-950 text-white dark:bg-violet-700"
            : "text-ink-700 hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
        }`
      }
    >
      {icon}
      <span>{children}</span>
    </NavLink>
  );
}

function BottomLink({
  to,
  icon,
  children,
  variant = "default",
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  variant?: "default" | "admin";
}) {
  const active = variant === "admin" ? "text-violet-950" : "text-ink-900";
  const idle = variant === "admin" ? "text-ink-500" : "text-ink-500";
  return (
    <NavLink
      to={to}
      end={to === "/app"}
      className={({ isActive }) =>
        `flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] ${
          isActive ? active : idle
        }`
      }
    >
      {icon}
      <span className="truncate">{children}</span>
    </NavLink>
  );
}
