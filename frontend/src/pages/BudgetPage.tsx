// Budget planner. Inline-editable lines, total + per-guest cost re-cost as you type.

import type { BudgetCategory, BudgetLine, BudgetSnapshot } from "@shared/types";
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { budgetApi, coupleApi } from "../lib/endpoints";
import { formatHuf } from "../lib/format";
import { useT } from "../lib/i18n";

const CATEGORIES: BudgetCategory[] = [
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
];

export default function BudgetPage() {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const toast = useToast();
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [budgetCap, setBudgetCap] = useState<number | null>(null);
  const [guestCount, setGuestCount] = useState<number | null>(null);

  async function refresh() {
    const [linesR, snapsR, coupleR] = await Promise.all([
      budgetApi.listLines(),
      budgetApi.listSnapshots(),
      coupleApi.current(),
    ]);
    setLines(linesR.lines);
    setSnapshots(snapsR.snapshots);
    setBudgetCap(coupleR.couple?.budget_ceiling_huf ?? null);
    setGuestCount(coupleR.couple?.target_guest_count ?? null);
  }

  useEffect(() => {
    refresh();
  }, []);

  const totals = useMemo(() => {
    const planned = lines.reduce((s, l) => s + l.planned_huf, 0);
    const actual = lines.reduce((s, l) => s + l.actual_huf, 0);
    return { planned, actual };
  }, [lines]);

  const overCap = budgetCap !== null && totals.planned > budgetCap;

  async function save(line: BudgetLine, key: "planned_huf" | "actual_huf", val: number) {
    const next = lines.map((l) => (l.id === line.id ? { ...l, [key]: val } : l));
    setLines(next);
    try {
      await budgetApi.updateLine(line.id, { ...line, [key]: val });
    } catch {
      refresh();
    }
  }

  async function rename(line: BudgetLine, label: string) {
    if (!label.trim() || label === line.label) return;
    const next = lines.map((l) => (l.id === line.id ? { ...l, label } : l));
    setLines(next);
    try {
      await budgetApi.updateLine(line.id, { ...line, label });
    } catch {
      refresh();
    }
  }

  async function addLine() {
    const r = await budgetApi.createLine({
      category: "other",
      label: "New line",
      planned_huf: 0,
      actual_huf: 0,
    });
    setLines([...lines, r.line]);
  }

  async function removeLine(id: number) {
    const ok = await confirm({
      title: t("common.confirm_delete_title"),
      body: t("common.confirm_delete_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    await budgetApi.removeLine(id);
    setLines(lines.filter((l) => l.id !== id));
  }

  async function saveSnapshot() {
    const name = await promptEntry({
      title: t("budget.save_snapshot"),
      label: t("budget.snapshot_name_label"),
      helperText: t("budget.snapshot_name_help"),
      placeholder: t("budget.snapshot_name_prompt"),
      confirmLabel: t("common.save"),
      cancelLabel: t("common.cancel"),
      validate: (v) => (v.trim().length === 0 ? t("budget.snapshot_name_label") : null),
    });
    if (!name) return;
    try {
      await budgetApi.createSnapshot({ name });
      const r = await budgetApi.listSnapshots();
      setSnapshots(r.snapshots);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("budget.snapshot_save_failed"));
    }
  }

  async function removeSnapshot(id: number) {
    const ok = await confirm({
      title: t("common.confirm_delete_title"),
      body: t("common.confirm_delete_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    await budgetApi.removeSnapshot(id);
    setSnapshots(snapshots.filter((s) => s.id !== id));
  }

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>{t("budget.title")}</h1>
          <p className="mt-1 text-sm text-ink-500">{t("budget.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={saveSnapshot}>
            <Save size={16} /> {t("budget.save_snapshot")}
          </button>
          <button type="button" className="btn-primary" onClick={addLine}>
            <Plus size={16} /> {t("budget.add_line")}
          </button>
        </div>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label={t("budget.total_planned")}
          value={formatHuf(totals.planned, locale)}
          accent={overCap ? "blush" : undefined}
        />
        <Stat label={t("budget.total_actual")} value={formatHuf(totals.actual, locale)} />
        <Stat
          label={t("budget.cap")}
          value={budgetCap !== null ? formatHuf(budgetCap, locale) : "—"}
          subline={
            guestCount !== null && guestCount > 0
              ? `${t("budget.cost_per_guest")}: ${formatHuf(Math.round(totals.planned / guestCount), locale)}`
              : null
          }
          accent={overCap ? "blush" : undefined}
        />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-3 py-3">{t("budget.category")}</th>
              <th className="px-3 py-3">{t("budget.label")}</th>
              <th className="px-3 py-3 text-right">{t("budget.planned")}</th>
              <th className="px-3 py-3 text-right">{t("budget.actual")}</th>
              <th className="px-3 py-3 text-right hidden sm:table-cell">{t("budget.delta")}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const delta = line.actual_huf - line.planned_huf;
              return (
                <tr key={line.id} className="border-t border-paper-200">
                  <td className="px-3 py-2 text-ink-600">
                    {/* Category label uses a stable English word for now; v2 can localise */}
                    {prettyCategory(line.category)}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input"
                      defaultValue={line.label}
                      onBlur={(e) => rename(line, e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NumberInput
                      value={line.planned_huf}
                      onCommit={(v) => save(line, "planned_huf", v)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NumberInput
                      value={line.actual_huf}
                      onCommit={(v) => save(line, "actual_huf", v)}
                    />
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell text-right">
                    <span
                      className={
                        delta > 0 ? "text-blush-700" : delta < 0 ? "text-ink-500" : "text-ink-400"
                      }
                    >
                      {delta === 0 ? "—" : formatHuf(delta, locale)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-blush-700"
                      onClick={() => removeLine(line.id)}
                      aria-label={t("budget.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-ink-500">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-8">
        <h2>{t("budget.snapshots_title")}</h2>
        {snapshots.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">{t("budget.no_snapshots")}</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshots.map((s) => {
              let count = 0;
              let planned = 0;
              try {
                const arr = JSON.parse(s.payload_json) as { planned_huf: number }[];
                count = arr.length;
                planned = arr.reduce((sum, l) => sum + (Number(l.planned_huf) || 0), 0);
              } catch {
                // ignore
              }
              return (
                <div key={s.id} className="card-hover">
                  <h3 className="text-base font-semibold">{s.name}</h3>
                  <p className="mt-1 text-xs text-ink-500">
                    {count} · {formatHuf(planned, locale)}
                  </p>
                  <button
                    type="button"
                    className="btn-ghost btn-sm mt-3 text-blush-700"
                    onClick={() => removeSnapshot(s.id)}
                  >
                    <Trash2 size={14} /> {t("budget.delete")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  subline,
  accent,
}: {
  label: string;
  value: string;
  subline?: string | null;
  accent?: "blush";
}) {
  return (
    <div className={accent === "blush" ? "card border-blush-300" : "card"}>
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-serif font-semibold ${
          accent === "blush" ? "text-blush-700" : "text-ink-900"
        }`}
      >
        {value}
      </p>
      {subline && <p className="mt-1 text-xs text-ink-500">{subline}</p>}
    </div>
  );
}

function NumberInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      step={1000}
      className="input text-right tabular-nums"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(Math.round(n));
        else setDraft(String(value));
      }}
    />
  );
}

function prettyCategory(cat: BudgetCategory): string {
  return cat
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
