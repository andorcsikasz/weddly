// Vendor-side demo launcher. One tap hits `POST /api/demo/vendor/start`,
// which spins up a Shrek-themed "Mézi Tortaműhely" / "Gingy's Wedding Cakes"
// vendor account pre-loaded with fairy-tale client inquiries, and drops the
// visitor into /vendor.
//
// Mirrors PlannerDemoLaunchButton: an inline secondary button beside the
// /vendors hero CTA.

import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { markCurrentSessionDemo } from "../lib/demoSession";
import { demoApi } from "../lib/endpoints";
import { contentLocale, useT } from "../lib/i18n";

export function VendorDemoLaunchButton() {
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
      // Pass the active UI locale so the seeded workspace (listing copy,
      // client names, payment labels) is written in the same language as
      // the chrome around it.
      const res = await demoApi.startVendor(contentLocale(locale));
      markCurrentSessionDemo();
      setSession(res.session.token, res.session.user);
      // Hard navigate so the vendor shell remounts on a clean session.
      navigate("/vendor", { replace: true });
    } catch {
      setError(t("vendors.demo_error"));
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
            {t("vendors.demo_loading")}
          </>
        ) : (
          <>
            {t("vendors.demo_cta")}
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
