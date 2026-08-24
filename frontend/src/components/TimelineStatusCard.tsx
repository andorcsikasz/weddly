// Dashboard "how you're doing" card. Self-fetches the notification feed and
// surfaces the live timeline rollup (overdue / due-soon counts). Renders ONLY
// when something needs attention, so a couple who's on track sees no clutter —
// the bell already carries the always-on signal.
//
// The "N overdue" line used to be plain text — nothing happened when a couple
// tapped it, which read as a dead control on a card whose only other affordance
// is a generic "Open timeline" button. It's a disclosure toggle now: tapping it
// expands the actual overdue / due-soon task titles (already in hand from the
// same feed fetch, so no extra request) right on the dashboard, before the
// couple commits to leaving the page.

import type { NotificationItem } from "@shared/notifications";
import { AlertTriangle, ArrowRight, CalendarClock, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { notificationApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

function itemLabel(t: ReturnType<typeof useT>["t"], item: NotificationItem): string {
  const task = String(item.data.taskTitle ?? "");
  return item.kind === "timeline_overdue"
    ? t("notifications.timeline_overdue", { task })
    : t("notifications.timeline_due", { task });
}

export function TimelineStatusCard() {
  const { t } = useT();
  const [overdue, setOverdue] = useState(0);
  const [dueSoon, setDueSoon] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    notificationApi
      .list()
      .then((feed) => {
        if (cancelled) return;
        setOverdue(feed.overdue);
        setDueSoon(feed.due_soon);
        setItems(
          feed.items.filter((i) => i.kind === "timeline_overdue" || i.kind === "timeline_due"),
        );
      })
      .catch(() => {
        /* non-critical — the card just stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only surface when there's something to act on.
  if (overdue === 0 && dueSoon === 0) return null;

  const summary = [
    overdue > 0 ? t("notifications.dash_overdue", { count: overdue }) : null,
    dueSoon > 0 ? t("notifications.dash_due_soon", { count: dueSoon }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="card mb-8 ring-1 ring-blush-200/70 dark:ring-blush-400/20">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-50 text-blush-600 dark:bg-blush-400/15 dark:text-blush-300">
          {overdue > 0 ? (
            <AlertTriangle size={18} aria-hidden="true" />
          ) : (
            <CalendarClock size={18} aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-grotesk text-sm font-semibold text-ink-900 dark:text-paper-50">
            {t("notifications.dash_title")}
          </p>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-0.5 inline-flex items-center gap-1 rounded-sm text-sm text-ink-600 transition-colors hover:text-blush-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-200 dark:hover:text-blush-300 dark:focus-visible:ring-paper-100"
            >
              <span>{summary}</span>
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`transition-transform duration-200 ease-out ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          ) : (
            <p className="mt-0.5 text-sm text-ink-600 dark:text-umber-200">{summary}</p>
          )}
        </div>
        <Link
          to="/app/timeline"
          className="btn-outline btn-sm inline-flex shrink-0 items-center gap-1.5"
        >
          <span>{t("notifications.dash_cta")}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {expanded && items.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-paper-200 border-t border-paper-200 pt-1 dark:divide-umber-700 dark:border-umber-700">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/app/timeline"
                className="group flex items-center gap-2.5 rounded-sm py-1.5 text-sm text-ink-700 transition-colors hover:text-blush-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-paper-100 dark:hover:text-blush-300 dark:focus-visible:ring-paper-100"
              >
                {item.kind === "timeline_overdue" ? (
                  <AlertTriangle
                    size={13}
                    aria-hidden="true"
                    className="shrink-0 text-blush-600 dark:text-blush-300"
                  />
                ) : (
                  <CalendarClock
                    size={13}
                    aria-hidden="true"
                    className="shrink-0 text-ink-400 dark:text-umber-300"
                  />
                )}
                <span className="truncate">{itemLabel(t, item)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
