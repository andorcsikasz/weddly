// Planner clients roster — the dedicated "Clients" destination in the shell
// nav. Shows every linked couple as cards (reusing the dashboard pipeline) plus
// an inline add-client flow. Pending couple invites are surfaced here too so
// they can be accepted/declined away from the dashboard.

import { useEffect, useState } from "react";
import type { PlannerClientView, PlannerInviteView } from "@shared/types";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentMeta } from "../../lib/seo";
import { formatDate } from "../../lib/format";
import { AddClientCard } from "./AddClientCard";
import { PlannerDashPipeline } from "./PlannerDashPipeline";

export default function PlannerClientsPage() {
  const { t } = useT();
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
  async function handleDeclineInvite(coupleId: number) {
    try {
      await plannerApi.declineInvite(coupleId);
      setInvites((prev) => prev.filter((i) => i.couple_id !== coupleId));
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
                className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10"
              >
                <div className="min-w-0">
                  <p className="truncate font-grotesk font-semibold text-umber-900 dark:text-paper-50">
                    {inv.display_name}
                  </p>
                  <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
                    {inv.wedding_date
                      ? formatDate(inv.wedding_date, "hu")
                      : t("planner_home.client_wedding_date_none")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAcceptInvite(inv.couple_id)}
                    className="btn-primary btn-sm"
                  >
                    {t("planner_home.invite_accept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeclineInvite(inv.couple_id)}
                    className="btn-outline btn-sm"
                  >
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

      <PlannerDashPipeline
        clients={clients}
        onAddClientClick={() => setShowAdd(true)}
        inviteCount={invites.length}
      />
    </div>
  );
}
