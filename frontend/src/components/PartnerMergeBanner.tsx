// Surfaces a "your partner already started a workspace" prompt when the
// signed-in user has a solo couple AND there's a pending partner-invite
// addressed to their email. Confirming via the typed-phrase modal purges
// the user's current workspace and links them as partner B on the inviting
// couple — irreversible, hence the typed-phrase gate.
//
// Mount near the top of the dashboard. Renders nothing when there's no
// matching invite, so it's safe to mount unconditionally.

import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useEntryPrompt, useToast } from "./ui";

interface IncomingInvite {
  token: string;
  couple_display_name: string;
  inviter_name: string;
  inviter_email: string;
  expires_at: number;
}

export function PartnerMergeBanner({ onAccepted }: { onAccepted: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const promptEntry = useEntryPrompt();
  const [invite, setInvite] = useState<IncomingInvite | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    coupleApi
      .incomingInvites()
      .then((r) => {
        if (cancelled) return;
        // Take only the most recent — multiple invites would clutter the
        // banner, and the list comes back sorted DESC by created_at.
        setInvite(r.invites[0] ?? null);
      })
      .catch(() => {
        // Non-fatal — the banner just stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!invite) return null;

  async function onJoin() {
    if (!invite) return;
    const phrase = "MERGE";
    const result = await promptEntry({
      title: t("invite.merge_confirm_title"),
      label: t("invite.merge_confirm_label"),
      placeholder: phrase,
      helperText: t("invite.merge_confirm_help"),
      confirmLabel: t("invite.merge_confirm_button"),
      cancelLabel: t("common.cancel"),
      validate: (v) =>
        v.trim().toUpperCase() === phrase ? null : t("invite.merge_confirm_mismatch"),
    });
    if (result === null) return;
    setPending(true);
    try {
      await coupleApi.acceptInviteMerge(invite.token);
      toast.success(t("invite.merge_success"));
      // Hide the banner immediately; parent will re-fetch the dashboard.
      setInvite(null);
      onAccepted();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border-2 border-violet-300 bg-violet-50 dark:border-violet-500/40 dark:bg-violet-500/10 p-4 shadow-soft">
      <p className="text-sm text-violet-950 dark:text-violet-100">
        {t("invite.merge_banner_body", {
          inviter: invite.inviter_name || invite.inviter_email,
          couple: invite.couple_display_name,
        })}
      </p>
      <p className="mt-1 text-xs text-violet-900/80 dark:text-violet-200/80">
        {t("invite.merge_banner_warning")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={onJoin} disabled={pending}>
          {pending ? t("invite.merge_running") : t("invite.merge_banner_cta")}
        </button>
      </div>
    </div>
  );
}
