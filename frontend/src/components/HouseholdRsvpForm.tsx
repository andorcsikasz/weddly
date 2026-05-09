// Per-household RSVP editor. Renders one row per member with status pills
// + meal/dietary/accommodation, and a single Submit that sends the whole
// party in one shot. Shared by both the new /rsvp check-in page and the
// legacy /rsvp/:code resolver.

import type {
  CheckinMemberSubmit,
  HouseholdMember,
  MealChoice,
  PublicCheckinView,
  RsvpStatus,
} from "@shared/types";
import { type FormEvent, useState } from "react";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";

const MEALS: MealChoice[] = ["meat", "fish", "vegetarian", "vegan", "child", "none"];
const STATUSES: RsvpStatus[] = ["yes", "no", "maybe"];

interface MemberDraft {
  id: number;
  full_name: string;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string;
  accommodation_needed: boolean;
  song_request: string;
}

function fromMember(m: HouseholdMember): MemberDraft {
  return {
    id: m.id,
    full_name: m.full_name,
    rsvp_status: m.rsvp_status,
    meal_choice: m.meal_choice,
    dietary: m.dietary ?? "",
    accommodation_needed: m.accommodation_needed,
    song_request: m.song_request ?? "",
  };
}

function toSubmit(d: MemberDraft): CheckinMemberSubmit {
  return {
    guest_id: d.id,
    rsvp_status: d.rsvp_status,
    meal_choice: d.rsvp_status === "yes" ? d.meal_choice : null,
    dietary: d.rsvp_status === "yes" && d.dietary.trim() ? d.dietary.trim() : null,
    accommodation_needed: d.rsvp_status === "yes" ? d.accommodation_needed : false,
    song_request: d.rsvp_status === "yes" && d.song_request.trim() ? d.song_request.trim() : null,
  };
}

export function HouseholdRsvpForm({
  view,
  onUpdated,
  onBack,
}: {
  view: PublicCheckinView;
  onUpdated: (next: PublicCheckinView) => void;
  /** Optional — surfaces the "use a different code" affordance on the lookup
   *  flow so users mistyped codes can step back without reloading. */
  onBack?: () => void;
}) {
  const { t, locale } = useT();
  const [drafts, setDrafts] = useState<MemberDraft[]>(() => view.members.map(fromMember));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function updateMember(id: number, patch: Partial<MemberDraft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await rsvpApi.checkin({
        couple_slug: view.couple_slug,
        household_code: view.household_code,
        members: drafts.map(toSubmit),
      });
      onUpdated(r.rsvp);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card stationery animate-fade-in-up" onSubmit={onSubmit}>
      <p className="text-xs uppercase tracking-widest text-ink-500">{view.couple_display_name}</p>
      {view.wedding_date && (
        <p className="text-sm text-ink-600">{formatDate(view.wedding_date, locale)}</p>
      )}
      <h1 className="mt-4 font-serif text-3xl">{t("rsvp.checkin_household_for")}</h1>
      <p className="mt-1 text-sm text-ink-700">{view.household_label}</p>

      <div className="mt-6 space-y-6">
        {drafts.map((d) => (
          <fieldset
            key={d.id}
            className="rounded-2xl border border-paper-200 bg-paper-50/60 p-4 space-y-3"
          >
            <legend className="px-1 font-serif text-lg text-ink-900">{d.full_name}</legend>

            <div className="grid gap-2 sm:grid-cols-3">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => updateMember(d.id, { rsvp_status: s })}
                  className={
                    d.rsvp_status === s
                      ? "rounded-xl border-2 border-ink-700 bg-ink-700 px-3 py-2 text-sm font-medium text-paper-100"
                      : "rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-700 hover:border-ink-400"
                  }
                >
                  {t(`rsvp.pick_${s}`)}
                </button>
              ))}
            </div>

            {d.rsvp_status === "yes" && (
              <div className="space-y-3">
                <div>
                  <label className="field-label">{t("rsvp.meal")}</label>
                  <select
                    className="input"
                    value={d.meal_choice ?? ""}
                    onChange={(e) =>
                      updateMember(d.id, {
                        meal_choice: (e.target.value as MealChoice) || null,
                      })
                    }
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
                  <label className="field-label">{t("rsvp.checkin_member_dietary")}</label>
                  <input
                    className="input"
                    value={d.dietary}
                    onChange={(e) => updateMember(d.id, { dietary: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={d.accommodation_needed}
                    onChange={(e) => updateMember(d.id, { accommodation_needed: e.target.checked })}
                  />
                  {t("rsvp.checkin_member_accommodation")}
                </label>
                <div>
                  <label className="field-label">{t("rsvp.checkin_member_song")}</label>
                  <input
                    className="input"
                    value={d.song_request}
                    onChange={(e) => updateMember(d.id, { song_request: e.target.value })}
                  />
                </div>
              </div>
            )}
          </fieldset>
        ))}
      </div>

      {error && <p className="field-error mt-4">{error}</p>}
      <button type="submit" className="btn-accent btn-lg mt-6 w-full" disabled={submitting}>
        {submitting ? t("common.loading") : t("rsvp.checkin_save_for_all")}
      </button>
      {done && <p className="mt-2 text-center text-sm text-ink-700">{t("rsvp.thanks_body")}</p>}

      {onBack && (
        <button type="button" className="btn-ghost btn-sm mt-3 w-full" onClick={onBack}>
          {t("rsvp.checkin_back_to_lookup")}
        </button>
      )}
    </form>
  );
}
