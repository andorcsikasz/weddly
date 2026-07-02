// Planner-side demo launcher. One tap hits `POST /api/demo/planner/start`,
// which spins up a "Fairy Godmother Weddings" planner account pre-loaded with
// a book of fairy-tale clients, and drops the visitor into /app/planner.
//
// Mirrors DemoLaunchCard (the couple-side launcher) but renders as an inline
// secondary button beside the /planners hero CTA rather than a sticker card.

import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { markCurrentSessionDemo } from "../lib/demoSession";
import { demoApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export function PlannerDemoLaunchButton() {
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
      const res = await demoApi.startPlanner();
      markCurrentSessionDemo();
      setSession(res.session.token, res.session.user);
      // Hard navigate so the planner shell remounts on a clean session.
      navigate("/app/planner", { replace: true });
    } catch {
      setError(t("planners.demo_error"));
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
        className="btn btn-outline inline-flex items-center gap-2 px-6 py-3 text-sm disabled:cursor-wait disabled:opacity-80"
      >
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            {t("planners.demo_loading")}
          </>
        ) : (
          <>
            {t("planners.demo_cta")}
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
