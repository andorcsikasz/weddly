import { CalendarClock, ClipboardList, GanttChartSquare } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useT } from "../lib/i18n";

/** Map between the three planning surfaces users can reasonably call a
 * "schedule": tasks, the dated planning timeline, and the day-of run sheet. */
export function PlanningRouteLinks({ className = "" }: { className?: string }) {
  const { t } = useT();
  const location = useLocation();
  const links = [
    { to: "/app/planning", label: t("nav.planning"), Icon: ClipboardList },
    { to: "/app/timeline", label: t("nav.timeline"), Icon: GanttChartSquare },
    { to: "/app/schedule", label: t("nav.schedule"), Icon: CalendarClock },
  ];

  return (
    <nav
      aria-label={`${t("nav.planning")} / ${t("nav.timeline")} / ${t("nav.schedule")}`}
      className={`flex max-w-full gap-1 overflow-x-auto ${className}`}
    >
      {links.map(({ to, label, Icon }) => {
        const active = location.pathname === to;
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-ink-800 bg-ink-800 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                : "border-paper-300 bg-paper-50 text-ink-600 hover:border-ink-400 hover:text-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-200 dark:hover:border-umber-500 dark:hover:text-paper-50"
            }`}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
