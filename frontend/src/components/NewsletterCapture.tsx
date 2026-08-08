// Public newsletter capture card (landing + blog). Double opt-in: submit only
// triggers a confirmation email, so the success state says "check your inbox"
// rather than "you're subscribed". Consent checkbox is required (Grtv. §6);
// the accepted privacy version rides along so the backend consent ledger
// records exactly which text was on screen.

import { PRIVACY_VERSION } from "@shared/legal";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { newsletterApi } from "../lib/endpoints";
import { contentLocale, useT } from "../lib/i18n";

export function NewsletterCapture({ source }: { source: string }) {
  const { t, locale } = useT();
  const [email, setEmail] = useState("");
  const [consented, setConsented] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const consentId = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consented) {
      setError(t("newsletter.error_consent"));
      return;
    }
    setError(null);
    setState("sending");
    try {
      await newsletterApi.subscribe({
        email: email.trim(),
        locale: contentLocale(locale),
        source,
        privacy_version: PRIVACY_VERSION,
      });
      setState("done");
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : t("common.error_generic"));
    }
  };

  return (
    <div className="rounded-xl border border-paper-300 bg-white px-5 py-6 dark:border-umber-700 dark:bg-umber-800 sm:px-6">
      {state === "done" ? (
        <div aria-live="polite">
          <h3 className="font-grotesk text-2xl font-semibold leading-[1.05] tracking-tight text-umber-900 dark:text-paper-50 sm:text-3xl lg:text-4xl">
            {t("newsletter.success_title")}
          </h3>
          <p className="mt-2 font-grotesk text-sm leading-relaxed text-umber-700 dark:text-umber-200">
            {t("newsletter.success_body")}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate={false}>
          {/* One line, no supporting paragraph: the cadence-and-no-spam
              reassurance read as filler above a field that explains itself. */}
          <h3 className="font-grotesk text-2xl font-semibold leading-[1.05] tracking-tight text-umber-900 dark:text-paper-50 sm:text-3xl lg:text-4xl">
            {t("newsletter.title")}
          </h3>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("newsletter.email_placeholder")}
              autoComplete="email"
              className="input sm:flex-1"
              disabled={state === "sending"}
            />
            <button
              type="submit"
              className="btn-primary shrink-0 disabled:border disabled:border-paper-300 disabled:bg-paper-200 disabled:text-umber-600 disabled:opacity-100 dark:disabled:border-umber-600 dark:disabled:bg-umber-700 dark:disabled:text-umber-200"
              disabled={state === "sending" || email.trim().length === 0 || !consented}
              title={
                email.trim().length > 0 && !consented ? t("newsletter.error_consent") : undefined
              }
            >
              {state === "sending" ? t("newsletter.submitting") : t("newsletter.submit")}
            </button>
          </div>
          <label
            htmlFor={consentId}
            className="mt-3 flex min-h-tap cursor-pointer items-start gap-2 py-1 font-grotesk text-xs leading-relaxed text-umber-700 dark:text-umber-200"
          >
            <input
              id={consentId}
              type="checkbox"
              checked={consented}
              onChange={(e) => {
                setConsented(e.target.checked);
                if (e.target.checked) setError(null);
              }}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-umber-700"
            />
            <span>
              {t("newsletter.consent")}{" "}
              <Link to="/privacy" className="underline underline-offset-2 hover:text-umber-500">
                {t("newsletter.consent_link")}
              </Link>
            </span>
          </label>
          {error && (
            <p
              role="alert"
              className="mt-2 font-grotesk text-xs text-blush-600 dark:text-blush-400"
            >
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
