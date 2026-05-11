// Free-form planning surface. Three tabs over the same backend table:
// Feladatok (tasks — checklist with optional due date), Ötletek (notes — free
// text), Programterv (wedding-day timeline — HH:MM + label). One quick-add
// row per tab; rows are inline-editable on click.

import type { PlanningItem, PlanningKind } from "@shared/types";
import { Calendar, CheckCircle2, Circle, Lightbulb, Plus, Trash2, Wand2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Dialog, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { planningApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** Wedding-day template entries anchored to ceremony time. Offsets are in
 *  minutes; events whose computed time falls outside 00:00..23:59 are silently
 *  skipped (very early ceremonies don't get a 03:00 "preparations", very late
 *  ones don't get a 26:00 "bride's dance" — the couple adds late events
 *  manually). Titles are i18n keys resolved at apply time. */
const WEDDING_TEMPLATE: { offsetMins: number; titleKey: string }[] = [
  { offsetMins: -240, titleKey: "planning.template_preparations" },
  { offsetMins: -30, titleKey: "planning.template_guests_arrive" },
  { offsetMins: 0, titleKey: "planning.template_ceremony" },
  { offsetMins: 30, titleKey: "planning.template_congrats" },
  { offsetMins: 60, titleKey: "planning.template_group_photo" },
  { offsetMins: 120, titleKey: "planning.template_cocktail" },
  { offsetMins: 240, titleKey: "planning.template_dinner" },
  { offsetMins: 330, titleKey: "planning.template_cake" },
  { offsetMins: 360, titleKey: "planning.template_first_dance" },
  { offsetMins: 400, titleKey: "planning.template_party" },
  { offsetMins: 480, titleKey: "planning.template_bride_dance" },
];

function formatHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const TABS: { kind: PlanningKind; labelKey: string }[] = [
  { kind: "task", labelKey: "planning.tab_tasks" },
  { kind: "idea", labelKey: "planning.tab_ideas" },
  { kind: "schedule", labelKey: "planning.tab_schedule" },
];

export default function PlanningPage() {
  const { t } = useT();
  useDocumentMeta("seo.planning_title", "seo.planning_description");
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKind, setActiveKind] = useState<PlanningKind>("task");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);

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
    scheduled_time?: string | null;
  }) {
    try {
      const r = await planningApi.create({ kind: activeKind, ...input });
      setItems((prev) => [...prev, r.item]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

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

  async function onApplyTemplate(ceremonyHHMM: string) {
    const anchor = parseHHMM(ceremonyHHMM);
    if (anchor === null) return;
    setApplyingTemplate(true);
    try {
      // POST sequentially so each created item gets a deterministic position
      // (defaults to 0; render order falls back to created_at). Failures bail
      // out — the user can re-run with a different time after fixing.
      const created: PlanningItem[] = [];
      for (const tmpl of WEDDING_TEMPLATE) {
        const mins = anchor + tmpl.offsetMins;
        if (mins < 0 || mins >= 1440) continue;
        const r = await planningApi.create({
          kind: "schedule",
          title: t(tmpl.titleKey),
          scheduled_time: formatHHMM(mins),
        });
        created.push(r.item);
      }
      setItems((prev) => [...prev, ...created]);
      toast.success(t("planning.template_done", { count: created.length }));
      setTemplateOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setApplyingTemplate(false);
    }
  }

  const hasScheduleItems = useMemo(() => items.some((i) => i.kind === "schedule"), [items]);

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
            const Icon =
              tab.kind === "task" ? CheckCircle2 : tab.kind === "idea" ? Lightbulb : Calendar;
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

        {activeKind === "schedule" && (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => setTemplateOpen(true)}
              className="btn-ghost btn-sm inline-flex items-center gap-1.5"
              title={t("planning.template_button_hint")}
            >
              <Wand2 size={14} aria-hidden="true" />
              <span>{t("planning.template_button")}</span>
            </button>
          </div>
        )}

        <QuickAddForm kind={activeKind} onCreate={onCreate} />

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

      {templateOpen && (
        <TemplateDialog
          existing={hasScheduleItems}
          applying={applyingTemplate}
          onClose={() => setTemplateOpen(false)}
          onApply={onApplyTemplate}
        />
      )}
    </AppShell>
  );
}

function TemplateDialog({
  existing,
  applying,
  onClose,
  onApply,
}: {
  existing: boolean;
  applying: boolean;
  onClose: () => void;
  onApply: (ceremonyHHMM: string) => Promise<void>;
}) {
  const { t } = useT();
  const [ceremonyTime, setCeremonyTime] = useState("15:00");
  const previewTimes = useMemo(() => {
    const anchor = parseHHMM(ceremonyTime);
    if (anchor === null) return [];
    return WEDDING_TEMPLATE.flatMap((tmpl) => {
      const mins = anchor + tmpl.offsetMins;
      if (mins < 0 || mins >= 1440) return [];
      return [{ time: formatHHMM(mins), titleKey: tmpl.titleKey }];
    });
  }, [ceremonyTime]);

  return (
    <Dialog
      open
      title={t("planning.template_dialog_title")}
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
            onClick={() => onApply(ceremonyTime)}
            disabled={applying || parseHHMM(ceremonyTime) === null}
          >
            {applying ? t("common.loading") : t("planning.template_confirm")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-700">{t("planning.template_dialog_body")}</p>
        <label className="flex items-center gap-3 text-sm text-ink-700">
          <span className="font-medium">{t("planning.template_ceremony_label")}</span>
          <input
            type="time"
            value={ceremonyTime}
            onChange={(e) => setCeremonyTime(e.target.value)}
            className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 outline-none focus:border-ink-400"
          />
        </label>
        {existing && (
          <p className="rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-xs text-ink-600">
            {t("planning.template_warning_existing")}
          </p>
        )}
        {previewTimes.length > 0 && (
          <div className="rounded-lg border border-paper-200 bg-paper-50 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
              {t("planning.template_preview_label")}
            </p>
            <ul className="space-y-1 text-xs text-ink-700">
              {previewTimes.map((p) => (
                <li key={p.titleKey} className="flex items-center gap-3">
                  <span className="font-mono text-ink-900">{p.time}</span>
                  <span>{t(p.titleKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function QuickAddForm({
  kind,
  onCreate,
}: {
  kind: PlanningKind;
  onCreate: (input: {
    title: string;
    body?: string | null;
    due_date?: string | null;
    scheduled_time?: string | null;
  }) => Promise<void>;
}) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await onCreate({
      title: trimmed,
      due_date: kind === "task" && dueDate ? dueDate : null,
      scheduled_time: kind === "schedule" && scheduledTime ? scheduledTime : null,
    });
    setTitle("");
    setDueDate("");
    setScheduledTime("");
    inputRef.current?.focus();
  }

  const placeholder =
    kind === "task"
      ? t("planning.task_placeholder")
      : kind === "idea"
        ? t("planning.idea_placeholder")
        : t("planning.schedule_placeholder");

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
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label={t("planning.due_date_label")}
          className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400"
        />
      )}
      {kind === "schedule" && (
        <input
          type="time"
          value={scheduledTime}
          onChange={(e) => setScheduledTime(e.target.value)}
          aria-label={t("planning.time_label")}
          className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400"
        />
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
      {item.kind === "schedule" && (
        <span
          className="mt-0.5 inline-flex h-6 min-w-[3rem] shrink-0 items-center justify-center rounded-md bg-ink-100 px-1.5 font-mono text-xs text-ink-700"
          aria-label={t("planning.time_label")}
        >
          {item.scheduled_time ?? "—:—"}
        </span>
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
            {item.kind === "task" && item.due_date && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-500">
                <Calendar size={12} aria-hidden="true" />
                {item.due_date}
              </p>
            )}
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

function EmptyState({ kind }: { kind: PlanningKind }) {
  const { t } = useT();
  const Icon = kind === "task" ? CheckCircle2 : kind === "idea" ? Lightbulb : Calendar;
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-paper-300 bg-paper-50 px-4 py-10 text-center">
      <Icon size={28} className="mx-auto text-ink-400" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-700">{t(`planning.empty_${kind}`)}</p>
    </div>
  );
}
