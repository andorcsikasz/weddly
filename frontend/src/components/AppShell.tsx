// Authenticated shell: top bar + sidebar (desktop) / bottom tabs (mobile).
import {
  Armchair,
  Bed,
  CalendarClock,
  Camera,
  ChevronsLeft,
  BookOpen,
  ChevronsRight,
  ClipboardList,
  Coins,
  GanttChartSquare,
  Gift,
  Globe,
  Image as ImageIcon,
  Inbox,
  Languages,
  LayoutDashboard,
  LayoutList,
  LineChart,
  Wallet,
  Layers,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Palette,
  Plane,
  ShieldCheck,
  Store,
  Sun,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { AdminSidebarBadges } from "@shared/types";
import { useAuth } from "../lib/auth";
import { adminUserApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { CoachMarks } from "./CoachMarks";
import { DemoOverlay } from "./DemoOverlay";
import { SubscriptionBanner } from "./SubscriptionBanner";
import { VerifyEmailBanner } from "./VerifyEmailBanner";
import { FeedbackDialog } from "./FeedbackDialog";
import { KeyboardShortcutsSheet, useShortcutsHotkey } from "./KeyboardShortcutsSheet";
import { NotificationBell } from "./NotificationBell";
import { ProfileMenu } from "./ProfileMenu";
import { Wordmark } from "./Wordmark";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/** `group` partitions the sidebar into four logical phases of the wedding
 *  journey, with a thin section header between each:
 *   - `default` (Áttekintés alone) — the entry point, no header above it.
 *   - `planning` — the data & decision surfaces (guests, money, vendors,
 *     tasks, gantt). What the couple touches every week.
 *   - `executing` — wedding-day operations: the run-of-show, seating
 *     chart, and the accommodation/transfer board.
 *   - `dreaming` — pre-wedding inspiration (moodboard) + post-wedding
 *     follow-up (honeymoon, photo gallery). Time-ordered so it reads as a
 *     before-and-after bookend around the day itself.
 *   - `guest` — the read-only "Vendégoldal" portal preview. Lives at the
 *     bottom because it's not a couple-planning surface; it's what
 *     RSVP-yes guests see at /g/:slug/:code. */
type NavGroup = "default" | "planning" | "executing" | "dreaming" | "guest";

type NavItem = {
  to: string;
  labelKey: string;
  tabKey?: string;
  icon: ReactNode;
  group?: NavGroup;
};

const ITEMS: NavItem[] = [
  {
    to: "/app",
    labelKey: "nav.dashboard",
    tabKey: "nav.tab_dashboard",
    icon: <LayoutDashboard size={18} />,
  },
  // ── Planning ──────────────────────────────────────────────────────
  // Workflow order inside the group: people first (guests), then money
  // (budget), then bookings (suppliers), then free-form tasks & gantt.
  {
    to: "/app/guests",
    labelKey: "nav.guests",
    tabKey: "nav.tab_guests",
    icon: <Users size={18} />,
    group: "planning",
  },
  {
    to: "/app/budget",
    labelKey: "nav.budget",
    tabKey: "nav.tab_budget",
    icon: <Coins size={18} />,
    group: "planning",
  },
  {
    to: "/app/vendors",
    labelKey: "nav.suppliers",
    tabKey: "nav.tab_suppliers",
    icon: <Store size={18} />,
    group: "planning",
  },
  // Free-form planning surface — desktop-only so the mobile bottom nav stays
  // at the 5 core flows. Two tabs inside: tasks + ideas. The wedding-day
  // run-of-show lives on its own page at /app/schedule (richer model + PDF).
  {
    to: "/app/planning",
    labelKey: "nav.planning",
    icon: <ClipboardList size={18} />,
    group: "planning",
  },
  // Gantt-style task timeline + supplier point-of-contact panel — desktop
  // sidebar only. Sits between planning (define tasks) and schedule (lay
  // out the wedding day) so the booking → schedule flow reads top-down.
  {
    to: "/app/timeline",
    labelKey: "nav.timeline",
    icon: <GanttChartSquare size={18} />,
    group: "planning",
  },
  // ── Executing ─────────────────────────────────────────────────────
  // Day-of operations. Schedule lays out the run-of-show, Seating maps
  // the dining room, Logistics covers accommodation + transfers.
  {
    to: "/app/schedule",
    labelKey: "nav.schedule",
    icon: <CalendarClock size={18} />,
    group: "executing",
  },
  // Seating moved off the mobile bottom nav into the "More" sheet — the row
  // now stays at the four core flows (Dashboard / Guests / Budget / Suppliers)
  // plus the More button.
  {
    to: "/app/seating",
    labelKey: "nav.seating",
    icon: <Armchair size={18} />,
    group: "executing",
  },
  // Logistics — accommodation + transfer assignment. Sits right after seating
  // because the workflow is similar (drag guests onto units) and the data it
  // reads (guest list, partner_role) is shared. Desktop-only sidebar like the
  // other late-stage flows; mobile bottom nav stays at the core five.
  {
    to: "/app/logistics",
    labelKey: "nav.logistics",
    icon: <Bed size={18} />,
    group: "executing",
  },
  // ── Dreaming + follow-up ──────────────────────────────────────────
  // Time-ordered: Moodboard (pre-wedding inspiration) → Nászút (the
  // immediate post-wedding trip) → Képek (photos that arrive after).
  {
    to: "/app/moodboard",
    labelKey: "nav.moodboard",
    icon: <ImageIcon size={18} />,
    group: "dreaming",
  },
  // Curated visual identity — sits in the inspiration cluster next to the
  // moodboard (inspiration → concrete design system). Desktop sidebar +
  // More-sheet only (no tabKey), so the mobile bottom nav stays at 5 items.
  {
    to: "/app/design",
    labelKey: "nav.design",
    icon: <Palette size={18} />,
    group: "dreaming",
  },
  // Post-wedding "follow-up" entries — desktop sidebar only; bottom mobile
  // nav stays at 5 items via `slice(0, 5)` further down.
  {
    to: "/app/honeymoon",
    labelKey: "nav.honeymoon",
    icon: <Plane size={18} />,
    group: "dreaming",
  },
  {
    to: "/app/media",
    labelKey: "nav.media",
    icon: <Camera size={18} />,
    group: "dreaming",
  },
  // ── Guest-facing area ──────────────────────────────────────────────
  // Single merged "Vendégoldal / Guest page" surface. Replaces the older
  // split between the public wedding-site editor and the read-only post-
  // RSVP portal preview — couples now manage both audiences from one
  // page with labelled sections ("public" vs "unlocks after RSVP-yes").
  // /app/wedding-site and /app/guest-portal still resolve via redirects.
  // The couple-curated wishlist sits just above the guest-page entry — it's
  // another thing confirmed guests see on the merged Vendégoldal. Desktop +
  // More-sheet only (no tabKey), like the other secondary guest surfaces.
  {
    to: "/app/wishlist",
    labelKey: "nav.wishlist",
    icon: <Gift size={18} />,
    group: "guest",
  },
  {
    to: "/app/guest-page",
    labelKey: "nav.guest_page",
    icon: <Globe size={18} />,
    group: "guest",
  },
];

/** Admin nav — replaces the couple-facing rail when the user has flipped
 *  into admin view via the ProfileMenu. Distinct purple styling + striped
 *  texture so admin surfaces read as visually separate from couple pages.
 *
 *  Items are grouped into three IA labelled sections so six equal-weight
 *  rows don't blur the difference between "do work" and "look at numbers":
 *   - `inbox` — badge-bearing moderation queues (suppliers, vendor
 *     waitlist, feedback). What an admin opens the dashboard to clear.
 *   - `manage` — CRM + taxonomy config (users, categories). Stable
 *     edit-when-needed surfaces.
 *   - `insights` — read-only rollups (analytics). Tail of the rail. */
type AdminNavGroup = "inbox" | "manage" | "insights";

/** Maps each admin nav row to the matching `AdminSidebarBadges` key.
 *  Items without a badgeKey never show a red index (e.g. Categories —
 *  admin-edited content with no inbox). */
type AdminBadgeKey = "suppliers" | "users" | "vendor_waitlist" | "feedback";
// `group` is re-typed (not intersected) — `NavItem.group` is
// `NavGroup | undefined`, intersecting with `AdminNavGroup | undefined`
// collapses to `never`. `Omit<NavItem, "group">` lets the admin variant
// own that key.
type AdminNavItem = Omit<NavItem, "group"> & {
  badgeKey?: AdminBadgeKey;
  group?: AdminNavGroup;
};

const ADMIN_ITEMS: AdminNavItem[] = [
  // ── Inbox ─────────────────────────────────────────────────────────
  // Badge-bearing moderation queues. Suppliers leads because pending
  // submissions are the single most time-sensitive surface — couples
  // are blocked on approval before their listings appear.
  {
    to: "/app/admin/suppliers",
    labelKey: "admin.nav_suppliers",
    tabKey: "admin.nav_suppliers",
    icon: <ShieldCheck size={18} />,
    badgeKey: "suppliers",
    group: "inbox",
  },
  {
    to: "/app/admin/vendor-waitlist",
    labelKey: "admin.nav_waitlist",
    tabKey: "admin.nav_waitlist",
    icon: <Inbox size={18} />,
    badgeKey: "vendor_waitlist",
    group: "inbox",
  },
  {
    to: "/app/admin/feedback",
    labelKey: "admin.nav_feedback",
    tabKey: "admin.nav_feedback",
    icon: <MessageCircle size={18} />,
    badgeKey: "feedback",
    group: "inbox",
  },
  {
    to: "/app/admin/couple-cards",
    labelKey: "admin.nav_couple_cards",
    tabKey: "admin.nav_couple_cards",
    icon: <Layers size={18} />,
    group: "inbox",
  },
  // ── Manage ────────────────────────────────────────────────────────
  // CRM + config. Stable surfaces, edited as needed.
  {
    to: "/app/admin/users",
    labelKey: "admin.nav_users",
    tabKey: "admin.nav_users",
    icon: <UserCog size={18} />,
    badgeKey: "users",
    group: "manage",
  },
  // Categories has no `tabKey` — the phone bottom-nav (5 slots) keeps the
  // four moderation items + analytics; taxonomy CRUD is rarely done on a
  // phone and stays reachable via desktop rail or direct URL.
  {
    to: "/app/admin/categories",
    labelKey: "admin.nav_taxonomy",
    icon: <LayoutList size={18} />,
    group: "manage",
  },
  {
    to: "/app/admin/blog",
    labelKey: "admin.nav_blog",
    icon: <BookOpen size={18} />,
    group: "manage",
  },
  // ── Insights ──────────────────────────────────────────────────────
  // Read-only rollups. Tail of the rail so moderation surfaces lead.
  // `tabKey` is set so analytics survives on the phone bottom-nav too —
  // previously it was unreachable on iPad portrait (sidebar hidden under
  // 1024px) and on phone (no tabKey).
  {
    to: "/app/admin/analytics",
    labelKey: "admin.nav_analytics",
    tabKey: "admin.nav_analytics",
    icon: <LineChart size={18} />,
    group: "insights",
  },
  {
    to: "/app/admin/financial-planner",
    labelKey: "admin.nav_financial_planner",
    icon: <Wallet size={18} />,
    group: "insights",
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useT();
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const { user } = useAuth();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Global `?` hotkey + the small header trigger both write to this state.
  // Hidden entirely on touch widths via the matchMedia gate inside the hook,
  // so the modal can't ambush a mobile user who pairs a Bluetooth keyboard.
  const { open: shortcutsOpen, setOpen: setShortcutsOpen } = useShortcutsHotkey();
  // Bottom-nav "More" sheet — surfaces the flows that didn't make the 4-tab
  // cut (Planning, Schedule, Seating, Honeymoon, Moodboard, Media). Admin
  // view doesn't need it because the admin nav already fits in 5 slots.
  const [moreOpen, setMoreOpen] = useState(false);
  // Auto-close on route change so navigating to a sheet item dismisses it.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);
  // Track previous auth state so we only fire the localStorage sweep on
  // the user → null transition (sign-out), not on the initial null-loading
  // pass that happens before /api/auth/me resolves.
  const prevUserId = useRef<number | null>(null);

  // ── Admin sidebar badges ──────────────────────────────────────────────
  // Poll the aggregate-counts endpoint every 30s while an admin is signed
  // in. Powers the small red index next to each admin nav item — see
  // ADMIN_ITEMS' `badgeKey` mapping. Skipped entirely for non-admin users
  // so no needless requests fire on the couple-facing rail.
  const [adminBadges, setAdminBadges] = useState<AdminSidebarBadges | null>(null);
  useEffect(() => {
    if (!user?.is_admin) {
      setAdminBadges(null);
      return;
    }
    let cancelled = false;
    const fetchBadges = () => {
      adminUserApi
        .sidebarBadges()
        .then((b) => {
          if (!cancelled) setAdminBadges(b);
        })
        .catch(() => {
          /* badge is non-critical — fail silently */
        });
    };
    fetchBadges();
    const interval = setInterval(fetchBadges, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.is_admin]);

  // ── Instagram-style "section seen" ping ───────────────────────────────
  // When the admin navigates into one of /app/admin/{suppliers|users|
  // vendor-waitlist|feedback}, stamp the watermark so the badge clears on
  // the next poll. We also optimistically zero the local badge so the
  // red dot disappears the moment the page loads (no 30s wait). Section
  // mapping mirrors ADMIN_ITEMS' `badgeKey`.
  useEffect(() => {
    if (!user?.is_admin) return;
    let section: "suppliers" | "users" | "vendor_waitlist" | "feedback" | null = null;
    if (location.pathname.startsWith("/app/admin/suppliers")) section = "suppliers";
    else if (location.pathname.startsWith("/app/admin/users")) section = "users";
    else if (location.pathname.startsWith("/app/admin/vendor-waitlist"))
      section = "vendor_waitlist";
    else if (location.pathname.startsWith("/app/admin/feedback")) section = "feedback";
    if (!section) return;
    // Optimistic zero — the server roundtrip will catch up in <100ms.
    setAdminBadges((cur) => (cur ? { ...cur, [section as string]: 0 } : cur));
    void adminUserApi.markSectionSeen(section).catch(() => {
      /* non-critical — the next 30s poll re-syncs from the server */
    });
  }, [user?.is_admin, location.pathname]);

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

  // ── Sidebar collapse toggle ──────────────────────────────────────────
  // Desktop-only. When collapsed, the rail narrows to an icon strip and
  // labels become hover tooltips — useful on smaller laptops where the
  // 224px rail crowds the main content. Persisted to localStorage so the
  // choice survives reloads and route changes.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("weddly.sidebar.collapsed") === "1";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("weddly.sidebar.collapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      /* localStorage blocked — preference just won't persist */
    }
  }, [sidebarCollapsed]);

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

  const coupleItems = ITEMS;
  const displayItems = inAdminView ? ADMIN_ITEMS : coupleItems;

  return (
    // `overflow-x-clip` clamps any stray-wide descendant at the viewport edge so
    // the workspace can't horizontally bleed and trigger mobile shrink-to-fit
    // (the "el van csúszva" header/content misalignment). `clip` (not `hidden`)
    // keeps overflow-y visible, so it never establishes a scroll container —
    // the sticky header/sidebar and fixed bottom nav stay anchored, and the
    // page's intentional horizontal scrollers keep their own overflow-x-auto.
    <div className="min-h-full overflow-x-clip">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-paper-100 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:outline-none focus:ring-2 focus:ring-ink-500 focus:ring-offset-2 dark:bg-paper-100 dark:text-umber-900 dark:focus:ring-blush-400"
      >
        {t("landing.skip_to_main")}
      </a>
      {/* Demo workspaces (`is_demo = 1`) render a sticky banner + a 3-minute
          conversion nudge popup. Component no-ops for real couples. */}
      <DemoOverlay />
      {/* Unverified-email banner — only renders when the user opted into
          "continue with limited access" from VerifyEmailGate. Reads the
          same sessionStorage flag the gate writes. */}
      <VerifyEmailBanner />
      {/* Read-only billing banner — renders only when the couple's free
          period has lapsed and they aren't subscribed. No-ops otherwise. */}
      <SubscriptionBanner />
      <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
          {/* When signed in, the wordmark routes to the in-app dashboard so
              users don't get punted to the marketing landing (which reads as
              "I got logged out"). Signed-out viewers (rare here, but safe)
              still get /. */}
          <div className="flex items-center gap-3">
            <Link
              to={user ? "/app" : "/"}
              className="inline-flex h-11 items-center text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
            >
              <Wordmark size="sm" />
            </Link>
            {/* Workspace chip sits inline with the wordmark so the active
             *  event (Allie & Noah) is the second thing the user reads
             *  after the brand. Hidden when signed-out. */}
            {user && <WorkspaceSwitcher />}
          </div>
          {/* Header icon row — every button is a 44×44 square so tap targets
              line up with the avatar pill and stay HIG-compliant on mobile.
              gap-1 is plenty between square buttons; gap-2 made the row
              spread out beyond the wordmark on narrow viewports. */}
          <div className="flex items-center gap-1">
            {/* Feedback now lives in the ProfileMenu dropdown for everyone
             *  (passed down via `onOpenFeedback` below). Language stays inline
             *  on tablet+ where the header has horizontal room, and drops into
             *  the dropdown on phones via `sm:inline-flex`. */}
            <button
              type="button"
              className="hidden h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 sm:inline-flex dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100"
              onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
              aria-label={t("nav.switch_language")}
              title={locale === "hu" ? t("nav.switch_to_en") : t("nav.switch_to_hu")}
            >
              <Languages size={18} aria-hidden="true" />
            </button>
            {user && <NotificationBell />}
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
              title={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
            >
              {theme === "dark" ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
            </button>
            <ProfileMenu onOpenFeedback={() => setFeedbackOpen(true)} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 pb-28 pt-6 sm:px-6 sm:pb-8 lg:px-8 xl:max-w-screen-2xl xl:px-10">
        {/*
         * Sidebar visibility:
         *   - Phone (<768px): hidden — bottom-nav is the spatial nav.
         *   - Tablet (768–1023px): `md:flex md:w-14` icon-only rail so iPad
         *     portrait keeps a sidebar (previously dead — `hidden lg:block`
         *     plus `lg:hidden` bottom-nav left analytics unreachable).
         *   - Laptop+ (≥1024px): expands to `w-56`, or stays `w-14` when
         *     the user has explicitly collapsed it. `sidebarCollapsed` only
         *     applies at lg+ — below that the rail is icon-only regardless.
         */}
        <aside
          className={`hidden shrink-0 transition-[width] duration-200 md:flex md:w-14 ${
            sidebarCollapsed ? "lg:w-14" : "lg:w-56"
          }`}
        >
          {/* Bound the rail to the viewport so the full nav (15 links + 4
              section headers) is reachable in one screen — it scrolls inside
              itself on short laptops instead of running off the bottom. The
              tightened row rhythm below keeps it scrollbar-free on most
              displays. `min-h-0` lets the inner nav shrink so overflow works. */}
          <div className="sticky top-20 flex max-h-[calc(100vh-6rem)] min-h-0 flex-col gap-1 overflow-y-auto [scrollbar-width:thin]">
            {/* Collapse toggle — same affordance in both couple and admin
                views. When expanded it floats into the top-right corner
                (absolute, out of flow) so it stops reserving a whole row —
                the first nav item rises to the top, and the freed ~40px of
                vertical space goes to the bottom of the rail instead of
                sitting empty above. When collapsed it keeps a small centered
                row (a top-right float would collide with the first icon).
                Hidden on tablet (md) because the rail is forced icon-only
                there — there's nothing to collapse into. */}
            <div
              className={`hidden lg:flex ${
                sidebarCollapsed
                  ? "justify-center pb-1"
                  : "lg:absolute lg:right-1 lg:top-0 lg:z-10 lg:justify-end"
              }`}
            >
              <button
                type="button"
                onClick={() => setSidebarCollapsed((v) => !v)}
                aria-label={t(sidebarCollapsed ? "nav.sidebar_expand" : "nav.sidebar_collapse")}
                title={t(sidebarCollapsed ? "nav.sidebar_expand" : "nav.sidebar_collapse")}
                aria-expanded={!sidebarCollapsed}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-300 dark:hover:bg-umber-800 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
              >
                {sidebarCollapsed ? (
                  <ChevronsRight size={18} aria-hidden="true" />
                ) : (
                  <ChevronsLeft size={18} aria-hidden="true" />
                )}
              </button>
            </div>
            {inAdminView ? (
              <nav className="flex flex-col gap-0.5">
                {/* "Admin" eyebrow — only renders in the fully-expanded rail.
                    Hidden at md (icon-only) and at lg+ when the user has
                    collapsed the rail, matching SidebarGroupHeader behaviour. */}
                {!sidebarCollapsed && (
                  <div className="hidden items-center gap-1.5 px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-950 lg:flex dark:text-neutral-300">
                    <ShieldCheck size={11} aria-hidden="true" />
                    {t("admin.nav_label")}
                  </div>
                )}
                {(() => {
                  // Render admin items in declaration order, injecting a thin
                  // `.eyebrow`-styled subhead whenever the `group` field flips.
                  // Subheads only render in the fully-expanded rail; tablet
                  // (icon-only) + collapsed laptop get a quiet hairline divider
                  // so the grouping is still readable without labels.
                  let lastGroup: AdminNavGroup | null = null;
                  return displayItems.map((item) => {
                    const adminItem = item as AdminNavItem;
                    const itemGroup = adminItem.group ?? null;
                    const showHeader = itemGroup !== null && itemGroup !== lastGroup;
                    const isFirstGroupHeader = lastGroup === null;
                    lastGroup = itemGroup;
                    const badgeKey = adminItem.badgeKey;
                    const badgeCount = badgeKey && adminBadges ? adminBadges[badgeKey] : 0;
                    return (
                      <div key={item.to}>
                        {showHeader && itemGroup && (
                          <AdminSidebarGroupHeader
                            label={t(`admin.nav_group_${itemGroup}`)}
                            collapsed={sidebarCollapsed}
                            isFirst={isFirstGroupHeader}
                          />
                        )}
                        <AdminSideLink
                          to={item.to}
                          icon={item.icon}
                          label={t(item.labelKey)}
                          collapsed={sidebarCollapsed}
                          badgeCount={badgeCount}
                        />
                      </div>
                    );
                  });
                })()}
              </nav>
            ) : (
              <nav className="flex flex-col gap-0">
                {(() => {
                  // Render items in stable order, injecting a small section
                  // header (or, when collapsed, a thin divider) whenever the
                  // `group` field flips. The first item lives in `default` so
                  // no header sits above the dashboard.
                  let lastGroup: NavGroup = "default";
                  return displayItems.map((item) => {
                    const itemGroup: NavGroup = (item as NavItem).group ?? "default";
                    const showHeader = itemGroup !== lastGroup && itemGroup !== "default";
                    lastGroup = itemGroup;
                    return (
                      <div key={item.to}>
                        {showHeader && (
                          <SidebarGroupHeader
                            label={t(`nav.group_${itemGroup}`)}
                            collapsed={sidebarCollapsed}
                          />
                        )}
                        <SideLink
                          to={item.to}
                          icon={item.icon}
                          label={t(item.labelKey)}
                          collapsed={sidebarCollapsed}
                          darkActive={itemGroup === "guest"}
                        />
                      </div>
                    );
                  });
                })()}
              </nav>
            )}
          </div>
        </aside>
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          data-admin-shell={inAdminView ? "true" : undefined}
          /* Couple workspace marker — scopes the warm espresso text palette
             override in index.css (ink/navy → umber) so it never touches the
             admin shell, auth, or public pages. */
          data-app-shell={inAdminView ? undefined : "true"}
          className="flex-1 min-w-0 focus:outline-none"
        >
          {children}
        </main>
      </div>

      {/* Phone bottom nav — couple view shows 4 tabKey-flagged items + a
          "More" button that opens a bottom sheet with the rest. Admin view
          keeps its existing 5-tab layout (the 5 admin pages all fit) and
          inverts to a violet tint to mirror the desktop rail.
          `md:hidden` (was `lg:hidden`) — tablet now gets the icon-only rail
          above instead of duplicating with a bottom nav. */}
      <nav
        data-coach-target="bottom-nav"
        /* `safe-edges` adds left/right insets too, so the nav doesn't run
         * under the Dynamic Island on iPhone landscape. `will-change` +
         * `translate-z` keeps iOS Safari from re-compositing the bar every
         * time the address bar slides; without it the icons jitter during
         * scroll on the iOS 17+ minimal UI. */
        style={{ transform: "translateZ(0)", willChange: "transform" }}
        className="safe-edges fixed bottom-0 left-0 right-0 z-20 border-t backdrop-blur md:hidden border-paper-300 bg-paper-50/95 dark:border-umber-700 dark:bg-umber-900/95"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 px-2 py-2">
          {displayItems
            .filter((item) => item.tabKey)
            .slice(0, inAdminView ? 5 : 4)
            .map((item) => {
              const badgeKey = inAdminView ? (item as AdminNavItem).badgeKey : undefined;
              const badgeCount = badgeKey && adminBadges ? adminBadges[badgeKey] : 0;
              return (
                <BottomLink
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  variant={inAdminView ? "admin" : "default"}
                  badgeCount={badgeCount}
                >
                  {t(item.tabKey ?? item.labelKey)}
                </BottomLink>
              );
            })}
          {!inAdminView && (
            <button
              type="button"
              data-coach-target="more-button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] ${
                moreOpen ? "text-ink-900 dark:text-paper-50" : "text-ink-500 dark:text-umber-200"
              }`}
            >
              <MoreHorizontal size={18} aria-hidden="true" />
              <span className="truncate">{t("nav.tab_more")}</span>
            </button>
          )}
        </div>
      </nav>

      {moreOpen && (
        <MoreSheet
          items={coupleItems.filter((item) => !item.tabKey)}
          title={t("nav.more_sheet_title")}
          closeLabel={t("a11y.close")}
          onClose={() => setMoreOpen(false)}
          translate={t}
        />
      )}

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        source="app"
        context={location.pathname}
      />
      <KeyboardShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {/* First-run coach-marks. Mounts only on mobile and only when the
       *  user hasn't seen them — the component self-gates on localStorage
       *  + viewport. Admin view skips so admins don't see couple-facing
       *  onboarding when they hop in to moderate. */}
      {!inAdminView && <CoachMarks />}
    </div>
  );
}

/** Section divider that sits between sidebar groups. Renders a label
 *  flanked by two thin hairlines when the rail is expanded, and a single
 *  centered hairline (no text) when it's collapsed — so the visual break
 *  is preserved without overflowing the narrow rail.
 *
 *  `collapsed` reflects the user's laptop-level preference; at md (tablet)
 *  the rail is forced icon-only regardless, so the labelled header is
 *  hidden via `lg:flex` and a hairline is shown via `md:block lg:hidden`. */
function SidebarGroupHeader({ label, collapsed }: { label: string; collapsed?: boolean }) {
  // Fixed-height (h-7) row in every state — labelled when the laptop rail is
  // expanded, a centred hairline at tablet / when collapsed. Because a section
  // break takes the same vertical space either way, every icon below it lands
  // on the exact same row when the user toggles the rail.
  return (
    // `mt-2` sets a small, deliberate gap before each category so sections
    // read as distinct, while the items inside a category sit flush (the
    // parent nav uses `gap-0`). The fixed `h-7` is unchanged so an icon lands
    // on the same row whether the rail is expanded or collapsed.
    <div className="mt-2 flex h-7 items-center px-2">
      {/* Labelled header — fully-expanded laptop rail only. */}
      {!collapsed && (
        <div className="hidden w-full items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-ink-500 lg:flex dark:text-umber-300">
          <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
          <span>{label}</span>
          <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
        </div>
      )}
      {/* Hairline — tablet (icon-only) always, and laptop when collapsed. */}
      <div
        className={`h-px w-full bg-paper-300 dark:bg-umber-700 ${collapsed ? "" : "lg:hidden"}`}
        aria-hidden
      />
    </div>
  );
}

/** `.eyebrow`-styled subhead between admin nav groups. Only renders in the
 *  fully-expanded laptop rail; tablet (icon-only) + collapsed laptop get a
 *  quiet hairline divider instead so the grouping survives without labels.
 *  `isFirst` suppresses the top hairline+margin so the first group's header
 *  sits flush with the "Admin" eyebrow above it. */
function AdminSidebarGroupHeader({
  label,
  collapsed,
  isFirst,
}: {
  label: string;
  collapsed?: boolean;
  isFirst?: boolean;
}) {
  // Fixed-height (h-7) row in every state so it occupies the same vertical
  // space whether labelled (expanded) or a hairline (collapsed/tablet) — keeps
  // admin nav icons on the same row across a collapse toggle, matching the
  // couple SidebarGroupHeader.
  return (
    <div className="flex h-7 items-center px-2">
      {/* `.eyebrow` subhead — fully-expanded rail only. */}
      {!collapsed && (
        <div className="eyebrow hidden w-full lg:block" aria-hidden>
          {label}
        </div>
      )}
      {/* Hairline — icon-only modes. Skipped above the first group so the
          "Admin" eyebrow already provides the visual break. */}
      {!isFirst && (
        <div
          className={`h-px w-full bg-neutral-200/50 dark:bg-neutral-800/40 ${
            collapsed ? "" : "lg:hidden"
          }`}
          aria-hidden
        />
      )}
    </div>
  );
}

/** Couple-side sidebar link. The `collapsed` prop drives laptop+ behaviour;
 *  at md (tablet) the rail is forced icon-only via responsive utilities so
 *  iPad portrait still gets a usable sidebar. */
function SideLink({
  to,
  icon,
  label,
  collapsed,
  darkActive,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed?: boolean;
  /** Keep the cold near-black ink pill (`stationery-dark`) on the active row
   *  instead of the warm-coffee landing pill. Used only by the Guest page
   *  link, which the couple asked to stay visually "dark" / set apart from
   *  the rest of the rail. */
  darkActive?: boolean;
}) {
  // Base classes describe the icon-only shape used at md (tablet) and at
  // lg+ when `collapsed` is true. The expanded variant keeps the same fixed
  // `h-9` height and just grows its width to fit the label — so every row is
  // the same height collapsed or expanded, and an icon stays on the exact
  // same row when the user toggles the rail (paired with the fixed-height
  // SidebarGroupHeader below, which does the same for section breaks).
  const shape = collapsed
    ? "h-9 w-9 justify-center"
    : "h-9 w-9 justify-center lg:w-auto lg:justify-start lg:gap-3 lg:px-3";
  return (
    <NavLink
      to={to}
      end={to === "/app"}
      // Always set title/aria-label — at md the label is always hidden, so
      // screen readers + hover tooltips need it regardless of `collapsed`.
      title={label}
      aria-label={label}
      className={({ isActive }) => {
        // Active fill: warm-coffee landing pill for every row, except the
        // Guest page which keeps the cold ink pill so it reads as set apart.
        const active = darkActive
          ? "stationery-dark text-paper-100 dark:!bg-blush-400 dark:!text-umber-900 dark:!bg-none"
          : "stationery-coffee text-paper-50 dark:text-paper-50";
        return `flex items-center rounded-xl text-sm transition-colors ${shape} ${
          isActive
            ? active
            : "text-ink-700 hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
        }`;
      }}
    >
      {icon}
      {/* Label is hidden at md (icon-only) and at lg+ collapsed. */}
      {!collapsed && <span className="hidden lg:inline">{label}</span>}
    </NavLink>
  );
}

/** Sidebar link for admin pages. Inactive rows read as the regular
 *  neutral nav (ink-700) so the rail doesn't shout across every
 *  item; the active row alone fills a deep koromfekete pill that signals
 *  "you are here".
 *
 *  Like `SideLink`, the `collapsed` prop drives laptop+ behaviour while md
 *  is always icon-only — tablet rail had been hidden entirely before this,
 *  making analytics unreachable on iPad portrait. */
function AdminSideLink({
  to,
  icon,
  label,
  collapsed,
  badgeCount,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed?: boolean;
  /** Unread-style count rendered as a small red index on the right of the
   *  row. Hidden when zero. Capped at 99 to keep the pill from blowing up.
   *  In collapsed mode it shrinks to a 8px dot anchored to the icon. */
  badgeCount?: number;
}) {
  const shape = collapsed
    ? "h-9 w-9 justify-center"
    : "h-9 w-9 justify-center lg:w-auto lg:justify-start lg:gap-3 lg:px-3";
  return (
    <NavLink
      to={to}
      // Always announced — labels are hidden at md and at lg+ collapsed,
      // so SR users + tooltip hover both rely on title/aria-label here.
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        `flex items-center rounded-xl text-sm transition-colors ${shape} ${
          isActive
            ? "bg-neutral-950 text-white dark:bg-neutral-700"
            : "text-ink-700 hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
        }`
      }
    >
      {/* Icon-only badge: an 8px dot anchored to the icon. Always rendered
          at md (tablet); at lg+ it's swapped out for the labelled pill via
          `lg:hidden`. */}
      <span className={`relative inline-flex ${collapsed ? "" : "lg:hidden"}`}>
        {icon}
        {badgeCount && badgeCount > 0 ? (
          <span
            aria-label={`${badgeCount} new`}
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-blush-600"
          />
        ) : null}
      </span>
      {/* Labelled row — only at lg+ expanded. */}
      {!collapsed && (
        <>
          <span className="hidden lg:inline-flex">{icon}</span>
          <span className="hidden flex-1 lg:inline">{label}</span>
          {badgeCount && badgeCount > 0 ? (
            <span className="hidden lg:inline-flex">
              <SidebarBadge count={badgeCount} />
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

/** Small red unread-style index. Rendered on admin nav rows (desktop +
 *  mobile) when the matching aggregate count is > 0. Capped at 99+ so
 *  the pill doesn't grow unbounded. */
function SidebarBadge({ count }: { count: number }) {
  const display = count > 99 ? "99+" : String(count);
  return (
    <span
      aria-label={`${count} new`}
      className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-blush-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
    >
      {display}
    </span>
  );
}

/** Bottom-sheet rendering the nav items that didn't fit in the 4-tab mobile
 *  bar. Portal-mounted so it floats above the bottom nav with its own
 *  backdrop; closes on ESC, backdrop tap, and route change (handled by the
 *  caller's `location.pathname` effect). */
function MoreSheet({
  items,
  title,
  closeLabel,
  onClose,
  translate,
}: {
  items: NavItem[];
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

  return createPortal(
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink-900/40 backdrop-blur-sm md:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        /* `overscroll-contain` stops the page underneath from scrolling
         * when the user momentum-scrolls inside the sheet — iOS Safari
         * otherwise treats the body-overflow lock as a soft hint. */
        className="safe-edges w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t border-paper-300 bg-paper-50 px-4 pb-3 pt-4 shadow-pop dark:border-umber-700 dark:bg-umber-900 dark:text-paper-100"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
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
                className={({ isActive }) =>
                  `flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border px-2 text-center text-xs ${
                    isActive
                      ? "border-ink-900 bg-ink-900/5 text-ink-900 dark:border-paper-100 dark:bg-paper-100/10 dark:text-paper-50"
                      : "border-paper-300 text-ink-700 hover:bg-paper-200 dark:border-umber-700 dark:text-paper-200 dark:hover:bg-umber-800"
                  }`
                }
              >
                {item.icon}
                <span className="truncate">{translate(item.labelKey)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function BottomLink({
  to,
  icon,
  children,
  variant = "default",
  badgeCount,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  variant?: "default" | "admin";
  /** Same red index as the desktop AdminSideLink. Anchors top-right of
   *  the icon so it sits above the label like a notification dot. */
  badgeCount?: number;
}) {
  // Light mode: admin variant is koromfekete neutral, default stays navy. Dark mode flips to
  // a cream / blush palette so the labels actually read against the
  // umber-900 nav bar — the prior `text-ink-500` (deep navy) was
  // effectively invisible on dark, per the "dark dashboard nem látszik
  // jól" report.
  const active =
    variant === "admin"
      ? "text-neutral-950 dark:text-neutral-200"
      : "text-ink-900 dark:text-paper-50";
  const idle =
    variant === "admin" ? "text-ink-500 dark:text-umber-200" : "text-ink-500 dark:text-umber-200";
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
      <span className="relative inline-flex">
        {icon}
        {badgeCount && badgeCount > 0 ? (
          <span
            aria-label={`${badgeCount} new`}
            className="absolute -right-2 -top-2 inline-flex min-w-[16px] items-center justify-center rounded-full bg-blush-600 px-1 py-0.5 text-[9px] font-semibold leading-none text-white"
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        ) : null}
      </span>
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

/** Route-layout wrapper. Mount this at the parent `/app` route so the
 *  AppShell — sidebar, header, workspace switcher — stays mounted across
 *  every couple-facing navigation. Without this, each /app/* route renders
 *  its own AppShell instance, which causes the sidebar to flash and the
 *  WorkspaceSwitcher to refetch on every page change. Child pages just
 *  return their content (no AppShell wrapper). */
export function AppShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
