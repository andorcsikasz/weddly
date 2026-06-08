// Dashboard "how you're doing" card. Self-fetches the notification feed and
// surfaces the live timeline rollup (overdue / due-soon counts). Renders ONLY
// when something needs attention, so a couple who's on track sees no clutter —
// the bell already carries the always-on signal.

import { AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { notificationApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export function TimelineStatusCard() {
  const { t } = useT();
  const [overdue, setOverdue] = useState(0);
  const [dueSoon, setDueSoon] = useState(0);

  useEffect(() => {
    let cancelled = false;
    notificationApi
      .list()
      .then((feed) => {
        if (cancelled) return;
        setOverdue(feed.overdue);
        setDueSoon(feed.due_soon);
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

  return (
    <section className="card mb-8 flex flex-wrap items-center gap-x-5 gap-y-3 ring-1 ring-blush-200/70 dark:ring-blush-400/20">
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
        <p className="mt-0.5 text-sm text-ink-600 dark:text-umber-200">
          {[
            overdue > 0 ? t("notifications.dash_overdue", { count: overdue }) : null,
            dueSoon > 0 ? t("notifications.dash_due_soon", { count: dueSoon }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <Link
        to="/app/timeline"
        className="btn-outline btn-sm inline-flex shrink-0 items-center gap-1.5"
      >
        <span>{t("notifications.dash_cta")}</span>
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </section>
  );
}
