// Public partner-B invite page. Three branches:
//   1. Logged-out viewer → sign-up CTA with the token preserved in router state.
//   2. Logged-in viewer who IS the inviter (their own couple_id == invite's
//      couple_id) → share-this-with-X panel, no accept button. This is the
//      most common testing-yourself failure mode.
//   3. Logged-in viewer on a different account → accept button.
//
// Errors from `acceptInvite` carry a structured `detail.code` ("couple_full",
// "already_in_other_couple", "already_in_this_couple") so we can show the
// user *what* actually went wrong rather than a generic "Valami félrement".

import type { CoupleInvite } from "@shared/types";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Skeleton } from "../components/ui";
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
  const [invite, setInvite] = useState<{
    invite: CoupleInvite;
    couple_display_name: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
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

  function errorFromAccept(e: unknown): string {
    if (!(e instanceof ApiError)) return t("common.error_generic");
    if (e.status === 410) return t("invite.expired");
    if (e.status === 404) return t("invite.couple_gone");
    const code = (e.detail as { code?: string } | null)?.code;
    if (code === "already_in_other_couple") return t("invite.already_in_other_couple");
    if (code === "couple_full") return t("invite.couple_full");
    // "already_in_this_couple" shouldn't reach here — the own-invite branch
    // below renders share UI instead of the accept button. If it does (e.g.
    // race window), the per-couple message is still right.
    if (code === "already_in_this_couple") return t("invite.own_invite_body", { email: "—" });
    return t("common.error_generic");
  }

  async function onAccept() {
    if (!token) return;
    setAccepting(true);
    try {
      await coupleApi.acceptInvite(token);
      await refresh();
      navigate("/app", { replace: true });
    } catch (e) {
      setError(errorFromAccept(e));
      setAccepting(false);
    }
  }

  // Build the shareable link the same way the dashboard does so the copy
  // button surfaces an identical URL (origin + path), avoiding "wait, why's
  // this different from the one I copied earlier?" confusion.
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
