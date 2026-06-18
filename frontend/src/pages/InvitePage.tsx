// Public partner-B invite page. Four branches:
//   1. Logged-out viewer → sign-up CTA with the token preserved in router state.
//   2. Logged-in viewer who IS the inviter (their own couple_id == invite's
//      couple_id) → share-this-with-X panel, no accept button. This is the
//      most common testing-yourself failure mode.
//   3. Logged-in viewer with no existing couple → plain accept button.
//   4. Logged-in viewer who already has their own workspace → merge flow inline
//      (type "MERGE" to confirm, then acceptInviteMerge purges the solo
//      workspace and links them as partner B on the inviting couple).
//
// Branch 4 replaces the old dead-end "already_in_other_couple" error that told
// users to sign out and use a different account — which was wrong: the merge
// path exists precisely for this situation.

import type { CoupleInvite } from "@shared/types";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Skeleton } from "../components/ui";
import { useEntryPrompt } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user, refresh } = useAuth();
  const { t } = useT();
  useDocumentMeta("seo.invite_title", "seo.invite_description");
  const navigate = useNavigate();
  const promptEntry = useEntryPrompt();
  const [invite, setInvite] = useState<{
    invite: CoupleInvite;
    couple_display_name: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  // true when the logged-in user already has their own workspace and needs
  // the merge flow rather than the plain accept.
  const [mergeNeeded, setMergeNeeded] = useState(false);
  const [merging, setMerging] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    coupleApi
      .getInvite(token)
      .then((r) => setInvite(r))
      .catch((e: unknown) => {
        if (e instanceof ApiError && (e.status === 410 || e.status === 404)) {
          setError(t("invite.expired"));
        } else {
          setError(t("common.error_generic"));
        }
      });
  }, [token, t]);

  async function onAccept() {
    if (!token) return;
    setAccepting(true);
    try {
      await coupleApi.acceptInvite(token);
      await refresh();
      navigate("/app", { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        const code = (e.detail as { code?: string } | null)?.code;
        if (code === "already_in_other_couple") {
          // Don't surface a dead-end error — switch to the merge UI instead.
          setMergeNeeded(true);
          setAccepting(false);
          return;
        }
        if (e.status === 410) {
          setError(t("invite.expired"));
          setAccepting(false);
          return;
        }
        if (e.status === 404) {
          setError(t("invite.couple_gone"));
          setAccepting(false);
          return;
        }
        if (code === "couple_full") {
          setError(t("invite.couple_full"));
          setAccepting(false);
          return;
        }
        if (code === "already_in_this_couple") {
          setError(t("invite.own_invite_body", { email: "—" }));
          setAccepting(false);
          return;
        }
      }
      setError(t("common.error_generic"));
      setAccepting(false);
    }
  }

  async function onMerge() {
    if (!token) return;
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
    setMerging(true);
    try {
      await coupleApi.acceptInviteMerge(token);
      await refresh();
      navigate("/app", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setMerging(false);
    }
  }

  const inviteUrl =
    typeof window !== "undefined" && token ? `${window.location.origin}/invite/${token}` : "";
  function onCopy() {
    if (!inviteUrl) return;
    navigator.clipboard?.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isOwnInvite =
    !!user && !!invite && user.couple_id !== null && user.couple_id === invite.invite.couple_id;

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          {error ? (
            <>
              <h1>{t("invite.title")}</h1>
              <p className="mt-4 text-sm text-blush-700">{error}</p>
            </>
          ) : !invite ? (
            <>
              <Skeleton variant="line" height={10} width="35%" />
              <Skeleton variant="block" height={36} rounded="md" className="mt-3 w-3/4" />
              <div className="mt-5 flex flex-col gap-2">
                <Skeleton variant="line" height={12} />
                <Skeleton variant="line" height={12} width="80%" />
              </div>
              <Skeleton variant="block" height={48} rounded="lg" className="mt-6 w-full" />
            </>
          ) : isOwnInvite ? (
            <>
              <h1>{t("invite.own_invite_title")}</h1>
              <p className="mt-3 text-sm text-ink-700">
                {t("invite.own_invite_body", {
                  email: invite.invite.invited_email ?? t("invite.title"),
                })}
              </p>
              <p className="mt-5 text-xs font-medium uppercase tracking-wide text-ink-500">
                {t("invite.own_invite_share_label")}
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input className="input flex-1" readOnly value={inviteUrl} />
                <button type="button" className="btn-outline" onClick={onCopy}>
                  {copied ? t("invite.own_invite_copied") : t("invite.own_invite_copy")}
                </button>
              </div>
            </>
          ) : mergeNeeded ? (
            <>
              <h1 className="break-words hyphens-auto">{t("invite.title")}</h1>
              <p className="mt-3 text-sm text-ink-700 break-words hyphens-auto">
                {t("invite.merge_from_invite_body", {
                  couple: invite.couple_display_name ?? "—",
                })}
              </p>
              <button
                type="button"
                className="btn-accent btn-lg mt-6 w-full"
                onClick={onMerge}
                disabled={merging}
              >
                {merging ? t("invite.merge_running") : t("invite.merge_banner_cta")}
              </button>
            </>
          ) : (
            <>
              <h1 className="break-words hyphens-auto">{t("invite.title")}</h1>
              <p className="mt-2 text-sm text-ink-600 break-words hyphens-auto">
                {t("invite.intro", { partner: invite.couple_display_name ?? "—" })}
              </p>
              {user ? (
                <button
                  type="button"
                  className="btn-accent btn-lg mt-6 w-full"
                  onClick={onAccept}
                  disabled={accepting}
                >
                  {accepting ? t("invite.accepting") : t("invite.accept")}
                </button>
              ) : (
                <>
                  <p className="mt-4 text-sm text-ink-600">{t("invite.need_account")}</p>
                  <div className="mt-4 flex gap-2">
                    <Link
                      className="btn-primary flex-1"
                      to="/signup"
                      state={{ inviteToken: token }}
                    >
                      {t("auth.submit_register")}
                    </Link>
                    <Link className="btn-outline flex-1" to="/login" state={{ inviteToken: token }}>
                      {t("auth.submit_login")}
                    </Link>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
