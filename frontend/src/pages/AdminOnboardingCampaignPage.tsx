// Admin console for the onboarding re-engagement campaign: a paced nudge to
// registered couples who verified their email but never onboarded (no
// workspace). Wears the SAME shell as the other three KEZELÉS → Kampányok tabs
// (create row + campaign chips + funnel on the left, the live outbound email on
// the right rail, the recipient list full width underneath). What differs is
// only the audience: a LIVE orphan query, so where personal-invite shows a CSV
// import this one shows a one-click "Sync audience" that snapshots the current
// workspace-less couples into the queue. Launching stays a deliberate second
// step (Start); pacing beyond a supervised send-batch belongs to the worker.

import type {
  OnboardingCampaign,
  OnboardingCampaignSend,
  OnboardingCampaignStats,
} from "@shared/onboarding_campaign";
import {
  ONBOARDING_CAMPAIGN_DEFAULT_DAILY_CAP,
  ONBOARDING_CAMPAIGN_MAX_DAILY_CAP,
} from "@shared/onboarding_campaign";
import { Pause, Play, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import { Button, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminEmailPreviewApi, adminOnboardingCampaignApi as api } from "../lib/endpoints";
import { intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

const MANUAL_BATCH_SIZE = 25;
const CONTACT_ROWS = 200;
const DAY_MS = 86_400_000;

/** Month-stamped handle, so a second campaign in the same month is the only case
 *  that needs a manual edit. Mirrors the other consoles. */
function suggestSlug(): string {
  const d = new Date();
  return `reengage-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysToSend(n: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.ceil(n / cap);
}

function fmtStamp(ms: number, locale: Locale, withTime: boolean): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(ms));
}

function Stat({ value, label, muted }: { value: number | string; label: string; muted?: boolean }) {
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

/** Live render of the actual outbound mail (initial or reminder), from the same
 *  builders that ship, via the admin preview endpoint — so the console can never
 *  show copy that differs from what sends. */
function EmailPreview({
  kind,
  locale,
}: {
  kind: "onboarding_campaign" | "onboarding_campaign_reminder";
  locale: "hu" | "en";
}) {
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
        if (!cancelled)
          setHtml("<p style='padding:16px;font-family:sans-serif;color:#7a7065'>?</p>");
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

export default function AdminOnboardingCampaignPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();

  const [campaigns, setCampaigns] = useState<OnboardingCampaign[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stats, setStats] = useState<OnboardingCampaignStats | null>(null);
  const [sends, setSends] = useState<OnboardingCampaignSend[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [slug, setSlug] = useState(suggestSlug);
  const [dailyCap, setDailyCap] = useState(String(ONBOARDING_CAMPAIGN_DEFAULT_DAILY_CAP));
  const [previewKind, setPreviewKind] = useState<
    "onboarding_campaign" | "onboarding_campaign_reminder"
  >("onboarding_campaign");
  const [previewLocale, setPreviewLocale] = useState<"hu" | "en">("hu");

  const refreshList = useCallback(async () => {
    const list = await api.list();
    setCampaigns(list.campaigns);
    setSelectedId((prev) => prev ?? list.campaigns[0]?.id ?? null);
  }, []);

  const refreshDetail = useCallback(async (id: number) => {
    const [d, sd] = await Promise.all([api.detail(id), api.sends(id)]);
    setStats(d.stats);
    setSends(sd.sends);
  }, []);

  useEffect(() => {
    void refreshList().catch(() => toast.error(t("common.error_generic")));
  }, [refreshList, toast, t]);

  useEffect(() => {
    if (selectedId == null) return;
    setStats(null);
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

  const cap = Number.parseInt(dailyCap, 10);

  async function onCreate() {
    if (!Number.isInteger(cap) || cap < 1 || cap > ONBOARDING_CAMPAIGN_MAX_DAILY_CAP) {
      toast.error(t("admin.campaign_err_cap"));
      return;
    }
    await run(async () => {
      const r = await api.create({ slug: slug.trim(), daily_cap: cap });
      setSelectedId(r.campaign.id);
      setSlug(suggestSlug());
      toast.success(t("admin.campaign_created"));
    });
  }

  async function onSync(campaign: OnboardingCampaign) {
    await run(async () => {
      const r = await api.sync(campaign.id);
      toast.success(
        t("admin.onbcamp_sync_result", {
          added: r.result.added,
          existing: r.result.skipped_existing,
          optout: r.result.skipped_optout,
        }),
      );
    });
  }

  async function onToggleStatus(campaign: OnboardingCampaign) {
    const next = campaign.status === "running" ? "paused" : "running";
    if (next === "running") {
      const ok = await confirm({
        title: t("admin.campaign_start_confirm_title"),
        body: t("admin.campaign_start_confirm_body", {
          n: stats?.queued ?? 0,
          cap: campaign.daily_cap,
        }),
        confirmLabel: t("admin.campaign_start_confirm_cta"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    await run(() => api.update(campaign.id, { status: next }));
  }

  async function onSendBatch(campaign: OnboardingCampaign) {
    const ok = await confirm({
      title: t("admin.campaign_batch_confirm_title"),
      body: t("admin.campaign_batch_confirm_body", { n: MANUAL_BATCH_SIZE }),
      confirmLabel: t("admin.campaign_batch_confirm_cta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await run(async () => {
      const r = await api.sendBatch(campaign.id, MANUAL_BATCH_SIZE);
      toast.success(t("admin.campaign_batch_sent", { n: r.sent }));
    });
  }

  const selected = campaigns?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader title={t("admin.onbcamp_title")} subtitle={t("admin.onbcamp_subtitle")} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[190px] flex-1">
              <label className="field-label" htmlFor="ob-slug">
                {t("admin.campaign_slug")}
              </label>
              <input
                id="ob-slug"
                className="input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                maxLength={61}
              />
            </div>
            <div className="w-[104px]">
              <label className="field-label" htmlFor="ob-cap">
                {t("admin.campaign_daily_cap")}
              </label>
              <input
                id="ob-cap"
                className="input tabular-nums"
                type="number"
                min={1}
                max={ONBOARDING_CAMPAIGN_MAX_DAILY_CAP}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
              />
            </div>
            <Button onClick={() => void onCreate()} disabled={busy || slug.trim().length < 2}>
              {t("admin.campaign_create")}
            </Button>
          </div>

          {stats != null && stats.queued > 0 && selected != null && (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.campaign_plan", {
                n: stats.queued,
                cap: selected.daily_cap,
                days: daysToSend(stats.queued, selected.daily_cap),
              })}
            </p>
          )}

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
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" disabled={busy} onClick={() => void onSync(selected)}>
                    <RefreshCw size={14} aria-hidden />
                    {t("admin.onbcamp_sync_cta")}
                  </Button>
                  {selected.status !== "done" && (
                    <>
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
                    </>
                  )}
                </div>
              </div>

              <p className="text-xs text-neutral-500 dark:text-umber-300">
                {selected.started_at
                  ? t("admin.campaign_launched", {
                      date: fmtStamp(selected.started_at, locale, true),
                    })
                  : t("admin.campaign_not_launched")}
                {selected.ended_at
                  ? ` · ${t("admin.campaign_ended", { date: fmtStamp(selected.ended_at, locale, true) })}`
                  : selected.status === "running" && stats != null && stats.queued > 0
                    ? ` · ${t("admin.campaign_ends_est", {
                        date: fmtStamp(
                          Date.now() + daysToSend(stats.queued, selected.daily_cap) * DAY_MS,
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
                  {/* Sent → opened → clicked → converted, left to right, so the
                      funnel reads in one pass. Opens and clicks cover BOTH
                      waves: the row is the person, not the mail. */}
                  <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-7">
                    <Stat value={stats.total} label={t("admin.onbcamp_stat_total")} />
                    <Stat value={stats.queued} label={t("admin.onbcamp_stat_queued")} />
                    <Stat value={stats.sent} label={t("admin.campaign_stat_sent")} />
                    <Stat value={stats.opened} label={t("admin.campaign_stat_opened")} />
                    <Stat value={stats.clicked} label={t("admin.campaign_stat_clicked")} />
                    <Stat value={stats.converted} label={t("admin.onbcamp_stat_converted")} />
                    <Stat value={stats.reminded} label={t("admin.onbcamp_stat_reminded")} />
                    <Stat value={stats.failed} label={t("admin.campaign_stat_failed")} muted />
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-umber-300">
                    {t("admin.campaign_stat_today", {
                      n: stats.sent_last_24h,
                      cap: selected.daily_cap,
                    })}
                    {" · "}
                    {`${stats.hu} / ${stats.en} ${t("admin.onbcamp_stat_lang")}`}
                    {" · "}
                    {t("admin.onbcamp_eligible", { n: stats.eligible_unsynced })}
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["onboarding_campaign", t("admin.campaign_preview_invite")],
                ["onboarding_campaign_reminder", t("admin.campaign_preview_reminder")],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPreviewKind(k)}
                className={`rounded-full px-2.5 py-1 text-[11px] ring-1 transition ${
                  previewKind === k
                    ? "bg-neutral-900 text-paper-50 ring-neutral-900 dark:bg-paper-100 dark:text-umber-900 dark:ring-paper-100"
                    : "text-neutral-500 ring-ink-100 dark:text-umber-300 dark:ring-umber-700"
                }`}
              >
                {label}
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
          <EmailPreview kind={previewKind} locale={previewLocale} />
        </section>
      </div>

      {selected != null && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">{t("admin.onbcamp_contacts")}</h2>
            <p className="text-xs text-neutral-500 dark:text-umber-300">
              {t("admin.onbcamp_contacts_hint")}
            </p>
          </div>
          {sends == null ? (
            <Skeleton variant="block" height={110} rounded="lg" />
          ) : sends.length === 0 ? (
            <AdminEmptyState title={t("admin.onbcamp_contacts_empty")} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl ring-1 ring-ink-100 dark:ring-umber-700">
                <table className="w-full text-[13px]">
                  <tbody>
                    {sends.slice(0, CONTACT_ROWS).map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-ink-100 last:border-0 dark:border-umber-700"
                      >
                        <td className="px-3 py-1.5 font-medium">{s.name || "—"}</td>
                        <td className="px-3 py-1.5 text-neutral-500 dark:text-umber-300">
                          {s.email}
                        </td>
                        <td className="px-3 py-1.5">
                          {s.converted ? (
                            <Pill tone="sage">{t("admin.onbcamp_send_converted")}</Pill>
                          ) : s.status === "failed" ? (
                            <Pill tone="blush">{t("admin.campaign_send_failed")}</Pill>
                          ) : s.status === "skipped" ? (
                            <Pill tone="muted">{t("admin.onbcamp_send_skipped")}</Pill>
                          ) : s.status === "sent" ? (
                            <Pill tone="violet">{t("admin.campaign_send_sent")}</Pill>
                          ) : (
                            <Pill tone="muted">{t("admin.onbcamp_send_queued")}</Pill>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {s.reminded && (
                            <span className="text-[11px] text-neutral-400 dark:text-umber-400">
                              {t("admin.onbcamp_reminded_badge")}
                            </span>
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
              {sends.length > CONTACT_ROWS && (
                <p className="text-xs text-neutral-500 dark:text-umber-300">
                  {t("admin.onbcamp_contacts_more", { n: sends.length - CONTACT_ROWS })}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
