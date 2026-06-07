// Live countdown to the wedding day, shown near the bottom of the guest page
// (both the public /w/:slug view and the couple's editor preview). Counts to
// 00:00 of the wedding date in the viewer's local time. Self-contained: ticks
// every second via its own interval. In the editor preview with no date set
// yet it renders an "add the date" ghost (matching the other preview
// placeholders); on the public view with no date it renders nothing.
//
// Two looks:
//   - "card" (default): the legacy bordered paper card, for any non-themed use.
//   - "band":  a full-bleed dark editorial section, coloured entirely from the
//     wedding theme vars (--wt-text background, --wt-bg foreground) so it reads
//     as the page's near-black countdown band regardless of palette + ignores
//     the app's global dark mode.

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
  variant = "card",
}: {
  /** ISO YYYY-MM-DD, or null when the couple hasn't set a date. */
  date: string | null;
  /** Editor preview only — renders the ghost when there's no date. */
  isPreview?: boolean;
  /** Editor preview only — clicking the ghost jumps to the date editor. */
  onEdit?: () => void;
  /** "band" = full-bleed dark editorial section themed from --wt-*. */
  variant?: "card" | "band";
}) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!date) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [date]);

  const band = variant === "band";

  if (!date) {
    if (!isPreview) return null;
    if (band) {
      return (
        <section
          className={`w-full px-6 py-12 text-center sm:px-8${
            onEdit ? " cursor-pointer transition hover:opacity-90" : ""
          }`}
          style={{ backgroundColor: "var(--wt-text)", color: "var(--wt-bg)" }}
          {...editAffordance(onEdit)}
        >
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-2">
            <CalendarDays size={22} aria-hidden style={{ opacity: 0.6 }} />
            <p className="text-2xl tracking-tight" style={{ fontFamily: "var(--wt-heading-font)" }}>
              {t("guest_portal.countdown_title")}
            </p>
            <p className="flex items-center gap-1 text-xs" style={{ opacity: 0.7 }}>
              <Plus size={12} aria-hidden />
              {t("guest_portal.countdown_add_date")}
            </p>
          </div>
        </section>
      );
    }
    return (
      <section
        className={`flex flex-col items-center gap-2 rounded-2xl border border-dashed border-paper-300 bg-paper-50 p-6 text-center dark:border-umber-700 dark:bg-umber-800/40${
          onEdit
            ? " cursor-pointer transition hover:border-ink-300 hover:bg-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-800"
            : ""
        }`}
        {...editAffordance(onEdit)}
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

  if (band) {
    return (
      <section
        className="w-full px-6 py-14 text-center sm:px-8 sm:py-20"
        style={{ backgroundColor: "var(--wt-text)", color: "var(--wt-bg)" }}
      >
        <div className="mx-auto max-w-4xl">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.28em]"
            style={{ opacity: 0.7 }}
          >
            {t("guest_portal.countdown_title")}
          </p>
          <div className="mt-6 flex justify-center gap-6 sm:gap-12">
            {units.map((u) => (
              <div key={u.label} className="flex min-w-[3.5rem] flex-col items-center">
                <span
                  className="text-4xl tabular-nums sm:text-6xl"
                  style={{ fontFamily: "var(--wt-heading-font)" }}
                >
                  {String(u.value).padStart(2, "0")}
                </span>
                <span
                  className="mt-2 text-[10px] font-medium uppercase tracking-[0.18em]"
                  style={{ opacity: 0.65 }}
                >
                  {u.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

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

/** Click/keyboard affordance for the preview ghost (jump to the date editor). */
function editAffordance(onEdit: (() => void) | undefined) {
  if (!onEdit) return {};
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onEdit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onEdit();
      }
    },
  };
}
