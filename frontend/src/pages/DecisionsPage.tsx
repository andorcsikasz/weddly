// The long-tail "go deeper" layer, split out of /app/planning on 2026-08-14.
// Feladatok / Ötletek / Checklist are all "scan it, tick it, move on"; this
// asks the couple to sit with a question and produce a considered answer — a
// different mode that doesn't belong in the same tab bar. Reached from a
// promoted card on Planning (and the Ideas tab's recommender), never from the
// sidebar rail: it's opt-in, not a daily destination.
import { type ConditionTag, INTAKE_DIMENSIONS } from "@shared/planning_prompts";
import type { PlanningItem } from "@shared/types";
import { ChevronDown } from "lucide-react";
import { DecisionsOnboarding } from "../components/DecisionsOnboarding";
import { useEffect, useMemo, useRef, useState } from "react";
import { PlanningRouteLinks } from "../components/PlanningRouteLinks";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { type PlanningPromptTags, planningApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { computeIntakeTotal, DecisionsPanel } from "./DecisionsPanel";

/** localStorage key for the personalization strip collapse state ("1" =
 *  collapsed, "0" = open). Absent means "no explicit preference yet", so the
 *  strip auto-collapses the first time we see the couple has already
 *  answered something. Shared key name with the pre-split Planning tab so an
 *  existing couple's preference carries over. */
const INTAKE_COLLAPSE_KEY = "weddly.planning.intakeCollapsed";
function readIntakeCollapsePref(): boolean | null {
  try {
    const v = localStorage.getItem(INTAKE_COLLAPSE_KEY);
    if (v === "1") return false;
    if (v === "0") return true;
  } catch {
    // localStorage unavailable (private mode / SSR) - fall back to default.
  }
  return null;
}

/** Set once the couple has finished or skipped the one-question-at-a-time
 *  intro, so a couple who skipped every question is not walked through it on
 *  every visit. A couple with any answer on the server never sees it at all,
 *  which is what covers a new device. */
const ONBOARDED_KEY = "weddly.decisions.onboarded";
function readOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function DecisionsPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.decisions_title", "seo.decisions_description");
  const toast = useToast();
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void planningApi
      .list()
      .then((r) => {
        if (alive) setItems(r.items);
      })
      .catch((e) => {
        if (alive) toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [intakeTags, setIntakeTags] = useState<PlanningPromptTags>({});
  const [intakeOpen, setIntakeOpen] = useState<boolean>(() => readIntakeCollapsePref() ?? true);
  const intakeAutoSet = useRef(false);
  // null until the profile has loaded: deciding before it would flash the
  // intro at a couple who answered everything months ago.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void planningApi
      .getPromptProfile()
      .then((res) => {
        if (!alive) return;
        const tags = res.tags ?? {};
        setIntakeTags(tags);
        const anyAnswered = INTAKE_DIMENSIONS.some((d) => tags[d.tag] != null);
        setOnboarding(!anyAnswered && !readOnboarded());
        if (readIntakeCollapsePref() === null && !intakeAutoSet.current) {
          intakeAutoSet.current = true;
          const answered = INTAKE_DIMENSIONS.filter((d) => tags[d.tag] != null).length;
          setIntakeOpen(answered === 0);
        }
      })
      .catch(() => {
        if (alive) setOnboarding(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const intakeAnswered = useMemo(
    () => INTAKE_DIMENSIONS.filter((d) => intakeTags[d.tag] != null).length,
    [intakeTags],
  );
  function toggleIntake() {
    setIntakeOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(INTAKE_COLLAPSE_KEY, next ? "0" : "1");
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  }
  // The intro answers in quick succession and every save PUTs the whole map, so
  // the saves run one after another from the latest map: two in flight at once
  // could land out of order and drop the newest answer.
  const tagsRef = useRef<PlanningPromptTags>({});
  tagsRef.current = intakeTags;
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  function setTagExact(tag: ConditionTag, value: "yes" | "no") {
    const next: PlanningPromptTags = { ...tagsRef.current, [tag]: value };
    tagsRef.current = next;
    setIntakeTags(next);
    saveChain.current = saveChain.current
      .then(() => planningApi.savePromptProfile(tagsRef.current))
      .catch(() => toast.error(t("planning.decisions.save_error")));
  }
  function finishOnboarding() {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      // best-effort persistence only
    }
    // The grid already holds every answer; start the deck with it tucked away.
    setIntakeOpen(false);
    setOnboarding(false);
  }

  async function handleSetTag(tag: ConditionTag, value: "yes" | "no") {
    const next: PlanningPromptTags = { ...intakeTags };
    if (next[tag] === value) delete next[tag];
    else next[tag] = value;
    setIntakeTags(next);
    try {
      await planningApi.savePromptProfile(next);
    } catch {
      toast.error(t("planning.decisions.save_error"));
    }
  }

  if (onboarding === null && loading) {
    return <div className="min-h-[28rem]" aria-busy="true" />;
  }
  if (onboarding) {
    return (
      <DecisionsOnboarding
        tags={intakeTags}
        questionCount={computeIntakeTotal(items, intakeTags)}
        onAnswer={setTagExact}
        onDone={finishOnboarding}
      />
    );
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="sr-only font-grotesk text-3xl text-ink-900 sm:text-4xl dark:text-paper-50">
          {t("planning.tab_decisions")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600 dark:text-umber-200">
          {t("planning.tab_decisions_tip")}
        </p>
        <PlanningRouteLinks className="mt-3" />
      </header>

      <button
        type="button"
        onClick={toggleIntake}
        aria-expanded={intakeOpen}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-ink-900 bg-paper-100/40 px-4 py-2 text-left transition-colors hover:bg-paper-200/40 dark:border-umber-700 dark:bg-umber-800/40 dark:hover:bg-umber-700/40"
      >
        <span className="flex-1 truncate font-grotesk text-xs font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
          {t("planning.decisions.setup_label")}
        </span>
        <span className="shrink-0 rounded-full bg-paper-200 px-2.5 py-1 text-[11px] font-medium text-ink-600 dark:bg-umber-700 dark:text-umber-100">
          {t("planning.decisions.setup_answered", {
            n: String(intakeAnswered),
            total: String(INTAKE_DIMENSIONS.length),
          })}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-sage-600 dark:text-sage-300">
          {t(intakeOpen ? "planning.decisions.setup_done" : "planning.decisions.setup_continue")}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform ${intakeOpen ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      <DecisionsPanel
        items={items}
        loading={loading}
        locale={locale}
        onItemsChange={setItems}
        tags={intakeTags}
        onSetTag={handleSetTag}
        intakeOpen={intakeOpen}
      />
    </div>
  );
}
