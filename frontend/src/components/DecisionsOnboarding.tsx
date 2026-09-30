// First visit to /app/decisions: the "Start here" questions one at a time, as
// big yes / no cards, then the size of what is ahead ("7 topics, 64 questions
// to consider") before the full deck opens. Same answers, same endpoint as the
// personalization grid on the page; this is only a calmer way in, shown to a
// couple who has answered nothing yet.
import {
  type ConditionTag,
  INTAKE_DIMENSIONS,
  PROMPT_GROUPS,
  type PromptContext,
  visiblePromptsForGroup,
} from "@shared/planning_prompts";
import { ArrowLeft, Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanningPromptTags } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export function DecisionsOnboarding({
  tags,
  questionCount,
  onAnswer,
  onDone,
}: {
  tags: PlanningPromptTags;
  /** Open decisions for the answers so far (`computeIntakeTotal`). */
  questionCount: number;
  onAnswer: (tag: ConditionTag, value: "yes" | "no") => void;
  /** Finished or skipped: either way the couple lands on the deck. */
  onDone: () => void;
}) {
  const { t, locale } = useT();
  const total = INTAKE_DIMENSIONS.length;
  const [step, setStep] = useState(0);
  const dim = INTAKE_DIMENSIONS[step];
  const onSummary = step >= total;

  const topicCount = useMemo(() => {
    const ctx: PromptContext = {
      ceremonyKind: null,
      hasChildren: tags.has_children === "yes",
      guestCount: null,
      manual: tags,
    };
    return PROMPT_GROUPS.filter((group) => visiblePromptsForGroup(group.key, ctx).length > 0)
      .length;
  }, [tags]);

  // True during the short beat between an answer and the next question: a
  // second tap or key in that window would otherwise answer the SAME question
  // again and shift every answer after it by one.
  const advancing = useRef(false);
  function answer(value: "yes" | "no") {
    if (!dim || advancing.current) return;
    advancing.current = true;
    if (tags[dim.tag] !== value) onAnswer(dim.tag, value);
    // A beat on the chosen card before the next question slides in.
    window.setTimeout(() => {
      advancing.current = false;
      setStep((s) => s + 1);
    }, 160);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      if (onSummary) {
        if (e.key === "Enter") onDone();
        return;
      }
      if (e.key === "y" || e.key === "Y") answer("yes");
      else if (e.key === "n" || e.key === "N") answer("no");
      else if (e.key === "ArrowLeft" && step > 0) setStep((s) => s - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (onSummary) {
    return (
      <section
        aria-live="polite"
        className="mx-auto flex max-w-2xl flex-col items-center py-12 text-center sm:py-16"
        data-decisions-onboarding="summary"
      >
        <p className="font-grotesk text-xs font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
          {t("planning.decisions.onb_summary_eyebrow")}
        </p>
        <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
          <SummaryTile
            value={topicCount}
            label={t("planning.decisions.onb_topics", { count: topicCount }).replace(
              String(topicCount),
              "",
            )}
          />
          <SummaryTile
            value={questionCount}
            label={t("planning.decisions.onb_questions", { count: questionCount }).replace(
              String(questionCount),
              "",
            )}
          />
        </div>
        <p className="mt-5 text-sm text-ink-600 dark:text-umber-200">
          {t("planning.decisions.onb_summary_body")}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-8 inline-flex h-12 items-center rounded-full bg-ink-900 px-8 font-grotesk text-sm font-semibold text-paper-50 transition-colors hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 dark:bg-paper-50 dark:text-umber-900 dark:hover:bg-paper-100"
        >
          {t("planning.decisions.onb_start")}
        </button>
      </section>
    );
  }
  if (!dim) return null;

  const question = locale === "hu" ? dim.question.hu : dim.question.en;
  const current = tags[dim.tag];

  return (
    <section
      aria-labelledby="decisions-onboarding-question"
      className="mx-auto max-w-2xl py-8 sm:py-12"
      data-decisions-onboarding="question"
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          aria-label={t("common.back")}
          className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-ink-900/5 disabled:invisible dark:text-paper-50 dark:hover:bg-paper-50/10"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <span className="font-grotesk text-xs font-semibold tabular-nums text-ink-500 dark:text-umber-300">
          {t("planning.decisions.onb_step", { n: String(step + 1), total: String(total) })}
        </span>
        <button
          type="button"
          onClick={onDone}
          className="text-xs font-semibold text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline dark:text-umber-300 dark:hover:text-paper-50"
        >
          {t("planning.decisions.onb_skip_all")}
        </button>
      </div>
      <div className="mt-3 flex gap-1" aria-hidden="true">
        {INTAKE_DIMENSIONS.map((d, i) => (
          <span
            key={d.tag}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i <= step ? "bg-ink-900 dark:bg-paper-50" : "bg-ink-900/10 dark:bg-paper-50/15"
            }`}
          />
        ))}
      </div>

      <h2
        key={dim.tag}
        id="decisions-onboarding-question"
        className="mt-10 animate-fade-in text-balance text-center font-grotesk text-2xl font-semibold tracking-[-0.02em] text-ink-900 sm:mt-14 sm:text-3xl dark:text-paper-50"
      >
        {question}
      </h2>

      <div
        role="radiogroup"
        aria-labelledby="decisions-onboarding-question"
        className="mt-8 grid grid-cols-2 gap-3"
      >
        {(
          [
            ["yes", Check, t("common.yes")],
            ["no", X, t("common.no")],
          ] as const
        ).map(([value, Icon, label]) => {
          const selected = current === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => answer(value)}
              className={`group flex flex-col items-center gap-3 rounded-xl border bg-paper-50 px-4 py-6 text-ink-900 transition-[border-color,box-shadow] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 sm:py-8 dark:bg-umber-800 dark:text-paper-50 dark:focus-visible:ring-paper-50 dark:focus-visible:ring-offset-umber-900 ${
                selected
                  ? "border-ink-900 shadow-[inset_0_0_0_1px] shadow-ink-900 dark:border-paper-50 dark:shadow-paper-50"
                  : "border-ink-900/10 hover:border-ink-900/30 dark:border-paper-50/10 dark:hover:border-paper-50/30"
              }`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-100 transition-transform duration-200 group-hover:-translate-y-0.5 dark:bg-umber-900/60">
                <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="font-grotesk text-base font-semibold">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => setStep((s) => s + 1)}
          className="text-xs font-semibold text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline dark:text-umber-300 dark:hover:text-paper-50"
        >
          {t("planning.decisions.onb_skip")}
        </button>
      </div>
    </section>
  );
}

function SummaryTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-ink-900/10 bg-paper-50 p-2 text-left dark:border-paper-50/10 dark:bg-umber-800">
      <div className="rounded-lg bg-paper-100 px-4 py-5 dark:bg-umber-900/60">
        <span className="font-grotesk text-5xl font-semibold tabular-nums tracking-[-0.03em] text-ink-900 dark:text-paper-50">
          {value}
        </span>
      </div>
      <p className="px-2 pb-2 pt-3 font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
        {label.trim()}
      </p>
    </div>
  );
}
