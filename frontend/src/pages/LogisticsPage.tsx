// Logistics surface: accommodation + transfer assignment for the wedding's
// out-of-towners. Two tabs share one unassigned-guests sidebar (the active tab
// scopes "unassigned" to that dimension's foreign key on guests).
//
//   • Szállás: house-shaped cards for each accommodation (name / address /
//     capacity / price / link / contact). Drag a guest from the sidebar onto
//     a house to assign; the card refuses drops past `capacity` (a warning
//     toast lands instead). Drag a chip back to the sidebar to free a slot.
//   • Transzfer: flat editable table per the v1 spec — basic CRUD + a
//     guest-picker per row. Same drag-from-sidebar gesture works, with the
//     same capacity refusal when the trip's seat count is set.
//   • Sidebar groups: any household with ≥ 2 unassigned members collapses
//     into a single HouseholdGroup card (mirroring SeatingPage). Dragging any
//     member carries the whole party as the drag payload, and the receiver
//     spreads them across free slots, leaving overflow members unassigned.
//   • Tap mode: forced on for coarse pointers (touch), opt-in for fine ones.
//     Tap a guest to arm, then tap a card / row to assign — capacity is
//     enforced the same way as drag drops.

import type {
  Accommodation,
  Couple,
  Guest,
  Transfer,
  UpsertAccommodationInput,
  UpsertTransferInput,
} from "@shared/types";
import {
  Bed,
  Bus,
  Crown,
  ExternalLink,
  Link2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Unlink2,
  User,
  Users,
  X,
} from "lucide-react";
import { type DragEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Button, Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { accommodationApi, coupleApi, guestApi, transferApi } from "../lib/endpoints";
import { formatHuf } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type LogisticsTab = "accommodation" | "transfer";

interface DragData {
  /** Primary guest being dragged. For a household drop this is the first
   *  member; the receiver iterates `guestIds` to spread the whole party. */
  guestId: number;
  /** Set when a *linked* household card is dragged. Drop handlers walk this
   *  list in order, assigning each id into the first free slot and stopping
   *  when the destination's capacity is reached. Absent for solo drags. */
  guestIds?: number[];
}

export default function LogisticsPage() {
  const { t } = useT();
  useDocumentMeta("seo.logistics_title", "seo.logistics_description");
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<LogisticsTab>("accommodation");
  const [accommodations, setAccommodations] = useState<Accommodation[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  // The couple — fetched alongside so we can pin the host pair at the top of
  // the unassigned sidebar (matched by `partner_role`, mirroring SeatingPage).
  const [couple, setCouple] = useState<Couple | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingAccommodation, setEditingAccommodation] = useState<Accommodation | "new" | null>(
    null,
  );
  const [editingTransfer, setEditingTransfer] = useState<Transfer | "new" | null>(null);
  const [hoverAccommodationId, setHoverAccommodationId] = useState<number | null>(null);
  const [hoverTransferId, setHoverTransferId] = useState<number | null>(null);
  const [sidebarHover, setSidebarHover] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [tapModeUser, setTapModeUser] = useState(false);
  const tapMode = coarsePointer || tapModeUser;
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  // Per-session "unlink" toggle for the sidebar — household cards whose id
  // lands here render flat so members can be dragged one at a time. Same
  // pattern as SeatingPage; resets on reload (intentionally not persisted).
  const [unlinkedHouseholds, setUnlinkedHouseholds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarsePointer(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  const refresh = useCallback(async () => {
    const [acc, tr, gs, c] = await Promise.all([
      accommodationApi.list(),
      transferApi.list(),
      guestApi.list(),
      coupleApi.current(),
    ]);
    setAccommodations(acc.accommodations);
    setTransfers(tr.transfers);
    setGuests(gs.guests);
    setCouple(c.couple);
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    setSelectedGuestId(null);
  }, [tab]);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const guestsByAccommodation = useMemo(() => {
    const out = new Map<number, Guest[]>();
    for (const g of guests) {
      if (g.accommodation_id == null) continue;
      const arr = out.get(g.accommodation_id) ?? [];
      arr.push(g);
      out.set(g.accommodation_id, arr);
    }
    return out;
  }, [guests]);
  const guestsByTransfer = useMemo(() => {
    const out = new Map<number, Guest[]>();
    for (const g of guests) {
      if (g.transfer_id == null) continue;
      const arr = out.get(g.transfer_id) ?? [];
      arr.push(g);
      out.set(g.transfer_id, arr);
    }
    return out;
  }, [guests]);

  // Pinned partner-role rows at the top of the sidebar — matches SeatingPage.
  // Three render states per role: missing guest row → PartnerSlotPlaceholder,
  // present + unassigned → DraggableGuestRow with a Crown, present + already
  // assigned → omit the slot entirely (the chip on the destination is the
  // load-bearing visual at that point).
  type PartnerSlot = {
    role: "bride" | "groom";
    name: string;
    guest: Guest | null;
  };
  const partnerSlots = useMemo<PartnerSlot[]>(() => {
    if (!couple) return [];
    const isAssigned = (g: Guest): boolean =>
      tab === "accommodation" ? g.accommodation_id != null : g.transfer_id != null;
    const findByRole = (role: "bride" | "groom"): Guest | null =>
      guests.find((g) => g.partner_role === role) ?? null;
    const brideName = couple.bride_name?.trim() || t("logistics.bride_label");
    const groomName = couple.groom_name?.trim() || t("logistics.groom_label");
    const buildSlot = (role: "bride" | "groom", name: string): PartnerSlot | null => {
      const g = findByRole(role);
      if (g && isAssigned(g)) return null;
      return { role, name, guest: g };
    };
    return [buildSlot("bride", brideName), buildSlot("groom", groomName)].filter(
      (s): s is PartnerSlot => s !== null,
    );
  }, [couple, guests, tab, t]);

  // Partner rows are rendered separately above the household groups, so drop
  // them from the general unassigned list to avoid the duplicate render the
  // user noticed (Andor + Sári appearing both pinned + in the flat list).
  const unassigned = useMemo(
    () =>
      guests.filter((g) => {
        const stillUnassigned =
          tab === "accommodation" ? g.accommodation_id == null : g.transfer_id == null;
        return stillUnassigned && g.partner_role === null;
      }),
    [guests, tab],
  );
  type UnassignedEntry =
    | { kind: "single"; guest: Guest }
    | { kind: "household"; householdId: number; guests: Guest[] };
  const unassignedEntries = useMemo<UnassignedEntry[]>(() => {
    const byHousehold = new Map<number, Guest[]>();
    for (const g of unassigned) {
      if (g.household_id == null) continue;
      const arr = byHousehold.get(g.household_id) ?? [];
      arr.push(g);
      byHousehold.set(g.household_id, arr);
    }
    const emitted = new Set<number>();
    const out: UnassignedEntry[] = [];
    for (const g of unassigned) {
      const hid = g.household_id;
      if (hid != null) {
        const siblings = byHousehold.get(hid) ?? [];
        const linked = siblings.length >= 2 && !unlinkedHouseholds.has(hid);
        if (linked) {
          if (emitted.has(hid)) continue;
          out.push({ kind: "household", householdId: hid, guests: siblings });
          emitted.add(hid);
          continue;
        }
      }
      out.push({ kind: "single", guest: g });
    }
    return out;
  }, [unassigned, unlinkedHouseholds]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const assignAccommodationOne = useCallback(
    async (guestId: number, accommodationId: number | null): Promise<boolean> => {
      setGuests((prev) =>
        prev.map((g) => (g.id === guestId ? { ...g, accommodation_id: accommodationId } : g)),
      );
      try {
        await accommodationApi.assign({ guest_id: guestId, accommodation_id: accommodationId });
        return true;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
        await refresh();
        return false;
      }
    },
    [refresh, toast, t],
  );

  const assignTransferOne = useCallback(
    async (guestId: number, transferId: number | null): Promise<boolean> => {
      setGuests((prev) =>
        prev.map((g) => (g.id === guestId ? { ...g, transfer_id: transferId } : g)),
      );
      try {
        await transferApi.assign({ guest_id: guestId, transfer_id: transferId });
        return true;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
        await refresh();
        return false;
      }
    },
    [refresh, toast, t],
  );

  /** Capacity-aware accommodation drop. Walks `guestIds` in order, takes the
   *  first N that fit (N = capacity − currently-assigned), assigns them, and
   *  toasts the outcome (all placed / partial overflow / blocked-because-full). */
  const assignAccommodationMany = useCallback(
    async (guestIds: number[], a: Accommodation) => {
      if (guestIds.length === 0) return;
      const currentlyAssigned = guests.filter((g) => g.accommodation_id === a.id).length;
      const incoming = guestIds.filter((id) => {
        const g = guestById.get(id);
        return g != null && g.accommodation_id !== a.id;
      });
      if (incoming.length === 0) return;
      const free = Math.max(0, a.capacity - currentlyAssigned);
      if (free === 0) {
        toast.error(t("logistics.full_blocked", { name: a.name }));
        return;
      }
      const placed = incoming.slice(0, free);
      const overflow = incoming.length - placed.length;
      for (const id of placed) {
        const ok = await assignAccommodationOne(id, a.id);
        if (!ok) return;
      }
      if (overflow > 0) {
        toast.info(
          t("logistics.partial_placed", {
            placed: String(placed.length),
            total: String(incoming.length),
            name: a.name,
          }),
        );
      }
    },
    [guests, guestById, assignAccommodationOne, toast, t],
  );

  /** Same shape as `assignAccommodationMany` but the transfer's `capacity`
   *  is optional — when null, no cap is enforced. */
  const assignTransferMany = useCallback(
    async (guestIds: number[], tr: Transfer) => {
      if (guestIds.length === 0) return;
      const currentlyAssigned = guests.filter((g) => g.transfer_id === tr.id).length;
      const incoming = guestIds.filter((id) => {
        const g = guestById.get(id);
        return g != null && g.transfer_id !== tr.id;
      });
      if (incoming.length === 0) return;
      const cap = tr.capacity;
      const free = cap == null ? incoming.length : Math.max(0, cap - currentlyAssigned);
      if (free === 0) {
        toast.error(t("logistics.full_blocked", { name: tr.label }));
        return;
      }
      const placed = incoming.slice(0, free);
      const overflow = incoming.length - placed.length;
      for (const id of placed) {
        const ok = await assignTransferOne(id, tr.id);
        if (!ok) return;
      }
      if (overflow > 0) {
        toast.info(
          t("logistics.partial_placed", {
            placed: String(placed.length),
            total: String(incoming.length),
            name: tr.label,
          }),
        );
      }
    },
    [guests, guestById, assignTransferOne, toast, t],
  );

  const deleteAccommodation = useCallback(
    async (a: Accommodation) => {
      const ok = await confirm({
        title: t("logistics.delete_accommodation_title"),
        body: t("logistics.delete_accommodation_body").replace("{name}", a.name),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await accommodationApi.remove(a.id);
        await refresh();
        toast.success(t("logistics.accommodation_deleted"));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
      }
    },
    [confirm, refresh, toast, t],
  );

  const deleteTransfer = useCallback(
    async (tr: Transfer) => {
      const ok = await confirm({
        title: t("logistics.delete_transfer_title"),
        body: t("logistics.delete_transfer_body").replace("{label}", tr.label),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await transferApi.remove(tr.id);
        await refresh();
        toast.success(t("logistics.transfer_deleted"));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
      }
    },
    [confirm, refresh, toast, t],
  );

  // ── DnD helpers ──────────────────────────────────────────────────────────
  const onDragStart = useCallback(
    (e: DragEvent<HTMLElement>, guestId: number, groupIds?: number[]) => {
      const data: DragData = { guestId, guestIds: groupIds };
      e.dataTransfer.setData("application/json", JSON.stringify(data));
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );
  const readDrag = (e: DragEvent<HTMLElement>): DragData | null => {
    try {
      const raw = e.dataTransfer.getData("application/json");
      return raw ? (JSON.parse(raw) as DragData) : null;
    } catch {
      return null;
    }
  };
  const dragGuestIds = (data: DragData): number[] =>
    data.guestIds && data.guestIds.length > 0 ? data.guestIds : [data.guestId];

  const dropOnAccommodation = (e: DragEvent<HTMLElement>, a: Accommodation) => {
    e.preventDefault();
    setHoverAccommodationId(null);
    const data = readDrag(e);
    if (!data) return;
    void assignAccommodationMany(dragGuestIds(data), a);
  };
  const dropOnTransfer = (e: DragEvent<HTMLElement>, tr: Transfer) => {
    e.preventDefault();
    setHoverTransferId(null);
    const data = readDrag(e);
    if (!data) return;
    void assignTransferMany(dragGuestIds(data), tr);
  };
  const dropOnSidebar = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setSidebarHover(false);
    const data = readDrag(e);
    if (!data) return;
    const ids = dragGuestIds(data);
    if (tab === "accommodation") {
      for (const id of ids) void assignAccommodationOne(id, null);
    } else {
      for (const id of ids) void assignTransferOne(id, null);
    }
  };

  const handleTapGuest = (g: Guest) => {
    setSelectedGuestId((cur) => (cur === g.id ? null : g.id));
  };
  const handleTapAccommodation = (a: Accommodation) => {
    if (selectedGuestId == null) return;
    void assignAccommodationMany([selectedGuestId], a);
    setSelectedGuestId(null);
  };
  const handleTapTransfer = (tr: Transfer) => {
    if (selectedGuestId == null) return;
    void assignTransferMany([selectedGuestId], tr);
    setSelectedGuestId(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("logistics.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("logistics.sub")}</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t("logistics.tabs_aria")}
          className="inline-flex rounded-lg border border-paper-300 bg-paper-100 p-0.5 dark:border-umber-700 dark:bg-umber-900"
        >
          <TabButton
            active={tab === "accommodation"}
            onClick={() => setTab("accommodation")}
            label={t("logistics.tab_accommodation")}
            icon={<Bed size={14} />}
          />
          <TabButton
            active={tab === "transfer"}
            onClick={() => setTab("transfer")}
            label={t("logistics.tab_transfer")}
            icon={<Bus size={14} />}
          />
        </div>
        <button
          type="button"
          className="btn-primary ml-auto"
          onClick={() =>
            tab === "accommodation" ? setEditingAccommodation("new") : setEditingTransfer("new")
          }
        >
          <Plus size={16} />{" "}
          {tab === "accommodation" ? t("logistics.add_accommodation") : t("logistics.add_transfer")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton variant="block" height={140} rounded="lg" />
              <Skeleton variant="block" height={140} rounded="lg" />
            </div>
          ) : tab === "accommodation" ? (
            accommodations.length === 0 ? (
              <EmptyState
                icon={<Bed size={24} className="text-ink-500 dark:text-umber-300" />}
                title={t("logistics.no_accommodations")}
                hint={t("logistics.no_accommodations_hint")}
              />
            ) : (
              <ul className="grid gap-6 pt-3 sm:grid-cols-2">
                {accommodations.map((a) => (
                  <li key={a.id}>
                    <AccommodationCard
                      accommodation={a}
                      assigned={guestsByAccommodation.get(a.id) ?? []}
                      isDropTarget={hoverAccommodationId === a.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (hoverAccommodationId !== a.id) setHoverAccommodationId(a.id);
                      }}
                      onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                        setHoverAccommodationId((cur) => (cur === a.id ? null : cur));
                      }}
                      onDrop={(e) => dropOnAccommodation(e, a)}
                      onEdit={() => setEditingAccommodation(a)}
                      onDelete={() => deleteAccommodation(a)}
                      onUnassign={(g) => assignAccommodationOne(g.id, null)}
                      onDragStartGuest={onDragStart}
                      tapArmed={tapMode && selectedGuestId !== null}
                      onTap={() => handleTapAccommodation(a)}
                      t={t}
                    />
                  </li>
                ))}
              </ul>
            )
          ) : transfers.length === 0 ? (
            <EmptyState
              icon={<Bus size={24} className="text-ink-500 dark:text-umber-300" />}
              title={t("logistics.no_transfers")}
              hint={t("logistics.no_transfers_hint")}
            />
          ) : (
            <TransferTable
              transfers={transfers}
              guestsByTransfer={guestsByTransfer}
              hoverTransferId={hoverTransferId}
              setHoverTransferId={setHoverTransferId}
              onDrop={dropOnTransfer}
              onEdit={(tr) => setEditingTransfer(tr)}
              onDelete={deleteTransfer}
              onUnassign={(g) => assignTransferOne(g.id, null)}
              onDragStartGuest={onDragStart}
              tapArmed={tapMode && selectedGuestId !== null}
              onTapTransfer={handleTapTransfer}
              t={t}
            />
          )}
        </section>

        <aside
          className={`card sticky top-20 self-start transition-colors ${
            sidebarHover ? "ring-2 ring-blush-500 bg-blush-50 dark:bg-blush-400/15" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!sidebarHover) setSidebarHover(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setSidebarHover(false);
          }}
          onDrop={dropOnSidebar}
        >
          <h2 className="text-lg">{t("logistics.sidebar_title")}</h2>
          <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
            {t(
              tab === "accommodation"
                ? "logistics.sidebar_help_accommodation"
                : "logistics.sidebar_help_transfer",
            )}
          </p>
          {tapMode && (
            <div className="mt-3 rounded-lg border border-blush-200 bg-blush-50 px-3 py-2 text-xs text-blush-900 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300">
              {selectedGuestId !== null
                ? t("logistics.tap_place_hint").replace(
                    "{guest}",
                    guestById.get(selectedGuestId)?.full_name ?? "",
                  )
                : t("logistics.tap_select_help")}
            </div>
          )}
          {!coarsePointer && (
            <button
              type="button"
              className="btn-outline btn-sm mt-3"
              onClick={() => {
                setTapModeUser((v) => !v);
                setSelectedGuestId(null);
              }}
              aria-pressed={tapModeUser}
            >
              {tapModeUser ? t("logistics.tap_mode_off") : t("logistics.tap_mode_on")}
            </button>
          )}
          {unassignedEntries.length === 0 && partnerSlots.length === 0 ? (
            <p className="mt-4 text-sm text-ink-600 dark:text-umber-200">
              {t("logistics.sidebar_empty")}
            </p>
          ) : (
            <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
              {partnerSlots.map((slot) =>
                slot.guest ? (
                  <li key={slot.role}>
                    <DraggableGuestRow
                      guest={slot.guest}
                      onDragStart={onDragStart}
                      tapMode={tapMode}
                      selected={selectedGuestId === slot.guest.id}
                      onTap={() => slot.guest && handleTapGuest(slot.guest)}
                      partnerRole={slot.role}
                    />
                  </li>
                ) : (
                  <li key={slot.role}>
                    <PartnerSlotPlaceholder
                      role={slot.role}
                      name={slot.name}
                      hint={t("logistics.partner_placeholder_hint")}
                    />
                  </li>
                ),
              )}
              {unassignedEntries.map((entry) =>
                entry.kind === "household" ? (
                  <li key={`h${entry.householdId}`}>
                    <HouseholdGroup
                      householdId={entry.householdId}
                      guests={entry.guests}
                      onDragStart={onDragStart}
                      onUnlink={(id) =>
                        setUnlinkedHouseholds((prev) => {
                          const next = new Set(prev);
                          next.add(id);
                          return next;
                        })
                      }
                      tapMode={tapMode}
                      selectedGuestId={selectedGuestId}
                      onTapGuest={handleTapGuest}
                      unlinkLabel={t("logistics.household_unlink")}
                      ariaLabel={t("logistics.household_linked_aria", {
                        n: String(entry.guests.length),
                      })}
                    />
                  </li>
                ) : (
                  <li key={entry.guest.id}>
                    <DraggableGuestRow
                      guest={entry.guest}
                      onDragStart={onDragStart}
                      tapMode={tapMode}
                      selected={selectedGuestId === entry.guest.id}
                      onTap={() => handleTapGuest(entry.guest)}
                      relinkable={
                        entry.guest.household_id != null &&
                        unlinkedHouseholds.has(entry.guest.household_id) &&
                        unassigned.filter((g) => g.household_id === entry.guest.household_id)
                          .length >= 2
                      }
                      onRelink={() =>
                        entry.guest.household_id != null &&
                        setUnlinkedHouseholds((prev) => {
                          if (!prev.has(entry.guest.household_id!)) return prev;
                          const next = new Set(prev);
                          next.delete(entry.guest.household_id!);
                          return next;
                        })
                      }
                      relinkLabel={t("logistics.household_relink")}
                    />
                  </li>
                ),
              )}
            </ul>
          )}
        </aside>
      </div>

      {editingAccommodation !== null && (
        <AccommodationDialog
          initial={editingAccommodation === "new" ? null : editingAccommodation}
          onClose={() => setEditingAccommodation(null)}
          onSaved={async () => {
            setEditingAccommodation(null);
            await refresh();
          }}
        />
      )}

      {editingTransfer !== null && (
        <TransferDialog
          initial={editingTransfer === "new" ? null : editingTransfer}
          onClose={() => setEditingTransfer(null)}
          onSaved={async () => {
            setEditingTransfer(null);
            await refresh();
          }}
        />
      )}
    </AppShell>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white text-ink-900 shadow-sm dark:bg-umber-700 dark:text-paper-100"
          : "text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="card stationery text-center">
      <div className="mx-auto">{icon}</div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">{hint}</p>
    </div>
  );
}

function DraggableGuestRow({
  guest,
  onDragStart,
  groupIds,
  compact = false,
  tapMode = false,
  selected = false,
  onTap,
  relinkable = false,
  onRelink,
  relinkLabel,
  partnerRole,
}: {
  guest: Guest;
  onDragStart: (e: DragEvent<HTMLElement>, guestId: number, groupIds?: number[]) => void;
  groupIds?: number[];
  compact?: boolean;
  tapMode?: boolean;
  selected?: boolean;
  onTap?: () => void;
  relinkable?: boolean;
  onRelink?: () => void;
  relinkLabel?: string;
  /** Set on the pinned bride/groom rows so the leading icon flips from
   *  a generic user silhouette to the host Crown. */
  partnerRole?: "bride" | "groom" | null;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, guest.id, groupIds)}
      onClick={(e) => {
        if (!tapMode || !onTap) return;
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        onTap();
      }}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors ${
        selected
          ? "border-blush-500 bg-blush-50 ring-2 ring-blush-400 dark:border-blush-400 dark:bg-blush-400/15"
          : "border-paper-300 bg-paper-100 hover:border-blush-300 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-blush-400/60"
      } ${tapMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} ${
        compact ? "py-1" : ""
      }`}
    >
      {partnerRole ? (
        <Crown size={14} className="shrink-0 text-blush-600 dark:text-blush-300" aria-hidden />
      ) : (
        <User size={14} className="shrink-0 text-ink-500 dark:text-umber-300" aria-hidden />
      )}
      <span className="flex-1 truncate">{guest.full_name}</span>
      {relinkable && onRelink && relinkLabel && (
        <button
          type="button"
          onClick={onRelink}
          aria-label={relinkLabel}
          title={relinkLabel}
          className="rounded p-0.5 text-ink-400 hover:bg-paper-200 hover:text-blush-600 dark:text-umber-300 dark:hover:bg-umber-700"
        >
          <Link2 size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Pinned slot for a bride / groom when no matching guest row exists yet.
 *  Not draggable — purely a placeholder that keeps the reserved spot visible
 *  at the top of the sidebar so the couple sees "this is where I'll go"
 *  before they (or their partner) are added to the guest list. */
function PartnerSlotPlaceholder({
  role,
  name,
  hint,
}: {
  role: "bride" | "groom";
  name: string;
  hint: string;
}) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-dashed border-blush-300 bg-blush-50/70 px-2 py-1.5 dark:border-blush-400/40 dark:bg-blush-400/15"
      role="presentation"
      aria-label={`${role}: ${name}`}
    >
      <Crown size={14} aria-hidden className="mt-0.5 text-blush-600 dark:text-blush-300" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">{name}</p>
        <p className="text-[11px] text-ink-500 dark:text-umber-300">{hint}</p>
      </div>
    </div>
  );
}

/** Linked-household card. Vertical blush rail visually ties members together;
 *  every member row is independently draggable and carries the whole
 *  `groupIds` payload so a single drag spreads the party. Unlink2 breaks the
 *  group apart for this session. Mirrors SeatingPage's HouseholdGroup. */
function HouseholdGroup({
  householdId,
  guests,
  onDragStart,
  onUnlink,
  tapMode,
  selectedGuestId,
  onTapGuest,
  unlinkLabel,
  ariaLabel,
}: {
  householdId: number;
  guests: Guest[];
  onDragStart: (e: DragEvent<HTMLElement>, guestId: number, groupIds?: number[]) => void;
  onUnlink: (id: number) => void;
  tapMode: boolean;
  selectedGuestId: number | null;
  onTapGuest: (g: Guest) => void;
  unlinkLabel: string;
  ariaLabel: string;
}) {
  const groupIds = guests.map((g) => g.id);
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative rounded-lg border border-paper-300 bg-paper-50 pl-3 pr-2 py-2 transition-colors hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
    >
      <span
        aria-hidden
        className="absolute left-1.5 top-2 bottom-2 w-0.5 rounded-full bg-blush-400 dark:bg-blush-400/70"
      />
      <div className="flex items-start justify-between gap-2">
        <span className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
          <Link2 size={12} aria-hidden className="text-blush-600 dark:text-blush-300" />
          {guests.length}
        </span>
        <button
          type="button"
          onClick={() => onUnlink(householdId)}
          aria-label={unlinkLabel}
          title={unlinkLabel}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-400 hover:bg-paper-200 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
        >
          <Unlink2 size={12} aria-hidden />
        </button>
      </div>
      <ul className="mt-1 space-y-1">
        {guests.map((g) => (
          <li key={g.id}>
            <DraggableGuestRow
              guest={g}
              onDragStart={onDragStart}
              groupIds={groupIds}
              compact
              tapMode={tapMode}
              selected={selectedGuestId === g.id}
              onTap={() => onTapGuest(g)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssignedGuestChip({
  guest,
  onUnassign,
  onDragStart,
}: {
  guest: Guest;
  onUnassign: (g: Guest) => void;
  onDragStart: (e: DragEvent<HTMLElement>, guestId: number, groupIds?: number[]) => void;
}) {
  return (
    <span
      draggable
      onDragStart={(e) => onDragStart(e, guest.id)}
      className="inline-flex cursor-grab items-center gap-1 rounded-full bg-paper-200 px-2 py-0.5 text-xs active:cursor-grabbing dark:bg-umber-700"
    >
      <span className="truncate max-w-[120px]">{guest.full_name}</span>
      <button
        type="button"
        onClick={() => onUnassign(guest)}
        className="rounded-full p-0.5 hover:bg-paper-300 dark:hover:bg-umber-600"
        aria-label="Eltávolítás"
      >
        <X size={11} />
      </button>
    </span>
  );
}

/** House-shaped accommodation card. The article is clip-path'd into a
 *  classic házikó silhouette (triangular roof above a rectangular body) so
 *  the surface reads as "a place to stay" at a glance. The roof zone gets a
 *  warmer blush tint to set it visually apart from the body; both areas are
 *  inside the same drop target so dragging onto either accepts the guest.
 *  The drop is refused outright when `assigned.length >= capacity` — the
 *  parent's `assignAccommodationMany` toasts the reason. */
function AccommodationCard({
  accommodation,
  assigned,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onEdit,
  onDelete,
  onUnassign,
  onDragStartGuest,
  tapArmed,
  onTap,
  t,
}: {
  accommodation: Accommodation;
  assigned: Guest[];
  isDropTarget: boolean;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onEdit: () => void;
  onDelete: () => void;
  onUnassign: (g: Guest) => void;
  onDragStartGuest: (e: DragEvent<HTMLElement>, guestId: number, groupIds?: number[]) => void;
  tapArmed: boolean;
  onTap: () => void;
  t: (k: string) => string;
}) {
  const full = assigned.length >= accommodation.capacity;
  // Top apex centered (50% 0%), roof eaves at 26% down on both sides, then
  // straight down to the bottom corners. Apex sits at 50% so a future
  // chimney could be added on either side of it.
  const houseClip = "polygon(50% 0%, 100% 26%, 100% 100%, 0% 100%, 0% 26%)";
  return (
    <article
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={(e) => {
        if (!tapArmed) return;
        const target = e.target as HTMLElement;
        if (target.closest("button") || target.closest("a")) return;
        onTap();
      }}
      style={{ clipPath: houseClip }}
      aria-label={accommodation.name}
      className={`relative flex h-full min-h-[280px] flex-col bg-paper-50 shadow-soft transition-colors dark:bg-umber-800 ${
        isDropTarget
          ? full
            ? "ring-4 ring-rose-400/70"
            : "ring-4 ring-blush-500"
          : full
            ? "ring-2 ring-rose-300/60"
            : ""
      } ${tapArmed ? "cursor-pointer ring-2 ring-blush-300 ring-dashed dark:ring-blush-400/40" : ""}`}
    >
      {/* Roof tint — the top 28% gets a blush wash so the triangular roof
          reads as a distinct surface from the body. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[28%] bg-blush-200 dark:bg-blush-400/30"
      />
      {/* Content sits inside a safe rectangle below the roof slope so titles
          and chips never collide with the clip edges. pt-16 ≈ the roof's
          tallest pixel + breathing room. */}
      <div className="relative flex flex-1 flex-col gap-3 px-5 pb-5 pt-16">
        <header className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold">{accommodation.name}</h3>
            {accommodation.address && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
                <MapPin size={11} aria-hidden />
                <span className="truncate">{accommodation.address}</span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md p-1.5 text-ink-500 hover:bg-paper-200 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
              aria-label={t("common.edit")}
              title={t("common.edit")}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md p-1.5 text-ink-500 hover:bg-paper-200 hover:text-rose-600 dark:text-umber-300 dark:hover:bg-umber-700"
              aria-label={t("common.delete")}
              title={t("common.delete")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </header>

        <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-600 dark:text-umber-200">
          <div className="inline-flex items-center gap-1">
            <Users size={11} aria-hidden />
            <span className={full ? "font-semibold text-rose-600 dark:text-rose-400" : undefined}>
              {assigned.length}/{accommodation.capacity}
            </span>
          </div>
          {accommodation.price_huf !== null && (
            <div>
              <span className="font-medium">{formatHuf(accommodation.price_huf)}</span>
            </div>
          )}
          {accommodation.contact && (
            <div className="inline-flex items-center gap-1">
              <Phone size={11} aria-hidden />
              <span className="truncate">{accommodation.contact}</span>
            </div>
          )}
          {accommodation.link && (
            <a
              href={accommodation.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blush-700 hover:underline dark:text-blush-300"
            >
              <ExternalLink size={11} aria-hidden />
              {t("logistics.link")}
            </a>
          )}
        </dl>

        <div
          className={`min-h-[44px] flex-1 rounded-md border border-dashed p-2 ${
            full
              ? "border-rose-300 bg-rose-50/40 dark:border-rose-400/40 dark:bg-rose-400/10"
              : "border-paper-300 dark:border-umber-700"
          }`}
        >
          {assigned.length === 0 ? (
            <p className="text-center text-xs text-ink-400 dark:text-umber-400">
              {t("logistics.drop_guest_here")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {assigned.map((g) => (
                <AssignedGuestChip
                  key={g.id}
                  guest={g}
                  onUnassign={onUnassign}
                  onDragStart={onDragStartGuest}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function TransferTable({
  transfers,
  guestsByTransfer,
  hoverTransferId,
  setHoverTransferId,
  onDrop,
  onEdit,
  onDelete,
  onUnassign,
  onDragStartGuest,
  tapArmed,
  onTapTransfer,
  t,
}: {
  transfers: Transfer[];
  guestsByTransfer: Map<number, Guest[]>;
  hoverTransferId: number | null;
  setHoverTransferId: (id: number | null) => void;
  onDrop: (e: DragEvent<HTMLElement>, tr: Transfer) => void;
  onEdit: (tr: Transfer) => void;
  onDelete: (tr: Transfer) => void;
  onUnassign: (g: Guest) => void;
  onDragStartGuest: (e: DragEvent<HTMLElement>, guestId: number, groupIds?: number[]) => void;
  tapArmed: boolean;
  onTapTransfer: (tr: Transfer) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-paper-300 bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-500 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-300">
            <th className="px-3 py-2">{t("logistics.transfer_label")}</th>
            <th className="px-3 py-2">{t("logistics.transfer_direction")}</th>
            <th className="px-3 py-2">{t("logistics.transfer_depart_at")}</th>
            <th className="px-3 py-2">{t("logistics.transfer_capacity")}</th>
            <th className="px-3 py-2">{t("logistics.transfer_assigned")}</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((tr) => {
            const assigned = guestsByTransfer.get(tr.id) ?? [];
            const full = tr.capacity !== null && assigned.length >= tr.capacity;
            return (
              <tr
                key={tr.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (hoverTransferId !== tr.id) setHoverTransferId(tr.id);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  if (hoverTransferId === tr.id) setHoverTransferId(null);
                }}
                onDrop={(e) => onDrop(e, tr)}
                onClick={(e) => {
                  if (!tapArmed) return;
                  const target = e.target as HTMLElement;
                  if (target.closest("button") || target.closest("a")) return;
                  onTapTransfer(tr);
                }}
                className={`border-b border-paper-200 last:border-b-0 dark:border-umber-700 ${
                  hoverTransferId === tr.id
                    ? full
                      ? "bg-rose-50 dark:bg-rose-400/10"
                      : "bg-blush-50 dark:bg-blush-400/15"
                    : ""
                } ${tapArmed ? "cursor-pointer hover:bg-blush-50/60 dark:hover:bg-blush-400/10" : ""}`}
              >
                <td className="px-3 py-2 align-top font-medium">{tr.label}</td>
                <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                  {tr.direction ?? "—"}
                </td>
                <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                  {tr.depart_at ? formatDepartAt(tr.depart_at) : "—"}
                </td>
                <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                  <span
                    className={full ? "font-semibold text-rose-600 dark:text-rose-400" : undefined}
                  >
                    {assigned.length}
                    {tr.capacity !== null ? `/${tr.capacity}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  {assigned.length === 0 ? (
                    <span className="text-xs text-ink-400 dark:text-umber-400">
                      {t("logistics.drop_guest_here")}
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {assigned.map((g) => (
                        <AssignedGuestChip
                          key={g.id}
                          guest={g}
                          onUnassign={onUnassign}
                          onDragStart={onDragStartGuest}
                        />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(tr)}
                      className="rounded-md p-1.5 text-ink-500 hover:bg-paper-200 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700"
                      aria-label={t("common.edit")}
                      title={t("common.edit")}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(tr)}
                      className="rounded-md p-1.5 text-ink-500 hover:bg-paper-200 hover:text-rose-600 dark:text-umber-300 dark:hover:bg-umber-700"
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDepartAt(value: string): string {
  // "YYYY-MM-DDTHH:MM" → "YYYY-MM-DD HH:MM" for display.
  return value.replace("T", " ");
}

// ── Dialogs ───────────────────────────────────────────────────────────────

function AccommodationDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Accommodation | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [capacity, setCapacity] = useState<string>(String(initial?.capacity ?? 2));
  const [priceHuf, setPriceHuf] = useState<string>(
    initial?.price_huf != null ? String(initial.price_huf) : "",
  );
  const [link, setLink] = useState(initial?.link ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("logistics.name_required"));
      return;
    }
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      toast.error(t("logistics.capacity_invalid"));
      return;
    }
    const price = priceHuf.trim() === "" ? null : Number(priceHuf);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      toast.error(t("logistics.price_invalid"));
      return;
    }
    const body: UpsertAccommodationInput = {
      name: trimmed,
      address: address.trim() || null,
      capacity: cap,
      price_huf: price,
      link: link.trim() || null,
      contact: contact.trim() || null,
      notes: notes.trim() || null,
    };
    setSubmitting(true);
    try {
      if (initial) await accommodationApi.update(initial.id, body);
      else await accommodationApi.create(body);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={initial ? t("logistics.edit_accommodation") : t("logistics.add_accommodation")}
      onClose={onClose}
      closeOnBackdrop
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label={t("logistics.name")}>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label={t("logistics.address")}>
          <input
            type="text"
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("logistics.capacity")}>
            <input
              type="number"
              min={1}
              max={100}
              className="input"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </Field>
          <Field label={t("logistics.price_huf")}>
            <input
              type="number"
              min={0}
              step={1000}
              className="input"
              value={priceHuf}
              onChange={(e) => setPriceHuf(e.target.value)}
              placeholder="—"
            />
          </Field>
        </div>
        <Field label={t("logistics.link")}>
          <input
            type="url"
            className="input"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Field label={t("logistics.contact")}>
          <input
            type="text"
            className="input"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={t("logistics.contact_placeholder")}
          />
        </Field>
        <Field label={t("logistics.notes")}>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function TransferDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Transfer | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [direction, setDirection] = useState(initial?.direction ?? "");
  const [departAt, setDepartAt] = useState(initial?.depart_at ?? "");
  const [capacity, setCapacity] = useState<string>(
    initial?.capacity != null ? String(initial.capacity) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error(t("logistics.label_required"));
      return;
    }
    const cap = capacity.trim() === "" ? null : Number(capacity);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
      toast.error(t("logistics.capacity_invalid"));
      return;
    }
    const body: UpsertTransferInput = {
      label: trimmed,
      direction: direction.trim() || null,
      depart_at: departAt.trim() || null,
      capacity: cap,
      notes: notes.trim() || null,
    };
    setSubmitting(true);
    try {
      if (initial) await transferApi.update(initial.id, body);
      else await transferApi.create(body);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={initial ? t("logistics.edit_transfer") : t("logistics.add_transfer")}
      onClose={onClose}
      closeOnBackdrop
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label={t("logistics.transfer_label")}>
          <input
            type="text"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("logistics.transfer_label_placeholder")}
            autoFocus
          />
        </Field>
        <Field label={t("logistics.transfer_direction")}>
          <input
            type="text"
            className="input"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder={t("logistics.transfer_direction_placeholder")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("logistics.transfer_depart_at")}>
            <input
              type="datetime-local"
              className="input"
              value={departAt}
              onChange={(e) => setDepartAt(e.target.value)}
            />
          </Field>
          <Field label={t("logistics.transfer_capacity")}>
            <input
              type="number"
              min={1}
              max={200}
              className="input"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="—"
            />
          </Field>
        </div>
        <Field label={t("logistics.notes")}>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200">
        {label}
      </span>
      {children}
    </label>
  );
}
