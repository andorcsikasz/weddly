// Dashboard "your upcoming tasks" card. Sits directly below the setup checklist
// and hands the baton from the finite onboarding ritual to the couple's living
// plan. Self-fetches the planning items and surfaces the next dated, undone
// wedding tasks — rendered like the onboarding checklist (checkmark + label) but
// with real due chips, assignees, and an inline toggle that actually ticks them
// off. The "is anything overdue" classification reuses the shared `timelineStatus`
// classifier, so this never drifts from the timeline page, the bell, or the
// email nudge — there is one brain, this is just another view of it.

import type { PlanningItem } from "@shared/types";
import { ArrowRight, ExternalLink, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api";
import { planningApi } from "../lib/endpoints";
import { todayIso } from "../lib/format";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";

const SETTINGS_KEY = "weddly.upcoming-settings";

type UpcomingTopic = "wedding" | "honeymoon" | "all";
type UpcomingCount = 3 | 5 | 10;

interface UpcomingSettings {
  topic: UpcomingTopic;
  count: UpcomingCount;
}

function loadSettings(): UpcomingSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UpcomingSettings>;
      return {
        topic: (["wedding", "honeymoon", "all"] as UpcomingTopic[]).includes(
          parsed.topic as UpcomingTopic,
        )
          ? (parsed.topic as UpcomingTopic)
          : "wedding",
        count: ([3, 5, 10] as UpcomingCount[]).includes(parsed.count as UpcomingCount)
          ? (parsed.count as UpcomingCount)
          : 5,
      };
    }
  } catch {
    // ignore
  }
  return { topic: "wedding", count: 5 };
}

function saveSettings(s: UpcomingSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const MS_PER_DAY = 86_400_000;

/** The upcoming list is a short scroll window, not a growing column: the card sits
 *  above the fold and must keep its height no matter how many tasks are dated. It
 *  glides back to the top after this much idle time so the panel always returns to
 *  the highest-priority rows instead of getting parked deep in the list. */
const IDLE_SCROLL_RESET_MS = 4000;

/** How many dated tasks the scroll window holds. The `count` setting sizes the
 *  visible window; this is how deep you can reach by scrolling before the card
 *  hands you off to /app/planning. */
const UPCOMING_POOL = 25;

/** One row (text-sm line + py-1) plus the flex gap, in px. */
const ROW_H = 32;
/** Extra sliver of the next row left visible, so the window reads as scrollable. */
const ROW_PEEK = 14;

/** Whole days from today to an ISO due date (negative = overdue). Both sides are
 *  parsed at UTC midnight so DST and local offset never shift the count. */
function daysUntil(dueIso: string, today: string): number {
  const due = Date.parse(`${dueIso}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return 0;
  return Math.round((due - now) / MS_PER_DAY);
}

/** A seeded decision-prompt (Döntések deck) the couple hasn't promoted into a
 *  real task. These are considerations, not scheduled work: Planning's Tasks
 *  tab deliberately hides them, so this card must too — otherwise the ~100
 *  seeded prompts flood it with due-date countdowns that don't exist in the
 *  task tracker. A promoted prompt (decision_status='promoted') is a genuine
 *  task and stays. */
function isUnpromotedSeededPrompt(it: PlanningItem): boolean {
  return Boolean(it.seed_key) && it.decision_status !== "promoted";
}

/** Dated, undone tasks filtered + sorted by settings, capped to the scroll pool.
 *  `settings.count` no longer truncates the data, it sizes the visible window. */
function selectUpcoming(items: PlanningItem[], settings: UpcomingSettings): PlanningItem[] {
  return items
    .filter((it) => {
      if (it.kind !== "task" || it.done || it.due_date === null) return false;
      if (it.decision_status === "not_relevant") return false;
      if (isUnpromotedSeededPrompt(it)) return false;
      if (settings.topic === "wedding") return it.topic !== "honeymoon";
      if (settings.topic === "honeymoon") return it.topic === "honeymoon";
      return true;
    })
    .sort((a, b) => {
      const byDate = (a.due_date as string).localeCompare(b.due_date as string);
      if (byDate !== 0) return byDate;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.id - b.id;
    })
    .slice(0, UPCOMING_POOL);
}

/** When nothing is dated yet, fall back to the most recently added undone tasks
 *  so the card never reads empty while open work exists. Rendered without due
 *  chips, under a soft "add due dates" hint. */
function selectFallback(
  items: PlanningItem[],
  settings: UpcomingSettings,
  max = 3,
): PlanningItem[] {
  return items
    .filter((it) => {
      if (it.kind !== "task" || it.done) return false;
      if (it.decision_status === "not_relevant") return false;
      if (isUnpromotedSeededPrompt(it)) return false;
      if (settings.topic === "wedding") return it.topic !== "honeymoon";
      if (settings.topic === "honeymoon") return it.topic === "honeymoon";
      return true;
    })
    .sort((a, b) => {
      if (b.created_at !== a.created_at) return b.created_at - a.created_at;
      return b.id - a.id;
    })
    .slice(0, max);
}

export function UpcomingTasksCard({
  weddingDate,
  nudges,
}: {
  weddingDate: string | null;
  nudges?: Array<{ label: string; to: string }>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [items, setItems] = useState<PlanningItem[] | null>(null);
  const [settings, setSettings] = useState<UpcomingSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    planningApi
      .list()
      .then((res) => {
        if (!cancelled) setItems(Array.isArray(res.items) ? res.items : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close settings panel when clicking outside.
  useEffect(() => {
    if (!settingsOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (
        settingsPanelRef.current &&
        !settingsPanelRef.current.contains(e.target as Node) &&
        !settingsBtnRef.current?.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [settingsOpen]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  /** Every scroll restarts the idle countdown; when it finally elapses the window
   *  glides back to the top rows. */
  function onListScroll() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (!listRef.current || listRef.current.scrollTop === 0) return;
    idleTimer.current = setTimeout(() => {
      listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, IDLE_SCROLL_RESET_MS);
  }

  function updateSettings(patch: Partial<UpcomingSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  }

  if (items === null) return null;

  const today = todayIso();
  const upcoming = selectUpcoming(items, settings);
  // Nothing dated yet but open work exists: show recent undone tasks instead of
  // an empty card, with a nudge to add due dates.
  const fallback = upcoming.length === 0 ? selectFallback(items, settings) : [];
  const showFallback = fallback.length > 0;
  const hasAnyTask = items.some((it) => it.kind === "task" && !isUnpromotedSeededPrompt(it));
  const totalUpcoming = items.filter(
    (it) =>
      it.kind === "task" &&
      !it.done &&
      it.due_date !== null &&
      it.decision_status !== "not_relevant" &&
      !isUnpromotedSeededPrompt(it) &&
      (settings.topic === "all"
        ? true
        : settings.topic === "honeymoon"
          ? it.topic === "honeymoon"
          : it.topic !== "honeymoon"),
  ).length;

  /** Optimistic done-toggle. The row no longer qualifies once done, so it drops
   *  out of `upcoming` on the next render. Revert + toast on failure. */
  async function toggleDone(item: PlanningItem) {
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === item.id ? { ...it, done: true } : it)) : prev,
    );
    try {
      await planningApi.update(item.id, { done: true });
    } catch (e) {
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === item.id ? { ...it, done: false } : it)) : prev,
      );
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  function dueChip(dueIso: string) {
    const d = daysUntil(dueIso, today);
    if (d < 0) {
      return {
        label: t("dashboard.upcoming_due_overdue", { n: -d }),
        tone: "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
      };
    }
    if (d === 0) {
      return {
        label: t("dashboard.upcoming_due_today"),
        tone: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
      };
    }
    return {
      label: t("dashboard.upcoming_due_in", { n: d }),
      tone: "bg-paper-200 text-umber-600 dark:bg-umber-700 dark:text-umber-200",
    };
  }

  const hasNudges = nudges && nudges.length > 0;
  const nudgeRowCls =
    "flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-umber-900 transition hover:bg-paper-100 dark:text-paper-50 dark:hover:bg-umber-700";

  function nudgeRow(nudge: { label: string; to: string }) {
    const inner = (
      <>
        <ArrowRight
          size={14}
          className="shrink-0 text-umber-400 dark:text-umber-500"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{nudge.label}</span>
        <span className="shrink-0 rounded-full bg-paper-200 px-2 py-0.5 text-[11px] font-medium text-umber-600 dark:bg-umber-700 dark:text-umber-300">
          {t("dashboard.upcoming_setup_badge")}
        </span>
      </>
    );
    return nudge.to.startsWith("#") ? (
      <a href={nudge.to} className={nudgeRowCls}>
        {inner}
      </a>
    ) : (
      <Link to={nudge.to} className={nudgeRowCls}>
        {inner}
      </Link>
    );
  }

  const TOPIC_OPTIONS: { value: UpcomingTopic; labelKey: string }[] = [
    { value: "wedding", labelKey: "dashboard.upcoming_settings_topic_wedding" },
    { value: "honeymoon", labelKey: "dashboard.upcoming_settings_topic_honeymoon" },
    { value: "all", labelKey: "dashboard.upcoming_settings_topic_all" },
  ];

  const COUNT_OPTIONS: UpcomingCount[] = [3, 5, 10];

  return (
    <section className="card mb-8 p-0 font-grotesk">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 md:px-6 md:py-4">
        <h2 className="min-w-0 flex-1 truncate font-grotesk text-base font-medium text-umber-900 md:text-lg md:font-semibold dark:text-paper-50">
          {t("dashboard.upcoming_title")}
        </h2>

        {upcoming.length > 0 && (
          <span className="shrink-0 text-xs text-umber-500 dark:text-umber-300">
            {t("dashboard.upcoming_count", { n: totalUpcoming })}
          </span>
        )}

        {/* Navigate to task management page */}
        <Link
          to="/app/planning"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-umber-400 transition hover:bg-paper-100 hover:text-umber-700 dark:text-umber-500 dark:hover:bg-umber-700 dark:hover:text-paper-100"
          title={t("dashboard.upcoming_view_all")}
        >
          <ExternalLink size={15} aria-hidden="true" />
        </Link>

        {/* Settings icon */}
        <div className="relative shrink-0">
          <button
            ref={settingsBtnRef}
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            className={`flex h-7 w-7 items-center justify-center rounded-md text-umber-400 transition hover:bg-paper-100 hover:text-umber-700 dark:text-umber-500 dark:hover:bg-umber-700 dark:hover:text-paper-100 ${settingsOpen ? "bg-paper-100 text-umber-700 dark:bg-umber-700 dark:text-paper-100" : ""}`}
            aria-label="Beállítások"
          >
            <Settings2 size={15} aria-hidden="true" />
          </button>

          {settingsOpen && (
            <div
              ref={settingsPanelRef}
              className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-paper-200 bg-white p-3 shadow-lg dark:border-umber-700 dark:bg-umber-900"
            >
              {/* Topic filter */}
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-umber-400 dark:text-umber-500">
                {t("dashboard.upcoming_settings_topic")}
              </p>
              <div className="mb-3 grid gap-0.5">
                {TOPIC_OPTIONS.map(({ value, labelKey }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateSettings({ topic: value })}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${settings.topic === value ? "bg-paper-100 font-medium text-umber-900 dark:bg-umber-700 dark:text-paper-50" : "text-umber-600 hover:bg-paper-50 dark:text-umber-300 dark:hover:bg-umber-800"}`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${settings.topic === value ? "border-blush-500 bg-blush-500" : "border-paper-400 dark:border-umber-600"}`}
                    >
                      {settings.topic === value && (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    {t(labelKey as Parameters<typeof t>[0])}
                  </button>
                ))}
              </div>

              {/* Count selector */}
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-umber-400 dark:text-umber-500">
                {t("dashboard.upcoming_settings_count")}
              </p>
              <div className="flex gap-1">
                {COUNT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => updateSettings({ count: n })}
                    className={`flex-1 rounded-lg py-1 text-sm font-medium transition ${settings.count === n ? "bg-blush-500 text-white" : "bg-paper-100 text-umber-600 hover:bg-paper-200 dark:bg-umber-700 dark:text-umber-300 dark:hover:bg-umber-600"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 md:px-6 md:pb-6">
        {upcoming.length === 0 && !showFallback && !hasNudges ? (
          hasAnyTask ? (
            <div className="py-2">
              <p className="text-sm text-umber-500 dark:text-umber-300">
                {t("dashboard.upcoming_empty_clear")}
              </p>
              {!weddingDate && (
                <p className="mt-1 text-sm font-medium text-umber-700 dark:text-umber-200">
                  {t("dashboard.upcoming_next_step_lock_date")}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-1">
              <p className="text-sm text-umber-600 dark:text-umber-200">
                {t("dashboard.upcoming_empty_none")}
              </p>
              <Link
                to="/app/planning"
                className="btn-outline btn-sm inline-flex shrink-0 items-center gap-1.5"
              >
                <span>{t("dashboard.upcoming_empty_none_cta")}</span>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          )
        ) : (
          <>
            {hasNudges && (
              <ul className="flex flex-col gap-1">
                {nudges.map((nudge) => (
                  <li key={nudge.label}>{nudgeRow(nudge)}</li>
                ))}
              </ul>
            )}
            {hasNudges && upcoming.length > 0 && (
              <hr className="my-2 border-paper-200 dark:border-umber-700" />
            )}
            {upcoming.length > 0 && (
              <>
                {/* Scroll window sized to the `count` setting, drifting back to the
                    top priorities after IDLE_SCROLL_RESET_MS of no scrolling. */}
                <div
                  ref={listRef}
                  onScroll={onListScroll}
                  style={{
                    maxHeight:
                      upcoming.length > settings.count
                        ? settings.count * ROW_H + ROW_PEEK
                        : undefined,
                  }}
                  className="overflow-y-auto overscroll-contain"
                >
                  <ul className="flex flex-col gap-1">
                    {upcoming.map((item) => {
                      const chip = dueChip(item.due_date as string);
                      return (
                        <li
                          key={item.id}
                          className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-umber-900 transition hover:bg-paper-100 dark:text-paper-50 dark:hover:bg-umber-700"
                        >
                          <button
                            type="button"
                            onClick={() => toggleDone(item)}
                            aria-label={t("common.done")}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-paper-400 bg-white transition hover:border-blush-500 dark:border-umber-600 dark:bg-umber-800"
                          />
                          <Link
                            to="/app/planning"
                            className="flex min-w-0 flex-1 items-center gap-2"
                          >
                            <span className="min-w-0 flex-1 truncate">{item.title}</span>
                            {item.priority === 2 && (
                              <span
                                className="shrink-0 font-bold text-blush-700 dark:text-blush-300"
                                aria-hidden="true"
                              >
                                !!
                              </span>
                            )}
                            {item.assignee && (
                              <span className="shrink-0 truncate text-xs text-umber-500 dark:text-umber-300">
                                {item.assignee}
                              </span>
                            )}
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.tone}`}
                            >
                              {chip.label}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <Link
                  to="/app/planning"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blush-700 hover:underline dark:text-blush-300"
                >
                  <span>{t("dashboard.upcoming_view_all")}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </>
            )}
            {showFallback && (
              <>
                {hasNudges && <hr className="my-2 border-paper-200 dark:border-umber-700" />}
                <p className="mb-1.5 text-xs text-umber-500 dark:text-umber-300">
                  {t("dashboard.upcoming_undated_hint")}
                </p>
                <ul className="flex flex-col gap-1">
                  {fallback.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-umber-900 transition hover:bg-paper-100 dark:text-paper-50 dark:hover:bg-umber-700"
                    >
                      <button
                        type="button"
                        onClick={() => toggleDone(item)}
                        aria-label={t("common.done")}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-paper-400 bg-white transition hover:border-blush-500 dark:border-umber-600 dark:bg-umber-800"
                      />
                      <Link to="/app/planning" className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {item.priority === 2 && (
                          <span
                            className="shrink-0 font-bold text-blush-700 dark:text-blush-300"
                            aria-hidden="true"
                          >
                            !!
                          </span>
                        )}
                        {item.assignee && (
                          <span className="shrink-0 truncate text-xs text-umber-500 dark:text-umber-300">
                            {item.assignee}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/app/planning"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blush-700 hover:underline dark:text-blush-300"
                >
                  <span>{t("dashboard.upcoming_view_all")}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
