// Authenticated shell: top bar + sidebar (desktop) / bottom tabs (mobile).
import {
  Camera,
  ChefHat,
  Heart,
  LayoutDashboard,
  MessageCircle,
  Plane,
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
import { VerifyEmailBanner } from "./VerifyEmailBanner";

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
  {
    to: "/app/seating",
    labelKey: "nav.seating",
    tabKey: "nav.tab_seating",
    icon: <ChefHat size={18} />,
  },
  {
    to: "/app/suppliers",
    labelKey: "nav.suppliers",
    tabKey: "nav.tab_suppliers",
    icon: <Heart size={18} />,
  },
  // Post-wedding "follow-up" entries — desktop sidebar only; bottom mobile
  // nav stays at 5 items via `slice(0, 5)` further down.
  {
    to: "/app/honeymoon",
    labelKey: "nav.honeymoon",
    icon: <Plane size={18} />,
  },
  {
    to: "/app/media",
    labelKey: "nav.media",
    icon: <Camera size={18} />,
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

  // Admin tools (supplier moderation, user/couple directory) live in the
  // ProfileMenu dropdown — sidebar stays focused on couple-facing pages.
  const displayItems = ITEMS;

  return (
    <div className="min-h-full">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-paper-100 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:outline-none focus:ring-2 focus:ring-ink-500 focus:ring-offset-2"
      >
        {t("landing.skip_to_main")}
      </a>
      <header className="sticky top-0 z-20 border-b border-paper-300 bg-paper-50/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-ink-900 transition-colors hover:text-ink-700">
            <Wordmark size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm inline-flex items-center gap-1.5"
              aria-label={t("landing.nav_feedback")}
              onClick={() => setFeedbackOpen(true)}
            >
              <MessageCircle size={14} aria-hidden="true" />
              <span className="hidden sm:inline">{t("landing.nav_feedback")}</span>
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm inline-flex items-center gap-1.5"
              onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
              aria-label={t("nav.switch_language")}
            >
              <GlobeIcon />
              <span className="hidden sm:inline">
                {locale === "hu" ? t("nav.switch_to_en") : t("nav.switch_to_hu")}
              </span>
            </button>
            <ProfileMenu />
          </div>
        </div>
      </header>

      <VerifyEmailBanner />

      <div className="mx-auto flex max-w-7xl gap-8 px-4 pb-24 pt-6 sm:pb-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-20 flex flex-col gap-1">
            {displayItems.map((item) => (
              <SideLink key={item.to} to={item.to} icon={item.icon}>
                {t(item.labelKey)}
              </SideLink>
            ))}
          </nav>
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

      {/* Mobile bottom nav. */}
      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-20 border-t border-paper-300 bg-paper-50/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 px-2 py-2">
          {displayItems.slice(0, 5).map((item) => (
            <BottomLink key={item.to} to={item.to} icon={item.icon}>
              {t(item.tabKey ?? item.labelKey)}
            </BottomLink>
          ))}
        </div>
      </nav>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} source="app" />
    </div>
  );
}

/** Tiny hand-rolled globe icon (no new deps). aria-hidden — the button's
 *  aria-label carries the meaning. */
function GlobeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13" />
      <path d="M8 1.5c2 2 2 11 0 13" />
      <path d="M8 1.5c-2 2-2 11 0 13" />
    </svg>
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
          isActive ? "bg-ink-800 text-paper-100" : "text-ink-700 hover:bg-paper-200"
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
        `flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] ${
          isActive ? "text-ink-900" : "text-ink-500"
        }`
      }
    >
      {icon}
      <span className="truncate">{children}</span>
    </NavLink>
  );
}
