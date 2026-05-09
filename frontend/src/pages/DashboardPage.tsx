// Workspace landing page: invite-partner CTA when missing, plus quick links.

import type { Couple, CoupleInvite } from "@shared/types";
import { Calendar, ChefHat, Heart, Mail, Printer, Users, UtensilsCrossed } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { coupleApi } from "../lib/endpoints";
import { formatBudgetGoal, formatGuestCountGoal, formatWeddingDateGoal } from "../lib/format";
import { useT } from "../lib/i18n";

export default function DashboardPage() {
  const { t, locale } = useT();
  const [couple, setCouple] = useState<Couple | null | "loading">("loading");
  const [invite, setInvite] = useState<CoupleInvite | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    coupleApi.current().then((r) => setCouple(r.couple));
  }, []);

  if (couple === "loading") return null;
  if (couple === null) return <Navigate to="/onboarding" replace />;

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

  // Countdown only renders for kind='exact' — for fuzzier goals we don't
  // know which day to count down to, so the goal label carries the meaning.
  const exactDate = couple.wedding_date_goal.kind === "exact" ? couple.wedding_date : null;
  const daysUntil = exactDate
    ? Math.max(
        0,
        Math.round(
          (new Date(`${exactDate}T00:00:00`).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        ),
      )
    : null;

  const dateText = formatWeddingDateGoal(couple.wedding_date_goal, { t, locale });
  const guestText = formatGuestCountGoal(couple.guest_count_goal, { t, locale });
  const budgetText = formatBudgetGoal(couple.budget_goal, { t, locale });
  const showGuestBadge = couple.guest_count_goal.kind !== "tbd";
  const showBudgetBadge = couple.budget_goal.kind !== "tbd";

  return (
    <AppShell>
      <header className="mb-8">
        <h1 className="font-serif text-4xl">{couple.display_name}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-sm text-ink-600">
          <span className="badge-paper">
            <Calendar size={14} /> {dateText}
          </span>
          {daysUntil !== null && (
            <span className="badge-blush">
              {t("dashboard.wedding_in_days", { days: daysUntil })}
            </span>
          )}
          {showGuestBadge && (
            <span className="badge-paper">
              <Users size={14} /> {guestText}
            </span>
          )}
          {showBudgetBadge && (
            <span className="badge-paper">
              {t("dashboard.budget_ceiling")}: {budgetText}
            </span>
          )}
        </div>
      </header>

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

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      </section>
    </AppShell>
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
