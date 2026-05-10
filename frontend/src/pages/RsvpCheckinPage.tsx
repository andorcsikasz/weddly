// Public airport-style RSVP check-in. Two big fields (couple slug + 4-digit
// code) → one resolved household → one RSVP submission for everyone in it.

import type { PublicCheckinView } from "@shared/types";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HouseholdRsvpForm } from "../components/HouseholdRsvpForm";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** Which input the lookup error highlights. `null` = generic banner. */
type LookupErrorField = "couple" | "code" | "both" | null;

export default function RsvpCheckinPage() {
  const { t, locale, setLocale } = useT();
  const [params, setParams] = useSearchParams();

  const initialCouple = (params.get("couple") ?? "").toUpperCase();
  const initialCode = params.get("code") ?? "";

  const [coupleInput, setCoupleInput] = useState(initialCouple);
  const [codeInput, setCodeInput] = useState(initialCode);
  const [view, setView] = useState<PublicCheckinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<LookupErrorField>(null);
  const [submitting, setSubmitting] = useState(false);

  const coupleInputRef = useRef<HTMLInputElement>(null);

  // Auto-submit when the URL was hand-fed both values (e.g. couple shared
  // a pre-filled link). Run once.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    if (initialCouple && initialCode && !view) {
      autoTried.current = true;
      void doLookup(initialCouple, initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusCoupleInput() {
    // Refocus the slug input next-frame so the toast/animation has time
    // to start fading before we steal focus.
    requestAnimationFrame(() => coupleInputRef.current?.focus());
  }

  function resetForNextGuest() {
    setView(null);
    setError(null);
    setErrorField(null);
    setCoupleInput("");
    setCodeInput("");
    setParams({}, { replace: true });
    focusCoupleInput();
  }

  async function doLookup(couple: string, code: string) {
    setSubmitting(true);
    setError(null);
    setErrorField(null);
    try {
      const r = await rsvpApi.lookup(couple, code);
      setView(r.rsvp);
      setParams({ couple, code }, { replace: true });
    } catch (err) {
      // Map the server's text response onto field-level errors. Backend
      // returns "Couple not found" (404) when the slug is wrong, and
      // "Code not found" (404) when the slug is fine but the code isn't.
      // 400 means malformed input — usually one or both fields invalid.
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        const msg = err.message ?? "";
        if (/couple/i.test(msg)) {
          setError(t("rsvp.checkin_lookup_couple_unknown"));
          setErrorField("couple");
        } else if (/code/i.test(msg)) {
          setError(t("rsvp.checkin_lookup_code_unknown"));
          setErrorField("code");
        } else {
          setError(t("rsvp.checkin_lookup_failed"));
          setErrorField("both");
        }
      } else {
        setError(err instanceof ApiError ? err.message : t("common.error_generic"));
        setErrorField(null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmitLookup(e: FormEvent) {
    e.preventDefault();
    const couple = coupleInput.trim().toUpperCase();
    const code = codeInput.trim();
    if (!couple || !code) {
      setError(t("rsvp.checkin_lookup_missing"));
      setErrorField(!couple && !code ? "both" : !couple ? "couple" : "code");
      return;
    }
    void doLookup(couple, code);
  }

  return (
    <FullPage>
      <div className="mb-6 flex items-center justify-end">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
        >
          {locale === "hu" ? "EN" : "HU"}
        </button>
      </div>

      {view ? (
        <HouseholdRsvpForm
          view={view}
          onUpdated={setView}
          onBack={() => {
            setView(null);
            setError(null);
            setErrorField(null);
          }}
          onNextGuest={resetForNextGuest}
        />
      ) : (
        <form className="card stationery animate-fade-in-up" onSubmit={onSubmitLookup}>
          {/* Quiet airport-style kicker — anchors the metaphor before the
              guest types anything. Mono uppercase, low contrast. */}
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink-500">
            {t("rsvp.checkin_kicker")}
          </p>
          <h1 className="mt-1 font-serif text-3xl">{t("rsvp.checkin_title")}</h1>
          <p className="mt-2 text-sm text-ink-600">{t("rsvp.checkin_intro")}</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="field-label" htmlFor="rsvp-couple">
                {t("rsvp.checkin_couple_label")}
              </label>
              <input
                id="rsvp-couple"
                ref={coupleInputRef}
                className={
                  errorField === "couple" || errorField === "both"
                    ? "input font-mono uppercase tracking-[0.3em] text-center text-lg min-h-14 border-blush-400 focus:border-blush-500 placeholder:text-ink-300 placeholder:font-normal"
                    : "input font-mono uppercase tracking-[0.3em] text-center text-lg min-h-14 placeholder:text-ink-300 placeholder:font-normal"
                }
                value={coupleInput}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="BRIDEGROOM"
                onChange={(e) => setCoupleInput(e.target.value.toUpperCase())}
                onFocus={(e) =>
                  e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
                }
                maxLength={24}
                aria-invalid={errorField === "couple" || errorField === "both"}
                aria-describedby="rsvp-couple-help"
              />
              <p id="rsvp-couple-help" className="mt-1 text-xs text-ink-500">
                {t("rsvp.checkin_couple_help")}
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="rsvp-code">
                {t("rsvp.checkin_code_label")}
              </label>
              <input
                id="rsvp-code"
                className={
                  errorField === "code" || errorField === "both"
                    ? "input font-mono tracking-[0.5em] text-center text-2xl min-h-14 border-blush-400 focus:border-blush-500 placeholder:text-ink-300"
                    : "input font-mono tracking-[0.5em] text-center text-2xl min-h-14 placeholder:text-ink-300"
                }
                value={codeInput}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                enterKeyHint="go"
                placeholder="0000"
                onChange={(e) => setCodeInput(e.target.value.replace(/[^0-9]/g, ""))}
                onFocus={(e) =>
                  e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
                }
                maxLength={4}
                aria-invalid={errorField === "code" || errorField === "both"}
                aria-describedby="rsvp-code-help"
              />
              <p id="rsvp-code-help" className="mt-1 text-xs text-ink-500">
                {t("rsvp.checkin_code_help")}
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 space-y-2" aria-live="polite" aria-atomic="true">
              <p className="field-error" role="alert">
                {error}
              </p>
              <a
                className="inline-block text-sm text-ink-600 underline underline-offset-2 hover:text-ink-900"
                href={t("rsvp.checkin_contact_hosts_email")}
              >
                {t("rsvp.checkin_contact_hosts")}
              </a>
            </div>
          )}

          <button type="submit" className="btn-accent btn-lg mt-6 w-full" disabled={submitting}>
            {submitting ? t("common.loading") : t("rsvp.checkin_submit")}
          </button>
        </form>
      )}
    </FullPage>
  );
}

function FullPage({ children }: { children: React.ReactNode }) {
  // pb-32 reserves space at the bottom so the iOS soft keyboard doesn't park
  // itself directly over the submit button when a guest taps a meal/dietary
  // input — they can scroll past the form and still see the CTA.
  return (
    <div className="min-h-full bg-paper-100 px-4 pb-32 pt-8 sm:pt-16">
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
}
