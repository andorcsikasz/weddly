// Vendor billing — the plan + subscription surface at /vendor/billing inside
// VendorShell. Reads the canonical vendorBillingApi.get() snapshot (billing +
// derived FREE/PRO plan + per-feature flag map) and renders: the current plan
// badge, the subscription status with its dates (founding / trial / live /
// hidden), a FREE-vs-PRO feature comparison with checkmarks and locks, and an
// upgrade CTA. Vendor Stripe checkout is NOT wired, so the CTA does not fake a
// payment flow — it explains how to upgrade and points the vendor at support.

import { Check, Crown, Lock, Mail, RefreshCw, Sparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { VendorBilling } from "@shared/vendor_billing";
import type { VendorFeature, VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import { vendorBillingApi } from "../../lib/endpoints";
import { formatDateMs } from "../../lib/format";
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
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl italic text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.billing.page_title")}
        </h1>
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.billing.page_body")}</p>
      </header>

      {/* Current plan + subscription status */}
      <section className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
              {t("vendor.billing.current_plan")}
            </span>
            <span className="text-2xl font-semibold text-ink-900 dark:text-paper-50">
              {t(isPro ? "vendor.plan.pro_label" : "vendor.plan.free_label")}
            </span>
          </div>
          <PlanBadge
            isPro={isPro}
            label={t(isPro ? "vendor.plan.pro_badge" : "vendor.plan.free_badge")}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-paper-200 pt-4 dark:border-umber-700">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
              {t("vendor.billing.status_label")}
            </span>
            <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
              {t(billing.entitled ? "vendor.billing.entitled_yes" : "vendor.billing.entitled_no")}
            </span>
          </div>
          {statusDateLine && (
            <p className="text-sm text-ink-600 dark:text-paper-300">{statusDateLine}</p>
          )}
        </div>
      </section>

      {/* Feature comparison */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FeatureColumn
          title={t("vendor.plan.free_label")}
          subtitle={t("vendor.plan.free_badge")}
          accent={false}
        >
          {FREE_FEATURE_LABELS.map((labelKey) => (
            <FeatureRow key={labelKey} label={t(labelKey)} unlocked />
          ))}
        </FeatureColumn>

        <FeatureColumn
          title={t("vendor.plan.pro_label")}
          subtitle={t("vendor.plan.pro_badge")}
          accent
        >
          {PRO_FEATURES.map(({ feature, label }) => (
            <FeatureRow key={feature} label={t(label)} unlocked={features[feature]} />
          ))}
        </FeatureColumn>
      </section>

      {/* Upgrade CTA — checkout is not wired, so we point the vendor at support
          rather than faking a payment flow. PRO vendors see the manage line. */}
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
        <section className="flex flex-col gap-4 rounded-2xl border border-blush-200 bg-blush-50 p-5 dark:border-blush-400/30 dark:bg-blush-400/10">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush-200 text-ink-900 dark:bg-blush-400/20 dark:text-paper-50">
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                {t("vendor.upgrade.title")}
              </p>
              <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.upgrade.body")}</p>
            </div>
          </div>
          <p className="text-sm text-ink-600 dark:text-paper-300">
            {t("vendor.billing.checkout_unavailable")}
          </p>
          <a
            href={`mailto:${contactEmail}`}
            className="btn-primary inline-flex w-fit items-center gap-2"
          >
            <Mail size={16} aria-hidden="true" />
            <span>{t("vendor.upgrade.cta")}</span>
          </a>
        </section>
      )}
    </div>
  );
}

function PlanBadge({ isPro, label }: { isPro: boolean; label: string }) {
  return (
    <span
      className={
        isPro
          ? "inline-flex items-center gap-1.5 rounded-full bg-blush-200 px-3 py-1 text-xs font-semibold text-ink-900 dark:bg-blush-400/20 dark:text-paper-50"
          : "inline-flex items-center gap-1.5 rounded-full bg-paper-200 px-3 py-1 text-xs font-semibold text-ink-700 dark:bg-umber-800 dark:text-paper-200"
      }
    >
      {isPro ? <Crown size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}

function FeatureColumn({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        accent
          ? "flex flex-col gap-3 rounded-2xl border border-blush-200 bg-paper-50 p-5 dark:border-blush-400/30 dark:bg-umber-900"
          : "flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900"
      }
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-ink-900 dark:text-paper-50">{title}</span>
        <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-paper-400">
          {subtitle}
        </span>
      </div>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  );
}

function FeatureRow({ label, unlocked }: { label: string; unlocked: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      {unlocked ? (
        <Check size={16} aria-hidden="true" className="shrink-0 text-blush-500" />
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
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="font-serif text-2xl italic text-ink-900 sm:text-3xl dark:text-paper-50">
        {title}
      </h1>
      <div className="h-32 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-48 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800" />
        <div className="h-48 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800" />
      </div>
      <div className="h-28 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800" />
    </div>
  );
}
