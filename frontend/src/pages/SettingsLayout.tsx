// Wrapper around the four /app/settings sub-routes. Renders the hero
// band once, mounts a horizontal tab nav, and delegates the actual
// section list to the matched `<ProfilePage tab="…" />` outlet.
//
// Why a wrapper instead of duplicating the hero per page: the hero is
// expensive (couple fetch + days-until calc) and visually identical
// across tabs, so pulling it up here avoids a re-mount + re-fetch on
// every tab switch and keeps the tab nav in stable position.

import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { Couple } from "@shared/types";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { ProfileHero } from "./ProfilePage";

const TABS = [
  { id: "account", path: "account", labelKey: "settings.tab_account" },
  { id: "workspace", path: "workspace", labelKey: "settings.tab_workspace" },
  { id: "planning", path: "planning", labelKey: "settings.tab_planning" },
  { id: "billing", path: "billing", labelKey: "settings.tab_billing" },
  { id: "data", path: "data", labelKey: "settings.tab_data" },
] as const;

export default function SettingsLayout() {
  const { t, locale } = useT();
  useDocumentMeta("seo.profile_title", "seo.profile_description");
  const [couple, setCouple] = useState<Couple | null>(null);
  useEffect(() => {
    coupleApi.current().then((r) => setCouple(r.couple));
  }, []);

  return (
    <>
      <h1 className="sr-only">{t("profile.title")}</h1>
      <ProfileHero couple={couple} t={t} locale={locale} onUpdated={setCouple} />

      {/* Horizontal tab nav. Mobile gets a scrollable strip; desktop a
       *  static row. NavLink's `isActive` paints the ink underline.
       *  Each tab is a real router link so the URL reflects which tab
       *  the user is on (deep-linkable, sharable, back-button friendly). */}
      <nav
        aria-label={t("settings.tabs_aria_label")}
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
            {t(
              tab.labelKey as `settings.tab_${
                | "account"
                | "workspace"
                | "planning"
                | "billing"
                | "data"}`,
            )}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </>
  );
}
