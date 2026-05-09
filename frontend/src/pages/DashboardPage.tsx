// Couple workspace dashboard. v1 just hosts the cards that link out to the
// other phases; each phase ships its own page later.

import type { Couple, CoupleInvite } from "@shared/types";
import { Calendar, ChefHat, Mail, Printer, Users, UtensilsCrossed } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useAuth } from "../lib/auth";
import { coupleApi } from "../lib/endpoints";
import { formatDate, formatHuf } from "../lib/format";
import { useT } from "../lib/i18n";

export default function DashboardPage() {
  const { user } = useAuth();
  const { t, locale } = useT();
  const [couple, setCouple] = useState<Couple | null | "loading">("loading");
  const [invite, setInvite] = useState<CoupleInvite | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    coupleApi.current().then((r) => setCouple(r.couple));
  }, []);

  if (couple === "loading") return null;
  // Brand-new account that hasn't onboarded yet → bounce them through the wizard.
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

  const daysUntil = couple.wedding_date
    ? Math.max(
        0,
        Math.round(
          (new Date(`${couple.wedding_date}T00:00:00`).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        ),
      )
    : null;

  return (
    <Shell>
      <header className="mb-8">
        <h1 className="font-serif text-4xl">{couple.display_name}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-sm text-ink-600">
          {couple.wedding_date && (
            <span className="badge-paper">
              <Calendar size={14} /> {formatDate(couple.wedding_date, locale)}
            </span>
          )}
          {daysUntil !== null && (
            <span className="badge-blush">
              {t("dashboard.wedding_in_days", { days: daysUntil })}
            </span>
          )}
          {couple.target_guest_count && (
            <span className="badge-paper">
              <Users size={14} /> {couple.target_guest_count} {t("dashboard.target_guests")}
            </span>
          )}
          {couple.budget_ceiling_huf && (
            <span className="badge-paper">
              {t("dashboard.budget_ceiling")}: {formatHuf(couple.budget_ceiling_huf, locale)}
            </span>
          )}
        </div>
        {user && <p className="mt-1 text-xs text-ink-500">{user.email}</p>}
      </header>

      {couple.partner_b_id ? (
        <p className="mb-8 text-sm text-ink-600">✓ {t("dashboard.partner_linked")}</p>
      ) : (
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
        <ComingSoonCard
          icon={<UtensilsCrossed size={20} />}
          title={t("dashboard.feature_budget")}
        />
        <ComingSoonCard icon={<Users size={20} />} title={t("dashboard.feature_guests")} />
        <ComingSoonCard icon={<ChefHat size={20} />} title={t("dashboard.feature_seating")} />
        <ComingSoonCard icon={<Printer size={20} />} title={t("dashboard.feature_print")} />
        <ComingSoonCard icon={<Calendar size={20} />} title={t("dashboard.feature_suppliers")} />
      </section>
    </Shell>
  );
}

function ComingSoonCard({ icon, title }: { icon: JSX.Element; title: string }) {
  const { t } = useT();
  return (
    <div className="card flex items-start gap-3 opacity-70">
      <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-200 text-ink-700">
        {icon}
      </div>
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-ink-500">{t("dashboard.coming_soon")}</p>
      </div>
    </div>
  );
}
