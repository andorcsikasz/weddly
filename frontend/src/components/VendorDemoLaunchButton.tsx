// Vendor-side demo launcher. One tap hits `POST /api/demo/vendor/start`,
// which spins up a Shrek-themed "Mézi Tortaműhely" / "Gingy's Wedding Cakes"
// vendor account pre-loaded with fairy-tale client inquiries, and drops the
// visitor into /vendor.
//
// Mirrors PlannerDemoLaunchButton: an inline secondary action beside the
// /vendors hero CTA. The outline button is the default and what /vendors uses
// at `size="lg"`, so it stands shoulder to shoulder with the signup CTA: a
// vendor who won't hand over an email will still click through a demo, and as
// a text link this was too easy to miss. `variant="quiet"` keeps the plain
// text-link rendering for any surface that wants exactly one visible button.

import { Eye, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { markCurrentSessionDemo } from "../lib/demoSession";
import { demoApi } from "../lib/endpoints";
import { contentLocale, useT } from "../lib/i18n";

export function VendorDemoLaunchButton({
  variant = "outline",
  size = "md",
}: {
  variant?: "outline" | "quiet";
  /** "lg" matches `.btn-lg` (px-6 py-3 text-base) so the button lines up with a
   *  `btn-primary btn-lg` next to it instead of sitting a few pixels short. */
  size?: "md" | "lg";
}) {
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
        className={
          variant === "quiet"
            ? "inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 underline-offset-2 hover:underline disabled:cursor-wait disabled:opacity-80 dark:text-umber-200"
            : `btn btn-outline inline-flex items-center gap-2 shadow-sm disabled:cursor-wait disabled:opacity-80 ${
                size === "lg" ? "btn-lg" : "px-6 py-3 text-sm"
              }`
        }
      >
        {busy ? (
          <>
            <Loader2 size={size === "lg" ? 18 : 16} className="animate-spin" aria-hidden="true" />
            {t("vendors.demo_loading")}
          </>
        ) : (
          <>
            {/* An eye, not an arrow: the arrow is the signup CTA's glyph and two
                identical arrows side by side read as two of the same button. */}
            {variant === "outline" && <Eye size={size === "lg" ? 18 : 16} aria-hidden="true" />}
            {t("vendors.demo_cta")}
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
