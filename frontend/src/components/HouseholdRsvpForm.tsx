// Per-household RSVP editor. Renders one row per member with status pills
// + a chip set (vega / lactose / gluten / nut / +1 / baby) and an inline
// name input for any "+1" or "baby" the guest is bringing. A single Submit
// fires once the guest accepts the double-confirm dialog. Shared by both
// the /rsvp check-in page and the legacy /rsvp/:code resolver.

import { isCustomMealKey, MEAL_ORDER } from "@shared/meals";
import type {
  CheckinAddedMember,
  CheckinMemberSubmit,
  HouseholdMember,
  MealChoice,
  MealSlotKey,
  MealMenu,
  PublicCheckinView,
  RsvpStatus,
} from "@shared/types";
import {
  Atom,
  Baby,
  Ban,
  Beef,
  CircleCheckBig,
  Cookie,
  Egg,
  Fish,
  Globe,
  Leaf,
  Milk,
  Nut,
  Plus,
  Shell,
  Sprout,
  UtensilsCrossed,
  Wheat,
} from "lucide-react";
import { DIETARY_FREE_MAX, GUEST_MESSAGE_MAX } from "@shared/rsvp";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirm, useToast } from "./ui";
import { ApiError, isOnline } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { formatDate, formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";
import { drain, enqueue, makeKey, peekAll } from "../lib/rsvp_offline";

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

/** A couple's own option has no fixed meaning, so it gets the neutral cutlery
 *  glyph rather than one of the six that would imply one. The label carries
 *  the meaning, and it is always present on a custom slot. */
function mealIcon(choice: MealSlotKey): typeof Beef {
  return isCustomMealKey(choice) ? UtensilsCrossed : MEAL_ICONS[choice];
}

interface MealOption {
  choice: MealSlotKey;
  /** Resolved label: the couple's custom override, or the localised default. */
  label: string;
}

/** The meal slots to offer this member: the couple's enabled slots (with their
 *  custom labels), plus the member's currently-selected slot even if the couple
 *  has since hidden it — so an existing answer never silently disappears.
 *  Falls back to all six defaults when the couple hasn't customised anything. */
function resolveMealOptions(
  menu: MealMenu | undefined,
  t: (key: string) => string,
  current: MealSlotKey | null,
): MealOption[] {
  const items =
    menu && menu.length > 0
      ? menu
      : MEAL_ORDER.map((c) => ({ choice: c, label: null, enabled: true }));
  const out: MealOption[] = [];
  for (const it of items) {
    if (!it.enabled && it.choice !== current) continue;
    const fallback = isCustomMealKey(it.choice) ? "" : t(`guests.meal_${it.choice}`);
    const label = it.label?.trim() || fallback;
    // A custom slot with no label is not an option a guest could understand;
    // the shared parser drops those, and this is the belt to its braces.
    if (!label) continue;
    out.push({ choice: it.choice, label });
  }
  return out;
}
// "pending" is intentionally excluded — submission requires a definite answer.
// (The default state is still "pending" for un-engaged members; submit
// validation forces them to commit before the server is called.)
const STATUSES = ["yes", "no", "maybe"] as const satisfies readonly RsvpStatus[];

// Colour only carries the *selected* choice. Idle pills are neutral paper so
// the surface stays calm; the strong dark fill on the chosen pill is what does
// the talking. Saturated emerald/rose ACTIVE for sighted guests; the bold
// fill + paper text combo also meets contrast for colour-deficient users.
const STATUS_TONE_ACTIVE: Record<(typeof STATUSES)[number], string> = {
  yes: "border-2 border-emerald-800 bg-emerald-800 text-white dark:border-emerald-500 dark:bg-emerald-600 dark:text-paper-50",
  no: "border-2 border-rose-800 bg-rose-800 text-white dark:border-rose-500 dark:bg-rose-600 dark:text-paper-50",
  maybe:
    "border-2 border-ink-800 bg-ink-800 text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900",
};

// Idle pills carry a dark outline (matching the selected pill's border-2
// weight, so selecting one never nudges the row). The outline-only look
// reads as a clear, tappable choice on the calm paper surface.
const IDLE_NEUTRAL =
  "border-2 border-ink-900 bg-paper-50 text-ink-700 hover:border-ink-700 dark:border-paper-200 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-50";

const STATUS_TONE_IDLE: Record<(typeof STATUSES)[number], string> = {
  yes: IDLE_NEUTRAL,
  no: IDLE_NEUTRAL,
  maybe: IDLE_NEUTRAL,
};

type DietaryTag = "lactose" | "milk_protein" | "gluten" | "nut" | "egg" | "fish_shellfish";

/** Lactose gets the literal milk-glass icon — the most recognisable dairy
 *  signifier. Milk-protein layers an Atom on top to flag "the milk allergen
 *  that's about protein, not about lactose" without inventing a brand-new
 *  visual the average guest wouldn't decode. */
function DietaryTagIcon({ tag }: { tag: DietaryTag }) {
  switch (tag) {
    case "milk_protein":
      return (
        <span className="inline-flex shrink-0 items-center -gap-0.5">
          <Milk size={14} aria-hidden />
          <Atom size={10} aria-hidden className="-ml-1 self-start" />
        </span>
      );
    case "lactose":
      return <Milk size={14} aria-hidden />;
    case "gluten":
      return <Wheat size={14} aria-hidden />;
    case "nut":
      return <Nut size={14} aria-hidden />;
    case "egg":
      return <Egg size={14} aria-hidden />;
    case "fish_shellfish":
      return <Shell size={14} aria-hidden />;
  }
}

// Order matters for `buildDietary`: `milk_protein` must come BEFORE `lactose`
// so the milk-protein token (which contains "tej") isn't accidentally
// matched first by the lactose detector when the chip state is read back.
const DIETARY_TAG_KEYS: DietaryTag[] = [
  "milk_protein",
  "lactose",
  "gluten",
  "nut",
  "egg",
  "fish_shellfish",
];

// Tokens we encode into the free-text `dietary` field so the chip state
// round-trips through the server. Round-tripping keeps the chip on after
// the form re-renders post-submit.
const DIETARY_TOKEN: Record<DietaryTag, string> = {
  lactose: "laktóz-érzékeny",
  milk_protein: "tejfehérje-allergia",
  gluten: "gluténmentes",
  nut: "mogyoró-allergia",
  egg: "tojás-allergia",
  fish_shellfish: "hal-tengeri-allergia",
};

// Permissive matchers — the server may store any past spelling, so the
// chip flips on if either HU or EN form is recognised. `[^,;\s]*` after
// the keyword devours the whole compound word (accented chars aren't in
// `\w`, so `[\w-]*\b` used to stop at `laktóz` and leave `-érzékeny` as
// residue — that bled back into `dietary_free` on round-trip and
// corrupted the stored string). Run order is `DIETARY_TAG_KEYS` (above):
// milk_protein BEFORE lactose so the "tejfehérje" token isn't mistakenly
// shortened to "tej" + bare lactose.
const DIETARY_MATCHERS: Record<DietaryTag, RegExp> = {
  lactose: /(?:laktóz|lactose)[^,;\s]*/i,
  milk_protein: /(?:tejfehérje|tejfeherje|milk[- ]?protein|casein|kazein)[^,;\s]*/i,
  gluten: /(?:glutén|gluten)[^,;\s]*/i,
  nut: /(?:mogyoró|peanut|nut[- ]?aller)[^,;\s]*/i,
  egg: /(?:tojás|tojas|egg[- ]?aller|egg)[^,;\s]*/i,
  fish_shellfish:
    /(?:hal-tengeri|hal[- ]?aller|tengeri[- ]?herkenty|shellfish|seafood|crustacean)[^,;\s]*/i,
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
  meal_choice: MealSlotKey | null;
  /** Same allergen tags the host can mark on themselves. */
  dietary_tags: Set<DietaryTag>;
}

interface MemberDraft {
  id: number;
  full_name: string;
  /** True when this member is themselves a +1 — either a real materialised
   *  plus-one the server flagged, or an auto-named "+1 placeholder" (e.g.
   *  "Anna +1"). Drives the inline rename input and, crucially, suppresses
   *  the "Family additions" block so a +1 can't carry its own +1. */
  is_plus_one: boolean;
  /** True when another member in this household is already this member's
   *  assigned +1 (the couple paired them explicitly). Suppresses the "+1?"
   *  question so the host isn't asked to bring a +1 they already have. */
  hosts_plus_one: boolean;
  /** Has the guest actively clicked a status pill in THIS session? On first
   *  render this is false even when the server already has a status — the
   *  pills render neutral and the meal/dietary block stays hidden until the
   *  guest re-confirms. Forces an active acknowledgement on every visit so
   *  returning users can't accidentally re-submit a stale answer. */
  interacted: boolean;
  rsvp_status: RsvpStatus;
  meal_choice: MealSlotKey | null;
  dietary_tags: Set<DietaryTag>;
  /** Free-text remainder of `dietary` after known tags are pulled out. */
  dietary_free: string;
  accommodation_needed: boolean;
  /** Which published lodging this member picked. Null means none, which on a
   *  form that lists options is an answer rather than a blank. Only ever
   *  non-null when the couple published something to choose between. */
  accommodation_id: number | null;
  song_request: string;
  /** Per-member attached add-ons. Chip on ↔ entry exists. Name is required
   *  on submit when the chip is on. */
  plus_one: AttachedDraft | null;
  baby: AttachedDraft | null;
}

/** Fallback heuristic for legacy rows the server hasn't flagged with
 *  `is_plus_one` — the CSV import / household creation flow labels unnamed
 *  plus-ones as "<host> +1" or "+1". Catches those so guests can rename them
 *  inline; real materialised +1s come through `HouseholdMember.is_plus_one`. */
function looksLikePlusOnePlaceholder(name: string): boolean {
  return /\+\s*1\b/.test(name) || /\bplus[ -]?one\b/i.test(name);
}

function fromMember(m: HouseholdMember, hostsPlusOne = false): MemberDraft {
  const { tags, free } = parseDietary(m.dietary);
  return {
    id: m.id,
    full_name: m.full_name,
    is_plus_one: m.is_plus_one || looksLikePlusOnePlaceholder(m.full_name),
    hosts_plus_one: hostsPlusOne,
    interacted: false,
    rsvp_status: m.rsvp_status,
    meal_choice: m.meal_choice,
    dietary_tags: tags,
    dietary_free: free,
    accommodation_needed: m.accommodation_needed,
    accommodation_id: m.accommodation_id,
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
    accommodation_id: d.accommodation_id,
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
      d.accommodation_id !== null ||
      d.song_request.trim() ||
      d.plus_one ||
      d.baby,
  );
}

function makeUiKey(): string {
  // Random local id is fine — list keys, never persisted.
  return `attach_${Math.random().toString(36).slice(2, 9)}`;
}

/** How long the post-RSVP confirmation lingers before it forwards a self-serve
 *  guest to the couple's published wedding site. Long enough to read the
 *  "checked in" line; the runner makes the wait legible and cancellable. */
const SITE_REDIRECT_SECONDS = 10;

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
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [drafts, setDrafts] = useState<MemberDraft[]>(() => {
    // Member ids that already carry an explicitly-assigned +1 — their "+1?"
    // question is suppressed (and the +1 itself never gets the question).
    const hostIds = new Set(
      view.members.map((m) => m.plus_one_of).filter((x): x is number => x != null),
    );
    return view.members.map((m) => fromMember(m, hostIds.has(m.id)));
  });
  /** One message per household, not per member: a family fills this form
   *  together and signs off once. Seeded from the server so reopening the form
   *  edits the existing message rather than facing an empty box. */
  const [guestMessage, setGuestMessage] = useState<string>(view.guest_message ?? "");
  /** Empty for every couple who never published a lodging, which is the
   *  default and keeps the old yes/no checkbox exactly as it was. */
  const lodgings = view.accommodation_options ?? [];
  const currency = view.currency ?? "HUF";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // After a self-serve guest submits, the filled-in RSVP collapses and (when the
  // couple's public site is live) a short countdown opens it — the guest's next
  // stop is the schedule/venue, not the form they just completed. `editingAfterDone`
  // re-opens the inputs if they tap "edit", which also cancels the countdown.
  // The day-of kiosk (onNextGuest) keeps its own reset flow and is left untouched.
  const [editingAfterDone, setEditingAfterDone] = useState(false);
  const [redirectSecondsLeft, setRedirectSecondsLeft] = useState<number | null>(null);
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
    // Allow re-confirming the same status on the FIRST click in this session
    // (interacted flips false → true). Subsequent same-status clicks are a
    // no-op so the user can't accidentally toggle.
    if (next === d.rsvp_status && d.interacted) return;
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
    updateMember(d.id, { rsvp_status: next, interacted: true });
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
          // Tie the new row to its host so the admin list nests it underneath
          // and the server can refuse a +1-of-a-+1.
          is_plus_one: true,
          parent_member_id: d.id,
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
    // `!interacted` is treated the same as `pending` — the guest has to
    // actively click a pill in this session before we'll submit, even when
    // the server already had a stored status for that member.
    const anyPending = list.some((d) => !d.interacted || d.rsvp_status === "pending");
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
      // Always sent, including as "" — the box is prefilled with whatever this
      // household wrote last time, so an emptied box is the guest deleting
      // their message and the server has to hear about it.
      guest_message: guestMessage.trim(),
    };
    // Stamp the idempotency key BEFORE the first attempt so any retry from
    // the offline queue dedupes against the original write. The server
    // caches the 200 for 5 minutes keyed on (household_code, idempotency_key).
    const idempotencyKey = makeKey();

    function finishSuccessUi() {
      setDone(true);
      // Re-submitting from the "edit" state should collapse + restart the
      // countdown, not stay expanded.
      setEditingAfterDone(false);
      if (autoNextRef.current) clearTimeout(autoNextRef.current);
      // Only auto-reset in welcome-desk mode (parent passed onNextGuest).
      // Solo guests need the success card to stick around so they can read
      // it, tap the "Open wedding page" CTA, and dismiss the form on their
      // own terms — a 3s vanish read as broken in the original UX.
      if (!onNextGuest) return;
      autoNextRef.current = setTimeout(() => {
        setDone(false);
        onNextGuest();
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
  // `interacted` is what counts as "ready" — even a server-side "yes" needs
  // an explicit click in this session before we treat the row as committed.
  const readyCount = drafts.filter((d) => d.interacted && d.rsvp_status !== "pending").length;
  const pendingCount = drafts.length - readyCount;

  // Self-serve = the guest is filling this in for themselves (no day-of greeter
  // handing off to the next guest). Only there do we collapse the inputs and run
  // the redirect; the kiosk path is untouched.
  const selfServe = !onNextGuest;
  const publicSiteUrl =
    view.couple_slug && view.wedding_site_published
      ? `/w/${encodeURIComponent(view.couple_slug)}`
      : null;
  const collapsedAfterDone = done && selfServe && !editingAfterDone;
  const runnerActive = collapsedAfterDone && publicSiteUrl !== null;

  // "Add to Calendar" helpers — only when the wedding date is known.
  const calendarLinks = (() => {
    if (!view.wedding_date) return null;
    const d = view.wedding_date.replace(/-/g, ""); // "20260625"
    const nextDay = String(Number(d) + 1); // naive +1 day (same month always fine)
    const title = encodeURIComponent(view.couple_display_name);
    const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${d}/${nextDay}`;
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Weddly//RSVP//EN",
      "BEGIN:VEVENT",
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${nextDay}`,
      `SUMMARY:${view.couple_display_name}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const icsHref = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    return { google, icsHref };
  })();

  // Countdown → forward to the published site. `/w/:slug` is an in-app route,
  // so we navigate client-side (no full reload, no popup the browser would
  // block). Cancelled by re-opening the inputs to edit, or by tapping the CTA.
  useEffect(() => {
    if (!runnerActive || !publicSiteUrl) {
      setRedirectSecondsLeft(null);
      return;
    }
    setRedirectSecondsLeft(SITE_REDIRECT_SECONDS);
    const tick = setInterval(() => {
      setRedirectSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : 0));
    }, 1000);
    const go = setTimeout(() => {
      navigate(publicSiteUrl);
    }, SITE_REDIRECT_SECONDS * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [runnerActive, publicSiteUrl, navigate]);

  return (
    <form className="card stationery animate-fade-in-up" onSubmit={onSubmit}>
      <p className="font-grotesk text-lg sm:text-xl leading-tight text-ink-900 break-words hyphens-auto dark:text-paper-50">
        {view.couple_display_name}
      </p>
      {view.wedding_date && (
        <p className="font-grotesk text-sm sm:text-base text-ink-600 dark:text-umber-200">
          {formatDate(view.wedding_date, locale)}
        </p>
      )}

      {/* Boarding-pass anchor: monospace REF · slug · code so the credential
          on the page matches what was on the invite the guest just typed.
          Single line (flex-nowrap): the slug truncates if space is tight so
          the RSVP code never drops to its own row on narrow phones — the code
          is the credential that matters, the slug is identical for everyone. */}
      <div className="mt-2.5 flex flex-nowrap items-center gap-2 self-start sm:mt-3">
        <span className="rounded-lg border border-paper-300 bg-paper-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-700 min-w-0 truncate dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 sm:text-xs sm:tracking-[0.25em]">
          {view.couple_slug}
        </span>
        <span className="rounded-lg border border-paper-300 bg-paper-50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.3em] text-ink-900 shrink-0 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 sm:text-xs sm:tracking-[0.4em]">
          {view.household_code}
        </span>
      </div>

      <h1 className="mt-3 font-grotesk text-2xl sm:mt-4 sm:text-3xl">
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

      {/* RSVP inputs — collapse once a self-serve guest has submitted. `contents`
          keeps the layout identical while visible; `hidden` folds it away after
          the answer is in, so the confirmation + wedding site take the stage. */}
      <div className={collapsedAfterDone ? "hidden" : "contents"}>
        <div className="mt-6 space-y-6">
          {drafts.map((d) => (
            <fieldset
              key={d.id}
              className="rounded-2xl border-2 border-ink-700 bg-paper-50/60 p-4 space-y-3 dark:border-umber-300 dark:bg-umber-800/60"
            >
              <legend className="px-1 font-grotesk text-lg text-ink-900 break-words dark:text-paper-50">
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
                /* 393px / 3 cells = 131px each — with `gap-2` (8px) and
                 * `px-3` the long labels would overflow, so mobile uses
                 * `gap-1 px-2` to claw back ~14px per cell. `min-h-tap`
                 * keeps the radio thumb-tappable. */
                className="grid grid-cols-3 gap-1 sm:gap-2"
              >
                {STATUSES.map((s) => {
                  const selected = d.interacted && d.rsvp_status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => void pickStatus(d, s)}
                      className={`min-h-tap rounded-xl px-2 py-2 text-sm font-medium sm:px-3 ${
                        selected ? STATUS_TONE_ACTIVE[s] : STATUS_TONE_IDLE[s]
                      }`}
                    >
                      {/* Verbose copy is friendlier ("Yes, count us in")
                        but at 393px / 3 = ~120px per cell the long
                        labels overflow. Mobile gets the short variant;
                        sm:+ swaps to the verbose copy where the row has
                        the horizontal room to carry it. */}
                      <span className="sm:hidden">{t(`rsvp.pick_${s}_short`)}</span>
                      <span className="hidden sm:inline">{t(`rsvp.pick_${s}`)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Yes-only detail block — meal, dietary, accommodation, song
                and family additions. Animated open with the CSS grid
                0fr→1fr height trick so it slides down smoothly when the
                guest taps "yes" and folds back up when they switch away.
                `!mt-0` drops the fieldset's space-y gap (the inner `pt-3`
                supplies it, so it collapses with the height); `inert` keeps
                the hidden fields out of the tab order and the a11y tree. */}
              <div
                inert={!(d.interacted && d.rsvp_status === "yes")}
                className={`grid !mt-0 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                  d.interacted && d.rsvp_status === "yes" ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="space-y-3 pt-3">
                    {/* Meal choice — radio-like icon row. Mutually exclusive;
                    clicking the active one clears it. Gated on
                    `rsvp_collects_meal` so buffet couples can hide it from
                    the workspace settings. The serif header + the divider
                    below separate this from the dietary chips, which were
                    previously visually indistinguishable. */}
                    {view.rsvp_collects_meal && (
                      <div>
                        <p className="mb-2 text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                          {t("rsvp.meal_section_title")}
                        </p>
                        <div
                          role="radiogroup"
                          aria-label={t("rsvp.meal")}
                          className="grid grid-cols-3 gap-1.5 sm:grid-cols-6"
                        >
                          {resolveMealOptions(view.meal_menu, t, d.meal_choice).map((opt) => {
                            const Icon = mealIcon(opt.choice);
                            const active = d.meal_choice === opt.choice;
                            return (
                              <button
                                key={opt.choice}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                aria-label={opt.label}
                                title={opt.label}
                                onClick={() =>
                                  updateMember(d.id, {
                                    meal_choice: active ? null : opt.choice,
                                  })
                                }
                                className={
                                  active
                                    ? "flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-ink-700 bg-ink-700 px-1 py-2 text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
                                    : "flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl border border-paper-300 bg-paper-50 px-1 py-2 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
                                }
                              >
                                <Icon size={18} aria-hidden />
                                <span className="line-clamp-2 w-full text-center text-[10px] font-medium leading-tight">
                                  {opt.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Dietary chips — multi-select allergen flags. Each chip
                    carries a semantic colour family (dairy → sky, wheat →
                    amber, nut → orange, egg → yellow, seafood → cyan) so
                    guests scan the row by tone, not by reading. Lactose +
                    milk-protein share the dairy palette but differ by icon
                    (plain milk vs. milk + atom). Forced to 6-col grid at
                    sm+; 3-col below to keep two rows max. */}
                    <div
                      className={`${view.rsvp_collects_meal ? "border-t border-paper-200 pt-3 dark:border-umber-700" : ""}`}
                    >
                      <p className="mb-2 text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                        {t("rsvp.dietary_section_title")}
                      </p>
                      <div className="grid grid-cols-3 gap-1.5 [&>button]:w-full [&>button]:justify-center">
                        {(
                          [
                            "milk_protein",
                            "lactose",
                            "gluten",
                            "nut",
                            "egg",
                            "fish_shellfish",
                          ] as const
                        ).map((tag) => (
                          <Chip
                            key={tag}
                            on={d.dietary_tags.has(tag)}
                            onClick={() => toggleDietaryTag(d.id, tag)}
                            icon={<DietaryTagIcon tag={tag} />}
                            label={t(`rsvp.tag_${tag}`)}
                          />
                        ))}
                      </div>
                      {/* Anything the six chips can't say. `dietary_free` was
                        already parsed out of the stored string, carried in
                        state and re-serialised on submit — it just had no
                        input bound to it, so a guest with a soy allergy or
                        coeliac disease had nowhere to put it while the couple
                        could type it from the admin side all along. */}
                      <input
                        className="input mt-2"
                        value={d.dietary_free}
                        maxLength={DIETARY_FREE_MAX}
                        placeholder={t("rsvp.dietary_other_placeholder")}
                        aria-label={t("rsvp.dietary_other_placeholder")}
                        onChange={(e) => updateMember(d.id, { dietary_free: e.target.value })}
                      />
                      <p className="mt-2 text-xs leading-relaxed text-ink-500 dark:text-umber-300">
                        {t("rsvp.dietary_privacy_notice")}{" "}
                        <a
                          href="/privacy#guest-data"
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2"
                        >
                          {t("rsvp.dietary_privacy_link")}
                        </a>
                      </p>
                    </div>

                    {/* Two shapes of one question. With no published lodgings
                      this stays the yes/no it has always been; the moment the
                      couple offers even one, "do you need somewhere to stay?"
                      becomes "which of these?" and the answer lands straight
                      on `guests.accommodation_id` instead of the couple
                      chasing every guest by hand afterwards. */}
                    {view.rsvp_offers_accommodation && lodgings.length === 0 && (
                      <label className="flex min-h-tap cursor-pointer items-center gap-3 py-1 text-sm text-ink-700 dark:text-paper-100">
                        <input
                          type="checkbox"
                          checked={d.accommodation_needed}
                          onChange={(e) =>
                            updateMember(d.id, { accommodation_needed: e.target.checked })
                          }
                          /* h-5 w-5 = 20px box; combined with the parent
                           * `min-h-tap` label this gives a 44px-tall row that
                           * passes WCAG without bloating the form. */
                          className="h-5 w-5 cursor-pointer accent-ink-700"
                        />
                        {t("rsvp.checkin_member_accommodation")}
                      </label>
                    )}
                    {view.rsvp_offers_accommodation && lodgings.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                          {t("rsvp.accommodation_section_title")}
                        </p>
                        <div
                          role="radiogroup"
                          aria-label={t("rsvp.accommodation_section_title")}
                          className="flex flex-col gap-1.5"
                        >
                          {/* "None" is a real option rather than the absence of
                            one: on a form that lists places, leaving every row
                            unpicked is indistinguishable from not having read
                            the question. */}
                          <LodgingOption
                            active={d.accommodation_id === null}
                            title={t("rsvp.accommodation_none")}
                            onClick={() =>
                              updateMember(d.id, {
                                accommodation_id: null,
                                accommodation_needed: false,
                              })
                            }
                          />
                          {lodgings.map((opt) => (
                            <LodgingOption
                              key={opt.id}
                              active={d.accommodation_id === opt.id}
                              title={opt.name}
                              detail={opt.address}
                              price={
                                opt.price_huf !== null
                                  ? formatMoney(opt.price_huf, currency, locale)
                                  : null
                              }
                              link={opt.link}
                              onClick={() =>
                                updateMember(d.id, {
                                  accommodation_id: opt.id,
                                  accommodation_needed: true,
                                })
                              }
                            />
                          ))}
                        </div>
                      </div>
                    )}
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
                    with a dietary attribute. Hidden for members who are
                    themselves a +1: a +1 can't carry its own +1 or baby —
                    their host fills the RSVP on their behalf. */}
                    {!d.is_plus_one && (
                      <div className="mt-6 border-t border-paper-200 pt-4 dark:border-umber-700">
                        <p className="mb-2 text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                          {t("rsvp.additions_section_title")}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {/* "+1?" is hidden when the couple already assigned
                              this member an explicit +1 — they have one. */}
                          {!d.hosts_plus_one && (
                            <Chip
                              on={d.plus_one !== null}
                              onClick={() => togglePlusOne(d)}
                              label={t("rsvp.tag_plus_one")}
                              controlsId={`plus-one-${d.id}`}
                              expanded={d.plus_one !== null}
                            />
                          )}
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
                              mealMenu={view.meal_menu}
                              onMealChange={(meal) =>
                                patchAttached(d.id, "plus_one", { meal_choice: meal })
                              }
                              onToggleTag={(tag) => toggleAttachedDietaryTag(d.id, "plus_one", tag)}
                              showMeal={view.rsvp_collects_meal}
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
                    )}
                  </div>
                </div>
              </div>
            </fieldset>
          ))}
        </div>

        {/* Message to the couple — household-level, so it sits outside the
          per-member fieldsets above. Every other free-text box on this form
          answers a question we thought to ask; this is the one for everything
          else, which until now had to go in "Song request" or nowhere. Shown
          whatever anyone answered: a guest who cannot come is often exactly
          the one with something to say. */}
        <div className="mt-6 border-t border-paper-200 pt-5 dark:border-umber-700">
          <label className="field-label" htmlFor="rsvp-guest-message">
            {t("rsvp.guest_message_label")}
          </label>
          <textarea
            id="rsvp-guest-message"
            className="input min-h-[5rem] resize-y"
            rows={3}
            maxLength={GUEST_MESSAGE_MAX}
            value={guestMessage}
            placeholder={t("rsvp.guest_message_placeholder")}
            onChange={(e) => setGuestMessage(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
            {t("rsvp.guest_message_help")}
          </p>
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
      </div>
      {done && !editingAfterDone && (
        <>
          {/* ── Confirmation card ─────────────────────────────────────── */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-paper-300 dark:border-umber-700">
            {/* Success hero */}
            <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sage-100 dark:bg-sage-900/40">
                <CircleCheckBig
                  size={26}
                  className="text-sage-600 dark:text-sage-400"
                  aria-hidden
                />
              </div>
              <p className="font-grotesk text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                {t("rsvp.checkin_done_title")}
              </p>
              <p className="mt-1.5 text-sm text-ink-500 dark:text-umber-300">
                {t("rsvp.thanks_body")}
              </p>
              {view.wedding_date && (
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400 dark:text-umber-400">
                  {formatDate(view.wedding_date, locale)}
                </p>
              )}
            </div>

            {/* Calendar section */}
            {calendarLinks && (
              <>
                <div className="border-t border-paper-300 dark:border-umber-700" />
                <div className="px-5 py-4">
                  <p className="mb-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-ink-400 dark:text-umber-400">
                    {t("rsvp.add_to_calendar_section")}
                  </p>
                  <div className="flex gap-2">
                    <a
                      href={calendarLinks.google}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2.5 text-xs font-medium text-ink-700 transition-colors hover:border-ink-300 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="shrink-0"
                      >
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      {t("rsvp.add_to_google_calendar")}
                    </a>
                    <a
                      href={calendarLinks.icsHref}
                      download={`${view.couple_display_name}.ics`}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2.5 text-xs font-medium text-ink-700 transition-colors hover:border-ink-300 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="shrink-0"
                      >
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      {t("rsvp.add_to_ical")}
                    </a>
                  </div>
                </div>
              </>
            )}

            {/* Open wedding page + runner */}
            {publicSiteUrl && (
              <>
                <div className="border-t border-paper-300 dark:border-umber-700" />
                <div className="px-5 py-4">
                  <a
                    href={publicSiteUrl}
                    className="btn-primary btn-lg inline-flex w-full justify-center"
                    target={runnerActive ? undefined : "_blank"}
                    rel={runnerActive ? undefined : "noopener noreferrer"}
                  >
                    <Globe size={18} aria-hidden />
                    {t("rsvp.thanks_open_site")}
                  </a>
                  {runnerActive && redirectSecondsLeft !== null && (
                    <div className="mt-3" aria-live="polite">
                      <div className="h-1 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                        <div
                          className="h-full rounded-full bg-sage-500 transition-[width] duration-1000 ease-linear dark:bg-sage-400"
                          style={{
                            width: `${((SITE_REDIRECT_SECONDS - redirectSecondsLeft) / SITE_REDIRECT_SECONDS) * 100}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1.5 text-center text-xs text-ink-400 dark:text-umber-400">
                        {t("rsvp.redirect_hint", { n: redirectSecondsLeft })}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Email hint footer */}
            <div className="border-t border-paper-300 px-5 pb-5 pt-4 text-center dark:border-umber-700">
              <p className="text-xs text-ink-400 dark:text-umber-400">
                {t("rsvp.thanks_email_hint")}
              </p>
            </div>
          </div>

          {/* Tertiary actions — below the card */}
          <div className="mt-4 flex flex-col items-center gap-3 text-center">
            {collapsedAfterDone && (
              <button
                type="button"
                onClick={() => setEditingAfterDone(true)}
                className="btn-ghost btn-sm"
              >
                {t("rsvp.edit_responses")}
              </button>
            )}
            <p className="text-xs text-ink-400 dark:text-umber-400">
              <a
                href="/?ref=rsvp"
                className="font-grotesk italic underline-offset-4 hover:underline"
              >
                {t("rsvp.thanks_plan_your_own")}
              </a>
            </p>
          </div>
        </>
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

/** One lodging the couple published, as a full-width radio row. Wider than a
 *  Chip on purpose: an address and a price are what someone actually chooses
 *  between, and they do not fit on a pill.
 *
 *  The booking link is a real anchor nested inside the row, so its click is
 *  stopped from selecting the option. Someone opening the hotel's page to look
 *  has not decided yet, and silently picking it for them would be a lie the
 *  form tells the couple. */
function LodgingOption({
  active,
  title,
  detail,
  price,
  link,
  onClick,
}: {
  active: boolean;
  title: string;
  detail?: string | null;
  price?: string | null;
  link?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={
        active
          ? "flex min-h-tap w-full flex-col items-start gap-0.5 rounded-xl border-2 border-ink-700 bg-ink-700 px-3 py-2 text-left text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
          : "flex min-h-tap w-full flex-col items-start gap-0.5 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-left text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
      }
    >
      <span className="flex w-full flex-wrap items-baseline gap-x-2 text-sm font-medium">
        {title}
        {price && <span className="text-xs font-normal opacity-80">{price}</span>}
      </span>
      {detail && <span className="text-xs opacity-70">{detail}</span>}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs underline underline-offset-2 opacity-80 hover:opacity-100"
        >
          {link.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      )}
    </button>
  );
}

function Chip({
  on,
  onClick,
  icon,
  label,
  controlsId,
  expanded,
  iconOnly,
}: {
  on: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  /** Optional — when the chip toggles a disclosure (e.g. "+1" reveals a name
   *  input below), pass the disclosure's id + current expanded state so screen
   *  readers can announce the relationship. */
  controlsId?: string;
  expanded?: boolean;
  /** Hide the visible label and render the chip as a square icon button.
   *  Used for allergen chips, where the icon is the primary signifier and
   *  the label remains available to assistive tech via aria-label. */
  iconOnly?: boolean;
}) {
  const shape = iconOnly
    ? "inline-flex aspect-square items-center justify-center rounded-xl p-2 text-xs transition-colors"
    : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors";
  const palette = on
    ? "border-2 border-ink-700 bg-ink-700 font-medium text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
    : "border border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-controls={controlsId}
      aria-expanded={controlsId !== undefined ? expanded === true : undefined}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={onClick}
      className={`${shape} ${palette}`}
    >
      {icon}
      {!iconOnly && <span className="whitespace-nowrap">{label}</span>}
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
  mealMenu,
  onMealChange,
  onToggleTag,
  showMeal = true,
}: {
  member: AttachedDraft;
  mealMenu?: MealMenu;
  onMealChange: (m: MealSlotKey | null) => void;
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
          {resolveMealOptions(mealMenu, t, member.meal_choice).map((opt) => {
            const Icon = mealIcon(opt.choice);
            const active = member.meal_choice === opt.choice;
            return (
              <button
                key={opt.choice}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={opt.label}
                title={opt.label}
                onClick={() => onMealChange(active ? null : opt.choice)}
                className={
                  active
                    ? "flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-ink-700 bg-ink-700 px-1 text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
                    : "flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-paper-300 bg-paper-50 px-1 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
                }
              >
                <Icon size={20} aria-hidden />
                <span className="line-clamp-2 text-[11px] font-medium leading-tight">
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5 [&>button]:w-full [&>button]:justify-center">
        {(["milk_protein", "lactose", "gluten", "nut", "egg", "fish_shellfish"] as const).map(
          (tag) => (
            <Chip
              key={tag}
              on={member.dietary_tags.has(tag)}
              onClick={() => onToggleTag(tag)}
              icon={<DietaryTagIcon tag={tag} />}
              label={t(`rsvp.tag_${tag}`)}
            />
          ),
        )}
      </div>
    </div>
  );
}
