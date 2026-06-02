// Top-of-app sticky banner shown when a couple's free period has lapsed and
// they aren't subscribed — the workspace is read-only until they subscribe.
// Mirrors VerifyEmailBanner's single-line band. The "Subscribe" action mints a
// Stripe Checkout URL and redirects. Hidden entirely while the couple is
// entitled (trial / founding / active), during onboarding (no couple yet), or
// before billing goes live.

import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { billingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export function SubscriptionBanner() {
  const { user } = useAuth();
  const { t } = useT();
  const [lapsed, setLapsed] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setLapsed(false);
      return;
    }
    let alive = true;
    billingApi
      .status()
      .then((s) => {
        if (!alive) return;
        setLapsed(!s.billing.entitled);
        setEnabled(s.enabled);
      })
      .catch(() => {
        // No couple yet (onboarding) or a transient error → don't show.
        if (alive) setLapsed(false);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!user || !lapsed) return null;

  async function onSubscribe() {
    setBusy(true);
    try {
      const { url } = await billingApi.checkout();
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  }

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
