// Settings → Subscription tab. Shows the couple's current plan + billing
// state and routes to Stripe-hosted Checkout (subscribe) or the Billing Portal
// (manage). All payment UI lives on Stripe; we only mint redirect URLs.
//
// Layout is deliberately loud and short: the plan name is the headline, the
// price is a big figure, and every explanatory sentence that repeated the
// headline was cut. Referrals are two list rows with icon-only actions rather
// than two nested boxes with four labelled buttons.

import { Check, Copy, Share2, Sparkles, Store, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BillingStatusResponse, SubscriptionStatus } from "@shared/billing";
import { useToast } from "../components/ui";
import { billingApi, referralApi, type ReferralStatus } from "../lib/endpoints";
import { formatDateMs, formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";

const PLAN_LABEL_KEY: Record<SubscriptionStatus, `billing.plan_${string}`> = {
  trialing: "billing.plan_trialing",
  founding: "billing.plan_founding",
  active: "billing.plan_active",
  past_due: "billing.plan_past_due",
  canceled: "billing.plan_canceled",
  none: "billing.plan_none",
};

type RefKind = "couple" | "vendor";

export default function BillingSettings() {
  const { t, locale } = useT();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<BillingStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"idle" | "checkout" | "portal">("idle");
  const [referral, setReferral] = useState<ReferralStatus | null>(null);
  const [copiedKey, setCopiedKey] = useState<RefKind | null>(null);

  useEffect(() => {
    billingApi
      .status()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    referralApi
      .get()
      .then(setReferral)
      .catch(() => setReferral(null));
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
    return formatDateMs(ms, locale);
  }

  function linkFor(kind: RefKind): string | undefined {
    return kind === "couple" ? referral?.couple_url : referral?.vendor_url;
  }

  async function copyLink(kind: RefKind) {
    const url = linkFor(kind);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopiedKey(kind);
    toast.success(t("billing.referral_copied"));
    setTimeout(() => setCopiedKey(null), 2000);
  }

  // Native share sheet (WhatsApp / Messenger / email / …). Only offered where
  // the Web Share API exists — mainly mobile; desktop falls back to Copy.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function shareLink(kind: RefKind) {
    const url = linkFor(kind);
    if (!url) return;
    const text =
      kind === "couple"
        ? t("billing.referral_share_couple_text")
        : t("billing.referral_share_vendor_text");
    try {
      await navigator.share({ title: t("billing.referral_title"), text, url });
    } catch {
      // User dismissed the share sheet (AbortError) or it failed — no toast.
    }
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
    return <div className="card mt-6 h-56 animate-pulse bg-paper-100 dark:bg-umber-800" />;
  }
  if (!data) return null;

  const { billing, enabled } = data;
  const status = billing.subscription_status;
  const priceStr = formatMoney(data.price, data.currency, locale);

  // One terse line under the headline. The long `status_*` sentences stay in
  // the read-only banners, where they're the only copy on screen.
  const statusLine = (() => {
    switch (billing.reason) {
      case "trialing":
        return t("billing.status_trialing_short", { date: fmtDate(billing.trial_ends_at) });
      case "founding":
        return t("billing.status_founding_short", { date: fmtDate(billing.founding_until) });
      case "subscribed":
        return status === "past_due"
          ? t("billing.status_past_due_short")
          : t("billing.status_active_short", { date: fmtDate(billing.current_period_end) });
      default:
        return t("billing.status_lapsed_short");
    }
  })();

  const showManage = status === "active" || status === "past_due";
  const showSpots = status !== "founding" && data.founding_spots_left > 0;
  const bonusMonths = referral?.stats.bonus_months ?? 0;

  return (
    <div className="mt-6 space-y-4">
      <section className="card p-5 sm:p-6">
        <p className="eyebrow">{t("billing.plan_label")}</p>
        <h2 className="mt-1 text-2xl sm:text-3xl">{t(PLAN_LABEL_KEY[status])}</h2>
        <p className="mt-1 text-base text-ink-600 dark:text-umber-200">{statusLine}</p>
        {showSpots && (
          <p className="badge-blush mt-3">
            <Sparkles size={13} aria-hidden />
            {t("billing.founding_spots", { n: data.founding_spots_left })}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-paper-200 pt-4 dark:border-umber-700">
          <p className="flex items-baseline gap-1.5">
            <span className="stat-num text-2xl font-semibold text-ink-900 dark:text-paper-50 sm:text-3xl">
              {priceStr}
            </span>
            <span className="text-sm text-ink-500 dark:text-umber-300">
              {t("billing.price_period")}
            </span>
          </p>

          {enabled &&
            (showManage ? (
              <button
                type="button"
                onClick={() => go("portal")}
                disabled={busy !== "idle"}
                className="btn-outline btn-lg w-full sm:ml-auto sm:w-auto"
              >
                {busy === "portal" ? t("billing.opening") : t("billing.manage_cta")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => go("checkout")}
                disabled={busy !== "idle"}
                className="btn-primary btn-lg w-full sm:ml-auto sm:w-auto"
              >
                {busy === "checkout" ? t("billing.opening") : t("billing.subscribe_cta")}
              </button>
            ))}
        </div>

        {!enabled && (
          <p className="mt-4 text-sm text-ink-500 dark:text-umber-300">
            {t("billing.disabled_note")}
          </p>
        )}
      </section>

      {referral && (
        <section className="card p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-ink-900 dark:text-paper-50">
              {t("billing.referral_title")}
            </h3>
            {bonusMonths > 0 && (
              <span className="badge-paper stat-num">
                {t("billing.referral_earned", { months: bonusMonths })}
              </span>
            )}
          </div>

          <div className="mt-5 divide-y divide-paper-200 dark:divide-umber-700">
            <ReferralRow
              icon={<Users size={18} aria-hidden />}
              title={t("billing.referral_couple_title")}
              reward={t("billing.referral_couple_reward")}
              copyLabel={t("billing.referral_couple_cta")}
              shareLabel={t("billing.referral_share")}
              copied={copiedKey === "couple"}
              canShare={canShare}
              onShare={() => shareLink("couple")}
              onCopy={() => copyLink("couple")}
            />
            <ReferralRow
              icon={<Store size={18} aria-hidden />}
              title={t("billing.referral_vendor_title")}
              reward={t("billing.referral_vendor_reward")}
              copyLabel={t("billing.referral_vendor_cta")}
              shareLabel={t("billing.referral_share")}
              copied={copiedKey === "vendor"}
              canShare={canShare}
              onShare={() => shareLink("vendor")}
              onCopy={() => copyLink("vendor")}
            />
          </div>
        </section>
      )}
    </div>
  );
}

/** One referral link as a list row: mark, name, reward, actions. The action
 *  buttons are icon-only (44px tap targets) with their label on the tooltip +
 *  aria-label; the leading action carries the solid fill, so desktop — where
 *  the Web Share API is missing — still has one obvious button. */
function ReferralRow(props: {
  icon: React.ReactNode;
  title: string;
  reward: string;
  copyLabel: string;
  shareLabel: string;
  copied: boolean;
  canShare: boolean;
  onShare: () => void;
  onCopy: () => void;
}) {
  const solid =
    "bg-umber-900 text-paper-100 hover:bg-umber-950 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-50";
  const ghost =
    "border border-paper-300 text-ink-700 hover:bg-paper-100 dark:border-umber-600 dark:text-paper-100 dark:hover:bg-umber-700";
  const base =
    "grid h-tap w-tap shrink-0 place-items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2";

  return (
    <div className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper-100 text-ink-700 dark:bg-umber-700 dark:text-paper-100">
        {props.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink-900 dark:text-paper-50">{props.title}</p>
        <p className="text-sm text-ink-500 dark:text-umber-300">{props.reward}</p>
      </div>
      {props.canShare && (
        <button
          type="button"
          onClick={props.onShare}
          title={props.shareLabel}
          aria-label={props.shareLabel}
          className={`${base} ${solid}`}
        >
          <Share2 size={16} aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={props.onCopy}
        title={props.copyLabel}
        aria-label={props.copyLabel}
        className={`${base} ${props.canShare ? ghost : solid}`}
      >
        {props.copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      </button>
    </div>
  );
}
