// Soft email-verification nag. Shows once per browser, then snoozes for
// 7 days. Never blocks anything — the only consequence of ignoring it is
// that password recovery won't work.

import { Mail, X } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";

const DISMISS_KEY = "weddly.verify_email_dismissed_until";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function readDismissedUntil(): number {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function VerifyEmailBanner() {
  const { user, refresh } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const [dismissedUntil, setDismissedUntil] = useState<number>(() => readDismissedUntil());
  const [sending, setSending] = useState(false);

  const isDismissed = dismissedUntil > Date.now();
  if (!user || user.verified_email || isDismissed) return null;

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
    const until = Date.now() + SEVEN_DAYS_MS;
    try {
      localStorage.setItem(DISMISS_KEY, String(until));
    } catch {
      // ignore
    }
    setDismissedUntil(until);
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
