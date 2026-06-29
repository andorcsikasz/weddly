// Vendor workspace shell — the authenticated layout for role='vendor' users at
// /vendor/*. Mirrors AppShell's structure (sticky header with the wordmark +
// account menu + logout, a left nav rail) but is intentionally lean: vendors
// have six primary surfaces, not the couple's twenty. The nav rail collapses to
// a horizontal scroller on mobile. Page chrome uses the standard horizontal
// padding (px-4 sm:px-6 lg:px-8 xl:px-10) so content isn't pressed to the edge.

import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Store,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { vendorListingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Wordmark } from "./Wordmark";

type VendorNavItem = { to: string; labelKey: string; icon: ReactNode; end?: boolean };

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
  { to: "/vendor/billing", labelKey: "vendor.nav.billing", icon: <CreditCard size={18} /> },
  { to: "/vendor/settings", labelKey: "vendor.nav.settings", icon: <Settings size={18} /> },
];

// localStorage key for the desktop nav rail collapsed/expanded preference.
const NAV_COLLAPSED_KEY = "weddly.vendor_nav_collapsed";

// Up-to-two-letter initials from the business name, for the profile-chip avatar.
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  const first = (words[0] ?? "")[0] ?? "";
  const second = (words[1] ?? "")[0] ?? "";
  return (first + second).toUpperCase();
}

export function VendorShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { logout } = useAuth();
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
      <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <div className="flex items-center gap-3">
            <Link
              to="/vendor"
              className="inline-flex h-11 items-center text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
            >
              <Wordmark size="sm" />
            </Link>
            <span className="hidden truncate text-sm font-medium text-ink-600 sm:inline dark:text-paper-300">
              {displayName}
            </span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100"
          >
            <LogOut size={18} aria-hidden="true" />
            <span className="hidden sm:inline">{t("vendor.nav.logout")}</span>
          </button>
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
          <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">
            {VENDOR_ITEMS.map((item) => {
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
                        ? "stationery-coffee text-paper-50 dark:text-paper-50"
                        : "text-ink-700 hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
                    }`
                  }
                >
                  {item.icon}
                  <span className={collapsed ? "lg:hidden" : ""}>{label}</span>
                </NavLink>
              );
            })}

            {/* Profile chip + collapse toggle - desktop only. */}
            <div className="mt-2 hidden flex-col gap-1 border-t border-paper-300 pt-2 lg:flex dark:border-umber-700">
              <Link
                to="/vendor/settings"
                title={collapsed ? displayName : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-xl py-2 text-sm text-ink-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800 ${
                  collapsed ? "justify-center px-0" : "px-3"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full stationery-coffee text-xs font-semibold text-paper-50 dark:text-paper-50">
                  {initialsOf(displayName)}
                </span>
                <span className={`truncate ${collapsed ? "hidden" : ""}`}>{displayName}</span>
              </Link>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                aria-label={
                  collapsed ? t("vendor.nav.expand_sidebar") : t("vendor.nav.collapse_sidebar")
                }
                className={`flex shrink-0 items-center gap-3 rounded-xl py-2 text-sm text-ink-600 transition-colors hover:bg-paper-200 dark:text-paper-300 dark:hover:bg-umber-800 ${
                  collapsed ? "justify-center px-0" : "px-3"
                }`}
              >
                {collapsed ? (
                  <PanelLeftOpen size={18} aria-hidden="true" />
                ) : (
                  <PanelLeftClose size={18} aria-hidden="true" />
                )}
                <span className={collapsed ? "hidden" : ""}>
                  {t("vendor.nav.collapse_sidebar")}
                </span>
              </button>
            </div>
          </nav>
        </aside>
        <main id="main-content" className="min-w-0 flex-1 focus:outline-none">
          {children}
        </main>
      </div>
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
