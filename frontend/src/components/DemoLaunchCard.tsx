// Landing-page "Try the demo" link. Single text link in the hero — one tap
// hits `POST /api/demo/start` and drops the visitor into /app with a fully
// seeded fairytale workspace. Intentionally minimal: the only message it
// carries is "demo wedding, no signup required". The fairytale identity is
// a reveal once the visitor lands inside /app, not a marketing line here.

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
      // Hard navigate to /app so AppShell remounts against a clean slate.
      navigate("/app", { replace: true });
    } catch {
      // Server rate-limit or transient outage. Re-clicking refreshes the
      // bucket within ~a minute.
      setError(t("landing.demo_card_error"));
      setBusy(false);
    }
  };

  return (
    <div className="text-left sm:text-right">
      <button
        type="button"
        onClick={launch}
        disabled={busy}
        aria-busy={busy}
        className="group inline-flex items-center gap-1.5 font-serif text-base italic text-ink-700 underline decoration-paper-400 decoration-1 underline-offset-[6px] transition-colors hover:text-blush-700 hover:decoration-blush-400 focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:text-paper-200 dark:decoration-umber-600 dark:hover:text-blush-300 dark:hover:decoration-blush-400 dark:focus-visible:ring-paper-100 sm:text-lg"
      >
        {busy ? t("landing.demo_card_loading") : t("landing.demo_card_cta")}
        <span
          aria-hidden="true"
          className="transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </button>
      {error && (
        <p
          role="alert"
          className="mt-2 text-xs font-medium text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
