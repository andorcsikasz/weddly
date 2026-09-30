// "How far ahead are you planning?" The first thing the checklist asks, and
// the same three cards when the couple later changes their mind. The answer
// re-times the whole catalog (see `PlanningPace` in shared/wedding_checklist).
import {
  PLANNING_PACES,
  type PlanningPace,
  recommendedPlanningPace,
} from "@shared/wedding_checklist";
import { Bird, Coffee, Loader2, type LucideIcon, Zap } from "lucide-react";
import { todayIso } from "../lib/format";
import { useT } from "../lib/i18n";

export const PACE_ICON: Record<PlanningPace, LucideIcon> = {
  early_bird: Bird,
  relaxed: Coffee,
  last_minute: Zap,
};

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
  const { t } = useT();
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
              className={`group relative flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 disabled:cursor-wait sm:p-5 dark:focus-visible:ring-paper-50 dark:focus-visible:ring-offset-umber-900 ${
                selected
                  ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
                  : "border-ink-900/15 bg-paper-50 text-ink-900 hover:border-ink-900/40 dark:border-paper-50/15 dark:bg-umber-800 dark:text-paper-50 dark:hover:border-paper-50/40"
              }`}
            >
              {recommended === pace && !selected && (
                <span className="absolute right-3 top-3 rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-800 dark:bg-sage-800/50 dark:text-sage-100">
                  {t("planning.checklist.pace_recommended")}
                </span>
              )}
              {busy ? (
                <Loader2 size={28} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
              ) : (
                <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
              )}
              <span>
                <span className="block font-grotesk text-base font-semibold">
                  {t(`planning.checklist.pace_${pace}`)}
                </span>
                <span
                  className={`mt-1 block text-sm leading-5 ${selected ? "text-paper-50/75 dark:text-umber-700" : "text-ink-600 dark:text-umber-200"}`}
                >
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
