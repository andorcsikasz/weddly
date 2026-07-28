// Couple-side demo launcher as an inline button. One tap hits
// `POST /api/demo/start` and drops the visitor into /app with a fully seeded
// fairytale workspace.
//
// Same call as the old sticker card, rendered as the secondary CTA beside the
// landing hero's signup button — the two intents (sign up / look around) read
// as a pair there, which a floating card on the far side of the hero never did.
// The fairytale identity (Shrek & Fiona) stays a reveal once the visitor is
// inside /app, not a marketing line out here.

import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { markCurrentSessionDemo } from "../lib/demoSession";
import { demoApi } from "../lib/endpoints";
import { contentLocale, useT } from "../lib/i18n";

export function DemoLaunchButton({ className = "" }: { className?: string }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Pass the active UI locale so the seeded workspace content (guests,
      // tasks, budget lines, notes) matches the language of the UI chrome.
      const res = await demoApi.start(contentLocale(locale));
      markCurrentSessionDemo();
      setSession(res.session.token, res.session.user);
      // Hard navigate to /app so the shell remounts on a clean session.
      navigate("/app", { replace: true });
    } catch {
      setError(t("landing.demo_card_error"));
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={launch}
        disabled={busy}
        aria-busy={busy}
        className={`btn-outline btn-lifted btn-landing btn-lg disabled:cursor-wait disabled:opacity-80 ${className}`}
      >
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            {t("landing.demo_card_loading")}
          </>
        ) : (
          <>
            {t("landing.demo_card_cta")}
            <ArrowRight size={16} aria-hidden="true" />
          </>
        )}
      </button>
      {error && (
        <p role="alert" className="mt-2 w-full text-xs font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </>
  );
}
