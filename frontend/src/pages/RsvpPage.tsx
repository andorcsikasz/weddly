// Public RSVP page. The invite code in the URL is the credential.

import type { MealChoice, PublicRsvpView, RsvpStatus } from "@shared/types";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";

const MEALS: MealChoice[] = ["meat", "fish", "vegetarian", "vegan", "child", "none"];

export default function RsvpPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { t, locale, setLocale } = useT();
  const [rsvp, setRsvp] = useState<PublicRsvpView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Local editable copy.
  const [status, setStatus] = useState<RsvpStatus>("pending");
  const [meal, setMeal] = useState<MealChoice | null>(null);
  const [dietary, setDietary] = useState("");
  const [plusOneName, setPlusOneName] = useState("");
  const [plusOneMeal, setPlusOneMeal] = useState<MealChoice | null>(null);
  const [accom, setAccom] = useState(false);
  const [song, setSong] = useState("");

  useEffect(() => {
    rsvpApi
      .get(code)
      .then((r) => {
        setRsvp(r.rsvp);
        setStatus(r.rsvp.rsvp_status);
        setMeal(r.rsvp.meal_choice);
        setDietary(r.rsvp.dietary ?? "");
        setPlusOneName(r.rsvp.plus_one_name ?? "");
        setPlusOneMeal(r.rsvp.plus_one_meal);
        setAccom(r.rsvp.accommodation_needed);
        setSong(r.rsvp.song_request ?? "");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setError(t("rsvp.not_found"));
        else setError(t("common.error_generic"));
      });
  }, [code, t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await rsvpApi.submit(code, {
        rsvp_status: status,
        meal_choice: meal,
        dietary: dietary || null,
        plus_one_name: plusOneName || null,
        plus_one_meal: plusOneName ? plusOneMeal : null,
        accommodation_needed: accom,
        song_request: song || null,
      });
      setRsvp(r.rsvp);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <FullPage>
        <p className="text-sm text-blush-700">{error}</p>
      </FullPage>
    );
  }
  if (!rsvp) {
    return (
      <FullPage>
        <p className="text-sm text-ink-500">{t("common.loading")}</p>
      </FullPage>
    );
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
      <div className="card stationery animate-fade-in-up">
        <p className="text-xs uppercase tracking-widest text-ink-500">{rsvp.couple_display_name}</p>
        {rsvp.wedding_date && (
          <p className="text-sm text-ink-600">{formatDate(rsvp.wedding_date, locale)}</p>
        )}
        <h1 className="mt-4 font-serif text-3xl">{rsvp.full_name}</h1>
        <p className="mt-1 text-sm text-ink-600">{t("rsvp.sub")}</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <p className="field-label">{t("rsvp.will_attend")}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["yes", "no", "maybe"] as RsvpStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={
                    status === s
                      ? "rounded-xl border-2 border-ink-700 bg-ink-700 px-3 py-2 text-sm font-medium text-paper-100"
                      : "rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-700 hover:border-ink-400"
                  }
                >
                  {t(`rsvp.pick_${s}`)}
                </button>
              ))}
            </div>
          </div>

          {status === "yes" && (
            <>
              <div>
                <label className="field-label">{t("rsvp.meal")}</label>
                <select
                  className="input"
                  value={meal ?? ""}
                  onChange={(e) => setMeal((e.target.value as MealChoice) || null)}
                >
                  <option value="">—</option>
                  {MEALS.map((m) => (
                    <option key={m} value={m}>
                      {t(`guests.meal_${m}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">{t("rsvp.dietary")}</label>
                <input
                  className="input"
                  value={dietary}
                  onChange={(e) => setDietary(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">{t("rsvp.plus_one_name")}</label>
                <input
                  className="input"
                  value={plusOneName}
                  onChange={(e) => setPlusOneName(e.target.value)}
                />
              </div>
              {plusOneName && (
                <div>
                  <label className="field-label">{t("rsvp.plus_one_meal")}</label>
                  <select
                    className="input"
                    value={plusOneMeal ?? ""}
                    onChange={(e) => setPlusOneMeal((e.target.value as MealChoice) || null)}
                  >
                    <option value="">—</option>
                    {MEALS.map((m) => (
                      <option key={m} value={m}>
                        {t(`guests.meal_${m}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={accom}
                  onChange={(e) => setAccom(e.target.checked)}
                />
                {t("rsvp.accommodation_q")}
              </label>
              <div>
                <label className="field-label">{t("rsvp.song")}</label>
                <input className="input" value={song} onChange={(e) => setSong(e.target.value)} />
              </div>
            </>
          )}

          <button type="submit" className="btn-accent btn-lg w-full" disabled={submitting}>
            {submitting ? t("common.loading") : t("rsvp.submit")}
          </button>
          {done && <p className="text-center text-sm text-ink-700">{t("rsvp.thanks_body")}</p>}
        </form>
      </div>
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
