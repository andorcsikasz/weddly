import { Bell, Home, LogOut, MessageCircle, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Wordmark } from "../../components/Wordmark";
import { useT } from "../../lib/i18n";

interface Props {
  plannerName: string;
  plannerEmail: string;
  urgentCount: number;
  plan: string;
  maxClients: number;
  activeClients: number;
  onLogout: () => void;
  onOpenFeedback?: () => void;
}

export function PlannerDashTopbar({
  plannerName,
  plannerEmail,
  urgentCount,
  plan,
  maxClients,
  activeClients,
  onLogout,
  onOpenFeedback,
}: Props) {
  const { t } = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside pointer + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-close on route change.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const initials = getInitials(plannerName, plannerEmail);

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

          <div className="relative" ref={wrapRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={t("planner_home.topbar_profile_aria")}
              onClick={() => setOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-umber-900 text-xs font-semibold text-paper-50 transition-opacity hover:opacity-80 dark:bg-umber-700"
            >
              {initials}
            </button>

            {open && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] origin-top-right rounded-2xl border border-paper-300 bg-white p-2 font-grotesk shadow-pop [&_a]:lowercase [&_button]:lowercase dark:border-umber-700 dark:bg-umber-800"
              >
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                    {plannerName}
                  </p>
                  <p className="truncate text-xs text-ink-500 dark:text-umber-300">
                    {plannerEmail}
                  </p>
                </div>
                <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
                <Link
                  to="/app/planner/settings/account"
                  role="menuitem"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
                >
                  <UserRound size={16} aria-hidden="true" />
                  <span>{t("planner_home.topbar_profile_link")}</span>
                </Link>
                <Link
                  to="/"
                  role="menuitem"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
                >
                  <Home size={16} aria-hidden="true" />
                  <span>{t("planner_home.topbar_back_to_landing")}</span>
                </Link>
                {onOpenFeedback && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onOpenFeedback();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
                  >
                    <MessageCircle size={16} aria-hidden="true" />
                    <span>{t("planner_home.topbar_feedback")}</span>
                  </button>
                )}
                <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
                >
                  <LogOut size={16} aria-hidden="true" />
                  <span>{t("planner_home.topbar_logout")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

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
