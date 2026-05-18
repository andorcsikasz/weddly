// Seating page. Two surfaces stacked vertically:
//   1. Floor-plan map at the top — drag tables to position, click to select,
//      edit shape/seats/dimensions in the inline editor panel.
//   2. The seat-assignment grid below — drag guests onto specific seats.
// We trade pixel-perfect placement on the assignment grid for an approachable
// column layout; the map is where pixel-perfect (millimetre) layout lives,
// and that's what the PDF export consumes.

import type { Couple, Guest, SeatAssignment, SeatingTable, TableShape } from "@shared/types";
import { defaultDimsForShape, maxSeatsForTable } from "@shared/seating";
import {
  Baby,
  ChefHat,
  Circle,
  Copy,
  Crown,
  Gem,
  HelpCircle,
  LayoutGrid,
  Link2,
  Minus,
  Pencil,
  Plus,
  Printer,
  RectangleHorizontal,
  RotateCw,
  Square,
  Trash2,
  Undo2,
  Unlink2,
  User,
} from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, fetchPdfBlob, guestApi, seatingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { publish, subscribe } from "../lib/sync";
import { computeSymmetricLayout } from "./seating/layout";
import { ROOM_DIMS, SeatingMap } from "./seating/SeatingMap";

const SHAPES: TableShape[] = ["round", "long", "square", "head"];

interface DragData {
  /** Primary guest being dragged — also the head of a linked-household
   *  drag, in which case `guestIds` lists every member that should be
   *  placed (including this one) in seat order from the drop target. */
  guestId: number;
  /** Set when a *linked* household member is dragged. Drop handlers walk
   *  forward from the target seat and place each id in the next free seat,
   *  skipping occupied ones. When absent the drop is a single-guest move. */
  guestIds?: number[];
}

interface PdfPreview {
  url: string;
  filename: string;
  label: string;
}

// In-memory undo entry. Each action stores enough state to reverse itself.
// Keeping `undo` as a closure over the API call keeps the stack itself
// agnostic of the action type — the reducer never inspects it.
interface UndoAction {
  label: string;
  undo: () => Promise<void>;
}

const UNDO_STACK_LIMIT = 20;

export default function SeatingPage() {
  const { t } = useT();
  useDocumentMeta("seo.seating_title", "seo.seating_description");
  const confirm = useConfirm();
  const toast = useToast();
  const [tables, setTables] = useState<SeatingTable[]>([]);
  const [assignments, setAssignments] = useState<SeatAssignment[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  // The couple — fetched alongside the plan so we can pin the bride / groom
  // (matched by name) to the top of the unassigned guest list.
  const [couple, setCouple] = useState<Couple | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // PDF preview shown before download. Holds an object URL we revoke on close.
  const [preview, setPreview] = useState<PdfPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  // True while the user is dragging a *seated* guest, so the unassigned panel
  // can highlight itself as a drop target. Mirrored in a ref so dragend reads
  // the latest value without races.
  const [draggingSeatedId, setDraggingSeatedId] = useState<number | null>(null);
  const draggingSeatedRef = useRef<number | null>(null);
  const [unassignedHover, setUnassignedHover] = useState(false);
  // Editable canvas dimensions. Defaults to 12×9 m and persists to
  // localStorage so a refresh keeps the user's room. v2 will move this onto
  // the couples table so partners share it across devices.
  const [roomWidthMm, setRoomWidthMm] = useState<number>(ROOM_DIMS.W_MM);
  const [roomHeightMm, setRoomHeightMm] = useState<number>(ROOM_DIMS.H_MM);
  // Tap-to-place mode (forced on for coarse pointers, optional for fine ones).
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [tapModeUser, setTapModeUser] = useState(false);
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  // Tap-mode group selection: when set, a whole household is the active
  // "drop payload" and the next seat tap fills consecutive seats with all
  // its unassigned members. Mutually exclusive with selectedGuestId.
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<number | null>(null);
  // Per-session unlink toggle. Linked-by-default households (multi-member)
  // whose id appears here render flat in the unassigned panel so each
  // member can be placed individually. Reset on page reload.
  const [unlinkedHouseholds, setUnlinkedHouseholds] = useState<Set<number>>(new Set());
  const tapMode = coarsePointer || tapModeUser;
  // Undo stack. Bounded by UNDO_STACK_LIMIT — we drop the oldest action when
  // it overflows so the stack stays small and predictable.
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Pending swap/replace prompt when the target seat is already occupied.
  const [conflictPrompt, setConflictPrompt] = useState<{
    incoming: Guest;
    occupant: Guest;
    targetTableId: number;
    targetSeatIndex: number;
    sourceTableId: number | null;
    sourceSeatIndex: number | null;
  } | null>(null);

  async function refresh() {
    const [plan, gs, c] = await Promise.all([
      seatingApi.plan(),
      guestApi.list(),
      coupleApi.current(),
    ]);
    setTables(plan.tables);
    setAssignments(plan.assignments);
    setGuests(gs.guests);
    setCouple(c.couple);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Cross-tab refresh: partner B's edit in another tab pings us so we
  // refetch the plan without a hard reload.
  useEffect(() => {
    return subscribe("seating:changed", () => {
      refresh();
    });
  }, []);

  // Hydrate room dimensions from localStorage on mount. We only persist if the
  // saved values pass a sanity check — old/bad data should fall back to
  // defaults rather than blow up the canvas.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("weddly.seating.room_dims");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { w?: unknown; h?: unknown };
      const w = Number(parsed.w);
      const h = Number(parsed.h);
      if (Number.isFinite(w) && w >= 3000 && w <= 50000) setRoomWidthMm(Math.round(w));
      if (Number.isFinite(h) && h >= 3000 && h <= 50000) setRoomHeightMm(Math.round(h));
    } catch {
      /* noop — corrupt entry, keep defaults */
    }
  }, []);

  const updateRoom = useCallback((widthMm: number, heightMm: number) => {
    setRoomWidthMm(widthMm);
    setRoomHeightMm(heightMm);
    try {
      window.localStorage.setItem(
        "weddly.seating.room_dims",
        JSON.stringify({ w: widthMm, h: heightMm }),
      );
    } catch {
      /* localStorage may throw in private mode — non-fatal */
    }
  }, []);

  // Detect coarse pointer (touch). We listen for changes so a hybrid device
  // (laptop with touch input) flips correctly when the user reaches for the
  // touchscreen.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarsePointer(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    // Older Safari fallback.
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const seatedIds = useMemo(() => new Set(assignments.map((a) => a.guest_id)), [assignments]);
  // Partner role comes off the guest row directly now — backend stamps it on
  // the two host guest rows that mirror `couples.bride_name` /
  // `couples.groom_name`. Renames stay in sync via the PATCH path so the
  // marker survives bride/groom name edits. The legacy name-matching fallback
  // is gone; PartnerSlotPlaceholder still renders when a partner row is
  // missing (defensive — backfill covers the entire prod DB on next boot).
  const partnerRole = useCallback((g: Guest): "bride" | "groom" | null => g.partner_role, []);
  // Two reserved slots for the couple at the top of the unassigned panel.
  // The user shouldn't have to manually add themselves as guests — the
  // workspace already knows about them through registration + invite. We
  // always render BOTH slots; the name falls back to a localised "Bride"
  // / "Groom" label when the couple haven't entered split names yet.
  type PartnerSlot = {
    role: "bride" | "groom";
    name: string;
    guest: Guest | null;
  };
  const partnerSlots = useMemo<PartnerSlot[]>(() => {
    if (!couple) return [];
    // Three states per role:
    //   • no matching guest in the list → show the dashed placeholder hint
    //     ("Add a vendéglistához…") so the couple sees the reserved spot.
    //   • matching guest exists AND is unassigned → render as a draggable
    //     guest with the crown so they can be dropped onto a seat.
    //   • matching guest exists AND is already seated → drop the slot
    //     entirely. The crown rendered against their table seat is now the
    //     load-bearing visual; surfacing the placeholder *and* the seated
    //     row used to read as "Andor needs to be added to the guest list"
    //     even though he was already seated.
    const findByRole = (role: "bride" | "groom"): Guest | null =>
      guests.find((g) => partnerRole(g) === role) ?? null;
    const brideName = couple.bride_name?.trim() || t("seating.bride_label");
    const groomName = couple.groom_name?.trim() || t("seating.groom_label");
    const buildSlot = (role: "bride" | "groom", name: string): PartnerSlot | null => {
      const g = findByRole(role);
      if (g && seatedIds.has(g.id)) return null;
      return { role, name, guest: g };
    };
    return [buildSlot("bride", brideName), buildSlot("groom", groomName)].filter(
      (s): s is PartnerSlot => s !== null,
    );
  }, [couple, guests, seatedIds, partnerRole, t]);
  // Unassigned guests *excluding* the partners — those are rendered first
  // via partnerSlots so they don't double up.
  const unassigned = useMemo(
    () => guests.filter((g) => !seatedIds.has(g.id) && partnerRole(g) === null),
    [guests, seatedIds, partnerRole],
  );
  // Build the render order for the unassigned panel: a household with 2+
  // unassigned members (and not unlinked this session) becomes a single
  // group card; everyone else falls through as a flat row. Order matches
  // first-appearance in the unassigned array so a guest's slot doesn't
  // jump around when their household card collapses.
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
        const isLinkedGroup = siblings.length >= 2 && !unlinkedHouseholds.has(hid);
        if (isLinkedGroup) {
          // First sibling materialises the card; subsequent siblings are
          // already represented inside it, so skip them entirely (they
          // would otherwise duplicate as flat rows below the card).
          if (emitted.has(hid)) continue;
          out.push({ kind: "household", householdId: hid, guests: siblings });
          emitted.add(hid);
          continue;
        }
      }
      // Solo household, unlinked household, or household-less guest.
      out.push({ kind: "single", guest: g });
    }
    return out;
  }, [unassigned, unlinkedHouseholds]);
  // Per-table set of seat indices currently occupied by a baby guest. The
  // canvas chair render reads this to overlay a Baby icon — different from
  // the baby_seats flag (which marks a chair as "needs a high-chair"
  // independently of who's sitting there).
  const babySeatsByTable = useMemo(() => {
    const out = new Map<number, Set<number>>();
    for (const a of assignments) {
      const g = guestById.get(a.guest_id);
      if (g?.kind !== "baby") continue;
      let set = out.get(a.table_id);
      if (!set) {
        set = new Set();
        out.set(a.table_id, set);
      }
      set.add(a.seat_index);
    }
    return out;
  }, [assignments, guestById]);
  const selected = useMemo(
    () => tables.find((tb) => tb.id === selectedId) ?? null,
    [tables, selectedId],
  );

  // Look up where a guest currently sits (if anywhere). Useful for both
  // crafting reverse actions and detecting source-seat for swap flows.
  const findAssignmentForGuest = useCallback(
    (guestId: number): SeatAssignment | null =>
      assignments.find((a) => a.guest_id === guestId) ?? null,
    [assignments],
  );

  const findAssignmentAtSeat = useCallback(
    (tableId: number, seatIndex: number): SeatAssignment | null =>
      assignments.find((a) => a.table_id === tableId && a.seat_index === seatIndex) ?? null,
    [assignments],
  );

  // Stack lives in a ref so concurrent events (drop while a toast is fading)
  // can't drop entries via stale state. The visible state mirrors length so
  // the inline "Undo" button can show/hide without race risk.
  const undoStackRef = useRef<UndoAction[]>([]);
  const pushUndo = useCallback((action: UndoAction) => {
    const arr = undoStackRef.current;
    arr.push(action);
    if (arr.length > UNDO_STACK_LIMIT) arr.shift();
    setUndoStack([...arr]);
  }, []);

  const popAndUndo = useCallback(async () => {
    const action = undoStackRef.current.pop();
    setUndoStack([...undoStackRef.current]);
    if (!action) return;
    try {
      await action.undo();
      await refresh();
    } catch {
      toast.error(t("seating.undo_failed"));
    }
  }, [toast, t]);

  // Toast helper that primes the user that Cmd/Ctrl+Z (or the inline button)
  // will reverse the last action.
  const announceUndoable = useCallback(
    (message: string) => {
      const isMac =
        typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const hint = isMac ? t("seating.undo_hint_mac") : t("seating.undo_hint_pc");
      toast.success(`${message} · ${hint}`);
    },
    [toast, t],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  // Each user action is wrapped so it can register its reverse with the undo
  // stack. We snapshot the *previous* assignment for the affected guest
  // before any change so undo can return them exactly where they were.

  const assignGuest = useCallback(
    async (
      tableId: number,
      seatIndex: number,
      guestId: number,
      opts?: { silentUndo?: boolean },
    ) => {
      const previous = findAssignmentForGuest(guestId);
      try {
        await seatingApi.assign({ table_id: tableId, seat_index: seatIndex, guest_id: guestId });
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          if (previous) {
            await seatingApi.assign({
              table_id: previous.table_id,
              seat_index: previous.seat_index,
              guest_id: guestId,
            });
          } else {
            await seatingApi.unassign(guestId);
          }
        },
      });
      const guest = guestById.get(guestId);
      const table = tables.find((tb) => tb.id === tableId);
      if (!opts?.silentUndo && guest && table) {
        announceUndoable(
          t("seating.toast_assigned")
            .replace("{guest}", guest.full_name)
            .replace("{table}", table.label)
            .replace("{seat}", String(seatIndex + 1)),
        );
      }
      publish("seating:changed");
      await refresh();
    },
    [findAssignmentForGuest, guestById, tables, pushUndo, announceUndoable, t, toast],
  );

  const unassignGuest = useCallback(
    async (guestId: number, opts?: { silentUndo?: boolean }) => {
      const previous = findAssignmentForGuest(guestId);
      if (!previous) return;
      try {
        await seatingApi.unassign(guestId);
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          await seatingApi.assign({
            table_id: previous.table_id,
            seat_index: previous.seat_index,
            guest_id: guestId,
          });
        },
      });
      const guest = guestById.get(guestId);
      if (!opts?.silentUndo && guest) {
        announceUndoable(t("seating.toast_unassigned").replace("{guest}", guest.full_name));
      }
      publish("seating:changed");
      await refresh();
    },
    [findAssignmentForGuest, guestById, pushUndo, announceUndoable, t, toast],
  );

  // Compose: swap two guests between seats. The new server-side `swap`
  // endpoint does this atomically — if either half fails the transaction is
  // rolled back, so we no longer end up with a guest in limbo when the
  // network drops between the three legacy calls.
  const swapGuests = useCallback(
    async (
      incomingGuestId: number,
      occupantGuestId: number,
      targetTableId: number,
      targetSeatIndex: number,
    ) => {
      // We don't need to track the previous slot any more — `swap` is
      // symmetric, so re-issuing it is the perfect undo.
      void targetTableId;
      void targetSeatIndex;
      try {
        await seatingApi.swap({
          guest_a_id: incomingGuestId,
          guest_b_id: occupantGuestId,
        });
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          await seatingApi.swap({
            guest_a_id: incomingGuestId,
            guest_b_id: occupantGuestId,
          });
        },
      });
      const incoming = guestById.get(incomingGuestId);
      const occupant = guestById.get(occupantGuestId);
      if (incoming && occupant) {
        announceUndoable(
          t("seating.toast_swapped")
            .replace("{a}", incoming.full_name)
            .replace("{b}", occupant.full_name),
        );
      }
      publish("seating:changed");
      await refresh();
    },
    [guestById, pushUndo, announceUndoable, t, toast],
  );

  const replaceAtSeat = useCallback(
    async (
      tableId: number,
      seatIndex: number,
      incomingGuestId: number,
      occupantGuestId: number,
    ) => {
      const incomingPrev = findAssignmentForGuest(incomingGuestId);
      try {
        await seatingApi.unassign(occupantGuestId);
        await seatingApi.assign({
          table_id: tableId,
          seat_index: seatIndex,
          guest_id: incomingGuestId,
        });
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          await seatingApi.unassign(incomingGuestId);
          if (incomingPrev) {
            await seatingApi.assign({
              table_id: incomingPrev.table_id,
              seat_index: incomingPrev.seat_index,
              guest_id: incomingGuestId,
            });
          }
          await seatingApi.assign({
            table_id: tableId,
            seat_index: seatIndex,
            guest_id: occupantGuestId,
          });
        },
      });
      const incoming = guestById.get(incomingGuestId);
      const occupant = guestById.get(occupantGuestId);
      if (incoming && occupant) {
        announceUndoable(
          t("seating.toast_replaced")
            .replace("{guest}", incoming.full_name)
            .replace("{old}", occupant.full_name),
        );
      }
      publish("seating:changed");
      await refresh();
    },
    [findAssignmentForGuest, guestById, pushUndo, announceUndoable, t, toast],
  );

  // Top-level entry point: assign with conflict-detection. If the seat is
  // already occupied we open the swap/replace prompt and abort the direct
  // path — the prompt's actions then call assignGuest/swapGuests/replaceAtSeat.
  const requestAssign = useCallback(
    async (tableId: number, seatIndex: number, guestId: number) => {
      const occupant = findAssignmentAtSeat(tableId, seatIndex);
      if (!occupant || occupant.guest_id === guestId) {
        await assignGuest(tableId, seatIndex, guestId);
        return;
      }
      const incomingGuest = guestById.get(guestId);
      const occupantGuest = guestById.get(occupant.guest_id);
      if (!incomingGuest || !occupantGuest) {
        // Fall back to plain assign — server will reject if invalid.
        await assignGuest(tableId, seatIndex, guestId);
        return;
      }
      const incomingPrev = findAssignmentForGuest(guestId);
      setConflictPrompt({
        incoming: incomingGuest,
        occupant: occupantGuest,
        targetTableId: tableId,
        targetSeatIndex: seatIndex,
        sourceTableId: incomingPrev?.table_id ?? null,
        sourceSeatIndex: incomingPrev?.seat_index ?? null,
      });
    },
    [findAssignmentAtSeat, findAssignmentForGuest, guestById, assignGuest],
  );

  // Linked-household batch placement. Walks forward from the target seat
  // (and wraps to the start of the same table if needed) placing each id
  // in the next FREE seat. Skips occupied ones rather than swapping —
  // a swap would yank an unrelated guest off the table, surprising the
  // user. If we run out of free seats before placing everyone, the
  // overflow stays in unassigned and a toast reports the partial result.
  // The whole batch shares ONE undo entry so Cmd-Z restores all members.
  const placeHouseholdAtSeat = useCallback(
    async (tableId: number, startSeatIndex: number, guestIds: number[]) => {
      const table = tables.find((tb) => tb.id === tableId);
      if (!table || guestIds.length === 0) return;
      // Snapshot prior assignments so the batch undo can reverse them all
      // at once instead of relying on individual per-guest undo entries.
      const priors = new Map<number, SeatAssignment | null>();
      for (const id of guestIds) priors.set(id, findAssignmentForGuest(id));
      // Build the seat-order ring starting at startSeatIndex.
      const ring: number[] = [];
      for (let k = 0; k < table.seats; k++) ring.push((startSeatIndex + k) % table.seats);
      // Resolve target seats. Track occupancy from a live mutable copy
      // since each placement claims a seat for subsequent ones.
      const occupiedNow = new Set<number>();
      for (const a of assignments) {
        if (a.table_id !== tableId) continue;
        // A member that's already on this table can vacate its seat for the
        // batch — we'll reassign it via the placement below.
        if (guestIds.includes(a.guest_id)) continue;
        occupiedNow.add(a.seat_index);
      }
      const placements: { guestId: number; seatIndex: number }[] = [];
      let cursor = 0;
      for (const id of guestIds) {
        while (cursor < ring.length && occupiedNow.has(ring[cursor]!)) cursor++;
        if (cursor >= ring.length) break;
        placements.push({ guestId: id, seatIndex: ring[cursor]! });
        occupiedNow.add(ring[cursor]!);
        cursor++;
      }
      if (placements.length === 0) {
        toast.error(t("seating.household_no_room"));
        return;
      }
      try {
        for (const p of placements) {
          await seatingApi.assign({
            table_id: tableId,
            seat_index: p.seatIndex,
            guest_id: p.guestId,
          });
        }
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          // Reverse in opposite order so each seat is freed before the
          // next id is restored (avoids transient conflicts on the wire).
          for (const p of [...placements].reverse()) {
            const prev = priors.get(p.guestId);
            if (prev) {
              await seatingApi.assign({
                table_id: prev.table_id,
                seat_index: prev.seat_index,
                guest_id: p.guestId,
              });
            } else {
              await seatingApi.unassign(p.guestId);
            }
          }
        },
      });
      if (placements.length < guestIds.length) {
        toast.success(
          t("seating.household_placed_partial")
            .replace("{n}", String(placements.length))
            .replace("{m}", String(guestIds.length)),
        );
      } else {
        announceUndoable(
          t("seating.household_placed_all")
            .replace("{n}", String(placements.length))
            .replace("{table}", table.label),
        );
      }
      publish("seating:changed");
      await refresh();
    },
    [tables, assignments, findAssignmentForGuest, pushUndo, announceUndoable, t, toast],
  );

  async function addTable() {
    // Auto-name: scan existing labels for "<prefix> <n>" matches and pick
    // max(n)+1. Falls back to tables.length+1 if no numbered labels exist.
    const prefix = t("seating.table_default_label");
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`);
    let maxN = 0;
    for (const tb of tables) {
      const m = tb.label.match(re);
      if (m?.[1]) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxN) maxN = n;
      }
    }
    const next = maxN > 0 ? maxN + 1 : tables.length + 1;
    const label = `${prefix} ${next}`;
    // Drop new tables near the centre of the room with a small per-table
    // offset so consecutive adds don't stack on top of each other.
    const offset = (tables.length % 5) * 800;
    const res = await seatingApi.createTable({
      label,
      shape: "round",
      seats: 8,
      x_mm: roomWidthMm / 2 + offset - 1600,
      y_mm: roomHeightMm / 2,
      width_mm: 1500,
      length_mm: 1500,
    });
    setSelectedId(res.table.id);
    refresh();
  }

  async function duplicateTable(source: SeatingTable) {
    // Reuse the auto-naming logic so the copy slots into the existing
    // numbered run (Asztal 5, Asztal 6, …) rather than ending up as
    // "Asztal 2 (másolat)" sitting next to the original.
    const prefix = t("seating.table_default_label");
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`);
    let maxN = 0;
    for (const tb of tables) {
      const m = tb.label.match(re);
      if (m?.[1]) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxN) maxN = n;
      }
    }
    const next = maxN > 0 ? maxN + 1 : tables.length + 1;
    // Drop the duplicate offset to the right and below so it doesn't sit
    // exactly on top of the original table.
    const dx = 800;
    const dy = 800;
    const res = await seatingApi.createTable({
      label: `${prefix} ${next}`,
      shape: source.shape,
      seats: source.seats,
      x_mm: clampToRoom(source.x_mm + dx, roomWidthMm),
      y_mm: clampToRoom(source.y_mm + dy, roomHeightMm),
      width_mm: source.width_mm,
      length_mm: source.length_mm,
      rotation_deg: source.rotation_deg,
    });
    setSelectedId(res.table.id);
    refresh();
  }

  async function rotateTable(table: SeatingTable) {
    const next = (((table.rotation_deg + 45) % 360) + 360) % 360;
    await patchTable(table, { rotation_deg: next });
  }

  async function deleteTable(table: SeatingTable) {
    const ok = await confirm({
      title: t("seating.confirm_delete_table"),
      body: table.label,
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    await seatingApi.removeTable(table.id);
    if (selectedId === table.id) setSelectedId(null);
    refresh();
  }

  async function patchTable(table: SeatingTable, patch: Partial<SeatingTable>) {
    // Snapshot the previous values for any field being patched, so undo can
    // restore them.
    const before: Partial<SeatingTable> = {};
    for (const key of Object.keys(patch) as (keyof SeatingTable)[]) {
      (before as Record<string, unknown>)[key] = (table as unknown as Record<string, unknown>)[key];
    }
    try {
      await seatingApi.updateTable(table.id, { ...table, ...patch }, { ifMatch: table.updated_at });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("seating.save_conflict"));
      } else if (
        e instanceof ApiError &&
        e.status === 400 &&
        (e.detail as { code?: string } | undefined)?.code === "table_too_small"
      ) {
        toast.error(t("seating.table_too_small"));
      } else {
        toast.error(t("seating.save_failed"));
      }
      await refresh();
      return;
    }
    pushUndo({
      label: t("seating.undo_label"),
      undo: async () => {
        await seatingApi.updateTable(table.id, { ...table, ...before });
      },
    });
    publish("seating:changed");
    refresh();
  }

  async function moveTable(id: number, x_mm: number, y_mm: number) {
    const table = tables.find((tb) => tb.id === id);
    if (!table) return;
    if (table.x_mm === x_mm && table.y_mm === y_mm) return;
    await patchTable(table, { x_mm, y_mm });
    announceUndoable(t("seating.toast_moved").replace("{table}", table.label));
  }

  // One-click symmetric layout: head table hugs the top wall on the room's
  // vertical centreline; the remaining tables are distributed into an evenly-
  // spaced grid below it, with the last (partial) row centred so the result
  // reads balanced. Sizes and rotations are preserved — this only moves.
  async function arrangeTablesSymmetrically() {
    if (tables.length === 0) return;
    const { positions: newPos, meta } = computeSymmetricLayout({
      tables,
      roomWidthMm,
      roomHeightMm,
    });

    // Effective moves only — skip tables that already match the target spot.
    const moves: Array<{ table: SeatingTable; x_mm: number; y_mm: number }> = [];
    for (const tb of tables) {
      const next = newPos.get(tb.id);
      if (!next) continue;
      if (next.x_mm === tb.x_mm && next.y_mm === tb.y_mm) continue;
      moves.push({ table: tb, x_mm: next.x_mm, y_mm: next.y_mm });
    }
    if (moves.length === 0) return;

    // Snapshot for a single composite undo, instead of N separate entries
    // that would force the user to press ⌘Z once per table.
    const before = moves.map((m) => ({ id: m.table.id, x_mm: m.table.x_mm, y_mm: m.table.y_mm }));

    try {
      for (const m of moves) {
        await seatingApi.updateTable(
          m.table.id,
          { x_mm: m.x_mm, y_mm: m.y_mm },
          { ifMatch: m.table.updated_at },
        );
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("seating.save_conflict"));
      } else {
        toast.error(t("seating.save_failed"));
      }
      await refresh();
      return;
    }

    pushUndo({
      label: t("seating.undo_label"),
      undo: async () => {
        for (const prev of before) {
          try {
            await seatingApi.updateTable(prev.id, { x_mm: prev.x_mm, y_mm: prev.y_mm });
          } catch {
            /* surface via the refresh that popAndUndo runs */
          }
        }
      },
    });
    publish("seating:changed");
    await refresh();
    announceUndoable(t("seating.toast_arranged"));
    if (meta.crowded) toast.error(t("seating.toast_arranged_crowded"));
  }

  async function resizeTable(id: number, width_mm: number, length_mm: number) {
    const table = tables.find((tb) => tb.id === id);
    if (!table) return;
    if (table.width_mm === width_mm && table.length_mm === length_mm) return;
    // Server normalizes round/square to width == length, so just forward.
    await patchTable(table, { width_mm, length_mm });
    announceUndoable(t("seating.toast_resized").replace("{table}", table.label));
  }

  async function changeSeats(id: number, delta: number) {
    const table = tables.find((tb) => tb.id === id);
    if (!table) return;
    const cap = Math.min(40, maxSeatsForTable(table.shape, table.width_mm, table.length_mm));
    const requested = table.seats + delta;
    // User clicked + but the table is already full at the 80 cm pitch.
    // Surface the constraint as a toast so they know to widen the table
    // before adding another seat (instead of guessing why + is greyed out).
    if (delta > 0 && requested > cap) {
      toast.error(t("seating.seats_at_cap"));
      return;
    }
    const next = Math.max(1, Math.min(cap, requested));
    if (next === table.seats) return;
    await patchTable(table, { seats: next });
  }

  async function dropToSeat(tableId: number, seatIndex: number, e: DragEvent) {
    e.preventDefault();
    const data = readDragData(e);
    if (!data) return;
    // Linked-household drop: place the whole party consecutively from the
    // target seat. Single-guest drops fall through to the conflict-aware
    // requestAssign path.
    if (data.guestIds && data.guestIds.length > 1) {
      await placeHouseholdAtSeat(tableId, seatIndex, data.guestIds);
      return;
    }
    await requestAssign(tableId, seatIndex, data.guestId);
  }

  async function dropToUnassigned(e: DragEvent) {
    e.preventDefault();
    const data = readDragData(e);
    if (!data) return;
    // Linked-household drop on the unassigned panel unseat every member at
    // once. Single-guest drop unseats just that guest.
    const ids = data.guestIds && data.guestIds.length > 0 ? data.guestIds : [data.guestId];
    for (const id of ids) {
      await unassignGuest(id, { silentUndo: true });
    }
  }

  // Two-step download: fetch the PDF, show it in an in-page preview dialog,
  // and only persist to disk when the user explicitly confirms. The blob URL
  // is reused for both the iframe preview and the final download so we don't
  // round-trip the server twice.
  //
  // We thread an AbortController through so the user can bail out of a slow
  // render via the in-header "Cancel" button — previously the spinner would
  // pin the whole toolbar with no way out.
  const pdfAbortRef = useRef<AbortController | null>(null);

  async function requestDownload(path: string, filename: string, label: string) {
    if (previewLoading) return;
    setPreviewLoading(path);
    const controller = new AbortController();
    pdfAbortRef.current = controller;
    try {
      const raw = await fetchPdfBlob(path, controller.signal);
      // Explicitly type the blob so the in-browser PDF viewer always picks
      // it up — `res.blob()` should preserve Content-Type but some servers /
      // proxies strip it, and a typeless blob renders as "download" only.
      const typed =
        raw.type === "application/pdf" ? raw : raw.slice(0, raw.size, "application/pdf");
      const url = URL.createObjectURL(typed);
      setPreview({ url, filename, label });
    } catch (e) {
      // Don't shout when the user explicitly cancelled — the toast is for
      // unexpected failures (404, 500, dropped network).
      const isAbort =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      if (!isAbort) {
        toast.error(t("seating.pdf_failed"));
      }
    } finally {
      setPreviewLoading(null);
      pdfAbortRef.current = null;
    }
  }

  function cancelDownload() {
    pdfAbortRef.current?.abort();
    pdfAbortRef.current = null;
    setPreviewLoading(null);
  }

  function closePreview() {
    setPreview((cur) => {
      if (cur) URL.revokeObjectURL(cur.url);
      return null;
    });
  }

  function confirmDownload() {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview.url;
    a.download = preview.filename;
    a.click();
    closePreview();
  }

  // Drag tracking for seated guests. We expose start/end so DraggableGuest
  // doesn't need to know about page-level state. dropEffect === "none" means
  // the drop landed in empty space — we now treat that as an unassign with
  // an undo toast (per UX: silent unassign would lose work).
  function startSeatedDrag(guestId: number) {
    draggingSeatedRef.current = guestId;
    setDraggingSeatedId(guestId);
  }

  async function endSeatedDrag(e: DragEvent) {
    const guestId = draggingSeatedRef.current;
    draggingSeatedRef.current = null;
    setDraggingSeatedId(null);
    setUnassignedHover(false);
    if (!guestId) return;
    if (e.dataTransfer.dropEffect === "none") {
      await unassignGuest(guestId);
    }
  }

  // Tap-to-place handlers ────────────────────────────────────────────────────
  // Tapping a single guest tile clears any household selection (and vice
  // versa) — only one payload is "armed" at a time so the next seat tap is
  // unambiguous.
  const handleTapGuest = useCallback((guest: Guest) => {
    setSelectedHouseholdId(null);
    setSelectedGuestId((cur) => (cur === guest.id ? null : guest.id));
  }, []);

  const handleTapHousehold = useCallback((householdId: number) => {
    setSelectedGuestId(null);
    setSelectedHouseholdId((cur) => (cur === householdId ? null : householdId));
  }, []);

  const handleTapSeat = useCallback(
    async (tableId: number, seatIndex: number) => {
      if (selectedHouseholdId !== null) {
        const ids = unassigned
          .filter((g) => g.household_id === selectedHouseholdId)
          .map((g) => g.id);
        setSelectedHouseholdId(null);
        if (ids.length > 0) await placeHouseholdAtSeat(tableId, seatIndex, ids);
        return;
      }
      if (selectedGuestId === null) {
        // No guest selected — second-tap on an occupied seat selects that
        // guest so the user can move them with a single follow-up tap.
        const occ = findAssignmentAtSeat(tableId, seatIndex);
        if (occ) setSelectedGuestId(occ.guest_id);
        return;
      }
      const guestId = selectedGuestId;
      setSelectedGuestId(null);
      await requestAssign(tableId, seatIndex, guestId);
    },
    [
      selectedGuestId,
      selectedHouseholdId,
      unassigned,
      findAssignmentAtSeat,
      requestAssign,
      placeHouseholdAtSeat,
    ],
  );

  // Global keyboard handlers: Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z reserved for
  // redo (unimplemented — see Cancel; we just no-op to swallow the chord).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't interfere with text input.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        popAndUndo();
        return;
      }
      // Shortcuts cheatsheet quick-open with "?".
      if (e.key === "?" && !mod) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popAndUndo]);

  // Live-region announcement string. Updates whenever the tap-mode toggle
  // or selected-guest changes so AT users hear the new state. Stored in
  // state (not derived) so we can clear it after a beat — sr-only live
  // regions re-announce on identical content in some readers, which is
  // exactly the user-hostile behaviour we don't want here.
  const [a11yMessage, setA11yMessage] = useState("");
  useEffect(() => {
    if (selectedGuestId === null) {
      setA11yMessage(t("seating.keyboard_cleared_selection"));
      return;
    }
    const g = guestById.get(selectedGuestId);
    if (!g) return;
    setA11yMessage(t("seating.keyboard_selected_guest").replace("{guest}", g.full_name));
  }, [selectedGuestId, guestById, t]);

  return (
    <>
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {a11yMessage}
      </span>
      <header className="mb-6">
        <h1>{t("seating.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("seating.sub")}</p>
      </header>

      {/* Action toolbar sits just above the floor plan so the title + sub
          read as a clean intro, and the print/add affordances stay close
          to the thing they act on. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-outline"
          onClick={() => setShortcutsOpen(true)}
          aria-label={t("seating.shortcuts_button_label")}
          title={t("seating.shortcuts_button_label")}
        >
          <HelpCircle size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={previewLoading !== null}
          onClick={() =>
            requestDownload(
              `/api/print/seating/a4?room_w=${roomWidthMm}&room_h=${roomHeightMm}`,
              "weddly-seating-a4.pdf",
              t("seating.print_a4"),
            )
          }
          aria-label={t("seating.print_a4")}
          title={t("seating.print_a4")}
        >
          <Printer size={16} aria-hidden /> {t("seating.print_format_a4")}
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={previewLoading !== null}
          onClick={() =>
            requestDownload(
              `/api/print/seating/a3?room_w=${roomWidthMm}&room_h=${roomHeightMm}`,
              "weddly-seating-a3.pdf",
              t("seating.print_a3"),
            )
          }
          aria-label={t("seating.print_a3")}
          title={t("seating.print_a3")}
        >
          <Printer size={16} aria-hidden /> {t("seating.print_format_a3")}
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={previewLoading !== null}
          onClick={() =>
            requestDownload(
              "/api/print/place-cards",
              "weddly-place-cards.pdf",
              t("seating.print_place_cards"),
            )
          }
        >
          <Printer size={16} /> {t("seating.print_place_cards")}
        </button>
        {previewLoading !== null && (
          <button
            type="button"
            className="btn-outline"
            onClick={cancelDownload}
            aria-label={t("seating.pdf_cancel")}
          >
            {t("seating.pdf_cancel")}
          </button>
        )}
        <button
          type="button"
          className="btn-outline"
          onClick={arrangeTablesSymmetrically}
          disabled={tables.length === 0}
          aria-label={t("seating.arrange_button_label")}
          title={t("seating.arrange_button_label")}
        >
          <LayoutGrid size={16} aria-hidden />
        </button>
        <button type="button" className="btn-primary ml-auto" onClick={addTable}>
          <Plus size={16} /> {t("seating.add_table")}
        </button>
      </div>

      {tables.length === 0 ? (
        <div className="card stationery text-center">
          <ChefHat size={28} className="mx-auto text-ink-500 dark:text-umber-300" />
          <h3 className="mt-3 text-base font-semibold">{t("seating.no_tables")}</h3>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {t("seating.add_first_table")}
          </p>
        </div>
      ) : (
        <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_320px]">
          <SeatingMap
            tables={tables}
            assignments={assignments}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={moveTable}
            onResize={resizeTable}
            onSeatsChange={changeSeats}
            onDeleteTable={(id) => {
              const tbl = tables.find((tb) => tb.id === id);
              if (tbl) deleteTable(tbl);
            }}
            onAddTable={addTable}
            unassignedHighlight={draggingSeatedId !== null && unassignedHover}
            roomWidthMm={roomWidthMm}
            roomHeightMm={roomHeightMm}
            onRoomChange={updateRoom}
            babySeatsByTable={babySeatsByTable}
          />
          <TableEditor
            table={selected}
            onPatch={(patch) => selected && patchTable(selected, patch)}
            onDelete={() => selected && deleteTable(selected)}
            onDuplicate={() => selected && duplicateTable(selected)}
            onRotate={() => selected && rotateTable(selected)}
            onSeatsAtCap={() => toast.error(t("seating.seats_at_cap"))}
            t={t}
          />
        </div>
      )}

      {tables.length > 0 && (
        <div className="mb-4 mt-2 border-t border-paper-300 pt-4 dark:border-umber-700">
          <h2 className="text-base">{t("seating.assignments_section_title")}</h2>
          <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
            {t("seating.assignments_section_hint")}
          </p>
          {tapMode && (
            <div className="mt-3 rounded-lg border border-blush-200 bg-blush-50 px-3 py-2 text-xs text-blush-900 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300">
              {selectedGuestId !== null
                ? t("seating.tap_place_hint").replace(
                    "{guest}",
                    guestById.get(selectedGuestId)?.full_name ?? "",
                  )
                : t("seating.tap_select_help")}
            </div>
          )}
          <div className="mt-2 flex items-center gap-3">
            {!coarsePointer && (
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => {
                  setTapModeUser((v) => {
                    const next = !v;
                    // Announce the new state for AT users — aria-pressed
                    // alone doesn't always trigger a re-read in NVDA, so we
                    // push a fresh live-region message too.
                    setA11yMessage(
                      next ? t("seating.tap_mode_announce_on") : t("seating.tap_mode_announce_off"),
                    );
                    return next;
                  });
                  setSelectedGuestId(null);
                }}
                aria-pressed={tapModeUser}
              >
                {tapModeUser ? t("seating.tap_mode_off") : t("seating.tap_mode_on")}
              </button>
            )}
            {undoStack.length > 0 && (
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={popAndUndo}
                aria-label={t("seating.undo_action")}
              >
                <Undo2 size={14} /> {t("seating.undo_action")}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          {tables.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {tables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  assignments={assignments.filter((a) => a.table_id === table.id)}
                  guestById={guestById}
                  onDropSeat={dropToSeat}
                  onSelect={() => setSelectedId(table.id)}
                  isSelected={selectedId === table.id}
                  onSeatedDragStart={startSeatedDrag}
                  onSeatedDragEnd={endSeatedDrag}
                  tapMode={tapMode}
                  selectedGuestId={selectedGuestId}
                  onTapGuest={handleTapGuest}
                  onTapSeat={handleTapSeat}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>

        <aside
          className={`card sticky top-20 self-start transition-colors ${
            draggingSeatedId !== null
              ? unassignedHover
                ? "ring-2 ring-blush-500 bg-blush-50 dark:bg-blush-400/15"
                : "ring-2 ring-blush-300 ring-dashed dark:ring-blush-400/40"
              : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            if (draggingSeatedId !== null && !unassignedHover) setUnassignedHover(true);
          }}
          onDragLeave={(e) => {
            // Only clear when the cursor actually left the panel, not when it
            // moves between children inside.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setUnassignedHover(false);
          }}
          onDrop={(e) => {
            setUnassignedHover(false);
            dropToUnassigned(e);
          }}
        >
          <h2 className="text-lg">{t("seating.unassigned_guests")}</h2>
          <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
            {draggingSeatedId !== null
              ? unassignedHover
                ? t("seating.drop_to_unassign_active")
                : t("seating.drop_to_unassign")
              : tapMode
                ? t("seating.tap_select_help")
                : t("seating.drag_help")}
          </p>
          {unassigned.length === 0 && partnerSlots.length === 0 ? (
            <p className="mt-4 text-sm text-ink-600 dark:text-umber-200">
              {t("seating.no_unassigned")}
            </p>
          ) : (
            <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
              {partnerSlots.map((slot) =>
                slot.guest ? (
                  <li key={slot.role}>
                    <DraggableGuest
                      guest={slot.guest}
                      tapMode={tapMode}
                      selected={selectedGuestId === slot.guest.id}
                      onTap={handleTapGuest}
                      partnerRole={slot.role}
                    />
                  </li>
                ) : (
                  <li key={slot.role}>
                    <PartnerSlotPlaceholder
                      role={slot.role}
                      name={slot.name}
                      hint={t("seating.partner_placeholder_hint")}
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
                      tapMode={tapMode}
                      selected={selectedHouseholdId === entry.householdId}
                      onTap={handleTapHousehold}
                      onUnlink={(id) => {
                        setUnlinkedHouseholds((prev) => {
                          const next = new Set(prev);
                          next.add(id);
                          return next;
                        });
                        // Stale tap-mode selection would still target the
                        // disbanded household — clear it so the next seat
                        // tap follows the user's new mental model.
                        setSelectedHouseholdId((cur) => (cur === id ? null : cur));
                      }}
                      unlinkLabel={t("seating.household_unlink")}
                      ariaLabel={t("seating.household_linked_aria").replace(
                        "{n}",
                        String(entry.guests.length),
                      )}
                    />
                  </li>
                ) : (
                  <li key={entry.guest.id}>
                    <DraggableGuest
                      guest={entry.guest}
                      tapMode={tapMode}
                      selected={selectedGuestId === entry.guest.id}
                      onTap={handleTapGuest}
                      partnerRole={partnerRole(entry.guest)}
                      // Re-link affordance for previously-unlinked households:
                      // any solo row whose household has >= 2 unassigned
                      // members and was unlinked this session shows the icon.
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
                      relinkLabel={t("seating.household_relink")}
                    />
                  </li>
                ),
              )}
            </ul>
          )}
        </aside>
      </div>

      {preview && (
        <Dialog
          open={true}
          title={`${t("seating.preview_title")} — ${preview.label}`}
          onClose={closePreview}
          size="lg"
          closeOnBackdrop
          footer={
            <>
              <Button variant="outline" onClick={closePreview}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={confirmDownload}>
                {t("seating.confirm_download")}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-ink-600 dark:text-umber-200">
            {t("seating.preview_help")}
          </p>
          {/* <iframe> beats <object> for blob-URL PDFs in production: <object>
              looked equivalent on paper, but Chrome rendered the modal empty
              (the plugin-host fallback path interacts oddly with our CSP).
              <iframe src="blob:..."> drops straight into the browser's native
              PDF viewer in Chrome / Firefox / Safari. The "open in new tab"
              link sits below as a fallback if the iframe still fails. */}
          <iframe
            src={preview.url}
            title={preview.label}
            aria-label={preview.label}
            className="block h-[70vh] w-full rounded-xl border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-900"
          />
          <p className="mt-2 text-xs text-ink-500 dark:text-umber-300">
            <a href={preview.url} target="_blank" rel="noopener noreferrer" className="underline">
              {t("seating.preview_open_in_new_tab")}
            </a>
          </p>
        </Dialog>
      )}

      {shortcutsOpen && (
        <Dialog
          open={true}
          title={t("seating.shortcuts_title")}
          onClose={() => setShortcutsOpen(false)}
          closeOnBackdrop
          footer={
            <Button variant="primary" onClick={() => setShortcutsOpen(false)}>
              {t("common.cancel")}
            </Button>
          }
        >
          <ul className="space-y-2 text-sm">
            <ShortcutRow keys={["←", "→", "↑", "↓"]} label={t("seating.shortcut_arrows")} />
            <ShortcutRow
              keys={["Shift", "+", "Arrow"]}
              label={t("seating.shortcut_arrows_shift")}
            />
            <ShortcutRow keys={["[", "]"]} label={t("seating.shortcut_brackets")} />
            <ShortcutRow keys={["Delete"]} label={t("seating.shortcut_delete")} />
            <ShortcutRow keys={["N"]} label={t("seating.shortcut_n")} />
            <ShortcutRow keys={["Cmd/Ctrl", "Z"]} label={t("seating.shortcut_undo")} />
          </ul>
        </Dialog>
      )}

      {conflictPrompt && (
        <Dialog
          open={true}
          title={t("seating.swap_seats_title")}
          onClose={() => setConflictPrompt(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setConflictPrompt(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const p = conflictPrompt;
                  setConflictPrompt(null);
                  await replaceAtSeat(
                    p.targetTableId,
                    p.targetSeatIndex,
                    p.incoming.id,
                    p.occupant.id,
                  );
                }}
              >
                {t("seating.replace_button")}
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const p = conflictPrompt;
                  setConflictPrompt(null);
                  await swapGuests(
                    p.incoming.id,
                    p.occupant.id,
                    p.targetTableId,
                    p.targetSeatIndex,
                  );
                }}
              >
                {t("seating.swap_button")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-700 dark:text-paper-100">
            {t("seating.swap_seats_body")
              .replace("{occupant}", conflictPrompt.occupant.full_name)
              .replace("{guest}", conflictPrompt.incoming.full_name)}
          </p>
        </Dialog>
      )}
    </>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-ink-700 dark:text-paper-100">{label}</span>
      <span className="flex flex-wrap gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="rounded border border-paper-300 bg-paper-100 px-1.5 py-0.5 text-xs font-mono text-ink-700 dark:border-umber-700 dark:bg-umber-700/60 dark:text-paper-100"
          >
            {k}
          </kbd>
        ))}
      </span>
    </li>
  );
}

function TableEditor({
  table,
  onPatch,
  onDelete,
  onDuplicate,
  onRotate,
  onSeatsAtCap,
  t,
}: {
  table: SeatingTable | null;
  onPatch: (patch: Partial<SeatingTable>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRotate: () => void;
  /** Fires when the user clicks + on the seats stepper while at the cap. */
  onSeatsAtCap: () => void;
  t: ReturnType<typeof useT>["t"];
}) {
  if (!table) {
    return (
      <div className="card text-sm text-ink-500 dark:text-umber-300">
        <p>{t("seating.editor_empty")}</p>
      </div>
    );
  }

  // Round and square keep their two dimensions equal server-side, so we show
  // a single "size" control. Long and head tables expose length × width
  // independently.
  const hasTwoDims = table.shape === "long" || table.shape === "head";
  const xMeters = (table.x_mm / 1000).toFixed(1);
  const yMeters = (table.y_mm / 1000).toFixed(1);

  return (
    <div className="card space-y-4 p-4">
      <EditableHeading
        value={table.label}
        onCommit={(label) => onPatch({ label })}
        subtitle={`${t(`seating.shape_${table.shape}`)} · ${t("seating.seats_count").replace(
          "{n}",
          String(table.seats),
        )}`}
        editAriaLabel={t("seating.table_label_prompt")}
      />

      <Section label={t("seating.shape_label")}>
        <ShapePicker
          value={table.shape}
          // Snap width/length to the new shape's standard defaults too —
          // a round 1500×1500 doesn't make sense as a long banquet, the
          // user would just have to immediately resize otherwise.
          onChange={(v) => {
            if (v === table.shape) return;
            const dims = defaultDimsForShape(v);
            onPatch({ shape: v, width_mm: dims.width_mm, length_mm: dims.length_mm });
          }}
          ariaLabel={t("seating.shape_label")}
          labels={{
            round: t("seating.shape_round"),
            long: t("seating.shape_long"),
            square: t("seating.shape_square"),
            head: t("seating.shape_head"),
          }}
        />
      </Section>

      <Section label={t("seating.seats_label")}>
        <SeatsStepper
          value={table.seats}
          max={maxSeatsForTable(table.shape, table.width_mm, table.length_mm)}
          onChange={(n) => {
            if (n !== table.seats) onPatch({ seats: n });
          }}
          onIncDenied={onSeatsAtCap}
          atCapHint={t("seating.seats_at_cap_hint")}
        />
      </Section>

      <Section
        label={
          hasTwoDims
            ? `${t("seating.length_mm_label")} × ${t("seating.width_mm_label")}`
            : t("seating.size_mm_label")
        }
      >
        <div className={hasTwoDims ? "grid grid-cols-2 gap-2" : ""}>
          <SuffixedInput
            suffix="cm"
            min={10}
            max={1000}
            step={5}
            ariaLabel={hasTwoDims ? t("seating.length_mm_label") : t("seating.size_mm_label")}
            // The input is uncontrolled (defaultValue) so the user can type
            // freely. We bake the current dimension into the key so a
            // drag-resize on the canvas remounts the input with the new value
            // — without that, typing locally would shadow external changes.
            defaultValue={Math.round((hasTwoDims ? table.length_mm : table.width_mm) / 10)}
            inputKey={`${table.id}-${table.length_mm}-${table.width_mm}-primary`}
            onCommit={(cm) => {
              const mm = Math.round(cm) * 10;
              if (hasTwoDims) {
                if (mm !== table.length_mm) onPatch({ length_mm: mm });
              } else if (mm !== table.width_mm) {
                onPatch({ width_mm: mm, length_mm: mm });
              }
            }}
          />
          {hasTwoDims && (
            <SuffixedInput
              suffix="cm"
              min={10}
              max={1000}
              step={5}
              ariaLabel={t("seating.width_mm_label")}
              defaultValue={Math.round(table.width_mm / 10)}
              inputKey={`${table.id}-${table.width_mm}-secondary`}
              onCommit={(cm) => {
                const mm = Math.round(cm) * 10;
                if (mm !== table.width_mm) onPatch({ width_mm: mm });
              }}
            />
          )}
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-paper-200 pt-3 dark:border-umber-700">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-paper-200 bg-paper-50 px-2 py-1 text-xs text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700"
          onClick={onRotate}
          aria-label={t("seating.rotate_table")}
          title={t("seating.rotate_table")}
        >
          <RotateCw size={14} aria-hidden />
          <span>{table.rotation_deg}°</span>
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-paper-200 bg-paper-50 px-2 py-1 text-xs text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700"
          onClick={onDuplicate}
          aria-label={t("seating.duplicate_table")}
          title={t("seating.duplicate_table")}
        >
          <Copy size={14} aria-hidden />
          <span>{t("seating.duplicate_table")}</span>
        </button>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-blush-700 transition-colors hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-400/15"
          onClick={onDelete}
          aria-label={t("seating.delete_table")}
        >
          <Trash2 size={14} aria-hidden />
          <span>{t("seating.delete_table")}</span>
        </button>
      </div>
      <p className="text-xs text-ink-400 dark:text-umber-300">
        {t("seating.position_label_full").replace("{x}", xMeters).replace("{y}", yMeters)}
      </p>

      {/* Seat-layout preview — click cycles a chair through:
          normal → baby (icon, still seatable) → disabled (×, blocked) →
          normal. Two independent sets on the wire (`disabled_seats`,
          `baby_seats`) keep the model simple. */}
      <Section
        label={`${t("seating.layout_label")} · ${table.seats - (table.disabled_seats?.length ?? 0)}/${table.seats}`}
      >
        <SeatLayoutPreview
          table={table}
          onCycleSeat={(seatIndex) => {
            const disabled = new Set(table.disabled_seats ?? []);
            const baby = new Set(table.baby_seats ?? []);
            if (disabled.has(seatIndex)) {
              // disabled → normal
              disabled.delete(seatIndex);
            } else if (baby.has(seatIndex)) {
              // baby → disabled
              baby.delete(seatIndex);
              disabled.add(seatIndex);
            } else {
              // normal → baby
              baby.add(seatIndex);
            }
            onPatch({
              disabled_seats: Array.from(disabled).sort((a, b) => a - b),
              baby_seats: Array.from(baby).sort((a, b) => a - b),
            });
          }}
          ariaLabel={t("seating.layout_label")}
          xButtonLabel={t("seating.toggle_seat")}
        />
      </Section>
    </div>
  );
}

// Small SVG inside the editor showing the selected table with its chairs.
// Click any chair to toggle whether it's "X-ed out" — disabled seats render
// muted with a small × so the user can plan an asymmetric layout (empty
// head of a long table, etc.) without bumping the seat count up and down.
function SeatLayoutPreview({
  table,
  onCycleSeat,
  ariaLabel,
  xButtonLabel,
}: {
  table: SeatingTable;
  onCycleSeat: (seatIndex: number) => void;
  ariaLabel: string;
  xButtonLabel: string;
}) {
  const { rx, ry } = previewHalfDims(table);
  const chairs = previewChairOffsets(table.shape, table.seats, rx, ry);
  const disabled = new Set(table.disabled_seats ?? []);
  const baby = new Set(table.baby_seats ?? []);
  // Auto-fit viewBox with padding for chairs sitting outside the table edge.
  const pad = 28;
  const w = rx * 2 + pad * 2;
  const h = ry * 2 + pad * 2;
  const minX = -rx - pad;
  const minY = -ry - pad;
  const chairW = 18;
  const chairH = 14;
  const corner = 3;
  const isLong = table.shape === "long" || table.shape === "head";
  const rectCorner = isLong ? Math.min(6, ry * 0.4) : table.shape === "square" ? 3 : 0;
  return (
    <svg
      viewBox={`${minX} ${minY} ${w} ${h}`}
      role="group"
      aria-label={ariaLabel}
      className="block h-32 w-full rounded-xl border border-paper-200 bg-paper-50 p-1 dark:border-umber-700 dark:bg-umber-900"
    >
      {table.shape === "round" ? (
        <circle r={rx} className="fill-paper-50 stroke-ink-800" strokeWidth={1.5} />
      ) : (
        <rect
          x={-rx}
          y={-ry}
          width={rx * 2}
          height={ry * 2}
          rx={rectCorner}
          className="fill-paper-50 stroke-ink-800"
          strokeWidth={1.5}
        />
      )}
      {chairs.map((c, i) => {
        const cosA = Math.cos(c.angle);
        const sinA = Math.sin(c.angle);
        const push = chairH / 2 + 3;
        const px = c.dx + cosA * push;
        const py = c.dy + sinA * push;
        const rotDeg = (c.angle * 180) / Math.PI + 90;
        const isDisabled = disabled.has(i);
        const isBaby = !isDisabled && baby.has(i);
        const crossLen = chairH * 0.5;
        const babyR = chairH * 0.32;
        return (
          <g
            key={i}
            style={{ cursor: "pointer" }}
            role="button"
            aria-label={`#${i + 1} ${xButtonLabel}`}
            onClick={() => onCycleSeat(i)}
          >
            <rect
              x={px - chairW / 2}
              y={py - chairH / 2}
              width={chairW}
              height={chairH}
              rx={corner}
              transform={`rotate(${rotDeg} ${px} ${py})`}
              className={isDisabled ? "fill-paper-200" : "fill-blush-300"}
            />
            {isDisabled && (
              <g
                transform={`translate(${px} ${py}) rotate(${rotDeg})`}
                style={{ pointerEvents: "none" }}
              >
                <line
                  x1={-crossLen / 2}
                  y1={-crossLen / 2}
                  x2={crossLen / 2}
                  y2={crossLen / 2}
                  className="stroke-ink-500"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
                <line
                  x1={crossLen / 2}
                  y1={-crossLen / 2}
                  x2={-crossLen / 2}
                  y2={crossLen / 2}
                  className="stroke-ink-500"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              </g>
            )}
            {isBaby && (
              <g
                transform={`translate(${px - babyR * 1.4} ${py - babyR * 1.4}) rotate(${rotDeg} ${babyR * 1.4} ${babyR * 1.4})`}
                style={{ pointerEvents: "none" }}
              >
                <Baby
                  width={babyR * 2.8}
                  height={babyR * 2.8}
                  className="fill-none stroke-ink-800"
                  strokeWidth={1.6}
                />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Preview-only half-dims and chair offsets. We can't share with SeatingMap
// because the preview re-normalises long/head tables into a fixed aspect
// (so the editor card always shows a horizontal banquet, not whatever the
// user has dragged on the canvas) — keeps the preview consistent shape-to-
// shape and unaffected by extreme dimensions.
function previewHalfDims(t: SeatingTable): { rx: number; ry: number } {
  if (t.shape === "round") return { rx: 40, ry: 40 };
  if (t.shape === "square") return { rx: 40, ry: 40 };
  // long / head — fixed 3:1 banquet aspect in the preview.
  return { rx: 60, ry: 22 };
}

// Mirrors shared/seating.ts chairOffsets() but operating on the preview
// coordinate scale (small SVG units rather than mm).
function previewChairOffsets(
  shape: TableShape,
  seats: number,
  rx: number,
  ry: number,
): { dx: number; dy: number; angle: number }[] {
  if (seats <= 0) return [];
  if (shape === "round") {
    const out = [];
    for (let i = 0; i < seats; i++) {
      const angle = -Math.PI / 2 + (i / seats) * Math.PI * 2;
      out.push({ dx: Math.cos(angle) * rx, dy: Math.sin(angle) * rx, angle });
    }
    return out;
  }
  if (shape === "head") {
    const out = [];
    const longSide = rx * 2;
    for (let i = 0; i < seats; i++) {
      const t = (i + 0.5) / seats;
      out.push({ dx: -rx + longSide * t, dy: -ry, angle: -Math.PI / 2 });
    }
    return out;
  }
  // Rectangle: top / right / bottom / left, proportional to side length.
  const longSide = rx * 2;
  const shortSide = ry * 2;
  const totalPerimeter = (longSide + shortSide) * 2;
  let top = Math.round((seats * longSide) / totalPerimeter);
  let bot = top;
  let left = Math.round((seats * shortSide) / totalPerimeter);
  let right = left;
  let total = top + bot + left + right;
  while (total < seats) {
    if (longSide >= shortSide) {
      top++;
      bot++;
      total += 2;
    } else {
      left++;
      right++;
      total += 2;
    }
  }
  while (total > seats) {
    if (right > 0) {
      right--;
      total--;
    } else if (bot > 0) {
      bot--;
      total--;
    } else if (left > 0) {
      left--;
      total--;
    } else if (top > 0) {
      top--;
      total--;
    } else break;
  }
  const out = [];
  for (let i = 0; i < top; i++) {
    const t = (i + 0.5) / top;
    out.push({ dx: -rx + longSide * t, dy: -ry, angle: -Math.PI / 2 });
  }
  for (let i = 0; i < right; i++) {
    const t = (i + 0.5) / right;
    out.push({ dx: rx, dy: -ry + shortSide * t, angle: 0 });
  }
  for (let i = 0; i < bot; i++) {
    const t = (i + 0.5) / bot;
    out.push({ dx: rx - longSide * t, dy: ry, angle: Math.PI / 2 });
  }
  for (let i = 0; i < left; i++) {
    const t = (i + 0.5) / left;
    out.push({ dx: -rx, dy: ry - shortSide * t, angle: Math.PI });
  }
  return out;
}

// Inline-editable heading. Click the title (or the pencil) to edit; commit
// on blur or Enter, cancel on Escape. We avoid a duplicate "name" Field
// because the heading IS the name — one source of truth.
function EditableHeading({
  value,
  onCommit,
  subtitle,
  editAriaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  subtitle: string;
  editAriaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Reset draft whenever the underlying value changes (e.g. server refresh)
  // so we never commit a stale string on the next blur.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== value) onCommit(v);
    else setDraft(value);
  }

  return (
    <div>
      {editing ? (
        <input
          autoFocus
          aria-label={editAriaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(value);
              setEditing(false);
            }
          }}
          className="w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 font-serif text-xl text-ink-900 focus:border-ink-700 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:focus:border-paper-100"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex w-full items-center gap-2 rounded-lg text-left transition-colors hover:bg-paper-100 dark:hover:bg-umber-700"
          aria-label={editAriaLabel}
        >
          <h3 className="flex-1 truncate font-serif text-xl text-ink-900 dark:text-paper-50">
            {value}
          </h3>
          <Pencil
            size={14}
            aria-hidden
            className="text-ink-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-umber-300"
          />
        </button>
      )}
      <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">{subtitle}</p>
    </div>
  );
}

// Section header + body. Replaces the verbose <Field label> wrapper inside
// the table editor with a slightly larger, more "card section" feel — uppercase
// label, tighter spacing.
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-umber-300">
        {label}
      </p>
      {children}
    </div>
  );
}

// Numeric stepper with -/+ buttons either side of the value. Mirrors the
// in-canvas seat buttons so the user has the same affordance both places.
// `max` is the perimeter-derived cap — chairs are 80 cm wide and can't be
// crammed past what physically fits around the table.
function SeatsStepper({
  value,
  onChange,
  onIncDenied,
  max,
  atCapHint,
}: {
  value: number;
  onChange: (next: number) => void;
  /** Fires when the user clicks + at the cap. Parent surfaces a toast. */
  onIncDenied?: () => void;
  max: number;
  /** Persistent inline hint shown below the stepper when value === max. */
  atCapHint?: string;
}) {
  const upper = Math.max(1, max);
  const atMax = value >= upper;
  const dec = () => onChange(Math.max(1, value - 1));
  // + stays clickable past the cap so the parent can fire a toast — a
  // disabled HTML button swallows the click, leaving the user with no
  // explanation. We mark the button aria-disabled instead.
  const inc = () => {
    if (atMax) {
      onIncDenied?.();
      return;
    }
    onChange(value + 1);
  };
  const decDisabled = value <= 1;
  return (
    <div className="block">
      <div className="inline-flex items-center gap-2 rounded-xl border border-paper-200 bg-paper-50 p-1 dark:border-umber-700 dark:bg-umber-800">
        <button
          type="button"
          onClick={dec}
          disabled={decDisabled}
          className="grid h-8 w-8 place-items-center rounded-lg text-ink-700 transition-colors hover:bg-paper-100 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent dark:text-paper-100 dark:hover:bg-umber-700 dark:disabled:text-umber-300"
          aria-label="−"
        >
          <Minus size={16} aria-hidden />
        </button>
        <span className="min-w-[2ch] text-center text-base font-semibold tabular-nums text-ink-900 dark:text-paper-50">
          {value}
        </span>
        <button
          type="button"
          onClick={inc}
          aria-disabled={atMax || undefined}
          className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${
            atMax
              ? "text-ink-300 hover:bg-blush-50 dark:text-umber-300 dark:hover:bg-blush-400/15"
              : "text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
          }`}
          aria-label="+"
        >
          <Plus size={16} aria-hidden />
        </button>
        <span className="px-1 text-xs tabular-nums text-ink-400 dark:text-umber-300" aria-hidden>
          /{upper}
        </span>
      </div>
      {atMax && atCapHint && (
        <p className="mt-1.5 text-[11px] text-blush-700 dark:text-blush-300" role="status">
          {atCapHint}
        </p>
      )}
    </div>
  );
}

// Number input with a static unit suffix rendered inside the field. We use a
// relative wrapper + absolutely-positioned span so the suffix doesn't fight
// for layout space and lines up vertically with the value.
function SuffixedInput({
  suffix,
  min,
  max,
  step,
  defaultValue,
  inputKey,
  onCommit,
  ariaLabel,
}: {
  suffix: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  inputKey: string;
  onCommit: (value: number) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        className="input py-1.5 pr-9 text-base sm:text-sm"
        defaultValue={defaultValue}
        key={inputKey}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n) || n < min || n > max) return;
          onCommit(n);
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-ink-400 dark:text-umber-300"
      >
        {suffix}
      </span>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 flex items-center justify-between text-ink-500 dark:text-umber-300">
        <span>{label}</span>
        {hint && <span className="text-ink-300 dark:text-umber-300">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

// Tiny inline icon for the Head table — a slim rectangle (the table) with
// three filled dots below (chairs only on one side). Lucide doesn't have a
// good prebuilt match, and a custom SVG keeps the visual semantics literal.
function HeadTableIcon({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="8" width="18" height="6" rx="1.5" />
      <circle cx="7" cy="18" r="1.4" fill="currentColor" />
      <circle cx="12" cy="18" r="1.4" fill="currentColor" />
      <circle cx="17" cy="18" r="1.4" fill="currentColor" />
    </svg>
  );
}

// Shape picker. Equal-width tiles in a 2×2 grid (no horizontal scroll), each
// showing an icon + the localised label. Selected tile gets a soft blush
// wash; unselected stays neutral on the paper background.
type ShapeIcon = (props: { size?: number; className?: string }) => React.ReactElement;

const SHAPE_ICONS: Record<TableShape, ShapeIcon> = {
  round: ({ size, className }) => <Circle size={size} className={className} aria-hidden />,
  long: ({ size, className }) => (
    <RectangleHorizontal size={size} className={className} aria-hidden />
  ),
  square: ({ size, className }) => <Square size={size} className={className} aria-hidden />,
  head: HeadTableIcon,
};

function ShapePicker({
  value,
  onChange,
  ariaLabel,
  labels,
}: {
  value: TableShape;
  onChange: (next: TableShape) => void;
  ariaLabel: string;
  labels: Record<TableShape, string>;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-4 gap-1.5">
      {SHAPES.map((s) => {
        const Icon = SHAPE_ICONS[s];
        const active = s === value;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s)}
            // Icon-only tile — the localised label is exposed via aria-label
            // and the per-tile title attribute (so it shows on hover) but not
            // rendered as text. Keeps the row compact across HU and EN.
            aria-label={labels[s]}
            title={labels[s]}
            className={[
              "flex items-center justify-center rounded-xl border py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ink-700",
              active
                ? "border-blush-300 bg-blush-50 dark:border-blush-400/40 dark:bg-blush-400/15"
                : "border-paper-200 bg-paper-50 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:hover:bg-umber-700",
            ].join(" ")}
          >
            <Icon
              size={22}
              className={
                active ? "text-blush-700 dark:text-blush-300" : "text-ink-500 dark:text-umber-300"
              }
            />
          </button>
        );
      })}
    </div>
  );
}

function TableCard({
  table,
  assignments,
  guestById,
  onDropSeat,
  onSelect,
  isSelected,
  onSeatedDragStart,
  onSeatedDragEnd,
  tapMode,
  selectedGuestId,
  onTapGuest,
  onTapSeat,
  t,
}: {
  table: SeatingTable;
  assignments: SeatAssignment[];
  guestById: Map<number, Guest>;
  onDropSeat: (tableId: number, seatIndex: number, e: DragEvent) => void;
  onSelect: () => void;
  isSelected: boolean;
  onSeatedDragStart: (guestId: number) => void;
  onSeatedDragEnd: (e: DragEvent) => void;
  tapMode: boolean;
  selectedGuestId: number | null;
  onTapGuest: (guest: Guest) => void;
  onTapSeat: (tableId: number, seatIndex: number) => void;
  t: ReturnType<typeof useT>["t"];
}) {
  const seatToAssign = new Map(assignments.map((a) => [a.seat_index, a]));

  return (
    <div
      className={`card cursor-pointer transition-shadow ${
        isSelected ? "ring-2 ring-blush-400 dark:ring-blush-400/60" : "hover:shadow-pop"
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {(() => {
        const disabledTC = new Set(table.disabled_seats ?? []);
        const usable = table.seats - disabledTC.size;
        return (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-serif text-xl">{table.label}</h3>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-umber-300">
                  {t(`seating.shape_${table.shape}`)} ·{" "}
                  {t("seating.seats_count").replace("{n}", String(usable))}
                </p>
              </div>
            </div>

            <ol className="mt-4 grid grid-cols-2 gap-2">
              {Array.from({ length: table.seats })
                .map((_, idx) => idx)
                .filter((idx) => !disabledTC.has(idx))
                .map((idx) => {
                  const a = seatToAssign.get(idx);
                  const guest = a ? guestById.get(a.guest_id) : undefined;
                  const tappable = tapMode && (selectedGuestId !== null || guest);
                  // Seat <li> is keyboard-actionable too — Enter/Space drops
                  // the currently-selected guest into this seat (mirroring
                  // the tap behaviour). Empty seats are skipped from focus
                  // unless a guest is queued for placement, to avoid a
                  // forest of Tab stops for the keyboard-only user.
                  const seatFocusable = selectedGuestId !== null || guest !== undefined;
                  return (
                    <li
                      key={idx}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDropSeat(table.id, idx, e)}
                      onClick={(e) => {
                        if (!tapMode) return;
                        e.stopPropagation();
                        onTapSeat(table.id, idx);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        if (selectedGuestId === null && !guest) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onTapSeat(table.id, idx);
                      }}
                      tabIndex={seatFocusable ? 0 : -1}
                      role="button"
                      aria-label={t("seating.seat_aria_label")
                        .replace("{table}", table.label)
                        .replace("{seat}", String(idx + 1))}
                      className={
                        guest
                          ? `rounded-lg border border-ink-300 bg-paper-50 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:focus-visible:ring-umber-300 ${tappable ? "cursor-pointer" : ""}`
                          : `rounded-lg border border-dashed border-paper-300 bg-paper-100 px-2 py-1.5 text-xs text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-300 dark:focus-visible:ring-umber-300 ${tappable ? "cursor-pointer ring-1 ring-blush-200 dark:ring-blush-400/40" : ""}`
                      }
                    >
                      <span className="text-[10px] uppercase tracking-wider text-ink-400 dark:text-umber-300">
                        #{idx + 1}
                      </span>
                      <div className="mt-0.5">
                        {guest ? (
                          <DraggableGuest
                            guest={guest}
                            compact
                            onDragStart={() => onSeatedDragStart(guest.id)}
                            onDragEnd={onSeatedDragEnd}
                            tapMode={tapMode}
                            selected={selectedGuestId === guest.id}
                            onTap={onTapGuest}
                          />
                        ) : (
                          <span>—</span>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ol>
          </>
        );
      })()}
    </div>
  );
}

function DraggableGuest({
  guest,
  compact,
  onDragStart: onDragStartCb,
  onDragEnd: onDragEndCb,
  tapMode,
  selected,
  onTap,
  partnerRole,
  groupIds,
  relinkable,
  onRelink,
  relinkLabel,
}: {
  guest: Guest;
  compact?: boolean;
  onDragStart?: () => void;
  onDragEnd?: (e: DragEvent) => void;
  tapMode?: boolean;
  selected?: boolean;
  onTap?: (guest: Guest) => void;
  /** Pin a Crown icon next to bride / groom matches in the unassigned list. */
  partnerRole?: "bride" | "groom" | null;
  /** When provided, the drag payload includes every id in this array so a
   *  drop on a seat fills consecutive seats with the whole household. */
  groupIds?: number[];
  /** True when this single row belongs to a household the user previously
   *  unlinked this session — we show a small Link2 affordance to undo it. */
  relinkable?: boolean;
  onRelink?: () => void;
  relinkLabel?: string;
}) {
  function onDragStart(e: DragEvent) {
    const data: DragData =
      groupIds && groupIds.length > 1
        ? { guestId: guest.id, guestIds: groupIds }
        : { guestId: guest.id };
    e.dataTransfer.setData("application/x-weddly-guest", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
    onDragStartCb?.();
  }
  function onDragEnd(e: DragEvent) {
    onDragEndCb?.(e);
  }
  return (
    <div
      draggable={!tapMode}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        if (onTap) onTap(guest);
      }}
      // Keyboard a11y: a guest tile is a "button" that selects this person
      // for placement. Enter/Space activates; Escape clears via the onTap
      // toggle (same id → second tap clears).
      role="button"
      tabIndex={0}
      aria-pressed={selected || undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (onTap) onTap(guest);
        } else if (e.key === "Escape" && selected) {
          e.preventDefault();
          if (onTap) onTap(guest);
        }
      }}
      className={[
        compact
          ? "text-sm font-medium text-ink-900 dark:text-paper-50"
          : partnerRole
            ? "rounded-lg border border-blush-300 bg-blush-50 px-2 py-1.5 text-sm font-medium text-ink-900 hover:border-blush-500 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-paper-50 dark:hover:border-blush-400"
            : "rounded-lg border border-paper-300 bg-paper-50 px-2 py-1.5 text-sm text-ink-800 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600",
        tapMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        selected ? "ring-2 ring-blush-500 dark:ring-blush-400/60" : "",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-umber-300",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Royalty glyph for bride / groom matches at the top of the
          unassigned list so the couple can see themselves at a glance.
          Bride wears the Gem (mirrors the `her_family` group icon); groom
          keeps the Crown. */}
      {partnerRole &&
        (partnerRole === "bride" ? (
          <Gem
            size={compact ? 14 : 16}
            aria-hidden
            className="mr-1 inline-block align-text-bottom text-blush-600 dark:text-blush-300"
          />
        ) : (
          <Crown
            size={compact ? 14 : 16}
            aria-hidden
            className="mr-1 inline-block align-text-bottom text-blush-600 dark:text-blush-300"
          />
        ))}
      {/* Baby icon for guests where kind === "baby" so couples can see at a
          glance which seats are taken by infants — they typically sit on a
          parent's lap or in a high-chair, so they don't consume a real seat
          for the venue head-count. */}
      {guest.kind === "baby" && !partnerRole && (
        <Baby
          size={compact ? 14 : 16}
          aria-hidden
          className="mr-1 inline-block align-text-bottom text-blush-500 dark:text-blush-300"
        />
      )}
      {/* Generic person silhouette for plain members of a linked household —
          mirrors the logistics sidebar so the joint-guest card reads the same
          across the app. Solo guests stay iconless to keep the unassigned
          list visually quiet. */}
      {!partnerRole && guest.kind !== "baby" && groupIds && groupIds.length > 1 && (
        <User
          size={compact ? 14 : 16}
          aria-hidden
          className="mr-1 inline-block align-text-bottom text-ink-500 dark:text-umber-300"
        />
      )}
      {guest.full_name}
      {relinkable && onRelink && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRelink();
          }}
          aria-label={relinkLabel}
          title={relinkLabel}
          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-paper-200 hover:text-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
        >
          <Link2 size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

// Linked-household card. Renders members stacked with a soft blush rail on
// the left so the eye reads them as one party. Any member's drag carries
// the full member-id list — dropping it on a seat fills consecutive seats.
// Tap-mode: the whole card is the "armed" payload; tapping it selects the
// group, then tapping a seat places everyone starting there.
//
// The top-right Unlink2 icon breaks the visual link AND the joint payload
// for the rest of the session — useful when a household genuinely wants to
// sit apart, e.g. a parent at the head table while the rest sit elsewhere.
function HouseholdGroup({
  householdId,
  guests,
  tapMode,
  selected,
  onTap,
  onUnlink,
  unlinkLabel,
  ariaLabel,
}: {
  householdId: number;
  guests: Guest[];
  tapMode?: boolean;
  selected?: boolean;
  onTap: (householdId: number) => void;
  onUnlink: (householdId: number) => void;
  unlinkLabel: string;
  ariaLabel: string;
}) {
  const groupIds = guests.map((g) => g.id);
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onClick={(e) => {
        // Let nested controls (member rows, unlink button) handle their own
        // clicks first — they stopPropagation. Card-level clicks fall back
        // to "arm this household for placement".
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        onTap(householdId);
      }}
      className={`group relative rounded-lg border py-1 pl-3 pr-1 transition-colors ${
        selected
          ? "border-blush-500 bg-blush-50 ring-2 ring-blush-400 dark:border-blush-400 dark:bg-blush-400/15"
          : "border-paper-300 bg-paper-50 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
      } ${tapMode ? "cursor-pointer" : ""}`}
    >
      {/* Vertical rail visually ties the members together — blush-400 to
          feel warm, hugs the left padding edge. */}
      <span
        aria-hidden
        className="absolute bottom-1 left-1.5 top-1 w-0.5 rounded-full bg-blush-400 dark:bg-blush-400/70"
      />
      {/* Floating count chip on the top-left edge — identifies the
          household at a glance without occupying a row of the card. */}
      <span
        title={ariaLabel}
        className="absolute -left-1 -top-1.5 inline-flex h-4 items-center gap-0.5 rounded-full bg-blush-400 px-1.5 text-[9px] font-bold leading-none text-white shadow-sm dark:bg-blush-500"
      >
        <Link2 size={8} strokeWidth={3} aria-hidden />
        {guests.length}
      </span>
      {/* Unlink — small floating action top-right. Kept semi-visible so
          touch users can find it; full opacity on hover/focus. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnlink(householdId);
        }}
        aria-label={unlinkLabel}
        title={unlinkLabel}
        className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 opacity-60 transition-opacity hover:bg-paper-200 hover:text-ink-700 hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100 dark:focus-visible:ring-umber-300"
      >
        <Unlink2 size={11} aria-hidden />
      </button>
      <ul className="space-y-1">
        {guests.map((g) => (
          <li key={g.id}>
            <DraggableGuest
              guest={g}
              tapMode={tapMode}
              // Group selection: every member highlights when the household is
              // tap-armed so the user can see the whole batch they queued.
              selected={selected}
              onTap={() => onTap(householdId)}
              groupIds={groupIds}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Stub card for a bride / groom slot when no matching guest row exists yet.
// Not draggable — purely a placeholder that keeps the two reserved spots
// visible at the top of the panel so the couple sees "this is where I'll
// go" before they (or their partner) are added to the guest list.
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

function clampToRoom(v: number, ceiling: number): number {
  return Math.max(0, Math.min(ceiling, v));
}

function readDragData(e: DragEvent): DragData | null {
  const raw = e.dataTransfer.getData("application/x-weddly-guest");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragData;
  } catch {
    return null;
  }
}
