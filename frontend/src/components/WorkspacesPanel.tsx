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
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api";
import { type CoupleMembershipView, coupleApi, guestApi, householdApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Dialog, useToast } from "./ui";

interface Props {
  /** Couple_id currently active — surfaces as the seed-from source when
   *  the user opens the create modal, and gets the "Active" pill in the
   *  rest-state list. */
  activeCoupleId: number | null;
}

export function WorkspacesPanel({ activeCoupleId }: Props) {
  const { t } = useT();
  const toast = useToast();
  const [memberships, setMemberships] = useState<CoupleMembershipView[]>([]);
  const [creating, setCreating] = useState(false);

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

  const atCap = memberships.filter((m) => m.status !== "deleting").length >= 3;

  return (
    <section id="workspaces" className="card mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg">{t("profile.workspaces_title")}</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {t("profile.workspaces_body")}
          </p>
        </div>
        <button
          type="button"
          className="btn-outline btn-sm inline-flex items-center gap-1.5"
          onClick={() => setCreating(true)}
          disabled={atCap}
          title={atCap ? t("profile.workspaces_cap_reached") : undefined}
        >
          <Plus size={14} aria-hidden="true" />
          {t("profile.workspaces_add")}
        </button>
      </div>

      <ul className="mt-3 divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700">
        {memberships.length === 0 ? (
          <li className="py-3 text-sm text-ink-500 dark:text-umber-300">
            {t("profile.workspaces_empty")}
          </li>
        ) : (
          memberships.map((m) => {
            const isActive = m.couple_id === activeCoupleId;
            return (
              <li key={m.couple_id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                    {m.display_name}
                  </p>
                  <p className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                    {t(`profile.workspaces_role_${m.role}`)}
                  </p>
                </div>
                {isActive ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-900 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-paper-50 dark:bg-paper-50 dark:text-ink-900">
                    <Check size={10} aria-hidden="true" />
                    {t("workspace.active_marker")}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-medium text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                    onClick={async () => {
                      try {
                        await coupleApi.switchActive(m.couple_id);
                        window.location.assign("/app");
                      } catch (e) {
                        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
                      }
                    }}
                  >
                    {t("profile.workspaces_switch")}
                  </button>
                )}
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
    </section>
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
  const [brideName, setBrideName] = useState("");
  const [groomName, setGroomName] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [seedOn, setSeedOn] = useState(false);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [seedLoading, setSeedLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeCoupleId, setActiveCoupleId] = useState<number | null>(null);

  // Fetch the current couple's id once — needed as the seed_from source.
  useEffect(() => {
    coupleApi.current().then((r) => setActiveCoupleId(r.couple?.id ?? null));
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
    const bride = brideName.trim();
    const groom = groomName.trim();
    if (!bride || !groom) {
      toast.error(t("profile.workspaces_create_names_required"));
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
            }
          : {
              kind: "tbd" as const,
              exact_date: null,
              target_year: null,
              target_month: null,
              target_season: null,
            };
      const seedFrom = seedOn && activeCoupleId !== null ? activeCoupleId : null;
      const seedIds = seedOn ? Array.from(selectedGuestIds) : [];
      const r = await coupleApi.createAdditional({
        bride_name: bride,
        groom_name: groom,
        wedding_date_goal,
        guest_count_goal: { kind: "tbd", exact: null, min: null, max: null },
        budget_goal: { kind: "tbd", exact_huf: null, min_huf: null, max_huf: null },
        style_tags: [],
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cw-bride" className="field-label">
              {t("onboarding.bride_name_label")}
            </label>
            <input
              id="cw-bride"
              type="text"
              className="input"
              value={brideName}
              onChange={(e) => setBrideName(e.target.value)}
              maxLength={100}
              autoFocus
              disabled={submitting}
            />
          </div>
          <div>
            <label htmlFor="cw-groom" className="field-label">
              {t("onboarding.groom_name_label")}
            </label>
            <input
              id="cw-groom"
              type="text"
              className="input"
              value={groomName}
              onChange={(e) => setGroomName(e.target.value)}
              maxLength={100}
              disabled={submitting}
            />
          </div>
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
