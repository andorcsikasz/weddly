// Automatizmusok: the three things Weddly may do on the vendor's behalf, at
// /vendor/settings/automations. Sixth tab of the settings hub.
//
// One card per automation, each with its own switch, because the decision the
// vendor is making is different in every case: two of these speak to a couple
// in their name and one only ever reaches their own inbox. The copy says which
// is which before the switch, not after it.
//
// Everything saves on the spot rather than behind a Save button. Each of these
// is a single control with an immediate consequence, and a vendor who came here
// to turn an auto-reply OFF must not leave believing they did.
//
// The review request is deliberately the odd one out: switching it on only
// starts a QUEUE. Nothing reaches a couple until the vendor clicks Approve on a
// specific wedding, so that block sits under the switches as its own list.

import { Bell, Clock, Lock, MessageSquare, Sparkles, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { VendorMessageTemplate } from "@shared/booking_messages";
import {
  REMINDER_DELAY_MAX_HOURS,
  REMINDER_DELAY_MIN_HOURS,
  type VendorAutomation,
  type VendorAutomationKey,
  type VendorAutomationRun,
  type VendorAutomationsView,
} from "@shared/vendor_automations";
import { Switch, useToast } from "../../components/ui";
import { bookingMessagesApi, vendorAutomationApi } from "../../lib/endpoints";
import { intlLocale } from "../../lib/format";
import { type Locale, useT } from "../../lib/i18n";

/** Every delay the picker offers, inside the window the queue can justify. The
 *  floor is `REPLY_DUE_HOURS`, so the shortest option here is the shortest wait
 *  the attention band itself calls late. */
const DELAY_OPTIONS = [REMINDER_DELAY_MIN_HOURS, 24, 48, 72, REMINDER_DELAY_MAX_HOURS];

function formatDate(iso: string, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function SectionIcon({ icon: Icon }: { icon: typeof Bell }) {
  return (
    <Icon
      size={18}
      strokeWidth={1.5}
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-steel-600 dark:text-steel-300"
    />
  );
}

/** One automation card: title, what it does, and the switch. Children carry the
 *  per-automation configuration, which only the first two have. */
function AutomationCard({
  icon,
  title,
  body,
  checked,
  disabled,
  onChange,
  helpId,
  children,
}: {
  icon: typeof Bell;
  title: string;
  body: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  helpId: string;
  children?: React.ReactNode;
}) {
  const { t } = useT();
  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <SectionIcon icon={icon} />
          <div className="min-w-0">
            <h2 className="font-grotesk text-base font-semibold tracking-tight text-ink-900 dark:text-paper-50">
              {title}
            </h2>
            <p id={helpId} className="mt-1 text-sm text-ink-500 dark:text-umber-300">
              {body}
            </p>
          </div>
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          label={t("vendor.automations.toggle_aria", { name: title })}
          describedBy={helpId}
        />
      </div>
      {children && <div className="mt-4 pl-[1.8rem]">{children}</div>}
    </section>
  );
}

function StatusLabel({ run }: { run: VendorAutomationRun }) {
  const { t } = useT();
  const label = t(`vendor.automations.status_${run.status}`);
  const detail =
    run.detail === "opted_out"
      ? t("vendor.automations.detail_opted_out")
      : run.detail === "send_failed"
        ? t("vendor.automations.detail_send_failed")
        : null;
  return (
    <span className="text-xs text-ink-500 dark:text-umber-400">
      {label}
      {detail ? `, ${detail}` : ""}
    </span>
  );
}

export default function VendorSettingsAutomations() {
  const { t, locale } = useT();
  const toast = useToast();

  const [view, setView] = useState<VendorAutomationsView | null>(null);
  const [templates, setTemplates] = useState<VendorMessageTemplate[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    vendorAutomationApi
      .get()
      .then(setView)
      .catch(() => setLoadFailed(true));
    // The acknowledgement body comes from the vendor's OWN canned replies, not
    // from a second template store this page would have to keep in step.
    bookingMessagesApi
      .listTemplates()
      .then((r) => setTemplates(r.templates))
      .catch(() => {
        /* the picker just stays empty; the automation cannot arm without one */
      });
  }, []);

  const byKey = useCallback(
    (key: VendorAutomationKey): VendorAutomation | undefined =>
      view?.automations.find((a) => a.key === key),
    [view],
  );

  const canEdit = view?.plan === "pro" && !busy;

  async function save(
    key: VendorAutomationKey,
    patch: { enabled?: boolean; template_id?: number | null; delay_hours?: number },
  ) {
    setBusy(true);
    try {
      setView(await vendorAutomationApi.save(key, patch));
      toast.success(t("vendor.automations.saved"));
    } catch (e) {
      // The one refusal worth naming: the acknowledgement has no words yet.
      const code = (e as { code?: string } | null)?.code;
      toast.error(
        code === "automation_needs_body"
          ? t("vendor.automations.ack_needs_body")
          : t("vendor.automations.save_failed"),
      );
      // Re-read rather than guess: the switch on screen must match the server.
      vendorAutomationApi.get().then(setView).catch(NOOP);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(runId: number, approve: boolean) {
    setBusy(true);
    try {
      setView(
        approve
          ? await vendorAutomationApi.approve(runId)
          : await vendorAutomationApi.dismiss(runId),
      );
      toast.success(approve ? t("vendor.automations.approved") : t("vendor.automations.dismissed"));
    } catch {
      toast.error(t("vendor.automations.action_failed"));
    } finally {
      setBusy(false);
    }
  }

  if (loadFailed) {
    return (
      <p className="mt-8 text-sm text-ink-600 dark:text-umber-200">
        {t("vendor_calendar.availability_no_listing")}
      </p>
    );
  }

  if (!view) {
    return (
      <div
        aria-hidden="true"
        className="mt-8 h-64 animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800"
      />
    );
  }

  const ack = byKey("inquiry_ack");
  const reminder = byKey("unanswered_reminder");
  const review = byKey("review_request");

  return (
    <div className="mt-8 space-y-6">
      <p className="text-sm text-ink-600 dark:text-umber-200">{t("vendor.automations.intro")}</p>

      {view.plan !== "pro" && (
        <section className="card flex flex-col gap-3 p-4">
          <div className="flex items-start gap-2.5">
            <Lock
              size={18}
              strokeWidth={1.5}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-ink-400 dark:text-paper-500"
            />
            <p className="text-sm text-ink-600 dark:text-umber-200">
              {t("vendor.automations.locked")}
            </p>
          </div>
          <Link
            to="/vendor/settings/billing"
            className="btn w-fit bg-blush-500 text-white hover:bg-blush-600"
          >
            {t("vendor.upgrade.cta")}
          </Link>
        </section>
      )}

      {/* 1. Instant acknowledgement */}
      <AutomationCard
        icon={MessageSquare}
        title={t("vendor.automations.ack_title")}
        body={t("vendor.automations.ack_body")}
        checked={ack?.enabled ?? false}
        disabled={!canEdit}
        helpId="vendor-automation-ack"
        onChange={(next) => void save("inquiry_ack", { enabled: next })}
      >
        <label
          htmlFor="vendor-automation-ack-template"
          className="block text-sm font-medium text-ink-800 dark:text-paper-100"
        >
          {t("vendor.automations.ack_template_label")}
        </label>
        <select
          id="vendor-automation-ack-template"
          className="input mt-1.5 h-10 w-full max-w-sm py-0 text-sm"
          disabled={!canEdit}
          value={ack?.template_id ?? ""}
          onChange={(e) =>
            void save("inquiry_ack", {
              template_id: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        >
          <option value="">{t("vendor.automations.ack_template_none")}</option>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.title}
            </option>
          ))}
        </select>
        {templates.length === 0 && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            {t("vendor.automations.ack_no_templates")}
          </p>
        )}
        <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
          {t("vendor.automations.ack_note")}
        </p>
        <Link
          to="/vendor/clients"
          className="mt-1 inline-block text-sm font-medium text-blush-600 hover:underline dark:text-blush-400"
        >
          {t("vendor.automations.ack_templates_link")}
        </Link>
      </AutomationCard>

      {/* 2. Unanswered-lead reminder */}
      <AutomationCard
        icon={Bell}
        title={t("vendor.automations.reminder_title")}
        body={t("vendor.automations.reminder_body")}
        checked={reminder?.enabled ?? false}
        disabled={!canEdit}
        helpId="vendor-automation-reminder"
        onChange={(next) => void save("unanswered_reminder", { enabled: next })}
      >
        <label
          htmlFor="vendor-automation-delay"
          className="flex items-center gap-2 text-sm font-medium text-ink-800 dark:text-paper-100"
        >
          <Clock
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-steel-600 dark:text-steel-300"
          />
          {t("vendor.automations.reminder_delay_label")}
        </label>
        <select
          id="vendor-automation-delay"
          className="input mt-1.5 h-10 w-full max-w-[10rem] py-0 text-sm"
          disabled={!canEdit}
          value={reminder?.delay_hours ?? REMINDER_DELAY_MIN_HOURS}
          onChange={(e) =>
            void save("unanswered_reminder", { delay_hours: Number(e.target.value) })
          }
        >
          {DELAY_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
          {t("vendor.automations.reminder_delay_hint", {
            min: String(REMINDER_DELAY_MIN_HOURS),
            max: String(REMINDER_DELAY_MAX_HOURS),
          })}
        </p>
      </AutomationCard>

      {/* 3. Post-wedding review request */}
      <AutomationCard
        icon={Star}
        title={t("vendor.automations.review_title")}
        body={t("vendor.automations.review_body")}
        checked={review?.enabled ?? false}
        disabled={!canEdit}
        helpId="vendor-automation-review"
        onChange={(next) => void save("review_request", { enabled: next })}
      />

      {/* The approval queue. Its own block, because this is the only place in
          the product where a couple-facing send waits on a human. */}
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-grotesk text-base font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          <Sparkles
            size={18}
            strokeWidth={1.5}
            aria-hidden="true"
            className="shrink-0 text-steel-600 dark:text-steel-300"
          />
          {t("vendor.automations.proposals_title")}
        </h2>
        {view.proposals.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
            {t("vendor.automations.proposals_empty")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-paper-100 dark:divide-umber-800">
            {view.proposals.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                    {run.couple_name}
                  </p>
                  <p className="text-xs text-ink-500 dark:text-umber-400">
                    {formatDate(run.event_date, locale)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => void resolve(run.id, true)}
                    className="btn btn-sm bg-blush-500 text-white hover:bg-blush-600"
                  >
                    {t("vendor.automations.approve")}
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => void resolve(run.id, false)}
                    className="btn-outline btn-sm"
                  >
                    {t("vendor.automations.dismiss")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What actually happened. A switch nobody can audit is a switch nobody
          trusts, so every run is on the record, skips included. */}
      <section className="card p-5">
        <h2 className="font-grotesk text-base font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          {t("vendor.automations.activity_title")}
        </h2>
        {view.recent.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
            {t("vendor.automations.activity_empty")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-paper-100 dark:divide-umber-800">
            {view.recent.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-800 dark:text-paper-100">
                    {t(`vendor.automations.key_${run.key}`)}
                    {run.couple_name ? ` · ${run.couple_name}` : ""}
                  </p>
                  <StatusLabel run={run} />
                </div>
                <span className="shrink-0 text-xs text-ink-400 dark:text-umber-500">
                  {formatDate(new Date(run.created_at).toISOString().slice(0, 10), locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NOOP() {
  /* a failed re-read leaves the last good view on screen */
}
