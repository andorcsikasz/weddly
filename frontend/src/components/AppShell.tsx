// Authenticated shell: top bar + sidebar (desktop) / bottom tabs (mobile).
import {
  Calendar,
  ChefHat,
  Heart,
  LayoutDashboard,
  Settings,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

const ITEMS: { to: string; labelKey: string; icon: ReactNode }[] = [
  { to: "/app", labelKey: "nav.dashboard", icon: <LayoutDashboard size={18} /> },
  { to: "/app/guests", labelKey: "nav.guests", icon: <Users size={18} /> },
  { to: "/app/budget", labelKey: "nav.budget", icon: <UtensilsCrossed size={18} /> },
  { to: "/app/seating", labelKey: "nav.seating", icon: <ChefHat size={18} /> },
  { to: "/app/suppliers", labelKey: "nav.suppliers", icon: <Heart size={18} /> },
  { to: "/app/settings", labelKey: "nav.settings", icon: <Settings size={18} /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { t, locale, setLocale } = useT();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-paper-300 bg-paper-50/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/app" className="font-serif text-xl font-semibold tracking-tight text-ink-900">
            {t("app.name")}
          </Link>
          <div className="flex items-center gap-2">
            {user && (
              <span className="hidden text-xs text-ink-500 sm:inline-block">{user.email}</span>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
            >
              {locale === "hu" ? "EN" : "HU"}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => logout()}>
              {t("common.sign_out")}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 pb-24 pt-6 sm:pb-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-20 flex flex-col gap-1">
            {ITEMS.map((item) => (
              <SideLink key={item.to} to={item.to} icon={item.icon}>
                {t(item.labelKey)}
              </SideLink>
            ))}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {/* Mobile bottom nav. */}
      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-20 border-t border-paper-300 bg-paper-50/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 px-2 py-2">
          {ITEMS.slice(0, 5).map((item) => (
            <BottomLink key={item.to} to={item.to} icon={item.icon}>
              {t(item.labelKey)}
            </BottomLink>
          ))}
        </div>
      </nav>
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
        `flex flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] ${
          isActive ? "text-ink-900" : "text-ink-500"
        }`
      }
    >
      {icon}
      <span className="truncate">{children}</span>
    </NavLink>
  );
}
