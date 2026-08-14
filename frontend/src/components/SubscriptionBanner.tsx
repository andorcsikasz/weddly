// Top-of-app billing banner. Mutually-exclusive states:
//   - lapsed (free period over, not subscribed) → read-only band + Subscribe.
//   - founding member → a one-time celebratory band ("you're in the first 200,
//     free for 18 months"), dismissible and remembered in localStorage.
//   - grace → the trial closed and the 7-day window before read-only is running.
//     Outranks solo (it is the one band with a deadline behind it) and is NOT
//     dismissible. Offers both routes in the same order as the trial_ended mail:
//     invite the partner first, add payment second.
//   - solo → a still-free workspace with no partner yet, nudged to invite their
//     partner so the platform stays free until the wedding day past the paid
//     launch. Dismissible; auto-hides once the paid-launch date passes.
// Renders nothing for paying couples, during onboarding (no couple yet), or
// before billing data loads.

import { Clock, Eye, Lock, Sparkles, UserPlus, X } from "lucide-react";
import { TRIAL_GRACE_MS } from "@shared/billing";
import { intlLocale } from "../lib/format";
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
  const [mode, setMode] = useState<
    "none" | "lapsed" | "founding" | "solo" | "planner_viewer" | "grace"
  >("none");
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [foundingUntil, setFoundingUntil] = useState<number | null>(null);
  const [graceEnds, setGraceEnds] = useState<number | null>(null);
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
        setCheckoutEnabled(s.checkout_enabled);
        if (!s.billing.entitled) {
          // Planner-managed couples that have lapsed are VIEWER-ONLY (the planner
          // edits), not "subscribe to unlock" — so they get an explanatory band
          // with no subscribe CTA instead of the normal lapsed prompt.
          setMode(s.billing.reason === "planner_managed_viewer" ? "planner_viewer" : "lapsed");
        } else if (s.billing.reason === "trial_grace") {
          // The trial closed and the grace clock is running. This outranks the
          // solo nudge (and is NOT dismissible) because it is the only band with
          // a deadline behind it: the same one the trial_ended mail names.
          setMode("grace");
          setGraceEnds(
            s.billing.trial_ends_at === null ? null : s.billing.trial_ends_at + TRIAL_GRACE_MS,
          );
        } else if (!s.has_partner) {
          // Every partner-less couple: nudge them to invite their partner so the
          // platform stays free until their wedding day. Takes priority over the
          // founding band so a solo first-200 couple still gets the invite push.
          setMode("solo");
        } else if (s.billing.subscription_status === "founding" && s.billing.is_founding_member) {
          // Celebratory "first 200" band, reserved for the badge holders who
          // already have their partner on board.
          setMode("founding");
          setFoundingUntil(s.billing.founding_until);
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

  if (mode === "grace") {
    // Amber, not the neutral umber the other nudges use: this one has a date on
    // it. Both routes are offered, partner first, matching the mail's order.
    const until = graceEnds
      ? new Intl.DateTimeFormat(intlLocale(locale), {
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(new Date(graceEnds))
      : "";
    return (
      <div
        data-banner
        className="relative border-b border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:gap-y-1.5 sm:px-6 sm:py-2 sm:text-sm lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <Clock
            size={14}
            className="shrink-0 text-amber-700 dark:text-amber-300 sm:h-4 sm:w-4"
            aria-hidden
          />
          <p className="min-w-0 flex-1 sm:min-w-[14rem]">
            <span className="font-semibold">{t("billing.grace_banner_title")}</span>{" "}
            <span className="hidden text-amber-800 dark:text-amber-200 sm:inline">
              {t("billing.grace_banner_body", { date: until })}
            </span>
          </p>
          <Link to="/app/profile" className="btn-primary btn-sm">
            {t("billing.grace_banner_cta")}
          </Link>
          {checkoutEnabled && (
            <button
              type="button"
              onClick={onSubscribe}
              disabled={busy}
              className="btn-ghost btn-sm shrink-0"
            >
              {t("billing.grace_banner_pay")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (mode === "solo") {
    // Shown to every partner-less couple: the first 200 are free until their
    // wedding day, so the nudge is to invite the partner and lock that in.
    if (soloDismissed) return null;
    return (
      <div
        data-banner
        className="relative border-b border-umber-200 bg-umber-100 text-umber-900 dark:border-umber-700/60 dark:bg-umber-800/60 dark:text-umber-100"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:gap-y-1.5 sm:px-6 sm:py-2 sm:text-sm lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <UserPlus
            size={14}
            className="shrink-0 text-umber-600 dark:text-umber-300 sm:h-4 sm:w-4"
            aria-hidden
          />
          <p className="min-w-0 flex-1 sm:min-w-[14rem]">
            <span className="font-semibold">{t("billing.solo_banner_title")}</span>{" "}
            <span className="hidden text-umber-700 dark:text-umber-200 sm:inline">
              {t("billing.solo_banner_body")}
            </span>
          </p>
          <Link to="/app/profile" className="btn-primary btn-sm" onClick={dismissSolo}>
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
      ? new Intl.DateTimeFormat(intlLocale(locale), {
          year: "numeric",
          month: "long",
        }).format(new Date(foundingUntil))
      : "";
    return (
      <div
        data-banner
        className="relative border-b border-umber-200 bg-umber-100 text-umber-900 dark:border-umber-700/60 dark:bg-umber-800/60 dark:text-umber-100"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:gap-y-1.5 sm:px-6 sm:py-2 sm:text-sm lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <Sparkles
            size={14}
            className="shrink-0 text-umber-600 dark:text-umber-300 sm:h-4 sm:w-4"
            aria-hidden
          />
          <p className="min-w-0 flex-1 sm:min-w-[14rem]">
            <span className="font-semibold">{t("billing.founding_banner_title")}</span>{" "}
            <span className="hidden text-umber-700 dark:text-umber-200 sm:inline">
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

  if (mode === "planner_viewer") {
    // Planner-managed couple, viewer mode: the planner is editing on their
    // behalf. Explanatory only - no subscribe CTA (they don't pay to unlock the
    // whole workspace; they can buy back just the guest page on its own page).
    return (
      <div
        data-banner
        className="relative border-b border-umber-200 bg-umber-100 text-umber-900 dark:border-umber-700/60 dark:bg-umber-800/60 dark:text-umber-100"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:gap-y-1.5 sm:px-6 sm:py-2 sm:text-sm lg:px-8 xl:max-w-screen-2xl xl:px-10">
          <Eye
            size={14}
            className="shrink-0 text-umber-600 dark:text-umber-300 sm:h-4 sm:w-4"
            aria-hidden
          />
          <p className="min-w-0 flex-1 sm:min-w-[14rem]">
            <span className="font-semibold">{t("billing.planner_managed_banner_title")}</span>{" "}
            <span className="hidden text-umber-700 dark:text-umber-200 sm:inline">
              {t("billing.planner_managed_banner_body")}
            </span>
          </p>
        </div>
      </div>
    );
  }

  // mode === "lapsed"
  return (
    <div
      data-banner
      className="relative border-b border-blush-200 bg-blush-50 text-blush-900 dark:border-blush-700/60 dark:bg-blush-950/40 dark:text-blush-100"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:gap-x-4 sm:gap-y-2 sm:px-6 sm:py-2 sm:text-sm lg:px-8 xl:max-w-screen-2xl xl:px-10">
        <Lock size={14} className="shrink-0 sm:h-4 sm:w-4" aria-hidden="true" />
        <p className="min-w-0 flex-1 sm:min-w-[14rem]">
          <span className="font-semibold">{t("billing.banner_title")}</span>{" "}
          <span className="hidden text-blush-800 dark:text-blush-200 sm:inline">
            {t("billing.banner_body")}
          </span>
        </p>
        {checkoutEnabled && (
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
