// Settings → Subscription tab. Shows the couple's current plan + billing
// state and routes to Stripe-hosted Checkout (subscribe) or the Billing Portal
// (manage). All payment UI lives on Stripe; we only mint redirect URLs.

import { CreditCard, ExternalLink, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BillingStatusResponse, SubscriptionStatus } from "@shared/billing";
import { useToast } from "../components/ui";
import { billingApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";

const PLAN_LABEL_KEY: Record<SubscriptionStatus, `billing.plan_${string}`> = {
  trialing: "billing.plan_trialing",
  founding: "billing.plan_founding",
  active: "billing.plan_active",
  past_due: "billing.plan_past_due",
  canceled: "billing.plan_canceled",
  none: "billing.plan_none",
};

export default function BillingSettings() {
  const { t, locale } = useT();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<BillingStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"idle" | "checkout" | "portal">("idle");

  useEffect(() => {
    billingApi
      .status()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  // Surface the Checkout return state once, then strip the query param so a
  // refresh doesn't re-toast.
  useEffect(() => {
    const checkout = params.get("checkout");
    if (checkout === "success") toast.success(t("billing.status_active"));
    if (checkout === "success" || checkout === "cancel") {
      params.delete("checkout");
      setParams(params, { replace: true });
    }
  }, [params, setParams, t, toast]);

  function fmtDate(ms: number | null): string {
    if (!ms) return "";
    return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(ms));
  }

  async function go(kind: "checkout" | "portal") {
    setBusy(kind);
    try {
      const { url } = kind === "checkout" ? await billingApi.checkout() : await billingApi.portal();
      window.location.href = url;
    } catch {
      toast.error(t("billing.error_generic"));
      setBusy("idle");
    }
  }

  if (loading) {
    return <div className="card mt-6 h-40 animate-pulse bg-paper-100 dark:bg-umber-800" />;
  }
  if (!data) return null;

  const { billing, enabled } = data;
  const status = billing.subscription_status;
  const priceStr = formatMoney(data.price, data.currency, locale);

  const statusBody = (() => {
    switch (billing.reason) {
      case "trialing":
        return t("billing.status_trialing", { date: fmtDate(billing.trial_ends_at) });
      case "founding":
        return t("billing.status_founding", { date: fmtDate(billing.founding_until) });
      case "subscribed":
        return status === "past_due"
          ? t("billing.status_past_due")
          : t("billing.status_active", { date: fmtDate(billing.current_period_end) });
      default:
        return t("billing.status_lapsed");
    }
  })();

  const showManage = status === "active" || status === "past_due";
  const showSubscribe = !showManage;

  return (
    <section className="card mt-6">
      <h2 className="flex items-center gap-2 text-lg">
        <CreditCard size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
        {t("billing.title")}
      </h2>
      <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">{t("billing.subtitle")}</p>

      <div className="mt-5 rounded-xl border border-paper-200 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900/40">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500 dark:text-umber-300">
            {t("billing.plan_label")}
          </span>
          <span className="font-medium text-ink-900 dark:text-paper-50">
            {t(PLAN_LABEL_KEY[status])}
          </span>
        </div>
        <p className="mt-3 text-sm text-ink-700 dark:text-paper-100">{statusBody}</p>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
          {t("billing.price_line", { price: priceStr })}
        </p>
        {billing.subscription_status !== "founding" && data.founding_spots_left > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-blush-700 dark:text-blush-300">
            <Sparkles size={14} aria-hidden />
            {t("billing.founding_spots", { n: data.founding_spots_left })}
          </p>
        )}
      </div>

      {enabled ? (
        <div className="mt-5 flex flex-wrap gap-3">
          {showSubscribe && (
            <button
              type="button"
              onClick={() => go("checkout")}
              disabled={busy !== "idle"}
              className="btn-primary btn-md"
            >
              {busy === "checkout" ? t("billing.opening") : t("billing.subscribe_cta")}
            </button>
          )}
          {showManage && (
            <button
              type="button"
              onClick={() => go("portal")}
              disabled={busy !== "idle"}
              className="btn-outline btn-md inline-flex items-center gap-1.5"
            >
              {busy === "portal" ? t("billing.opening") : t("billing.manage_cta")}
              <ExternalLink size={14} aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <p className="mt-5 text-sm text-ink-500 dark:text-umber-300">
          {t("billing.disabled_note")}
        </p>
      )}
    </section>
  );
}
