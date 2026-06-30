// Planner-facing "invite a client by email" hub on the Clients page. Unlike
// AddClientCard (which only requests access from an email that ALREADY has a
// workspace), this calls plannerApi.createInvitation, which also emails a fresh
// signup invitation when the address has no account yet. Shows the list of sent
// invitations with their status and a revoke action for pending ones. Edit
// access still requires the couple to approve the planner (consent-gated).

import type { PlannerInvitation } from "@shared/types";
import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import { useConfirm, useToast } from "../../components/ui";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

export function InviteClientsCard() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [invitations, setInvitations] = useState<PlannerInvitation[]>([]);

  function refresh() {
    plannerApi
      .listInvitations()
      .then((r) => setInvitations(r.invitations))
      .catch(() => {});
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await plannerApi.createInvitation(email.trim());
      // kind:'invite' = a fresh signup invitation email went out; kind:'request'
      // = the email already had a workspace, so a consent request was sent.
      toast.success(
        res.kind === "request"
          ? t("planner_clients_page.invite_request_sent")
          : t("planner_clients_page.invite_sent"),
      );
      setEmail("");
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t("planner_clients_page.invite_error_duplicate"));
      } else if (err instanceof ApiError && err.status === 422) {
        toast.error(t("planner_clients_page.invite_error_limit"));
      } else {
        toast.error(t("planner_clients_page.invite_error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(inv: PlannerInvitation) {
    const ok = await confirm({
      title: t("planner_clients_page.revoke_confirm_title"),
      body: t("planner_clients_page.revoke_confirm_body", { email: inv.email }),
      confirmLabel: t("planner_clients_page.revoke_button"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await plannerApi.revokeInvitation(inv.id);
      toast.success(t("planner_clients_page.invite_revoked"));
      refresh();
    } catch {
      toast.error(t("planner_clients_page.invite_error_generic"));
    }
  }

  // Revoked invitations are dropped from the list — only live (pending) and
  // accepted invitations are worth showing.
  const visible = invitations.filter((inv) => inv.status !== "revoked");

  return (
    <div className="card mt-4 p-4">
      <p className="font-grotesk text-sm font-semibold text-umber-800 dark:text-paper-200">
        {t("planner_clients_page.invite_section_title")}
      </p>
      <p className="mt-1 text-xs text-umber-500 dark:text-umber-400">
        {t("planner_clients_page.invite_section_hint")}
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("planner_clients_page.invite_placeholder")}
          className="input flex-1 text-sm"
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="btn-primary btn-sm shrink-0"
        >
          {t("planner_clients_page.invite_button")}
        </button>
      </form>

      {visible.length > 0 && (
        <ul className="mt-4 divide-y divide-paper-200 dark:divide-umber-700">
          {visible.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
              <p className="min-w-0 truncate text-sm text-umber-800 dark:text-paper-200">
                {inv.email}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    inv.status === "accepted"
                      ? "bg-sage-100 text-sage-700 dark:bg-sage-900/30 dark:text-sage-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  }`}
                >
                  {inv.status === "accepted"
                    ? t("planner_clients_page.status_accepted")
                    : t("planner_clients_page.status_pending")}
                </span>
                {inv.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => void handleRevoke(inv)}
                    className="btn-sm btn-outline text-xs"
                  >
                    {t("planner_clients_page.revoke_button")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
