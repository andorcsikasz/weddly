// Workspace overview: KPI tiles (countdown, RSVPs, spend, seated), an RSVP
// breakdown bar, a derived setup-checklist, and quick links to the deep tools.

import type {
  BudgetCategory,
  BudgetGoal,
  BudgetLine,
  Couple,
  CoupleInvite,
  Guest,
} from "@shared/types";
import {
  CalendarHeart,
  ChefHat,
  Heart,
  Mail,
  Printer,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { CostPlanningCard } from "../components/CostPlanningCard";
import { applyCategoryPlanned } from "../lib/budget";
import { budgetApi, coupleApi, guestApi, seatingApi } from "../lib/endpoints";
import { formatHuf, formatNumber, formatWeddingDateGoal } from "../lib/format";
import { useT } from "../lib/i18n";

type Loaded = {
  couple: Couple;
  guests: Guest[];
  lines: BudgetLine[];
  tableCount: number;
  seatedGuestIds: Set<number>;
};

function budgetCapHuf(goal: BudgetGoal): number | null {
  if (goal.kind === "exact") return goal.exact_huf;
  // For ranges, the upper bound is the cap users care about on a dashboard.
  if (goal.kind === "range") return goal.max_huf;
  return null;
}

function targetGuestCount(couple: Couple): number | null {
  const g = couple.guest_count_goal;
  if (g.kind === "exact") return g.exact;
  if (g.kind === "range" && g.min !== null && g.max !== null) {
    return Math.round((g.min + g.max) / 2);
  }
  return null;
}

export default function DashboardPage() {
  const { t, locale } = useT();
  const [data, setData] = useState<Loaded | null | "loading">("loading");
  const [invite, setInvite] = useState<CoupleInvite | null>(null);
  const [copied, setCopied] = useState(false);
  // Cost-planning slider — defaults to baseline once couple loads.
  const [planningCount, setPlanningCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const couple = (await coupleApi.current()).couple;
      if (!couple) {
        setData(null);
        return;
      }
      const [guestsR, linesR, planR] = await Promise.all([
        guestApi.list(),
        budgetApi.listLines(),
        seatingApi.plan(),
      ]);
      setData({
        couple,
        guests: guestsR.guests,
        lines: linesR.lines,
        tableCount: planR.tables.length,
        seatedGuestIds: new Set(planR.assignments.map((a) => a.guest_id)),
      });
    })();
  }, []);

  if (data === "loading") return null;
  if (data === null) return <Navigate to="/onboarding" replace />;

  const { couple, guests, lines, tableCount, seatedGuestIds } = data;

  // ── Days countdown — only meaningful when an exact date is locked. ─────
  const exactDate = couple.wedding_date_goal.kind === "exact" ? couple.wedding_date : null;
  const rawDelta = exactDate
    ? Math.round((new Date(`${exactDate}T00:00:00`).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const daysUntil = rawDelta !== null ? Math.max(0, rawDelta) : null;
  // True if we have an exact date AND it's already passed.
  const weddingPast = rawDelta !== null && rawDelta < 0;

  // ── RSVP breakdown ────────────────────────────────────────────────────
  const rsvp = { yes: 0, no: 0, maybe: 0, pending: 0 };
  for (const g of guests) rsvp[g.rsvp_status] += 1;
  const totalGuests = guests.length;
  const targetCount = targetGuestCount(couple);
  // Denominator for "X of Y confirmed": if the couple set a target, use that;
  // otherwise fall back to the actual list size so the % stays meaningful.
  const guestDenominator = targetCount ?? totalGuests;

  // ── Budget ────────────────────────────────────────────────────────────
  const totalPlanned = lines.reduce((s, l) => s + l.planned_huf, 0);
  const totalActual = lines.reduce((s, l) => s + l.actual_huf, 0);
  const cap = budgetCapHuf(couple.budget_goal);
  const spentPct = cap && cap > 0 ? Math.min(100, Math.round((totalActual / cap) * 100)) : null;
  const overCap = cap !== null && totalPlanned > cap;
  const costPerConfirmedGuest =
    rsvp.yes > 0 && totalActual > 0 ? Math.round(totalActual / rsvp.yes) : null;

  // ── Cost-planning baseline & inline-edit handler ──────────────────────
  // Same baseline rules as BudgetPage so the slider stays consistent across
  // pages (target headcount → range midpoint → 100 fallback).
  const baselineCount = targetCount ?? (totalGuests > 0 ? totalGuests : 100);
  const effectivePlanningCount = planningCount ?? baselineCount;
  async function setCategoryPlanned(category: BudgetCategory, newTotal: number) {
    if (data === "loading" || data === null) return;
    try {
      const next = await applyCategoryPlanned(
        category,
        newTotal,
        lines,
        t(`budget.cat.${category}`),
      );
      setData({ ...data, lines: next });
    } catch {
      // Refetch lines on failure.
      const r = await budgetApi.listLines();
      setData({ ...data, lines: r.lines });
    }
  }

  // ── Seating ───────────────────────────────────────────────────────────
  const confirmedGuests = guests.filter((g) => g.rsvp_status === "yes");
  const seatedConfirmed = confirmedGuests.filter((g) => seatedGuestIds.has(g.id)).length;

  // ── Setup checklist (derived — no `tasks` table in v1). ───────────────
  // `to` lets the "Next step" CTA jump straight to the relevant page.
  const tasks: { key: string; done: boolean; to?: string }[] = [
    {
      key: "task_lock_guests",
      done: couple.guest_count_goal.kind !== "tbd",
      to: "/onboarding",
    },
    { key: "task_lock_budget", done: couple.budget_goal.kind !== "tbd", to: "/onboarding" },
    { key: "task_set_date", done: couple.wedding_date_goal.kind === "exact", to: "/onboarding" },
    // Partner invite happens inline on this page — no `to`.
    { key: "task_invite_partner", done: couple.partner_b_id !== null },
    { key: "task_add_guests", done: totalGuests > 0, to: "/app/guests" },
    { key: "task_plan_budget", done: lines.length > 0, to: "/app/budget" },
    {
      key: "task_under_cap",
      done: cap === null ? false : !overCap && lines.length > 0,
      to: "/app/budget",
    },
    {
      key: "task_get_rsvps",
      done: rsvp.yes + rsvp.no + rsvp.maybe > 0,
      to: "/app/guests",
    },
    { key: "task_add_tables", done: tableCount > 0, to: "/app/seating" },
    {
      key: "task_seat_guests",
      done: confirmedGuests.length > 0 && seatedConfirmed === confirmedGuests.length,
      to: "/app/seating",
    },
  ];
  const tasksDone = tasks.filter((t) => t.done).length;
  const tasksTotal = tasks.length;
  const nextTask = tasks.find((task) => !task.done);

  // ── Invite-partner inline card ────────────────────────────────────────
  const inviteUrl = invite ? `${window.location.origin}/invite/${invite.token}` : null;
  async function onInvitePartner() {
    const r = await coupleApi.createInvite({});
    setInvite(r.invite);
  }
  function onCopy() {
    if (!inviteUrl) return;
    navigator.clipboard?.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const dateText = formatWeddingDateGoal(couple.wedding_date_goal, { t, locale });

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl">{couple.display_name}</h1>
          <p className="mt-1 text-sm text-ink-600">{dateText}</p>
        </div>
        <div className="text-xs uppercase tracking-wide text-ink-500">{t("dashboard.title")}</div>
      </header>

      {/* ── Next-action CTA — surfaces the first incomplete checklist item. ── */}
      {nextTask &&
        (nextTask.to ? (
          <Link to={nextTask.to} className="btn-primary mb-6 inline-flex">
            {t("dashboard.next_action_label", { label: t(`dashboard.${nextTask.key}`) })}
          </Link>
        ) : (
          <div className="mb-6 inline-flex rounded-xl bg-blush-50 px-4 py-2 text-sm font-medium text-blush-800">
            {t("dashboard.next_action_label", { label: t(`dashboard.${nextTask.key}`) })}
          </div>
        ))}

      {/* ── KPI tiles ─────────────────────────────────────────────── */}
      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {weddingPast ? (
          <PastWeddingTile
            label={t("dashboard.kpi_days_past")}
            sub={t("dashboard.kpi_days_past_sub")}
            seatingHref="/app/seating"
            seatingLabel={t("dashboard.kpi_days_past_seating_pdf")}
            guestsHref="/app/guests"
            guestsLabel={t("dashboard.kpi_days_past_guest_csv")}
          />
        ) : (
          <KpiTile
            label={t("dashboard.kpi_days_label")}
            icon={<CalendarHeart size={16} aria-hidden="true" />}
            value={daysUntil !== null ? formatNumber(daysUntil, locale) : "—"}
            unit={daysUntil !== null ? t("dashboard.kpi_days_unit") : t("dashboard.kpi_days_tbd")}
            accent="blush"
          />
        )}
        <KpiTile
          label={t("dashboard.kpi_guests_label")}
          icon={<Users size={16} aria-hidden="true" />}
          value={formatNumber(rsvp.yes, locale)}
          unit={
            guestDenominator > 0
              ? t("dashboard.kpi_guests_unit", { total: formatNumber(guestDenominator, locale) })
              : t("dashboard.kpi_guests_no_data")
          }
          progress={
            guestDenominator > 0
              ? Math.min(100, Math.round((rsvp.yes / guestDenominator) * 100))
              : null
          }
        />
        <KpiTile
          label={t("dashboard.kpi_budget_label")}
          icon={<Wallet size={16} aria-hidden="true" />}
          value={formatHuf(totalActual, locale)}
          unit={
            cap !== null
              ? t("dashboard.kpi_budget_unit", { cap: formatHuf(cap, locale) })
              : t("dashboard.kpi_budget_no_cap")
          }
          progress={spentPct}
          progressOver={cap !== null && totalActual > cap}
        />
        <KpiTile
          label={t("dashboard.kpi_seated_label")}
          icon={<ChefHat size={16} aria-hidden="true" />}
          value={formatNumber(seatedConfirmed, locale)}
          unit={
            confirmedGuests.length > 0
              ? t("dashboard.kpi_seated_unit", {
                  total: formatNumber(confirmedGuests.length, locale),
                })
              : t("dashboard.kpi_seated_no_data")
          }
          progress={
            confirmedGuests.length > 0
              ? Math.round((seatedConfirmed / confirmedGuests.length) * 100)
              : null
          }
        />
      </section>

      {/* ── Two-column body: tasks + breakdowns ────────────────────── */}
      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        {/* Tasks (spans 2/3 on lg). */}
        <div className="card lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h2>{t("dashboard.tasks_title")}</h2>
            <span className="text-xs text-ink-500">
              {t("dashboard.tasks_progress", { done: tasksDone, total: tasksTotal })}
            </span>
          </div>
          <div
            className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-paper-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={tasksTotal}
            aria-valuenow={tasksDone}
            aria-label={t("dashboard.tasks_progress", { done: tasksDone, total: tasksTotal })}
          >
            <div
              className="h-full rounded-full bg-blush-500 transition-all"
              style={{ width: `${(tasksDone / tasksTotal) * 100}%` }}
            />
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {tasks.map((task) => (
              <li
                key={task.key}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  task.done ? "text-ink-500" : "text-ink-800"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    task.done
                      ? "border-blush-500 bg-blush-500 text-white"
                      : "border-paper-400 bg-white"
                  }`}
                >
                  {task.done && (
                    <svg
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3 w-3"
                      aria-hidden="true"
                    >
                      <path d="M2.5 6.5L5 9l4.5-5" />
                    </svg>
                  )}
                </span>
                <span className={task.done ? "line-through decoration-ink-300" : ""}>
                  {t(`dashboard.${task.key}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* RSVP breakdown + cost-per-guest. */}
        <div className="grid gap-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-ink-700">
              {t("dashboard.rsvp_breakdown_title")}
            </h3>
            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-paper-200">
              <Segment count={rsvp.yes} total={Math.max(totalGuests, 1)} className="bg-blush-500" />
              <Segment
                count={rsvp.maybe}
                total={Math.max(totalGuests, 1)}
                className="bg-blush-300"
              />
              <Segment count={rsvp.no} total={Math.max(totalGuests, 1)} className="bg-ink-300" />
              <Segment
                count={rsvp.pending}
                total={Math.max(totalGuests, 1)}
                className="bg-paper-400"
              />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <RsvpRow swatch="bg-blush-500" label={t("dashboard.rsvp_yes")} value={rsvp.yes} />
              <RsvpRow swatch="bg-blush-300" label={t("dashboard.rsvp_maybe")} value={rsvp.maybe} />
              <RsvpRow swatch="bg-ink-300" label={t("dashboard.rsvp_no")} value={rsvp.no} />
              <RsvpRow
                swatch="bg-paper-400"
                label={t("dashboard.rsvp_pending")}
                value={rsvp.pending}
              />
            </dl>
          </div>
        </div>
      </section>

      {/* ── Cost planning panel — full-width, inline-edit per category. ── */}
      <section className="mb-8">
        <CostPlanningCard
          lines={lines}
          baseline={baselineCount}
          cap={cap}
          count={effectivePlanningCount}
          onCountChange={setPlanningCount}
          onEditPlanned={setCategoryPlanned}
        />
        {costPerConfirmedGuest !== null && (
          <p className="mt-2 text-right text-xs text-ink-500">
            {t("dashboard.cost_per_guest")}:{" "}
            <span className="stat-num font-medium text-ink-700">
              {formatHuf(costPerConfirmedGuest, locale)}
            </span>
          </p>
        )}
      </section>

      {/* ── Invite partner — only if not yet linked. ───────────────── */}
      {!couple.partner_b_id && (
        <section className="card stationery mb-8">
          <h2>{t("dashboard.invite_partner")}</h2>
          <p className="mt-2 text-sm text-ink-700">{t("dashboard.invite_partner_help")}</p>
          {inviteUrl ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input className="input flex-1" readOnly value={inviteUrl} />
              <button type="button" className="btn-primary" onClick={onCopy}>
                {copied ? t("dashboard.link_copied") : t("dashboard.copy_link")}
              </button>
            </div>
          ) : (
            <button type="button" className="btn-accent mt-4" onClick={onInvitePartner}>
              <Mail size={16} /> {t("dashboard.invite_partner")}
            </button>
          )}
        </section>
      )}

      {/* ── Quick links ───────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
          {t("dashboard.quick_links_title")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureLink
            to="/app/guests"
            icon={<Users size={20} />}
            title={t("dashboard.feature_guests")}
          />
          <FeatureLink
            to="/app/budget"
            icon={<UtensilsCrossed size={20} />}
            title={t("dashboard.feature_budget")}
          />
          <FeatureLink
            to="/app/seating"
            icon={<ChefHat size={20} />}
            title={t("dashboard.feature_seating")}
          />
          <FeatureLink
            to="/app/seating"
            icon={<Printer size={20} />}
            title={t("dashboard.feature_print")}
          />
          <FeatureLink
            to="/app/suppliers"
            icon={<Heart size={20} />}
            title={t("dashboard.feature_suppliers")}
          />
        </div>
      </section>
    </AppShell>
  );
}

function KpiTile({
  label,
  icon,
  value,
  unit,
  progress,
  progressOver,
  accent,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  unit: string;
  progress?: number | null;
  progressOver?: boolean;
  accent?: "blush";
}) {
  const accentBg = accent === "blush" ? "bg-blush-50" : "bg-paper-50";
  const accentRing = accent === "blush" ? "text-blush-700" : "text-ink-700";
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-500">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${accentBg} ${accentRing}`}
        >
          {icon}
        </span>
        {label}
      </div>
      <div className="stat-num mt-3 text-3xl font-semibold leading-none text-ink-900">{value}</div>
      <div className="mt-1 text-xs text-ink-500">{unit}</div>
      {progress !== undefined && progress !== null && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-paper-200">
          <div
            className={`h-full rounded-full transition-all ${
              progressOver ? "bg-blush-700" : "bg-ink-700"
            }`}
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PastWeddingTile({
  label,
  sub,
  seatingHref,
  seatingLabel,
  guestsHref,
  guestsLabel,
}: {
  label: string;
  sub: string;
  seatingHref: string;
  seatingLabel: string;
  guestsHref: string;
  guestsLabel: string;
}) {
  return (
    <div className="card bg-blush-50">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-blush-700">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blush-100 text-blush-700">
          <Heart size={14} aria-hidden="true" />
        </span>
        {label}
      </div>
      <div className="stat-num mt-3 text-xl font-semibold leading-tight text-ink-900">{sub}</div>
      <div className="mt-3 flex flex-col gap-1.5 text-sm">
        <Link to={seatingHref} className="text-blush-800 underline-offset-2 hover:underline">
          {seatingLabel}
        </Link>
        <Link to={guestsHref} className="text-blush-800 underline-offset-2 hover:underline">
          {guestsLabel}
        </Link>
      </div>
    </div>
  );
}

function Segment({
  count,
  total,
  className,
}: {
  count: number;
  total: number;
  className: string;
}) {
  if (count <= 0) return null;
  const pct = (count / total) * 100;
  return <div className={className} style={{ width: `${pct}%` }} aria-hidden="true" />;
}

function RsvpRow({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <>
      <dt className="flex items-center gap-2 text-ink-700">
        <span className={`inline-block h-2 w-2 rounded-full ${swatch}`} />
        {label}
      </dt>
      <dd className="stat-num text-right font-medium text-ink-900">{value}</dd>
    </>
  );
}

function FeatureLink({ to, icon, title }: { to: string; icon: JSX.Element; title: string }) {
  return (
    <Link to={to} className="card-hover flex items-center gap-3">
      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-700">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
    </Link>
  );
}
