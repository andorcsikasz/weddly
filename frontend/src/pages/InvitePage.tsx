// Public partner-B invite page. Logged-out users sign up first; the token is
// preserved in router state so they're routed back to accept.

import type { CoupleInvite } from "@shared/types";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user, refresh } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{
    invite: CoupleInvite;
    couple_display_name: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

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
      if (e instanceof ApiError && e.status === 410) setError(t("invite.expired"));
      else setError(t("common.error_generic"));
      setAccepting(false);
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1>{t("invite.title")}</h1>
          {error ? (
            <p className="mt-4 text-sm text-blush-700">{error}</p>
          ) : invite ? (
            <>
              <p className="mt-2 text-sm text-ink-600">
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
          ) : (
            <p className="mt-4 text-sm text-ink-500">{t("common.loading")}</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
