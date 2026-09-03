// "Esemény-munkaterületek" section on /app/profile. Lists every workspace
// the user belongs to (Alpha / Bravo / Charlie), marks the active one,
// and offers an "Új esemény" button that opens the create modal.
//
// On create: optional guest seed from the currently-active workspace.
// The picker is a checkbox list grouped by household, so the user can
// pull a subset of Alpha's guests into Bravo with one gesture and
// re-pipa anyone who isn't invited to the second event.

import type { Guest, Household } from "@shared/types";
import { Check, Plus } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { type CoupleMembershipView, coupleApi, guestApi, householdApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { CountryCombobox } from "./CountryCombobox";
import { Dialog, useEntryPrompt, useToast } from "./ui";

interface Props {
  /** Couple_id currently active — surfaces as the seed-from source when
   *  the user opens the create modal, and gets the "Active" pill in the
   *  rest-state list. */
  activeCoupleId: number | null;
}

export function WorkspacesPanel({ activeCoupleId }: Props) {
  const { t } = useT();
  const toast = useToast();
  const promptEntry = useEntryPrompt();
  const [memberships, setMemberships] = useState<CoupleMembershipView[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  /** 3-click delete arming. Tracks WHICH workspace's button is mid-arm and
   *  HOW MANY clicks have landed so far (1 = "Biztos?", 2 = "Tényleg?",
   *  3 = fires the DELETE). A 4s timer resets the count to idle so a
   *  half-armed button never lingers between sessions. */
  const [armedDeleteId, setArmedDeleteId] = useState<number | null>(null);
  const [armedDeleteStage, setArmedDeleteStage] = useState<0 | 1 | 2>(0);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh() {
    try {
      const r = await coupleApi.listMine();
      setMemberships(r.couples);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Clear any pending disarm timer when the component unmounts so an in-
  // flight setTimeout doesn't fire on an unmounted node.
  useEffect(() => {
    return () => {
      if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    };
  }, []);

  const atCap = memberships.filter((m) => m.status !== "deleting").length >= 3;
  const activeMembership = memberships.find((m) => m.couple_id === activeCoupleId) ?? null;
  // Memberships come back joined_at ASC, so index 0 is the user's primary
  // (Alpha). Only secondary workspaces (anyone else they're an owner of
  // AND that isn't currently active) get a delete affordance — Alpha goes
  // through the account-deletion flow further down the Profile page.
  const primaryCoupleId = memberships[0]?.couple_id ?? null;

  function disarmLater() {
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    disarmTimer.current = setTimeout(() => {
      setArmedDeleteId(null);
      setArmedDeleteStage(0);
    }, 4000);
  }

  async function clickDelete(coupleId: number, displayName: string) {
    // Click against a DIFFERENT armed button → reset to that workspace
    // (so the user can switch their attention without juggling state).
    if (armedDeleteId !== coupleId) {
      setArmedDeleteId(coupleId);
      setArmedDeleteStage(1);
      disarmLater();
      return;
    }
    if (armedDeleteStage === 1) {
      setArmedDeleteStage(2);
      disarmLater();
      return;
    }
    // Stage 2 → the third click is intent-to-delete; before we actually
    // fire the DELETE we surface a typed-phrase modal so the user has to
    // re-type the workspace name. Matches the pause-to-delete-account
    // gate further down the Profile page: a typed phrase forces a
    // conscious confirmation, not just three quick taps.
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    setArmedDeleteId(null);
    setArmedDeleteStage(0);
    const entered = await promptEntry({
      title: t("profile.workspaces_delete_confirm_title"),
      label: t("profile.workspaces_delete_confirm_label", { name: displayName }),
      helperText: t("profile.workspaces_delete_confirm_help"),
      placeholder: displayName,
      confirmLabel: t("profile.workspaces_delete_confirm_yes"),
      cancelLabel: t("common.cancel"),
      validate: (v) =>
        v.trim() === displayName
          ? null
          : t("profile.workspaces_delete_confirm_mismatch", { name: displayName }),
    });
    if (entered === null) return;
    setDeletingId(coupleId);
    try {
      await coupleApi.deleteWorkspace(coupleId);
      toast.success(t("profile.workspaces_delete_done"));
      // Drop the row optimistically + refetch in the background to pick
      // up any side effects (e.g. seat/budget audit emissions purged with
      // the workspace).
      setMemberships((cur) => cur.filter((m) => m.couple_id !== coupleId));
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section id="workspaces" className="card mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg">{t("profile.workspaces_title")}</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {t("profile.workspaces_body")}
          </p>
        </div>
        {/* Hide the "Új esemény" affordance once the user is at the
         *  3-workspace cap — a disabled button reads as "broken"; better
         *  to simply remove the entry point until they free a slot. */}
        {!atCap && (
          <button
            type="button"
            className="btn-outline btn-sm inline-flex items-center gap-1.5"
            onClick={() => setCreating(true)}
          >
            <Plus size={14} aria-hidden="true" />
            {t("profile.workspaces_add")}
          </button>
        )}
      </div>

      <ul className="mt-3 divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700">
        {memberships.length === 0 ? (
          <li className="py-3 text-sm text-ink-500 dark:text-umber-300">
            {t("profile.workspaces_empty")}
          </li>
        ) : (
          memberships.map((m) => {
            const isActive = m.couple_id === activeCoupleId;
            const isPrimary = m.couple_id === primaryCoupleId;
            // Delete is offered only on SECONDARY (Bravo / Charlie)
            // workspaces the user owns and isn't currently looking at.
            // Active workspaces force a switch-first dance; the primary
            // belongs to the account-deletion flow further down.
            const canDelete = !isActive && !isPrimary && m.role === "owner";
            const isArmed = armedDeleteId === m.couple_id;
            const isDeletingThis = deletingId === m.couple_id;
            return (
              <li key={m.couple_id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                      {m.display_name}
                    </p>
                    {/* Primary workspace gets a small "Fő" pill so the
                     *  missing delete button reads as intentional — the
                     *  user's original onboarding workspace stays put
                     *  here; deleting it lives on the account-deletion
                     *  flow further down the page. */}
                    {isPrimary && (
                      <span className="inline-flex items-center rounded-full border border-ink-300 px-2 py-px text-[10px] uppercase tracking-wide text-ink-500 dark:border-umber-700 dark:text-umber-300">
                        {t("profile.workspaces_primary_marker")}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                    {t(`profile.workspaces_role_${m.role}`)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {isActive ? (
                    <>
                      <button
                        type="button"
                        className="text-xs font-medium text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                        onClick={() => setEditing(true)}
                      >
                        {t("profile.workspaces_edit")}
                      </button>
                      <span className="inline-flex items-center gap-1 rounded-full bg-ink-900 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-paper-50 dark:bg-paper-50 dark:text-ink-900">
                        <Check size={10} aria-hidden="true" />
                        {t("workspace.active_marker")}
                      </span>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="text-xs font-medium text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                      onClick={async () => {
                        try {
                          await coupleApi.switchActive(m.couple_id);
                          window.location.assign("/app");
                        } catch (e) {
                          toast.error(
                            e instanceof ApiError ? e.message : t("common.error_generic"),
                          );
                        }
                      }}
                    >
                      {t("profile.workspaces_switch")}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      className={`text-xs font-medium transition-colors ${
                        isArmed
                          ? "text-blush-700 hover:text-blush-800 dark:text-blush-300 dark:hover:text-blush-200"
                          : "text-ink-400 hover:text-blush-700 dark:text-umber-300 dark:hover:text-blush-300"
                      }`}
                      onClick={() => clickDelete(m.couple_id, m.display_name)}
                      disabled={isDeletingThis}
                      aria-label={t("profile.workspaces_delete")}
                    >
                      {isDeletingThis
                        ? t("common.loading")
                        : isArmed && armedDeleteStage === 1
                          ? t("profile.workspaces_delete_arm1")
                          : isArmed && armedDeleteStage === 2
                            ? t("profile.workspaces_delete_arm2")
                            : t("profile.workspaces_delete")}
                    </button>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ul>

      {creating && (
        <CreateWorkspaceDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            // The backend auto-switches users.couple_id to the new
            // workspace, so a hard reload lands on its empty /app.
            window.location.assign("/app");
          }}
        />
      )}

      {editing && activeMembership && (
        <EditWorkspaceDialog
          initialName={activeMembership.display_name}
          initialDate={activeMembership.wedding_date}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function EditWorkspaceDialog({
  initialName,
  initialDate,
  onClose,
  onSaved,
}: {
  initialName: string;
  initialDate: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [eventName, setEventName] = useState(initialName);
  const [weddingDate, setWeddingDate] = useState(initialDate ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = eventName.trim();
    if (!name || name.length > 100) {
      toast.error(t("profile.workspaces_create_event_required"));
      return;
    }
    setSubmitting(true);
    try {
      const wedding_date_goal =
        weddingDate && /^\d{4}-\d{2}-\d{2}$/.test(weddingDate)
          ? {
              kind: "exact" as const,
              exact_date: weddingDate,
              target_year: Number(weddingDate.slice(0, 4)),
              target_month: Number(weddingDate.slice(5, 7)),
              target_season: null,
              target_quarter: null,
            }
          : {
              kind: "tbd" as const,
              exact_date: null,
              target_year: null,
              target_month: null,
              target_season: null,
              target_quarter: null,
            };
      await coupleApi.update({
        display_name: name,
        wedding_date_goal,
      });
      toast.success(t("profile.workspaces_edit_done"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={t("profile.workspaces_edit_title")}
      role="dialog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="edit-workspace-form"
            className="btn-primary"
            disabled={submitting}
          >
            {submitting ? t("common.saving") : t("profile.workspaces_edit_save")}
          </button>
        </>
      }
    >
      <form id="edit-workspace-form" onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="ew-event" className="field-label">
            {t("profile.workspaces_create_event_label")}
          </label>
          <input
            id="ew-event"
            type="text"
            className="input"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder={t("profile.workspaces_create_event_placeholder")}
            maxLength={100}
            autoFocus
            disabled={submitting}
          />
        </div>
        <div>
          <label htmlFor="ew-date" className="field-label">
            {t("profile.workspaces_create_date_label")}
          </label>
          <input
            id="ew-date"
            type="date"
            className="input"
            value={weddingDate}
            onChange={(e) => setWeddingDate(e.target.value)}
            disabled={submitting}
          />
        </div>
      </form>
    </Dialog>
  );
}

function CreateWorkspaceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [eventName, setEventName] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [country, setCountry] = useState("");
  const [seedOn, setSeedOn] = useState(false);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [seedLoading, setSeedLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeCoupleId, setActiveCoupleId] = useState<number | null>(null);

  // Fetch the current couple's id + country once. The id seeds the
  // "import from current workspace" toggle; the country pre-fills the
  // combobox below since most multi-event weddings stay in one country.
  useEffect(() => {
    coupleApi.current().then((r) => {
      setActiveCoupleId(r.couple?.id ?? null);
      if (r.couple?.country) setCountry(r.couple.country);
    });
  }, []);

  // Lazy-load guests + households the first time the user toggles
  // "import from current workspace" on. Skips the round-trip when the
  // user doesn't want a seed.
  useEffect(() => {
    if (!seedOn || guests.length > 0) return;
    setSeedLoading(true);
    Promise.all([guestApi.list(), householdApi.list()])
      .then(([g, h]) => {
        setGuests(g.guests);
        setHouseholds(h.households);
        // Default-select everyone — most weddings invite the same crowd
        // to a welcome dinner / after-party as to the main event, so
        // "select all by default" matches the common case.
        setSelectedGuestIds(new Set(g.guests.map((x) => x.id)));
      })
      .finally(() => setSeedLoading(false));
  }, [seedOn, guests.length]);

  const grouped = useMemo(() => {
    const byHh = new Map<number | null, Guest[]>();
    for (const g of guests) {
      const key = g.household_id ?? null;
      const list = byHh.get(key);
      if (list) list.push(g);
      else byHh.set(key, [g]);
    }
    const hhMap = new Map(households.map((h) => [h.id, h]));
    return Array.from(byHh.entries()).map(([hhId, members]) => ({
      household: hhId !== null ? (hhMap.get(hhId) ?? null) : null,
      members,
    }));
  }, [guests, households]);

  const selectedCount = selectedGuestIds.size;

  function toggleGuest(id: number) {
    setSelectedGuestIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleHousehold(memberIds: number[]) {
    setSelectedGuestIds((cur) => {
      const next = new Set(cur);
      const allOn = memberIds.every((id) => next.has(id));
      if (allOn) memberIds.forEach((id) => next.delete(id));
      else memberIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = eventName.trim();
    if (!name) {
      toast.error(t("profile.workspaces_create_event_required"));
      return;
    }
    if (!country || country.length !== 2) {
      toast.error(t("profile.workspaces_create_country_required"));
      return;
    }
    setSubmitting(true);
    try {
      const wedding_date_goal =
        weddingDate && /^\d{4}-\d{2}-\d{2}$/.test(weddingDate)
          ? {
              kind: "exact" as const,
              exact_date: weddingDate,
              target_year: Number(weddingDate.slice(0, 4)),
              target_month: Number(weddingDate.slice(5, 7)),
              target_season: null,
              target_quarter: null,
            }
          : {
              kind: "tbd" as const,
              exact_date: null,
              target_year: null,
              target_month: null,
              target_season: null,
              target_quarter: null,
            };
      const seedFrom = seedOn && activeCoupleId !== null ? activeCoupleId : null;
      const seedIds = seedOn ? Array.from(selectedGuestIds) : [];
      const r = await coupleApi.createAdditional({
        event_name: name,
        wedding_date_goal,
        country,
        seed_from_couple_id: seedFrom,
        seed_guest_ids: seedIds,
      });
      toast.success(
        t("profile.workspaces_create_done", {
          name: r.couple.display_name,
        }),
      );
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={t("profile.workspaces_create_title")}
      role="dialog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="create-workspace-form"
            className="btn-primary"
            disabled={submitting}
          >
            {submitting ? t("common.saving") : t("profile.workspaces_create_submit")}
          </button>
        </>
      }
    >
      <form id="create-workspace-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-600 dark:text-umber-200">
          {t("profile.workspaces_create_body")}
        </p>
        <div>
          <label htmlFor="cw-event" className="field-label">
            {t("profile.workspaces_create_event_label")}
          </label>
          <input
            id="cw-event"
            type="text"
            className="input"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder={t("profile.workspaces_create_event_placeholder")}
            maxLength={100}
            autoFocus
            disabled={submitting}
          />
        </div>
        <div>
          <label htmlFor="cw-date" className="field-label">
            {t("profile.workspaces_create_date_label")}
          </label>
          <input
            id="cw-date"
            type="date"
            className="input"
            value={weddingDate}
            onChange={(e) => setWeddingDate(e.target.value)}
            disabled={submitting}
          />
        </div>
        <CountryCombobox
          value={country}
          onChange={setCountry}
          label={t("profile.workspaces_create_country_label")}
          helperText={t("profile.workspaces_create_country_helper")}
          required
        />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={seedOn}
            onChange={(e) => setSeedOn(e.target.checked)}
            disabled={submitting}
          />
          <span>
            <span className="font-medium text-ink-900 dark:text-paper-50">
              {t("profile.workspaces_create_seed_toggle")}
            </span>
            <span className="mt-0.5 block text-xs text-ink-500 dark:text-umber-300">
              {t("profile.workspaces_create_seed_hint")}
            </span>
          </span>
        </label>
        {seedOn && (
          <div className="rounded-xl border border-paper-200 bg-paper-50/40 p-3 dark:border-umber-700 dark:bg-umber-800/40">
            <div className="flex items-center justify-between gap-2 text-xs text-ink-500 dark:text-umber-300">
              <span>
                {seedLoading
                  ? t("common.loading")
                  : t("profile.workspaces_create_seed_summary", {
                      selected: selectedCount,
                      total: guests.length,
                    })}
              </span>
              <button
                type="button"
                className="font-medium text-ink-700 hover:text-ink-900 dark:text-paper-100 dark:hover:text-paper-50"
                onClick={() => {
                  setSelectedGuestIds((cur) =>
                    cur.size === guests.length ? new Set() : new Set(guests.map((g) => g.id)),
                  );
                }}
                disabled={seedLoading || guests.length === 0}
              >
                {selectedCount === guests.length
                  ? t("profile.workspaces_create_seed_unselect_all")
                  : t("profile.workspaces_create_seed_select_all")}
              </button>
            </div>
            <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto pr-1">
              {grouped.map(({ household, members }) => {
                const memberIds = members.map((m) => m.id);
                const allSelected = memberIds.every((id) => selectedGuestIds.has(id));
                const someSelected =
                  !allSelected && memberIds.some((id) => selectedGuestIds.has(id));
                return (
                  <li key={household?.id ?? "no-hh"} className="text-sm">
                    <label className="flex items-center gap-2 font-medium text-ink-800 dark:text-paper-100">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={() => toggleHousehold(memberIds)}
                      />
                      <span>
                        {household?.label ?? t("profile.workspaces_create_seed_no_household")}
                      </span>
                    </label>
                    <ul className="mt-1 ml-6 space-y-0.5">
                      {members.map((m) => (
                        <li key={m.id}>
                          <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
                            <input
                              type="checkbox"
                              checked={selectedGuestIds.has(m.id)}
                              onChange={() => toggleGuest(m.id)}
                            />
                            <span>{m.full_name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </form>
    </Dialog>
  );
}
