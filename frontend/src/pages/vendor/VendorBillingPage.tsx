// Vendor billing — the plan + subscription surface at /vendor/billing inside
// VendorShell. Reads the canonical vendorBillingApi.get() snapshot (billing +
// derived FREE/PRO plan + per-feature flag map) and renders: the current plan
// badge, the subscription status with its dates (founding / trial / live /
// hidden), a proper FREE-vs-PRO pricing comparison with the Pro monthly price
// and a "you are here" marker on the active plan, a calm payment-milestone
// pill, an intentionally empty invoice history table, and an upgrade CTA.
// Vendor Stripe checkout is NOT wired, so the CTA does not fake a payment flow
// - it stays disabled with the coming-soon note and points the vendor at
// support.

import { Check, Crown, Lock, Mail, RefreshCw, Sparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { VENDOR_MONTHLY_PRICE, type VendorBilling } from "@shared/vendor_billing";
import type { VendorFeature, VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import { Skeleton } from "../../components/ui";
import { vendorBillingApi } from "../../lib/endpoints";
import { formatDateMs, formatMoney } from "../../lib/format";
import { useT } from "../../lib/i18n";

type TKey = Parameters<ReturnType<typeof useT>["t"]>[0];

// FREE-tier capabilities — always available, listed so the vendor sees what
// they keep on the free plan. Labels reuse the existing vendor.* namespace.
const FREE_FEATURE_LABELS: TKey[] = [
  "vendor.nav.listing",
  "vendor.dashboard.inquiries_total",
  "vendor.clients.page_title",
];

// PRO-tier capabilities, keyed by the shared VendorFeature union so the lock /
// check state reads straight off the server's feature flag map.
const PRO_FEATURES: { feature: VendorFeature; label: TKey }[] = [
  { feature: "client_crm_detail", label: "vendor.clients.detail_title" },
  { feature: "payment_tracking", label: "vendor.payments.title" },
  { feature: "advanced_stats", label: "vendor.stats.page_title" },
  { feature: "response_workflow", label: "vendor.clients.status_label" },
];

export default function VendorBillingPage() {
  const { t, locale } = useT();

  const [billing, setBilling] = useState<VendorBilling | null>(null);
  const [plan, setPlan] = useState<VendorPlan | null>(null);
  const [features, setFeatures] = useState<VendorFeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await vendorBillingApi.get();
      setBilling(res.billing);
      setPlan(res.plan);
      setFeatures(res.features);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <BillingSkeleton title={t("vendor.billing.page_title")} />;
  }

  if (errored || !billing || !plan || !features) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-10 text-center dark:border-umber-700 dark:bg-umber-900">
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("common.error_generic")}</p>
        <button type="button" onClick={() => void load()} className="btn-ghost">
          <RefreshCw size={16} aria-hidden="true" />
          <span>{t("error_boundary.try_again")}</span>
        </button>
      </div>
    );
  }

  const isPro = plan === "pro";
  const contactEmail = t("about.paragraph_contact_email");
  const priceLabel = `${formatMoney(VENDOR_MONTHLY_PRICE[billing.currency], billing.currency, locale)}${t("vendor.billing.per_month")}`;

  // Status date line — show the most specific window the vendor is in. A
  // founding member's free-until date wins; a trialing vendor sees the trial
  // end; otherwise we fall back to the live / hidden entitlement line only.
  let statusDateLine: string | null = null;
  if (billing.is_founding_member && billing.founding_until != null) {
    statusDateLine = t("vendor.billing.founding_until", {
      date: formatDateMs(billing.founding_until, locale),
    });
  } else if (billing.subscription_status === "trialing" && billing.trial_ends_at != null) {
    statusDateLine = t("vendor.billing.trial_until", {
      date: formatDateMs(billing.trial_ends_at, locale),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.billing.page_title")}
        </h1>
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.billing.page_body")}</p>
      </header>

      {/* Current plan badge + entitlement window. The plan NAME lives on the
          pricing cards below (badge + "you are here"), so this row stays compact
          and only carries the badge plus the entitlement / free-until line. */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
            {t("vendor.billing.current_plan")}
          </span>
          <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
            {t(billing.entitled ? "vendor.billing.entitled_yes" : "vendor.billing.entitled_no")}
          </span>
          {statusDateLine && (
            <p className="text-sm text-ink-600 dark:text-paper-300">{statusDateLine}</p>
          )}
        </div>
        <PlanBadge
          isPro={isPro}
          label={t(isPro ? "vendor.plan.pro_badge" : "vendor.plan.free_badge")}
        />
      </section>

      {/* Pricing - feature-by-feature Free vs Pro with the Pro monthly price and
          a "you are here" marker on the vendor's active plan. */}
      <section className="flex flex-col gap-4">
        <h2 className="font-grotesk text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          {t("vendor.billing.compare_title")}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PlanColumn
            title={t("vendor.plan.free_label")}
            subtitle={t("vendor.plan.free_badge")}
            price={t("vendor.billing.free_price")}
            accent={false}
            active={!isPro}
            youAreHere={t("vendor.billing.you_are_here")}
          >
            {FREE_FEATURE_LABELS.map((labelKey) => (
              <FeatureRow key={labelKey} label={t(labelKey)} unlocked />
            ))}
          </PlanColumn>

          <PlanColumn
            title={t("vendor.plan.pro_label")}
            subtitle={t("vendor.plan.pro_badge")}
            price={priceLabel}
            accent
            active={isPro}
            youAreHere={t("vendor.billing.you_are_here")}
          >
            {PRO_FEATURES.map(({ feature, label }) => (
              <FeatureRow key={feature} label={t(label)} unlocked={features[feature]} />
            ))}
          </PlanColumn>
        </div>
      </section>

      {/* Payment milestone - calm, non-alarming pill. Online checkout is not
          wired; this sets the expectation without faking a portal. */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-steel-200 bg-steel-50 p-4 dark:border-steel-600/30 dark:bg-steel-600/15">
        <Mail
          size={18}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-steel-700 dark:text-steel-300"
        />
        <p className="text-sm text-ink-700 dark:text-paper-200">
          {t("vendor.billing.payment_portal_note")}
        </p>
      </div>

      {/* Upgrade CTA - checkout is not wired, so the action stays disabled with
          the coming-soon note and a support mailto. PRO vendors see the manage
          placeholder instead. */}
      {isPro ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
          <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
            {t("vendor.billing.manage")}
          </p>
          <p className="text-sm text-ink-600 dark:text-paper-300">
            {t("vendor.billing.checkout_unavailable")}
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-4 rounded-2xl border border-steel-200 bg-steel-50 p-5 dark:border-steel-600/30 dark:bg-steel-600/15">
          <div className="flex items-start gap-3">
            <Sparkles
              size={20}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-steel-700 dark:text-steel-300"
            />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                {t("vendor.upgrade.title")}
              </p>
              <p className="text-sm text-ink-600 dark:text-paper-300">
                {t("vendor.billing.upgrade_value")}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900 dark:text-paper-50">
                {priceLabel}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="btn w-fit bg-steel-600 text-white hover:bg-steel-700 opacity-60"
            >
              <Crown size={16} aria-hidden="true" />
              <span>{t("vendor.billing.upgrade_cta")}</span>
            </button>
            <a
              href={`mailto:${contactEmail}`}
              className="btn-ghost inline-flex w-fit items-center gap-2"
            >
              <Mail size={16} aria-hidden="true" />
              <span>{t("vendor.upgrade.cta")}</span>
            </a>
          </div>
          <p className="text-sm text-ink-600 dark:text-paper-300">
            {t("vendor.billing.checkout_unavailable")}
          </p>
        </section>
      )}

      {/* Invoice history - intentionally empty until billing goes live, shown
          so the vendor knows where receipts will appear. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("vendor.billing.invoice_history_title")}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead>
              <tr className="border-b border-paper-200 text-xs font-medium uppercase tracking-wide text-ink-500 dark:border-umber-700 dark:text-paper-400">
                <th className="py-2 pr-4 font-medium">{t("vendor.billing.invoice_col_date")}</th>
                <th className="py-2 pr-4 font-medium">{t("vendor.billing.invoice_col_amount")}</th>
                <th className="py-2 pr-4 font-medium">{t("vendor.billing.invoice_col_status")}</th>
                <th className="py-2 font-medium">{t("vendor.billing.invoice_col_download")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={4}
                  className="py-6 text-center text-sm text-ink-500 dark:text-paper-400"
                >
                  {t("vendor.billing.invoice_empty")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PlanBadge({ isPro, label }: { isPro: boolean; label: string }) {
  return (
    <span
      className={
        isPro
          ? "inline-flex items-center gap-1.5 rounded-full bg-steel-600 px-3 py-1 text-xs font-semibold text-white dark:bg-steel-600"
          : "inline-flex items-center gap-1.5 rounded-full bg-paper-200 px-3 py-1 text-xs font-semibold text-ink-700 dark:bg-umber-800 dark:text-paper-200"
      }
    >
      {isPro ? <Crown size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}

function PlanColumn({
  title,
  subtitle,
  price,
  accent,
  active,
  youAreHere,
  children,
}: {
  title: string;
  subtitle: string;
  price: string;
  accent: boolean;
  active: boolean;
  youAreHere: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        accent
          ? "flex flex-col gap-3 rounded-2xl border border-steel-200 bg-paper-50 p-5 dark:border-steel-600/40 dark:bg-umber-900"
          : "flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink-900 dark:text-paper-50">{title}</span>
          <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-paper-400">
            {subtitle}
          </span>
        </div>
        {active && (
          <span className="inline-flex items-center gap-1 rounded-full bg-steel-600 px-2.5 py-1 text-xs font-semibold text-white">
            <Check size={12} aria-hidden="true" />
            <span>{youAreHere}</span>
          </span>
        )}
      </div>
      <p className="text-xl font-semibold text-ink-900 dark:text-paper-50">{price}</p>
      <ul className="flex flex-col gap-2 border-t border-paper-200 pt-3 dark:border-umber-700">
        {children}
      </ul>
    </div>
  );
}

function FeatureRow({ label, unlocked }: { label: string; unlocked: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      {unlocked ? (
        <Check size={16} aria-hidden="true" className="shrink-0 text-sage-600 dark:text-sage-300" />
      ) : (
        <Lock size={16} aria-hidden="true" className="shrink-0 text-ink-400 dark:text-paper-500" />
      )}
      <span
        className={
          unlocked ? "text-ink-900 dark:text-paper-50" : "text-ink-500 dark:text-paper-400"
        }
      >
        {label}
      </span>
    </li>
  );
}

function BillingSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
        {title}
      </h1>
      <Skeleton height={128} rounded="2xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton height={208} rounded="2xl" />
        <Skeleton height={208} rounded="2xl" />
      </div>
      <Skeleton height={64} rounded="2xl" />
      <Skeleton height={112} rounded="2xl" />
      <Skeleton height={160} rounded="2xl" />
    </div>
  );
}
