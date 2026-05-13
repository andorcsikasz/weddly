// Per-household RSVP editor. Renders one row per member with status pills
// + a chip set (vega / lactose / gluten / nut / +1 / baby) and an inline
// name input for any "+1" or "baby" the guest is bringing. A single Submit
// fires once the guest accepts the double-confirm dialog. Shared by both
// the /rsvp check-in page and the legacy /rsvp/:code resolver.

import type {
  CheckinAddedMember,
  CheckinMemberSubmit,
  HouseholdMember,
  MealChoice,
  PublicCheckinView,
  RsvpStatus,
} from "@shared/types";
import { Baby, Ban, Beef, Cookie, Fish, Leaf, Milk, Nut, Plus, Sprout, Wheat } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useConfirm, useToast } from "./ui";
import { ApiError, isOnline } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";
import { drain, enqueue, makeKey, peekAll } from "../lib/rsvp_offline";

const MEALS: MealChoice[] = ["meat", "fish", "vegetarian", "vegan", "child", "none"];

/** Icon per meal choice — used by the icon-button selector that replaced
 *  the old dropdown so guests pick by glance instead of reading a list. */
const MEAL_ICONS: Record<MealChoice, typeof Beef> = {
  meat: Beef,
  fish: Fish,
  vegetarian: Leaf,
  vegan: Sprout,
  child: Cookie,
  none: Ban,
};
// "pending" is intentionally excluded — submission requires a definite answer.
// (The default state is still "pending" for un-engaged members; submit
// validation forces them to commit before the server is called.)
const STATUSES: RsvpStatus[] = ["yes", "no", "maybe"];

type DietaryTag = "lactose" | "gluten" | "nut";

const DIETARY_TAG_KEYS: DietaryTag[] = ["lactose", "gluten", "nut"];

// Tokens we encode into the free-text `dietary` field so the chip state
// round-trips through the server. Round-tripping keeps the chip on after
// the form re-renders post-submit.
const DIETARY_TOKEN: Record<DietaryTag, string> = {
  lactose: "laktóz-érzékeny",
  gluten: "gluténmentes",
  nut: "mogyoró-allergia",
};

// Permissive matchers — the server may store any past spelling, so the
// chip flips on if either HU or EN form is recognised. `[^,;\s]*` after
// the keyword devours the whole compound word (accented chars aren't in
// `\w`, so `[\w-]*\b` used to stop at `laktóz` and leave `-érzékeny` as
// residue — that bled back into `dietary_free` on round-trip and
// corrupted the stored string).
const DIETARY_MATCHERS: Record<DietaryTag, RegExp> = {
  lactose: /(?:laktóz|lactose)[^,;\s]*/i,
  gluten: /(?:glutén|gluten)[^,;\s]*/i,
  nut: /(?:mogyoró|peanut|nut[- ]?aller)[^,;\s]*/i,
};

function parseDietary(s: string | null): { tags: Set<DietaryTag>; free: string } {
  const tags = new Set<DietaryTag>();
  let rest = s ?? "";
  for (const tag of DIETARY_TAG_KEYS) {
    if (DIETARY_MATCHERS[tag].test(rest)) {
      tags.add(tag);
      rest = rest.replace(DIETARY_MATCHERS[tag], "");
    }
  }
  rest = rest
    .replace(/\s*[,;]\s*[,;]+/g, ", ")
    .replace(/^[\s,;]+|[\s,;]+$/g, "")
    .trim();
  return { tags, free: rest };
}

function buildDietary(tags: Set<DietaryTag>, free: string): string | null {
  const parts: string[] = [];
  for (const tag of DIETARY_TAG_KEYS) {
    if (tags.has(tag)) parts.push(DIETARY_TOKEN[tag]);
  }
  const f = free.trim();
  if (f) parts.push(f);
  const joined = parts.join(", ");
  return joined || null;
}

interface AttachedDraft {
  /** Locally-generated string id so list keys stay stable across edits. */
  ui_key: string;
  full_name: string;
  /** Meal selection — present for plus-ones (adults who eat). Babies skip
   *  this (no wedding-menu meal), so the field is unused for them. */
  meal_choice: MealChoice | null;
  /** Same allergen tags the host can mark on themselves. */
  dietary_tags: Set<DietaryTag>;
}

interface MemberDraft {
  id: number;
  full_name: string;
  /** Non-null only for members the form considers a "+1 placeholder" (auto-
   *  named, e.g. "Anna +1"). Editing is allowed so guests can rename them. */
  is_plus_one: boolean;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary_tags: Set<DietaryTag>;
  /** Free-text remainder of `dietary` after known tags are pulled out. */
  dietary_free: string;
  accommodation_needed: boolean;
  song_request: string;
  /** Per-member attached add-ons. Chip on ↔ entry exists. Name is required
   *  on submit when the chip is on. */
  plus_one: AttachedDraft | null;
  baby: AttachedDraft | null;
}

/** Heuristic — backend doesn't expose `is_plus_one`, but the convention
 *  established by the CSV import / household creation flow is to label
 *  unnamed plus-ones as "<host> +1" or "+1". This lets us at least flag
 *  obvious placeholders so guests can rename them inline. */
function looksLikePlusOnePlaceholder(name: string): boolean {
  return /\+\s*1\b/.test(name) || /\bplus[ -]?one\b/i.test(name);
}

function fromMember(m: HouseholdMember): MemberDraft {
  const { tags, free } = parseDietary(m.dietary);
  return {
    id: m.id,
    full_name: m.full_name,
    is_plus_one: looksLikePlusOnePlaceholder(m.full_name),
    rsvp_status: m.rsvp_status,
    meal_choice: m.meal_choice,
    dietary_tags: tags,
    dietary_free: free,
    accommodation_needed: m.accommodation_needed,
    song_request: m.song_request ?? "",
    plus_one: null,
    baby: null,
  };
}

function toSubmit(d: MemberDraft): CheckinMemberSubmit {
  // Always send the full payload — the server decides what to keep. This
  // way a user who toggles "yes → maybe → yes" doesn't lose meal/dietary
  // selections mid-edit.
  return {
    guest_id: d.id,
    rsvp_status: d.rsvp_status,
    meal_choice: d.meal_choice,
    dietary: buildDietary(d.dietary_tags, d.dietary_free),
    accommodation_needed: d.accommodation_needed,
    song_request: d.song_request.trim() ? d.song_request.trim() : null,
  };
}

/** True when a member has filled in any "going" field — used to decide
 *  whether toggling away from "yes" needs a confirm dialog. */
function hasYesData(d: MemberDraft): boolean {
  return Boolean(
    d.meal_choice ||
      d.dietary_tags.size > 0 ||
      d.dietary_free.trim() ||
      d.accommodation_needed ||
      d.song_request.trim() ||
      d.plus_one ||
      d.baby,
  );
}

function makeUiKey(): string {
  // Random local id is fine — list keys, never persisted.
  return `attach_${Math.random().toString(36).slice(2, 9)}`;
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
  const toast = useToast();
  const [drafts, setDrafts] = useState<MemberDraft[]>(() => view.members.map(fromMember));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** Live count of records sitting in localStorage waiting to flush. Refreshed
   *  on mount, after enqueue, after drain, and on cross-tab `storage` events.
   *  Disambiguated from the per-member "still pending" `pendingCount` derived
   *  below — same word, totally different concept (offline queue vs RSVP). */
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(() => peekAll().length);

  // After a successful submit the toast shows for 3s — when there's a
  // greeter ("onNextGuest" provided) we then auto-clear by handing off to
  // the parent so it can refocus the slug input.
  const autoNextRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (autoNextRef.current) clearTimeout(autoNextRef.current);
    };
  }, []);

  const refreshPending = useCallback(() => {
    setOfflineQueueCount(peekAll().length);
  }, []);

  /** Attempt to push every queued record. Called on mount (catch up from a
   *  previous tab), on the browser `online` event, and after every successful
   *  submit. We toast on success but stay silent on the no-op case (queue
   *  empty / still offline). */
  const tryDrain = useCallback(async () => {
    if (peekAll().length === 0) return;
    if (!isOnline()) return;
    try {
      const r = await drain();
      refreshPending();
      if (r.sent > 0) {
        toast.success(t("rsvp.offline_drained", { n: r.sent }));
      }
      if (r.lastView && r.lastView.household_code === view.household_code) {
        // Server view may have changed (e.g. concurrent edit by greeter on
        // another device). Surface the latest snapshot so the form mirrors
        // reality if the user is still on this household.
        onUpdated(r.lastView);
      }
    } catch {
      // drain() swallows ApiErrors internally — anything bubbling here is
      // truly unexpected. Skip the toast; we'll try again on the next online.
    }
  }, [refreshPending, toast, t, view.household_code, onUpdated]);

  // Drain on mount and listen for the network coming back. The "storage"
  // listener catches the case where a sibling tab drained the queue — we want
  // to reflect that here too.
  useEffect(() => {
    void tryDrain();
    const onOnline = () => {
      void tryDrain();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "weddly.rsvp.pending") refreshPending();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("storage", onStorage);
    };
  }, [tryDrain, refreshPending]);

  function updateMember(id: number, patch: Partial<MemberDraft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function toggleDietaryTag(id: number, tag: DietaryTag) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const next = new Set(d.dietary_tags);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return { ...d, dietary_tags: next };
      }),
    );
  }

  function freshAttached(): AttachedDraft {
    return {
      ui_key: makeUiKey(),
      full_name: "",
      meal_choice: null,
      dietary_tags: new Set(),
    };
  }

  function togglePlusOne(d: MemberDraft) {
    if (d.plus_one) {
      updateMember(d.id, { plus_one: null });
    } else {
      updateMember(d.id, { plus_one: freshAttached() });
    }
  }

  function toggleBaby(d: MemberDraft) {
    if (d.baby) {
      updateMember(d.id, { baby: null });
    } else {
      updateMember(d.id, { baby: freshAttached() });
    }
  }

  function updateAttached(id: number, kind: "plus_one" | "baby", full_name: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const cur = d[kind];
        if (!cur) return d;
        return { ...d, [kind]: { ...cur, full_name } };
      }),
    );
  }

  /** Patch the +1's (or baby's) meal/dietary state in place. */
  function patchAttached(
    id: number,
    kind: "plus_one" | "baby",
    patch: Partial<Pick<AttachedDraft, "meal_choice" | "dietary_tags">>,
  ) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const cur = d[kind];
        if (!cur) return d;
        return { ...d, [kind]: { ...cur, ...patch } };
      }),
    );
  }

  function toggleAttachedDietaryTag(id: number, kind: "plus_one" | "baby", tag: DietaryTag) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const cur = d[kind];
        if (!cur) return d;
        const next = new Set(cur.dietary_tags);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return { ...d, [kind]: { ...cur, dietary_tags: next } };
      }),
    );
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

  function collectAddedMembers(list: MemberDraft[]): CheckinAddedMember[] {
    const out: CheckinAddedMember[] = [];
    for (const d of list) {
      if (d.rsvp_status !== "yes") continue;
      if (d.plus_one) {
        out.push({
          full_name: d.plus_one.full_name.trim(),
          kind: "adult",
          rsvp_status: "yes",
          meal_choice: d.plus_one.meal_choice,
          // Reuse the same tag→string encoding the main member rows use so
          // the dietary string round-trips through to the admin icons.
          dietary: buildDietary(d.plus_one.dietary_tags, ""),
        });
      }
      if (d.baby) {
        out.push({
          full_name: d.baby.full_name.trim(),
          kind: "baby",
          rsvp_status: "yes",
          // Babies don't pick a wedding meal but can still have allergies
          // (e.g. lactose) — pass through if the host marked any.
          meal_choice: null,
          dietary: buildDietary(d.baby.dietary_tags, ""),
        });
      }
    }
    return out;
  }

  /** Pre-flight validation. Returns null on success, or an error message. */
  function validate(list: MemberDraft[]): string | null {
    const anyPending = list.some((d) => d.rsvp_status === "pending");
    if (anyPending) return t("rsvp.error_status_required");
    for (const d of list) {
      if (d.rsvp_status !== "yes") continue;
      if (d.plus_one && !d.plus_one.full_name.trim()) {
        return t("rsvp.error_added_name_required");
      }
      if (d.baby && !d.baby.full_name.trim()) {
        return t("rsvp.error_added_name_required");
      }
    }
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const validationError = validate(drafts);
    if (validationError) {
      setError(validationError);
      return;
    }
    // Double-confirm — the user explicitly asked for a "dupla leokézás"
    // before submission lands so accidental taps don't fire off the RSVP.
    const ok = await confirm({
      title: t("rsvp.confirm_submit_title"),
      body: t("rsvp.confirm_submit_body"),
      confirmLabel: t("rsvp.confirm_submit_yes"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    const added = collectAddedMembers(drafts);
    const payload = {
      couple_slug: view.couple_slug,
      household_code: view.household_code,
      members: drafts.map(toSubmit),
      added_members: added.length > 0 ? added : undefined,
    };
    // Stamp the idempotency key BEFORE the first attempt so any retry from
    // the offline queue dedupes against the original write. The server
    // caches the 200 for 5 minutes keyed on (household_code, idempotency_key).
    const idempotencyKey = makeKey();

    function finishSuccessUi() {
      setDone(true);
      if (autoNextRef.current) clearTimeout(autoNextRef.current);
      autoNextRef.current = setTimeout(() => {
        setDone(false);
        if (onNextGuest) onNextGuest();
      }, 3000);
    }

    // Fast path: if the browser is already telling us we're offline, skip
    // the doomed fetch — go straight to the queue. Saves a 20s timeout and
    // a confused user.
    if (!isOnline()) {
      enqueue(view.couple_slug, view.household_code, payload, idempotencyKey);
      refreshPending();
      toast.success(t("rsvp.offline_saved"));
      finishSuccessUi();
      setSubmitting(false);
      return;
    }

    try {
      const r = await rsvpApi.checkin(payload, { idempotencyKey });
      onUpdated(r.rsvp);
      finishSuccessUi();
      // Opportunistic flush: this submit proved we're online, so drain any
      // stale records the queue accumulated while we were offline.
      void tryDrain();
    } catch (err) {
      // Transport failures (offline mid-submit, slow venue WiFi timing out)
      // get queued. The user sees a "saved offline" toast, the form clears,
      // and the next greeter can step up while the device drains in the
      // background.
      const queueable =
        err instanceof ApiError &&
        (err.code === "network_error" || err.code === "timeout" || err.code === "aborted");
      if (queueable) {
        enqueue(view.couple_slug, view.household_code, payload, idempotencyKey);
        refreshPending();
        toast.success(t("rsvp.offline_saved"));
        finishSuccessUi();
      } else {
        setError(err instanceof ApiError ? err.message : t("common.error_generic"));
      }
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
      <p className="text-xs uppercase tracking-widest text-ink-500 dark:text-umber-300">
        {view.couple_display_name}
      </p>
      {view.wedding_date && (
        <p className="text-sm text-ink-600 dark:text-umber-200">
          {formatDate(view.wedding_date, locale)}
        </p>
      )}

      {/* Boarding-pass anchor: monospace REF · slug · code so the credential
          on the page matches what was on the invite the guest just typed.
          flex-wrap keeps the pill from overflowing on narrow phones. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 self-start rounded-lg border border-paper-300 bg-paper-50 px-2.5 py-1 font-mono text-xs uppercase tracking-[0.25em] text-ink-700 max-w-full overflow-hidden dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100">
        <span className="text-ink-500 dark:text-umber-300">{t("rsvp.checkin_ref_label")}</span>
        <span aria-hidden>·</span>
        <span className="break-all">{view.couple_slug}</span>
        <span aria-hidden>·</span>
        <span className="tracking-[0.4em] text-ink-900 dark:text-paper-50">
          {view.household_code}
        </span>
      </div>

      <h1 className="mt-4 font-serif text-2xl sm:text-3xl">
        {t("rsvp.checkin_party_of", { n: drafts.length })}
      </h1>
      <p className="mt-1 break-words text-sm text-ink-700 dark:text-paper-100">
        {view.household_label}
      </p>

      {/* Offline queue badge — surfaces when at least one record is sitting in
          localStorage waiting to flush. Small calm chip, not a banner; the
          guest already got a success toast at submit time. */}
      {offlineQueueCount > 0 && (
        <p
          className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full border border-paper-300 bg-paper-50 px-2.5 py-1 text-xs text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
          role="status"
          aria-live="polite"
        >
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full bg-blush-500 dark:bg-blush-300"
          />
          {t("rsvp.offline_pending", { n: offlineQueueCount })}
        </p>
      )}

      <div className="mt-6 space-y-6">
        {drafts.map((d) => (
          <fieldset
            key={d.id}
            className="rounded-2xl border border-paper-200 bg-paper-50/60 p-4 space-y-3 dark:border-umber-700 dark:bg-umber-800/60"
          >
            <legend className="px-1 font-serif text-lg text-ink-900 break-words dark:text-paper-50">
              {d.full_name}
            </legend>
            {d.is_plus_one && (
              // Placeholder "+1" name — surface a rename input. Public-RSVP
              // endpoint doesn't persist names today (see CheckinMemberSubmit),
              // so this is a forward-looking affordance.
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
              aria-label={t("rsvp.status_for_name", { name: d.full_name })}
              className="grid gap-2 grid-cols-1 sm:grid-cols-3"
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
                      ? "rounded-xl border-2 border-ink-700 bg-ink-700 px-3 py-2 text-sm font-medium text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
                      : "rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
                  }
                >
                  {t(`rsvp.pick_${s}`)}
                </button>
              ))}
            </div>

            {d.rsvp_status === "yes" && (
              <div className="space-y-3">
                {/* Meal choice — radio-like icon row. Mutually exclusive;
                    clicking the active one clears it. Replaces the old
                    dropdown so guests pick by glance. */}
                <div
                  role="radiogroup"
                  aria-label={t("rsvp.meal")}
                  className="grid grid-cols-3 gap-1.5 sm:grid-cols-6"
                >
                  {MEALS.map((m) => {
                    const Icon = MEAL_ICONS[m];
                    const active = d.meal_choice === m;
                    const label = t(`guests.meal_${m}`);
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={label}
                        title={label}
                        onClick={() => updateMember(d.id, { meal_choice: active ? null : m })}
                        className={
                          active
                            ? "flex aspect-square items-center justify-center rounded-xl border-2 border-ink-700 bg-ink-700 text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
                            : "flex aspect-square items-center justify-center rounded-xl border border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
                        }
                      >
                        <Icon size={22} aria-hidden />
                      </button>
                    );
                  })}
                </div>

                {/* Allergen chips — multi-select. Icon-only modifiers on
                    top of the meal choice; replace the old free-text
                    "Egyéb / allergia" input. */}
                <div className="flex flex-wrap gap-1.5">
                  <Chip
                    on={d.dietary_tags.has("lactose")}
                    onClick={() => toggleDietaryTag(d.id, "lactose")}
                    icon={<Milk size={14} aria-hidden />}
                    label={t("rsvp.tag_lactose")}
                  />
                  <Chip
                    on={d.dietary_tags.has("gluten")}
                    onClick={() => toggleDietaryTag(d.id, "gluten")}
                    icon={<Wheat size={14} aria-hidden />}
                    label={t("rsvp.tag_gluten")}
                  />
                  <Chip
                    on={d.dietary_tags.has("nut")}
                    onClick={() => toggleDietaryTag(d.id, "nut")}
                    icon={<Nut size={14} aria-hidden />}
                    label={t("rsvp.tag_nut")}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
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

                {/* Family additions — visually separated from the allergen
                    block above so guests don't conflate "bringing a +1"
                    with a dietary attribute. */}
                <div className="mt-6 border-t border-paper-200 pt-4 dark:border-umber-700">
                  <p className="mb-2 text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {t("rsvp.additions_section_title")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip
                      on={d.plus_one !== null}
                      onClick={() => togglePlusOne(d)}
                      icon={<Plus size={14} aria-hidden />}
                      label={t("rsvp.tag_plus_one")}
                      controlsId={`plus-one-${d.id}`}
                      expanded={d.plus_one !== null}
                    />
                    <Chip
                      on={d.baby !== null}
                      onClick={() => toggleBaby(d)}
                      icon={<Baby size={14} aria-hidden />}
                      label={t("rsvp.tag_baby")}
                      controlsId={`baby-${d.id}`}
                      expanded={d.baby !== null}
                    />
                  </div>
                  {d.plus_one && (
                    <div className="mt-3 space-y-3">
                      <AttachedNameField
                        id={`plus-one-${d.id}`}
                        label={t("rsvp.added_name_plus_one")}
                        placeholder={t("rsvp.added_name_placeholder")}
                        value={d.plus_one.full_name}
                        onChange={(v) => updateAttached(d.id, "plus_one", v)}
                      />
                      <AttachedDietary
                        member={d.plus_one}
                        onMealChange={(meal) =>
                          patchAttached(d.id, "plus_one", { meal_choice: meal })
                        }
                        onToggleTag={(tag) => toggleAttachedDietaryTag(d.id, "plus_one", tag)}
                      />
                    </div>
                  )}
                  {d.baby && (
                    <div className="mt-3">
                      <AttachedNameField
                        id={`baby-${d.id}`}
                        label={t("rsvp.added_name_baby")}
                        placeholder={t("rsvp.added_name_placeholder")}
                        value={d.baby.full_name}
                        onChange={(v) => updateAttached(d.id, "baby", v)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </fieldset>
        ))}
      </div>

      {/* Pre-submit summary so guests notice when they've only answered for
          part of the party. Hidden once everyone has picked something. */}
      {drafts.length > 1 && (
        <p className="mt-6 text-center text-xs text-ink-600 dark:text-umber-200">
          <span className="font-medium text-ink-900 dark:text-paper-50">
            {t("rsvp.checkin_summary_ready", { n: readyCount })}
          </span>
          {pendingCount > 0 && (
            <>
              <span aria-hidden className="mx-2 text-ink-400 dark:text-umber-300">
                ·
              </span>
              <span className="text-blush-700 dark:text-blush-300">
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
        <p className="mt-2 text-center text-sm text-ink-700 dark:text-paper-100">
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

function Chip({
  on,
  onClick,
  icon,
  label,
  controlsId,
  expanded,
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  /** Optional — when the chip toggles a disclosure (e.g. "+1" reveals a name
   *  input below), pass the disclosure's id + current expanded state so screen
   *  readers can announce the relationship. */
  controlsId?: string;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-controls={controlsId}
      aria-expanded={controlsId !== undefined ? expanded === true : undefined}
      onClick={onClick}
      className={
        on
          ? "inline-flex items-center gap-1.5 rounded-full border-2 border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100 transition-colors dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
          : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700 transition-colors hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function AttachedNameField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  /** Disclosure id — used as the wrapper's `id` so a chip elsewhere can
   *  point its `aria-controls` at this whole region. The inner <input> gets
   *  a derived id so the <label htmlFor> still resolves. */
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputId = `${id}-input`;
  return (
    <div id={id}>
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        maxLength={120}
        aria-required="true"
      />
    </div>
  );
}

/**
 * Meal + allergen picker for an attached guest (the +1). Same icon-only
 * meal row + 3 allergen chips as the host's own controls, just plumbed
 * into the attached draft. Babies skip the meal row (they don't eat from
 * the wedding menu) — only allergens are exposed for them.
 */
function AttachedDietary({
  member,
  onMealChange,
  onToggleTag,
  showMeal = true,
}: {
  member: AttachedDraft;
  onMealChange: (m: MealChoice | null) => void;
  onToggleTag: (tag: DietaryTag) => void;
  showMeal?: boolean;
}) {
  const { t } = useT();
  return (
    <div className="space-y-3">
      {showMeal && (
        <div
          role="radiogroup"
          aria-label={t("rsvp.meal")}
          className="grid grid-cols-3 gap-1.5 sm:grid-cols-6"
        >
          {MEALS.map((m) => {
            const Icon = MEAL_ICONS[m];
            const active = member.meal_choice === m;
            const label = t(`guests.meal_${m}`);
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={label}
                title={label}
                onClick={() => onMealChange(active ? null : m)}
                className={
                  active
                    ? "flex aspect-square items-center justify-center rounded-xl border-2 border-ink-700 bg-ink-700 text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
                    : "flex aspect-square items-center justify-center rounded-xl border border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
                }
              >
                <Icon size={22} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Chip
          on={member.dietary_tags.has("lactose")}
          onClick={() => onToggleTag("lactose")}
          icon={<Milk size={14} aria-hidden />}
          label={t("rsvp.tag_lactose")}
        />
        <Chip
          on={member.dietary_tags.has("gluten")}
          onClick={() => onToggleTag("gluten")}
          icon={<Wheat size={14} aria-hidden />}
          label={t("rsvp.tag_gluten")}
        />
        <Chip
          on={member.dietary_tags.has("nut")}
          onClick={() => onToggleTag("nut")}
          icon={<Nut size={14} aria-hidden />}
          label={t("rsvp.tag_nut")}
        />
      </div>
    </div>
  );
}
