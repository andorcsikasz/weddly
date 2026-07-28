// Top-of-app sticky banner for users who opted into the "continue with
// limited access" path from `VerifyEmailGate`. Shown when:
//   - the user is signed in but `verified_email = false`, AND
//   - the session-storage bypass flag is set (otherwise the full-screen
//     gate at `RequireAuth` is still showing instead of the workspace).
// Renders as a single-line band above the AppShell header. Two actions:
// "Resend" (sends a fresh verify email via authApi.requestVerify) and
// "I've verified" (re-fetches /api/auth/me; if the user really verified,
// the banner disappears and the bypass flag is dropped).

import { Mail } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const VERIFY_BYPASS_SESSION_KEY = "weddly.verify.bypass";

export function VerifyEmailBanner() {
  const { user, refresh } = useAuth();
  const { t } = useT();
  const [busy, setBusy] = useState<"idle" | "resending" | "refreshing">("idle");
  const [status, setStatus] = useState<"idle" | "sent" | "already">("idle");

  // Bail in three cases: signed-out, user already verified, or the bypass
  // flag isn't set (gate still shown). The third check keeps us from
  // double-rendering the banner alongside the full-screen gate during the
  // brief moment between login and the gate mounting.
  if (!user) return null;
  if (user.verified_email) return null;
  let bypassed = false;
  try {
    bypassed = window.sessionStorage.getItem(VERIFY_BYPASS_SESSION_KEY) === "1";
  } catch {
    bypassed = false;
  }
  if (!bypassed) return null;

  async function onResend() {
    setBusy("resending");
    setStatus("idle");
    try {
      const r = await authApi.requestVerify();
      setStatus(r.already_verified ? "already" : "sent");
    } catch {
      // Network blip — leave the banner up, user can retry.
    } finally {
      setBusy("idle");
    }
  }

  async function onRefresh() {
    setBusy("refreshing");
    try {
      await refresh();
      // If they really did verify, refresh() flips `user.verified_email`
      // and we unmount on next render. Clear the bypass so a future
      // accidental sign-in by an unverified user still hits the gate.
      try {
        window.sessionStorage.removeItem(VERIFY_BYPASS_SESSION_KEY);
      } catch {
        /* sessionStorage may be blocked — non-fatal */
      }
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div
      data-banner
      className="relative border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
        <Mail size={16} className="shrink-0" aria-hidden="true" />
        <p className="flex-1 min-w-[14rem]">
          <span className="font-semibold">{t("verify.banner_title")}</span>{" "}
          <span className="text-amber-800 dark:text-amber-200">{t("verify.banner_body")}</span>
          {status === "sent" && (
            <span className="ml-2 text-amber-800 dark:text-amber-200">
              · {t("verify.gate_resent")}
            </span>
          )}
          {status === "already" && (
            <span className="ml-2 text-amber-800 dark:text-amber-200">
              · {t("verify.gate_already_verified")}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onResend}
            disabled={busy !== "idle"}
            className="btn-outline btn-sm border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-100 dark:hover:bg-amber-900/50"
          >
            {busy === "resending" ? t("verify.gate_resending") : t("verify.gate_resend")}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy !== "idle"}
            className="btn-primary btn-sm"
          >
            {busy === "refreshing" ? t("verify.gate_resending") : t("verify.banner_done")}
          </button>
        </div>
      </div>
    </div>
  );
}
