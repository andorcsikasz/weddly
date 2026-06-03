// Workspace overview: KPI tiles (countdown, RSVPs, spend, seated), an RSVP
// breakdown bar, a derived setup-checklist, and quick links to the deep tools.

import type {
  BudgetCategory,
  BudgetGoal,
  BudgetLine,
  Couple,
  CoupleActivityEntry,
  CoupleInvite,
  Currency,
  DietarySummary,
  Guest,
  WeddingDateGoal,
} from "@shared/types";
import type { ScheduleEvent } from "@shared/schedule";
import {
  Armchair,
  ArrowRight,
  CalendarClock,
  CalendarHeart,
  Camera,
  ChevronDown,
  Clipboard,
  ClipboardList,
  Clock,
  Coins,
  Download,
  Heart,
  Mail,
  MapPin,
  Plane,
  Printer,
  QrCode,
  Store,
  Tablet,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { type FormEvent, type JSX, type ReactNode, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ActivityPanel } from "../components/ActivityPanel";
import { CostPlanningCard, PER_GUEST_CATEGORIES } from "../components/CostPlanningCard";
import { PartnerMergeBanner } from "../components/PartnerMergeBanner";
import { Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { applyCategoryPlanned, guestCountBaseline, guestCountBounds } from "../lib/budget";
import {
  hydrateCostPlanningCount,
  readCostPlanningCount,
  subscribeCostPlanningCount,
  writeCostPlanningCount,
} from "../lib/cost_planning";
import {
  budgetApi,
  coupleApi,
  dietaryApi,
  fetchPdfBlob,
  guestApi,
  placeCardsUrl,
  scheduleApi,
  seatingApi,
} from "../lib/endpoints";
import {
  currencySymbol,
  formatDate,
  formatHufCompact,
  formatMoney,
  formatNumber,
  formatWeddingDateGoal,
  todayIso,
} from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { publish } from "../lib/sync";

type Loaded = {
  couple: Couple;
  guests: Guest[];
  lines: BudgetLine[];
  tableCount: number;
  seatedGuestIds: Set<number>;
  /** Day-of catering aggregate — null until the lazy hydrate fires below.
   *  Kept on the loaded blob so the planning-mode "Caterer summary" tile and
   *  the day-of dashboard share one network round-trip. */
  dietary: DietarySummary | null;
  /** Day-of schedule — same lazy-hydrate story as `dietary`. */
  schedule: ScheduleEvent[] | null;
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

function DashboardSkeleton() {
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton variant="block" width={240} height={36} rounded="md" />
          <Skeleton variant="block" width={160} height={16} rounded="md" />
        </div>
        <Skeleton variant="block" width={96} height={12} rounded="md" />
      </header>

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card flex h-[120px] flex-col justify-between">
            <Skeleton variant="block" width={96} height={12} rounded="md" />
            <Skeleton variant="block" width={120} height={32} rounded="md" />
            <Skeleton variant="line" />
          </div>
        ))}
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="card flex flex-col gap-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <Skeleton variant="block" width={140} height={20} rounded="md" />
            <Skeleton variant="block" width={64} height={12} rounded="md" />
          </div>
          <Skeleton variant="block" height={6} rounded="full" />
          <ul className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex items-center gap-2 px-2 py-1.5">
                <Skeleton variant="circle" width={16} />
                <Skeleton variant="line" />
              </li>
            ))}
          </ul>
        </div>
        <div className="card flex h-full flex-col gap-4">
          <Skeleton variant="block" width={120} height={16} rounded="md" />
          <Skeleton variant="block" height={8} rounded="full" />
          <ul className="flex flex-1 flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Skeleton variant="circle" width={10} />
                  <Skeleton variant="block" width={80} height={12} rounded="md" />
                </div>
                <Skeleton variant="block" width={48} height={12} rounded="md" />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
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
  const [dismissingDateChange, setDismissingDateChange] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // Cancel-invite spinner. Must be declared up here with the other useState
  // calls — placing it after the early `data === "loading"` return below
  // would violate the Rules of Hooks (React error #310 on first → loaded
  // transition).
  const [inviteCancelling, setInviteCancelling] = useState(false);
  // "Lock the wedding date" CTA opens a modal date picker in-place instead
  // of bouncing the user to /onboarding. State + draft live with the other
  // hooks above the early returns so the Rules of Hooks stays clean.
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerDraft, setDatePickerDraft] = useState("");
  const [datePickerSaving, setDatePickerSaving] = useState(false);
  /** Couple-wide audit feed — moved here from /app/profile per the 5-agent
   *  debate. The Dashboard is the natural home for "what just changed"
   *  context; under Profile (a settings page) it was invisible. */
  const [activity, setActivity] = useState<CoupleActivityEntry[]>([]);

  useEffect(() => {
    (async () => {
      const couple = (await coupleApi.current()).couple;
      if (!couple) {
        setData(null);
        return;
      }
      // Seed the cost-planning cache from the couple we just fetched so the
      // slider lands on the shared scenario count instantly — no waiting on
      // a second round-trip just to hydrate one number.
      hydrateCostPlanningCount(couple);
      const seeded = readCostPlanningCount(couple.id);
      if (seeded !== null) setPlanningCount(seeded);
      const [guestsR, linesR, planR, inviteR, activityR] = await Promise.all([
        guestApi.list(),
        budgetApi.listLines(),
        seatingApi.plan(),
        // Hydrate any in-flight partner invite so the dashboard can hide
        // its "invite your partner" panel across page reloads (the panel
        // is only useful before an invite is sent — afterwards the user
        // manages the invite from the Profile partner card).
        couple.partner_b_id ? Promise.resolve({ invite: null }) : coupleApi.currentInvite(),
        coupleApi.activity(),
      ]);
      setInvite(inviteR.invite);
      setActivity(activityR.entries);
      setData({
        couple,
        guests: guestsR.guests,
        lines: linesR.lines,
        tableCount: planR.tables.length,
        seatedGuestIds: new Set(planR.assignments.map((a) => a.guest_id)),
        dietary: null,
        schedule: null,
      });
    })();
  }, []);

  // Cross-tab cost-planning subscription. Once the couple is loaded, any
  // partner-side slider drag on /app/budget (or another /app tab) flows in
  // here so the KPI tiles re-scale without a manual refresh.
  useEffect(() => {
    if (data === "loading" || data === null) return;
    const id = data.couple.id;
    return subscribeCostPlanningCount(id, (next) => {
      setPlanningCount(next);
    });
  }, [data]);

  // ── Day-of payloads (dietary aggregate + schedule preview) ───────────
  // Lazy-hydrated AFTER the first paint so the planning-mode dashboard
  // doesn't pay for two extra fetches up-front. Re-runs when the loaded
  // blob arrives so we don't fire against a `null` couple.
  useEffect(() => {
    if (data === "loading" || data === null) return;
    if (data.dietary !== null && data.schedule !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const [dietaryR, scheduleR] = await Promise.all([dietaryApi.summary(), scheduleApi.list()]);
        if (cancelled) return;
        setData((cur) => {
          if (cur === "loading" || cur === null) return cur;
          return { ...cur, dietary: dietaryR, schedule: scheduleR.events };
        });
      } catch {
        // Day-of payloads are best-effort — a 401 mid-load on the
        // planning-mode dashboard shouldn't blow up the rest of the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (data === "loading") return <DashboardSkeleton />;
  if (data === null) return <Navigate to="/onboarding" replace />;

  const { couple, guests, lines, tableCount, seatedGuestIds, dietary, schedule } = data;

  // ── Days countdown — only meaningful when an exact date is locked. ─────
  const exactDate = couple.wedding_date_goal.kind === "exact" ? couple.wedding_date : null;
  const rawDelta = exactDate
    ? Math.round((new Date(`${exactDate}T00:00:00`).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const daysUntil = rawDelta !== null ? Math.max(0, rawDelta) : null;
  // True if we have an exact date AND it's already passed.
  const weddingPast = rawDelta !== null && rawDelta < 0;
  // ── Day-of mode flag ─────────────────────────────────────────────────
  // Engaged the morning of (D-day) and the eve (D-1). Drops the planning-
  // mode KPI / checklist / cost-planning surface in favour of a compact
  // jumbo check-in panel + day-of-only call-outs. Archived workspaces keep
  // their planning chrome so the past-wedding tile can still link to PDFs.
  // Gate on the RAW delta, not the clamped `daysUntil` (which floors at 0): the
  // clamp would keep day-of mode stuck on the morning AFTER the wedding (raw
  // -1 → clamped 0). With rawDelta the eve (1) and the day itself (0) light up,
  // and the day after correctly falls through to the past-wedding tile.
  const dayOfMode =
    rawDelta !== null && rawDelta <= 1 && rawDelta >= 0 && !couple.archived_at;

  // ── RSVP breakdown ────────────────────────────────────────────────────
  const rsvp = { yes: 0, no: 0, maybe: 0, pending: 0 };
  for (const g of guests) rsvp[g.rsvp_status] += 1;
  const totalGuests = guests.length;
  // ── Day-of: how many guests checked in today? ────────────────────────
  // "Today" = the user's local start of day. We bucket on `rsvp_responded_at`
  // so a couple kicking the dashboard between rounds can see the trend.
  const startOfToday = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const checkedInToday = dayOfMode
    ? guests.filter((g) => g.rsvp_responded_at !== null && g.rsvp_responded_at >= startOfToday)
        .length
    : 0;
  const targetCount = targetGuestCount(couple);
  // Denominator for "X of Y confirmed": if the couple set a target, use that;
  // otherwise fall back to the actual list size so the % stays meaningful.
  const guestDenominator = targetCount ?? totalGuests;

  // ── Budget ────────────────────────────────────────────────────────────
  const totalPlanned = lines.reduce((s, l) => s + l.planned_huf, 0);
  const totalActual = lines.reduce((s, l) => s + l.actual_huf, 0);
  const cap = budgetCapHuf(couple.budget_goal);
  // Currency lives on the couple — KPI tiles + the cost-planning card both
  // read this so a flip on /app/profile re-skins the dashboard immediately.
  const currency: Currency = couple.currency ?? "HUF";
  const spentPct = cap && cap > 0 ? Math.min(100, Math.round((totalActual / cap) * 100)) : null;
  const overCap = cap !== null && totalPlanned > cap;

  // ── ROI / cost-per-guest ─────────────────────────────────────────────
  // Prefer actual ÷ confirmed; fall back to *scaled* planned ÷ slider count
  // so the tile follows the cost-planning slider in real time. The scaling
  // mirrors CostPlanningCard: per-guest categories scale with count/baseline;
  // fixed categories stay put. Declared further down — it depends on
  // baselineCount + effectivePlanningCount which are computed below.

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

  // ── Cost-planning baseline + slider bounds ─────────────────────────────
  // Sourced from `lib/budget.ts` so /app and /app/budget compute identical
  // numbers (the user complained about the dashboard and budget pages
  // showing different min/max). Bounds come straight from
  // couple.guest_count_goal when it's a range — editing them on either page
  // persists back to the goal, keeping the two pages in lockstep.
  const baselineCount = guestCountBaseline(couple, totalGuests);
  const { min: boundsMin, max: boundsMax } = guestCountBounds(couple, baselineCount);
  const effectivePlanningCount = planningCount ?? baselineCount;

  // ── Scaled ROI ──────────────────────────────────────────────────────
  // Mirror CostPlanningCard's scaling so the tile tracks the slider live:
  // per-guest categories scale with count/baseline; fixed categories don't.
  // Frozen categories skip the rescale entirely (the couple has locked them
  // to a real quote that shouldn't drift with the headcount slider).
  const frozenCategoriesSet = new Set<BudgetCategory>(couple.frozen_categories ?? []);
  const planningFactor = baselineCount > 0 ? effectivePlanningCount / baselineCount : 1;
  let scaledPlannedTotal = 0;
  for (const line of lines) {
    if (PER_GUEST_CATEGORIES.has(line.category) && !frozenCategoriesSet.has(line.category)) {
      scaledPlannedTotal += Math.round(line.planned_huf * planningFactor);
    } else {
      scaledPlannedTotal += line.planned_huf;
    }
  }
  // Planned-per-guest tracks the live slider. `costPerConfirmedGuest`
  // (above) is the actual-side counterpart; the dashboard tile now shows
  // both side-by-side instead of silently switching between them.
  const roiPlanned =
    scaledPlannedTotal > 0 && effectivePlanningCount > 0
      ? Math.round(scaledPlannedTotal / effectivePlanningCount)
      : null;
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

  async function addCustomRow(
    label: string,
    plannedHuf: number,
    options?: { perGuest?: boolean; icon?: string | null },
  ) {
    if (data === "loading" || data === null) return;
    try {
      const r = await budgetApi.createLine({
        category: "other",
        label,
        planned_huf: plannedHuf,
        actual_huf: 0,
        per_guest: options?.perGuest ?? false,
        icon: options?.icon ?? null,
      });
      setData({ ...data, lines: [...lines, r.line] });
    } catch {
      const r = await budgetApi.listLines();
      setData({ ...data, lines: r.lines });
    }
  }

  async function setCustomRowPlanned(lineId: number, plannedHuf: number) {
    if (data === "loading" || data === null) return;
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    const updated = { ...line, planned_huf: plannedHuf };
    setData({ ...data, lines: lines.map((l) => (l.id === lineId ? updated : l)) });
    try {
      const r = await budgetApi.updateLine(line.id, updated, { ifMatch: line.updated_at });
      setData((cur) => {
        if (!cur || cur === "loading") return cur;
        return { ...cur, lines: cur.lines.map((l) => (l.id === r.line.id ? r.line : l)) };
      });
    } catch {
      const r = await budgetApi.listLines();
      setData((cur) => (cur && cur !== "loading" ? { ...cur, lines: r.lines } : cur));
    }
  }

  async function removeCustomRow(lineId: number) {
    if (data === "loading" || data === null) return;
    const ok = await confirm({
      title: t("common.confirm_delete_title"),
      body: t("common.confirm_delete_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await budgetApi.removeLine(lineId);
      setData({ ...data, lines: lines.filter((l) => l.id !== lineId) });
    } catch {
      const r = await budgetApi.listLines();
      setData((cur) => (cur && cur !== "loading" ? { ...cur, lines: r.lines } : cur));
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
    // Omitted in the demo workspace — there's no real partner to invite,
    // so the row would always sit unchecked and lead nowhere useful.
    ...(couple.is_demo
      ? []
      : [
          {
            key: "task_invite_partner",
            done: couple.partner_b_id !== null || invite !== null,
            to:
              couple.partner_b_id !== null || invite !== null ? "/app/profile" : "#invite-partner",
          },
        ]),
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
    if (notifyableGuests === 0) {
      toast.error(t("dashboard.date_changed_no_emails"));
      return;
    }
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

  // Dismiss the banner without sending notifications. Just clears the
  // server-side snapshot and refreshes the couple so the banner disappears.
  // No confirm + no toast — the X icon is its own intent signal.
  async function onDismissDateChange() {
    if (data === "loading" || data === null) return;
    setDismissingDateChange(true);
    try {
      await coupleApi.dismissDateChange();
      const cur = await coupleApi.current();
      if (cur.couple) setData({ ...data, couple: cur.couple });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setDismissingDateChange(false);
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

  async function saveBounds(min: number, max: number) {
    if (data === "loading" || data === null) return;
    try {
      const r = await coupleApi.update({
        // Editing the bounds promotes guest_count_goal to a range — that's
        // the model where min/max are first-class. Both pages re-derive
        // from this on next load, which is the sync the user asked for.
        guest_count_goal: { kind: "range", min, max, exact: null },
      });
      setData({ ...data, couple: r.couple });
    } catch {
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

  async function toggleCountLock() {
    if (data === "loading" || data === null) return;
    const next = !data.couple.planning_count_locked;
    try {
      const r = await coupleApi.update(
        next
          ? { planning_count_locked: true, planning_count: effectivePlanningCount }
          : { planning_count_locked: false },
      );
      setData({ ...data, couple: r.couple });
    } catch {
      const r = await coupleApi.current();
      if (r.couple) setData({ ...data, couple: r.couple });
    }
  }

  // Toggle freeze state for a category. Optimistic local update + server
  // PATCH — refetch on failure so the row reverts. The set lives on `couple`
  // so it survives reload and propagates to the budget page automatically.
  async function toggleFreeze(category: BudgetCategory) {
    if (data === "loading" || data === null) return;
    const current = data.couple.frozen_categories ?? [];
    const willFreeze = !current.includes(category);
    const next = willFreeze ? [...current, category] : current.filter((c) => c !== category);
    const factor = baselineCount > 0 ? effectivePlanningCount / baselineCount : 1;
    const rewriteLines = PER_GUEST_CATEGORIES.has(category) && factor !== 1;
    const sumFor = (ls: BudgetLine[]) =>
      ls.filter((l) => l.category === category).reduce((s, l) => s + l.planned_huf, 0);
    try {
      // Freeze: pin the displayed total (scaled) into planned_huf so the
      // lock captures what the user sees. Must precede the flag flip —
      // PATCH on a frozen line is rejected when planned_huf changes.
      let nextLines = lines;
      if (willFreeze && rewriteLines) {
        const displayed = Math.round(sumFor(lines) * factor);
        if (displayed > 0) {
          nextLines = await applyCategoryPlanned(
            category,
            displayed,
            lines,
            t(`budget.cat.${category}`),
          );
        }
      }
      const r = await coupleApi.update({ frozen_categories: next });
      // Unfreeze: planned_huf still holds the displayed total from the prior
      // freeze. Scaling is about to resume, so divide by factor to cancel it.
      // Has to run AFTER the flag flips for the same frozen-line guard.
      if (!willFreeze && rewriteLines) {
        const cur = sumFor(nextLines);
        if (cur > 0) {
          const perBaseline = Math.round(cur / factor);
          nextLines = await applyCategoryPlanned(
            category,
            perBaseline,
            nextLines,
            t(`budget.cat.${category}`),
          );
        }
      }
      setData({ ...data, couple: r.couple, lines: nextLines });
    } catch {
      const r = await coupleApi.current();
      const fresh = await budgetApi.listLines();
      if (r.couple) setData({ ...data, couple: r.couple, lines: fresh.lines });
    }
  }

  return (
    <>
      {/* Surfaces when both partners signed up separately. Hidden unless
       *  there's a pending partner-invite addressed to this user's email;
       *  joining purges the user's solo workspace (typed-phrase confirm). */}
      {!couple.partner_b_id && <PartnerMergeBanner onAccepted={() => window.location.reload()} />}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl break-words hyphens-auto">
            {couple.display_name}
          </h1>
          <EditableWeddingDate goal={couple.wedding_date_goal} onSave={saveWeddingDate} />
        </div>
        <div className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
          {t("dashboard.title")}
        </div>
      </header>

      {/* ── Next-action CTA — surfaces the first incomplete checklist item.
          Hash targets use a plain <a> so the browser scrolls to the section
          natively; react-router's <Link> swallows the navigation and never
          scrolls, which made this CTA appear inert. The "lock the wedding
          date" task is special-cased into a modal so the user doesn't get
          punted out to /onboarding for a single date field. Hidden in day-of
          mode where the jumbo check-in panel takes over. ── */}
      {!dayOfMode &&
        nextTask &&
        (nextTask.key === "task_set_date" ? (
          <button
            type="button"
            className="btn-primary mb-6 inline-flex"
            onClick={() => {
              setDatePickerDraft(couple.wedding_date_goal.exact_date ?? "");
              setDatePickerOpen(true);
            }}
          >
            {t("dashboard.next_action_label", { label: t(`dashboard.${nextTask.key}`) })}
          </button>
        ) : nextTask.to ? (
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
          <div className="mb-6 inline-flex rounded-xl bg-blush-50 px-4 py-2 text-sm font-medium text-blush-800 dark:bg-blush-400/15 dark:text-blush-300">
            {t("dashboard.next_action_label", { label: t(`dashboard.${nextTask.key}`) })}
          </div>
        ))}

      {/* ── Inline wedding-date picker dialog (CTA target). ──────────────
          Reuses the same WeddingDateGoal shape as the header/KPI inline
          pickers so save → KPI tile flip works without a refetch. */}
      <Dialog
        open={datePickerOpen}
        role="dialog"
        closeOnBackdrop
        title={t("dashboard.set_date_dialog_title")}
        onClose={() => {
          if (!datePickerSaving) setDatePickerOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setDatePickerOpen(false)}
              disabled={datePickerSaving}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={datePickerSaving || !/^\d{4}-\d{2}-\d{2}$/.test(datePickerDraft)}
              onClick={async () => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(datePickerDraft)) return;
                setDatePickerSaving(true);
                try {
                  await saveWeddingDate({
                    kind: "exact",
                    exact_date: datePickerDraft,
                    target_year: Number(datePickerDraft.slice(0, 4)),
                    target_month: Number(datePickerDraft.slice(5, 7)),
                    target_season: null,
                  });
                  setDatePickerOpen(false);
                } finally {
                  setDatePickerSaving(false);
                }
              }}
            >
              {t("dashboard.set_date_dialog_save")}
            </button>
          </>
        }
      >
        <p className="mb-3">{t("dashboard.set_date_dialog_body")}</p>
        <input
          type="date"
          min={todayIso()}
          value={datePickerDraft}
          disabled={datePickerSaving}
          onChange={(e) => setDatePickerDraft(e.target.value)}
          className="input"
        />
      </Dialog>

      {/* ── Date-changed banner ──────────────────────────────────────
          Shown when previous_wedding_date is set AND different from the
          current wedding_date. Backend snapshots the prior date the moment
          the couple edits it; we fan-out an email and clear the flag. */}
      {dateChanged && (
        <section
          className="stationery-blush mb-6 overflow-hidden rounded-2xl border-2 border-blush-500 shadow-soft"
          role="region"
          aria-label={t("dashboard.date_changed_title")}
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
            {/* Identity badge — single-glance signal of *what* changed before
                the eye lands on the title. Filled blush over the striped
                ground gives the alert a clear focal point. */}
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blush-600 text-white shadow-soft dark:bg-blush-500 dark:text-paper-50">
              <CalendarClock size={22} aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="font-serif text-xl font-semibold leading-tight text-blush-800 dark:text-blush-300">
                {t("dashboard.date_changed_title")}
              </h2>
              {/* Old → new chip row. Renders only when both dates are present
                  (defensive — `dateChanged` already implies they are, but
                  guards a malformed previous_wedding_date from breaking the
                  banner). */}
              {couple.previous_wedding_date && couple.wedding_date && (
                <p className="mt-1.5 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="stat-num text-ink-500 line-through decoration-blush-400 decoration-2 dark:text-umber-300">
                    {formatDate(couple.previous_wedding_date, locale)}
                  </span>
                  <ArrowRight
                    size={14}
                    className="text-blush-500 dark:text-blush-300"
                    aria-hidden="true"
                  />
                  <span className="stat-num font-semibold text-ink-900 dark:text-paper-50">
                    {formatDate(couple.wedding_date, locale)}
                  </span>
                </p>
              )}
              <p className="mt-1 text-sm text-ink-700 dark:text-paper-100">
                {t("dashboard.date_changed_body")}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-blush-300 bg-white/70 text-blush-700 transition hover:border-blush-500 hover:bg-blush-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blush-400/40 dark:bg-umber-800/70 dark:text-blush-300 dark:hover:border-blush-300 dark:hover:bg-blush-400/15"
                onClick={onDismissDateChange}
                disabled={dismissingDateChange || notifyingDateChange}
                aria-label={t("dashboard.date_changed_dismiss_aria")}
                title={t("dashboard.date_changed_dismiss_aria")}
              >
                <X size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-success btn-lg shadow-soft"
                onClick={onNotifyDateChange}
                disabled={notifyingDateChange || dismissingDateChange}
              >
                <Mail size={16} aria-hidden="true" />
                {notifyingDateChange
                  ? t("dashboard.date_changed_sending")
                  : t("dashboard.date_changed_button")}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Day-of mode ─────────────────────────────────────────────
          Engaged when daysUntil <= 1. Replaces the planning-mode KPI grid,
          tasks list and cost-planning panel with a compact, big-type
          jumbo: guest check-in URL, headline counts, dietary one-liner,
          schedule preview and print actions. */}
      {dayOfMode && (
        <DayOfPanel
          couple={couple}
          rsvpYes={rsvp.yes}
          checkedInToday={checkedInToday}
          dietary={dietary}
          schedule={schedule}
          isToday={daysUntil === 0}
        />
      )}

      {/* ── Caterer summary tile (planning mode, ≤7 days) ────────────
          Only useful in the final week — before that it's just noise.
          Stays hidden in day-of mode (the dietary line lives inside the
          DayOfPanel) and post-wedding. */}
      {!dayOfMode &&
        !weddingPast &&
        daysUntil !== null &&
        daysUntil >= 0 &&
        daysUntil <= 7 &&
        dietary !== null &&
        dietary.counted_guests > 0 && <CatererSummaryCard dietary={dietary} />}

      {/* ── KPI tiles — hidden in day-of mode; the DayOfPanel above
          surfaces a compact stat row instead. ──────────────────────── */}
      {!dayOfMode && (
        <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            <DaysToGoTile
              label={t("dashboard.kpi_days_label")}
              days={daysUntil}
              goal={couple.wedding_date_goal}
              onSave={saveWeddingDate}
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
          <BudgetKpiTile
            label={t("dashboard.kpi_budget_label")}
            totalActual={totalActual}
            cap={cap}
            currency={currency}
            locale={locale}
            onSaveCap={saveCap}
            progress={spentPct}
            progressOver={cap !== null && totalActual > cap}
          />
          {eloping ? (
            <KpiTile
              label={t("dashboard.kpi_total_spend_label")}
              icon={<Coins size={16} aria-hidden="true" />}
              value={totalActual > 0 ? formatMoney(totalActual, currency, locale) : "—"}
              unit={
                totalActual > 0
                  ? t("dashboard.kpi_total_spend_unit")
                  : t("dashboard.kpi_roi_no_data")
              }
            />
          ) : (
            // Planned cost-per-guest only. The "actual" half (cost ÷ confirmed
            // RSVPs) is intentionally absent — early in planning the figure
            // either dashes or whiplashes as RSVPs trickle in, which read more
            // as noise than signal.
            <KpiTile
              label={t("dashboard.kpi_roi_label")}
              icon={<Coins size={16} aria-hidden="true" />}
              value={
                roiPlanned !== null
                  ? `${formatHufCompact(roiPlanned, locale)} ${currencySymbol(currency, locale)}`
                  : "—"
              }
              unit={t("dashboard.kpi_roi_unit_planned", {
                n: formatNumber(effectivePlanningCount, locale),
              })}
            />
          )}
        </section>
      )}

      {/* ── Planning-mode body — hidden in day-of mode so the screen
          stays focused on the jumbo check-in panel. ───────────────── */}
      {!dayOfMode && (
        <>
          {/* ── Two-column body: tasks + breakdowns ────────────────────── */}
          <section className="mb-8 grid gap-4 lg:grid-cols-3">
            {/* Tasks (spans 2/3 on lg). On phones this collapses behind a
             *  disclosure so the dashboard's first scroll isn't dominated
             *  by an 8-item checklist — the progress chip in the summary
             *  carries the "are we done?" signal at a glance. */}
            <MobileCollapsibleCard
              className="card lg:col-span-2 p-0 md:p-6"
              bodyClassName="px-4 pb-4 md:px-0 md:pb-0"
              title={t("dashboard.tasks_title")}
              trailing={
                <span>{t("dashboard.tasks_progress", { done: tasksDone, total: tasksTotal })}</span>
              }
            >
              <div className="mb-4 hidden items-baseline justify-between md:flex">
                <h2>{t("dashboard.tasks_title")}</h2>
                <span className="text-xs text-ink-500 dark:text-umber-300">
                  {t("dashboard.tasks_progress", { done: tasksDone, total: tasksTotal })}
                </span>
              </div>
              <div
                className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700"
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
                  const tone = task.done
                    ? "text-ink-500 dark:text-umber-300"
                    : "text-ink-800 dark:text-paper-100";
                  const body = (
                    <>
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          task.done
                            ? "border-blush-500 bg-blush-500 text-white"
                            : "border-paper-400 bg-white dark:border-umber-600 dark:bg-umber-800"
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
                      <span
                        className={
                          task.done
                            ? "line-through decoration-ink-300 dark:decoration-umber-600"
                            : ""
                        }
                      >
                        {t(`dashboard.${task.key}`)}
                      </span>
                    </>
                  );
                  const rowCls = `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-paper-100 dark:hover:bg-umber-700 ${tone}`;
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
            </MobileCollapsibleCard>

            {/* RSVP breakdown — stretches to match the tasks column. */}
            <div className="grid gap-4">
              <MobileCollapsibleCard
                className="card flex h-full flex-col p-0 md:p-6"
                bodyClassName="flex flex-1 flex-col px-4 pb-4 md:px-0 md:pb-0"
                title={t("dashboard.rsvp_breakdown_title")}
                trailing={
                  totalGuests > 0 ? (
                    <span>
                      {t("dashboard.rsvp_responded_of_total", {
                        responded: formatNumber(rsvp.yes + rsvp.no + rsvp.maybe, locale),
                        total: formatNumber(totalGuests, locale),
                      })}
                    </span>
                  ) : null
                }
              >
                <h2 className="mb-4 hidden md:block">{t("dashboard.rsvp_breakdown_title")}</h2>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
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
                  <Segment
                    count={rsvp.no}
                    total={Math.max(totalGuests, 1)}
                    className="bg-red-500"
                  />
                  <Segment
                    count={rsvp.pending}
                    total={Math.max(totalGuests, 1)}
                    className="bg-slate-300"
                  />
                </div>
                <ul className="mt-4 flex-1 divide-y divide-paper-100 dark:divide-umber-700">
                  <RsvpRow
                    status="yes"
                    swatch="bg-emerald-500"
                    label={t("dashboard.rsvp_yes")}
                    value={rsvp.yes}
                    total={totalGuests}
                    locale={locale}
                  />
                  <RsvpRow
                    status="maybe"
                    swatch="bg-amber-400"
                    label={t("dashboard.rsvp_maybe")}
                    value={rsvp.maybe}
                    total={totalGuests}
                    locale={locale}
                  />
                  <RsvpRow
                    status="no"
                    swatch="bg-red-500"
                    label={t("dashboard.rsvp_no")}
                    value={rsvp.no}
                    total={totalGuests}
                    locale={locale}
                  />
                  <RsvpRow
                    status="pending"
                    swatch="bg-slate-300"
                    label={t("dashboard.rsvp_pending")}
                    value={rsvp.pending}
                    total={totalGuests}
                    locale={locale}
                  />
                </ul>
                {totalGuests > 0 && (
                  <p className="mt-4 hidden border-t border-paper-200 pt-3 text-center text-xs text-ink-500 md:block dark:border-umber-700 dark:text-umber-300">
                    {t("dashboard.rsvp_responded_of_total", {
                      responded: formatNumber(rsvp.yes + rsvp.no + rsvp.maybe, locale),
                      total: formatNumber(totalGuests, locale),
                    })}
                  </p>
                )}
              </MobileCollapsibleCard>
            </div>
          </section>

          {/* ── Cost planning panel — full-width, inline-edit per category. ── */}
          <section className="mb-8">
            <CostPlanningCard
              lines={lines}
              baseline={baselineCount}
              boundsMin={boundsMin}
              boundsMax={boundsMax}
              cap={cap}
              count={effectivePlanningCount}
              currency={currency}
              onCountChange={(n) => {
                // Local optimistic update + debounced server write. The lib
                // collapses a slider drag into one PATCH and re-publishes
                // across tabs so /app/budget + /app/suppliers stay in sync.
                setPlanningCount(n);
                writeCostPlanningCount(couple.id, n);
              }}
              onBoundsChange={saveBounds}
              onEditPlanned={setCategoryPlanned}
              onCapChange={saveCap}
              countLocked={couple.planning_count_locked}
              onCountLockToggle={toggleCountLock}
              frozenCategories={frozenCategoriesSet}
              onToggleFreeze={toggleFreeze}
              onAddCustomRow={addCustomRow}
              onEditCustomRowPlanned={setCustomRowPlanned}
              onRemoveCustomRow={removeCustomRow}
              // Clicking a row's amount on the dashboard should land the user
              // in the budget table at the same category — `cat-<slug>` is the
              // anchor each CategoryRow renders.
              amountLinkTo="/app/budget"
            />
          </section>

          {/* ── Invite partner — only when there's no partner_b yet AND
          either no invite is in flight or one was just sent in this
          session (so the confirmation card still gets to render). Once
          the user reloads after sending, the section disappears and the
          invite is managed from the Profile partner card.
          Hidden entirely in the demo workspace — there's no real partner
          to invite there, and the form would just confuse the visitor. */}
          {!couple.is_demo && !couple.partner_b_id && (!invite || sentToEmail) && (
            <section
              id="invite-partner"
              data-coach-target="partner-invite"
              className="card stationery mb-8 scroll-mt-24"
            >
              <h2>{t("dashboard.invite_partner")}</h2>
              <p className="mt-2 text-sm text-ink-700 dark:text-paper-100">
                {t("dashboard.invite_partner_help")}
              </p>

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
                <div className="mt-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-800">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-800 dark:bg-blush-400/15 dark:text-blush-300">
                      <Mail size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-serif text-lg text-ink-900 dark:text-paper-50">
                        {t("dashboard.invite_sent_title")}
                      </h3>
                      <p className="mt-1 text-sm text-ink-700 dark:text-paper-100">
                        {t("dashboard.invite_sent_body", { email: sentToEmail })}
                      </p>
                      <p className="mt-2 text-xs text-ink-500 dark:text-umber-300">
                        {t("dashboard.invite_sent_spam_hint")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-paper-300 pt-4 dark:border-umber-700">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
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
                      className="btn-ghost btn-sm text-ink-500 dark:text-umber-300"
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
          {/* Compact icon-only strip mirroring the sidebar (minus the current
           *  page) so the overview doubles as a hub on mobile. Hidden on lg+
           *  because the sidebar is permanently visible there and renders the
           *  same destinations with full labels — the icon strip would just
           *  duplicate navigation. */}
          <section className="lg:hidden">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("dashboard.quick_links_title")}
            </h2>
            {/* Eight quick-link pills laid out as an equal-column grid so they
             *  span the full container width — 4 columns on mobile, 8 on
             *  ≥sm. The pills inside stretch with the cells. */}
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              <IconNavLink to="/app/guests" icon={<Users size={18} />} label={t("nav.guests")} />
              <IconNavLink to="/app/budget" icon={<Coins size={18} />} label={t("nav.budget")} />
              <IconNavLink
                to="/app/seating"
                icon={<Armchair size={18} />}
                label={t("nav.seating")}
              />
              <IconNavLink
                to="/app/schedule"
                icon={<CalendarClock size={18} />}
                label={t("nav.schedule")}
              />
              <IconNavLink
                to="/app/vendors"
                icon={<Store size={18} />}
                label={t("nav.suppliers")}
              />
              <IconNavLink
                to="/app/planning"
                icon={<ClipboardList size={18} />}
                label={t("nav.planning")}
              />
              <IconNavLink
                to="/app/honeymoon"
                icon={<Plane size={18} />}
                label={t("nav.honeymoon")}
              />
              <IconNavLink to="/app/media" icon={<Camera size={18} />} label={t("nav.media")} />
            </div>
          </section>
        </>
      )}

      {/* Couple-wide audit feed at the bottom of the dashboard. Collapsed
       *  by default; opens to a 14-day stream of who-changed-what. Moved
       *  here from /app/profile per the agent debate — "what changed"
       *  belongs on the overview, not in account settings. */}
      <ActivityPanel
        entries={activity}
        currentUserId={currentUser?.id ?? null}
        locale={locale}
        t={t}
      />
    </>
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
  const accentBg =
    accent === "blush" ? "bg-blush-50 dark:bg-blush-400/15" : "bg-paper-50 dark:bg-umber-700/60";
  const accentRing =
    accent === "blush" ? "text-blush-700 dark:text-blush-300" : "text-ink-700 dark:text-paper-100";
  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${accentBg} ${accentRing}`}
        >
          {icon}
        </span>
        {label}
      </div>
      <div className="stat-num mt-2 text-center text-xl font-bold leading-none text-ink-900 sm:text-2xl dark:text-paper-50">
        {value}
      </div>
      <div className="mt-1 text-center text-xs font-semibold text-ink-500 dark:text-umber-300">
        {unit}
      </div>
      {progress !== undefined && progress !== null && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
          <div
            className={`h-full rounded-full transition-all ${
              progressOver ? "bg-blush-700 dark:bg-blush-400" : "bg-ink-700 dark:bg-paper-100"
            }`}
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Spent / cap KPI tile with an inline-editable cap. Cap renders as a full
 *  HU-formatted figure (no compact "5M" abbreviation) so the user sees the
 *  exact ceiling. Double-click on the cap drops it into edit mode; single
 *  click surfaces a toast hint about the double-click affordance to teach
 *  the gesture without arming it on accidental brushes. */
function BudgetKpiTile({
  label,
  totalActual,
  cap,
  currency,
  locale,
  onSaveCap,
  progress,
  progressOver,
}: {
  label: string;
  totalActual: number;
  cap: number | null;
  currency: Currency;
  locale: "hu" | "en";
  onSaveCap: (next: number) => Promise<void>;
  progress: number | null;
  progressOver: boolean;
}) {
  const { t } = useT();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    if (cap === null) return;
    setDraft(formatNumber(cap, "hu"));
    setEditing(true);
  }

  async function commit() {
    const digits = draft.replace(/\D/g, "");
    if (digits === "") {
      setEditing(false);
      return;
    }
    const n = Number(digits);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000 || n === cap) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSaveCap(Math.round(n));
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-paper-50 text-ink-700 dark:bg-umber-700/60 dark:text-paper-100">
          <Wallet size={14} aria-hidden="true" />
        </span>
        {label}
      </div>
      <div className="stat-num mt-2 text-center text-xl font-bold leading-none text-ink-900 sm:text-2xl dark:text-paper-50">
        {formatMoney(totalActual, currency, locale)}
      </div>
      <div className="mt-1 flex items-baseline justify-center gap-1 text-xs font-semibold text-ink-500 dark:text-umber-300">
        {cap === null ? (
          <span>{t("dashboard.kpi_budget_no_cap")}</span>
        ) : editing ? (
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            disabled={saving}
            value={draft}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              setDraft(digits === "" ? "" : formatNumber(Number(digits), "hu"));
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              else if (e.key === "Escape") setEditing(false);
            }}
            aria-label={t("dashboard.kpi_budget_edit_aria")}
            className="stat-num w-32 rounded border border-blush-500 bg-white px-1 py-1 text-center text-base font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-blush-100 sm:py-0.5 sm:text-xs dark:bg-umber-800 dark:text-paper-50"
          />
        ) : (
          <>
            <span>{t("dashboard.kpi_budget_unit_connector")}</span>
            <button
              type="button"
              onClick={() => toast.info(t("dashboard.kpi_budget_edit_hint"))}
              onDoubleClick={startEdit}
              title={t("dashboard.kpi_budget_edit_hint")}
              aria-label={t("dashboard.kpi_budget_edit_aria")}
              className="stat-num cursor-pointer underline decoration-dotted decoration-ink-400 underline-offset-4 transition hover:text-ink-900 hover:decoration-ink-700 dark:hover:text-paper-50 dark:hover:decoration-paper-100"
            >
              {formatMoney(cap, currency, locale)}
            </button>
          </>
        )}
      </div>
      {progress !== null && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
          <div
            className={`h-full rounded-full transition-all ${
              progressOver ? "bg-blush-700 dark:bg-blush-400" : "bg-ink-700 dark:bg-paper-100"
            }`}
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Clickable variant of the days-countdown KPI. Tapping the tile swaps the
 *  big number for an inline `<input type="date">` so couples can shift the
 *  date without leaving the dashboard. Reuses the same WeddingDateGoal
 *  shape as the header `<EditableWeddingDate>` widget. */
function DaysToGoTile({
  label,
  days,
  goal,
  onSave,
}: {
  label: string;
  days: number | null;
  goal: WeddingDateGoal;
  onSave: (next: WeddingDateGoal) => Promise<void>;
}) {
  const { t, locale } = useT();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blush-50 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
          <CalendarHeart size={14} aria-hidden="true" />
        </span>
        {label}
      </div>
      {editing ? (
        <input
          type="date"
          min={todayIso()}
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
          className="mt-2 w-full rounded border border-blush-500 bg-white px-2 py-2 text-center text-base font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-blush-100 sm:py-1 sm:text-sm dark:bg-umber-800 dark:text-paper-50"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={t("dashboard.kpi_days_edit_hint")}
          aria-label={t("dashboard.kpi_days_edit_hint")}
          className="-mx-2 mt-1 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-center transition hover:bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:hover:bg-umber-700"
        >
          <div className="stat-num text-xl font-bold leading-none text-ink-900 sm:text-2xl dark:text-paper-50">
            {days !== null ? formatNumber(days, locale) : "—"}
          </div>
          <div className="mt-1 text-xs font-semibold text-ink-500 dark:text-umber-300">
            {days !== null ? t("dashboard.kpi_days_unit") : t("dashboard.kpi_days_tbd")}
          </div>
        </button>
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
    <div className="card bg-blush-50 p-4 dark:bg-blush-400/15">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blush-700 dark:text-blush-300">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blush-100 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
          <Heart size={12} aria-hidden="true" />
        </span>
        {label}
      </div>
      <div className="stat-num mt-2 text-lg font-bold leading-tight text-ink-900 dark:text-paper-50">
        {sub}
      </div>
      <div className="mt-3 flex flex-col gap-1.5 text-sm">
        <Link
          to={seatingHref}
          className="text-blush-800 underline-offset-2 hover:underline dark:text-blush-300"
        >
          {seatingLabel}
        </Link>
        <Link
          to={guestsHref}
          className="text-blush-800 underline-offset-2 hover:underline dark:text-blush-300"
        >
          {guestsLabel}
        </Link>
        {!archived && (
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="mt-1 text-left text-blush-800 underline-offset-2 hover:underline disabled:opacity-60 dark:text-blush-300"
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

/** Wrap a dashboard section so it renders as a collapsible disclosure on
 *  phones (default closed) and as a plain block on tablet+ (no summary,
 *  no chevron, always open). The user-facing intent is "let the dashboard
 *  breathe on mobile" without losing the section on a desktop where the
 *  cards already sit side-by-side.
 *
 *  The render switches forks per viewport so the title is mounted exactly
 *  once — earlier prototypes rendered both a summary chip and a body h2
 *  with the same copy and tripped `getByText` duplicate-match assertions
 *  whenever CSS wasn't loaded (test env). */
function MobileCollapsibleCard({
  title,
  trailing,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  trailing?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  // Initial: assume desktop so SSR + initial paint don't flash a
  // collapsed section on wide viewports. Real viewport is measured in
  // the `useEffect` below and pulls `isWide` to false on phones — one
  // tick of paint, then the disclosure folds.
  const [isWide, setIsWide] = useState(true);
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    setIsWide(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (isWide) {
    return <div className={className}>{children}</div>;
  }

  const open = userOpen;
  return (
    <details
      className={className}
      open={open}
      onToggle={(e) => setUserOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 text-base font-medium text-ink-900 dark:text-paper-50">
          {title}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-ink-500 dark:text-umber-300">
          {trailing}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </summary>
      <div className={bodyClassName}>{children}</div>
    </details>
  );
}

function RsvpRow({
  status,
  swatch,
  label,
  value,
  total,
  locale,
}: {
  status: "yes" | "maybe" | "no" | "pending";
  swatch: string;
  label: string;
  value: number;
  total: number;
  locale: "hu" | "en";
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <li>
      <Link
        to={`/app/guests?rsvp=${status}`}
        className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm transition hover:bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-300 dark:hover:bg-umber-700/60"
      >
        <span className="flex items-center gap-2.5 text-ink-700 dark:text-paper-100">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${swatch}`} aria-hidden="true" />
          {label}
        </span>
        <span className="stat-num inline-flex items-baseline gap-2 text-ink-900 dark:text-paper-50">
          <span className="text-base font-semibold tabular-nums">
            {formatNumber(value, locale)}
          </span>
          <span className="w-10 text-right text-xs tabular-nums text-ink-400 dark:text-umber-300">
            {pct}%
          </span>
        </span>
      </Link>
    </li>
  );
}

function IconNavLink({ to, icon, label }: { to: string; icon: JSX.Element; label: string }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="inline-flex h-10 w-full items-center justify-center rounded-full bg-paper-50 text-ink-700 ring-1 ring-paper-200 transition hover:bg-blush-100 hover:text-blush-700 hover:ring-blush-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-300 dark:bg-umber-800 dark:text-paper-100 dark:ring-umber-700 dark:hover:bg-blush-400/15 dark:hover:text-blush-300 dark:hover:ring-blush-400/40"
    >
      {icon}
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
        min={todayIso()}
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
        className="mt-1 rounded border border-blush-500 bg-white px-2 py-0.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-blush-100 dark:bg-umber-800 dark:text-paper-50"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-1 rounded text-left text-sm text-ink-600 underline-offset-4 transition hover:text-ink-900 hover:underline hover:decoration-dotted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:text-umber-200 dark:hover:text-paper-50"
    >
      {dateText}
    </button>
  );
}

// ── Day-of dashboard panel ───────────────────────────────────────────
// Engaged on D-day and D-1. Big type, max-width 800px, jumbo URL on top.
// Keep this lean — the couple is mid-prep and the screen will be glanced
// at, not read. QR is intentionally deferred to v2 (no in-repo encoder).
function DayOfPanel({
  couple,
  rsvpYes,
  checkedInToday,
  dietary,
  schedule,
  isToday,
}: {
  couple: Couple;
  rsvpYes: number;
  checkedInToday: number;
  dietary: DietarySummary | null;
  schedule: ScheduleEvent[] | null;
  isToday: boolean;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Public check-in URL — guests visit this on their phones at the door
  // and punch in the 4-digit household code from their invite. Built from
  // window.location.origin so it tracks the deployment domain at runtime.
  const checkinUrl = typeof window !== "undefined" ? `${window.location.origin}/rsvp` : "/rsvp";

  async function onCopyCheckin() {
    if (!couple.slug) return;
    try {
      await navigator.clipboard?.writeText(checkinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — fall back to surfacing the URL inline. The
      // big-text URL above the button stays readable in that case.
    }
  }

  async function onPrintPlaceCards() {
    if (printing) return;
    setPrinting(true);
    try {
      const blob = await fetchPdfBlob(placeCardsUrl({ onlyConfirmed: true }));
      const typed =
        blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
      const url = URL.createObjectURL(typed);
      const a = document.createElement("a");
      a.href = url;
      a.download = "weddly-place-cards.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPrinting(false);
    }
  }

  // Day-of dietary one-liner — pull only the buckets that have hits so the
  // strip stays clean. Order mirrors the caterer-summary card so caterers
  // get a consistent left-to-right read.
  function dietaryStrip(): string[] {
    if (!dietary) return [];
    const pieces: string[] = [];
    if (dietary.meal.vegetarian > 0) {
      pieces.push(
        `${formatNumber(dietary.meal.vegetarian, locale)} ${t("dashboard.caterer_label_vegetarian")}`,
      );
    }
    if (dietary.meal.vegan > 0) {
      pieces.push(
        `${formatNumber(dietary.meal.vegan, locale)} ${t("dashboard.caterer_label_vegan")}`,
      );
    }
    if (dietary.allergies.gluten > 0) {
      pieces.push(
        `${formatNumber(dietary.allergies.gluten, locale)} ${t("dashboard.caterer_label_gluten")}`,
      );
    }
    if (dietary.allergies.lactose > 0) {
      pieces.push(
        `${formatNumber(dietary.allergies.lactose, locale)} ${t("dashboard.caterer_label_lactose")}`,
      );
    }
    if (dietary.allergies.nut > 0) {
      pieces.push(
        `${formatNumber(dietary.allergies.nut, locale)} ${t("dashboard.caterer_label_nut")}`,
      );
    }
    return pieces;
  }

  // Top 3 upcoming events from today. We filter to events at or after the
  // current wall-clock minute so "Coming up next" reads honestly even
  // post-ceremony. The schedule is already sorted by `starts_at_minutes`
  // on the wire.
  const nowMinutes = (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();
  const upcoming = (schedule ?? []).filter((e) => e.starts_at_minutes >= nowMinutes).slice(0, 3);

  const stripPieces = dietaryStrip();

  return (
    <div className="mx-auto mb-8 max-w-3xl">
      {/* Hero — Today / Tomorrow + big check-in URL + (TODO) QR. On phones
       *  the section collapses behind a disclosure so the dashboard's
       *  first scroll isn't a tall blush slab — the day-of label still
       *  reads in the summary and the check-in URL is one tap away. */}
      <MobileCollapsibleCard
        className="card mb-6 border-2 border-blush-200 bg-blush-50/40 text-center md:p-6 dark:border-blush-400/40 dark:bg-blush-400/15"
        bodyClassName="px-4 pb-4 md:px-0 md:pb-0"
        title={
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-blush-700 dark:text-blush-300">
            <QrCode size={14} aria-hidden="true" />
            {t("dashboard.day_of_mode_title")}
          </span>
        }
        trailing={
          <span className="font-mono text-[11px] uppercase">
            {isToday ? t("dashboard.day_of_today_label") : t("dashboard.day_of_tomorrow_label")}
          </span>
        }
      >
        <p className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-blush-700 md:block dark:text-blush-300">
          {t("dashboard.day_of_mode_title")}
        </p>
        <p className="mt-2 hidden text-3xl font-serif text-ink-900 md:block dark:text-paper-50">
          {isToday ? t("dashboard.day_of_today_label") : t("dashboard.day_of_tomorrow_label")}
        </p>
        <h2 className="mt-6 flex items-center justify-center gap-2 text-base font-semibold text-ink-900 dark:text-paper-50">
          <QrCode size={18} aria-hidden="true" />
          {t("dashboard.day_of_checkin_title")}
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-600 dark:text-umber-200">
          {t("dashboard.day_of_checkin_intro")}
        </p>
        {couple.slug ? (
          <>
            <button
              type="button"
              onClick={onCopyCheckin}
              className="mt-4 inline-block w-full max-w-xl rounded-2xl border border-ink-200 bg-white px-4 py-4 text-center font-mono text-xl tabular-nums text-ink-900 transition hover:border-ink-400 sm:text-2xl dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:hover:border-umber-600"
              aria-label={t("dashboard.day_of_checkin_copy")}
            >
              {checkinUrl}
            </button>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
              <span className="rounded-full bg-ink-900 px-3 py-1 text-xs font-medium uppercase tracking-wider text-paper-50 dark:bg-paper-50 dark:text-umber-900">
                {couple.slug}
              </span>
              <button type="button" className="btn-outline" onClick={onCopyCheckin}>
                <Clipboard size={14} />
                {copied ? t("dashboard.day_of_checkin_copied") : t("dashboard.day_of_checkin_copy")}
              </button>
              <a
                href={`/rsvp?couple=${encodeURIComponent(couple.slug)}&kiosk=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
                title={t("dashboard.welcome_desk_help")}
              >
                <Tablet size={14} aria-hidden />
                {t("dashboard.welcome_desk_open")}
              </a>
            </div>
            {/* TODO(v2): inline SVG QR encoder. Avoiding a new heavy dep for
                now — the URL above is the source of truth and most door-
                staff workflows just need to type it on a kiosk anyway. */}
            <p className="mt-4 text-xs italic text-ink-500 dark:text-umber-300">
              {t("dashboard.day_of_qr_todo")}
            </p>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-blush-300 bg-white px-4 py-3 text-sm text-ink-700 dark:border-blush-400/40 dark:bg-umber-800 dark:text-paper-100">
            {t("dashboard.day_of_checkin_no_slug")}
          </p>
        )}
      </MobileCollapsibleCard>

      {/* Live stats — two big numbers. Big type so a glance at arm's
          length reads cleanly. */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        <DayOfStatTile
          label={t("dashboard.day_of_stats_yes")}
          value={formatNumber(rsvpYes, locale)}
          icon={<Users size={18} aria-hidden="true" />}
        />
        <DayOfStatTile
          label={t("dashboard.day_of_stats_checked_in")}
          value={formatNumber(checkedInToday, locale)}
          icon={<CalendarHeart size={18} aria-hidden="true" />}
        />
      </section>

      {/* Dietary one-liner — only render when there's actually something
          to say. The 0-counts path was just noise on early-fire dashboards. */}
      {stripPieces.length > 0 && (
        <section className="card mb-6">
          <h3 className="text-sm font-semibold text-ink-700 dark:text-paper-100">
            {t("dashboard.day_of_dietary_title")}
          </h3>
          <p className="mt-2 text-base text-ink-900 dark:text-paper-50">
            {stripPieces.join(" · ")}
          </p>
        </section>
      )}

      {/* Schedule preview — top 3 upcoming events. Click goes to the full
          schedule page so the couple can edit on the way. */}
      <section className="card mb-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink-700 dark:text-paper-100">
            {t("dashboard.day_of_schedule_title")}
          </h3>
          <Link
            to="/app/schedule"
            className="text-xs text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline dark:text-umber-300 dark:hover:text-paper-50"
          >
            {t("dashboard.day_of_schedule_open")}
          </Link>
        </div>
        {schedule === null ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">
            {t("dashboard.day_of_schedule_empty")}
          </p>
        ) : (
          <ul className="divide-y divide-paper-200 dark:divide-umber-700">
            {upcoming.map((event) => (
              <li key={event.id} className="flex items-start gap-4 py-2.5">
                <span className="stat-num min-w-[3.5rem] shrink-0 text-base font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                  {`${String(Math.floor(event.starts_at_minutes / 60)).padStart(2, "0")}:${String(
                    event.starts_at_minutes % 60,
                  ).padStart(2, "0")}`}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                    {event.label}
                  </p>
                  {event.location && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
                      <MapPin size={12} aria-hidden="true" />
                      {event.location}
                    </p>
                  )}
                </div>
                {event.duration_minutes !== null && (
                  <span className="inline-flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
                    <Clock size={12} aria-hidden="true" />
                    {event.duration_minutes}m
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Print actions — big buttons because the bridal party is opening
          this from a stressed phone, not a calm laptop. */}
      <section className="card">
        <h3 className="text-sm font-semibold text-ink-700 dark:text-paper-100">
          {t("dashboard.day_of_print_title")}
        </h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="btn-primary justify-center"
            onClick={onPrintPlaceCards}
            disabled={printing}
          >
            <Printer size={16} aria-hidden="true" />
            {printing ? t("schedule.saving") : t("dashboard.day_of_print_place_cards")}
          </button>
          <Link to="/app/seating" className="btn-outline justify-center">
            <Download size={16} aria-hidden="true" />
            {t("dashboard.day_of_print_seating")}
          </Link>
        </div>
      </section>
    </div>
  );
}

function DayOfStatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="card text-center">
      <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {icon}
        {label}
      </div>
      <div className="stat-num mt-2 text-4xl font-semibold leading-none text-ink-900 dark:text-paper-50">
        {value}
      </div>
    </div>
  );
}

// ── Caterer summary card ─────────────────────────────────────────────
// Visible in planning mode during the final week — gives the couple a
// copy-paste-ready block for the caterer email thread. Hidden in day-of
// mode (the DayOfPanel surfaces the same data inline).
function CatererSummaryCard({ dietary }: { dietary: DietarySummary }) {
  const { t, locale } = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  // Compose the copy-paste text. We deliberately keep this as a flat list
  // (one bucket per line) so it pastes cleanly into Gmail / Messenger and
  // the caterer can scan it without a table renderer.
  function composeText(): string {
    const lines: string[] = [];
    const pushIf = (label: string, value: number) => {
      if (value > 0) lines.push(`${label}: ${value}`);
    };
    pushIf(t("dashboard.caterer_label_meat"), dietary.meal.meat);
    pushIf(t("dashboard.caterer_label_fish"), dietary.meal.fish);
    pushIf(t("dashboard.caterer_label_vegetarian"), dietary.meal.vegetarian);
    pushIf(t("dashboard.caterer_label_vegan"), dietary.meal.vegan);
    pushIf(t("dashboard.caterer_label_child"), dietary.meal.child);
    pushIf(t("dashboard.caterer_label_none"), dietary.meal.none);
    pushIf(t("dashboard.caterer_label_unspecified"), dietary.meal.unspecified);
    pushIf(t("dashboard.caterer_label_gluten"), dietary.allergies.gluten);
    pushIf(t("dashboard.caterer_label_milk_protein"), dietary.allergies.milk_protein);
    pushIf(t("dashboard.caterer_label_lactose"), dietary.allergies.lactose);
    pushIf(t("dashboard.caterer_label_nut"), dietary.allergies.nut);
    pushIf(t("dashboard.caterer_label_egg"), dietary.allergies.egg);
    pushIf(t("dashboard.caterer_label_fish_shellfish"), dietary.allergies.fish_shellfish);
    pushIf(t("dashboard.caterer_label_other"), dietary.allergies.other_text_count);
    lines.push("");
    lines.push(`(${t("dashboard.caterer_total", { n: dietary.counted_guests })})`);
    return lines.join("\n");
  }

  async function onCopy() {
    try {
      await navigator.clipboard?.writeText(composeText());
      setCopied(true);
      toast.success(t("dashboard.caterer_copied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  // Inline chips — only render the buckets with hits to keep the row
  // readable. Allergies sit alongside meals since the caterer needs them
  // together anyway.
  type Chip = { label: string; value: number };
  const chips: Chip[] = [
    { label: t("dashboard.caterer_label_meat"), value: dietary.meal.meat },
    { label: t("dashboard.caterer_label_fish"), value: dietary.meal.fish },
    { label: t("dashboard.caterer_label_vegetarian"), value: dietary.meal.vegetarian },
    { label: t("dashboard.caterer_label_vegan"), value: dietary.meal.vegan },
    { label: t("dashboard.caterer_label_child"), value: dietary.meal.child },
    { label: t("dashboard.caterer_label_gluten"), value: dietary.allergies.gluten },
    { label: t("dashboard.caterer_label_milk_protein"), value: dietary.allergies.milk_protein },
    { label: t("dashboard.caterer_label_lactose"), value: dietary.allergies.lactose },
    { label: t("dashboard.caterer_label_nut"), value: dietary.allergies.nut },
    { label: t("dashboard.caterer_label_egg"), value: dietary.allergies.egg },
    {
      label: t("dashboard.caterer_label_fish_shellfish"),
      value: dietary.allergies.fish_shellfish,
    },
  ].filter((c) => c.value > 0);

  return (
    <section className="card mb-6 border border-blush-200 bg-blush-50/30 dark:border-blush-400/40 dark:bg-blush-400/15">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink-900 dark:text-paper-50">
            {t("dashboard.caterer_title")}
          </h2>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-umber-300">
            {t("dashboard.caterer_sub")}
          </p>
        </div>
        <button type="button" className="btn-outline btn-sm" onClick={onCopy}>
          <Clipboard size={14} aria-hidden="true" />
          {copied ? t("dashboard.caterer_copied") : t("dashboard.caterer_copy")}
        </button>
      </div>
      {chips.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <li
              key={c.label}
              className="inline-flex items-center gap-1.5 rounded-full bg-paper-100 px-3 py-1 text-xs text-ink-700 dark:bg-umber-700/60 dark:text-paper-100"
            >
              <span className="font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                {formatNumber(c.value, locale)}
              </span>
              {c.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-500 dark:text-umber-300">
          {t("dashboard.day_of_dietary_empty")}
        </p>
      )}
      <p className="mt-3 text-xs italic text-ink-500 dark:text-umber-300">
        {t("dashboard.caterer_total", { n: dietary.counted_guests })}
      </p>
    </section>
  );
}
