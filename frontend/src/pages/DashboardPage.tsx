// Workspace overview: KPI tiles (countdown, RSVPs, spend, seated), an RSVP
// breakdown bar, a derived setup-checklist, and quick links to the deep tools.

import type {
  BudgetCategory,
  BudgetGoal,
  BudgetLine,
  Couple,
  CoupleInvite,
  Guest,
  WeddingDateGoal,
} from "@shared/types";
import {
  CalendarHeart,
  ChefHat,
  Coins,
  Heart,
  Mail,
  Printer,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { type FormEvent, type JSX, type ReactNode, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { CostPlanningCard } from "../components/CostPlanningCard";
import { useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { applyCategoryPlanned } from "../lib/budget";
import { budgetApi, coupleApi, guestApi, seatingApi } from "../lib/endpoints";
import { formatHuf, formatHufCompact, formatNumber, formatWeddingDateGoal } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { publish } from "../lib/sync";

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
  useDocumentMeta("seo.dashboard_title", "seo.dashboard_description");
  const confirm = useConfirm();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [data, setData] = useState<Loaded | null | "loading">("loading");
  const [invite, setInvite] = useState<CoupleInvite | null>(null);
  const [copied, setCopied] = useState(false);
  // Partner-invite form state (email-or-link flow).
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  // Cost-planning slider — defaults to baseline once couple loads.
  const [planningCount, setPlanningCount] = useState<number | null>(null);
  // Date-changed notify + archive — separate spinners so the button labels
  // can swap to a localised "sending…" / "archiving…" copy on press.
  const [notifyingDateChange, setNotifyingDateChange] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // Cancel-invite spinner. Must be declared up here with the other useState
  // calls — placing it after the early `data === "loading"` return below
  // would violate the Rules of Hooks (React error #310 on first → loaded
  // transition).
  const [inviteCancelling, setInviteCancelling] = useState(false);

  useEffect(() => {
    (async () => {
      const couple = (await coupleApi.current()).couple;
      if (!couple) {
        setData(null);
        return;
      }
      const [guestsR, linesR, planR, inviteR] = await Promise.all([
        guestApi.list(),
        budgetApi.listLines(),
        seatingApi.plan(),
        // Hydrate any in-flight partner invite so the dashboard can hide
        // its "invite your partner" panel across page reloads (the panel
        // is only useful before an invite is sent — afterwards the user
        // manages the invite from the Profile partner card).
        couple.partner_b_id ? Promise.resolve({ invite: null }) : coupleApi.currentInvite(),
      ]);
      setInvite(inviteR.invite);
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

  // ── ROI / cost-per-guest ─────────────────────────────────────────────
  // Prefer actual ÷ confirmed; fall back to planned ÷ target so the tile is
  // still useful before any actuals or RSVPs have come in.
  const roiPlannedDenom = targetCount ?? totalGuests;
  const roiPlanned =
    totalPlanned > 0 && roiPlannedDenom > 0 ? Math.round(totalPlanned / roiPlannedDenom) : null;
  const roiUseActual = costPerConfirmedGuest !== null;
  const roiValue = costPerConfirmedGuest ?? roiPlanned;
  const roiDenom = roiUseActual ? rsvp.yes : roiPlannedDenom;

  // ── Eloping guard ────────────────────────────────────────────────────
  // When the couple is eloping (10-or-fewer exact guests) or hasn't set a
  // target at all and the list is empty, the cost-per-guest tile is
  // misleading — show "Total spend" instead so the dashboard keeps a 4th
  // KPI without misrepresenting the math.
  const goal = couple.guest_count_goal;
  const eloping =
    (goal.kind === "exact" && goal.exact !== null && goal.exact <= 10) ||
    (goal.kind === "tbd" && totalGuests === 0);

  // ── Date-changed guard ───────────────────────────────────────────────
  // The backend snapshots `previous_wedding_date` whenever the date moves;
  // surface a banner when it differs from the current date so the couple
  // can fan out a notification to every guest.
  const dateChanged =
    couple.previous_wedding_date !== null &&
    couple.previous_wedding_date !== couple.wedding_date &&
    !couple.archived_at;
  // Headcount used in the confirm copy.
  const notifyableGuests = guests.filter((g) => g.email && g.email.trim() !== "").length;

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
    // Counts as done once the invite has been sent — partner B's actual
    // acceptance is reflected elsewhere (partner card on Profile). This
    // prevents the "Next step" CTA from pointing at a section that we
    // hide as soon as an invite is in flight.
    {
      key: "task_invite_partner",
      done: couple.partner_b_id !== null || invite !== null,
      to: couple.partner_b_id !== null || invite !== null ? "/app/profile" : "#invite-partner",
    },
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
  async function onSendInvite(e: FormEvent) {
    e.preventDefault();
    const trimmed = inviteEmail.trim();
    // Trivial email shape check — backend revalidates on its side.
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setInviteEmailError(t("dashboard.invite_email_invalid"));
      return;
    }
    // Own-email guard — the workspace caps at two people and the inviter is
    // already one of them, so self-invites would just confuse the flow. We
    // also reject server-side; this is the friendly first line.
    if (trimmed && currentUser && trimmed.toLowerCase() === currentUser.email.toLowerCase()) {
      setInviteEmailError(t("dashboard.invite_email_own"));
      return;
    }
    setInviteEmailError(null);
    setInviteSending(true);
    try {
      const r = await coupleApi.createInvite(trimmed ? { invited_email: trimmed } : {});
      setInvite(r.invite);
      if (trimmed) setSentToEmail(trimmed);
    } catch (err) {
      // Surface the server's own-email + already-pending codes inline so the
      // user understands what went wrong without a generic error toast.
      if (err instanceof ApiError) {
        const code = (err.detail as { code?: string } | null)?.code;
        if (code === "invite_own_email") {
          setInviteEmailError(t("dashboard.invite_email_own"));
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error(t("common.error_generic"));
      }
    } finally {
      setInviteSending(false);
    }
  }
  function onCopy() {
    if (!inviteUrl) return;
    navigator.clipboard?.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  // Cancel the pending invite so the inviter can send to a different address
  // (e.g. they typo'd). Voids the backend record (we don't DELETE — schema is
  // additive-only, the audit trail keeps the original row) and then the form
  // re-renders for a fresh send. `inviteCancelling` state is declared with
  // the other hooks above the early returns.
  async function onCancelInvite() {
    setInviteCancelling(true);
    try {
      await coupleApi.cancelInvite();
      toast.success(t("dashboard.invite_cancelled"));
      setInvite(null);
      setSentToEmail(null);
      setInviteEmail("");
      setInviteEmailError(null);
      setCopied(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setInviteCancelling(false);
    }
  }

  async function onNotifyDateChange() {
    if (data === "loading" || data === null) return;
    const ok = await confirm({
      title: t("dashboard.date_changed_confirm_title"),
      body: t("dashboard.date_changed_confirm_body", { n: notifyableGuests }),
      confirmLabel: t("dashboard.date_changed_confirm_yes"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setNotifyingDateChange(true);
    try {
      const r = await coupleApi.notifyDateChange();
      toast.success(t("dashboard.date_changed_done", { count: r.notified_count }));
      // The backend clears `previous_wedding_date` after a successful
      // fan-out; refresh the couple so the banner disappears.
      const cur = await coupleApi.current();
      if (cur.couple) setData({ ...data, couple: cur.couple });
      publish("guests:changed");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setNotifyingDateChange(false);
    }
  }

  async function onArchiveWorkspace() {
    if (data === "loading" || data === null) return;
    const ok = await confirm({
      title: t("dashboard.archive_workspace_confirm_title"),
      body: t("dashboard.archive_workspace_confirm_body"),
      confirmLabel: t("dashboard.archive_workspace_confirm_yes"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setArchiving(true);
    try {
      const r = await coupleApi.archive();
      setData({ ...data, couple: r.couple });
      toast.success(t("dashboard.archive_workspace_done"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setArchiving(false);
    }
  }

  async function saveWeddingDate(goal: WeddingDateGoal) {
    if (data === "loading" || data === null) return;
    try {
      const r = await coupleApi.update({ wedding_date_goal: goal });
      setData({ ...data, couple: r.couple });
    } catch {
      // Refetch on failure so the displayed date stays in sync with the DB.
      const r = await coupleApi.current();
      if (r.couple) setData({ ...data, couple: r.couple });
    }
  }

  async function saveCap(newCapHuf: number) {
    if (data === "loading" || data === null) return;
    try {
      const r = await coupleApi.update({
        budget_goal: { kind: "exact", exact_huf: newCapHuf, min_huf: null, max_huf: null },
      });
      setData({ ...data, couple: r.couple });
    } catch {
      const r = await coupleApi.current();
      if (r.couple) setData({ ...data, couple: r.couple });
    }
  }

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl">{couple.display_name}</h1>
          <EditableWeddingDate goal={couple.wedding_date_goal} onSave={saveWeddingDate} />
        </div>
        <div className="text-xs uppercase tracking-wide text-ink-500">{t("dashboard.title")}</div>
      </header>

      {/* ── Next-action CTA — surfaces the first incomplete checklist item.
          Hash targets use a plain <a> so the browser scrolls to the section
          natively; react-router's <Link> swallows the navigation and never
          scrolls, which made this CTA appear inert. ── */}
      {nextTask &&
        (nextTask.to ? (
          nextTask.to.startsWith("#") ? (
            <a href={nextTask.to} className="btn-primary mb-6 inline-flex">
              {t("dashboard.next_action_label", { label: t(`dashboard.${nextTask.key}`) })}
            </a>
          ) : (
            <Link to={nextTask.to} className="btn-primary mb-6 inline-flex">
              {t("dashboard.next_action_label", { label: t(`dashboard.${nextTask.key}`) })}
            </Link>
          )
        ) : (
          <div className="mb-6 inline-flex rounded-xl bg-blush-50 px-4 py-2 text-sm font-medium text-blush-800">
            {t("dashboard.next_action_label", { label: t(`dashboard.${nextTask.key}`) })}
          </div>
        ))}

      {/* ── Date-changed banner ──────────────────────────────────────
          Shown when previous_wedding_date is set AND different from the
          current wedding_date. Backend snapshots the prior date the moment
          the couple edits it; we fan-out an email and clear the flag. */}
      {dateChanged && (
        <section
          className="mb-6 rounded-2xl border-2 border-blush-400 bg-blush-50/60 px-4 py-3"
          role="region"
          aria-label={t("dashboard.date_changed_title")}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-blush-800">
                {t("dashboard.date_changed_title")}
              </h2>
              <p className="mt-1 text-sm text-ink-700">{t("dashboard.date_changed_body")}</p>
            </div>
            <button
              type="button"
              className="btn-accent"
              onClick={onNotifyDateChange}
              disabled={notifyingDateChange || notifyableGuests === 0}
            >
              {notifyingDateChange
                ? t("dashboard.date_changed_sending")
                : t("dashboard.date_changed_button")}
            </button>
          </div>
        </section>
      )}

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
            archiveLabel={t("dashboard.archive_workspace_button")}
            archived={couple.archived_at !== null}
            archiving={archiving}
            onArchive={onArchiveWorkspace}
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
              ? t("dashboard.kpi_budget_unit", { cap: `${formatHufCompact(cap, locale)} Ft` })
              : t("dashboard.kpi_budget_no_cap")
          }
          progress={spentPct}
          progressOver={cap !== null && totalActual > cap}
        />
        {eloping ? (
          <KpiTile
            label={t("dashboard.kpi_total_spend_label")}
            icon={<Coins size={16} aria-hidden="true" />}
            value={totalActual > 0 ? formatHuf(totalActual, locale) : "—"}
            unit={
              totalActual > 0 ? t("dashboard.kpi_total_spend_unit") : t("dashboard.kpi_roi_no_data")
            }
          />
        ) : (
          <KpiTile
            label={t("dashboard.kpi_roi_label")}
            icon={<Coins size={16} aria-hidden="true" />}
            value={roiValue !== null ? formatHuf(roiValue, locale) : "—"}
            unit={
              roiValue === null
                ? t("dashboard.kpi_roi_no_data")
                : roiUseActual
                  ? t("dashboard.kpi_roi_unit_actual", {
                      n: formatNumber(roiDenom, locale),
                    })
                  : t("dashboard.kpi_roi_unit_planned", {
                      n: formatNumber(roiDenom, locale),
                    })
            }
          />
        )}
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
            {tasks.map((task) => {
              const tone = task.done ? "text-ink-500" : "text-ink-800";
              const body = (
                <>
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
                </>
              );
              const rowCls = `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-paper-100 ${tone}`;
              return (
                <li key={task.key}>
                  {task.to ? (
                    task.to.startsWith("#") ? (
                      <a href={task.to} className={rowCls}>
                        {body}
                      </a>
                    ) : (
                      <Link to={task.to} className={rowCls}>
                        {body}
                      </Link>
                    )
                  ) : (
                    <div
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${tone}`}
                    >
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* RSVP breakdown — stretches to match the tasks column. */}
        <div className="grid gap-4">
          <div className="card flex h-full flex-col">
            <h3 className="text-sm font-semibold text-ink-700">
              {t("dashboard.rsvp_breakdown_title")}
            </h3>
            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-paper-200">
              <Segment
                count={rsvp.yes}
                total={Math.max(totalGuests, 1)}
                className="bg-emerald-500"
              />
              <Segment
                count={rsvp.maybe}
                total={Math.max(totalGuests, 1)}
                className="bg-amber-400"
              />
              <Segment count={rsvp.no} total={Math.max(totalGuests, 1)} className="bg-red-500" />
              <Segment
                count={rsvp.pending}
                total={Math.max(totalGuests, 1)}
                className="bg-slate-300"
              />
            </div>
            <ul className="mt-4 flex-1 divide-y divide-paper-100">
              <RsvpRow
                swatch="bg-emerald-500"
                label={t("dashboard.rsvp_yes")}
                value={rsvp.yes}
                total={totalGuests}
                locale={locale}
              />
              <RsvpRow
                swatch="bg-amber-400"
                label={t("dashboard.rsvp_maybe")}
                value={rsvp.maybe}
                total={totalGuests}
                locale={locale}
              />
              <RsvpRow
                swatch="bg-red-500"
                label={t("dashboard.rsvp_no")}
                value={rsvp.no}
                total={totalGuests}
                locale={locale}
              />
              <RsvpRow
                swatch="bg-slate-300"
                label={t("dashboard.rsvp_pending")}
                value={rsvp.pending}
                total={totalGuests}
                locale={locale}
              />
            </ul>
            {totalGuests > 0 && (
              <p className="mt-4 border-t border-paper-200 pt-3 text-center text-xs text-ink-500">
                {t("dashboard.rsvp_responded_of_total", {
                  responded: formatNumber(rsvp.yes + rsvp.no + rsvp.maybe, locale),
                  total: formatNumber(totalGuests, locale),
                })}
              </p>
            )}
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
          onCapChange={saveCap}
        />
      </section>

      {/* ── Invite partner — only when there's no partner_b yet AND
          either no invite is in flight or one was just sent in this
          session (so the confirmation card still gets to render). Once
          the user reloads after sending, the section disappears and the
          invite is managed from the Profile partner card. ──────────── */}
      {!couple.partner_b_id && (!invite || sentToEmail) && (
        <section id="invite-partner" className="card stationery mb-8 scroll-mt-24">
          <h2>{t("dashboard.invite_partner")}</h2>
          <p className="mt-2 text-sm text-ink-700">{t("dashboard.invite_partner_help")}</p>

          {!inviteUrl ? (
            <form className="mt-4" onSubmit={onSendInvite}>
              <label htmlFor="partner-email" className="field-label">
                {t("dashboard.invite_email_label")}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="partner-email"
                  type="email"
                  autoComplete="email"
                  className={`input flex-1 ${inviteEmailError ? "input-invalid" : ""}`}
                  placeholder={t("dashboard.invite_email_placeholder")}
                  value={inviteEmail}
                  disabled={inviteSending}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    if (inviteEmailError) setInviteEmailError(null);
                  }}
                  aria-invalid={inviteEmailError ? true : undefined}
                />
                <button type="submit" className="btn-primary" disabled={inviteSending}>
                  <Mail size={16} />
                  {inviteSending ? t("dashboard.invite_sending") : t("dashboard.invite_send")}
                </button>
              </div>
              {inviteEmailError ? (
                <p className="field-error">{inviteEmailError}</p>
              ) : (
                <p className="field-help">{t("dashboard.invite_email_help")}</p>
              )}
            </form>
          ) : sentToEmail ? (
            // Email-send path: lead with a clear "we sent it" confirmation
            // (this is what the user just asked for and is now waiting on).
            // The shareable link stays available as a backup in case the email
            // doesn't land, but it's demoted to a secondary block.
            <div className="mt-4 rounded-2xl border border-paper-300 bg-paper-50 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-800">
                  <Mail size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-lg text-ink-900">
                    {t("dashboard.invite_sent_title")}
                  </h3>
                  <p className="mt-1 text-sm text-ink-700">
                    {t("dashboard.invite_sent_body", { email: sentToEmail })}
                  </p>
                  <p className="mt-2 text-xs text-ink-500">
                    {t("dashboard.invite_sent_spam_hint")}
                  </p>
                </div>
              </div>

              <div className="mt-4 border-t border-paper-300 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  {t("dashboard.invite_sent_backup_label")}
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input className="input flex-1" readOnly value={inviteUrl} />
                  <button type="button" className="btn-outline" onClick={onCopy}>
                    {copied ? t("dashboard.link_copied") : t("dashboard.copy_link")}
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  className="btn-ghost btn-sm text-ink-500"
                  onClick={onCancelInvite}
                  disabled={inviteCancelling}
                >
                  {inviteCancelling
                    ? t("dashboard.invite_cancelling")
                    : t("dashboard.invite_cancel")}
                </button>
              </div>
            </div>
          ) : (
            // Link-only path: user submitted without an email, so we just show
            // the shareable URL.
            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="input flex-1" readOnly value={inviteUrl} />
                <button type="button" className="btn-outline" onClick={onCopy}>
                  {copied ? t("dashboard.link_copied") : t("dashboard.copy_link")}
                </button>
              </div>
            </div>
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
      <div className="stat-num mt-3 text-center text-3xl font-semibold leading-none text-ink-900">
        {value}
      </div>
      <div className="mt-1 text-center text-xs text-ink-500">{unit}</div>
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
  archiveLabel,
  archived,
  archiving,
  onArchive,
}: {
  label: string;
  sub: string;
  seatingHref: string;
  seatingLabel: string;
  guestsHref: string;
  guestsLabel: string;
  archiveLabel: string;
  archived: boolean;
  archiving: boolean;
  onArchive: () => void;
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
        {!archived && (
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="mt-1 text-left text-blush-800 underline-offset-2 hover:underline disabled:opacity-60"
          >
            {archiving ? "…" : archiveLabel}
          </button>
        )}
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

function RsvpRow({
  swatch,
  label,
  value,
  total,
  locale,
}: {
  swatch: string;
  label: string;
  value: number;
  total: number;
  locale: "hu" | "en";
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="flex items-center gap-2.5 text-ink-700">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${swatch}`} aria-hidden="true" />
        {label}
      </span>
      <span className="stat-num inline-flex items-baseline gap-2 text-ink-900">
        <span className="text-base font-semibold tabular-nums">{formatNumber(value, locale)}</span>
        <span className="w-10 text-right text-xs tabular-nums text-ink-400">{pct}%</span>
      </span>
    </li>
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

/** Wedding-date label that swaps to a native date picker on click. Picking a
 *  date saves it as kind='exact' (so a fuzzy "Summer 2027" goal becomes
 *  concrete the moment the user commits). Esc cancels; blur exits without
 *  saving when no change. */
function EditableWeddingDate({
  goal,
  onSave,
}: {
  goal: WeddingDateGoal;
  onSave: (next: WeddingDateGoal) => Promise<void>;
}) {
  const { t, locale } = useT();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const dateText = formatWeddingDateGoal(goal, { t, locale });

  async function commit(ymd: string) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      setEditing(false);
      return;
    }
    if (ymd === goal.exact_date) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        kind: "exact",
        exact_date: ymd,
        target_year: Number(ymd.slice(0, 4)),
        target_month: Number(ymd.slice(5, 7)),
        target_season: null,
      });
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={goal.exact_date ?? ""}
        disabled={saving}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => {
          if (!saving) setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className="mt-1 rounded border border-blush-500 bg-white px-2 py-0.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-blush-100"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-1 rounded text-left text-sm text-ink-600 underline-offset-4 transition hover:text-ink-900 hover:underline hover:decoration-dotted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200"
    >
      {dateText}
    </button>
  );
}
