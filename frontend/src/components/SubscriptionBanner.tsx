// Top-of-app billing banner. Mutually-exclusive states:
//   - lapsed (free period over, not subscribed) → read-only band + Subscribe.
//   - founding member → a one-time celebratory band ("you're in the first 200,
//     free for 18 months"), dismissible and remembered in localStorage.
//   - solo → a still-free workspace with no partner yet, nudged to invite their
//     partner so the platform stays free until the wedding day past the paid
//     launch. Dismissible; auto-hides once the paid-launch date passes.
// Renders nothing for paying couples, during onboarding (no couple yet), or
// before billing data loads.

import { PAID_LAUNCH_DATE } from "@shared/billing";
import { Lock, Sparkles, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { billingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const FOUNDING_DISMISS_KEY = "weddly.founding_banner.dismissed";
const SOLO_DISMISS_KEY = "weddly.solo_invite_banner.dismissed";

export function SubscriptionBanner() {
  const { user } = useAuth();
  const { t, locale } = useT();
  const [mode, setMode] = useState<"none" | "lapsed" | "founding" | "solo">("none");
  const [enabled, setEnabled] = useState(false);
  const [foundingUntil, setFoundingUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(FOUNDING_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [soloDismissed, setSoloDismissed] = useState(() => {
    try {
      return localStorage.getItem(SOLO_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!user) {
      setMode("none");
      return;
    }
    let alive = true;
    billingApi
      .status()
      .then((s) => {
        if (!alive) return;
        setEnabled(s.enabled);
        if (!s.billing.entitled) setMode("lapsed");
        else if (s.billing.subscription_status === "founding" && s.billing.is_founding_member) {
          // Celebratory "first 200" band, reserved for the badge holders.
          setMode("founding");
          setFoundingUntil(s.billing.founding_until);
        } else if (!s.has_partner) {
          // Solo workspace, still free: nudge them to invite their partner so
          // the platform stays free until their wedding day past the paywall.
          setMode("solo");
        } else setMode("none");
      })
      .catch(() => {
        if (alive) setMode("none");
      });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!user || mode === "none") return null;

  async function onSubscribe() {
    setBusy(true);
    try {
      const { url } = await billingApi.checkout();
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  }

  function dismissFounding() {
    setDismissed(true);
    try {
      localStorage.setItem(FOUNDING_DISMISS_KEY, "1");
    } catch {
      /* localStorage may be blocked — non-fatal */
    }
  }

  function dismissSolo() {
    setSoloDismissed(true);
    try {
      localStorage.setItem(SOLO_DISMISS_KEY, "1");
    } catch {
      /* localStorage may be blocked — non-fatal */
    }
  }

  if (mode === "solo") {
    // Only meaningful while the platform is still free for everyone. Once the
    // paid launch passes, a solo couple is read-only (handled by "lapsed").
    if (soloDismissed || Date.now() >= PAID_LAUNCH_DATE) return null;
    const launchDate = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
      month: "long",
      day: "numeric",
    }).format(new Date(PAID_LAUNCH_DATE));
    return (
      <div className="border-b border-umber-200 bg-umber-100 text-umber-900 dark:border-umber-700/60 dark:bg-umber-800/60 dark:text-umber-100">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <UserPlus size={16} className="shrink-0 text-umber-600 dark:text-umber-300" aria-hidden />
          <p className="min-w-[14rem] flex-1">
            <span className="font-semibold">{t("billing.solo_banner_title")}</span>{" "}
            <span className="text-umber-700 dark:text-umber-200">
              {t("billing.solo_banner_body", { date: launchDate })}
            </span>
          </p>
          <Link to="/app" className="btn-primary btn-sm" onClick={dismissSolo}>
            {t("billing.solo_banner_cta")}
          </Link>
          <button
            type="button"
            onClick={dismissSolo}
            aria-label={t("verify.banner_dismiss")}
            className="rounded-md p-1 text-umber-600 hover:bg-umber-200/70 dark:text-umber-300 dark:hover:bg-umber-700/60"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  if (mode === "founding") {
    if (dismissed) return null;
    const until = foundingUntil
      ? new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
          year: "numeric",
          month: "long",
        }).format(new Date(foundingUntil))
      : "";
    return (
      <div className="border-b border-umber-200 bg-umber-100 text-umber-900 dark:border-umber-700/60 dark:bg-umber-800/60 dark:text-umber-100">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <Sparkles size={16} className="shrink-0 text-umber-600 dark:text-umber-300" aria-hidden />
          <p className="min-w-[14rem] flex-1">
            <span className="font-semibold">{t("billing.founding_banner_title")}</span>{" "}
            <span className="text-umber-700 dark:text-umber-200">
              {t("billing.founding_banner_body", { date: until })}
            </span>
          </p>
          <button
            type="button"
            onClick={dismissFounding}
            aria-label={t("verify.banner_dismiss")}
            className="rounded-md p-1 text-umber-600 hover:bg-umber-200/70 dark:text-umber-300 dark:hover:bg-umber-700/60"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  // mode === "lapsed"
  return (
    <div className="border-b border-blush-200 bg-blush-50 text-blush-900 dark:border-blush-700/60 dark:bg-blush-950/40 dark:text-blush-100">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6 lg:px-8 xl:max-w-screen-2xl xl:px-10">
        <Lock size={16} className="shrink-0" aria-hidden="true" />
        <p className="min-w-[14rem] flex-1">
          <span className="font-semibold">{t("billing.banner_title")}</span>{" "}
          <span className="text-blush-800 dark:text-blush-200">{t("billing.banner_body")}</span>
        </p>
        {enabled && (
          <button
            type="button"
            onClick={onSubscribe}
            disabled={busy}
            className="btn-primary btn-sm"
          >
            {busy ? t("billing.opening") : t("billing.banner_cta")}
          </button>
        )}
      </div>
    </div>
  );
}
