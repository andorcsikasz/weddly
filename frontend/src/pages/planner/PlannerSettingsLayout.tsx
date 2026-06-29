import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { PlannerProfile } from "@shared/types";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentMeta } from "../../lib/seo";

const TABS = [
  { id: "account", path: "account", labelKey: "planner_profile.tab_account" },
  { id: "subscription", path: "subscription", labelKey: "planner_profile.tab_subscription" },
  { id: "data", path: "data", labelKey: "planner_profile.tab_data" },
] as const;

function getInitials(fullName: string, email: string): string {
  const source = fullName.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return (first + last).toUpperCase();
  }
  const single = parts[0] ?? "";
  return single.slice(0, 2).toUpperCase() || "?";
}

export default function PlannerSettingsLayout() {
  const { t } = useT();
  useDocumentMeta("planner_profile.meta_title", "planner_profile.meta_description");
  const [profile, setProfile] = useState<PlannerProfile | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    plannerApi
      .getProfile()
      .then((p) => {
        setProfile(p);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, []);

  const initials = profile ? getInitials(profile.full_name, profile.email) : "?";

  return (
    <div className="mx-auto max-w-2xl py-2">
      <div>
        {/* Hero */}
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-umber-900 font-grotesk text-xl font-semibold text-paper-50 dark:bg-umber-700">
            {initials}
          </div>
          <div>
            <h1 className="font-grotesk text-2xl font-semibold leading-tight tracking-tight text-umber-900 dark:text-paper-50">
              {profile?.full_name ?? " "}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-umber-500 dark:text-umber-300">
                {profile?.email ?? ""}
              </span>
              <span className="rounded-md bg-paper-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-umber-600 dark:bg-umber-800 dark:text-umber-300">
                {t("planner_profile.badge_planner")}
              </span>
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <nav
          aria-label={t("planner_profile.tabs_aria")}
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
                tab.labelKey as
                  | "planner_profile.tab_account"
                  | "planner_profile.tab_subscription"
                  | "planner_profile.tab_data",
              )}
            </NavLink>
          ))}
        </nav>

        {loadError && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-blush-800 dark:border-blush-900/40 dark:bg-blush-950/30 dark:text-blush-300"
          >
            {t("planner_profile.load_error")}
          </p>
        )}

        <div className="pb-16">
          <Outlet context={{ profile, setProfile, loadError }} />
        </div>
      </div>
    </div>
  );
}
