import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { applyStoredConsent, getStatisticsConsent, setStatisticsConsent } from "../lib/consent";
import { useT } from "../lib/i18n";

/** First-party replacement for the old Cookiebot banner. Two equally
 *  prominent buttons only (accept / decline) — Weddly gates exactly one
 *  non-essential category (statistics), so there is no granular picker to
 *  build. Mounted once at the app root; renders nothing once a decision is
 *  on record. */
/** Pages a wedding guest holds up as a camera. The banner covered the
 *  bottom third of the screen there, shutter included, on the one page where
 *  a guest has a few seconds and no interest in our analytics. Not asking is
 *  the same as declining: nothing gated loads until someone says yes. */
const NO_BANNER_PREFIXES = ["/photos/", "/camera/try"];

export function CookieConsentBanner() {
  const { t } = useT();
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (getStatisticsConsent() === null) {
      setVisible(true);
    } else {
      applyStoredConsent();
    }
  }, []);

  if (!visible || NO_BANNER_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const decide = (granted: boolean) => {
    setStatisticsConsent(granted);
    setVisible(false);
  };

  return createPortal(
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("cookie_consent.title")}
      className="fixed inset-x-0 bottom-0 z-[70] w-full border-t border-paper-300 bg-paper-100 p-5 shadow-2xl animate-fade-in-up dark:border-umber-700 dark:bg-umber-800 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-72 sm:rounded-2xl sm:border"
    >
      <p className="text-sm font-bold text-ink-900 dark:text-paper-100">
        {t("cookie_consent.title")}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-600 dark:text-paper-300">
        {t("cookie_consent.body")}
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => decide(true)}
          className="w-full rounded-full bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-white"
        >
          {t("cookie_consent.accept")}
        </button>
        <button
          type="button"
          onClick={() => decide(false)}
          className="w-full rounded-full border border-paper-300 px-4 py-2 text-sm font-semibold text-ink-700 transition-colors hover:bg-paper-200 dark:border-umber-600 dark:text-paper-200 dark:hover:bg-umber-700"
        >
          {t("cookie_consent.decline")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
