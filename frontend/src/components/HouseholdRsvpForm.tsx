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
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useConfirm } from "./ui";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";

const MEALS: MealChoice[] = ["meat", "fish", "vegetarian", "vegan", "child", "none"];
const STATUSES: RsvpStatus[] = ["yes", "no", "maybe", "pending"];

interface MemberDraft {
  id: number;
  full_name: string;
  /** Non-null only for members the form considers a "+1 placeholder" (auto-
   *  named, e.g. "Anna +1"). Editing is allowed so guests can rename them. */
  is_plus_one: boolean;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string;
  accommodation_needed: boolean;
  song_request: string;
}

/** Heuristic — backend doesn't expose `is_plus_one`, but the convention
 *  established by the CSV import / household creation flow is to label
 *  unnamed plus-ones as "<host> +1" or "+1". This lets us at least flag
 *  obvious placeholders so guests can rename them inline. */
function looksLikePlusOnePlaceholder(name: string): boolean {
  return /\+\s*1\b/.test(name) || /\bplus[ -]?one\b/i.test(name);
}

function fromMember(m: HouseholdMember): MemberDraft {
  return {
    id: m.id,
    full_name: m.full_name,
    is_plus_one: looksLikePlusOnePlaceholder(m.full_name),
    rsvp_status: m.rsvp_status,
    meal_choice: m.meal_choice,
    dietary: m.dietary ?? "",
    accommodation_needed: m.accommodation_needed,
    song_request: m.song_request ?? "",
  };
}

function toSubmit(d: MemberDraft): CheckinMemberSubmit {
  // Always send the full payload — the server decides what to keep. This
  // way a user who toggles "yes → maybe → yes" doesn't lose meal/dietary
  // selections mid-edit. Nullification (when truly declining) is handled
  // server-side or via the explicit confirm dialog.
  // NOTE: we deliberately keep `full_name` out of CheckinMemberSubmit's
  // typed shape today — the public RSVP endpoint can't rename members
  // (see backend/src/domain/households.ts:applyMemberCheckin). Adding the
  // rename hook is a backend follow-up; the input lives on the frontend
  // already so the wiring is half-done.
  return {
    guest_id: d.id,
    rsvp_status: d.rsvp_status,
    meal_choice: d.meal_choice,
    dietary: d.dietary.trim() ? d.dietary.trim() : null,
    accommodation_needed: d.accommodation_needed,
    song_request: d.song_request.trim() ? d.song_request.trim() : null,
  };
}

/** True when a member has filled in any "going" field — used to decide
 *  whether toggling away from "yes" needs a confirm dialog. */
function hasYesData(d: MemberDraft): boolean {
  return Boolean(
    d.meal_choice || d.dietary.trim() || d.accommodation_needed || d.song_request.trim(),
  );
}

export function HouseholdRsvpForm({
  view,
  onUpdated,
  onBack,
  onNextGuest,
}: {
  view: PublicCheckinView;
  onUpdated: (next: PublicCheckinView) => void;
  /** Optional — surfaces the "use a different code" affordance on the lookup
   *  flow so users mistyped codes can step back without reloading. */
  onBack?: () => void;
  /** Optional — day-of greeter affordance: clears the form and refocuses the
   *  slug input so the same kiosk can check in the next guest. */
  onNextGuest?: () => void;
}) {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState<MemberDraft[]>(() => view.members.map(fromMember));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // After a successful submit the toast shows for 3s — when there's a
  // greeter ("onNextGuest" provided) we then auto-clear by handing off to
  // the parent so it can refocus the slug input.
  const autoNextRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (autoNextRef.current) clearTimeout(autoNextRef.current);
    };
  }, []);

  function updateMember(id: number, patch: Partial<MemberDraft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function pickStatus(d: MemberDraft, next: RsvpStatus) {
    if (next === d.rsvp_status) return;
    // Confirm before discarding "going" toggles when the user moves away
    // from "yes" — we don't actually clear (toSubmit keeps everything), but
    // we want the user to be aware the answer is changing.
    if (d.rsvp_status === "yes" && next === "no" && hasYesData(d)) {
      const ok = await confirm({
        title: t("rsvp.decline_keep_data_title"),
        body: t("rsvp.decline_keep_data_body"),
        confirmLabel: t("rsvp.decline_keep_data_confirm"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    updateMember(d.id, { rsvp_status: next });
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
      // Greeter mode: after the toast fades, hand off to the parent so it
      // can clear the lookup form and refocus the slug input for the next
      // arriving guest. Without `onNextGuest` we just hide the toast.
      if (autoNextRef.current) clearTimeout(autoNextRef.current);
      autoNextRef.current = setTimeout(() => {
        setDone(false);
        if (onNextGuest) onNextGuest();
      }, 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  // Pre-submit summary so guests don't accidentally fire off a partial RSVP
  // ("3 ready · 1 still pending"). Skipped entirely when everyone has picked.
  const readyCount = drafts.filter((d) => d.rsvp_status !== "pending").length;
  const pendingCount = drafts.length - readyCount;

  return (
    <form className="card stationery animate-fade-in-up" onSubmit={onSubmit}>
      <p className="text-xs uppercase tracking-widest text-ink-500">{view.couple_display_name}</p>
      {view.wedding_date && (
        <p className="text-sm text-ink-600">{formatDate(view.wedding_date, locale)}</p>
      )}

      {/* Boarding-pass anchor: monospace REF · slug · code so the credential
          on the page matches what was on the invite the guest just typed. */}
      <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-paper-300 bg-paper-50 px-2.5 py-1 font-mono text-xs uppercase tracking-[0.25em] text-ink-700">
        <span className="text-ink-500">{t("rsvp.checkin_ref_label")}</span>
        <span aria-hidden>·</span>
        <span>{view.couple_slug}</span>
        <span aria-hidden>·</span>
        <span className="tracking-[0.4em] text-ink-900">{view.household_code}</span>
      </div>

      <h1 className="mt-4 font-serif text-3xl">
        {t("rsvp.checkin_party_of", { n: drafts.length })}
      </h1>
      <p className="mt-1 text-sm text-ink-700">{view.household_label}</p>

      <div className="mt-6 space-y-6">
        {drafts.map((d) => (
          <fieldset
            key={d.id}
            className="rounded-2xl border border-paper-200 bg-paper-50/60 p-4 space-y-3"
          >
            <legend className="px-1 font-serif text-lg text-ink-900">{d.full_name}</legend>
            {d.is_plus_one && (
              // Placeholder "+1" name — surface a rename input. Public-RSVP
              // endpoint doesn't persist names today (see CheckinMemberSubmit),
              // so this is a forward-looking affordance: when the backend
              // gains a rename hook, this input + the `full_name` field on the
              // submit payload will start writing through.
              <div>
                <label className="field-label" htmlFor={`member-name-${d.id}`}>
                  {t("guests.full_name")}
                </label>
                <input
                  id={`member-name-${d.id}`}
                  className="input"
                  value={d.full_name}
                  onChange={(e) => updateMember(d.id, { full_name: e.target.value })}
                  maxLength={120}
                />
              </div>
            )}

            <div
              role="radiogroup"
              aria-label={d.full_name}
              className="grid gap-2 sm:grid-cols-2 md:grid-cols-4"
            >
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={d.rsvp_status === s}
                  onClick={() => void pickStatus(d, s)}
                  className={
                    d.rsvp_status === s
                      ? s === "pending"
                        ? "rounded-xl border-2 border-dashed border-ink-700 bg-paper-50 px-3 py-2 text-sm font-medium text-ink-700"
                        : "rounded-xl border-2 border-ink-700 bg-ink-700 px-3 py-2 text-sm font-medium text-paper-100"
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

      {/* Pre-submit summary so guests notice when they've only answered for
          part of the party. Hidden once everyone has picked something. */}
      {drafts.length > 1 && (
        <p className="mt-6 text-center text-xs text-ink-600">
          <span className="font-medium text-ink-900">
            {t("rsvp.checkin_summary_ready", { n: readyCount })}
          </span>
          {pendingCount > 0 && (
            <>
              <span aria-hidden className="mx-2 text-ink-400">
                ·
              </span>
              <span className="text-blush-700">
                {pendingCount === 1
                  ? t("rsvp.checkin_summary_pending_one")
                  : t("rsvp.checkin_summary_pending_n", { n: pendingCount })}
              </span>
            </>
          )}
        </p>
      )}

      {error && (
        <p className="field-error mt-4" role="alert" aria-live="polite">
          {error}
        </p>
      )}
      <button type="submit" className="btn-accent btn-lg mt-4 w-full" disabled={submitting}>
        {submitting ? t("common.loading") : t("rsvp.checkin_complete")}
      </button>
      {done && (
        <p className="mt-2 text-center text-sm text-ink-700">
          <strong>{t("rsvp.checkin_done_title")}</strong> — {t("rsvp.thanks_body")}
        </p>
      )}

      {onNextGuest && (
        <button
          type="button"
          className="btn-primary btn-lg mt-3 w-full"
          onClick={() => {
            if (autoNextRef.current) clearTimeout(autoNextRef.current);
            setDone(false);
            onNextGuest();
          }}
        >
          {t("rsvp.checkin_next_guest")}
        </button>
      )}

      {onBack && (
        <button type="button" className="btn-ghost btn-sm mt-3 w-full" onClick={onBack}>
          {t("rsvp.checkin_back_to_lookup")}
        </button>
      )}
    </form>
  );
}
