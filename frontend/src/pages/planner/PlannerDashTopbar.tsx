import { Bell, LogOut, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "../../components/Wordmark";
import { useT } from "../../lib/i18n";

interface Props {
  plannerName: string;
  urgentCount: number;
  plan: string;
  maxClients: number;
  activeClients: number;
  onLogout: () => void;
}

export function PlannerDashTopbar({
  plannerName,
  urgentCount,
  plan,
  maxClients,
  activeClients,
  onLogout,
}: Props) {
  const { t } = useT();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [dropdownOpen]);

  const initials = plannerName.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2 sm:px-6">
        <div className="flex flex-col leading-tight">
          <Link to="/app/planner">
            <Wordmark size="sm" />
          </Link>
          {urgentCount > 0 ? (
            <span className="mt-0.5 text-xs text-umber-700 dark:text-paper-200">
              {"Üdv, " + plannerName + "! · " + t("planner_home.topbar_greeting_urgent").replace("{{n}}", String(urgentCount))}
            </span>
          ) : (
            <span className="mt-0.5 text-xs text-umber-700 dark:text-paper-200">
              {"Üdv, " + plannerName + "!"}
            </span>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3">
          <span className="rounded-full border border-umber-200 px-3 py-1 text-xs capitalize text-umber-600 dark:border-umber-600 dark:text-paper-200">
            {plan + " · " + String(activeClients) + "/" + String(maxClients)}
          </span>

          <button
            type="button"
            className="relative rounded-lg p-1.5 text-umber-700 transition-colors hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800"
            aria-label={t("planner_home.topbar_notif_aria")}
          >
            <Bell size={18} />
            {urgentCount > 0 && (
              <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500" />
            )}
          </button>

          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-umber-900 text-xs font-semibold text-paper-50 transition-opacity hover:opacity-80 dark:bg-umber-700"
              aria-label={t("planner_home.topbar_profile_aria")}
              onClick={() => setDropdownOpen((v) => !v)}
            >
              {initials}
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-paper-200 bg-paper-50 shadow-lg dark:border-umber-700 dark:bg-umber-900">
                <Link
                  to="/app/planner/profile"
                  className="flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm text-ink-900 transition-colors hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-800"
                  onClick={() => setDropdownOpen(false)}
                >
                  <User size={14} />
                  {t("planner_home.topbar_profile_link")}
                </Link>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-b-xl px-4 py-2.5 text-sm text-ink-900 transition-colors hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-800"
                  onClick={() => {
                    setDropdownOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={14} />
                  {t("planner_home.topbar_logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/*
LOCALE KEYS:
planner_home.topbar_greeting_urgent  hu: "{{n}} sürgős feladat"          en: "{{n}} urgent"
planner_home.topbar_notif_aria       hu: "Értesítések"                    en: "Notifications"
planner_home.topbar_profile_aria     hu: "Profil menü"                    en: "Profile menu"
planner_home.topbar_profile_link     hu: "Profil"                         en: "Profile"
planner_home.topbar_logout           hu: "Kijelentkezés"                  en: "Log out"
*/
