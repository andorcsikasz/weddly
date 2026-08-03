// Vendor settings hub — the tabbed profile surface at /vendor/settings.
// Mirrors PlannerSettingsLayout: a hero (business monogram + name + email +
// vendor-code badge) over a tab nav. Tabs: account (personal basics),
// company (legal-payee identity + public bio), billing (Csomag — the former
// /vendor/billing page) and data (JSON takeout). The listing/account view is
// fetched once here and shared with the children via Outlet context.

import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { VendorListingView } from "@shared/listings";
import { vendorListingApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

const TABS = [
  { id: "account", path: "account", labelKey: "vendor.settings.tab_account" },
  { id: "company", path: "company", labelKey: "vendor.settings.tab_company" },
  { id: "schedule", path: "schedule", labelKey: "vendor.settings.tab_schedule" },
  { id: "automations", path: "automations", labelKey: "vendor.settings.tab_automations" },
  { id: "billing", path: "billing", labelKey: "vendor.settings.tab_billing" },
  { id: "data", path: "data", labelKey: "vendor.settings.tab_data" },
] as const;

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  const first = (words[0] ?? "")[0] ?? "";
  const second = (words[1] ?? "")[0] ?? "";
  return (first + second).toUpperCase();
}

export interface VendorSettingsContext {
  view: VendorListingView | null;
  setView: (view: VendorListingView) => void;
  loadError: boolean;
}

export default function VendorSettingsLayout() {
  const { t } = useT();
  const { pathname } = useLocation();
  useDocumentTitle(
    pathname.endsWith("/billing")
      ? t("vendor.billing.page_title")
      : t("vendor.settings.page_title"),
  );

  const [view, setView] = useState<VendorListingView | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    vendorListingApi
      .me()
      .then((v) => setView(v))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const displayName = view?.account.display_name ?? "";

  return (
    <div className="mx-auto max-w-2xl py-2">
      {/* Hero */}
      <div className="flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blush-500 text-lg font-semibold uppercase text-paper-50">
          {view ? initialsOf(displayName) : "?"}
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-grotesk text-2xl font-semibold leading-tight tracking-tight text-ink-900 dark:text-paper-50">
            {displayName || t("vendor.settings.page_title")}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {view?.account.contact_email && (
              <span className="truncate text-sm text-ink-500 dark:text-umber-300">
                {view.account.contact_email}
              </span>
            )}
            <span className="rounded-md bg-paper-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-600 dark:bg-umber-800 dark:text-umber-300">
              {t("vendor.settings.badge_vendor")}
            </span>
            {view?.account.vendor_code && (
              <span className="rounded-md bg-paper-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-500 dark:bg-blush-500/20 dark:text-paper-400">
                {view.account.vendor_code}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <nav
        aria-label={t("vendor.settings.tabs_aria")}
        className="-mb-px mt-6 flex gap-1 overflow-x-auto border-b border-paper-200 px-1 dark:border-umber-700"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.id}
            to={tab.path}
            end
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "border-ink-900 text-ink-900 dark:border-paper-50 dark:text-paper-50"
                  : "border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800 dark:text-umber-300 dark:hover:border-umber-500 dark:hover:text-paper-100"
              }`
            }
          >
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </nav>

      {loadError && (
        <div
          role="alert"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-blush-800 dark:border-blush-900/40 dark:bg-blush-950/30 dark:text-blush-300"
        >
          <span>{t("common.error_generic")}</span>
          <button type="button" onClick={load} className="btn-outline btn-sm shrink-0">
            {t("error_boundary.try_again")}
          </button>
        </div>
      )}

      <div className="pb-16">
        <Outlet context={{ view, setView, loadError } satisfies VendorSettingsContext} />
      </div>
    </div>
  );
}
