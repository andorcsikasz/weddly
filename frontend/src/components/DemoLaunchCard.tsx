// Landing-page demo CTA — a small, lightly-tilted "sticker" card on the
// right of the hero. One tap hits `POST /api/demo/start` and drops the
// visitor into /app with a fully seeded fairytale workspace. The card
// stays minimal: short label, one button, no marketing paragraphs.
//
// The fairytale identity (Shrek & Fiona) is a reveal once the visitor
// lands inside /app — not a marketing line out here.

import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { markCurrentSessionDemo } from "../lib/demoSession";
import { demoApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export function DemoLaunchCard() {
  const { t } = useT();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await demoApi.start();
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
    <aside
      aria-labelledby="demo-card-title"
      /* Compact sticker on phones (~85% of the old card: 188 px wide, tighter
       * padding, smaller title + button) so it stops dominating the hero
       * column on a 360-390 px viewport. Left padding is trimmed harder than
       * the right so the copy hugs the left edge. The sm: bump restores a
       * roomier 238 px card on tablet+. */
      className="relative w-full max-w-[168px] rounded-2xl border border-umber-900/15 bg-paper-50/85 py-2.5 pl-3 pr-4 text-left backdrop-blur-md sm:max-w-[210px] sm:py-3.5 sm:pl-4 sm:pr-5 dark:border-paper-50/15 dark:bg-umber-900/80"
    >
      <h2
        id="demo-card-title"
        className="font-grotesk text-base font-semibold leading-tight tracking-tight text-umber-900 sm:text-lg dark:text-paper-50"
      >
        {t("landing.demo_card_title")}
      </h2>
      <button
        type="button"
        onClick={launch}
        disabled={busy}
        aria-busy={busy}
        // Softer milk-coffee CTA in the founders-band palette: General Sans,
        // sentence-case (more elegant than uppercase tracked), a faint warm
        // umber-600 fill + cream text rather than the heavy near-black
        // espresso. Deliberately quieter than the umber-900 signup primary so
        // the demo reads as the secondary intent.
        className="btn mt-2.5 inline-flex min-h-tap w-full items-center justify-center gap-1.5 bg-umber-600 py-1.5 font-grotesk text-xs font-medium text-paper-50 transition-colors hover:bg-umber-500 disabled:cursor-wait disabled:opacity-80 sm:mt-3 sm:gap-2 sm:py-2 sm:text-sm dark:bg-umber-200 dark:text-umber-900 dark:hover:bg-umber-100"
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {t("landing.demo_card_loading")}
          </>
        ) : (
          <>
            {t("landing.demo_card_cta")}
            <ArrowRight size={14} aria-hidden="true" />
          </>
        )}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </aside>
  );
}
