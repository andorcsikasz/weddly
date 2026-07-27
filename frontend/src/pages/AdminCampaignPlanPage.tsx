// Admin "Terv" — the standing campaign plan, and the first tab of KEZELÉS →
// Kampányok because it is the surface an operator should be able to live in.
//
// The four consoles behind the other tabs are for composing and inspecting one
// campaign. This page is the opposite: it never asks anything: each family's
// next campaign is already built, its audience already resolved, and the whole
// interaction is one Run button per card. The two knobs the user actually
// changes (does it repeat, and how often) sit on the card itself.
//
// Editing model: switches PATCH on click, number fields PATCH on blur/Enter.
// No save button, because there is nothing here worth a two-step commit.

import type { CampaignScheduleKind, CampaignScheduleView } from "@shared/campaign_schedules";
import { CAMPAIGN_SCHEDULE_DAY_MS } from "@shared/campaign_schedules";
import { CalendarClock, Play, Rocket, Send, Sparkles, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import { Button, Skeleton, Switch, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminCampaignScheduleApi } from "../lib/endpoints";
import { intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

/** Per-family presentation: the icon, the name (reused from the tab labels so
 *  the plan and the console never disagree) and which console tab it opens. */
const KIND_META: Record<
  CampaignScheduleKind,
  { icon: typeof Send; nameKey: string; whatKey: string; tab: string }
> = {
  vendor_claim: {
    icon: Send,
    nameKey: "admin.nav_vendor_campaign",
    whatKey: "admin.plan_what_vendor_claim",
    tab: "invite",
  },
  vendor_review: {
    icon: Star,
    nameKey: "admin.nav_vendor_review_campaign",
    whatKey: "admin.plan_what_vendor_review",
    tab: "reviews",
  },
  onboarding: {
    icon: Rocket,
    nameKey: "admin.plan_what_onboarding_name",
    whatKey: "admin.plan_what_onboarding",
    tab: "onboarding",
  },
};

function fmtDate(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

/** A small labelled number input that only reports upward when it settles, so a
 *  three-digit cap is one PATCH instead of three. */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number.parseInt(draft, 10);
    if (!Number.isInteger(n) || n < min || n > max) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };

  return (
    <div className="w-[104px]">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}

function ScheduleCard({
  item,
  busy,
  onPatch,
  onPrepare,
  onRun,
}: {
  item: CampaignScheduleView;
  busy: boolean;
  onPatch: (patch: {
    enabled?: boolean;
    interval_days?: number;
    daily_cap?: number;
    auto_start?: boolean;
  }) => void;
  onPrepare: () => void;
  onRun: () => void;
}) {
  const { t, locale } = useT();
  const meta = KIND_META[item.schedule.kind];
  const Icon = meta.icon;
  const prepared = item.prepared;
  const canRun = prepared != null && prepared.status === "paused";

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-paper-100 p-4 ring-1 ring-ink-100 dark:bg-umber-800 dark:ring-umber-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-ink-700 ring-1 ring-ink-100 dark:bg-umber-900 dark:text-paper-100 dark:ring-umber-700">
            <Icon size={16} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{t(meta.nameKey)}</h2>
              {prepared != null && (
                <Pill
                  tone={
                    prepared.status === "running"
                      ? "sage"
                      : prepared.status === "done"
                        ? "muted"
                        : "violet"
                  }
                >
                  {t(`admin.campaign_status_${prepared.status}`)}
                </Pill>
              )}
            </div>
            <p className="text-sm text-neutral-500 dark:text-umber-300">{t(meta.whatKey)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to={`/app/admin/campaigns?tab=${meta.tab}`}
            className="text-[13px] text-neutral-500 underline-offset-2 hover:underline dark:text-umber-300"
          >
            {t("admin.plan_open_console")}
          </Link>
          {canRun ? (
            <Button disabled={busy} onClick={onRun}>
              <Play size={14} aria-hidden />
              {t("admin.plan_run")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={busy || prepared?.status === "running"}
              onClick={onPrepare}
            >
              <Sparkles size={14} aria-hidden />
              {t("admin.plan_prepare")}
            </Button>
          )}
        </div>
      </div>

      {/* What is waiting, and when the next round lands. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-neutral-500 dark:text-umber-300">
        <span>
          {prepared != null && prepared.status !== "done"
            ? t("admin.plan_prepared", { slug: prepared.slug, n: prepared.remaining })
            : t("admin.plan_reach", { n: item.reach })}
        </span>
        {item.cooling_down > 0 && (
          <span>
            {t("admin.plan_cooling", {
              n: item.cooling_down,
              days: item.recipe.cooldown_days,
            })}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <CalendarClock size={13} aria-hidden />
          {item.schedule.enabled
            ? t("admin.plan_next", {
                date: fmtDate(
                  Math.max(item.schedule.next_due_at, Date.now() - CAMPAIGN_SCHEDULE_DAY_MS),
                  locale,
                ),
              })
            : t("admin.plan_no_repeat")}
        </span>
      </div>

      {/* The knobs. */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-ink-100 pt-3 dark:border-umber-700">
        <div className="flex items-center gap-2 pb-1.5">
          <Switch
            checked={item.schedule.enabled}
            disabled={busy}
            onChange={(next) => onPatch({ enabled: next })}
            label={t("admin.plan_repeat")}
          />
          <span className="text-[13px]">{t("admin.plan_repeat")}</span>
        </div>
        <NumberField
          id={`sch-int-${item.schedule.id}`}
          label={t("admin.plan_interval")}
          value={item.schedule.interval_days}
          min={1}
          max={365}
          disabled={busy}
          onCommit={(n) => onPatch({ interval_days: n })}
        />
        <NumberField
          id={`sch-cap-${item.schedule.id}`}
          label={t("admin.campaign_daily_cap")}
          value={item.schedule.daily_cap}
          min={1}
          max={200}
          disabled={busy}
          onCommit={(n) => onPatch({ daily_cap: n })}
        />
        <div className="flex items-center gap-2 pb-1.5">
          <Switch
            checked={item.schedule.auto_start}
            disabled={busy}
            onChange={(next) => onPatch({ auto_start: next })}
            label={t("admin.plan_auto_start")}
          />
          <span className="text-[13px]">{t("admin.plan_auto_start")}</span>
        </div>
      </div>
    </div>
  );
}

export default function AdminCampaignPlanPage() {
  const { t } = useT();
  const toast = useToast();
  const [items, setItems] = useState<CampaignScheduleView[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const plan = await adminCampaignScheduleApi.list();
    setItems(plan.items);
  }, []);

  useEffect(() => {
    void refresh().catch(() => toast.error(t("common.error_generic")));
  }, [refresh, toast, t]);

  /** Every mutation replaces the one card it touched, so a tuned interval never
   *  flickers back through a full-list refetch. */
  const swap = (next: CampaignScheduleView) =>
    setItems((prev) =>
      prev == null ? prev : prev.map((it) => (it.schedule.id === next.schedule.id ? next : it)),
    );

  async function run(id: number, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
      void refresh().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader title={t("admin.plan_title")} subtitle={t("admin.plan_subtitle")} />

      {items == null ? (
        <div className="flex flex-col gap-3">
          <Skeleton variant="block" height={150} rounded="lg" />
          <Skeleton variant="block" height={150} rounded="lg" />
        </div>
      ) : items.length === 0 ? (
        <AdminEmptyState title={t("admin.plan_empty")} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <ScheduleCard
              key={item.schedule.id}
              item={item}
              busy={busyId === item.schedule.id}
              onPatch={(patch) =>
                void run(item.schedule.id, async () => {
                  swap(await adminCampaignScheduleApi.update(item.schedule.id, patch));
                })
              }
              onPrepare={() =>
                void run(item.schedule.id, async () => {
                  const r = await adminCampaignScheduleApi.prepare(item.schedule.id);
                  swap(r.item);
                  if (r.result.prepared) {
                    toast.success(t("admin.plan_prepared_toast", { n: r.result.reach }));
                  } else if (r.result.reason === "too_few_targets") {
                    toast.error(t("admin.plan_skip_too_few", { n: r.result.reach }));
                  } else {
                    toast.error(t("admin.plan_skip_in_flight"));
                  }
                })
              }
              onRun={() =>
                void run(item.schedule.id, async () => {
                  const r = await adminCampaignScheduleApi.run(item.schedule.id);
                  swap(r.item);
                  toast.success(t("admin.plan_started_toast"));
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
