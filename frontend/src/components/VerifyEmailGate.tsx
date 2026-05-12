// Full-screen takeover shown when an unverified user lands inside a protected
// route. Three actions: resend the link, "I've confirmed — refresh" (re-fetches
// /api/auth/me so the gate dismisses), and sign out. When the email is on a
// known provider (Gmail, Outlook, Yahoo, iCloud, Proton) we also surface an
// "Open <provider>" deep-link as the *primary* action — the most likely next
// move is "go check the inbox," and a one-click shortcut is materially less
// friction than "switch tabs, find the right tab, find the message."
//
// Mounted by `RequireAuth` in `App.tsx` so that no protected page renders
// for users whose email isn't verified yet.

import { useState } from "react";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Shell } from "./Shell";

function inboxLinkForEmail(email: string): { url: string; provider: string } | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  // Webmail providers covering ~95% of consumer addresses we'll see in HU/EU.
  // Order matters when domains overlap (icloud.com vs me.com → both Apple).
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { url: "https://mail.google.com", provider: "Gmail" };
  }
  if (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com" ||
    domain === "msn.com" ||
    domain.endsWith(".outlook.com")
  ) {
    return { url: "https://outlook.live.com/mail", provider: "Outlook" };
  }
  if (domain === "yahoo.com" || domain.startsWith("yahoo.")) {
    return { url: "https://mail.yahoo.com", provider: "Yahoo" };
  }
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
    return { url: "https://www.icloud.com/mail", provider: "iCloud" };
  }
  if (domain === "proton.me" || domain === "protonmail.com" || domain === "pm.me") {
    return { url: "https://mail.proton.me", provider: "Proton" };
  }
  if (domain === "freemail.hu") {
    return { url: "https://mail.freemail.hu", provider: "Freemail" };
  }
  if (domain === "citromail.hu") {
    return { url: "https://mail.citromail.hu", provider: "Citromail" };
  }
  return null;
}

export function VerifyEmailGate({ email }: { email: string }) {
  const { t } = useT();
  const { refresh, logout } = useAuth();
  type Status = "idle" | "sending" | "sent" | "already";
  const [status, setStatus] = useState<Status>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const inbox = inboxLinkForEmail(email);

  async function onResend() {
    setStatus("sending");
    try {
      const r = await authApi.requestVerify();
      setStatus(r.already_verified ? "already" : "sent");
    } catch {
      // Network flake — let the user try again rather than dead-end them.
      setStatus("idle");
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl">{t("verify.gate_title")}</h1>
          <p className="mt-4 text-sm text-ink-700">{t("verify.gate_body")}</p>
          <p className="mt-4 text-xs uppercase tracking-wider text-ink-500">
            {t("verify.gate_email_intro")}
          </p>
          <p className="mt-1 break-all text-sm font-medium text-ink-900">{email}</p>

          {inbox && (
            <a
              href={inbox.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary mt-6 inline-flex w-full justify-center sm:w-auto"
            >
              {t("verify.gate_open_inbox", { provider: inbox.provider })} →
            </a>
          )}

          <div className={`flex flex-col gap-2 sm:flex-row ${inbox ? "mt-3" : "mt-6"}`}>
            <button
              type="button"
              className={inbox ? "btn-outline" : "btn-primary"}
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? t("verify.gate_resending") : t("verify.gate_refresh")}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={onResend}
              disabled={status === "sending"}
            >
              {status === "sending" ? t("verify.gate_resending") : t("verify.gate_resend")}
            </button>
          </div>

          {status === "sent" && (
            <p className="mt-3 text-sm text-ink-600">{t("verify.gate_resent")}</p>
          )}
          {status === "already" && (
            <p className="mt-3 text-sm text-ink-600">{t("verify.gate_already_verified")}</p>
          )}

          <p className="mt-6 text-xs text-ink-500">{t("verify.check_inbox_spam_hint")}</p>

          <div className="mt-6 border-t border-paper-300 pt-4">
            <button
              type="button"
              className="btn-ghost btn-sm text-ink-500"
              onClick={() => void logout()}
            >
              {t("verify.gate_logout")}
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
