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
import { demoApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const DEMO_FLAG_KEY = "weddly.demo_session";

export function isCurrentSessionDemo(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearDemoSessionFlag() {
  try {
    localStorage.removeItem(DEMO_FLAG_KEY);
  } catch {
    // ignore
  }
}

function markCurrentSessionDemo() {
  try {
    localStorage.setItem(DEMO_FLAG_KEY, "1");
  } catch {
    // ignore
  }
}

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
      className="relative w-full max-w-[280px] rounded-2xl border border-ink-900/15 p-5 text-left dark:border-paper-50/15 sm:p-6"
    >
      <p className="font-grotesk text-[0.7rem] font-medium uppercase tracking-[0.22em] text-ink-500 dark:text-umber-200">
        {t("landing.demo_card_eyebrow")}
      </p>
      <h2
        id="demo-card-title"
        className="mt-2 font-grotesk text-2xl font-medium leading-snug tracking-tight text-ink-900 dark:text-paper-50 sm:text-3xl"
      >
        {t("landing.demo_card_title")}
      </h2>
      <button
        type="button"
        onClick={launch}
        disabled={busy}
        aria-busy={busy}
        // Outline / ghost button (no fill) to match the founders-band design
        // language: General Sans, uppercase tracked, hairline border, warm
        // ink family rather than the old sage filled+lifted CTA.
        className="btn btn-landing mt-6 inline-flex w-full items-center justify-center gap-2 border border-ink-900/30 bg-transparent py-3 font-grotesk text-xs uppercase tracking-[0.2em] text-ink-900 transition-colors hover:bg-ink-900/5 disabled:cursor-wait disabled:opacity-80 dark:border-paper-50/30 dark:text-paper-50 dark:hover:bg-paper-50/10"
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
