// Admin financial planner — live subscription revenue + an assumption-driven
// forecast. The backend serves the live base; the projection (shared
// projectRevenue) re-runs in the browser as the operator drags the sliders.

import {
  Banknote,
  Check,
  ChevronRight,
  CreditCard,
  DollarSign,
  Euro,
  Info,
  Lock,
  LockOpen,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type AdminFinancialPlannerOverview,
  type ForecastAssumptions,
  type FxRates,
  projectRevenue,
  type StripeHealth,
  type SubscriptionUnitEconomics,
  subscriptionUnitEconomics,
} from "@shared/admin_financial_planner";
import { FOUNDING_CAP, type SubscriptionStatus } from "@shared/billing";
import { AdminPageHeader, Pill } from "../components/admin";
import { useConfirm, useToast } from "../components/ui";
import { adminFinancialPlannerApi } from "../lib/endpoints";
import { formatMoney, intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
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
  avgCycleMonths: 7,
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
// 2024-es minimálbér 266 800 Ft/hó. Az átalányadós EV jövedelme az éves
// minimálbér feléig adómentes (SZJA + járulékok), és a főállású EV-nek a
// járulékot legalább a minimálbér után meg kell fizetnie akkor is, ha
// keveset keres — a mellékállásúnak (9-5 munka mellett) nem. A Ft-tételeket
// az élő Ft/€ árfolyammal váltjuk EUR-ra (lásd lib/fx.ts).
const ANNUAL_MIN_WAGE_HUF = 266_800 * 12;
const ATALANY_SZJA = 0.15; // SZJA a jövedelmen
const ATALANY_CONTRIB = 0.315; // TB 18,5% + szocho 13%
// Ha az élő árfolyamot nem sikerül lekérni, ezzel a Ft/€ értékkel számolunk.
const FALLBACK_HUF_PER_EUR = 400;

type TaxForm = {
  key: string;
  name: string;
  note: string;
  /** Becsült éves adó EUR-ban: éves árbevétel (EUR), költséghányad (0..1), élő Ft/€ árfolyam. */
  tax: (revenueEur: number, costRatio: number, hufPerEur: number) => number;
};

const TAX_FORMS: readonly TaxForm[] = [
  {
    key: "kata",
    name: "KATA",
    note: "fix 50e Ft/hó; csak magánszemély vevőkre, max. 18M Ft/év",
    tax: (_rev, _c, huf) => (50_000 * 12) / huf,
  },
  {
    key: "ev_atalany",
    name: "EV — átalányadó (főállás)",
    note: "40% kh.; az éves minimálbér feléig adómentes, de a járulék a minimálbér után akkor is jár",
    tax: (rev, _c, huf) => {
      const minWage = ANNUAL_MIN_WAGE_HUF / huf; // éves minimálbér EUR-ban
      const income = rev * 0.6; // 40% költséghányad
      const taxable = Math.max(0, income - minWage / 2); // a minimálbér feléig adómentes
      // Főállásban a járulék+szocho legalább a minimálbér után jár.
      const contrib = Math.max(minWage * ATALANY_CONTRIB, taxable * ATALANY_CONTRIB);
      return taxable * ATALANY_SZJA + contrib;
    },
  },
  {
    key: "ev_atalany_mellek",
    name: "EV — átalányadó (9-5 munka mellett)",
    note: "mellékállás: nincs járulékminimum (a főállás fedezi), az éves minimálbér feléig adómentes",
    tax: (rev, _c, huf) => {
      const halfMin = ANNUAL_MIN_WAGE_HUF / huf / 2;
      const income = rev * 0.6;
      const taxable = Math.max(0, income - halfMin);
      return taxable * (ATALANY_SZJA + ATALANY_CONTRIB);
    },
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
  const confirm = useConfirm();
  const toast = useToast();
  useDocumentMeta("admin.fin_title", "admin.fin_subtitle");
  const [data, setData] = useState<AdminFinancialPlannerOverview | null>(null);
  const [enforcing, setEnforcing] = useState(false);
  const [a, setA] = useState<ForecastAssumptions>(DEFAULT_ASSUMPTIONS);
  // Költséghányad (a bevétel hány %-a a levonható költség) a profitalapú
  // adóformákhoz. Csak a KFT-sorokat befolyásolja.
  const [costPct, setCostPct] = useState(20);
  // Élő EUR-alapú árfolyamok (HUF / USD / CNY) az árfolyam-sávhoz és a Ft
  // alapú adótételek átváltásához. Induláskor lekérjük, majd 10 percenként
  // frissítjük, hogy folyamatosan az aktuális értéket mutassa.
  const [fx, setFx] = useState<FxRates | null>(null);

  useEffect(() => {
    adminFinancialPlannerApi
      .overview()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      adminFinancialPlannerApi
        .fx()
        .then((r) => {
          if (!cancelled && r) setFx(r);
        })
        .catch(() => {
          /* leave the last good rate in place */
        });
    };
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const hufPerEur = fx?.rates.HUF ?? FALLBACK_HUF_PER_EUR;

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

  async function onToggleEnforcement(next: boolean) {
    const ok = await confirm({
      title: next
        ? t("admin.fin_enforce_confirm_on_title")
        : t("admin.fin_enforce_confirm_off_title"),
      body: next ? t("admin.fin_enforce_confirm_on_body") : t("admin.fin_enforce_confirm_off_body"),
      confirmLabel: next ? t("admin.fin_enforce_go_live") : t("admin.fin_enforce_turn_off"),
      cancelLabel: t("common.cancel"),
      destructive: next,
    });
    if (!ok) return;
    setEnforcing(true);
    try {
      const fresh = await adminFinancialPlannerApi.setEnforcement(next);
      setData(fresh);
      toast.success(next ? t("admin.fin_enforce_on_success") : t("admin.fin_enforce_off_success"));
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setEnforcing(false);
    }
  }

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

      {/* Fizetés go-live vezérlő: a globális read-only paywall kapcsolója */}
      <BillingLaunchCard
        data={data}
        busy={enforcing}
        onToggle={onToggleEnforcement}
        t={t}
        locale={locale}
      />

      {/* Stripe kapcsolat / health monitor */}
      <StripeHealthCard locale={locale} />

      {/* Élő árfolyam-sáv (EUR alapú) */}
      <FxStrip fx={fx} />

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
        <Kpi label={t("admin.fin_kpi_founding_left")} value={String(data.founding_spots_left)} />
        <Kpi label={t("admin.fin_kpi_trialing")} value={String(data.trialing)} />
        <Kpi
          label={t("admin.fin_kpi_checkout_started")}
          value={String(data.checkout_started_couples)}
          hint={t("admin.fin_kpi_checkout_started_hint")}
        />
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
              <li className="text-sm text-neutral-500 dark:text-umber-300">-</li>
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

      {/* Egy előfizetés bontása: bruttó ár → ÁFA → Stripe → magyar adók */}
      <UnitEconomicsCard locale={locale} liveHuf={data.price_huf} />

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
            max={1000}
            step={10}
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
            label={t("admin.fin_avg_cycle")}
            value={a.avgCycleMonths}
            min={2}
            max={12}
            step={1}
            display={`${a.avgCycleMonths} hó`}
            onChange={(v) => setA({ ...a, avgCycleMonths: v })}
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
                költséghányad csak a KFT (profitalapú) sorokat befolyásolja, a Ft-tételek pedig az
                élő árfolyammal ({hufPerEur.toFixed(1)} Ft/€) számolnak.
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
                  const tax = Math.max(0, Math.round(f.tax(rev, costPct / 100, hufPerEur)));
                  const eff = rev > 0 ? (tax / rev) * 100 : 0;
                  const overKataCap = f.key === "kata" && rev * hufPerEur > 18_000_000;
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

/** Stripe kapcsolat-figyelő. Még mielőtt a billing be lenne kötve, megmutatja
 *  mit tudunk: melyik env változó van beállítva + a kulcs módja (teszt/éles).
 *  Ha van kulcs, élő API-ping (accounts.retrieve) mondja meg, hogy a kapcsolat
 *  tényleg működik-e, és kiírja a kártyás fizetés / kifizetés go-live flageket.
 *  Titkos értéket sosem mutat. */
function StripeHealthCard({ locale }: { locale: Locale }) {
  const [h, setH] = useState<StripeHealth | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    adminFinancialPlannerApi
      .stripeHealth()
      .then(setH)
      .catch(() => setFailed(true));
  }, []);

  // Endpoint hiányzik (részleges deploy) → csendben elrejtjük a kártyát.
  if (failed) return null;

  const status: "loading" | "off" | "ok" | "error" = !h
    ? "loading"
    : !h.enabled
      ? "off"
      : h.connection?.ok
        ? "ok"
        : "error";

  const statusPill =
    status === "ok" ? (
      <Pill tone="sage">Csatlakozva</Pill>
    ) : status === "error" ? (
      <Pill tone="blush">Kapcsolódási hiba</Pill>
    ) : status === "off" ? (
      <Pill tone="paper">Nincs beállítva</Pill>
    ) : null;

  const modeBadge =
    h && h.mode && h.mode !== "unknown" ? (
      <span
        className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${
          h.mode === "live"
            ? "bg-sage-100 text-sage-700 dark:bg-sage-500/20 dark:text-sage-300"
            : "bg-paper-200 text-neutral-600 dark:bg-umber-800 dark:text-umber-200"
        }`}
      >
        {h.mode === "live" ? "Éles" : "Teszt"}
      </span>
    ) : null;

  const checkedLabel =
    h && h.checkedAt
      ? new Date(h.checkedAt).toLocaleTimeString(intlLocale(locale), {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  return (
    <section className="admin-card mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-paper-50">
            <CreditCard size={15} aria-hidden="true" />
            Stripe kapcsolat
            {statusPill}
            {modeBadge}
          </h2>
          <p className="mt-1 max-w-prose text-xs text-neutral-500 dark:text-umber-300">
            {status === "ok"
              ? "Az API-kulcs működik — élő kapcsolat a Stripe-pal."
              : status === "error"
                ? "A kulcs be van állítva, de a Stripe API nem válaszolt rendben."
                : status === "off"
                  ? "A billing még nincs bekötve. Addig is látod, mi van beállítva és mi hiányzik."
                  : "Ellenőrzés…"}
          </p>
        </div>
        {checkedLabel && (
          <span className="shrink-0 text-xs text-neutral-400 dark:text-umber-300">
            Ellenőrizve: {checkedLabel}
          </span>
        )}
      </div>

      {h && (
        <>
          {/* Env-konfiguráció checklist (sosem mutat titkos értéket) */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <ConfigItem label="Titkos kulcs" ok={h.config.secretKey} />
            <ConfigItem label="Webhook secret" ok={h.config.webhookSecret} />
            <ConfigItem label="EUR ár (price)" ok={h.config.priceEur} />
            <ConfigItem label="HUF ár (price)" ok={h.config.priceHuf} />
          </div>

          {/* Élő fiók-adatok, ha a ping sikerült. Restricted kulcsnál a fiók-
              endpoint nem elérhető: olyankor a ping az árat kéri le, a fiók-
              mezők null-ok, és ezt a blokkot nem mutatjuk. */}
          {h.connection?.ok && h.connection.accountId && (
            <div className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <HealthRow label="Fiók" value={h.connection.accountId ?? "-"} mono />
              <HealthRow
                label="Ország"
                value={h.connection.country ? h.connection.country.toUpperCase() : "-"}
              />
              <HealthRow
                label="Kártyás fizetés"
                value={h.connection.chargesEnabled ? "aktív" : "nem aktív"}
                good={h.connection.chargesEnabled === true}
                bad={h.connection.chargesEnabled === false}
              />
              <HealthRow
                label="Kifizetések"
                value={h.connection.payoutsEnabled ? "aktív" : "nem aktív"}
                good={h.connection.payoutsEnabled === true}
                bad={h.connection.payoutsEnabled === false}
              />
              <HealthRow
                label="Alap pénznem"
                value={
                  h.connection.defaultCurrency ? h.connection.defaultCurrency.toUpperCase() : "-"
                }
              />
            </div>
          )}

          {/* Hibaüzenet, ha a kulcs megvan, de a ping elhasalt */}
          {status === "error" && h.connection?.error && (
            <p className="mt-3 rounded-lg bg-blush-50 px-3 py-2 font-mono text-xs text-blush-700 dark:bg-blush-500/10 dark:text-blush-200">
              {h.connection.error}
            </p>
          )}

          {/* Mi hiányzik, ha még nincs bekötve */}
          {status === "off" && (
            <p className="mt-3 text-xs text-neutral-500 dark:text-umber-300">
              Bekötéshez állítsd be a Railway-en:{" "}
              <span className="font-mono text-neutral-700 dark:text-paper-100">
                STRIPE_SECRET_KEY
              </span>
              ,{" "}
              <span className="font-mono text-neutral-700 dark:text-paper-100">
                STRIPE_WEBHOOK_SECRET
              </span>
              ,{" "}
              <span className="font-mono text-neutral-700 dark:text-paper-100">
                STRIPE_PRICE_EUR
              </span>
              ,{" "}
              <span className="font-mono text-neutral-700 dark:text-paper-100">
                STRIPE_PRICE_HUF
              </span>
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Egy env-konfiguráció sor pipa/kereszt jelzéssel. */
function ConfigItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-paper-100 px-3 py-2 dark:bg-umber-800/60">
      {ok ? (
        <Check size={15} className="shrink-0 text-sage-600 dark:text-sage-400" aria-hidden="true" />
      ) : (
        <X size={15} className="shrink-0 text-neutral-400 dark:text-umber-300" aria-hidden="true" />
      )}
      <span
        className={`text-xs ${ok ? "text-neutral-700 dark:text-paper-100" : "text-neutral-400 dark:text-umber-300"}`}
      >
        {label}
      </span>
      <span className="sr-only">{ok ? "beállítva" : "hiányzik"}</span>
    </div>
  );
}

function HealthRow({
  label,
  value,
  mono,
  good,
  bad,
}: {
  label: string;
  value: string;
  mono?: boolean;
  good?: boolean;
  bad?: boolean;
}) {
  const valCls = good
    ? "text-sage-700 dark:text-sage-300"
    : bad
      ? "text-blush-600 dark:text-blush-300"
      : "text-neutral-900 dark:text-paper-50";
  return (
    <div className="flex items-center justify-between gap-2 border-b border-paper-200 py-1 dark:border-umber-700">
      <span className="text-neutral-500 dark:text-umber-300">{label}</span>
      <span className={`font-medium ${mono ? "font-mono text-xs" : "tabular-nums"} ${valCls}`}>
        {value}
      </span>
    </div>
  );
}

/** Egy bruttó (ÁFÁ-s) havi előfizetés teljes lebontása: mennyi marad a cégben,
 *  illetve magánszemélyként osztalék után. Két ár egymás mellett (alapból
 *  1 990 és 2 490 Ft) — bármelyik szabadon átírható, a táblázat élőben
 *  újraszámol. A számok HUF-ban; a matek a `subscriptionUnitEconomics`
 *  pure függvényből jön. Tájékoztató becslés, nem adótanácsadás. */
function UnitEconomicsCard({ locale, liveHuf }: { locale: Locale; liveHuf: number }) {
  const [priceA, setPriceA] = useState(990);
  const [priceB, setPriceB] = useState(2490);
  const ea = useMemo(() => subscriptionUnitEconomics(priceA), [priceA]);
  const eb = useMemo(() => subscriptionUnitEconomics(priceB), [priceB]);
  const ft = (n: number) => formatMoney(n, "HUF", locale as "hu" | "en");

  type Kind = "gross" | "deduct" | "subtotal" | "final";
  const rows: Array<{ label: string; kind: Kind; a: number; b: number }> = [
    { label: "Vásárló fizet (bruttó)", kind: "gross", a: ea.grossHuf, b: eb.grossHuf },
    { label: "ÁFA (27%)", kind: "deduct", a: ea.vatHuf, b: eb.vatHuf },
    { label: "Nettó árbevétel", kind: "subtotal", a: ea.netRevenueHuf, b: eb.netRevenueHuf },
    {
      label: "Stripe kártyadíj (1,5% + 85 Ft)",
      kind: "deduct",
      a: ea.stripeCardHuf,
      b: eb.stripeCardHuf,
    },
    {
      label: "Stripe Billing (0,7%)",
      kind: "deduct",
      a: ea.stripeBillingHuf,
      b: eb.stripeBillingHuf,
    },
    {
      label: "Stripe után (adók előtt)",
      kind: "subtotal",
      a: ea.afterStripeHuf,
      b: eb.afterStripeHuf,
    },
    { label: "HIPA (2% nettó árbevétel)", kind: "deduct", a: ea.hipaHuf, b: eb.hipaHuf },
    { label: "TAO (9%)", kind: "deduct", a: ea.taoHuf, b: eb.taoHuf },
    {
      label: "Cégben marad (osztalék előtt)",
      kind: "final",
      a: ea.inCompanyHuf,
      b: eb.inCompanyHuf,
    },
    {
      label: "Osztalékadó (SZJA 15% + szocho 13%)",
      kind: "deduct",
      a: ea.dividendTaxHuf,
      b: eb.dividendTaxHuf,
    },
    { label: "Kézben (osztalék után)", kind: "final", a: ea.inHandHuf, b: eb.inHandHuf },
  ];

  const cell = (n: number, kind: Kind) => (kind === "deduct" ? `− ${ft(n)}` : ft(n));

  return (
    <section className="admin-card mt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-paper-50">
            Egy előfizetés bontása
          </h2>
          <p className="mt-1 max-w-prose text-xs text-neutral-500 dark:text-umber-300">
            Egy bruttó (ÁFÁ-s) havi előfizetésből mennyi marad a cégben, illetve magánszemélyként
            osztalék után. Stripe magyar árlista (EEA kártya 1,5% + 85 Ft, Billing 0,7%) + 2024-es
            magyar adókulcsok. Tájékoztató becslés, nem adótanácsadás — a szocho-felső­korlátot és a
            tényleges költségelszámolást elhanyagolja.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <PriceInput label="Ár A" value={priceA} onChange={setPriceA} />
          <PriceInput label="Ár B" value={priceB} onChange={setPriceB} />
        </div>
      </div>

      {liveHuf > 0 && liveHuf !== priceA && liveHuf !== priceB && (
        <p className="mt-2 text-xs text-neutral-500 dark:text-umber-300">
          Élő HUF listaár jelenleg: {ft(liveHuf)}, írd be valamelyik mezőbe az összevetéshez.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-neutral-500 dark:text-umber-300">
              <th className="py-1 pr-4 text-left font-medium">Tétel</th>
              <th className="py-1 pl-4 text-right font-medium tabular-nums">{ft(priceA)}</th>
              <th className="py-1 pl-4 text-right font-medium tabular-nums">{ft(priceB)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isFinal = r.kind === "final";
              const isSub = r.kind === "subtotal";
              const isDeduct = r.kind === "deduct";
              const rowCls = isFinal
                ? "border-t-2 border-neutral-300 dark:border-umber-600"
                : isSub
                  ? "border-t border-paper-200 dark:border-umber-700"
                  : "";
              const labelCls = isFinal
                ? "font-semibold text-neutral-900 dark:text-paper-50"
                : isDeduct
                  ? "text-neutral-500 dark:text-umber-300"
                  : "text-neutral-700 dark:text-paper-100";
              const valCls = isFinal
                ? "font-semibold text-neutral-900 dark:text-paper-50"
                : isSub
                  ? "font-medium text-neutral-900 dark:text-paper-50"
                  : isDeduct
                    ? "text-neutral-500 dark:text-umber-300"
                    : "text-neutral-800 dark:text-paper-100";
              return (
                <tr key={r.label} className={rowCls}>
                  <td className={`py-1.5 pr-4 ${labelCls}`}>{r.label}</td>
                  <td className={`py-1.5 pl-4 text-right tabular-nums ${valCls}`}>
                    {cell(r.a, r.kind)}
                  </td>
                  <td className={`py-1.5 pl-4 text-right tabular-nums ${valCls}`}>
                    {cell(r.b, r.kind)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ökölszabály: a kézbe kapott összeg a bruttó arányában */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <RuleOfThumb price={priceA} e={ea} ft={ft} />
        <RuleOfThumb price={priceB} e={eb} ft={ft} />
      </div>
    </section>
  );
}

function PriceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-umber-200">
        {label}
      </span>
      <span className="inline-flex items-center rounded-lg border border-paper-200 bg-paper-50 pr-2 focus-within:ring-2 focus-within:ring-neutral-800/40 dark:border-umber-700 dark:bg-umber-800">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          step={100}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          className="w-24 bg-transparent px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-neutral-900 outline-none dark:text-paper-50"
        />
        <span className="text-xs text-neutral-500 dark:text-umber-300">Ft</span>
      </span>
    </label>
  );
}

/** Egysoros ökölszabály-összegzés egy árhoz: a kézbe kapott összeg és aránya. */
function RuleOfThumb({
  price,
  e,
  ft,
}: {
  price: number;
  e: SubscriptionUnitEconomics;
  ft: (n: number) => string;
}) {
  const companyPct = price > 0 ? Math.round((e.inCompanyHuf / price) * 100) : 0;
  const handPct = price > 0 ? Math.round((e.inHandHuf / price) * 100) : 0;
  return (
    <div className="rounded-lg bg-paper-100 px-3 py-2 text-xs text-neutral-600 dark:bg-umber-800/60 dark:text-umber-200">
      <span className="font-semibold text-neutral-900 dark:text-paper-50">{ft(price)}</span> →{" "}
      cégben <span className="font-semibold tabular-nums">{ft(e.inCompanyHuf)}</span> ({companyPct}
      %), kézben <span className="font-semibold tabular-nums">{ft(e.inHandHuf)}</span> ({handPct}%)
    </div>
  );
}

/** Billing go-live control: the global read-only paywall switch. While OFF the
 *  freeze is deferred and nobody is paywalled; the founder turns it on (once the
 *  200-couple cohort fills) to start the payment period. */
function BillingLaunchCard({
  data,
  busy,
  onToggle,
  t,
  locale,
}: {
  data: AdminFinancialPlannerOverview;
  busy: boolean;
  onToggle: (next: boolean) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
}) {
  const on = data.billing_enforcement_on;
  const total = data.total_couples;
  const pct = Math.min(100, Math.round((total / FOUNDING_CAP) * 100));
  const ready = data.enforcement_ready;
  return (
    <section className="admin-card mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-paper-50">
            {on ? <Lock size={15} aria-hidden /> : <LockOpen size={15} aria-hidden />}
            {t("admin.fin_enforce_title")}
            <Pill tone={on ? "blush" : "sage"}>
              {on ? t("admin.fin_enforce_state_on") : t("admin.fin_enforce_state_off")}
            </Pill>
          </h2>
          <p className="mt-1 max-w-prose text-xs text-neutral-500 dark:text-umber-300">
            {on ? t("admin.fin_enforce_note_on") : t("admin.fin_enforce_note_off")}
          </p>
        </div>
        {on ? (
          <button
            type="button"
            onClick={() => onToggle(false)}
            disabled={busy}
            className="btn-ghost btn-sm shrink-0"
          >
            {t("admin.fin_enforce_turn_off")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onToggle(true)}
            disabled={busy || !ready}
            title={
              ready ? undefined : t("admin.fin_enforce_not_ready", { n: total, cap: FOUNDING_CAP })
            }
            className="btn-primary btn-sm shrink-0"
          >
            {t("admin.fin_enforce_go_live")}
          </button>
        )}
      </div>

      {/* 200-pár előrehaladás + go-live jelzés */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-neutral-600 dark:text-umber-200">
            {t("admin.fin_enforce_progress_label")}
          </span>
          <span className="tabular-nums font-semibold text-neutral-900 dark:text-paper-50">
            {new Intl.NumberFormat(intlLocale(locale)).format(total)} /{" "}
            {FOUNDING_CAP}
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-800">
          <div
            className={`h-full rounded-full ${ready ? "bg-sage-500" : "bg-neutral-800/70 dark:bg-neutral-300/60"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {!on && ready && (
          <p className="mt-2 text-sm font-medium text-sage-700 dark:text-sage-300">
            {t("admin.fin_enforce_ready_signal")}
          </p>
        )}
      </div>
    </section>
  );
}

/** Live exchange-rate strip in the home currency (HUF): 1 EUR and 1 USD in
 *  forint. The feed is EUR-based (live market mid, server-fetched), so USD→HUF
 *  is the cross rate (HUF-per-EUR ÷ USD-per-EUR). Renders nothing until the
 *  first successful fetch. */
function FxStrip({ fx }: { fx: FxRates | null }) {
  if (!fx) return null;
  const hufPerEur = fx.rates.HUF;
  const hufPerUsd = fx.rates.USD > 0 ? fx.rates.HUF / fx.rates.USD : 0;
  const ft = (n: number) =>
    `${new Intl.NumberFormat("hu-HU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)} Ft`;
  return (
    <section className="admin-card mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="eyebrow inline-flex items-center gap-1">
        <Banknote size={13} aria-hidden="true" /> Árfolyam
      </span>
      <FxItem
        icon={<Euro size={15} aria-hidden="true" />}
        value={`1 € = ${ft(hufPerEur)}`}
        srLabel={`1 euró = ${ft(hufPerEur)}`}
      />
      <FxItem
        icon={<DollarSign size={15} aria-hidden="true" />}
        value={`1 $ = ${ft(hufPerUsd)}`}
        srLabel={`1 amerikai dollár = ${ft(hufPerUsd)}`}
      />
      <span className="ml-auto text-xs text-neutral-500 dark:text-umber-300">
        élő ·{" "}
        {new Date(fx.as_of).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </section>
  );
}

function FxItem({ icon, value, srLabel }: { icon: ReactNode; value: string; srLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={srLabel}>
      <span className="text-neutral-500 dark:text-umber-300" aria-hidden="true">
        {icon}
      </span>
      <span className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-paper-50">
        {value}
      </span>
    </span>
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
