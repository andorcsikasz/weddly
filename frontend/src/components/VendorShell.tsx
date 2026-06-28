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

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

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
              {businessName ?? t("vendor.nav.brand_fallback")}
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
        {/* Left rail on desktop; horizontal scroller on mobile. */}
        <aside className="shrink-0 lg:w-56">
          <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">
            {VENDOR_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "stationery-coffee text-paper-50 dark:text-paper-50"
                      : "text-ink-700 hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
                  }`
                }
              >
                {item.icon}
                <span>{t(item.labelKey)}</span>
              </NavLink>
            ))}
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
