// Admin console for the vendor claim-invite campaign (KEZELÉS → Meghívó
// kampány). Cold mail cannot be unsent, so the page is built around looking
// before you leap: the target list (exact addresses, category, language) is the
// biggest thing on the screen, and starting a campaign is a deliberate second
// step after reading it.
//
// The affordances mirror the backend's: there is no "send everything now"
// button. An operator starts the campaign and the worker paces it out inside
// the rolling daily cap; the small manual batch exists only for a supervised
// first round.

import type {
  VendorCampaign,
  VendorCampaignDetail,
  VendorCampaignSend,
  VendorCampaignStats,
  VendorCampaignTarget,
} from "@shared/vendor_campaign";
import { VENDOR_CAMPAIGN_DEFAULT_DAILY_CAP } from "@shared/vendor_campaign";
import { CheckCircle2, MailX, Pause, Play, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminEmptyState, AdminPageHeader, AdminSectionHeader, Pill } from "../components/admin";
import { Button, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminVendorCampaignApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const MANUAL_BATCH_SIZE = 10;

function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl bg-paper-100 p-4 ring-1 ring-ink-100 dark:bg-umber-900 dark:ring-umber-700">
      <div className="font-grotesk text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-neutral-500 dark:text-umber-300">{label}</div>
      {hint != null && (
        <div className="mt-1 text-[11px] text-neutral-400 dark:text-umber-400">{hint}</div>
      )}
    </div>
  );
}

export default function AdminVendorCampaignPage() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();

  const [campaigns, setCampaigns] = useState<VendorCampaign[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<VendorCampaignDetail | null>(null);
  const [targets, setTargets] = useState<VendorCampaignTarget[] | null>(null);
  const [sends, setSends] = useState<VendorCampaignSend[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [slug, setSlug] = useState("");
  const [country, setCountry] = useState("");
  const [dailyCap, setDailyCap] = useState(String(VENDOR_CAMPAIGN_DEFAULT_DAILY_CAP));
  const [optOutEmail, setOptOutEmail] = useState("");

  const refreshList = useCallback(async () => {
    const r = await adminVendorCampaignApi.list();
    setCampaigns(r.campaigns);
    setSelectedId((prev) => prev ?? r.campaigns[0]?.id ?? null);
  }, []);

  const refreshDetail = useCallback(async (id: number) => {
    const [d, tg, sd] = await Promise.all([
      adminVendorCampaignApi.detail(id),
      adminVendorCampaignApi.targets(id),
      adminVendorCampaignApi.sends(id),
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

  async function onCreate() {
    const cap = Number.parseInt(dailyCap, 10);
    if (!Number.isInteger(cap) || cap < 1) {
      toast.error(t("admin.campaign_err_cap"));
      return;
    }
    await run(async () => {
      const r = await adminVendorCampaignApi.create({
        slug: slug.trim(),
        daily_cap: cap,
        country: country.trim() === "" ? null : country.trim().toUpperCase(),
      });
      setSlug("");
      setCountry("");
      setSelectedId(r.campaign.id);
      toast.success(t("admin.campaign_created"));
    });
  }

  async function onToggleStatus(campaign: VendorCampaign) {
    const next = campaign.status === "running" ? "paused" : "running";
    if (next === "running") {
      // Starting a campaign puts mail in strangers' inboxes; make the operator
      // acknowledge the size of what is about to go out.
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
    await run(() => adminVendorCampaignApi.update(campaign.id, { status: next }));
  }

  async function onSendBatch(campaign: VendorCampaign) {
    const ok = await confirm({
      title: t("admin.campaign_batch_confirm_title"),
      body: t("admin.campaign_batch_confirm_body", { n: MANUAL_BATCH_SIZE }),
      confirmLabel: t("admin.campaign_batch_confirm_cta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await run(async () => {
      const r = await adminVendorCampaignApi.sendBatch(campaign.id, MANUAL_BATCH_SIZE);
      toast.success(t("admin.campaign_batch_sent", { n: r.sent }));
    });
  }

  async function onOptOut() {
    const email = optOutEmail.trim();
    if (!email.includes("@")) {
      toast.error(t("admin.campaign_err_email"));
      return;
    }
    await run(async () => {
      await adminVendorCampaignApi.optOut(email);
      setOptOutEmail("");
      toast.success(t("admin.campaign_optout_added"));
    });
  }

  const selected = campaigns?.find((c) => c.id === selectedId) ?? null;
  const stats: VendorCampaignStats | null = detail?.stats ?? null;

  return (
    <div>
      <AdminPageHeader
        title={t("admin.campaign_title")}
        subtitle={t("admin.campaign_subtitle")}
        actions={
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await adminVendorCampaignApi.runReminders();
                toast.success(t("admin.campaign_reminders_sent", { n: r.sent }));
              })
            }
          >
            {t("admin.campaign_run_reminders")}
          </Button>
        }
      />

      {/* Create */}
      <section className="admin-card mb-6">
        <AdminSectionHeader title={t("admin.campaign_new")} />
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="campaign-slug">
              {t("admin.campaign_slug")}
            </label>
            <input
              id="campaign-slug"
              className="input"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="claim-invite-2026-07"
              maxLength={61}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="campaign-country">
              {t("admin.campaign_country")}
            </label>
            <input
              id="campaign-country"
              className="input"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder={t("admin.campaign_country_all")}
              maxLength={2}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="campaign-cap">
              {t("admin.campaign_daily_cap")}
            </label>
            <input
              id="campaign-cap"
              className="input"
              type="number"
              min={1}
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={() => void onCreate()} disabled={busy || slug.trim().length < 2}>
            {t("admin.campaign_create")}
          </Button>
        </div>
      </section>

      {/* Campaign picker */}
      {campaigns == null ? (
        <Skeleton variant="block" height={72} rounded="lg" />
      ) : campaigns.length === 0 ? (
        <AdminEmptyState title={t("admin.campaign_empty")} />
      ) : (
        <div className="mb-6 flex flex-wrap gap-2">
          {campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className={`rounded-full px-3 py-1.5 text-sm ring-1 transition ${
                c.id === selectedId
                  ? "bg-neutral-900 text-paper-50 ring-neutral-900 dark:bg-paper-100 dark:text-umber-900 dark:ring-paper-100"
                  : "bg-transparent text-ink-700 ring-ink-100 dark:text-paper-100 dark:ring-umber-700"
              }`}
            >
              {c.slug}
              {c.country != null ? ` · ${c.country}` : ""}
            </button>
          ))}
        </div>
      )}

      {selected != null && (
        <section className="admin-card mb-6">
          <AdminSectionHeader
            title={selected.slug}
            actions={
              <div className="flex items-center gap-2">
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
            }
          />

          {stats == null ? (
            <Skeleton variant="block" height={96} rounded="lg" className="mt-4" />
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <StatTile label={t("admin.campaign_stat_remaining")} value={stats.remaining} />
                <StatTile
                  label={t("admin.campaign_stat_sent")}
                  value={stats.sent}
                  hint={t("admin.campaign_stat_today", {
                    n: stats.sent_last_24h,
                    cap: selected.daily_cap,
                  })}
                />
                <StatTile label={t("admin.campaign_stat_opened")} value={stats.opened} />
                <StatTile label={t("admin.campaign_stat_clicked")} value={stats.clicked} />
                <StatTile label={t("admin.campaign_stat_reminded")} value={stats.reminded} />
                <StatTile label={t("admin.campaign_stat_claimed")} value={stats.claimed} />
                <StatTile label={t("admin.campaign_stat_failed")} value={stats.failed} />
              </div>
              {/* What the invite copy is currently promising. Reads off the live
                  offer so the console and the mail can't drift apart. */}
              <p className="mt-3 text-xs text-neutral-500 dark:text-umber-300">
                {detail?.offer.tier === "trial"
                  ? t("admin.campaign_offer_none")
                  : t("admin.campaign_offer", {
                      months: detail?.offer.tier === "founding" ? 12 : 3,
                      left: detail?.offer.spots_left ?? 0,
                      cap: detail?.offer.cap ?? 0,
                    })}
              </p>
            </>
          )}
        </section>
      )}

      {/* Targets: the look-before-you-leap list. */}
      {selected != null && (
        <section className="admin-card mb-6">
          <AdminSectionHeader
            title={t("admin.campaign_targets")}
            description={t("admin.campaign_targets_hint")}
          />
          {targets == null ? (
            <Skeleton variant="block" height={120} rounded="lg" className="mt-4" />
          ) : targets.length === 0 ? (
            <AdminEmptyState title={t("admin.campaign_targets_empty")} />
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {targets.map((tg) => (
                    <tr
                      key={tg.listing_id}
                      className="border-b border-ink-100 last:border-0 dark:border-umber-700"
                    >
                      <td className="py-2 pr-3 font-medium">{tg.listing_name}</td>
                      <td className="py-2 pr-3 text-neutral-500 dark:text-umber-300">{tg.email}</td>
                      <td className="py-2 pr-3 text-neutral-500 dark:text-umber-300">
                        {tg.category}
                      </td>
                      <td className="py-2 pr-3 text-neutral-500 dark:text-umber-300">
                        {tg.city} · {tg.country}
                      </td>
                      <td className="py-2 uppercase text-neutral-400 dark:text-umber-400">
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

      {/* Sends */}
      {selected != null && sends != null && sends.length > 0 && (
        <section className="admin-card mb-6">
          <AdminSectionHeader title={t("admin.campaign_sends")} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {sends.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-ink-100 last:border-0 dark:border-umber-700"
                  >
                    <td className="py-2 pr-3 font-medium">{s.listing_name}</td>
                    <td className="py-2 pr-3 text-neutral-500 dark:text-umber-300">{s.email}</td>
                    <td className="py-2 pr-3">
                      {s.claimed ? (
                        <Pill tone="sage">
                          <CheckCircle2 size={11} aria-hidden />
                          {t("admin.campaign_send_claimed")}
                        </Pill>
                      ) : s.clicked_at != null ? (
                        <Pill tone="violet">{t("admin.campaign_send_clicked")}</Pill>
                      ) : s.status === "failed" ? (
                        <Pill tone="blush">{t("admin.campaign_send_failed")}</Pill>
                      ) : s.reminder_sent_at != null ? (
                        <Pill tone="muted">{t("admin.campaign_send_reminded")}</Pill>
                      ) : (
                        <Pill tone="muted">{t("admin.campaign_send_sent")}</Pill>
                      )}
                    </td>
                    <td className="py-2 uppercase text-neutral-400 dark:text-umber-400">
                      {s.locale}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Manual suppression */}
      <section className="admin-card">
        <AdminSectionHeader
          title={t("admin.campaign_optout")}
          description={t("admin.campaign_optout_hint")}
        />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="field-label" htmlFor="campaign-optout">
              {t("admin.campaign_optout_email")}
            </label>
            <input
              id="campaign-optout"
              className="input"
              type="email"
              value={optOutEmail}
              onChange={(e) => setOptOutEmail(e.target.value)}
            />
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => void onOptOut()}>
            <MailX size={14} aria-hidden />
            {t("admin.campaign_optout_add")}
          </Button>
        </div>
      </section>
    </div>
  );
}
