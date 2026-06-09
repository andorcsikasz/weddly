// The "Döntések" tab on /app/planning: the long-tail decision layer that sits
// below the dated timeline. Browsable, theme-grouped prompts (the venue's
// default coffee, who carries the rings, the rain plan...) that the couple
// resolves, dismisses, or promotes into a real dated task. Prompts are
// kind='task' planning_items rows carrying a `seed_key`; this panel lazily
// materialises a group's prompts on first open and never floods the couple with
// all ~130 at once. Seed metadata (kind, hint, supplier anchor) is read from the
// shared master by seed_key — only seed_key / decision_status / resolution live
// on the row.

import {
  type ConditionTag,
  INTAKE_DIMENSIONS,
  type LocaleText,
  PROMPT_GROUPS,
  type PromptContext,
  type PromptGroup,
  PROMPTS_BY_KEY,
  type PromptSeed,
  visiblePromptsForGroup,
} from "@shared/planning_prompts";
import type { PlanningItem } from "@shared/types";
import { Check, ChevronDown, HelpCircle, Lightbulb, ListChecks, Store, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Skeleton, useToast } from "../components/ui";
import { type PlanningPromptTags, planningApi } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";

function loc(text: LocaleText, locale: Locale): string {
  return locale === "hu" ? text.hu : text.en;
}

interface DecisionsPanelProps {
  items: PlanningItem[];
  loading: boolean;
  locale: Locale;
  onItemsChange: (items: PlanningItem[]) => void;
}

export function DecisionsPanel({ items, loading, locale, onItemsChange }: DecisionsPanelProps) {
  const { t } = useT();
  const toast = useToast();

  const [tags, setTags] = useState<PlanningPromptTags>({});
  const [expanded, setExpanded] = useState<Set<PromptGroup>>(new Set());
  const [generating, setGenerating] = useState<Set<PromptGroup>>(new Set());
  const [generated, setGenerated] = useState<Set<PromptGroup>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Load the saved intake answers once.
  useEffect(() => {
    let alive = true;
    void planningApi
      .getPromptProfile()
      .then((res) => {
        if (alive) setTags(res.tags ?? {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Prompt rows (seed_key set), grouped by their seed's theme group.
  const promptsByGroup = useMemo(() => {
    const map = new Map<PromptGroup, PlanningItem[]>();
    for (const it of items) {
      if (!it.seed_key) continue;
      const seed = PROMPTS_BY_KEY.get(it.seed_key);
      if (!seed) continue;
      const list = map.get(seed.group) ?? [];
      list.push(it);
      map.set(seed.group, list);
    }
    return map;
  }, [items]);

  // Any group with materialised rows counts as already generated, so re-opening
  // it doesn't trigger another generate round-trip.
  useEffect(() => {
    setGenerated((prev) => {
      const next = new Set(prev);
      for (const g of promptsByGroup.keys()) next.add(g);
      return next;
    });
  }, [promptsByGroup]);

  // Approximate per-group "to consider" count for the collapsed header, derived
  // from the intake answers alone (the precise ceremony/guest context is applied
  // server-side at generation).
  const previewContext: PromptContext = useMemo(
    () => ({
      ceremonyKind: null,
      hasChildren: tags.has_children === "yes",
      guestCount: null,
      manual: tags,
    }),
    [tags],
  );

  async function toggleGroup(group: PromptGroup) {
    const isOpen = expanded.has(group);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(group);
      else next.add(group);
      return next;
    });
    if (isOpen || generated.has(group) || generating.has(group)) return;
    setGenerating((prev) => new Set(prev).add(group));
    try {
      const res = await planningApi.generatePrompts(group);
      onItemsChange(res.items);
      setGenerated((prev) => new Set(prev).add(group));
    } catch {
      toast.error(t("planning.decisions.generate_error"));
      // Collapse again so the user can retry.
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(group);
        return next;
      });
    } finally {
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(group);
        return next;
      });
    }
  }

  async function patchItem(item: PlanningItem, patch: Parameters<typeof planningApi.update>[1]) {
    setBusyId(item.id);
    try {
      const res = await planningApi.update(item.id, patch);
      onItemsChange(items.map((i) => (i.id === item.id ? res.item : i)));
      return true;
    } catch {
      toast.error(t("planning.decisions.save_error"));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function setTag(tag: ConditionTag, value: "yes" | "no") {
    const current = tags[tag];
    const next: PlanningPromptTags = { ...tags };
    if (current === value) delete next[tag];
    else next[tag] = value;
    setTags(next);
    try {
      await planningApi.savePromptProfile(next);
    } catch {
      toast.error(t("planning.decisions.save_error"));
    }
  }

  return (
    <div className="mt-4">
      {/* Intake strip — non-blocking, persists answers that tune which
       *  conditional prompts surface. */}
      <section className="mb-5 rounded-2xl border border-ink-900 bg-paper-100/40 p-4 dark:border-umber-700 dark:bg-umber-800/40">
        <h2 className="mb-3 font-grotesk text-xs font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
          {t("planning.decisions.intake_title")}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {INTAKE_DIMENSIONS.map((dim) => (
            <li
              key={dim.tag}
              className="flex items-center justify-between gap-3 rounded-xl bg-paper-50 px-3 py-2 dark:bg-umber-900/50"
            >
              <span className="text-sm text-ink-700 dark:text-umber-100">
                {loc(dim.question, locale)}
              </span>
              <div className="flex shrink-0 gap-1">
                <IntakeToggle
                  active={tags[dim.tag] === "yes"}
                  label={t("common.yes")}
                  icon={Check}
                  onClick={() => setTag(dim.tag, "yes")}
                />
                <IntakeToggle
                  active={tags[dim.tag] === "no"}
                  label={t("common.no")}
                  icon={X}
                  onClick={() => setTag(dim.tag, "no")}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {PROMPT_GROUPS.map((group) => {
            const rows = (promptsByGroup.get(group.key) ?? []).filter(
              (r) => r.decision_status !== "promoted",
            );
            const openCount = rows.filter((r) => r.decision_status === "open").length;
            const isExpanded = expanded.has(group.key);
            const isGenerating = generating.has(group.key);
            // Before first open, estimate how many prompts the group holds.
            const previewCount = generated.has(group.key)
              ? rows.length
              : visiblePromptsForGroup(group.key, previewContext).length;
            return (
              <section
                key={group.key}
                className="overflow-hidden rounded-2xl border border-paper-300 dark:border-umber-700"
              >
                <button
                  type="button"
                  onClick={() => void toggleGroup(group.key)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center gap-3 bg-paper-100/50 px-4 py-3 text-left transition-colors hover:bg-paper-200/60 dark:bg-umber-800/50 dark:hover:bg-umber-700/60"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-grotesk text-sm font-semibold text-ink-800 dark:text-paper-50">
                      {loc(group.title, locale)}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-umber-300">
                      {loc(group.blurb, locale)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-paper-200 px-2.5 py-1 text-[11px] font-medium text-ink-600 dark:bg-umber-700 dark:text-umber-100">
                    {generated.has(group.key)
                      ? t("planning.decisions.open_count", { n: String(openCount) })
                      : t("planning.decisions.consider_count", { n: String(previewCount) })}
                  </span>
                  <ChevronDown
                    size={18}
                    aria-hidden="true"
                    className={`shrink-0 text-ink-400 transition-transform dark:text-umber-300 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isExpanded && (
                  <div className="border-t border-paper-300 px-4 py-3 dark:border-umber-700">
                    {isGenerating ? (
                      <div className="space-y-2">
                        {[0, 1].map((i) => (
                          <Skeleton key={i} className="h-12 w-full rounded-xl" />
                        ))}
                      </div>
                    ) : (
                      <DecisionGroupBody
                        rows={rows}
                        locale={locale}
                        showDismissed={showDismissed}
                        onToggleDismissed={() => setShowDismissed((v) => !v)}
                        busyId={busyId}
                        onResolve={(item, text) =>
                          patchItem(item, { decision_status: "decided", resolution: text || null })
                        }
                        onDismiss={(item) => patchItem(item, { decision_status: "not_relevant" })}
                        onReopen={(item) =>
                          patchItem(item, { decision_status: "open", resolution: null })
                        }
                        onPromote={async (item) => {
                          const ok = await patchItem(item, { decision_status: "promoted" });
                          if (ok) toast.success(t("planning.decisions.promoted_toast"));
                        }}
                      />
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IntakeToggle({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof Check;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
        active
          ? "bg-ink-800 text-paper-100 dark:bg-paper-50 dark:text-umber-900"
          : "bg-paper-200 text-ink-500 hover:bg-paper-300 dark:bg-umber-700 dark:text-umber-200 dark:hover:bg-umber-600"
      }`}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

function DecisionGroupBody({
  rows,
  locale,
  showDismissed,
  onToggleDismissed,
  busyId,
  onResolve,
  onDismiss,
  onReopen,
  onPromote,
}: {
  rows: PlanningItem[];
  locale: Locale;
  showDismissed: boolean;
  onToggleDismissed: () => void;
  busyId: number | null;
  onResolve: (item: PlanningItem, text: string) => void;
  onDismiss: (item: PlanningItem) => void;
  onReopen: (item: PlanningItem) => void;
  onPromote: (item: PlanningItem) => void;
}) {
  const { t } = useT();
  const visible = rows.filter((r) => r.decision_status !== "not_relevant");
  const dismissed = rows.filter((r) => r.decision_status === "not_relevant");

  if (rows.length === 0) {
    return (
      <p className="py-2 text-sm text-ink-500 dark:text-umber-300">
        {t("planning.decisions.group_empty")}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {visible.map((item) => (
        <DecisionCard
          key={item.id}
          item={item}
          locale={locale}
          busy={busyId === item.id}
          onResolve={onResolve}
          onDismiss={onDismiss}
          onReopen={onReopen}
          onPromote={onPromote}
        />
      ))}
      {dismissed.length > 0 && (
        <li>
          <button
            type="button"
            onClick={onToggleDismissed}
            className="mt-1 text-xs text-ink-400 underline-offset-2 hover:underline dark:text-umber-300"
          >
            {showDismissed
              ? t("planning.decisions.hide_dismissed")
              : t("planning.decisions.show_dismissed", { n: String(dismissed.length) })}
          </button>
        </li>
      )}
      {showDismissed &&
        dismissed.map((item) => (
          <DecisionCard
            key={item.id}
            item={item}
            locale={locale}
            busy={busyId === item.id}
            onResolve={onResolve}
            onDismiss={onDismiss}
            onReopen={onReopen}
            onPromote={onPromote}
          />
        ))}
    </ul>
  );
}

const KIND_META = {
  decision: { icon: Lightbulb, labelKey: "planning.decisions.kind_decision" },
  check: { icon: Store, labelKey: "planning.decisions.kind_check" },
  todo: { icon: ListChecks, labelKey: "planning.decisions.kind_todo" },
} as const;

function DecisionCard({
  item,
  locale,
  busy,
  onResolve,
  onDismiss,
  onReopen,
  onPromote,
}: {
  item: PlanningItem;
  locale: Locale;
  busy: boolean;
  onResolve: (item: PlanningItem, text: string) => void;
  onDismiss: (item: PlanningItem) => void;
  onReopen: (item: PlanningItem) => void;
  onPromote: (item: PlanningItem) => void;
}) {
  const { t } = useT();
  const seed: PromptSeed | undefined = item.seed_key
    ? PROMPTS_BY_KEY.get(item.seed_key)
    : undefined;
  const title = seed ? loc(seed.title, locale) : item.title;
  const hint = seed?.hint ? loc(seed.hint, locale) : null;
  const kind = seed?.prompt_kind ?? "decision";
  const meta = KIND_META[kind];
  const KindIcon = meta.icon;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.resolution ?? "");
  const decided = item.decision_status === "decided";
  const dismissedRow = item.decision_status === "not_relevant";

  return (
    <li
      className={`rounded-xl border px-3 py-2.5 ${
        dismissedRow
          ? "border-paper-200 bg-paper-100/30 opacity-60 dark:border-umber-800 dark:bg-umber-900/30"
          : "border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-900/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 shrink-0 text-ink-400 dark:text-umber-300"
          title={t(meta.labelKey)}
          aria-hidden="true"
        >
          {decided ? (
            <Check size={16} className="text-sage-600 dark:text-sage-300" />
          ) : (
            <KindIcon size={16} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-800 dark:text-paper-50">{title}</p>
          {hint && !decided && (
            <p className="mt-0.5 text-xs text-ink-500 dark:text-umber-300">{hint}</p>
          )}
          {decided && item.resolution && (
            <p className="mt-1 text-xs text-ink-600 dark:text-umber-200">
              <span className="font-medium text-sage-700 dark:text-sage-300">
                {t("planning.decisions.decided_label")}
              </span>{" "}
              {item.resolution}
            </p>
          )}

          {seed?.prompt_target === "supplier" && !decided && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-oat-100 px-2 py-0.5 text-[11px] text-umber-700 dark:bg-umber-700 dark:text-umber-100">
              <HelpCircle size={11} aria-hidden="true" />
              {t("planning.decisions.ask_supplier")}
            </span>
          )}

          {/* Inline resolution editor for decision/check prompts. */}
          {editing && (
            <div className="mt-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                autoFocus
                placeholder={t("planning.decisions.resolution_placeholder")}
                className="w-full rounded-lg border border-paper-300 bg-paper-50 px-2.5 py-1.5 text-sm text-ink-800 focus:border-ink-400 focus:outline-none dark:border-umber-600 dark:bg-umber-900 dark:text-paper-50"
              />
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onResolve(item, draft.trim());
                    setEditing(false);
                  }}
                  className="btn-primary btn-sm"
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(item.resolution ?? "");
                    setEditing(false);
                  }}
                  className="btn-ghost btn-sm"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}

          {/* Action row. */}
          {!editing && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {item.decision_status === "open" &&
                (kind === "todo" ? (
                  <ActionButton
                    onClick={() => onResolve(item, "")}
                    disabled={busy}
                    label={t("planning.decisions.action_done")}
                  />
                ) : (
                  <ActionButton
                    onClick={() => {
                      setDraft(item.resolution ?? "");
                      setEditing(true);
                    }}
                    disabled={busy}
                    label={
                      kind === "check"
                        ? t("planning.decisions.action_record_answer")
                        : t("planning.decisions.action_decide")
                    }
                  />
                ))}
              {decided && (
                <>
                  <ActionButton
                    onClick={() => {
                      setDraft(item.resolution ?? "");
                      setEditing(true);
                    }}
                    disabled={busy}
                    label={t("planning.decisions.action_edit")}
                  />
                  <ActionButton
                    onClick={() => onReopen(item)}
                    disabled={busy}
                    label={t("planning.decisions.action_reopen")}
                    muted
                  />
                </>
              )}
              {dismissedRow && (
                <ActionButton
                  onClick={() => onReopen(item)}
                  disabled={busy}
                  label={t("planning.decisions.action_restore")}
                />
              )}
            </div>
          )}
        </div>
        {item.decision_status === "open" && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            <IconAction
              onClick={() => onPromote(item)}
              disabled={busy}
              label={t("planning.decisions.action_promote")}
              icon={ListChecks}
            />
            <IconAction
              onClick={() => onDismiss(item)}
              disabled={busy}
              label={t("planning.decisions.action_not_relevant")}
              icon={X}
              muted
            />
          </div>
        )}
      </div>
    </li>
  );
}

function ActionButton({
  onClick,
  disabled,
  label,
  muted,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline disabled:opacity-50 ${
        muted ? "text-ink-400 dark:text-umber-300" : "text-ink-700 dark:text-paper-100"
      }`}
    >
      {label}
    </button>
  );
}

// Icon-only action sitting at the card's right edge (promote to task, dismiss).
// Label is exposed via aria-label/title so the meaning survives without text.
function IconAction({
  onClick,
  disabled,
  label,
  icon: Icon,
  muted,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon: typeof X;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
        muted
          ? "text-ink-400 hover:bg-paper-200 hover:text-ink-600 dark:text-umber-300 dark:hover:bg-umber-700"
          : "text-ink-600 hover:bg-paper-200 hover:text-ink-800 dark:text-umber-200 dark:hover:bg-umber-700"
      }`}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}
