import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Skeleton } from "../components/ui";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type State = "loading" | "success" | "invalid";

export default function VerifyEmailPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useT();
  const { user, refresh } = useAuth();
  useDocumentMeta("verify.page_title", "verify.banner_body");
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    let cancelled = false;
    authApi
      .verifyEmail(token)
      .then(async () => {
        if (cancelled) return;
        setState("success");
        // If they're logged in here, refresh so the banner disappears.
        if (user) await refresh();
      })
      .catch(() => {
        if (!cancelled) setState("invalid");
      });
    return () => {
      cancelled = true;
    };
    // refresh is stable from the auth provider; we only react to token + user presence
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          {state === "loading" ? (
            <>
              <Skeleton variant="circle" width={40} />
              <Skeleton variant="block" height={28} rounded="md" className="mt-4 w-3/5" />
              <div className="mt-4 flex flex-col gap-2">
                <Skeleton variant="line" height={12} width="85%" />
                <Skeleton variant="line" height={12} width="55%" />
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl">{t("verify.page_title")}</h1>
              <p className="mt-4 text-sm text-ink-700">
                {state === "success" && t("verify.page_success")}
                {state === "invalid" && t("verify.page_invalid")}
              </p>
              <p className="mt-4 text-sm text-ink-600">
                <Link to={user ? "/app" : "/login"} className="font-medium text-ink-900 underline">
                  {user ? t("verify.page_back_to_app") : t("auth.back_to_login")}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
