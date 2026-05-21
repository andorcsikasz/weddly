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
      className="relative w-full max-w-[280px] rotate-[-3deg] rounded-2xl border border-paper-300 bg-paper-50 p-5 text-left shadow-[0_18px_40px_-20px_rgba(16,24,48,0.28)] transition-transform hover:rotate-[-1deg] dark:border-umber-700 dark:bg-umber-800 sm:p-6"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
        {t("landing.demo_card_eyebrow")}
      </p>
      <h2
        id="demo-card-title"
        className="mt-2 font-serif text-2xl italic leading-[1.05] text-ink-900 dark:text-paper-50"
      >
        {t("landing.demo_card_title")}
      </h2>
      <button
        type="button"
        onClick={launch}
        disabled={busy}
        aria-busy={busy}
        // Sage instead of ink-900 so the demo CTA stays visually distinct
        // Centralised `.btn-success` carries the sage face + sage rim so the
        // lifted shadow stays in the same colour family. Was previously a
        // 320-char inline mix of `bg-sage-700` + arbitrary `[--btn-rim:#…]`
        // hex props — flagged by the design-system-critic agent.
        className="btn-success btn-lifted btn-landing mt-5 inline-flex w-full items-center justify-center gap-1.5 text-sm disabled:cursor-wait disabled:opacity-80"
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
