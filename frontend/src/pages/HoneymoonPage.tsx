// Placeholder for the post-wedding honeymoon planner. Surfaces the sidebar
// entry today; full content (destination, dates, packing) lands in a
// follow-up. The allocated honeymoon budget IS surfaced here so the couple
// can see at a glance how much they have set aside.

import type { BudgetLine } from "@shared/types";
import { ArrowRight, Plane } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { budgetApi } from "../lib/endpoints";
import { formatHuf } from "../lib/format";
import { useT } from "../lib/i18n";
import { subscribe } from "../lib/sync";

export default function HoneymoonPage() {
  const { t, locale } = useT();
  const [lines, setLines] = useState<BudgetLine[] | null>(null);

  async function refresh() {
    const r = await budgetApi.listLines();
    setLines(r.lines);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Mirror partner edits across tabs — same pattern as BudgetPage.
  useEffect(() => {
    return subscribe("budget:changed", () => {
      refresh();
    });
  }, []);

  const totals = useMemo(() => {
    if (!lines) return null;
    const honeymoon = lines.filter((l) => l.category === "honeymoon");
    let planned = 0;
    let actual = 0;
    for (const l of honeymoon) {
      planned += l.planned_huf;
      actual += l.actual_huf;
    }
    return { planned, actual, count: honeymoon.length };
  }, [lines]);

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("honeymoon.title")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("honeymoon.sub")}</p>
      </header>

      <BudgetTile totals={totals} locale={locale} t={t} />

      <div className="card mt-6 flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blush-50 text-blush-700">
          <Plane size={22} aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-serif text-xl">{t("honeymoon.coming_soon_title")}</h2>
          <p className="mt-1 text-sm text-ink-700">{t("honeymoon.coming_soon_body")}</p>
        </div>
      </div>
    </AppShell>
  );
}

function BudgetTile({
  totals,
  locale,
  t,
}: {
  totals: { planned: number; actual: number; count: number } | null;
  locale: "hu" | "en";
  t: ReturnType<typeof useT>["t"];
}) {
  // Loading: render a structurally-identical placeholder so the layout
  // doesn't jump when the fetch resolves.
  if (totals === null) {
    return (
      <section
        className="card relative overflow-hidden border border-paper-200 bg-gradient-to-br from-blush-50 via-paper-50 to-paper-50"
        aria-busy="true"
      >
        <div className="h-24" />
      </section>
    );
  }

  const { planned, actual, count } = totals;
  const remaining = planned - actual;
  const empty = count === 0;

  if (empty) {
    return (
      <section className="card flex flex-col items-start gap-3 border border-paper-200 bg-gradient-to-br from-blush-50 via-paper-50 to-paper-50 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-blush-700">
            <Plane size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-serif text-lg">{t("honeymoon.budget_title")}</h2>
            <p className="mt-0.5 text-sm text-ink-700">{t("honeymoon.budget_empty_hint")}</p>
          </div>
        </div>
        <Link to="/app/budget" className="btn-outline shrink-0 self-stretch sm:self-auto">
          {t("honeymoon.budget_open_link")}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  const linesLabel = t("honeymoon.budget_lines_count", { count });

  return (
    <section className="card relative overflow-hidden border border-paper-200 bg-gradient-to-br from-blush-50 via-paper-50 to-paper-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-blush-700">
            <Plane size={18} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {t("honeymoon.budget_title")}
            </p>
            <p className="mt-0.5 text-xs text-ink-400">{linesLabel}</p>
          </div>
        </div>
        <Link to="/app/budget" className="text-sm font-medium text-blush-700 hover:text-blush-800">
          {t("honeymoon.budget_open_link")}
          <ArrowRight size={14} aria-hidden="true" className="ml-1 inline" />
        </Link>
      </div>

      <div className="mt-4 flex items-baseline gap-3">
        <span className="font-serif text-4xl font-semibold tabular-nums text-ink-900 sm:text-5xl">
          {formatHuf(planned, locale)}
        </span>
        <span className="text-sm text-ink-500">{t("honeymoon.budget_planned_label")}</span>
      </div>

      {actual > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-paper-200/80 pt-3 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-500">{t("honeymoon.budget_actual_label")}</dt>
            <dd className="tabular-nums text-ink-900">{formatHuf(actual, locale)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-500">{t("honeymoon.budget_remaining_label")}</dt>
            <dd className={`tabular-nums ${remaining < 0 ? "text-blush-700" : "text-ink-900"}`}>
              {formatHuf(remaining, locale)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
