// Planner clients roster — the dedicated "Clients" destination in the shell
// nav. Shows every linked couple as cards (reusing the dashboard pipeline) plus
// an inline add-client flow. Pending couple invites are surfaced here too so
// they can be accepted/declined away from the dashboard.

import { Check, MailQuestion, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlannerClientView, PlannerInviteView } from "@shared/types";
import { useConfirm } from "../../components/ui";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentMeta } from "../../lib/seo";
import { formatDate } from "../../lib/format";
import { AddClientCard } from "./AddClientCard";
import { InviteClientsCard } from "./InviteClientsCard";
import { PlannerDashPipeline } from "./PlannerDashPipeline";

export default function PlannerClientsPage() {
  const { t, locale } = useT();
  const confirm = useConfirm();
  useDocumentMeta("planner_clients_page.meta_title", "planner_clients_page.meta_description");

  const [clients, setClients] = useState<PlannerClientView[]>([]);
  const [invites, setInvites] = useState<PlannerInviteView[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  function refresh() {
    Promise.all([plannerApi.listClients(), plannerApi.listInvites()])
      .then(([cr, ir]) => {
        setClients(cr.clients);
        setInvites(ir.invites);
      })
      .catch(() => {});
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAcceptInvite(coupleId: number) {
    try {
      await plannerApi.acceptInvite(coupleId);
      refresh();
    } catch {
      /* noop */
    }
  }
  async function handleDeclineInvite(inv: PlannerInviteView) {
    const ok = await confirm({
      title: t("planner_home.invite_decline_confirm_title"),
      body: t("planner_home.invite_decline_confirm_body", { name: inv.display_name }),
      confirmLabel: t("planner_home.invite_decline"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await plannerApi.declineInvite(inv.couple_id);
      setInvites((prev) => prev.filter((i) => i.couple_id !== inv.couple_id));
    } catch {
      /* noop */
    }
  }

  return (
    <div className="py-2">
      <div className="mb-6">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
          {t("planner_clients_page.title")}
        </h1>
        <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
          {t("planner_clients_page.subtitle")}
        </p>
      </div>

      {invites.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
            {t("planner_home.invites_heading")}
          </h2>
          <div className="space-y-3">
            {invites.map((inv) => (
              <div
                key={inv.couple_id}
                className="card flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-400"
                    title={t("planner_home.pipeline_pending")}
                  >
                    <MailQuestion size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-grotesk font-semibold text-umber-900 dark:text-paper-50">
                      {inv.display_name}
                    </p>
                    <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
                      {inv.wedding_date
                        ? formatDate(inv.wedding_date, locale)
                        : t("planner_home.client_wedding_date_none")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAcceptInvite(inv.couple_id)}
                    className="btn-moss btn-sm flex items-center gap-1.5"
                    title={t("planner_home.invite_accept")}
                  >
                    <Check size={14} aria-hidden="true" />
                    {t("planner_home.invite_accept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeclineInvite(inv)}
                    className="btn-outline btn-sm flex items-center gap-1.5"
                    title={t("planner_home.invite_decline")}
                  >
                    <X size={14} aria-hidden="true" />
                    {t("planner_home.invite_decline")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showAdd && (
        <AddClientCard
          onClose={() => setShowAdd(false)}
          onSuccess={() => {
            refresh();
            setShowAdd(false);
          }}
        />
      )}

      {/* Invite anyone by email (even if they don't have an account yet) and
          track the sent invitations + their status. */}
      <InviteClientsCard />

      <PlannerDashPipeline
        clients={clients}
        onAddClientClick={() => setShowAdd(true)}
        inviteCount={invites.length}
      />
    </div>
  );
}
