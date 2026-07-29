// Admin console for the vendor review-invite campaign (KEZELÉS → Szolgáltatók →
// Vélemény kampány). The mirror of the claim-invite console, but it writes to
// CLAIMED vendors to tell them reviews are open to anyone now and hand them
// their own review link. Same look-before-you-leap shape: the exact copy and
// the exact address list are one glance away, and starting is a deliberate
// second step. Most generic labels reuse the claim campaign's `admin.campaign_*`
// strings; only the review-specific copy lives under `admin.review_campaign_*`.

import type {
  VendorReviewCampaign,
  VendorReviewCampaignDetail,
  VendorReviewCampaignSegments,
  VendorReviewCampaignSend,
  VendorReviewCampaignTarget,
} from "@shared/vendor_review_campaign";
import { intlLocale } from "../lib/format";
import { VENDOR_REVIEW_CAMPAIGN_DEFAULT_DAILY_CAP } from "@shared/vendor_review_campaign";
import { CheckCircle2, ExternalLink, MailX, Pause, Play, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import { Button, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminEmailPreviewApi, adminVendorReviewCampaignApi } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";

const MANUAL_BATCH_SIZE = 10;

/** Suggested handle: month-stamped so a second campaign in the same month is the
 *  only case that needs a manual edit. */
function suggestSlug(): string {
  const d = new Date();
  return `reviews-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysToSend(n: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.ceil(n / cap);
}

const DAY_MS = 86_400_000;

/** Short launched/ended stamp. `withTime` for the exact launch moment, date-only
 *  for the (approximate) projected finish. */
function fmtStamp(ms: number, locale: Locale, withTime: boolean): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(ms));
}

function Stat({ value, label, muted }: { value: number; label: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`font-grotesk text-xl font-semibold leading-none tabular-nums ${
          muted ? "text-neutral-400 dark:text-umber-400" : ""
        }`}
      >
        {value}
      </span>
      <span className="text-[11px] leading-tight text-neutral-500 dark:text-umber-300">
        {label}
      </span>
    </div>
  );
}

/** Live render of the actual outbound mail, straight from the template builders
 *  via the existing admin preview endpoint, so the console can never show copy
 *  that differs from what ships. */
function EmailPreview({ kind, locale }: { kind: string; locale: "hu" | "en" }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [subject, setSubject] = useState("");

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    adminEmailPreviewApi
      .render(kind, locale)
      .then((r) => {
        if (cancelled) return;
        setHtml(r.html);
        setSubject(r.subject);
      })
      .catch(() => {
        if (!cancelled) {
          setHtml("<p style='padding:16px;font-family:sans-serif;color:#7a7065'>?</p>");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, locale]);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc || html == null) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  return (
    <div className="flex flex-col gap-2">
      <p className="truncate font-mono text-[11px] text-neutral-500 dark:text-umber-300">
        {subject}
      </p>
      <div className="relative h-[420px] overflow-hidden rounded-xl ring-1 ring-ink-100 dark:ring-umber-700">
        {html == null && <Skeleton variant="block" height={420} rounded="lg" />}
        <iframe
          ref={frame}
          title="preview"
          className="h-full w-full border-0"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}

export default function AdminVendorReviewCampaignPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();

  const [campaigns, setCampaigns] = useState<VendorReviewCampaign[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<VendorReviewCampaignDetail | null>(null);
  const [targets, setTargets] = useState<VendorReviewCampaignTarget[] | null>(null);
  const [sends, setSends] = useState<VendorReviewCampaignSend[] | null>(null);
  const [segments, setSegments] = useState<VendorReviewCampaignSegments | null>(null);
  const [busy, setBusy] = useState(false);

  const [slug, setSlug] = useState(suggestSlug);
  const [country, setCountry] = useState("");
  const [dailyCap, setDailyCap] = useState(String(VENDOR_REVIEW_CAMPAIGN_DEFAULT_DAILY_CAP));
  const [previewKind, setPreviewKind] = useState<"invite" | "reminder">("invite");
  const [previewLocale, setPreviewLocale] = useState<"hu" | "en">("hu");
  const [optOutEmail, setOptOutEmail] = useState("");

  const refreshList = useCallback(async () => {
    const [list, segs] = await Promise.all([
      adminVendorReviewCampaignApi.list(),
      adminVendorReviewCampaignApi.segments(),
    ]);
    setCampaigns(list.campaigns);
    setSegments(segs);
    setSelectedId((prev) => prev ?? list.campaigns[0]?.id ?? null);
  }, []);

  const refreshDetail = useCallback(async (id: number) => {
    const [d, tg, sd] = await Promise.all([
      adminVendorReviewCampaignApi.detail(id),
      adminVendorReviewCampaignApi.targets(id),
      adminVendorReviewCampaignApi.sends(id),
    ]);
    setDetail(d);
    setTargets(tg.targets);
    setSends(sd.sends);
  }, []);

  useEffect(() => {
    void refreshList().catch(() => toast.error(t("common.error_generic")));
  }, [refreshList, toast, t]);

  useEffect(() => {
    if (selectedId == null) return;
    setDetail(null);
    setTargets(null);
    setSends(null);
    void refreshDetail(selectedId).catch(() => toast.error(t("common.error_generic")));
  }, [selectedId, refreshDetail, toast, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refreshList();
      if (selectedId != null) await refreshDetail(selectedId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const plan = useMemo(() => {
    const cap = Number.parseInt(dailyCap, 10);
    const reach =
      country === ""
        ? (segments?.total ?? 0)
        : (segments?.segments.find((s) => s.country === country)?.addresses ?? 0);
    return { reach, cap, days: daysToSend(reach, cap) };
  }, [country, dailyCap, segments]);

  async function onCreate() {
    if (!Number.isInteger(plan.cap) || plan.cap < 1) {
      toast.error(t("admin.campaign_err_cap"));
      return;
    }
    await run(async () => {
      const r = await adminVendorReviewCampaignApi.create({
        slug: slug.trim(),
        daily_cap: plan.cap,
        country: country === "" ? null : country,
      });
      setSelectedId(r.campaign.id);
      setSlug(suggestSlug());
      setCountry("");
      toast.success(t("admin.campaign_created"));
    });
  }

  async function onToggleStatus(campaign: VendorReviewCampaign) {
    const next = campaign.status === "running" ? "paused" : "running";
    if (next === "running") {
      const ok = await confirm({
        title: t("admin.campaign_start_confirm_title"),
        body: t("admin.campaign_start_confirm_body", {
          n: detail?.stats.remaining ?? 0,
          cap: campaign.daily_cap,
        }),
        confirmLabel: t("admin.campaign_start_confirm_cta"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    await run(() => adminVendorReviewCampaignApi.update(campaign.id, { status: next }));
  }

  async function onSendBatch(campaign: VendorReviewCampaign) {
    const ok = await confirm({
      title: t("admin.campaign_batch_confirm_title"),
      body: t("admin.campaign_batch_confirm_body", { n: MANUAL_BATCH_SIZE }),
      confirmLabel: t("admin.campaign_batch_confirm_cta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await run(async () => {
      const r = await adminVendorReviewCampaignApi.sendBatch(campaign.id, MANUAL_BATCH_SIZE);
      toast.success(t("admin.review_campaign_batch_sent", { n: r.sent }));
    });
  }

  async function onOptOut() {
    const email = optOutEmail.trim();
    if (!email.includes("@")) {
      toast.error(t("admin.campaign_err_email"));
      return;
    }
    await run(async () => {
      await adminVendorReviewCampaignApi.optOut(email);
      setOptOutEmail("");
      toast.success(t("admin.campaign_optout_added"));
    });
  }

  const selected = campaigns?.find((c) => c.id === selectedId) ?? null;
  const stats = detail?.stats ?? null;
  const previewApiKind =
    previewKind === "invite" ? "vendor_review_campaign" : "vendor_review_campaign_reminder";

  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader
        title={t("admin.review_campaign_title")}
        subtitle={t("admin.review_campaign_subtitle")}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[190px] flex-1">
              <label className="field-label" htmlFor="rc-slug">
                {t("admin.campaign_slug")}
              </label>
              <input
                id="rc-slug"
                className="input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                maxLength={61}
              />
            </div>
            <div className="min-w-[150px]">
              <label className="field-label" htmlFor="rc-country">
                {t("admin.campaign_country")}
              </label>
              <select
                id="rc-country"
                className="input"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="">
                  {t("admin.campaign_country_all")} ({segments?.total ?? 0})
                </option>
                {segments?.segments.map((s) => (
                  <option key={s.country} value={s.country}>
                    {s.country} ({s.addresses}) · {s.locale.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[104px]">
              <label className="field-label" htmlFor="rc-cap">
                {t("admin.campaign_daily_cap")}
              </label>
              <input
                id="rc-cap"
                className="input"
                type="number"
                min={1}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
              />
            </div>
            <Button onClick={() => void onCreate()} disabled={busy || slug.trim().length < 2}>
              {t("admin.campaign_create")}
            </Button>
          </div>

          <p className="text-sm text-neutral-500 dark:text-umber-300">
            {plan.reach === 0
              ? t("admin.campaign_plan_empty")
              : t("admin.campaign_plan", { n: plan.reach, cap: plan.cap, days: plan.days })}
          </p>

          {campaigns == null ? (
            <Skeleton variant="block" height={34} rounded="lg" />
          ) : campaigns.length === 0 ? (
            <AdminEmptyState title={t("admin.campaign_empty")} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`rounded-full px-3 py-1 text-[13px] ring-1 transition ${
                    c.id === selectedId
                      ? "bg-neutral-900 text-paper-50 ring-neutral-900 dark:bg-paper-100 dark:text-umber-900 dark:ring-paper-100"
                      : "text-ink-700 ring-ink-100 dark:text-paper-100 dark:ring-umber-700"
                  }`}
                >
                  {c.slug}
                  {c.country != null ? ` · ${c.country}` : ""}
                </button>
              ))}
            </div>
          )}

          {selected != null && (
            <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 ring-2 ring-ink-900 dark:bg-umber-800 dark:ring-umber-600">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{selected.slug}</span>
                  <Pill
                    tone={
                      selected.status === "running"
                        ? "sage"
                        : selected.status === "done"
                          ? "muted"
                          : "violet"
                    }
                  >
                    {t(`admin.campaign_status_${selected.status}`)}
                  </Pill>
                </div>
                {selected.status !== "done" && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onSendBatch(selected)}
                    >
                      <Send size={14} aria-hidden />
                      {t("admin.campaign_send_batch", { n: MANUAL_BATCH_SIZE })}
                    </Button>
                    <Button disabled={busy} onClick={() => void onToggleStatus(selected)}>
                      {selected.status === "running" ? (
                        <>
                          <Pause size={14} aria-hidden />
                          {t("admin.campaign_pause")}
                        </>
                      ) : (
                        <>
                          <Play size={14} aria-hidden />
                          {t("admin.campaign_start")}
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* When it launched, and when it ends (actual once Done, else a
                  projection from remaining ÷ daily cap). */}
              <p className="text-xs text-neutral-500 dark:text-umber-300">
                {selected.started_at
                  ? t("admin.campaign_launched", {
                      date: fmtStamp(selected.started_at, locale, true),
                    })
                  : t("admin.campaign_not_launched")}
                {" · "}
                {selected.ended_at
                  ? ` · ${t("admin.campaign_ended", { date: fmtStamp(selected.ended_at, locale, true) })}`
                  : selected.status === "running" && stats != null && stats.remaining > 0
                    ? ` · ${t("admin.campaign_ends_est", {
                        date: fmtStamp(
                          Date.now() + daysToSend(stats.remaining, selected.daily_cap) * DAY_MS,
                          locale,
                          false,
                        ),
                      })}`
                    : ""}
              </p>

              {stats == null ? (
                <Skeleton variant="block" height={44} rounded="md" />
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-4 sm:grid-cols-7">
                    <Stat value={stats.remaining} label={t("admin.campaign_stat_remaining")} />
                    <Stat value={stats.sent} label={t("admin.campaign_stat_sent")} />
                    <Stat value={stats.opened} label={t("admin.campaign_stat_opened")} />
                    <Stat value={stats.clicked} label={t("admin.campaign_stat_clicked")} />
                    <Stat value={stats.reminded} label={t("admin.campaign_stat_reminded")} />
                    <Stat
                      value={stats.collected}
                      label={t("admin.review_campaign_stat_collected")}
                    />
                    <Stat value={stats.failed} label={t("admin.campaign_stat_failed")} muted />
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-umber-300">
                    {t("admin.campaign_stat_today", {
                      n: stats.sent_last_24h,
                      cap: selected.daily_cap,
                    })}
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["invite", "reminder"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPreviewKind(k)}
                className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-wide ring-1 transition ${
                  previewKind === k
                    ? "bg-neutral-900 text-paper-50 ring-neutral-900 dark:bg-paper-100 dark:text-umber-900 dark:ring-paper-100"
                    : "text-neutral-500 ring-ink-100 dark:text-umber-300 dark:ring-umber-700"
                }`}
              >
                {t(`admin.campaign_preview_${k}`)}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-ink-100 dark:bg-umber-700" />
            {(["hu", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setPreviewLocale(l)}
                className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-wide ring-1 transition ${
                  previewLocale === l
                    ? "bg-neutral-900 text-paper-50 ring-neutral-900 dark:bg-paper-100 dark:text-umber-900 dark:ring-paper-100"
                    : "text-neutral-500 ring-ink-100 dark:text-umber-300 dark:ring-umber-700"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <EmailPreview kind={previewApiKind} locale={previewLocale} />
        </section>
      </div>

      {selected != null && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">{t("admin.campaign_targets")}</h2>
            <p className="text-xs text-neutral-500 dark:text-umber-300">
              {t("admin.review_campaign_targets_hint")}
            </p>
          </div>
          {targets == null ? (
            <Skeleton variant="block" height={110} rounded="lg" />
          ) : targets.length === 0 ? (
            <AdminEmptyState title={t("admin.campaign_targets_empty")} />
          ) : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-ink-100 dark:ring-umber-700">
              <table className="w-full text-[13px]">
                <tbody>
                  {targets.map((tg) => (
                    <tr
                      key={tg.listing_id}
                      className="border-b border-ink-100 last:border-0 dark:border-umber-700"
                    >
                      <td className="px-3 py-1.5 font-medium">{tg.listing_name}</td>
                      <td className="px-3 py-1.5 text-neutral-500 dark:text-umber-300">
                        {tg.email}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500 dark:text-umber-300">
                        {tg.city} · {tg.country}
                      </td>
                      <td className="px-3 py-1.5 uppercase text-neutral-400 dark:text-umber-400">
                        {tg.locale}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {selected != null && sends != null && sends.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("admin.campaign_sends")}</h2>
          <div className="overflow-x-auto rounded-xl ring-1 ring-ink-100 dark:ring-umber-700">
            <table className="w-full text-[13px]">
              <tbody>
                {sends.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-ink-100 last:border-0 dark:border-umber-700"
                  >
                    <td className="px-3 py-1.5 font-medium">
                      <a
                        href={s.review_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {s.listing_name}
                        <ExternalLink size={11} aria-hidden />
                      </a>
                    </td>
                    <td className="px-3 py-1.5 text-neutral-500 dark:text-umber-300">{s.email}</td>
                    <td className="px-3 py-1.5">
                      {s.collected ? (
                        <Pill tone="sage">
                          <CheckCircle2 size={11} aria-hidden />
                          {t("admin.review_campaign_send_collected")}
                        </Pill>
                      ) : s.clicked_at != null ? (
                        <Pill tone="violet">{t("admin.campaign_send_clicked")}</Pill>
                      ) : s.opened_at != null ? (
                        <Pill tone="muted">{t("admin.campaign_stat_opened")}</Pill>
                      ) : s.status === "failed" ? (
                        <Pill tone="blush">{t("admin.campaign_send_failed")}</Pill>
                      ) : s.reminder_sent_at != null ? (
                        <Pill tone="muted">{t("admin.campaign_send_reminded")}</Pill>
                      ) : (
                        <Pill tone="muted">{t("admin.campaign_send_sent")}</Pill>
                      )}
                    </td>
                    <td className="px-3 py-1.5 uppercase text-neutral-400 dark:text-umber-400">
                      {s.locale}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-end gap-2 border-t border-ink-100 pt-4 dark:border-umber-700">
        <div className="min-w-[220px] flex-1">
          <label className="field-label" htmlFor="rc-optout">
            {t("admin.campaign_optout")}
          </label>
          <input
            id="rc-optout"
            className="input"
            type="email"
            placeholder={t("admin.campaign_optout_email")}
            value={optOutEmail}
            onChange={(e) => setOptOutEmail(e.target.value)}
          />
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => void onOptOut()}>
          <MailX size={14} aria-hidden />
          {t("admin.campaign_optout_add")}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await adminVendorReviewCampaignApi.runReminders();
              toast.success(t("admin.campaign_reminders_sent", { n: r.sent }));
            })
          }
        >
          {t("admin.campaign_run_reminders")}
        </Button>
      </section>
    </div>
  );
}
