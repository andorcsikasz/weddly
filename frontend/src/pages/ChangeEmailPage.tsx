// Lands the user when they click the confirm link in the email_change_verify
// message. The link is in the NEW inbox so the user is typically NOT logged
// in — we just POST the token, then send them to /login with a banner cue.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type State = "loading" | "success" | "invalid";

export default function ChangeEmailPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useT();
  const { user, logout } = useAuth();
  const [state, setState] = useState<State>("loading");
  const [confirmedEmail, setConfirmedEmail] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    let cancelled = false;
    authApi
      .confirmEmailChange(token)
      .then(async ({ email }) => {
        if (cancelled) return;
        setConfirmedEmail(email);
        setState("success");
        // Backend revoked every session — kill our cached token so the next
        // request doesn't 401 awkwardly.
        if (user) await logout();
      })
      .catch(() => {
        if (!cancelled) setState("invalid");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl">{t("change_email.page_title")}</h1>
          <p className="mt-4 text-sm text-ink-700">
            {state === "loading" && t("change_email.page_loading")}
            {state === "success" && t("change_email.page_success", { email: confirmedEmail || "" })}
            {state === "invalid" && t("change_email.page_invalid")}
          </p>
          {state !== "loading" && (
            <p className="mt-4 text-sm text-ink-600">
              <Link to="/login" className="font-medium text-ink-900 underline">
                {t("auth.back_to_login")}
              </Link>
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}
