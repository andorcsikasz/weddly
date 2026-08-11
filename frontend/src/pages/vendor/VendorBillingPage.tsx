// Vendor billing: the plan + subscription surface at /vendor/billing inside
// VendorShell. Reads the canonical vendorBillingApi.get() snapshot (billing +
// derived FREE/PRO plan + per-feature flag map) and renders the freemium
// lifecycle:
//
//   3-day free tryout → "add your card" (Stripe setup Checkout, no charge) →
//   lead window (first 3 direct inquiries free, meter shown) → first payment
//   on the 1st of the month after the 3rd inquiry → live subscription
//   (Stripe Billing Portal for card / cancel management).
//
// Stripe configuration and new-checkout availability are intentionally
// separate. Pausing launch blocks new setup/subscribe flows, while existing
// customers keep the hosted portal for card, invoice and cancel management.

import { Check, CreditCard, Crown, Download, Lock, Mail, RefreshCw, Sparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type VendorBilling, type VendorBillingDetails, vendorPrice } from "@shared/vendor_billing";
import type { VendorFeature, VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import { Skeleton } from "../../components/ui";
import { vendorBillingApi } from "../../lib/endpoints";
import { formatDateMs, formatMoney, intlLocale } from "../../lib/format";
import { type Locale, useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

type TKey = Parameters<ReturnType<typeof useT>["t"]>[0];

// FREE-tier capabilities: always available, listed so the vendor sees what
// they keep on the free plan. Labels reuse the existing vendor.* namespace.
const FREE_FEATURE_LABELS: TKey[] = [
  "vendor.nav.listing",
  "vendor.dashboard.inquiries_total",
  "vendor.clients.page_title",
];

// PRO-tier capabilities, keyed by the shared VendorFeature union so the lock /
// check state reads straight off the server's feature flag map.
const PRO_FEATURES: { feature: VendorFeature; label: TKey }[] = [
  { feature: "direct_messages", label: "vendor.billing.feature_direct_messages" },
  { feature: "calendar_availability", label: "vendor.billing.feature_calendar" },
  { feature: "client_crm_detail", label: "vendor.clients.detail_title" },
  { feature: "payment_tracking", label: "vendor.payments.title" },
  { feature: "advanced_stats", label: "vendor.stats.page_title" },
  { feature: "response_workflow", label: "vendor.clients.status_label" },
];

type MoneyAction = "setup" | "checkout" | "portal";

/** Stripe invoice charge amounts use the currency's minor unit. HUF is a
 * two-decimal charge currency (its zero-decimal special case applies only to
 * payouts), so a 2 490 Ft invoice arrives as 249000 and must be divided by
 * 100. Only true zero-decimal charge currencies belong here. */
const ZERO_DECIMAL = new Set(["jpy", "krw"]);

export function formatInvoiceAmount(amount: number, currency: string, locale: Locale): string {
  const major = ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100;
  // `intlLocale`, not an inline ternary: a hand-written hu/es/else chain silently
  // hands every locale added afterwards the en-US number format, which is how a
  // German vendor would read their own invoices in US grouping.
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : 2,
  }).format(major);
}

/** Stripe's invoice statuses, collapsed to the four we have copy for. */
function invoiceStatusKey(status: string): "paid" | "open" | "void" | "draft" {
  if (status === "paid") return "paid";
  if (status === "open" || status === "uncollectible") return "open";
  if (status === "void") return "void";
  return "draft";
}

export default function VendorBillingPage() {
  const { t, locale } = useT();
  useDocumentTitle(t("vendor.billing.page_title"));
  const [searchParams] = useSearchParams();
  const setupJustCompleted = searchParams.get("setup") === "success";

  const [billing, setBilling] = useState<VendorBilling | null>(null);
  const [plan, setPlan] = useState<VendorPlan | null>(null);
  const [features, setFeatures] = useState<VendorFeatureFlags | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [busyAction, setBusyAction] = useState<MoneyAction | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  // Card + invoices, read from Stripe. Best-effort and separate from the status
  // fetch: a Stripe hiccup drops these two sections, it doesn't cost the vendor
  // their plan page.
  const [details, setDetails] = useState<VendorBillingDetails | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await vendorBillingApi.get();
      setBilling(res.billing);
      setPlan(res.plan);
      setFeatures(res.features);
      setEnabled(res.enabled);
      setCheckoutEnabled(res.checkout_enabled);
      vendorBillingApi
        .details()
        .then(setDetails)
        .catch(() => setDetails(null));
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Kick off a Stripe-hosted flow: mint the redirect URL, then leave. The
   *  busy flag stays on until navigation (or flips off with the error note). */
  const startMoneyAction = useCallback(async (action: MoneyAction) => {
    setBusyAction(action);
    setActionFailed(false);
    try {
      const { url } =
        action === "setup"
          ? await vendorBillingApi.setup()
          : action === "checkout"
            ? await vendorBillingApi.checkout()
            : await vendorBillingApi.portal();
      window.location.href = url;
    } catch {
      setActionFailed(true);
      setBusyAction(null);
    }
  }, []);

  if (loading) {
    return <BillingSkeleton title={t("vendor.billing.page_title")} />;
  }

  if (errored || !billing || !plan || !features) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-10 text-center dark:border-umber-600 dark:bg-umber-900">
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("common.error_generic")}</p>
        <button type="button" onClick={() => void load()} className="btn-ghost">
          <RefreshCw size={16} aria-hidden="true" />
          <span>{t("error_boundary.try_again")}</span>
        </button>
      </div>
    );
  }

  const isPro = plan === "pro";
  const status = billing.subscription_status;
  const contactEmail = t("about.paragraph_contact_email");
  const priceLabel = `${formatMoney(vendorPrice(billing.currency), billing.currency, locale)}${t("vendor.billing.per_month")}`;

  // Status date line: show the most specific window the vendor is in.
  let statusDateLine: string | null = null;
  if (billing.is_founding_member && billing.founding_until != null) {
    statusDateLine = t("vendor.billing.founding_until", {
      date: formatDateMs(billing.founding_until, locale),
    });
  } else if (status === "trialing" && billing.trial_ends_at != null && billing.entitled) {
    statusDateLine = t("vendor.billing.trial_until", {
      date: formatDateMs(billing.trial_ends_at, locale),
    });
  } else if (status === "lead_window" && billing.billing_starts_at != null) {
    statusDateLine = t("vendor.billing.billing_starts_line", {
      total: String(billing.lead_credits_total),
      date: formatDateMs(billing.billing_starts_at, locale),
    });
  } else if ((status === "active" || status === "past_due") && billing.current_period_end != null) {
    statusDateLine = t("vendor.billing.next_payment_line", {
      date: formatDateMs(billing.current_period_end, locale),
    });
  } else if (billing.reason === "trial_expired") {
    statusDateLine = t("vendor.billing.trial_expired_line");
  } else if (billing.reason === "leads_exhausted") {
    statusDateLine = t("vendor.billing.leads_exhausted_line");
  }

  // Which money action moves this vendor forward? Card wall for the no-card
  // states (trial running or expired), classic re-subscribe for lapsed paid /
  // exhausted states, portal for everyone already on a Stripe record.
  const showAddCard =
    checkoutEnabled && !billing.card_on_file && (status === "trialing" || status === "none");
  const showResubscribe =
    checkoutEnabled &&
    !billing.entitled &&
    (status === "canceled" || billing.reason === "leads_exhausted");
  const showPortal =
    enabled && (status === "lead_window" || status === "active" || status === "past_due");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.billing.page_title")}
        </h1>
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.billing.page_body")}</p>
      </header>

      {/* Returning from a successful setup Checkout: the webhook usually beats
          the redirect, but be honest when it hasn't landed yet. */}
      {setupJustCompleted && !billing.card_on_file && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-sage-300 bg-sage-50 p-4 dark:border-sage-600/40 dark:bg-sage-600/15">
          <Check
            size={18}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-sage-700 dark:text-sage-300"
          />
          <p className="text-sm text-ink-700 dark:text-paper-200">
            {t("vendor.billing.setup_success_note")}
          </p>
        </div>
      )}

      {/* Current plan badge + entitlement window. */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-600 dark:bg-umber-900">
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
          {status === "past_due" && (
            <p className="text-sm text-blush-700 dark:text-blush-300">
              {t("vendor.billing.past_due_line")}
            </p>
          )}
        </div>
        <PlanBadge
          isPro={isPro}
          label={t(isPro ? "vendor.plan.pro_badge" : "vendor.plan.free_badge")}
        />
      </section>

      {/* Lead window meter: how many of the free inquiries have been
          delivered, and when the first payment lands once they're spent. */}
      {status === "lead_window" && (
        <section className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-100 p-5 dark:border-umber-700 dark:bg-blush-500/15">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
              {t("vendor.billing.lead_meter_title")}
            </p>
            <span className="text-sm font-semibold text-ink-900 dark:text-paper-50">
              {t("vendor.billing.lead_meter_count", {
                used: String(billing.lead_credits_used),
                total: String(billing.lead_credits_total),
              })}
            </span>
          </div>
          <LeadMeter used={billing.lead_credits_used} total={billing.lead_credits_total} />
          <p className="text-sm text-ink-600 dark:text-paper-300">
            {billing.billing_starts_at != null
              ? t("vendor.billing.billing_starts_line", {
                  total: String(billing.lead_credits_total),
                  date: formatDateMs(billing.billing_starts_at, locale),
                })
              : t("vendor.billing.lead_window_line", {
                  total: String(billing.lead_credits_total),
                })}
          </p>
        </section>
      )}

      {/* Card wall: trial running or just expired, no card yet. The single
          most important CTA on this page. */}
      {showAddCard && (
        <section className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-100 p-5 dark:border-umber-700 dark:bg-blush-500/15">
          <div className="flex items-start gap-3">
            <CreditCard
              size={20}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-ink-400 dark:text-paper-400"
            />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                {t("vendor.billing.add_card_title")}
              </p>
              <p className="text-sm text-ink-600 dark:text-paper-300">
                {t("vendor.billing.add_card_body", {
                  total: String(billing.lead_credits_total),
                })}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900 dark:text-paper-50">
                {priceLabel}
              </p>
            </div>
          </div>
          <MoneyButton
            label={t("vendor.billing.add_card_cta")}
            busyLabel={t("vendor.billing.redirecting")}
            busy={busyAction === "setup"}
            disabled={busyAction !== null}
            onClick={() => void startMoneyAction("setup")}
          />
          {actionFailed && (
            <p className="text-sm text-blush-700 dark:text-blush-300">
              {t("vendor.billing.action_failed")}
            </p>
          )}
        </section>
      )}

      {/* Recovery: canceled subscription or exhausted free leads without a
          successful payment: classic subscribe-now Checkout. */}
      {showResubscribe && (
        <section className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-100 p-5 dark:border-umber-700 dark:bg-blush-500/15">
          <div className="flex items-start gap-3">
            <Sparkles
              size={20}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-ink-400 dark:text-paper-400"
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
          <MoneyButton
            label={t("vendor.billing.subscribe_cta")}
            busyLabel={t("vendor.billing.redirecting")}
            busy={busyAction === "checkout"}
            disabled={busyAction !== null}
            onClick={() => void startMoneyAction("checkout")}
          />
          {actionFailed && (
            <p className="text-sm text-blush-700 dark:text-blush-300">
              {t("vendor.billing.action_failed")}
            </p>
          )}
        </section>
      )}

      {/* Pricing - feature-by-feature Free vs Pro with the Pro monthly price
          and a "you are here" marker on the vendor's active plan. */}
      <section className="flex flex-col gap-4">
        <h2 className="font-grotesk text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          {t("vendor.billing.compare_title")}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PlanColumn
            title={t("vendor.plan.free_label")}
            subtitle={t("vendor.plan.free_badge")}
            price={`${formatMoney(0, billing.currency, locale)}${t("vendor.billing.per_month")}`}
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
            footer={
              !isPro ? (
                checkoutEnabled ? (
                  <MoneyButton
                    label={t(
                      showResubscribe
                        ? "vendor.billing.subscribe_cta"
                        : "vendor.billing.add_card_cta",
                    )}
                    busyLabel={t("vendor.billing.redirecting")}
                    busy={busyAction === (showResubscribe ? "checkout" : "setup")}
                    disabled={busyAction !== null}
                    fullWidth
                    onClick={() => void startMoneyAction(showResubscribe ? "checkout" : "setup")}
                  />
                ) : (
                  // Billing not wired server-side: honest support mailto.
                  <a
                    href={`mailto:${contactEmail}?subject=${encodeURIComponent(t("vendor.billing.upgrade_cta"))}`}
                    className="btn w-full justify-center bg-blush-500 text-white hover:bg-blush-600"
                  >
                    <Crown size={16} aria-hidden="true" />
                    <span>{t("vendor.billing.upgrade_cta")}</span>
                  </a>
                )
              ) : null
            }
          >
            {PRO_FEATURES.map(({ feature, label }) => (
              <FeatureRow key={feature} label={t(label)} unlocked={features[feature]} />
            ))}
          </PlanColumn>
        </div>
      </section>

      {/* Payment method + history. Only for a vendor Stripe actually knows: a
          founding member who never reached checkout has no card and no
          invoices, and an empty "no card on file" panel would read as a
          missing setup step rather than as their free year. */}
      {details?.billing_active && (
        <section className="flex flex-col gap-4">
          <h2 className="font-grotesk text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
            {t("vendor.billing.payment_title")}
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900">
            {details.card ? (
              <p className="flex items-center gap-2.5 text-sm text-ink-900 dark:text-paper-50">
                <CreditCard
                  size={18}
                  aria-hidden="true"
                  className="text-ink-400 dark:text-umber-300"
                />
                {/* Brand + last four is everything we are allowed to show, and
                    everything a vendor needs to recognise the card. */}
                <span className="font-medium capitalize">{details.card.brand}</span>
                <span className="font-mono">•••• {details.card.last4}</span>
                <span className="text-ink-500 tabular-nums dark:text-umber-300">
                  {String(details.card.exp_month).padStart(2, "0")}/{details.card.exp_year % 100}
                </span>
              </p>
            ) : (
              <p className="text-sm text-ink-600 dark:text-paper-300">
                {t("vendor.billing.payment_none")}
              </p>
            )}
            <button
              type="button"
              onClick={() => void startMoneyAction("portal")}
              disabled={busyAction !== null}
              className="btn-ghost inline-flex w-fit items-center gap-2"
            >
              <CreditCard size={16} aria-hidden="true" />
              <span>
                {busyAction === "portal"
                  ? t("vendor.billing.redirecting")
                  : details.card
                    ? t("vendor.billing.payment_change")
                    : t("vendor.billing.payment_add")}
              </span>
            </button>
          </div>

          {details.invoices.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 dark:border-umber-600 dark:bg-umber-900">
              <ul className="divide-y divide-paper-200 dark:divide-umber-700">
                {details.invoices.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                  >
                    <span className="text-sm text-ink-900 dark:text-paper-50">
                      {formatDateMs(inv.created, locale)}
                    </span>
                    <span className="text-sm tabular-nums text-ink-700 dark:text-paper-200">
                      {formatInvoiceAmount(inv.amount, inv.currency, locale)}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        inv.status === "paid"
                          ? "text-sage-700 dark:text-sage-300"
                          : "text-ink-500 dark:text-umber-300"
                      }`}
                    >
                      {t(`vendor.billing.invoice_status_${invoiceStatusKey(inv.status)}`)}
                    </span>
                    {inv.pdf_url ? (
                      <a
                        href={inv.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-blush-600 hover:text-blush-700 dark:text-paper-400"
                      >
                        <Download size={14} aria-hidden="true" />
                        {t("vendor.billing.invoice_download")}
                      </a>
                    ) : (
                      <span className="text-sm text-ink-400 dark:text-umber-400">—</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Manage: everyone on a Stripe record gets the hosted Billing Portal
          (card update, cancel, invoices). */}
      {showPortal && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900">
          <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
            {t("vendor.billing.manage")}
          </p>
          <button
            type="button"
            onClick={() => void startMoneyAction("portal")}
            disabled={busyAction !== null}
            className="btn-ghost inline-flex w-fit items-center gap-2"
          >
            <CreditCard size={16} aria-hidden="true" />
            <span>
              {busyAction === "portal"
                ? t("vendor.billing.redirecting")
                : t("vendor.billing.portal_cta")}
            </span>
          </button>
        </section>
      )}

      {/* Billing not configured server-side: keep the calm expectation-setting
          note instead of dead buttons. */}
      {!checkoutEnabled && !showPortal && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-paper-300 bg-paper-100 p-4 dark:border-umber-700 dark:bg-blush-500/15">
          <Mail
            size={18}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-ink-400 dark:text-paper-400"
          />
          <p className="text-sm text-ink-700 dark:text-paper-200">
            {t("vendor.billing.payment_portal_note")}
          </p>
        </div>
      )}
    </div>
  );
}

function MoneyButton({
  label,
  busyLabel,
  busy,
  disabled,
  fullWidth,
  onClick,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  fullWidth?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn ${fullWidth ? "w-full justify-center" : "w-fit"} bg-blush-500 text-white hover:bg-blush-600 disabled:opacity-60`}
    >
      <Crown size={16} aria-hidden="true" />
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}

/** Simple segmented meter: one pill per free lead credit. */
function LeadMeter({ used, total }: { used: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={`${used}/${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={`lead-${i + 1}`}
          className={
            i < used
              ? "h-2 flex-1 rounded-full bg-blush-500 dark:bg-blush-400"
              : "h-2 flex-1 rounded-full bg-paper-300 dark:bg-umber-700"
          }
        />
      ))}
    </div>
  );
}

function PlanBadge({ isPro, label }: { isPro: boolean; label: string }) {
  return (
    <span
      className={
        isPro
          ? "inline-flex items-center gap-1.5 rounded-full bg-blush-500 px-3 py-1 text-xs font-semibold text-white dark:bg-blush-500"
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
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  price: string;
  accent: boolean;
  active: boolean;
  youAreHere: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={
        accent
          ? "flex flex-col gap-3 rounded-2xl border-2 border-blush-300 bg-paper-50 p-5 dark:border-blush-400/50 dark:bg-umber-900"
          : "flex flex-col gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900"
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
          <span className="inline-flex items-center gap-1 rounded-full bg-blush-500 px-2.5 py-1 text-xs font-semibold text-white">
            <Check size={12} aria-hidden="true" />
            <span>{youAreHere}</span>
          </span>
        )}
      </div>
      <p className="text-xl font-semibold text-ink-900 dark:text-paper-50">{price}</p>
      <ul className="flex flex-col gap-2 border-t border-paper-200 pt-3 dark:border-umber-700">
        {children}
      </ul>
      {footer && <div className="pt-1">{footer}</div>}
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
    </div>
  );
}
