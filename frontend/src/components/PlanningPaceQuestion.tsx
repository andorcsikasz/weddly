// "How far ahead are you planning?" The first thing the checklist asks, and
// the same three cards when the couple later changes their mind. The answer
// re-times the whole catalog (see `PlanningPace` in shared/wedding_checklist).
import {
  PACE_HORIZON_MONTHS,
  PLANNING_PACES,
  type PlanningPace,
  recommendedPlanningPace,
} from "@shared/wedding_checklist";
import { Bird, Check, Coffee, Loader2, type LucideIcon, Zap } from "lucide-react";
import { intlLocale, todayIso } from "../lib/format";
import { useT } from "../lib/i18n";

export const PACE_ICON: Record<PlanningPace, LucideIcon> = {
  early_bird: Bird,
  relaxed: Coffee,
  last_minute: Zap,
};

// The strip is the longest runway any pace plans for, so the three cards read
// side by side as one ruler: a filled cell is a month this pace plans across,
// and the run always ends at the wedding day on the right.
const STRIP_MONTHS = Math.max(...PLANNING_PACES.map((p) => PACE_HORIZON_MONTHS[p]));

function RunwayStrip({ months, selected }: { months: number; selected: boolean }) {
  return (
    <span className="flex w-full items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: STRIP_MONTHS }, (_, i) => {
        const filled = i >= STRIP_MONTHS - months;
        return (
          <span
            key={i}
            className={`h-5 flex-1 rounded-[2px] transition-colors ${
              filled
                ? selected
                  ? "bg-ink-900 dark:bg-paper-50"
                  : "bg-ink-900/70 group-hover:bg-ink-900 dark:bg-paper-50/70 dark:group-hover:bg-paper-50"
                : "bg-ink-900/[0.07] dark:bg-paper-50/10"
            }`}
          />
        );
      })}
      <span
        className={`ml-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${
          selected ? "ring-ink-900 dark:ring-paper-50" : "ring-ink-900/50 dark:ring-paper-50/50"
        }`}
      />
    </span>
  );
}

export function PlanningPaceQuestion({
  weddingDate,
  current,
  saving,
  compact = false,
  onPick,
}: {
  weddingDate: string | null;
  /** The stored answer, highlighted; null on the very first ask. */
  current: PlanningPace | null;
  /** The pace being saved right now, which shows a spinner on its card. */
  saving: PlanningPace | null;
  /** Inside the checklist (changing an answer) rather than in its place. */
  compact?: boolean;
  onPick: (pace: PlanningPace) => void;
}) {
  const { t, locale } = useT();
  const months = new Intl.NumberFormat(intlLocale(locale), {
    style: "unit",
    unit: "month",
    unitDisplay: "long",
  });
  const recommended = recommendedPlanningPace(weddingDate, todayIso());

  return (
    <section
      aria-labelledby="planning-pace-question"
      className={
        compact
          ? "mt-3 rounded-lg border border-ink-900/15 bg-paper-50 p-4 sm:p-5 dark:border-paper-50/15 dark:bg-umber-800"
          : "mx-auto max-w-3xl py-10 sm:py-14"
      }
    >
      <h3
        id="planning-pace-question"
        className={`font-grotesk font-semibold tracking-[-0.02em] text-ink-900 dark:text-paper-50 ${compact ? "text-lg" : "text-center text-2xl sm:text-3xl"}`}
      >
        {t("planning.checklist.pace_question")}
      </h3>
      <p
        className={`mt-1.5 text-sm text-ink-600 dark:text-umber-200 ${compact ? "" : "text-center"}`}
      >
        {t("planning.checklist.pace_intro")}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="planning-pace-question"
        className={`grid gap-3 sm:grid-cols-3 ${compact ? "mt-4" : "mt-8"}`}
      >
        {PLANNING_PACES.map((pace) => {
          const Icon = PACE_ICON[pace];
          const selected = current === pace;
          const busy = saving === pace;
          return (
            <button
              key={pace}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving !== null}
              onClick={() => onPick(pace)}
              data-pace={pace}
              className={`group relative flex flex-col rounded-xl border bg-paper-50 p-2 text-left text-ink-900 transition-[border-color,box-shadow] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 disabled:cursor-wait dark:bg-umber-800 dark:text-paper-50 dark:focus-visible:ring-paper-50 dark:focus-visible:ring-offset-umber-900 ${
                selected
                  ? "border-ink-900 shadow-[inset_0_0_0_1px] shadow-ink-900 dark:border-paper-50 dark:shadow-paper-50"
                  : "border-ink-900/10 hover:border-ink-900/30 dark:border-paper-50/10 dark:hover:border-paper-50/30"
              }`}
            >
              <span className="relative flex h-28 flex-col justify-between rounded-lg bg-paper-100 p-3.5 dark:bg-umber-900/60">
                {busy ? (
                  <Loader2
                    size={30}
                    strokeWidth={1.5}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Icon
                    size={30}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="transition-transform duration-200 group-hover:-translate-y-0.5"
                  />
                )}
                <RunwayStrip months={PACE_HORIZON_MONTHS[pace]} selected={selected} />
                {selected ? (
                  <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-umber-900">
                    <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                  </span>
                ) : (
                  recommended === pace && (
                    <span className="absolute right-2.5 top-2.5 rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-800 dark:bg-sage-800/50 dark:text-sage-100">
                      {t("planning.checklist.pace_recommended")}
                    </span>
                  )
                )}
              </span>
              <span className="px-2 pb-2 pt-3">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-grotesk text-base font-semibold">
                    {t(`planning.checklist.pace_${pace}`)}
                  </span>
                  <span className="shrink-0 font-grotesk text-sm font-semibold tabular-nums">
                    {months.format(PACE_HORIZON_MONTHS[pace])}
                  </span>
                </span>
                <span className="mt-1 block text-sm leading-5 text-ink-600 dark:text-umber-200">
                  {t(`planning.checklist.pace_${pace}_body`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
