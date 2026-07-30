// Vendor client detail — /vendor/clients/:id (the `:id` route param is the
// supplier_bookings.id). Shows the couple + event summary (always visible on the
// FREE tier), then a PRO-gated CRM editor (status / stage / private notes /
// contract value / deposit → live balance) and a PRO-gated payment schedule.
// FREE vendors see a graceful upgrade prompt in place of the editor and the
// schedule. Money is integer whole-unit (the project formats HUF/EUR/USD without
// a minor unit) and formatted by the vendor's billing currency.

import type { Currency } from "@shared/types";
import type { VendorClientDetail, VendorClientPayment } from "@shared/vendor_clients";
import type { VendorFeatureFlags } from "@shared/vendor_plan";
import { ArrowLeft, CircleCheck, CircleDashed, Lock, Mail, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, DateField, Skeleton, TextField, useConfirm, useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import {
  bookingMessagesApi,
  notifyVendorStatsStale,
  vendorBillingApi,
  vendorClientsApi,
} from "../../lib/endpoints";
import { formatDate, formatMoney, intlLocale } from "../../lib/format";
import { BookingThreadPanel } from "../../components/BookingThreadPanel";
import { MessageTemplatesDialog } from "../../components/MessageTemplatesDialog";
import type { BookingMessage, VendorMessageTemplate } from "@shared/booking_messages";
import { type Locale, useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

/** The booking statuses a vendor can set. Labels come from the vendor.* i18n
 *  namespace (status_<value>); see the integration note in the return summary. */
const STATUS_OPTIONS = [
  "requested",
  "vendor_seen",
  "confirmed",
  "declined",
  "cancelled",
  "expired",
] as const;

/** Parse a money / number input to an integer whole-unit value, or null when the
 *  field is left blank or invalid. Grouping separators (regular, non-breaking
 *  and thin spaces, commas) are stripped first so a formatted "420 000" or
 *  "420,000" round-trips cleanly. */
function parseIntOrNull(raw: string): number | null {
  const trimmed = raw.replace(/[\s  ,]/g, "").trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function moneyToInput(value: number | null): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Locale-grouped rendering of a raw digits string ("420000" → "420 000").
 *  Falls back to the raw text while it isn't a clean number so half-typed
 *  input never gets mangled. */
function groupDigits(raw: string, locale: Locale): string {
  const n = parseIntOrNull(raw);
  if (n === null || raw.trim() === "") return raw;
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}

/** Money input that shows the same thousand-separated formatting as the
 *  read-only summaries: grouped while resting, raw digits while focused so
 *  the caret behaves. Plain text input (type="number" rejects separators). */
function MoneyField({
  id,
  label,
  value,
  onValueChange,
  locale,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (raw: string) => void;
  locale: Locale;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextField
      id={id}
      label={label}
      inputMode="numeric"
      value={focused ? value : groupDigits(value, locale)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onValueChange(e.target.value.replace(/[\s  ,]/g, ""))}
    />
  );
}

export default function VendorClientDetailPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);

  const [detail, setDetail] = useState<VendorClientDetail | null>(null);
  const [currency, setCurrency] = useState<Currency>("HUF");
  const [features, setFeatures] = useState<VendorFeatureFlags | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  useDocumentTitle(detail?.couple_display_name ?? t("vendor.clients.page_title"));

  // CRM editor form state (mirrors the editable booking columns).
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [depositPaid, setDepositPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Message thread state. Loaded alongside the detail; sending is PRO, reading
  // is not, so the panel renders on FREE with the composer swapped for a nudge.
  const [messages, setMessages] = useState<BookingMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(true);
  const [templates, setTemplates] = useState<VendorMessageTemplate[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Payment schedule state (seeded from the detail payload, then kept live).
  const [payments, setPayments] = useState<VendorClientPayment[]>([]);
  const [payLabel, setPayLabel] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payDueDate, setPayDueDate] = useState("");
  const [addingPayment, setAddingPayment] = useState(false);
  const [busyPaymentId, setBusyPaymentId] = useState<number | null>(null);

  const hydrateForm = useCallback((client: VendorClientDetail) => {
    setStatus(client.status);
    setStage(client.stage ?? "");
    setContractValue(moneyToInput(client.contract_value));
    setDepositPaid(moneyToInput(client.deposit_paid));
    setNotes(client.vendor_notes ?? "");
    setPayments(client.payments ?? []);
  }, []);

  useEffect(() => {
    if (!Number.isFinite(bookingId)) {
      setLoadState("error");
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    Promise.all([vendorClientsApi.get(bookingId), vendorBillingApi.get()])
      .then(([client, billing]) => {
        if (cancelled) return;
        setDetail(client);
        hydrateForm(client);
        setCurrency(billing.billing.currency);
        setFeatures(billing.features);
        setLoadState("ok");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId, hydrateForm]);

  // Opening the inquiry is what "seen" means for the Ügyfelek nav badge. Only
  // ever the first time (the stamp is first-wins server-side anyway, but a
  // pointless POST on every revisit is noise), and it deliberately leaves the
  // booking STATUS alone: "Megtekintve" is triage the vendor chooses and the
  // couple reads, whereas this is only "it is no longer new to me".
  useEffect(() => {
    if (!detail || detail.vendor_seen_at !== null) return;
    vendorClientsApi
      .markSeen(detail.id)
      .then(() => notifyVendorStatsStale())
      .catch(() => {
        /* best-effort: the badge just clears on the next stats fetch */
      });
  }, [detail]);

  const canEditCrm = features?.client_crm_detail ?? false;
  const canTrackPayments = features?.payment_tracking ?? false;
  const canSendMessages = features?.direct_messages ?? false;

  // Fetching the thread is what stamps DELIVERED on the couple's messages;
  // marking them SEEN is a second call, because "the page loaded" and "the
  // vendor read it" are not the same claim to make to the other side.
  useEffect(() => {
    if (!Number.isFinite(bookingId)) return;
    let cancelled = false;
    setThreadLoading(true);
    bookingMessagesApi
      .vendorThread(bookingId)
      .then(({ thread }) => {
        if (cancelled) return;
        setMessages(thread.messages);
        setThreadLoading(false);
        if (thread.messages.some((m) => m.sender_kind === "couple" && m.seen_at === null)) {
          void bookingMessagesApi.vendorMarkSeen(bookingId).then(() => {
            if (!cancelled) {
              bookingMessagesApi
                .vendorThread(bookingId)
                .then(({ thread: fresh }) => !cancelled && setMessages(fresh.messages))
                .catch(() => undefined);
            }
          });
        }
      })
      .catch(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  useEffect(() => {
    if (!canSendMessages) return;
    let cancelled = false;
    bookingMessagesApi
      .listTemplates()
      .then(({ templates: list }) => !cancelled && setTemplates(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canSendMessages]);

  const sendMessage = useCallback(
    async (body: string, files: File[]) => {
      const res =
        files.length > 0
          ? await bookingMessagesApi.vendorSendWithFiles(bookingId, body, files)
          : await bookingMessagesApi.vendorSend(bookingId, body);
      setMessages((prev) => [...prev, res.message]);
    },
    [bookingId],
  );

  // Live balance from the in-progress edits, not the persisted row, so the
  // number moves as the vendor types.
  const liveBalance = useMemo(() => {
    const cv = parseIntOrNull(contractValue);
    if (cv === null) return null;
    const dp = parseIntOrNull(depositPaid) ?? 0;
    return cv - dp;
  }, [contractValue, depositPaid]);

  const paymentTotals = useMemo(() => {
    let total = 0;
    let paid = 0;
    for (const p of payments) {
      total += p.amount;
      if (p.paid) paid += p.amount;
    }
    return { total, paid, outstanding: total - paid };
  }, [payments]);

  const fmt = useCallback(
    (value: number) => formatMoney(value, currency, locale),
    [currency, locale],
  );

  async function onSaveCrm() {
    if (!detail) return;
    setSaving(true);
    try {
      const trimmedStage = stage.trim();
      const trimmedNotes = notes.trim();
      const res = await vendorClientsApi.update(detail.id, {
        status,
        stage: trimmedStage === "" ? null : trimmedStage,
        vendor_notes: trimmedNotes === "" ? null : trimmedNotes,
        contract_value: parseIntOrNull(contractValue),
        deposit_paid: parseIntOrNull(depositPaid),
      });
      setDetail(res.client);
      hydrateForm(res.client);
      toast.success(t("vendor.clients.saved"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("vendor.clients.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function onAddPayment() {
    if (!detail) return;
    const amount = parseIntOrNull(payAmount);
    const label = payLabel.trim();
    if (label === "" || amount === null || amount <= 0) return;
    setAddingPayment(true);
    try {
      const due = payDueDate.trim();
      const res = await vendorClientsApi.addPayment(detail.id, {
        label,
        amount,
        due_date: due === "" ? null : due,
      });
      setPayments((prev) => [...prev, res.payment]);
      setPayLabel("");
      setPayAmount("");
      setPayDueDate("");
      toast.success(t("vendor.payments.added"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("vendor.payments.add_failed"));
    } finally {
      setAddingPayment(false);
    }
  }

  async function onTogglePaid(payment: VendorClientPayment) {
    setBusyPaymentId(payment.id);
    try {
      const res = await vendorClientsApi.updatePayment(payment.id, { paid: !payment.paid });
      setPayments((prev) => prev.map((p) => (p.id === res.payment.id ? res.payment : p)));
      toast.success(t("vendor.payments.updated"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("vendor.payments.update_failed"));
    } finally {
      setBusyPaymentId(null);
    }
  }

  async function onRemovePayment(payment: VendorClientPayment) {
    const ok = await confirm({
      title: t("vendor.payments.remove_confirm_title"),
      body: t("vendor.payments.remove_confirm_body"),
      confirmLabel: t("vendor.payments.remove"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setBusyPaymentId(payment.id);
    try {
      await vendorClientsApi.deletePayment(payment.id);
      setPayments((prev) => prev.filter((p) => p.id !== payment.id));
      toast.success(t("vendor.payments.removed"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("vendor.payments.remove_failed"));
    } finally {
      setBusyPaymentId(null);
    }
  }

  const backLink = (
    <Link
      to="/vendor/clients"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900 dark:text-paper-300 dark:hover:text-paper-50"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      {t("vendor.clients.back_to_clients")}
    </Link>
  );

  if (loadState === "loading") {
    return (
      <div className="space-y-4">
        {backLink}
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadState === "error" || !detail) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="card">
          <p className="text-sm text-ink-600 dark:text-paper-300">
            {t("vendor.clients.load_failed")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backLink}

      {/* Couple + event summary — always visible (FREE tier). */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-paper-50">
          {detail.couple_display_name}
        </h1>
        <p className="text-sm text-ink-600 dark:text-paper-300">
          {detail.event_date
            ? new Date(detail.event_date).toLocaleDateString(intlLocale(locale), {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : t("vendor.clients.no_event_date")}
        </p>
      </header>

      <section className="card grid gap-4 sm:grid-cols-2">
        <SummaryItem
          label={t("vendor.clients.status_label")}
          value={t(`vendor.clients.status_${detail.status}`)}
        />
        <SummaryItem
          label={t("vendor.clients.contact_email")}
          value={
            detail.couple_contact_email ? (
              <a
                href={`mailto:${detail.couple_contact_email}`}
                className="flex items-start gap-1.5 text-ink-800 underline-offset-2 hover:underline dark:text-paper-100"
              >
                <Mail size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
                {/* break-all so a long address wraps inside the card instead of
                    running off the right edge on mobile. */}
                <span className="min-w-0 break-all">{detail.couple_contact_email}</span>
              </a>
            ) : (
              <span className="text-ink-500 dark:text-paper-400">
                {t("vendor.clients.no_contact_email")}
              </span>
            )
          }
        />
        <SummaryItem
          label={t("vendor.clients.contract_value")}
          value={detail.contract_value === null ? "-" : fmt(detail.contract_value)}
        />
        <SummaryItem
          label={t("vendor.clients.balance")}
          value={
            detail.balance === null ? (
              "-"
            ) : ["declined", "cancelled", "expired"].includes(detail.status) ? (
              // A dead inquiry's balance is context, not money owed.
              <span className="text-ink-400 line-through dark:text-umber-400">
                {fmt(detail.balance)}
              </span>
            ) : (
              fmt(detail.balance)
            )
          }
        />
      </section>

      {/* The conversation. READING is deliberately outside the PRO block: the
          point of a lead is knowing what was asked, and a vendor who can see
          the client at all can see their message. SENDING is PRO, so on FREE
          the composer is replaced by the upgrade card. */}
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("vendor.clients.thread_title")}
        </h2>
        <BookingThreadPanel
          side="vendor"
          messages={messages}
          loading={threadLoading}
          onSend={sendMessage}
          allowAttachments={canSendMessages}
          templates={canSendMessages ? templates : undefined}
          templateVars={{
            client_name: detail.couple_display_name,
            event_date: detail.event_date
              ? formatDate(detail.event_date, locale)
              : t("vendor.clients.no_event_date"),
          }}
          onManageTemplates={canSendMessages ? () => setTemplatesOpen(true) : undefined}
          composerLock={
            canSendMessages ? undefined : (
              <UpgradeCard
                title={t("vendor.clients.thread_locked_title")}
                body={t("vendor.clients.thread_locked_body")}
                cta={t("vendor.upgrade.cta")}
                locked={t("vendor.upgrade.feature_locked")}
              />
            )
          }
        />
      </section>

      {templatesOpen ? (
        <MessageTemplatesDialog
          templates={templates}
          onChange={setTemplates}
          onClose={() => setTemplatesOpen(false)}
        />
      ) : null}

      {/* CRM editor — PRO. */}
      {canEditCrm ? (
        <section className="card space-y-5">
          <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-50">
            {t("vendor.clients.detail_title")}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="block">
              <label htmlFor="vc-status" className="field-label">
                {t("vendor.clients.status_label")}
              </label>
              <select
                id="vc-status"
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {t(`vendor.clients.status_${opt}`)}
                  </option>
                ))}
              </select>
            </div>

            <TextField
              id="vc-stage"
              label={t("vendor.clients.stage_label")}
              placeholder={t("vendor.clients.stage_placeholder")}
              helperText={t("vendor.clients.stage_hint")}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            />

            <MoneyField
              id="vc-contract"
              label={t("vendor.clients.contract_value")}
              value={contractValue}
              onValueChange={setContractValue}
              locale={locale}
            />

            <MoneyField
              id="vc-deposit"
              label={t("vendor.clients.deposit_paid")}
              value={depositPaid}
              onValueChange={setDepositPaid}
              locale={locale}
            />
          </div>

          <div className="flex items-baseline justify-between rounded-xl bg-paper-100 px-4 py-3 dark:bg-umber-900">
            <span className="field-label mb-0">{t("vendor.clients.balance")}</span>
            <span className="text-lg font-semibold text-ink-900 dark:text-paper-50">
              {liveBalance === null ? "-" : fmt(liveBalance)}
            </span>
          </div>

          <div className="block">
            <label htmlFor="vc-notes" className="field-label">
              {t("vendor.clients.notes_label")}
            </label>
            <textarea
              id="vc-notes"
              rows={4}
              className="input min-h-[6rem] resize-y leading-relaxed"
              placeholder={t("vendor.clients.notes_placeholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={onSaveCrm} loading={saving} loadingLabel={t("vendor.clients.saving")}>
              {t("vendor.clients.save")}
            </Button>
          </div>
        </section>
      ) : (
        <UpgradeCard
          title={t("vendor.upgrade.title")}
          body={t("vendor.upgrade.body")}
          cta={t("vendor.upgrade.cta")}
          locked={t("vendor.upgrade.feature_locked")}
        />
      )}

      {/* Payment schedule — PRO. */}
      {canTrackPayments ? (
        <section className="card space-y-5">
          <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-50">
            {t("vendor.payments.title")}
          </h2>

          {payments.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-paper-400">{t("vendor.payments.empty")}</p>
          ) : (
            <ul className="divide-y divide-paper-300 dark:divide-umber-700">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink-900 dark:text-paper-50">
                      {p.label}
                    </p>
                    <p className="text-xs text-ink-500 dark:text-paper-400">
                      {p.due_date
                        ? new Date(p.due_date).toLocaleDateString(intlLocale(locale), {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : t("vendor.payments.no_due_date")}
                    </p>
                  </div>
                  <span className="font-semibold text-ink-900 dark:text-paper-50">
                    {fmt(p.amount)}
                  </span>
                  {/* Paid state as a coloured icon; the label lives in an
                      instant CSS tooltip + sr-only text (same idiom as the
                      clients-table status icons). */}
                  <span className="group relative inline-flex items-center">
                    {p.paid ? (
                      <CircleCheck
                        size={18}
                        aria-hidden="true"
                        className="text-sage-700 dark:text-sage-300"
                      />
                    ) : (
                      <CircleDashed
                        size={18}
                        aria-hidden="true"
                        className="text-amber-600 dark:text-amber-300"
                      />
                    )}
                    <span className="sr-only">
                      {p.paid ? t("vendor.payments.paid") : t("vendor.payments.unpaid")}
                    </span>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute right-full top-1/2 z-20 mr-1.5 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-paper-200 bg-paper-50 px-2 py-1 text-[11px] font-medium text-ink-700 shadow-pop group-hover:block dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                    >
                      {p.paid ? t("vendor.payments.paid") : t("vendor.payments.unpaid")}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={busyPaymentId === p.id}
                    onClick={() => onTogglePaid(p)}
                  >
                    {p.paid ? t("vendor.payments.mark_unpaid") : t("vendor.payments.mark_paid")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyPaymentId === p.id}
                    onClick={() => onRemovePayment(p)}
                    aria-label={t("vendor.payments.remove")}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Stacks on mobile: at ~300px three money figures in a 3-col grid
              overflow their tracks and overlap. One column per row keeps each
              label + value readable; 3-up returns at sm. */}
          {payments.length > 0 && (
            <div className="grid grid-cols-1 gap-2 rounded-xl bg-paper-100 px-4 py-3 sm:grid-cols-3 sm:gap-3 dark:bg-umber-900">
              <SummaryItem label={t("vendor.payments.total")} value={fmt(paymentTotals.total)} />
              <SummaryItem
                label={t("vendor.payments.total_paid")}
                value={fmt(paymentTotals.paid)}
              />
              <SummaryItem
                label={t("vendor.payments.total_outstanding")}
                value={fmt(paymentTotals.outstanding)}
              />
            </div>
          )}

          <div className="grid gap-3 border-t border-paper-300 pt-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end dark:border-umber-700">
            <TextField
              id="vc-pay-label"
              label={t("vendor.payments.label_field")}
              placeholder={t("vendor.payments.label_placeholder")}
              value={payLabel}
              onChange={(e) => setPayLabel(e.target.value)}
            />
            <MoneyField
              id="vc-pay-amount"
              label={t("vendor.payments.amount_field")}
              value={payAmount}
              onValueChange={setPayAmount}
              locale={locale}
            />
            <DateField
              id="vc-pay-due"
              label={t("vendor.payments.due_date_field")}
              value={payDueDate}
              onChange={setPayDueDate}
              locale={locale}
              clearable
            />
            <Button
              onClick={onAddPayment}
              loading={addingPayment}
              disabled={payLabel.trim() === "" || (parseIntOrNull(payAmount) ?? 0) <= 0}
            >
              <Plus size={16} aria-hidden="true" />
              <span className="ml-1">{t("vendor.payments.add")}</span>
            </Button>
          </div>
        </section>
      ) : (
        <UpgradeCard
          title={t("vendor.payments.title")}
          body={t("vendor.upgrade.body")}
          cta={t("vendor.upgrade.cta")}
          locked={t("vendor.upgrade.feature_locked")}
        />
      )}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    // min-w-0 lets the item shrink inside its grid track instead of overflowing
    // (and lets long values like an email wrap rather than clip at the edge).
    <div className="min-w-0 space-y-0.5">
      <p className="field-label mb-0">{label}</p>
      <div className="break-words text-sm text-ink-900 dark:text-paper-50">{value}</div>
    </div>
  );
}

function UpgradeCard({
  title,
  body,
  cta,
  locked,
}: {
  title: string;
  body: string;
  cta: string;
  locked: string;
}) {
  return (
    <section className="card space-y-3 border-dashed">
      <div className="flex items-center gap-2 text-ink-700 dark:text-paper-200">
        <Lock size={18} aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-50">{title}</h2>
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
        {locked}
      </p>
      <p className="text-sm text-ink-600 dark:text-paper-300">{body}</p>
      <div>
        <Link to="/vendor/billing">
          <Button>{cta}</Button>
        </Link>
      </div>
    </section>
  );
}
