// Public airport-style RSVP check-in. Two big fields (couple slug + 4-digit
// code) → one resolved household → one RSVP submission for everyone in it.

import type { PublicCheckinView } from "@shared/types";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HouseholdRsvpForm } from "../components/HouseholdRsvpForm";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function RsvpCheckinPage() {
  const { t, locale, setLocale } = useT();
  const [params, setParams] = useSearchParams();

  const initialCouple = (params.get("couple") ?? "").toUpperCase();
  const initialCode = params.get("code") ?? "";

  const [coupleInput, setCoupleInput] = useState(initialCouple);
  const [codeInput, setCodeInput] = useState(initialCode);
  const [view, setView] = useState<PublicCheckinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  async function doLookup(couple: string, code: string) {
    setSubmitting(true);
    setError(null);
    try {
      const r = await rsvpApi.lookup(couple, code);
      setView(r.rsvp);
      setParams({ couple, code }, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        setError(t("rsvp.checkin_lookup_failed"));
      } else {
        setError(err instanceof ApiError ? err.message : t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmitLookup(e: FormEvent) {
    e.preventDefault();
    const couple = coupleInput.trim().toUpperCase();
    const code = codeInput.trim();
    if (!couple || !code) return;
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
          }}
        />
      ) : (
        <form className="card stationery animate-fade-in-up" onSubmit={onSubmitLookup}>
          <h1 className="font-serif text-3xl">{t("rsvp.checkin_title")}</h1>
          <p className="mt-2 text-sm text-ink-600">{t("rsvp.checkin_intro")}</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="field-label" htmlFor="rsvp-couple">
                {t("rsvp.checkin_couple_label")}
              </label>
              <input
                id="rsvp-couple"
                className="input font-mono uppercase tracking-[0.3em] text-center text-lg"
                value={coupleInput}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="ANDORSARI"
                onChange={(e) => setCoupleInput(e.target.value.toUpperCase())}
                maxLength={24}
              />
              <p className="mt-1 text-xs text-ink-500">{t("rsvp.checkin_couple_help")}</p>
            </div>
            <div>
              <label className="field-label" htmlFor="rsvp-code">
                {t("rsvp.checkin_code_label")}
              </label>
              <input
                id="rsvp-code"
                className="input font-mono tracking-[0.5em] text-center text-2xl"
                value={codeInput}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0000"
                onChange={(e) => setCodeInput(e.target.value.replace(/[^0-9]/g, ""))}
                maxLength={4}
              />
              <p className="mt-1 text-xs text-ink-500">{t("rsvp.checkin_code_help")}</p>
            </div>
          </div>

          {error && <p className="field-error mt-4">{error}</p>}

          <button type="submit" className="btn-accent btn-lg mt-6 w-full" disabled={submitting}>
            {submitting ? t("common.loading") : t("rsvp.checkin_submit")}
          </button>
        </form>
      )}
    </FullPage>
  );
}

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-paper-100 px-4 py-8 sm:py-16">
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
}
