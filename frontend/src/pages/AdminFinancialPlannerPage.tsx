// Admin financial planner — live subscription revenue + an assumption-driven
// forecast. The backend serves the live base; the projection (shared
// projectRevenue) re-runs in the browser as the operator drags the sliders.

import { ChevronRight, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type AdminFinancialPlannerOverview,
  type ForecastAssumptions,
  projectRevenue,
} from "@shared/admin_financial_planner";
import type { SubscriptionStatus } from "@shared/billing";
import { AdminPageHeader } from "../components/admin";
import { adminFinancialPlannerApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const PLAN_LABEL: Record<SubscriptionStatus, `billing.plan_${string}`> = {
  trialing: "billing.plan_trialing",
  founding: "billing.plan_founding",
  active: "billing.plan_active",
  past_due: "billing.plan_past_due",
  canceled: "billing.plan_canceled",
  none: "billing.plan_none",
};
const COHORT_ORDER: SubscriptionStatus[] = [
  "active",
  "past_due",
  "founding",
  "trialing",
  "canceled",
  "none",
];

const DEFAULT_ASSUMPTIONS: ForecastAssumptions = {
  months: 18,
  newCouplesPerMonth: 20,
  trialToPaidPct: 30,
  foundingToPaidPct: 50,
  monthlyChurnPct: 3,
};

/** Map the backend's "YYYY-MM" founding-expiry buckets onto month offsets from
 *  now (0 = this month) so projectRevenue can apply them per step. */
function expiryByOffset(o: AdminFinancialPlannerOverview, months: number): number[] {
  const arr = new Array(months).fill(0);
  const base = new Date(o.generated_at);
  const baseIdx = base.getFullYear() * 12 + base.getMonth();
  for (const b of o.founding_expiry) {
    const [y, m] = b.month.split("-").map(Number);
    if (!y || !m) continue;
    const offset = y * 12 + (m - 1) - baseIdx;
    if (offset >= 0 && offset < months) arr[offset] += b.count;
  }
  return arr;
}

// ── Becsült adózás ────────────────────────────────────────────────────
// Tájékoztató jellegű, leegyszerűsített magyar adóbecslés a tervezett éves
// árbevételre. NEM adótanácsadás — 2024-es kulcsokkal, kerekítve. A
// profitalapú (KFT) formák a "költséghányad" csúszkát használják.
const HUF_PER_EUR = 400; // a KATA fix Ft-tételének EUR-ra váltásához

type TaxForm = {
  key: string;
  name: string;
  note: string;
  /** Becsült éves adó EUR-ban az éves árbevétel (EUR) + költséghányad (0..1) alapján. */
  tax: (revenueEur: number, costRatio: number) => number;
};

const TAX_FORMS: readonly TaxForm[] = [
  {
    key: "kata",
    name: "KATA",
    note: "fix 50e Ft/hó; csak magánszemély vevőkre, max. 18M Ft/év",
    tax: () => (50_000 * 12) / HUF_PER_EUR,
  },
  {
    key: "ev_atalany",
    name: "EV — átalányadó",
    note: "40% költséghányad, ~46,5% a jövedelmen (SZJA + TB + szocho)",
    tax: (rev) => rev * 0.6 * 0.465,
  },
  {
    key: "kft_osztalek",
    name: "KFT — osztalék kivét",
    note: "TAO 9% + osztalék (SZJA 15% + szocho 13%)",
    tax: (rev, c) => {
      const profit = rev * (1 - c);
      return profit - profit * 0.91 * (1 - 0.28); // TAO 9% + 28% az osztalékon
    },
  },
  {
    key: "kft_reinvest",
    name: "KFT — visszaforgatott profit",
    note: "csak társasági adó (TAO 9%), osztalék nélkül",
    tax: (rev, c) => rev * (1 - c) * 0.09,
  },
];

export default function AdminFinancialPlannerPage() {
  const { t, locale } = useT();
  useDocumentMeta("admin.fin_title", "admin.fin_subtitle");
  const [data, setData] = useState<AdminFinancialPlannerOverview | null>(null);
  const [a, setA] = useState<ForecastAssumptions>(DEFAULT_ASSUMPTIONS);
  // Költséghányad (a bevétel hány %-a a levonható költség) a profitalapú
  // adóformákhoz. Csak a KFT-sorokat befolyásolja.
  const [costPct, setCostPct] = useState(20);

  useEffect(() => {
    adminFinancialPlannerApi
      .overview()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const projection = useMemo(() => {
    if (!data) return [];
    return projectRevenue(
      { subscribers: data.paying_subscribers, arpuEur: data.arpu_eur },
      a,
      expiryByOffset(data, a.months),
    );
  }, [data, a]);

  const eur = (n: number) => formatMoney(n, "EUR", locale);
  const last = projection[projection.length - 1];

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
        <div className="admin-card h-40 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
      <AdminPageHeader title={t("admin.fin_title")} subtitle={t("admin.fin_subtitle")} />

      {/* Live KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label={t("admin.fin_kpi_mrr")}
          value={eur(data.mrr_eur_total)}
          emphasis
          hint={t("admin.fin_kpi_mrr_hint")}
        />
        <Kpi
          label={t("admin.fin_kpi_arr")}
          value={eur(data.arr_eur_total)}
          emphasis
          hint={t("admin.fin_kpi_arr_hint")}
        />
        <Kpi label={t("admin.fin_kpi_paying")} value={String(data.paying_subscribers)} />
        <Kpi label={t("admin.fin_kpi_founding_active")} value={String(data.founding_active)} />
        <Kpi label={t("admin.fin_kpi_founding_left")} value={String(data.founding_spots_left)} />
        <Kpi label={t("admin.fin_kpi_trialing")} value={String(data.trialing)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Cohorts */}
        <section className="admin-card">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-paper-50">
            {t("admin.fin_cohorts_title")}
          </h2>
          <ul className="mt-3 space-y-1.5">
            {COHORT_ORDER.map((s) => (
              <li key={s} className="flex items-center justify-between text-sm">
                <span className="text-neutral-600 dark:text-umber-200">{t(PLAN_LABEL[s])}</span>
                <span className="font-medium tabular-nums text-neutral-900 dark:text-paper-50">
                  {data.counts[s]}
                </span>
              </li>
            ))}
            <li className="mt-1 flex items-center justify-between border-t border-paper-200 pt-1.5 text-sm dark:border-umber-700">
              <span className="text-neutral-500 dark:text-umber-300">Total</span>
              <span className="font-semibold tabular-nums">{data.total_couples}</span>
            </li>
          </ul>
        </section>

        {/* MRR by currency */}
        <section className="admin-card">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-paper-50">
            {t("admin.fin_mrr_by_currency_title")}
          </h2>
          <ul className="mt-3 space-y-1.5">
            {data.mrr_by_currency.length === 0 && (
              <li className="text-sm text-neutral-500 dark:text-umber-300">—</li>
            )}
            {data.mrr_by_currency.map((m) => (
              <li key={m.currency} className="flex items-center justify-between text-sm">
                <span className="text-neutral-600 dark:text-umber-200">
                  {m.currency} · {m.subscribers}
                </span>
                <span className="font-medium tabular-nums text-neutral-900 dark:text-paper-50">
                  {formatMoney(m.mrr, m.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Assumptions */}
      <section className="admin-card mt-4">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-paper-50">
          {t("admin.fin_assumptions_title")}
        </h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-umber-300">
          {t("admin.fin_assumptions_hint")}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Slider
            label={t("admin.fin_new_couples")}
            value={a.newCouplesPerMonth}
            min={0}
            max={200}
            step={5}
            display={String(a.newCouplesPerMonth)}
            onChange={(v) => setA({ ...a, newCouplesPerMonth: v })}
          />
          <Slider
            label={t("admin.fin_trial_conv")}
            value={a.trialToPaidPct}
            min={0}
            max={100}
            step={1}
            display={`${a.trialToPaidPct}%`}
            onChange={(v) => setA({ ...a, trialToPaidPct: v })}
          />
          <Slider
            label={t("admin.fin_founding_conv")}
            value={a.foundingToPaidPct}
            min={0}
            max={100}
            step={1}
            display={`${a.foundingToPaidPct}%`}
            onChange={(v) => setA({ ...a, foundingToPaidPct: v })}
          />
          <Slider
            label={t("admin.fin_churn")}
            value={a.monthlyChurnPct}
            min={0}
            max={20}
            step={1}
            display={`${a.monthlyChurnPct}%`}
            onChange={(v) => setA({ ...a, monthlyChurnPct: v })}
          />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-600 dark:text-umber-200">
            {t("admin.fin_horizon")}
          </span>
          {[12, 18, 24].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setA({ ...a, months: m })}
              className={`rounded-lg px-3 py-1 text-sm transition-colors ${
                a.months === m
                  ? "bg-neutral-900 text-paper-50 dark:bg-paper-50 dark:text-neutral-900"
                  : "bg-paper-100 text-neutral-600 hover:bg-paper-200 dark:bg-umber-800 dark:text-umber-200"
              }`}
            >
              {t("admin.fin_horizon_months", { n: m })}
            </button>
          ))}
        </div>
      </section>

      {/* Projection */}
      <section className="admin-card mt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-paper-50">
            {t("admin.fin_projection_title")}
          </h2>
          {last && (
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-xs text-neutral-500 dark:text-umber-300">
                  {t("admin.fin_projected_mrr", { n: a.months })}
                </div>
                <div className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-paper-50">
                  {eur(last.mrr)}
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500 dark:text-umber-300">
                  {t("admin.fin_projected_arr", { n: a.months })}
                </div>
                <div className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-paper-50">
                  {eur(last.mrr * 12)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Simple MRR bar chart */}
        <MrrChart points={projection.map((p) => ({ month: p.month, mrr: p.mrr }))} fmt={eur} />

        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-umber-200 dark:hover:text-paper-50">
            <ChevronRight
              size={14}
              aria-hidden="true"
              className="transition-transform group-open:rotate-90"
            />
            {t("admin.fin_monthly_breakdown")}
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-center text-xs uppercase tracking-wide text-neutral-500 dark:text-umber-300">
                  <th className="px-3 py-1 font-medium">{t("admin.fin_col_month")}</th>
                  <th className="px-3 py-1 font-medium">{t("admin.fin_col_subs")}</th>
                  <th className="px-3 py-1 font-medium">{t("admin.fin_col_mrr")}</th>
                </tr>
              </thead>
              <tbody>
                {projection.map((p) => (
                  <tr key={p.month} className="border-t border-paper-200 dark:border-umber-700">
                    <td className="px-3 py-1.5 text-center tabular-nums text-neutral-600 dark:text-umber-200">
                      {p.month}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-neutral-800 dark:text-paper-100">
                      {p.subscribers}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums font-medium text-neutral-900 dark:text-paper-50">
                      {eur(p.mrr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* Becsült adózás a tervezett éves árbevételre */}
      {last && (
        <section className="admin-card mt-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-paper-50">
                Becsült adózás
              </h2>
              <p className="mt-1 max-w-prose text-xs text-neutral-500 dark:text-umber-300">
                A tervezett éves árbevételre ({eur(last.mrr * 12)} ARR a(z) {a.months}. hónapban).
                Tájékoztató becslés 2024-es kulcsokkal, kerekítve — nem adótanácsadás. A
                költséghányad csak a KFT (profitalapú) sorokat befolyásolja.
              </p>
            </div>
            <div className="w-44 shrink-0">
              <Slider
                label="Költséghányad"
                value={costPct}
                min={0}
                max={80}
                step={5}
                display={`${costPct}%`}
                onChange={setCostPct}
              />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 dark:text-umber-300">
                  <th className="py-1 pr-4 font-medium">Forma</th>
                  <th className="py-1 pr-4 text-right font-medium">Becsült éves adó</th>
                  <th className="py-1 pr-4 text-right font-medium">Effektív kulcs</th>
                  <th className="py-1 text-right font-medium">Nettó / év</th>
                </tr>
              </thead>
              <tbody>
                {TAX_FORMS.map((f) => {
                  const rev = last.mrr * 12;
                  const tax = Math.max(0, Math.round(f.tax(rev, costPct / 100)));
                  const eff = rev > 0 ? (tax / rev) * 100 : 0;
                  const overKataCap = f.key === "kata" && rev * HUF_PER_EUR > 18_000_000;
                  return (
                    <tr key={f.key} className="border-t border-paper-200 dark:border-umber-700">
                      <td className="py-1.5 pr-4">
                        <div className="font-medium text-neutral-900 dark:text-paper-50">
                          {f.name}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-umber-300">
                          {f.note}
                          {overKataCap && (
                            <span className="text-blush-600 dark:text-blush-300">
                              {" "}
                              · túllépi a keretet
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 pr-4 text-right font-medium tabular-nums text-neutral-900 dark:text-paper-50">
                        {eur(tax)}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-neutral-700 dark:text-paper-100">
                        {eff.toFixed(1)}%
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-neutral-700 dark:text-paper-100">
                        {eur(Math.round(rev - tax))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  emphasis,
  hint,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  /** Optional plain-language explanation surfaced behind a small info icon. */
  hint?: string;
}) {
  return (
    <div
      className={`admin-tile ${emphasis ? "ring-1 ring-neutral-800 dark:ring-neutral-400/50" : ""}`}
    >
      <div className="flex items-center justify-center gap-1 text-xs text-neutral-500 dark:text-umber-300">
        <span>{label}</span>
        {hint && (
          <button
            type="button"
            title={hint}
            aria-label={hint}
            className="inline-flex cursor-help items-center text-neutral-400 hover:text-neutral-700 dark:text-umber-300 dark:hover:text-paper-100"
          >
            <Info size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-1 text-center text-xl font-semibold tabular-nums text-neutral-900 dark:text-paper-50">
        {value}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-neutral-600 dark:text-umber-200">{label}</span>
        <span className="tabular-nums font-semibold text-neutral-900 dark:text-paper-50">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-neutral-800"
      />
    </label>
  );
}

function MrrChart({
  points,
  fmt,
}: {
  points: { month: number; mrr: number }[];
  fmt: (n: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => p.mrr));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="relative mt-4">
      {/* Hover tooltip: the month + its projected MRR. */}
      {hover !== null && points[hover] && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-paper-50 shadow-pop dark:bg-paper-50 dark:text-neutral-900"
          style={{ left: `${((hover + 0.5) / points.length) * 100}%` }}
        >
          <span className="tabular-nums">{points[hover].month}. hó</span>
          <span className="mx-1 opacity-40">·</span>
          <span className="tabular-nums">{fmt(points[hover].mrr)}</span>
        </div>
      )}
      <div className="flex h-28 items-end gap-0.5">
        {points.map((p, i) => (
          <button
            type="button"
            key={p.month}
            className="group flex h-full flex-1 items-end p-0"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            onFocus={() => setHover(i)}
            onBlur={() => setHover((h) => (h === i ? null : h))}
            aria-label={`${p.month}. hó: ${fmt(p.mrr)}`}
          >
            <span
              className="w-full rounded-t bg-neutral-800/80 transition-colors group-hover:bg-neutral-900 dark:bg-neutral-300/60 dark:group-hover:bg-paper-50"
              style={{ height: `${Math.max(2, (p.mrr / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
