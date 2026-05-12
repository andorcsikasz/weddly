// Free-form planning surface. Two tabs over the same backend table:
// Feladatok (tasks — checklist with optional due date, optional assignee) +
// Ötletek (notes — free text, auto-stamped with the partner who logged it).
// The wedding-day run-of-show lives on its own page at /app/schedule (richer
// model with duration, location, sort, PDF export). One quick-add row per tab;
// rows are inline-editable on click.

import type { PlanningItem, PlanningKind } from "@shared/types";
import {
  Calendar,
  CheckCircle2,
  Circle,
  Dices,
  Lightbulb,
  Plus,
  Trash2,
  User,
  Wand2,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Dialog, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { planningApi } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";
import {
  DICE_CREATIVE_IDEAS,
  IDEA_TEMPLATE,
  type LocaleText,
  TASK_TEMPLATE,
  localizeText,
  rollDice,
} from "../lib/planning_templates";
import { useDocumentMeta } from "../lib/seo";

type PlanningTabKind = Exclude<PlanningKind, "schedule">;

const TABS: { kind: PlanningTabKind; labelKey: string }[] = [
  { kind: "task", labelKey: "planning.tab_tasks" },
  { kind: "idea", labelKey: "planning.tab_ideas" },
];

export default function PlanningPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.planning_title", "seo.planning_description");
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKind, setActiveKind] = useState<PlanningTabKind>("task");
  // Per-kind wand modal flags. Task + idea each open their own previewer
  // (different field shapes). The wedding-day program template lives on
  // /app/schedule, so there's no schedule wand here.
  const [taskWandOpen, setTaskWandOpen] = useState(false);
  const [ideaWandOpen, setIdeaWandOpen] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);

  async function refresh() {
    try {
      const r = await planningApi.list();
      setItems(r.items);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  const scoped = useMemo(() => items.filter((i) => i.kind === activeKind), [items, activeKind]);

  async function onCreate(input: {
    title: string;
    body?: string | null;
    due_date?: string | null;
    assignee?: string | null;
  }) {
    try {
      const r = await planningApi.create({ kind: activeKind, ...input });
      setItems((prev) => [...prev, r.item]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  // Unique assignees across all existing tasks — feeds the QuickAddForm
  // datalist so the second + Nth tasks get the first one's owner as one click.
  const assigneeSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const i of items) {
      if (i.kind === "task" && i.assignee && !seen.has(i.assignee)) seen.add(i.assignee);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "hu"));
  }, [items]);

  async function onToggleDone(item: PlanningItem) {
    const nextDone = !item.done;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: nextDone } : i)));
    try {
      await planningApi.update(item.id, { done: nextDone });
    } catch (e) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onPatch(item: PlanningItem, patch: Partial<PlanningItem>) {
    const prev = item;
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    try {
      await planningApi.update(item.id, patch);
    } catch (e) {
      setItems((list) => list.map((i) => (i.id === item.id ? prev : i)));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onDelete(item: PlanningItem) {
    const ok = await confirm({
      title: t("planning.delete_confirm_title"),
      body: t("planning.delete_confirm_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await planningApi.remove(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  const hasTaskItems = useMemo(() => items.some((i) => i.kind === "task"), [items]);
  const hasIdeaItems = useMemo(() => items.some((i) => i.kind === "idea"), [items]);

  /** Generic bulk-creator: takes an array of CreateInputs, POSTs sequentially,
   *  pushes successes into state, surfaces the count via toast. Used by all
   *  three wand variants + the dice "add this one" CTA. */
  async function bulkCreate(
    entries: { title: string; body?: string | null; assignee?: string | null }[],
    kind: PlanningKind,
    successKey: string,
  ): Promise<number> {
    setBulkApplying(true);
    let added = 0;
    try {
      const created: PlanningItem[] = [];
      for (const entry of entries) {
        const r = await planningApi.create({ kind, ...entry });
        created.push(r.item);
        added += 1;
      }
      setItems((prev) => [...prev, ...created]);
      if (added > 0) toast.success(t(successKey, { count: added }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBulkApplying(false);
    }
    return added;
  }

  async function onApplyTaskTemplate(defaultAssignee: string) {
    const trimmed = defaultAssignee.trim();
    const entries = TASK_TEMPLATE.map((tmpl) => ({
      title: localizeText(tmpl.title, locale),
      assignee: trimmed || null,
    }));
    const added = await bulkCreate(entries, "task", "planning.template_tasks_done");
    if (added > 0) setTaskWandOpen(false);
  }

  async function onApplyIdeaTemplate() {
    const entries = IDEA_TEMPLATE.map((tmpl) => ({
      title: localizeText(tmpl.title, locale),
      body: tmpl.body ? localizeText(tmpl.body, locale) : null,
    }));
    const added = await bulkCreate(entries, "idea", "planning.template_ideas_done");
    if (added > 0) setIdeaWandOpen(false);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-3xl font-serif text-ink-900">{t("planning.title")}</h1>
          <p className="mt-2 text-sm text-ink-600">{t("planning.sub")}</p>
        </header>

        <nav
          role="tablist"
          aria-label={t("planning.tabs_aria")}
          className="mb-5 flex gap-1 rounded-2xl border border-paper-300 bg-paper-100/50 p-1"
        >
          {TABS.map((tab) => {
            const active = tab.kind === activeKind;
            const Icon = tab.kind === "task" ? CheckCircle2 : Lightbulb;
            return (
              <button
                key={tab.kind}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveKind(tab.kind)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-ink-800 text-paper-100 shadow-soft"
                    : "text-ink-600 hover:bg-paper-200"
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <div className="mb-3 flex flex-wrap justify-end gap-2">
          {activeKind === "task" && (
            <button
              type="button"
              onClick={() => setTaskWandOpen(true)}
              className="btn-ghost btn-sm inline-flex items-center gap-1.5"
              title={t("planning.task_template_button_hint")}
            >
              <Wand2 size={14} aria-hidden="true" />
              <span>{t("planning.task_template_button")}</span>
            </button>
          )}
          {activeKind === "idea" && (
            <>
              <button
                type="button"
                onClick={() => setIdeaWandOpen(true)}
                className="btn-ghost btn-sm inline-flex items-center gap-1.5"
                title={t("planning.idea_template_button_hint")}
              >
                <Wand2 size={14} aria-hidden="true" />
                <span>{t("planning.idea_template_button")}</span>
              </button>
              <button
                type="button"
                onClick={() => setDiceOpen(true)}
                className="btn-ghost btn-sm inline-flex items-center gap-1.5"
                title={t("planning.dice_button_hint")}
              >
                <Dices size={14} aria-hidden="true" />
                <span>{t("planning.dice_button")}</span>
              </button>
            </>
          )}
        </div>

        <QuickAddForm
          kind={activeKind}
          assigneeSuggestions={assigneeSuggestions}
          onCreate={onCreate}
        />

        {loading ? (
          <p className="mt-6 text-sm text-ink-500">{t("common.loading")}</p>
        ) : scoped.length === 0 ? (
          <EmptyState kind={activeKind} />
        ) : (
          <ul className="mt-4 space-y-2">
            {scoped.map((item) => (
              <PlanningRow
                key={item.id}
                item={item}
                onToggleDone={() => onToggleDone(item)}
                onPatch={(patch) => onPatch(item, patch)}
                onDelete={() => onDelete(item)}
              />
            ))}
          </ul>
        )}
      </div>

      {taskWandOpen && (
        <TaskTemplateDialog
          existing={hasTaskItems}
          applying={bulkApplying}
          assigneeSuggestions={assigneeSuggestions}
          locale={locale}
          onClose={() => setTaskWandOpen(false)}
          onApply={onApplyTaskTemplate}
        />
      )}

      {ideaWandOpen && (
        <IdeaTemplateDialog
          existing={hasIdeaItems}
          applying={bulkApplying}
          locale={locale}
          onClose={() => setIdeaWandOpen(false)}
          onApply={onApplyIdeaTemplate}
        />
      )}

      {diceOpen && (
        <DiceDialog
          applying={bulkApplying}
          locale={locale}
          onClose={() => setDiceOpen(false)}
          onAccept={async (idea) => {
            const added = await bulkCreate(
              [
                {
                  title: localizeText(idea.title, locale),
                  body: localizeText(idea.body, locale),
                },
              ],
              "idea",
              "planning.dice_added_one",
            );
            return added > 0;
          }}
        />
      )}
    </AppShell>
  );
}

function TaskTemplateDialog({
  existing,
  applying,
  assigneeSuggestions,
  locale,
  onClose,
  onApply,
}: {
  existing: boolean;
  applying: boolean;
  assigneeSuggestions: string[];
  locale: Locale;
  onClose: () => void;
  onApply: (defaultAssignee: string) => Promise<void>;
}) {
  const { t } = useT();
  const [defaultAssignee, setDefaultAssignee] = useState("");
  const datalistId = "task-wand-assignee-list";

  return (
    <Dialog
      open
      title={t("planning.task_template_dialog_title")}
      role="dialog"
      closeOnBackdrop
      onClose={() => {
        if (!applying) onClose();
      }}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onApply(defaultAssignee)}
            disabled={applying}
          >
            {applying ? t("common.loading") : t("planning.template_confirm")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-700">{t("planning.task_template_dialog_body")}</p>
        <label className="flex items-center gap-3 text-sm text-ink-700">
          <span className="font-medium">{t("planning.task_template_default_assignee_label")}</span>
          <input
            type="text"
            value={defaultAssignee}
            onChange={(e) => setDefaultAssignee(e.target.value)}
            list={assigneeSuggestions.length > 0 ? datalistId : undefined}
            placeholder={t("planning.task_template_default_assignee_placeholder")}
            maxLength={80}
            className="flex-1 rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 outline-none focus:border-ink-400"
          />
          {assigneeSuggestions.length > 0 && (
            <datalist id={datalistId}>
              {assigneeSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
        </label>
        {existing && (
          <p className="rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-xs text-ink-600">
            {t("planning.template_warning_existing")}
          </p>
        )}
        <div className="rounded-lg border border-paper-200 bg-paper-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
            {t("planning.template_preview_label")}
          </p>
          <ul className="space-y-1 text-xs text-ink-700">
            {TASK_TEMPLATE.map((tmpl) => (
              <li key={tmpl.title.en} className="flex items-center gap-2">
                <Circle size={12} className="shrink-0 text-ink-400" aria-hidden="true" />
                <span>{localizeText(tmpl.title, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

function IdeaTemplateDialog({
  existing,
  applying,
  locale,
  onClose,
  onApply,
}: {
  existing: boolean;
  applying: boolean;
  locale: Locale;
  onClose: () => void;
  onApply: () => Promise<void>;
}) {
  const { t } = useT();
  return (
    <Dialog
      open
      title={t("planning.idea_template_dialog_title")}
      role="dialog"
      closeOnBackdrop
      onClose={() => {
        if (!applying) onClose();
      }}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onApply()}
            disabled={applying}
          >
            {applying ? t("common.loading") : t("planning.template_confirm")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-700">{t("planning.idea_template_dialog_body")}</p>
        {existing && (
          <p className="rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-xs text-ink-600">
            {t("planning.template_warning_existing")}
          </p>
        )}
        <div className="rounded-lg border border-paper-200 bg-paper-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
            {t("planning.template_preview_label")}
          </p>
          <ul className="space-y-1 text-xs text-ink-700">
            {IDEA_TEMPLATE.map((tmpl) => (
              <li key={tmpl.title.en} className="flex items-center gap-2">
                <Lightbulb size={12} className="shrink-0 text-ink-400" aria-hidden="true" />
                <span>{localizeText(tmpl.title, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

function DiceDialog({
  applying,
  locale,
  onClose,
  onAccept,
}: {
  applying: boolean;
  locale: Locale;
  onClose: () => void;
  onAccept: (idea: { title: LocaleText; body: LocaleText }) => Promise<boolean>;
}) {
  const { t } = useT();
  const [picks, setPicks] = useState(() => rollDice(DICE_CREATIVE_IDEAS, 3));
  const [acceptedKeys, setAcceptedKeys] = useState<Set<string>>(new Set());

  return (
    <Dialog
      open
      title={t("planning.dice_dialog_title")}
      role="dialog"
      closeOnBackdrop
      size="lg"
      onClose={() => {
        if (!applying) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setPicks(rollDice(DICE_CREATIVE_IDEAS, 3));
              setAcceptedKeys(new Set());
            }}
            disabled={applying}
          >
            <Dices size={14} className="mr-1.5 inline" aria-hidden="true" />
            {t("planning.dice_reroll")}
          </button>
          <button type="button" className="btn-primary" onClick={onClose} disabled={applying}>
            {t("planning.dice_close")}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-ink-700">{t("planning.dice_dialog_body")}</p>
        <ul className="space-y-3">
          {picks.map((idea) => {
            const key = idea.title.en;
            const accepted = acceptedKeys.has(key);
            return (
              <li
                key={key}
                className="rounded-xl border border-paper-300 bg-paper-50 p-3 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Lightbulb
                    size={16}
                    className="mt-0.5 shrink-0 text-ink-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">
                      {localizeText(idea.title, locale)}
                    </p>
                    <p className="mt-1 text-xs text-ink-600">{localizeText(idea.body, locale)}</p>
                  </div>
                  <button
                    type="button"
                    className={
                      accepted
                        ? "btn-ghost btn-sm shrink-0 text-sage-700"
                        : "btn-primary btn-sm shrink-0"
                    }
                    disabled={accepted || applying}
                    onClick={async () => {
                      const ok = await onAccept(idea);
                      if (ok) setAcceptedKeys((prev) => new Set(prev).add(key));
                    }}
                  >
                    {accepted ? (
                      <>
                        <CheckCircle2 size={14} className="mr-1.5 inline" aria-hidden="true" />
                        {t("planning.dice_added")}
                      </>
                    ) : (
                      t("planning.dice_add")
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}

function QuickAddForm({
  kind,
  assigneeSuggestions,
  onCreate,
}: {
  kind: PlanningTabKind;
  assigneeSuggestions: string[];
  onCreate: (input: {
    title: string;
    body?: string | null;
    due_date?: string | null;
    assignee?: string | null;
  }) => Promise<void>;
}) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const assigneeListId = "planning-assignee-list";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await onCreate({
      title: trimmed,
      due_date: kind === "task" && dueDate ? dueDate : null,
      assignee: kind === "task" && assignee.trim() ? assignee.trim() : null,
    });
    setTitle("");
    setDueDate("");
    setAssignee("");
    inputRef.current?.focus();
  }

  const placeholder =
    kind === "task" ? t("planning.task_placeholder") : t("planning.idea_placeholder");

  return (
    <form onSubmit={onSubmit} className="card flex flex-wrap items-end gap-3 p-3">
      <div className="flex flex-1 min-w-[200px] items-center gap-2">
        <Plus size={16} className="text-ink-400" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-400"
          maxLength={200}
        />
      </div>
      {kind === "task" && (
        <>
          <input
            type="text"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            list={assigneeSuggestions.length > 0 ? assigneeListId : undefined}
            placeholder={t("planning.assignee_placeholder")}
            aria-label={t("planning.assignee_label")}
            className="w-32 rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400"
            maxLength={80}
          />
          {assigneeSuggestions.length > 0 && (
            <datalist id={assigneeListId}>
              {assigneeSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label={t("planning.due_date_label")}
            className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400"
          />
        </>
      )}
      <button
        type="submit"
        disabled={!title.trim()}
        className="btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("planning.add")}
      </button>
    </form>
  );
}

function PlanningRow({
  item,
  onToggleDone,
  onPatch,
  onDelete,
}: {
  item: PlanningItem;
  onToggleDone: () => void;
  onPatch: (patch: Partial<PlanningItem>) => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [draftBody, setDraftBody] = useState(item.body ?? "");

  function commit() {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setDraftTitle(item.title);
      setEditing(false);
      return;
    }
    const patch: Partial<PlanningItem> = {};
    if (trimmed !== item.title) patch.title = trimmed;
    const nextBody = draftBody.trim() || null;
    if (nextBody !== item.body) patch.body = nextBody;
    if (Object.keys(patch).length > 0) onPatch(patch);
    setEditing(false);
  }

  return (
    <li
      className={`card flex items-start gap-3 p-3 transition-colors ${
        item.done ? "bg-paper-100/50" : ""
      }`}
    >
      {item.kind === "task" && (
        <button
          type="button"
          onClick={onToggleDone}
          aria-label={item.done ? t("planning.mark_undone") : t("planning.mark_done")}
          className="mt-0.5 shrink-0 text-ink-500 transition-colors hover:text-ink-800"
        >
          {item.done ? <CheckCircle2 size={18} className="text-sage-700" /> : <Circle size={18} />}
        </button>
      )}
      {item.kind === "idea" && (
        <Lightbulb size={18} className="mt-0.5 shrink-0 text-ink-400" aria-hidden="true" />
      )}

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  setDraftTitle(item.title);
                  setDraftBody(item.body ?? "");
                  setEditing(false);
                }
              }}
              className="w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm outline-none focus:border-ink-400"
              maxLength={200}
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder={t("planning.body_placeholder")}
              rows={2}
              className="w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-xs text-ink-700 outline-none focus:border-ink-400"
              maxLength={5000}
            />
            <div className="flex gap-2">
              <button type="button" onClick={commit} className="btn-primary btn-sm">
                {t("common.save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(item.title);
                  setDraftBody(item.body ?? "");
                  setEditing(false);
                }}
                className="btn-ghost btn-sm"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="block w-full text-left">
            <p className={`text-sm ${item.done ? "text-ink-400 line-through" : "text-ink-900"}`}>
              {item.title}
            </p>
            {item.body && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-ink-600">{item.body}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
              {item.kind === "task" && item.due_date && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} aria-hidden="true" />
                  {item.due_date}
                </span>
              )}
              {item.kind === "task" && item.assignee && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-ink-700"
                  title={t("planning.assignee_label")}
                >
                  <User size={11} aria-hidden="true" />
                  {item.assignee}
                </span>
              )}
              {item.kind === "idea" && item.suggested_by_name && (
                <span className="italic text-ink-500">
                  {t("planning.idea_suggested_by", { name: item.suggested_by_name })}
                </span>
              )}
            </div>
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onDelete}
        aria-label={t("common.delete")}
        className="btn-ghost btn-sm shrink-0 text-blush-700"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function EmptyState({ kind }: { kind: PlanningTabKind }) {
  const { t } = useT();
  const Icon = kind === "task" ? CheckCircle2 : Lightbulb;
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-paper-300 bg-paper-50 px-4 py-10 text-center">
      <Icon size={28} className="mx-auto text-ink-400" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-700">{t(`planning.empty_${kind}`)}</p>
    </div>
  );
}
