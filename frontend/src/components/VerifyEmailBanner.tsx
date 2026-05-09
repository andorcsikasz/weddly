// Soft email-verification nag. Shows once per browser session (until dismissed
// or until the user clicks the link). Never blocks anything — the only
// consequence of ignoring it is that password recovery won't work.

import { Mail, X } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";

const DISMISS_KEY = "weddly.verify_banner_dismissed";

export function VerifyEmailBanner() {
  const { user, refresh } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sending, setSending] = useState(false);

  if (!user || user.verified_email || dismissed) return null;

  async function onResend() {
    setSending(true);
    try {
      const res = await authApi.requestVerify();
      if (res.already_verified) {
        await refresh();
      } else {
        toast.success(t("verify.banner_resent"));
      }
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 429
          ? t("auth.rate_limited")
          : t("common.error_generic");
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  function onDismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  return (
    <div className="border-b border-blush-200 bg-blush-50">
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-3 text-sm sm:items-center">
        <Mail size={16} className="mt-0.5 shrink-0 text-blush-700 sm:mt-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-ink-900">{t("verify.banner_title")}</p>
          <p className="text-ink-700">{t("verify.banner_body")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={onResend}
            disabled={sending}
          >
            {sending ? t("verify.banner_resending") : t("verify.banner_resend")}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onDismiss}
            aria-label={t("verify.banner_dismiss")}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
