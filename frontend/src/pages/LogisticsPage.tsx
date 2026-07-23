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

import type { ScheduleEvent } from "@shared/schedule";
import type {
  Accommodation,
  AccommodationRoom,
  Couple,
  Currency,
  Guest,
  Transfer,
  UpsertAccommodationInput,
  UpsertAccommodationRoomInput,
  UpsertTransferInput,
} from "@shared/types";
import {
  ArrowLeftRight,
  Banknote,
  Bed,
  Bus,
  CalendarClock,
  Crown,
  DoorOpen,
  ExternalLink,
  Gem,
  Home,
  Link2,
  MapPin,
  Minus,
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
import { InfoHint } from "../components/InfoHint";
import { Button, Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import {
  accommodationApi,
  accommodationRoomApi,
  coupleApi,
  guestApi,
  scheduleApi,
  transferApi,
} from "../lib/endpoints";
import { currencySymbol, formatHuf, intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
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
  const [rooms, setRooms] = useState<AccommodationRoom[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  // Day-of program ("Menetrend") beats — used only to suggest a sensible
  // departure time for a new transfer (outbound before the first beat, return
  // after the last). Never mutated here.
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  // The couple — fetched alongside so we can pin the host pair at the top of
  // the unassigned sidebar (matched by `partner_role`, mirroring SeatingPage).
  const [couple, setCouple] = useState<Couple | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingAccommodation, setEditingAccommodation] = useState<Accommodation | "new" | null>(
    null,
  );
  // Room dialog: either creating a room under a parent accommodation, or
  // editing an existing room. Null = closed.
  const [editingRoom, setEditingRoom] = useState<
    { mode: "new"; accommodationId: number } | { mode: "edit"; room: AccommodationRoom } | null
  >(null);
  const [editingTransfer, setEditingTransfer] = useState<Transfer | "new" | null>(null);
  const [hoverAccommodationId, setHoverAccommodationId] = useState<number | null>(null);
  const [hoverRoomId, setHoverRoomId] = useState<number | null>(null);
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
    const [acc, rm, tr, gs, c, sch] = await Promise.all([
      accommodationApi.list(),
      accommodationRoomApi.list(),
      transferApi.list(),
      guestApi.list(),
      coupleApi.current(),
      scheduleApi.list(),
    ]);
    setAccommodations(acc.accommodations);
    setRooms(rm.rooms);
    setTransfers(tr.transfers);
    setGuests(gs.guests);
    setCouple(c.couple);
    setScheduleEvents(sch.events);
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
  // Rooms grouped under their parent accommodation, and guests grouped by the
  // room they sit in. An accommodation with an entry in `roomsByAccommodation`
  // renders per-room drop zones; one without renders the flat single zone.
  const roomsByAccommodation = useMemo(() => {
    const out = new Map<number, AccommodationRoom[]>();
    for (const r of rooms) {
      const arr = out.get(r.accommodation_id) ?? [];
      arr.push(r);
      out.set(r.accommodation_id, arr);
    }
    return out;
  }, [rooms]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const guestsByRoom = useMemo(() => {
    const out = new Map<number, Guest[]>();
    for (const g of guests) {
      if (g.accommodation_room_id == null) continue;
      const arr = out.get(g.accommodation_room_id) ?? [];
      arr.push(g);
      out.set(g.accommodation_room_id, arr);
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

  // The bride and groom are one joint party — they share a room / car. When
  // BOTH partner rows exist and neither is placed yet, collapse the two pinned
  // slots into a single joint row that drags and assigns them together. Mixed
  // states (one partner missing, or one already assigned) fall back to the
  // per-role `partnerSlots` above so the remaining partner can still be placed.
  const couplePair = useMemo<{ bride: Guest; groom: Guest; name: string } | null>(() => {
    if (!couple) return null;
    const isAssigned = (g: Guest): boolean =>
      tab === "accommodation" ? g.accommodation_id != null : g.transfer_id != null;
    const bride = guests.find((g) => g.partner_role === "bride") ?? null;
    const groom = guests.find((g) => g.partner_role === "groom") ?? null;
    if (!bride || !groom || isAssigned(bride) || isAssigned(groom)) return null;
    const brideName = couple.bride_name?.trim() || t("logistics.bride_label");
    const groomName = couple.groom_name?.trim() || t("logistics.groom_label");
    return { bride, groom, name: `${brideName} & ${groomName}` };
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

  const assignRoomOne = useCallback(
    async (guestId: number, roomId: number | null): Promise<boolean> => {
      // Keep accommodation_id in lock-step with the room's parent so the
      // sidebar's "unassigned" filter (accommodation_id == null) stays correct.
      const accommodationId =
        roomId == null ? null : (roomById.get(roomId)?.accommodation_id ?? null);
      setGuests((prev) =>
        prev.map((g) =>
          g.id === guestId
            ? { ...g, accommodation_room_id: roomId, accommodation_id: accommodationId }
            : g,
        ),
      );
      try {
        await accommodationRoomApi.assign({ guest_id: guestId, room_id: roomId });
        return true;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
        await refresh();
        return false;
      }
    },
    [roomById, refresh, toast, t],
  );

  /** Capacity-aware room drop. Mirrors `assignAccommodationMany` but the cap is
   *  the room's own `capacity` and overflow is refused per room. */
  const assignRoomMany = useCallback(
    async (guestIds: number[], room: AccommodationRoom) => {
      if (guestIds.length === 0) return;
      const currentlyAssigned = guests.filter((g) => g.accommodation_room_id === room.id).length;
      const incoming = guestIds.filter((id) => {
        const g = guestById.get(id);
        return g != null && g.accommodation_room_id !== room.id;
      });
      if (incoming.length === 0) return;
      const free = Math.max(0, room.capacity - currentlyAssigned);
      if (free === 0) {
        toast.error(t("logistics.full_blocked", { name: room.name }));
        return;
      }
      const placed = incoming.slice(0, free);
      const overflow = incoming.length - placed.length;
      for (const id of placed) {
        const ok = await assignRoomOne(id, room.id);
        if (!ok) return;
      }
      if (overflow > 0) {
        toast.info(
          t("logistics.partial_placed", {
            placed: String(placed.length),
            total: String(incoming.length),
            name: room.name,
          }),
        );
      }
    },
    [guests, guestById, assignRoomOne, toast, t],
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

  const deleteRoom = useCallback(
    async (room: AccommodationRoom) => {
      const ok = await confirm({
        title: t("logistics.delete_room_title"),
        body: t("logistics.delete_room_body").replace("{name}", room.name),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await accommodationRoomApi.remove(room.id);
        await refresh();
        toast.success(t("logistics.room_deleted"));
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
  const dropOnRoom = (e: DragEvent<HTMLElement>, room: AccommodationRoom) => {
    e.preventDefault();
    e.stopPropagation();
    setHoverRoomId(null);
    setHoverAccommodationId(null);
    const data = readDrag(e);
    if (!data) return;
    void assignRoomMany(dragGuestIds(data), room);
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
      // Room-aware unassign clears both accommodation_id and the room in one
      // call, covering guests placed at either level.
      for (const id of ids) void assignRoomOne(id, null);
    } else {
      for (const id of ids) void assignTransferOne(id, null);
    }
  };

  const handleTapGuest = (g: Guest) => {
    setSelectedGuestId((cur) => (cur === g.id ? null : g.id));
  };
  // When the active tap selection is one of the joint couple's partners, place
  // both together — they render as a single joint row. Any other guest is solo.
  const tapTargetIds = (id: number): number[] =>
    couplePair && (id === couplePair.bride.id || id === couplePair.groom.id)
      ? [couplePair.bride.id, couplePair.groom.id]
      : [id];
  const handleTapAccommodation = (a: Accommodation) => {
    if (selectedGuestId == null) return;
    void assignAccommodationMany(tapTargetIds(selectedGuestId), a);
    setSelectedGuestId(null);
  };
  const handleTapRoom = (room: AccommodationRoom) => {
    if (selectedGuestId == null) return;
    void assignRoomMany(tapTargetIds(selectedGuestId), room);
    setSelectedGuestId(null);
  };
  const handleTapTransfer = (tr: Transfer) => {
    if (selectedGuestId == null) return;
    void assignTransferMany(tapTargetIds(selectedGuestId), tr);
    setSelectedGuestId(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <header className="mb-6 flex items-center gap-2">
        <h1 className="font-grotesk">{t("logistics.title")}</h1>
        <InfoHint text={t("logistics.sub")} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          {/* Tabs + action button row, now nested inside the section column so
           *  its width matches the empty-state / cards directly below it
           *  (instead of overflowing into the sidebar's column above the
           *  pinned aside). flex-1 on the tablist + flex-1 on each TabButton
           *  splits the available width 50/50; the action button keeps its
           *  intrinsic width on the right. */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label={t("logistics.tabs_aria")}
              className="flex min-w-max flex-1 rounded-lg border border-paper-400 bg-paper-100 p-0.5 dark:border-umber-600 dark:bg-umber-900"
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
              className="btn-primary"
              onClick={() =>
                tab === "accommodation" ? setEditingAccommodation("new") : setEditingTransfer("new")
              }
            >
              <Plus size={16} />{" "}
              {tab === "accommodation"
                ? t("logistics.add_accommodation")
                : t("logistics.add_transfer")}
            </button>
          </div>

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
                <ul className="grid gap-3 sm:grid-cols-2">
                  {accommodations.map((a) => (
                    <li key={a.id}>
                      <AccommodationCard
                        accommodation={a}
                        rooms={roomsByAccommodation.get(a.id) ?? []}
                        assigned={guestsByAccommodation.get(a.id) ?? []}
                        guestsByRoom={guestsByRoom}
                        isDropTarget={hoverAccommodationId === a.id}
                        hoverRoomId={hoverRoomId}
                        setHoverRoomId={setHoverRoomId}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (hoverAccommodationId !== a.id) setHoverAccommodationId(a.id);
                        }}
                        onDragLeave={(e) => {
                          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                          setHoverAccommodationId((cur) => (cur === a.id ? null : cur));
                        }}
                        onDrop={(e) => dropOnAccommodation(e, a)}
                        onDropRoom={dropOnRoom}
                        onEdit={() => setEditingAccommodation(a)}
                        onDelete={() => deleteAccommodation(a)}
                        onAddRoom={() => setEditingRoom({ mode: "new", accommodationId: a.id })}
                        onEditRoom={(room) => setEditingRoom({ mode: "edit", room })}
                        onDeleteRoom={deleteRoom}
                        onUnassign={(g) => assignRoomOne(g.id, null)}
                        onDragStartGuest={onDragStart}
                        tapArmed={tapMode && selectedGuestId !== null}
                        onTap={() => handleTapAccommodation(a)}
                        onTapRoom={handleTapRoom}
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
        </div>

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
          <h2 className="text-lg font-grotesk">{t("logistics.sidebar_title")}</h2>
          {/* Drag-language only on devices that actually drag. On a
           *  coarse-pointer device (touch / mobile) we'd previously stack
           *  the desktop "drag a guest…" copy *above* the tap callout — two
           *  contradictory instructions for the same gesture. Now the
           *  paragraph hides whenever tapMode is live and the callout
           *  carries the active-mode copy alone. */}
          {!tapMode && (
            <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
              {t(
                tab === "accommodation"
                  ? "logistics.sidebar_help_accommodation"
                  : "logistics.sidebar_help_transfer",
              )}
            </p>
          )}
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
            // pl-1.5 + pt-2 (offset by -ml-1.5 / -mt — visually identical to
            // before but the items sit inside the ul's clip region) give the
            // corner count chip on each household room to peek above + to the
            // left of its card without being chopped by overflow-y-auto's
            // implicit horizontal clipping. space-y-2 widens the gap between
            // households so the stacks read as separate parties.
            <ul className="-ml-1.5 mt-3 max-h-[60vh] space-y-2 overflow-y-auto pl-1.5 pt-2">
              {couplePair ? (
                <li key="couple">
                  <CouplePairRow
                    bride={couplePair.bride}
                    groom={couplePair.groom}
                    name={couplePair.name}
                    onDragStart={onDragStart}
                    tapMode={tapMode}
                    selected={
                      selectedGuestId === couplePair.bride.id ||
                      selectedGuestId === couplePair.groom.id
                    }
                    onTap={() => couplePair && handleTapGuest(couplePair.bride)}
                  />
                </li>
              ) : (
                partnerSlots.map((slot) =>
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
                )
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
          currency={couple?.currency ?? "HUF"}
          onClose={() => setEditingAccommodation(null)}
          onSaved={async () => {
            setEditingAccommodation(null);
            await refresh();
          }}
        />
      )}

      {editingRoom !== null && (
        <RoomDialog
          accommodationId={
            editingRoom.mode === "new"
              ? editingRoom.accommodationId
              : editingRoom.room.accommodation_id
          }
          initial={editingRoom.mode === "edit" ? editingRoom.room : null}
          onClose={() => setEditingRoom(null)}
          onSaved={async () => {
            setEditingRoom(null);
            await refresh();
          }}
        />
      )}

      {editingTransfer !== null && (
        <TransferDialog
          initial={editingTransfer === "new" ? null : editingTransfer}
          weddingDate={couple?.wedding_date ?? null}
          scheduleEvents={scheduleEvents}
          onClose={() => setEditingTransfer(null)}
          onSaved={async () => {
            setEditingTransfer(null);
            await refresh();
          }}
        />
      )}
    </>
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
      className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
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

/** Segmented "oda / vissza" toggle inside the transfer dialog — mirrors the
 *  TabButton pill styling so the control reads as a single switch. */
function DirectionButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white text-ink-900 shadow-sm dark:bg-umber-700 dark:text-paper-100"
          : "text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-100"
      }`}
    >
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
      {partnerRole === "bride" ? (
        <Gem size={14} className="shrink-0 text-blush-600 dark:text-blush-300" aria-hidden />
      ) : partnerRole === "groom" ? (
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

/** The bride + groom as one joint, draggable row. They share a room / seat in
 *  a car, so the logistics sidebar treats them as a single party: one drag
 *  carries both guest ids, and a tap-mode select places them together. Shows
 *  both host marks (Gem + Crown) and the combined "Bride & Groom" label. */
function CouplePairRow({
  bride,
  groom,
  name,
  onDragStart,
  tapMode,
  selected,
  onTap,
}: {
  bride: Guest;
  groom: Guest;
  name: string;
  onDragStart: (e: DragEvent<HTMLElement>, guestId: number, groupIds?: number[]) => void;
  tapMode: boolean;
  selected: boolean;
  onTap: () => void;
}) {
  const groupIds = [bride.id, groom.id];
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, bride.id, groupIds)}
      onClick={(e) => {
        if (!tapMode) return;
        if ((e.target as HTMLElement).closest("button")) return;
        onTap();
      }}
      aria-label={name}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors ${
        selected
          ? "border-blush-500 bg-blush-50 ring-2 ring-blush-400 dark:border-blush-400 dark:bg-blush-400/15"
          : "border-paper-300 bg-paper-100 hover:border-blush-300 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-blush-400/60"
      } ${tapMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
    >
      <span className="flex shrink-0 items-center gap-0.5 text-blush-600 dark:text-blush-300">
        <Gem size={14} aria-hidden />
        <Crown size={14} aria-hidden />
      </span>
      <span className="flex-1 truncate">{name}</span>
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
      {role === "bride" ? (
        <Gem size={14} aria-hidden className="mt-0.5 text-blush-600 dark:text-blush-300" />
      ) : (
        <Crown size={14} aria-hidden className="mt-0.5 text-blush-600 dark:text-blush-300" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">{name}</p>
        <p className="text-[11px] text-ink-500 dark:text-umber-300">{hint}</p>
      </div>
    </div>
  );
}

/** Linked-household card. Whole card is draggable — the user can grab the
 *  rail, the gaps between rows, or any of the member rows themselves, and
 *  the drag always carries the full `groupIds` payload. Per the UX review
 *  the old "header row" (chain icon + count + unlink button) used to eat
 *  ~28px of vertical space above the members and read as a separate clickable
 *  surface, making it unclear that the household could be grabbed as one
 *  unit. Both controls now hang off the top edge as compact corner badges
 *  so the member rows start right at the top of the card. */
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
  const firstGuest = guests[0];
  if (!firstGuest) return null;
  // Drag-from-anywhere: nested draggable members win when grabbed directly,
  // but starting a drag on the rail / padding / gap-between-rows lands on
  // the card and we still emit the same group payload.
  const onCardDragStart = (e: DragEvent<HTMLDivElement>) => {
    onDragStart(e, firstGuest.id, groupIds);
  };
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      draggable
      onDragStart={onCardDragStart}
      className="group relative cursor-grab rounded-lg border border-paper-300 bg-paper-50 py-1 pl-3 pr-1 transition-colors hover:border-ink-400 active:cursor-grabbing dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
    >
      {/* Left rail — visually ties the members together. */}
      <span
        aria-hidden
        className="absolute bottom-1 left-1.5 top-1 w-0.5 rounded-full bg-blush-400 dark:bg-blush-400/70"
      />
      {/* Compact count chip sitting on the top-left edge of the card.
       *  Identifies the household at a glance without taking a row. */}
      <span
        title={ariaLabel}
        className="absolute -left-1 -top-1.5 inline-flex h-4 items-center gap-0.5 rounded-full bg-blush-400 px-1.5 text-[9px] font-bold leading-none text-white shadow-sm dark:bg-blush-500"
      >
        <Link2 size={8} strokeWidth={3} aria-hidden />
        {guests.length}
      </span>
      {/* Unlink — small floating action top-right. Always semi-visible so
       *  touch users can find it; full opacity on hover/focus. The
       *  onDragStart preventDefault keeps a drag started on the button from
       *  hijacking the card's group drag. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnlink(householdId);
        }}
        onDragStart={(e) => e.preventDefault()}
        aria-label={unlinkLabel}
        title={unlinkLabel}
        className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 opacity-60 transition-opacity hover:bg-paper-200 hover:text-ink-700 hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
      >
        <Unlink2 size={11} aria-hidden />
      </button>
      <ul className="space-y-1">
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
  const { t } = useT();
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
        aria-label={t("common.remove_item", { label: guest.full_name })}
      >
        <X size={11} />
      </button>
    </span>
  );
}

/** Accommodation card — Uber-style: a crisp dark frame, a clear header, and a
 *  body that is either one flat drop zone (no rooms) or a stack of per-room
 *  drop zones (each with its own capacity limit). Guests dragged onto the card
 *  land in the relevant zone; a drop is refused once that zone is full. */
function AccommodationCard({
  accommodation,
  rooms,
  assigned,
  guestsByRoom,
  isDropTarget,
  hoverRoomId,
  setHoverRoomId,
  onDragOver,
  onDragLeave,
  onDrop,
  onDropRoom,
  onEdit,
  onDelete,
  onAddRoom,
  onEditRoom,
  onDeleteRoom,
  onUnassign,
  onDragStartGuest,
  tapArmed,
  onTap,
  onTapRoom,
  t,
}: {
  accommodation: Accommodation;
  rooms: AccommodationRoom[];
  assigned: Guest[];
  guestsByRoom: Map<number, Guest[]>;
  isDropTarget: boolean;
  hoverRoomId: number | null;
  setHoverRoomId: (id: number | null) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDropRoom: (e: DragEvent<HTMLElement>, room: AccommodationRoom) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddRoom: () => void;
  onEditRoom: (room: AccommodationRoom) => void;
  onDeleteRoom: (room: AccommodationRoom) => void;
  onUnassign: (g: Guest) => void;
  onDragStartGuest: (e: DragEvent<HTMLElement>, guestId: number, groupIds?: number[]) => void;
  tapArmed: boolean;
  onTap: () => void;
  onTapRoom: (room: AccommodationRoom) => void;
  t: (k: string) => string;
}) {
  const hasRooms = rooms.length > 0;
  const roomGuests = (id: number): Guest[] => guestsByRoom.get(id) ?? [];
  // Totals for the header meter. With rooms the cap is the sum of room caps and
  // occupancy counts guests sitting in a room. Without rooms it's the flat
  // accommodation capacity. `unroomed` catches legacy guests assigned at the
  // accommodation level before rooms were added — surfaced so they can be moved.
  const totalCap = hasRooms
    ? rooms.reduce((sum, r) => sum + r.capacity, 0)
    : accommodation.capacity;
  const occupied = hasRooms
    ? rooms.reduce((sum, r) => sum + roomGuests(r.id).length, 0)
    : assigned.length;
  const unroomed = hasRooms ? assigned.filter((g) => g.accommodation_room_id == null) : [];
  const atCapacity = totalCap > 0 && occupied === totalCap;
  const overCapacity = occupied > totalCap;

  // Accommodation-level drag handlers only apply when there are no rooms — once
  // rooms exist, guests must land in a specific room, so the card itself is not
  // a drop target (each RoomDropZone handles its own drop + stopPropagation).
  const cardDropProps = hasRooms ? {} : { onDragOver, onDragLeave, onDrop };

  return (
    <article
      {...cardDropProps}
      onClick={(e) => {
        if (!tapArmed || hasRooms) return;
        const target = e.target as HTMLElement;
        if (target.closest("button") || target.closest("a")) return;
        onTap();
      }}
      aria-label={accommodation.name}
      className={`card relative flex h-full flex-col gap-3 border-2 border-ink-900 shadow-none transition-colors dark:border-umber-500 ${
        isDropTarget && !hasRooms
          ? overCapacity
            ? "ring-2 ring-rose-400"
            : atCapacity
              ? "ring-2 ring-emerald-500 bg-emerald-50/40 dark:bg-emerald-400/10"
              : "ring-2 ring-blush-500 bg-blush-50/40 dark:bg-blush-400/10"
          : ""
      } ${!hasRooms && tapArmed ? "cursor-pointer ring-2 ring-blush-300 ring-dashed dark:ring-blush-400/40" : ""}`}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-base font-semibold">
            <Home size={14} aria-hidden className="shrink-0 text-ink-700 dark:text-umber-200" />
            <span className="truncate">{accommodation.name}</span>
          </h3>
          {accommodation.address && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
              <MapPin size={11} aria-hidden className="shrink-0" />
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
          <span
            className={
              overCapacity
                ? "font-semibold text-rose-600 dark:text-rose-400"
                : atCapacity
                  ? "font-semibold text-emerald-700 dark:text-emerald-400"
                  : undefined
            }
          >
            {occupied}/{totalCap}
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
        {accommodation.link && /^https?:\/\//i.test(accommodation.link) && (
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

      {hasRooms ? (
        <div className="flex flex-1 flex-col gap-2">
          <ul className="grid gap-2">
            {rooms.map((room) => (
              <li key={room.id}>
                <RoomDropZone
                  room={room}
                  assigned={roomGuests(room.id)}
                  isDropTarget={hoverRoomId === room.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (hoverRoomId !== room.id) setHoverRoomId(room.id);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    setHoverRoomId(hoverRoomId === room.id ? null : hoverRoomId);
                  }}
                  onDrop={(e) => onDropRoom(e, room)}
                  onEdit={() => onEditRoom(room)}
                  onDelete={() => onDeleteRoom(room)}
                  onUnassign={onUnassign}
                  onDragStartGuest={onDragStartGuest}
                  tapArmed={tapArmed}
                  onTap={() => onTapRoom(room)}
                  t={t}
                />
              </li>
            ))}
          </ul>
          {unroomed.length > 0 && (
            <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-2 dark:border-amber-400/40 dark:bg-amber-400/10">
              <p className="mb-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {t("logistics.unroomed_label")}
              </p>
              <div className="flex flex-wrap gap-1">
                {unroomed.map((g) => (
                  <AssignedGuestChip
                    key={g.id}
                    guest={g}
                    onUnassign={onUnassign}
                    onDragStart={onDragStartGuest}
                  />
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onAddRoom}
            className="btn-outline btn-sm mt-auto self-start"
          >
            <Plus size={14} aria-hidden /> {t("logistics.add_room")}
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2">
          <div
            className={`min-h-[44px] flex-1 rounded-md border border-dashed p-2 ${
              overCapacity
                ? "border-rose-300 bg-rose-50/40 dark:border-rose-400/40 dark:bg-rose-400/10"
                : atCapacity
                  ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-400/40 dark:bg-emerald-400/10"
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
          <button
            type="button"
            onClick={onAddRoom}
            className="inline-flex items-center gap-1 self-start text-xs font-medium text-ink-500 hover:text-blush-600 dark:text-umber-300 dark:hover:text-blush-300"
          >
            <Plus size={12} aria-hidden /> {t("logistics.add_room")}
          </button>
        </div>
      )}
    </article>
  );
}

/** One room inside an accommodation card. Its own drop target with a hard
 *  per-room capacity limit (the parent's `assignRoomMany` refuses overflow).
 *  `stopPropagation` on drop keeps the event from bubbling to the card. */
function RoomDropZone({
  room,
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
  room: AccommodationRoom;
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
  const atCapacity = assigned.length === room.capacity;
  const overCapacity = assigned.length > room.capacity;
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={(e) => {
        if (!tapArmed) return;
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        onTap();
      }}
      className={`group/room rounded-lg border p-2 transition-colors ${
        isDropTarget
          ? overCapacity
            ? "border-rose-400 ring-1 ring-rose-400"
            : atCapacity
              ? "border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500 dark:bg-emerald-400/10"
              : "border-blush-500 bg-blush-50/50 ring-1 ring-blush-500 dark:bg-blush-400/10"
          : "border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-900/50"
      } ${tapArmed ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink-800 dark:text-paper-100">
          <DoorOpen size={13} aria-hidden className="shrink-0 text-ink-500 dark:text-umber-300" />
          <span className="truncate">{room.name}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              overCapacity
                ? "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300"
                : atCapacity
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
                  : "bg-paper-200 text-ink-700 dark:bg-umber-700 dark:text-paper-200"
            }`}
          >
            {assigned.length}/{room.capacity}
          </span>
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1 text-ink-400 opacity-60 hover:bg-paper-200 hover:text-ink-900 hover:opacity-100 dark:text-umber-300 dark:hover:bg-umber-700"
            aria-label={t("common.edit")}
            title={t("common.edit")}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-ink-400 opacity-60 hover:bg-paper-200 hover:text-rose-600 hover:opacity-100 dark:text-umber-300 dark:hover:bg-umber-700"
            aria-label={t("common.delete")}
            title={t("common.delete")}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="mt-1.5 min-h-[28px]">
        {assigned.length === 0 ? (
          <p className="text-[11px] text-ink-400 dark:text-umber-400">
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
  // Shared per-row state used by both the desktop `<table>` and the mobile
  // card stack — keeps capacity colouring + assignment lookups consistent.
  const rowsForRender = transfers.map((tr) => {
    const assigned = guestsByTransfer.get(tr.id) ?? [];
    const atCapacity = tr.capacity !== null && assigned.length === tr.capacity;
    const overCapacity = tr.capacity !== null && assigned.length > tr.capacity;
    return { tr, assigned, atCapacity, overCapacity };
  });

  return (
    <>
      {/* Mobile card stack — the 6-column table was illegible on phones
       *  (cells clipped at ~10rem, direction text cut mid-word). Cards
       *  put label + capacity badge as the header, direction + depart
       *  underneath, and the guest chips full-width below. */}
      <ul className="space-y-3 md:hidden">
        {rowsForRender.map(({ tr, assigned, atCapacity, overCapacity }) => (
          <li
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
            className={`card border-2 border-ink-900 p-4 shadow-none transition-colors dark:border-umber-500 ${
              hoverTransferId === tr.id
                ? overCapacity
                  ? "bg-rose-50 dark:bg-rose-400/10"
                  : atCapacity
                    ? "bg-emerald-50 dark:bg-emerald-400/10"
                    : "bg-blush-50 dark:bg-blush-400/15"
                : ""
            } ${tapArmed ? "cursor-pointer" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900 dark:text-paper-50">{tr.label}</p>
                <p className="mt-0.5 text-xs text-ink-600 dark:text-umber-200">
                  {directionLabel(t, tr.direction)}
                </p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-umber-300">
                  {tr.depart_at ? formatDepartAt(tr.depart_at) : "-"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                  overCapacity
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300"
                    : atCapacity
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
                      : "bg-paper-200 text-ink-700 dark:bg-umber-700 dark:text-paper-200"
                }`}
              >
                {assigned.length}
                {tr.capacity !== null ? `/${tr.capacity}` : ""}
              </span>
            </div>
            <div className="mt-3">
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
            </div>
            <div className="mt-3 flex justify-end gap-1">
              <button
                type="button"
                onClick={() => onEdit(tr)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-500 hover:bg-paper-200 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700"
                aria-label={t("common.edit")}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(tr)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-500 hover:bg-paper-200 hover:text-rose-600 dark:text-umber-300 dark:hover:bg-umber-700"
                aria-label={t("common.delete")}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="card hidden overflow-x-auto border-2 border-ink-900 p-0 shadow-none md:block dark:border-umber-500">
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
            {rowsForRender.map(({ tr, assigned, atCapacity, overCapacity }) => {
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
                      ? overCapacity
                        ? "bg-rose-50 dark:bg-rose-400/10"
                        : atCapacity
                          ? "bg-emerald-50 dark:bg-emerald-400/10"
                          : "bg-blush-50 dark:bg-blush-400/15"
                      : ""
                  } ${tapArmed ? "cursor-pointer hover:bg-blush-50/60 dark:hover:bg-blush-400/10" : ""}`}
                >
                  <td className="px-3 py-2 align-top font-medium">{tr.label}</td>
                  <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                    {directionLabel(t, tr.direction)}
                  </td>
                  <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                    {tr.depart_at ? formatDepartAt(tr.depart_at) : "-"}
                  </td>
                  <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                    <span
                      className={
                        overCapacity
                          ? "font-semibold text-rose-600 dark:text-rose-400"
                          : atCapacity
                            ? "font-semibold text-emerald-700 dark:text-emerald-400"
                            : undefined
                      }
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
    </>
  );
}

function formatDepartAt(value: string): string {
  // "YYYY-MM-DDTHH:MM" → "YYYY-MM-DD HH:MM" for display.
  return value.replace("T", " ");
}

/** "YYYY-MM-DDTHH:MM" → "júl. 2. 00:58" / "Jul 2, 00:58". The year is dropped
 *  deliberately: every transfer sits within days of the wedding, so it carries
 *  no information, and the full localised datetime overflowed the editor's
 *  half-width field. Falls back to the raw value if the string isn't parseable. */
function formatDepartShort(value: string, locale: Locale): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

/** Canonical transfer directions. Stored verbatim in `Transfer.direction`.
 *  Legacy free-text values (anything that isn't one of these or the HU words
 *  "oda"/"vissza") are left untouched and just render as-is. */
type TransferDirection = "outbound" | "return";

/** Buffer the suggested departure leaves before the first program beat
 *  (outbound) or after the last one ends (return). */
const TRANSFER_BUFFER_MINUTES = 60;

/** Fallbacks when the couple hasn't filled in the day-of program yet — a
 *  midday outbound and a late-evening return on the wedding day itself. */
const FALLBACK_OUTBOUND_MINUTES = 12 * 60; // 12:00
const FALLBACK_RETURN_MINUTES = 22 * 60; // 22:00

/** Map any stored direction (canonical or legacy HU) onto the toggle's two
 *  states. Unknown free text defaults to "outbound". */
function normalizeDirection(raw: string | null): TransferDirection {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "return" || v === "vissza" ? "return" : "outbound";
}

/** Localized label for a stored direction. Canonical and legacy HU values map
 *  to the translated word; any other free text renders verbatim. */
function directionLabel(t: (k: string) => string, raw: string | null): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "outbound" || v === "oda") return t("logistics.transfer_direction_outbound");
  if (v === "return" || v === "vissza") return t("logistics.transfer_direction_return");
  return raw?.trim() || "-";
}

/** Combine the wedding day (calendar) with a minutes-from-midnight offset into
 *  the local "YYYY-MM-DDTHH:MM" string the `depart_at` field expects. Date
 *  arithmetic absorbs day rollover (program beats past midnight) and any
 *  negative offset from the buffer. */
function minutesToDepartLocal(weddingDate: string, totalMinutes: number): string {
  const [y, m, d] = weddingDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const at = new Date(y, m - 1, d, 0, totalMinutes, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Suggested departure for a direction: the wedding day as the base, then
 *  outbound = a buffer before the first program beat, return = a buffer after
 *  the last beat ends. Returns "" when there's no wedding date to anchor to. */
function suggestDepartAt(
  direction: TransferDirection,
  weddingDate: string | null,
  events: ScheduleEvent[],
): string {
  if (!weddingDate) return "";
  const sorted = [...events].sort((a, b) => a.starts_at_minutes - b.starts_at_minutes);
  let minutes: number;
  if (direction === "outbound") {
    const first = sorted[0];
    minutes = first ? first.starts_at_minutes - TRANSFER_BUFFER_MINUTES : FALLBACK_OUTBOUND_MINUTES;
  } else {
    const last = sorted[sorted.length - 1];
    minutes = last
      ? last.starts_at_minutes + (last.duration_minutes ?? 0) + TRANSFER_BUFFER_MINUTES
      : FALLBACK_RETURN_MINUTES;
  }
  return minutesToDepartLocal(weddingDate, minutes);
}

// ── Dialogs ───────────────────────────────────────────────────────────────

function AccommodationDialog({
  initial,
  currency,
  onClose,
  onSaved,
}: {
  initial: Accommodation | null;
  currency: Currency;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [capacity, setCapacity] = useState<number>(initial?.capacity ?? 2);
  const [priceHuf, setPriceHuf] = useState<string>(
    initial?.price_huf != null ? String(initial.price_huf) : "",
  );
  const [link, setLink] = useState(initial?.link ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const currencyGlyph = currencySymbol(currency, locale);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("logistics.name_required"));
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
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
      capacity,
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
      <form onSubmit={onSubmit} className="space-y-4">
        <Field icon={Home} label={t("logistics.accommodation_name")}>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("logistics.accommodation_name_placeholder")}
            autoFocus
          />
        </Field>
        <Field icon={MapPin} label={t("logistics.address")}>
          <input
            type="text"
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t("logistics.address_placeholder")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field icon={Users} label={t("logistics.capacity")} help={t("logistics.capacity_help")}>
            <CapacityStepper value={capacity} onChange={setCapacity} />
          </Field>
          <Field
            icon={Banknote}
            label={t("logistics.price_label")}
            help={t("logistics.price_help")}
          >
            <div className="relative">
              <span
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-ink-500 dark:text-umber-300"
                aria-hidden
              >
                {currencyGlyph}
              </span>
              <input
                type="number"
                min={0}
                step={1000}
                className="input pl-9"
                value={priceHuf}
                onChange={(e) => setPriceHuf(e.target.value)}
                placeholder="-"
                inputMode="numeric"
              />
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field icon={Link2} label={t("logistics.link")}>
            <input
              type="url"
              className="input"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t("logistics.link_placeholder")}
            />
          </Field>
          <Field icon={Phone} label={t("logistics.contact")}>
            <input
              type="text"
              className="input"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("logistics.contact_placeholder")}
            />
          </Field>
        </div>
        <Field label={t("logistics.notes")}>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("logistics.notes_placeholder")}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** ± stepper for the capacity input. Bare number inputs read as "type a
 *  number"; couples almost always increment in 1s or 2s, so dedicated
 *  buttons turn the most common interaction into a single tap and the
 *  remaining typing path stays available. */
function CapacityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const { t } = useT();
  const clamp = (n: number) => Math.max(1, Math.min(100, n));
  return (
    <div className="inline-flex h-10 items-stretch overflow-hidden rounded-xl border border-paper-300 bg-paper-50 focus-within:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:focus-within:border-umber-600">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= 1}
        aria-label={t("common.decrement")}
        className="flex w-10 items-center justify-center text-ink-700 hover:bg-paper-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-paper-100 dark:hover:bg-umber-700"
      >
        <Minus size={14} aria-hidden />
      </button>
      <input
        type="number"
        min={1}
        max={100}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(clamp(Math.trunc(n)));
        }}
        className="w-full border-0 bg-transparent text-center text-sm font-medium text-ink-900 focus:outline-none focus:ring-0 dark:text-paper-50"
        inputMode="numeric"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= 100}
        aria-label={t("common.increment")}
        className="flex w-10 items-center justify-center text-ink-700 hover:bg-paper-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-paper-100 dark:hover:bg-umber-700"
      >
        <Plus size={14} aria-hidden />
      </button>
    </div>
  );
}

/** Add / edit a single room within an accommodation. Just a name + a capacity
 *  limit — the parent accommodation already carries address / price / contact. */
function RoomDialog({
  accommodationId,
  initial,
  onClose,
  onSaved,
}: {
  accommodationId: number;
  initial: AccommodationRoom | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [capacity, setCapacity] = useState<number>(initial?.capacity ?? 2);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("logistics.room_name_required"));
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      toast.error(t("logistics.capacity_invalid"));
      return;
    }
    setSubmitting(true);
    try {
      if (initial) {
        await accommodationRoomApi.update(initial.id, { name: trimmed, capacity });
      } else {
        await accommodationRoomApi.create({
          accommodation_id: accommodationId,
          name: trimmed,
          capacity,
        });
      }
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
      title={initial ? t("logistics.edit_room") : t("logistics.add_room")}
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
      <form onSubmit={onSubmit} className="space-y-4">
        <Field icon={DoorOpen} label={t("logistics.room_name")}>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("logistics.room_name_placeholder")}
            autoFocus
          />
        </Field>
        <Field
          icon={Users}
          label={t("logistics.capacity")}
          help={t("logistics.room_capacity_help")}
        >
          <CapacityStepper value={capacity} onChange={setCapacity} />
        </Field>
      </form>
    </Dialog>
  );
}

function TransferDialog({
  initial,
  weddingDate,
  scheduleEvents,
  onClose,
  onSaved,
}: {
  initial: Transfer | null;
  weddingDate: string | null;
  scheduleEvents: ScheduleEvent[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [direction, setDirection] = useState<TransferDirection>(
    normalizeDirection(initial?.direction ?? null),
  );
  // Suggest a departure derived from the program (outbound before the first
  // beat, return after the last). For a new transfer we prefill the suggestion;
  // editing keeps the saved value. The suggestion follows the direction toggle
  // until the planner types their own time (`departTouched`).
  const [departAt, setDepartAt] = useState(
    initial?.depart_at ?? suggestDepartAt(normalizeDirection(null), weddingDate, scheduleEvents),
  );
  const [departTouched, setDepartTouched] = useState(initial != null);
  const [capacity, setCapacity] = useState<string>(
    initial?.capacity != null ? String(initial.capacity) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  function chooseDirection(next: TransferDirection) {
    setDirection(next);
    if (!departTouched) setDepartAt(suggestDepartAt(next, weddingDate, scheduleEvents));
  }

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
      direction,
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
        <Field label={t("logistics.transfer_label")} icon={Bus}>
          <input
            type="text"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("logistics.transfer_label_placeholder")}
            autoFocus
          />
        </Field>
        <Field label={t("logistics.transfer_direction")} icon={ArrowLeftRight}>
          <div className="flex rounded-lg border border-paper-400 bg-paper-100 p-0.5 dark:border-umber-600 dark:bg-umber-900">
            <DirectionButton
              active={direction === "outbound"}
              onClick={() => chooseDirection("outbound")}
              label={t("logistics.transfer_direction_outbound")}
            />
            <DirectionButton
              active={direction === "return"}
              onClick={() => chooseDirection("return")}
              label={t("logistics.transfer_direction_return")}
            />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("logistics.transfer_depart_at")} icon={CalendarClock}>
            {/* The native control paints the full localised datetime
                ("2026. 07. 02., 00:58"), which clips in this half-width field.
                So the real input stays (picker, keyboard entry, validation) but
                renders transparently over our own short month/day/time label.
                A click opens the picker outright instead of dropping the caret
                into whichever segment happened to be under the cursor. */}
            <div className="input relative flex items-center gap-2 focus-within:border-ink-600 focus-within:ring-2 focus-within:ring-ink-100 dark:focus-within:border-blush-400 dark:focus-within:ring-blush-400/20">
              <span
                className={
                  departAt
                    ? "flex-1 truncate tabular-nums"
                    : "flex-1 truncate text-ink-400 dark:text-umber-300"
                }
              >
                {departAt ? formatDepartShort(departAt, locale) : "-"}
              </span>
              <CalendarClock
                size={15}
                aria-hidden
                className="shrink-0 text-ink-400 dark:text-umber-300"
              />
              <input
                type="datetime-local"
                aria-label={t("logistics.transfer_depart_at")}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                value={departAt}
                onClick={(e) => e.currentTarget.showPicker?.()}
                onChange={(e) => {
                  setDepartAt(e.target.value);
                  setDepartTouched(true);
                }}
              />
            </div>
          </Field>
          <Field label={t("logistics.transfer_capacity")} icon={Users}>
            <input
              type="number"
              min={1}
              max={200}
              className="input"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="-"
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

function Field({
  label,
  icon: Icon,
  help,
  children,
}: {
  label: string;
  icon?: typeof Home;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-600 dark:text-umber-200">
        {Icon && <Icon size={12} aria-hidden className="text-ink-400 dark:text-umber-300" />}
        {label}
      </span>
      {children}
      {help && (
        <span className="mt-1 block text-[11px] text-ink-500 dark:text-umber-300">{help}</span>
      )}
    </label>
  );
}
