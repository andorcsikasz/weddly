// Landing-page "Try Shrek & Fiona's wedding" card. Sits in the hero's
// right column on desktop, full-width below the headline on mobile. One
// click → `POST /api/demo/start` → the returned session lands the visitor
// inside /app with a fully-seeded fairytale wedding.
//
// We deliberately keep this component self-contained — no router-level
// guards, no auth refactors. The demo just looks like another route the
// signed-in user can land on, which is exactly what it is.

import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { demoApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { ApiError } from "../lib/api";

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
      // Hard navigate to /app so the AppShell mounts with a clean slate and
      // the protected pages re-fetch couple-scoped data against the fresh
      // session — no lingering /api/couples/current cache from a prior view.
      navigate("/app", { replace: true });
    } catch (e) {
      // Server rate-limit or transient outage. Show the localized message;
      // re-clicking the button refreshes the bucket within a minute.
      const msg =
        e instanceof ApiError ? t("landing.demo_card_error") : t("landing.demo_card_error");
      setError(msg);
      setBusy(false);
    }
  };

  return (
    <aside
      aria-labelledby="demo-card-title"
      className="relative w-full max-w-md rotate-[1.25deg] rounded-2xl border border-paper-300 bg-paper-50 p-6 shadow-[0_24px_60px_-24px_rgba(16,24,48,0.25)] ring-1 ring-blush-200/60 dark:border-umber-700 dark:bg-umber-800 dark:ring-blush-700/30 sm:p-7"
    >
      {/* Stationery-style "stamp" pinned to the top-right corner — sets the
          playful, story-book tone without breaking the paper aesthetic. */}
      <span className="pointer-events-none absolute -top-3 right-5 inline-flex select-none items-center gap-1.5 rounded-full bg-blush-100 px-3 py-1 font-serif text-xs italic text-blush-700 ring-1 ring-blush-300 dark:bg-blush-900/40 dark:text-blush-100 dark:ring-blush-700">
        <Sparkles size={12} aria-hidden="true" />
        {t("landing.demo_card_eyebrow")}
      </span>

      <h2
        id="demo-card-title"
        className="font-serif text-2xl italic leading-[1.05] tracking-tight text-ink-900 dark:text-paper-50 sm:text-3xl"
      >
        {t("landing.demo_card_title")}
      </h2>

      <p className="mt-3 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {t("landing.demo_card_body")}
      </p>

      <ul className="mt-4 grid grid-cols-1 gap-1.5 text-xs uppercase tracking-[0.18em] text-ink-500 dark:text-umber-300">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-blush-600" />
          {t("landing.demo_card_meta_a")}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-blush-600" />
          {t("landing.demo_card_meta_b")}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-blush-600" />
          {t("landing.demo_card_meta_c")}
        </li>
      </ul>

      <button
        type="button"
        onClick={launch}
        disabled={busy}
        className="btn-primary btn-lg mt-6 inline-flex w-full items-center justify-center gap-2 shadow-sm disabled:cursor-wait disabled:opacity-80"
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

      <p className="mt-3 text-xs leading-relaxed text-ink-500 dark:text-umber-300">
        {t("landing.demo_card_disclaimer")}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </aside>
  );
}
