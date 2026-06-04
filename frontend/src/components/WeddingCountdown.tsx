// Live countdown to the wedding day, shown at the bottom of the guest page
// (both the public /w/:slug view and the couple's editor preview). Counts to
// 00:00 of the wedding date in the viewer's local time. Self-contained: ticks
// every second via its own interval. In the editor preview with no date set
// yet it renders a gray "add the date" ghost (matching the other preview
// placeholders); on the public view with no date it renders nothing.

import { CalendarDays, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

export function WeddingCountdown({
  date,
  isPreview = false,
  onEdit,
}: {
  /** ISO YYYY-MM-DD, or null when the couple hasn't set a date. */
  date: string | null;
  /** Editor preview only — renders the gray ghost when there's no date. */
  isPreview?: boolean;
  /** Editor preview only — clicking the ghost jumps to the date editor. */
  onEdit?: () => void;
}) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!date) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [date]);

  if (!date) {
    if (!isPreview) return null;
    return (
      <section
        className={`flex flex-col items-center gap-2 rounded-2xl border border-dashed border-paper-300 bg-paper-50 p-6 text-center dark:border-umber-700 dark:bg-umber-800/40${
          onEdit
            ? " cursor-pointer transition hover:border-ink-300 hover:bg-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-800"
            : ""
        }`}
        {...(onEdit
          ? {
              role: "button" as const,
              tabIndex: 0,
              onClick: onEdit,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onEdit();
                }
              },
            }
          : {})}
      >
        <CalendarDays size={22} className="text-ink-300 dark:text-umber-400" aria-hidden />
        <p className="text-sm font-medium text-ink-400 dark:text-umber-300">
          {t("guest_portal.countdown_title")}
        </p>
        <p className="flex items-center gap-1 text-xs text-ink-500 dark:text-umber-200">
          <Plus size={12} aria-hidden />
          {t("guest_portal.countdown_add_date")}
        </p>
      </section>
    );
  }

  const diff = Math.max(0, new Date(`${date}T00:00:00`).getTime() - now);
  const units = [
    { value: Math.floor(diff / DAY_MS), label: t("guest_portal.countdown_days") },
    { value: Math.floor((diff % DAY_MS) / HOUR_MS), label: t("guest_portal.countdown_hours") },
    { value: Math.floor((diff % HOUR_MS) / MIN_MS), label: t("guest_portal.countdown_minutes") },
    { value: Math.floor((diff % MIN_MS) / 1000), label: t("guest_portal.countdown_seconds") },
  ];

  return (
    <section className="rounded-2xl border border-paper-200 bg-paper-50 p-6 text-center dark:border-umber-700 dark:bg-umber-800/60">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-300">
        {t("guest_portal.countdown_title")}
      </p>
      <div className="mt-4 flex justify-center gap-3 sm:gap-6">
        {units.map((u) => (
          <div key={u.label} className="flex min-w-[3.25rem] flex-col items-center">
            <span className="stat-num text-3xl font-bold tabular-nums text-ink-900 sm:text-4xl dark:text-paper-50">
              {String(u.value).padStart(2, "0")}
            </span>
            <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {u.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
