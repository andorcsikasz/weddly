// Seating page. Two surfaces stacked vertically:
//   1. Floor-plan map at the top — drag tables to position, click to select,
//      edit shape/seats/dimensions in the inline editor panel.
//   2. The seat-assignment grid below — drag guests onto specific seats.
// We trade pixel-perfect placement on the assignment grid for an approachable
// column layout; the map is where pixel-perfect (millimetre) layout lives,
// and that's what the PDF export consumes.

import type { Couple, Guest, SeatAssignment, SeatingTable, TableShape } from "@shared/types";
import {
  MAX_TABLE_SEATS,
  MIN_AISLE_MM,
  TABLE_SIZE_PRESETS,
  chairOffsets,
  defaultDimsForShape,
  isDefaultTableLabel,
  isRoomDimension,
  maxSeatsForTable,
  previewHalfDims,
  seatingProgress,
} from "@shared/seating";
import {
  Armchair,
  Baby,
  Briefcase,
  Check,
  ChevronDown,
  Circle,
  Copy,
  Crown,
  ExternalLink,
  Gem,
  Hand,
  LayoutGrid,
  Link2,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Printer,
  RectangleHorizontal,
  Redo2,
  RotateCw,
  Search,
  Square,
  Trash2,
  Undo2,
  Unlink2,
  User,
  Users,
  Wheat,
  X,
} from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Dialog, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import {
  type SeatingTableEnvelope,
  coupleApi,
  fetchPdfBlob,
  guestApi,
  seatingApi,
} from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { publish, subscribe } from "../lib/sync";
import { computeSymmetricLayout, tableFootprintMm } from "./seating/layout";
import { ROOM_DIMS, SeatingMap } from "./seating/SeatingMap";
import { isCurrentSessionDemo } from "../lib/demoSession";
import { LastUpdatedBy } from "../components/LastUpdatedBy";

// Demo workspace canvas — 10 × 15 m portrait. Sized for the intimate
// 15-guest fairytale wedding: head table + 3 round tables fit comfortably
// with room to drag, without the floor reading as empty. Applied in-memory
// only (never written to localStorage), so the visitor's real workspace on
// the same device keeps its own saved dimensions.
const DEMO_ROOM_W_MM = 10_000;
const DEMO_ROOM_H_MM = 15_000;

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

// In-memory undo entry. Each action stores closures for BOTH directions so
// the stack stays agnostic of the action type: `undo` reverses the action,
// `redo` re-applies it after an undo. A fresh user action clears the redo
// stack (linear history, like a text editor).
interface UndoAction {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const UNDO_STACK_LIMIT = 20;

// Accent-insensitive, case-insensitive match key for guest search. Essential
// for HU names — "Toth" must find "Tóth".
function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

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
  // Demo workspaces ignore the localStorage default and start at 20×30 m so
  // the seeded fairytale tables sit on a generous floor — they also skip the
  // localStorage write below so the visitor's real saved value (if any)
  // stays untouched.
  const isDemoSession = isCurrentSessionDemo();
  const [roomWidthMm, setRoomWidthMm] = useState<number>(
    isDemoSession ? DEMO_ROOM_W_MM : ROOM_DIMS.W_MM,
  );
  const [roomHeightMm, setRoomHeightMm] = useState<number>(
    isDemoSession ? DEMO_ROOM_H_MM : ROOM_DIMS.H_MM,
  );
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
  // Guest search in the unassigned panel (accent-insensitive; "/" focuses).
  const [guestQuery, setGuestQuery] = useState("");
  const guestSearchRef = useRef<HTMLInputElement | null>(null);
  // Declined guests are hidden from the placement pool by default — seating
  // someone who said no is almost always a mistake. The toggle brings them
  // back for the edge cases (declined-then-reconsidered).
  const [showDeclined, setShowDeclined] = useState(false);
  // Seat-picker popover: opened by clicking an EMPTY chair with no guest
  // armed. Anchored at the click's client coordinates.
  const [seatPicker, setSeatPicker] = useState<{
    tableId: number;
    seatIndex: number;
    x: number;
    y: number;
  } | null>(null);
  // Undo stack. Bounded by UNDO_STACK_LIMIT — we drop the oldest action when
  // it overflows so the stack stays small and predictable.
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  // Autosave chip state: how many mutations are in flight, whether the last
  // one failed, and a short-lived "Saved" flash once the queue settles.
  const [pendingSaves, setPendingSaves] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  // Table id that was just created/duplicated — the canvas draws a brief
  // halo around it so the user sees where the new table landed.
  const [justCreatedId, setJustCreatedId] = useState<number | null>(null);
  const justCreatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Post-resize capacity prompt: "the table now fits {extra} more chairs".
  const [fitPrompt, setFitPrompt] = useState<{ tableId: number; extra: number } | null>(null);
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

  // Freshest known `updated_at` per table id, written from EVERY server
  // response (plan fetches and mutation envelopes alike). If-Match reads
  // from here, never from possibly-stale React state — this is what closes
  // the "resize just landed but the next click still carries the old ETag"
  // race behind the silent seat-add failure.
  const latestUpdatedAtRef = useRef<Map<number, number>>(new Map());
  // Live mirror of `tables` for reading inside queued/async closures.
  const tablesRef = useRef<SeatingTable[]>([]);
  // Per-table PATCH serialization: a blur-committed resize and an immediate
  // "+ seat" click chain instead of interleaving on the wire.
  const patchChainsRef = useRef<Map<number, Promise<void>>>(new Map());

  const rememberTables = useCallback((list: SeatingTable[]) => {
    for (const tb of list) latestUpdatedAtRef.current.set(tb.id, tb.updated_at);
    tablesRef.current = list;
  }, []);

  async function refresh() {
    const [plan, gs, c] = await Promise.all([
      seatingApi.plan(),
      guestApi.list(),
      coupleApi.current(),
    ]);
    rememberTables(plan.tables);
    setTables(plan.tables);
    setAssignments(plan.assignments);
    setGuests(gs.guests);
    setCouple(c.couple);
  }

  // Merge one persisted row into state synchronously — mutation responses
  // apply instantly instead of waiting a full plan round-trip.
  const applyTable = useCallback(
    (table: SeatingTable) => {
      setTables((prev) => {
        const next = prev.some((tb) => tb.id === table.id)
          ? prev.map((tb) => (tb.id === table.id ? table : tb))
          : [...prev, table];
        rememberTables(next);
        return next;
      });
    },
    [rememberTables],
  );

  const dropTableFromState = useCallback((id: number) => {
    latestUpdatedAtRef.current.delete(id);
    setTables((prev) => {
      const next = prev.filter((tb) => tb.id !== id);
      tablesRef.current = next;
      return next;
    });
    setAssignments((prev) => prev.filter((a) => a.table_id !== id));
  }, []);

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

  // Hydrate the room from the WORKSPACE, not from this device. The room used
  // to live in a single browser-wide localStorage key, which was wrong three
  // ways at once: partner B opened the same plan in a default 12×9 m room with
  // the tables laid outside it, the seating PDF is rendered from a room size
  // the client sends so the two partners printed different charts, and a couple
  // with a second event shared one room between both weddings.
  //
  // The old key is still read ONCE, as a migration: a couple who sized their
  // room before this keeps it, and the value is written straight back to the
  // workspace so the next device gets it too. Demo sessions keep their own
  // in-memory 20×30 m floor and never read or write either store.
  const roomHydratedRef = useRef(false);
  useEffect(() => {
    if (isDemoSession || roomHydratedRef.current || !couple) return;
    roomHydratedRef.current = true;
    const w = couple.seating_room_w_mm;
    const h = couple.seating_room_h_mm;
    if (w != null && h != null) {
      setRoomWidthMm(w);
      setRoomHeightMm(h);
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("weddly.seating.room_dims");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { w?: unknown; h?: unknown };
      const lw = Math.round(Number(parsed.w));
      const lh = Math.round(Number(parsed.h));
      if (!isRoomDimension(lw) || !isRoomDimension(lh)) return;
      setRoomWidthMm(lw);
      setRoomHeightMm(lh);
      void coupleApi
        .update({ seating_room_w_mm: lw, seating_room_h_mm: lh })
        .then(() => window.localStorage.removeItem("weddly.seating.room_dims"))
        .catch(() => {
          /* the local value still drives this session; retry next load */
        });
    } catch {
      /* noop — corrupt entry, keep defaults */
    }
  }, [isDemoSession, couple]);

  const updateRoom = useCallback(
    (widthMm: number, heightMm: number) => {
      setRoomWidthMm(widthMm);
      setRoomHeightMm(heightMm);
      // Demo sessions stay in-memory — a demo visitor must not write a room
      // size onto a real workspace.
      if (isDemoSession) return;
      if (!isRoomDimension(widthMm) || !isRoomDimension(heightMm)) return;
      void coupleApi
        .update({ seating_room_w_mm: widthMm, seating_room_h_mm: heightMm })
        .catch(() => {
          /* the canvas already moved; a failed save retries on the next drag */
        });
    },
    [isDemoSession],
  );

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

  // Two-mode seating workspace: "edit" = drag/resize tables; "seat" = assign guests to chairs.
  const [mode, setMode] = useState<"edit" | "seat">("seat");

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const seatedIds = useMemo(() => new Set(assignments.map((a) => a.guest_id)), [assignments]);
  // Per-table, per-seat guest info — fed into SeatingMap in seat mode so it
  // can render names on chairs and know which seats are occupied.
  const seatGuestsByTable = useMemo(() => {
    const out = new Map<
      number,
      Map<number, { id: number; name: string; dietary?: string | null }>
    >();
    for (const a of assignments) {
      const g = guestById.get(a.guest_id);
      if (!g) continue;
      let inner = out.get(a.table_id);
      if (!inner) {
        inner = new Map();
        out.set(a.table_id, inner);
      }
      inner.set(a.seat_index, { id: g.id, name: g.full_name, dietary: g.dietary });
    }
    return out;
  }, [assignments, guestById]);
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
  // via partnerSlots so they don't double up. Declined guests are excluded
  // unless the user opts in via the showDeclined toggle.
  const unassigned = useMemo(
    () =>
      guests.filter(
        (g) =>
          !seatedIds.has(g.id) &&
          partnerRole(g) === null &&
          (showDeclined || g.rsvp_status !== "no"),
      ),
    [guests, seatedIds, partnerRole, showDeclined],
  );
  // Flat pool of everyone not yet seated — feeds the inline "seat someone
  // here" typeahead in the table panel. Partners first (they're the couple),
  // then the rest of the unassigned list; no duplicates since `unassigned`
  // already excludes partner-role rows.
  const unseatedCandidates = useMemo(() => {
    const out: { id: number; name: string }[] = [];
    for (const slot of partnerSlots) {
      if (slot.guest) out.push({ id: slot.guest.id, name: slot.guest.full_name });
    }
    for (const g of unassigned) out.push({ id: g.id, name: g.full_name });
    return out;
  }, [partnerSlots, unassigned]);
  // How many hidden-by-default declined guests exist (drives the toggle count).
  const declinedUnseatedCount = useMemo(
    () =>
      guests.filter(
        (g) => !seatedIds.has(g.id) && partnerRole(g) === null && g.rsvp_status === "no",
      ).length,
    [guests, seatedIds, partnerRole],
  );
  // Declined guests still holding a seat — worth a warning line, since the
  // couple probably wants that chair back.
  const declinedSeatedCount = useMemo(
    () => guests.filter((g) => seatedIds.has(g.id) && g.rsvp_status === "no").length,
    [guests, seatedIds],
  );
  // Capacity line: usable chairs across all tables vs guests who said yes.
  const totalChairs = useMemo(
    () => tables.reduce((sum, tb) => sum + tb.seats - (tb.disabled_seats?.length ?? 0), 0),
    [tables],
  );
  const confirmedGuests = useMemo(
    () => guests.filter((g) => g.rsvp_status === "yes").length,
    [guests],
  );
  // Progress counts only guests who haven't declined — a "no" shouldn't
  // keep the plan stuck at 95% forever.
  const eligibleGuestCount = useMemo(
    () => guests.filter((g) => g.rsvp_status !== "no").length,
    [guests],
  );
  const eligibleSeatedCount = useMemo(
    () => guests.filter((g) => seatedIds.has(g.id) && g.rsvp_status !== "no").length,
    [guests, seatedIds],
  );
  // Advisory aisle check: pairs of tables whose chair-back envelopes leave
  // less than MIN_AISLE_MM (80 cm) of walking space between them. Purely
  // informational — placement stays unconstrained; the canvas shows a soft
  // halo + count chip that the user can dismiss.
  const aisleWarnIds = useMemo(() => {
    const out = new Set<number>();
    const boxes = tables.map((tb) => ({
      id: tb.id,
      x: tb.x_mm,
      y: tb.y_mm,
      ...tableFootprintMm(tb),
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const xGap = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
        const yGap = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
        if (Math.max(xGap, yGap) < MIN_AISLE_MM) {
          out.add(a.id);
          out.add(b.id);
        }
      }
    }
    return out;
  }, [tables]);
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
    // Search filter — a household card stays visible while ANY member
    // matches so "Toth" surfaces the whole Tóth party.
    const q = normalizeName(guestQuery.trim());
    if (!q) return out;
    return out.filter((e) =>
      e.kind === "single"
        ? normalizeName(e.guest.full_name).includes(q)
        : e.guests.some((g) => normalizeName(g.full_name).includes(q)),
    );
  }, [unassigned, unlinkedHouseholds, guestQuery]);
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

  // Stacks live in refs so concurrent events (drop while a toast is fading)
  // can't drop entries via stale state. The visible state mirrors length so
  // the inline Undo/Redo buttons can show/hide without race risk.
  const undoStackRef = useRef<UndoAction[]>([]);
  const redoStackRef = useRef<UndoAction[]>([]);
  const pushUndo = useCallback((action: UndoAction, opts?: { keepRedo?: boolean }) => {
    const arr = undoStackRef.current;
    arr.push(action);
    if (arr.length > UNDO_STACK_LIMIT) arr.shift();
    setUndoStack([...arr]);
    // A fresh user action forks history — drop the redo branch. Undo/redo
    // traversal passes keepRedo so walking the stack doesn't erase it.
    if (!opts?.keepRedo) {
      redoStackRef.current = [];
      setRedoStack([]);
    }
  }, []);

  const popAndUndo = useCallback(async () => {
    const action = undoStackRef.current.pop();
    setUndoStack([...undoStackRef.current]);
    if (!action) return;
    try {
      await action.undo();
      redoStackRef.current.push(action);
      setRedoStack([...redoStackRef.current]);
      await refresh();
    } catch {
      toast.error(t("seating.undo_failed"));
    }
  }, [toast, t]);

  const popAndRedo = useCallback(async () => {
    const action = redoStackRef.current.pop();
    setRedoStack([...redoStackRef.current]);
    if (!action) return;
    try {
      await action.redo();
      pushUndo(action, { keepRedo: true });
      await refresh();
    } catch {
      toast.error(t("seating.redo_failed"));
    }
  }, [toast, t, pushUndo]);

  // Wrap every mutating API call so the toolbar chip can show
  // "Saving… / Saved / Save failed" — the plan autosaves on every action,
  // and this is the first place that fact is visible to the user.
  const hasSavedRef = useRef(false);
  const runSaving = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    hasSavedRef.current = true;
    setPendingSaves((n) => n + 1);
    try {
      const out = await fn();
      setSaveFailed(false);
      return out;
    } catch (e) {
      setSaveFailed(true);
      throw e;
    } finally {
      setPendingSaves((n) => n - 1);
    }
  }, []);

  // Flash "Saved" for a couple of seconds whenever the save queue settles
  // cleanly, then fade back to nothing (a permanently-green chip is noise).
  // hasSavedRef keeps the initial page load from flashing a phantom save.
  useEffect(() => {
    if (pendingSaves > 0) {
      setSavedFlash(false);
      return;
    }
    if (saveFailed || !hasSavedRef.current) return;
    setSavedFlash(true);
    const timer = setTimeout(() => setSavedFlash(false), 2000);
    return () => clearTimeout(timer);
  }, [pendingSaves, saveFailed]);

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
      const forward = () =>
        runSaving(() =>
          seatingApi.assign({ table_id: tableId, seat_index: seatIndex, guest_id: guestId }),
        );
      try {
        await forward();
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          if (previous) {
            await runSaving(() =>
              seatingApi.assign({
                table_id: previous.table_id,
                seat_index: previous.seat_index,
                guest_id: guestId,
              }),
            );
          } else {
            await runSaving(() => seatingApi.unassign(guestId));
          }
        },
        redo: async () => {
          await forward();
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
    [findAssignmentForGuest, guestById, tables, pushUndo, announceUndoable, t, toast, runSaving],
  );

  const unassignGuest = useCallback(
    async (guestId: number, opts?: { silentUndo?: boolean }) => {
      const previous = findAssignmentForGuest(guestId);
      if (!previous) return;
      const forward = () => runSaving(() => seatingApi.unassign(guestId));
      try {
        await forward();
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          await runSaving(() =>
            seatingApi.assign({
              table_id: previous.table_id,
              seat_index: previous.seat_index,
              guest_id: guestId,
            }),
          );
        },
        redo: async () => {
          await forward();
        },
      });
      const guest = guestById.get(guestId);
      if (!opts?.silentUndo && guest) {
        announceUndoable(t("seating.toast_unassigned").replace("{guest}", guest.full_name));
      }
      publish("seating:changed");
      await refresh();
    },
    [findAssignmentForGuest, guestById, pushUndo, announceUndoable, t, toast, runSaving],
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
      // symmetric, so re-issuing it is the perfect undo AND the perfect redo.
      void targetTableId;
      void targetSeatIndex;
      const doSwap = () =>
        runSaving(() =>
          seatingApi.swap({
            guest_a_id: incomingGuestId,
            guest_b_id: occupantGuestId,
          }),
        );
      try {
        await doSwap();
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          await doSwap();
        },
        redo: async () => {
          await doSwap();
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
    [guestById, pushUndo, announceUndoable, t, toast, runSaving],
  );

  const replaceAtSeat = useCallback(
    async (
      tableId: number,
      seatIndex: number,
      incomingGuestId: number,
      occupantGuestId: number,
    ) => {
      const incomingPrev = findAssignmentForGuest(incomingGuestId);
      const forward = () =>
        runSaving(async () => {
          await seatingApi.unassign(occupantGuestId);
          await seatingApi.assign({
            table_id: tableId,
            seat_index: seatIndex,
            guest_id: incomingGuestId,
          });
        });
      try {
        await forward();
      } catch {
        toast.error(t("seating.save_failed"));
        await refresh();
        return;
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          await runSaving(async () => {
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
          });
        },
        redo: async () => {
          await forward();
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
    [findAssignmentForGuest, guestById, pushUndo, announceUndoable, t, toast, runSaving],
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
      const forward = () =>
        runSaving(async () => {
          for (const p of placements) {
            await seatingApi.assign({
              table_id: tableId,
              seat_index: p.seatIndex,
              guest_id: p.guestId,
            });
          }
        });
      try {
        await forward();
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
          await runSaving(async () => {
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
          });
        },
        redo: async () => {
          await forward();
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
    [tables, assignments, findAssignmentForGuest, pushUndo, announceUndoable, t, toast, runSaving],
  );

  // Next free "<prefix> <n>" label so adds and copies slot into the same
  // numbered run (Asztal 5, Asztal 6, …).
  function nextTableLabel(): string {
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
    return `${prefix} ${maxN > 0 ? maxN + 1 : tables.length + 1}`;
  }

  // Shared post-create flow: apply the row, select it, pulse a halo on the
  // canvas and scroll it into view so the user sees where it landed, and
  // register an id-tracking undo/redo pair (redo recreates under a NEW id,
  // so the closure keeps its own pointer).
  function afterCreate(
    envelope: SeatingTableEnvelope,
    payload: Parameters<typeof seatingApi.createTable>[0],
  ) {
    applyTable(envelope.table);
    notifyClamp(envelope);
    setSelectedId(envelope.table.id);
    highlightTable(envelope.table.id);
    let currentId = envelope.table.id;
    pushUndo({
      label: t("seating.undo_label"),
      undo: async () => {
        await runSaving(() => seatingApi.removeTable(currentId));
        dropTableFromState(currentId);
      },
      redo: async () => {
        const res = await runSaving(() => seatingApi.createTable(payload));
        currentId = res.table.id;
        applyTable(res.table);
      },
    });
    publish("seating:changed");
  }

  // Brief halo on a newly-created table + scroll it into view.
  function highlightTable(id: number) {
    setJustCreatedId(id);
    if (justCreatedTimerRef.current) clearTimeout(justCreatedTimerRef.current);
    justCreatedTimerRef.current = setTimeout(() => setJustCreatedId(null), 1600);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-seating-table="${id}"]`);
      if (el instanceof Element) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  async function addTable() {
    // Drop new tables near the centre of the room with a small per-table
    // offset so consecutive adds don't stack on top of each other.
    const offset = (tables.length % 5) * 800;
    const payload = {
      label: nextTableLabel(),
      shape: "round" as TableShape,
      seats: 8,
      x_mm: roomWidthMm / 2 + offset - 1600,
      y_mm: roomHeightMm / 2,
      width_mm: 1500,
      length_mm: 1500,
    };
    try {
      const res = await runSaving(() => seatingApi.createTable(payload));
      afterCreate(res, payload);
    } catch {
      toast.error(t("seating.save_failed"));
    }
  }

  async function duplicateTable(source: SeatingTable) {
    // Copy the FULL configuration — dropping disabled/baby seats used to
    // silently produce a copy with more usable chairs than the original.
    const payload = {
      label: nextTableLabel(),
      shape: source.shape,
      seats: source.seats,
      x_mm: clampToRoom(source.x_mm + 800, roomWidthMm),
      y_mm: clampToRoom(source.y_mm + 800, roomHeightMm),
      width_mm: source.width_mm,
      length_mm: source.length_mm,
      rotation_deg: source.rotation_deg,
      disabled_seats: source.disabled_seats ?? [],
      baby_seats: source.baby_seats ?? [],
      is_kids_table: source.is_kids_table,
    };
    try {
      const res = await runSaving(() => seatingApi.createTable(payload));
      afterCreate(res, payload);
      announceUndoable(t("seating.toast_duplicated").replace("{table}", res.table.label));
    } catch {
      toast.error(t("seating.save_failed"));
    }
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
    // Snapshot the row AND its seat assignments so undo can rebuild the
    // table (under a new id) with everyone back in their seats.
    const snapshot = { ...table };
    const seated = assignments
      .filter((a) => a.table_id === table.id)
      .map((a) => ({ seat_index: a.seat_index, guest_id: a.guest_id }));
    let currentId = table.id;
    try {
      await runSaving(() => seatingApi.removeTable(table.id));
    } catch {
      toast.error(t("seating.save_failed"));
      return;
    }
    dropTableFromState(table.id);
    if (selectedId === table.id) setSelectedId(null);
    pushUndo({
      label: t("seating.undo_label"),
      undo: async () => {
        const res = await runSaving(() =>
          seatingApi.createTable({
            label: snapshot.label,
            shape: snapshot.shape,
            seats: snapshot.seats,
            x_mm: snapshot.x_mm,
            y_mm: snapshot.y_mm,
            width_mm: snapshot.width_mm,
            length_mm: snapshot.length_mm,
            rotation_deg: snapshot.rotation_deg,
            disabled_seats: snapshot.disabled_seats ?? [],
            baby_seats: snapshot.baby_seats ?? [],
            is_kids_table: snapshot.is_kids_table,
          }),
        );
        currentId = res.table.id;
        applyTable(res.table);
        for (const s of seated) {
          await runSaving(() =>
            seatingApi.assign({
              table_id: currentId,
              seat_index: s.seat_index,
              guest_id: s.guest_id,
            }),
          );
        }
      },
      redo: async () => {
        await runSaving(() => seatingApi.removeTable(currentId));
        dropTableFromState(currentId);
      },
    });
    announceUndoable(t("seating.toast_table_deleted").replace("{table}", snapshot.label));
    publish("seating:changed");
  }

  // Toast the server's seat-clamp diagnostic: the request asked for more
  // chairs than the footprint fits, and the row came back shrunk. Without
  // this the clamp is a silent no-op the user can only guess at.
  const notifyClamp = useCallback(
    (envelope: SeatingTableEnvelope) => {
      if (!envelope.seats_clamped) return;
      toast.error(
        t("seating.seats_clamped_toast")
          .replace("{n}", String(envelope.table.seats))
          .replace("{m}", String(envelope.seats_requested ?? envelope.table.seats)),
      );
    },
    [toast, t],
  );

  const toastPatchError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("seating.save_conflict"));
      } else if (
        e instanceof ApiError &&
        e.status === 400 &&
        (e.detail as { code?: string } | undefined)?.code === "table_too_small"
      ) {
        toast.error(t("seating.table_too_small"));
      } else if (
        e instanceof ApiError &&
        e.status === 400 &&
        (e.detail as { code?: string } | undefined)?.code === "seat_occupied"
      ) {
        toast.error(t("seating.seat_occupied"));
      } else {
        toast.error(t("seating.save_failed"));
      }
    },
    [toast, t],
  );

  // Bare field-PATCH used by undo/redo replays: partial body, freshest
  // ETag, response applied to state. Throws on failure so the caller's
  // catch can toast undo_failed/redo_failed.
  const patchTableFields = useCallback(
    async (id: number, fields: Partial<SeatingTable>) => {
      const ifMatch = latestUpdatedAtRef.current.get(id);
      const res = await runSaving(() =>
        seatingApi.updateTable(id, fields, ifMatch !== undefined ? { ifMatch } : {}),
      );
      applyTable(res.table);
    },
    [applyTable, runSaving],
  );

  /** Send only the changed fields, serialized per table, with the freshest
   *  known ETag. On a 409 we retry ONCE against the timestamp the server
   *  reports — the overwhelmingly common cause is our own just-landed write
   *  (blur-committed resize + immediate click), not a second editor. Only a
   *  second 409 surfaces the "someone else edited" toast. Returns true when
   *  the write landed so callers can gate their success toasts. */
  async function patchTable(table: SeatingTable, patch: Partial<SeatingTable>): Promise<boolean> {
    const id = table.id;
    let ok = false;
    const job = async () => {
      const current = tablesRef.current.find((tb) => tb.id === id) ?? table;
      const before: Partial<SeatingTable> = {};
      for (const key of Object.keys(patch) as (keyof SeatingTable)[]) {
        (before as Record<string, unknown>)[key] = (current as unknown as Record<string, unknown>)[
          key
        ];
      }
      const send = async (ifMatch: number) => {
        const res = await runSaving(() => seatingApi.updateTable(id, patch, { ifMatch }));
        applyTable(res.table);
        notifyClamp(res);
      };
      try {
        await send(latestUpdatedAtRef.current.get(id) ?? current.updated_at);
      } catch (e) {
        const staleAt =
          e instanceof ApiError && e.status === 409
            ? (e.detail as { current_updated_at?: number } | undefined)?.current_updated_at
            : undefined;
        if (staleAt !== undefined) {
          try {
            await send(staleAt);
          } catch (e2) {
            toastPatchError(e2);
            await refresh();
            return;
          }
        } else {
          toastPatchError(e);
          await refresh();
          return;
        }
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: () => patchTableFields(id, before),
        redo: () => patchTableFields(id, patch),
      });
      publish("seating:changed");
      ok = true;
    };
    const prev = patchChainsRef.current.get(id) ?? Promise.resolve();
    const chained = prev.then(job, job);
    patchChainsRef.current.set(id, chained);
    await chained;
    return ok;
  }

  async function moveTable(id: number, x_mm: number, y_mm: number) {
    const table = tables.find((tb) => tb.id === id);
    if (!table) return;
    if (table.x_mm === x_mm && table.y_mm === y_mm) return;
    const ok = await patchTable(table, { x_mm, y_mm });
    if (ok) announceUndoable(t("seating.toast_moved").replace("{table}", table.label));
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
        await patchTableFields(m.table.id, { x_mm: m.x_mm, y_mm: m.y_mm });
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
            await patchTableFields(prev.id, { x_mm: prev.x_mm, y_mm: prev.y_mm });
          } catch {
            /* surface via the refresh that popAndUndo runs */
          }
        }
      },
      redo: async () => {
        for (const m of moves) {
          try {
            await patchTableFields(m.table.id, { x_mm: m.x_mm, y_mm: m.y_mm });
          } catch {
            /* surface via the refresh that popAndRedo runs */
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
    const ok = await patchTable(table, { width_mm, length_mm });
    if (!ok) return;
    announceUndoable(t("seating.toast_resized").replace("{table}", table.label));
    // If the bigger footprint fits more chairs than the table currently
    // has, surface a one-tap "add them" prompt in the editor panel instead
    // of leaving the extra capacity as trivia in the stepper cap.
    const capAfter = Math.min(MAX_TABLE_SEATS, maxSeatsForTable(table.shape, width_mm, length_mm));
    const extra = capAfter - table.seats;
    setFitPrompt(extra > 0 ? { tableId: id, extra } : null);
  }

  async function changeSeats(id: number, delta: number) {
    const table = tables.find((tb) => tb.id === id);
    if (!table) return;
    const cap = Math.min(
      MAX_TABLE_SEATS,
      maxSeatsForTable(table.shape, table.width_mm, table.length_mm),
    );
    const requested = table.seats + delta;
    // User clicked + but the table is already full at the 80 cm pitch.
    // Surface the constraint as a toast so they know to widen the table
    // before adding another seat (instead of guessing why + is greyed out).
    // When crossed-out seats exist, re-enabling one is the cheaper fix, so
    // say that instead.
    if (delta > 0 && requested > cap) {
      toast.error(
        (table.disabled_seats?.length ?? 0) > 0
          ? t("seating.seats_at_cap_reenable")
          : t("seating.seats_at_cap"),
      );
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
    async (tableId: number, seatIndex: number, at?: { x: number; y: number }) => {
      if (selectedHouseholdId !== null) {
        const ids = unassigned
          .filter((g) => g.household_id === selectedHouseholdId)
          .map((g) => g.id);
        setSelectedHouseholdId(null);
        if (ids.length > 0) await placeHouseholdAtSeat(tableId, seatIndex, ids);
        return;
      }
      if (selectedGuestId === null) {
        // No guest selected — tap on an occupied seat selects that guest;
        // tap on an EMPTY seat opens the inline guest picker right there,
        // so seat-first placement works without hunting the side panel.
        const occ = findAssignmentAtSeat(tableId, seatIndex);
        if (occ) {
          setSelectedGuestId(occ.guest_id);
        } else {
          setSeatPicker({
            tableId,
            seatIndex,
            x: at?.x ?? window.innerWidth / 2,
            y: at?.y ?? window.innerHeight / 3,
          });
        }
        return;
      }
      const guestId = selectedGuestId;
      // Tapping the same chair the selected guest already occupies → unassign.
      const currentSeat = findAssignmentForGuest(guestId);
      if (currentSeat?.table_id === tableId && currentSeat?.seat_index === seatIndex) {
        setSelectedGuestId(null);
        await unassignGuest(guestId);
        return;
      }
      setSelectedGuestId(null);
      await requestAssign(tableId, seatIndex, guestId);
    },
    [
      selectedGuestId,
      selectedHouseholdId,
      unassigned,
      findAssignmentAtSeat,
      findAssignmentForGuest,
      unassignGuest,
      requestAssign,
      placeHouseholdAtSeat,
    ],
  );

  // Global keyboard handlers: Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z (or
  // Cmd/Ctrl+Y) redo, "?" opens the shortcuts sheet.
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
      if (mod && ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        popAndRedo();
        return;
      }
      // "/" jumps to the guest search box (seat mode).
      if (e.key === "/" && !mod) {
        if (guestSearchRef.current) {
          e.preventDefault();
          guestSearchRef.current.focus();
        }
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
  }, [popAndUndo, popAndRedo]);

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
      {/* Single toolbar row: title (left) → tabs (flex-1) → icon strip + add table (right) */}
      <div className="seating-toolbar mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="shrink-0">
          <h1 className="font-grotesk">{t("seating.title")}</h1>
          <LastUpdatedBy actionPrefixes={["table.", "seat.", "conflict."]} />
        </div>

        {/* Mode tabs — stretch to fill the remaining space */}
        <div
          role="tablist"
          data-tour-target="seating-modes"
          className="flex flex-1 overflow-hidden rounded-xl border border-ink-300 bg-paper-50 dark:border-umber-600 dark:bg-umber-800"
        >
          {(["edit", "seat"] as const).map((m) => {
            const label = m === "edit" ? t("seating.mode_edit_tab") : t("seating.mode_seat_tab");
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                title={label}
                className={`flex-1 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
                  mode === m
                    ? "bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                    : "text-ink-600 hover:bg-paper-100 dark:text-umber-200 dark:hover:bg-umber-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Autosave status — quiet chip that answers "did my change stick?"
            without a toast per drag. */}
        <SaveStatusChip
          pending={pendingSaves > 0}
          failed={saveFailed}
          savedFlash={savedFlash}
          t={t}
        />

        {/* Undo / redo — available in BOTH modes (moves and resizes are just
            as undoable as seat assignments). Icon-only to stay compact. */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-ink-300 p-1.5 text-ink-700 transition-colors hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-umber-600 dark:text-paper-200 dark:hover:bg-umber-700"
            onClick={popAndUndo}
            disabled={undoStack.length === 0}
            aria-label={t("seating.undo_action")}
            title={t("seating.undo_action")}
          >
            <Undo2 size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-ink-300 p-1.5 text-ink-700 transition-colors hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-umber-600 dark:text-paper-200 dark:hover:bg-umber-700"
            onClick={popAndRedo}
            disabled={redoStack.length === 0}
            aria-label={t("seating.redo_action")}
            title={t("seating.redo_action")}
          >
            <Redo2 size={15} aria-hidden />
          </button>
        </div>

        {mode === "edit" ? (
          // Edit mode right section — matches the w-[280px] right panel below
          // on large screens; shrinks to content below that so the mode tabs
          // never starve and clip their labels.
          <div className="flex shrink-0 items-center justify-end gap-2 lg:w-[280px]">
            {/* Icon-only action strip */}
            <div
              data-tour-target="seating-export"
              className="flex shrink-0 items-stretch divide-x divide-ink-300 overflow-hidden rounded-xl border border-ink-300 bg-paper-50 dark:divide-umber-600 dark:border-umber-600 dark:bg-umber-800"
            >
              <PrintChartMenu
                disabled={previewLoading !== null}
                onPick={(format) =>
                  requestDownload(
                    `/api/print/seating/${format}?room_w=${roomWidthMm}&room_h=${roomHeightMm}`,
                    `weddly-seating-${format}.pdf`,
                    format === "a4" ? t("seating.print_a4") : t("seating.print_a3"),
                  )
                }
                onPlaceCards={() =>
                  requestDownload(
                    "/api/print/place-cards",
                    "weddly-place-cards.pdf",
                    t("seating.print_place_cards"),
                  )
                }
                grouped
              />
              <button
                type="button"
                className="icon-group-item"
                onClick={arrangeTablesSymmetrically}
                disabled={tables.length === 0}
                aria-label={t("seating.arrange_button_label")}
                title={t("seating.arrange_button_label")}
              >
                <LayoutGrid size={16} aria-hidden />
              </button>
            </div>
            {previewLoading !== null && (
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={cancelDownload}
                aria-label={t("seating.pdf_cancel")}
              >
                {t("seating.pdf_cancel")}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={addTable}>
              <Plus size={16} /> {t("seating.add_table")}
            </button>
          </div>
        ) : (
          // Seat mode right section mirrors the w-[280px] unassigned panel
          // below on large screens; content-sized under that.
          <div className="flex shrink-0 items-center justify-end gap-2 lg:w-[280px]">
            {!coarsePointer && (
              <button
                type="button"
                className={`inline-flex items-center justify-center gap-1 rounded-lg border p-1.5 transition-colors ${
                  tapModeUser
                    ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
                    : "border-ink-300 bg-transparent text-ink-900 hover:bg-ink-50 dark:border-umber-600 dark:text-paper-200 dark:hover:bg-umber-700"
                }`}
                onClick={() => {
                  setTapModeUser((v) => {
                    const next = !v;
                    setA11yMessage(
                      next ? t("seating.tap_mode_announce_on") : t("seating.tap_mode_announce_off"),
                    );
                    return next;
                  });
                  setSelectedGuestId(null);
                }}
                aria-pressed={tapModeUser}
                aria-label={tapModeUser ? t("seating.tap_mode_off") : t("seating.tap_mode_on")}
                title={tapModeUser ? t("seating.tap_mode_off") : t("seating.tap_mode_on")}
              >
                <Hand size={15} aria-hidden />
                <span className="hidden text-xs font-medium sm:inline">
                  {t("seating.tap_mode_short")}
                </span>
              </button>
            )}
            {selectedGuestId !== null && (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg border border-ink-300 bg-transparent p-1.5 text-ink-900 transition-colors hover:bg-ink-50 dark:border-umber-600 dark:text-paper-200 dark:hover:bg-umber-700"
                onClick={async () => {
                  const id = selectedGuestId;
                  setSelectedGuestId(null);
                  await unassignGuest(id);
                }}
                aria-label={t("seating.seat_unassign_selected")}
                title={t("seating.seat_unassign_selected")}
              >
                <Undo2 size={15} aria-hidden />
              </button>
            )}
            <Link
              to="/app/guests"
              className="inline-flex items-center justify-center gap-0.5 rounded-lg border border-ink-300 bg-transparent p-1.5 text-ink-900 transition-colors hover:bg-ink-50 dark:border-umber-600 dark:text-paper-200 dark:hover:bg-umber-700"
              aria-label={t("seating.go_to_guests")}
              title={t("seating.go_to_guests")}
            >
              <Users size={15} aria-hidden />
              <ExternalLink size={11} aria-hidden />
            </Link>
          </div>
        )}
      </div>

      {tables.length === 0 ? (
        // Empty-state action card — always shows; in seat mode the user
        // needs to switch to Edit first to add tables.
        <div className="card stationery">
          <div className="text-center">
            <Armchair size={28} className="mx-auto text-ink-500 dark:text-umber-300" />
            <h3 className="mt-3 text-base font-semibold">{t("seating.no_tables")}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-600 dark:text-umber-200">
              {guests.length === 0
                ? t("seating.empty_body_no_guests")
                : t("seating.add_first_table")}
            </p>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {guests.length === 0 ? (
              <>
                <Link to="/app/guests" className="btn-primary">
                  <Users size={16} aria-hidden /> {t("seating.empty_cta_add_guests")}
                </Link>
                <button type="button" className="btn-outline" onClick={addTable}>
                  <Plus size={16} aria-hidden /> {t("seating.empty_cta_fallback_table")}
                </button>
              </>
            ) : (
              <button type="button" className="btn-primary" onClick={addTable}>
                <Plus size={16} aria-hidden /> {t("seating.empty_cta_add_table")}
              </button>
            )}
          </div>
        </div>
      ) : mode === "edit" ? (
        // ── EDIT MODE ────────────────────────────────────────────────────────
        // md+: full-height row, map flex-1 + fixed-width editor column.
        // Below md: stacked column — capped-height canvas on top (tap mode is
        // force-enabled on coarse pointers), editor card below at natural
        // height, page scrolls normally.
        <div className="flex flex-col gap-4 md:h-[calc(100vh-196px)] md:flex-row">
          <div data-tour-target="seating-canvas" className="h-[52vh] min-w-0 md:h-auto md:flex-1">
            <SeatingMap
              tables={tables}
              assignments={assignments}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={moveTable}
              onResize={resizeTable}
              onRotate={(id, deg) => {
                const tbl = tables.find((tb) => tb.id === id);
                if (tbl && tbl.rotation_deg !== deg) patchTable(tbl, { rotation_deg: deg });
              }}
              onSeatsChange={changeSeats}
              onDeleteTable={(id) => {
                const tbl = tables.find((tb) => tb.id === id);
                if (tbl) deleteTable(tbl);
              }}
              onAddTable={addTable}
              unassignedHighlight={false}
              roomWidthMm={roomWidthMm}
              roomHeightMm={roomHeightMm}
              onRoomChange={updateRoom}
              babySeatsByTable={babySeatsByTable}
              seatGuestsByTable={seatGuestsByTable}
              highlightId={justCreatedId}
              aisleWarnIds={aisleWarnIds}
              fullHeight
            />
          </div>
          <div className="w-full shrink-0 md:w-[280px]">
            <TableEditor
              table={selected}
              onPatch={(patch) => selected && patchTable(selected, patch)}
              onDelete={() => selected && deleteTable(selected)}
              onDuplicate={() => selected && duplicateTable(selected)}
              onRotate={() => selected && rotateTable(selected)}
              onSeatsAtCap={() => toast.error(t("seating.seats_at_cap"))}
              showFitPrompt={fitPrompt !== null && fitPrompt.tableId === selected?.id}
              onDismissFit={() => setFitPrompt(null)}
              onAcceptFit={async (nextSeats) => {
                setFitPrompt(null);
                if (selected) await patchTable(selected, { seats: nextSeats });
              }}
              t={t}
            />
          </div>
        </div>
      ) : (
        // ── SEAT MODE ────────────────────────────────────────────────────────
        // Full-height map + compact unassigned panel on the right. TableCard
        // grid appears below (scroll down) for the classic per-table view.
        <>
          <div className="flex flex-col gap-4 md:h-[calc(100vh-200px)] md:flex-row">
            {/* Map: flex-1 so it takes all remaining width on md+; capped
              height stacked on phones (the TableCard grid below is the
              primary mobile assignment surface). */}
            <div data-tour-target="seating-canvas" className="h-[45vh] min-w-0 md:h-auto md:flex-1">
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
                highlightId={justCreatedId}
                seatMode
                seatGuestsByTable={seatGuestsByTable}
                onDropSeat={dropToSeat}
                onTapSeat={handleTapSeat}
                tapMode={tapMode}
                selectedGuestId={selectedGuestId}
                onChairDragStart={(_, __, guestId) => startSeatedDrag(guestId)}
                onSeatDrop={(tableId, seatIndex, guestId) => {
                  draggingSeatedRef.current = null;
                  setDraggingSeatedId(null);
                  setUnassignedHover(false);
                  requestAssign(tableId, seatIndex, guestId);
                }}
                onSeatRelease={(guestId) => {
                  draggingSeatedRef.current = null;
                  setDraggingSeatedId(null);
                  setUnassignedHover(false);
                  unassignGuest(guestId);
                }}
                onChairDragFinish={() => {
                  draggingSeatedRef.current = null;
                  setDraggingSeatedId(null);
                  setUnassignedHover(false);
                }}
              />
            </div>

            {/* Right panel — shows selected table roster or unassigned list. */}
            {selectedId !== null && selected ? (
              <TableSeatPanel
                table={selected}
                seatGuests={seatGuestsByTable.get(selectedId)}
                candidates={unseatedCandidates}
                onAssign={(seatIndex, guestId) => requestAssign(selectedId, seatIndex, guestId)}
                onUnassign={unassignGuest}
                onClose={() => setSelectedId(null)}
                t={t}
              />
            ) : (
              <aside
                data-tour-target="seating-unassigned"
                className={`w-full shrink-0 rounded-xl border bg-paper-50 p-3 transition-colors md:w-[280px] dark:bg-umber-900 ${
                  draggingSeatedId !== null
                    ? unassignedHover
                      ? "border-blush-500 bg-blush-50 ring-2 ring-blush-400 dark:bg-blush-400/15"
                      : "border-blush-300 ring-2 ring-blush-200 ring-dashed dark:border-blush-400/40 dark:ring-blush-400/30"
                    : "border-paper-200 dark:border-umber-700"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggingSeatedId !== null && !unassignedHover) setUnassignedHover(true);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setUnassignedHover(false);
                }}
                onDrop={(e) => {
                  setUnassignedHover(false);
                  dropToUnassigned(e);
                }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                    {t("seating.seat_mode_panel_title")}
                  </h2>
                  {unassigned.length + partnerSlots.length > 0 && (
                    <span className="rounded-full bg-ink-900 px-1.5 py-0.5 text-[10px] font-bold text-paper-50 dark:bg-paper-50 dark:text-ink-900">
                      {unassigned.length + partnerSlots.length}
                    </span>
                  )}
                </div>
                <p className="mb-2 text-[11px] text-ink-500 dark:text-umber-300">
                  {draggingSeatedId !== null
                    ? unassignedHover
                      ? t("seating.drop_to_unassign_active")
                      : t("seating.drop_to_unassign")
                    : selectedGuestId !== null
                      ? t("seating.seat_tap_place").replace(
                          "{guest}",
                          guestById.get(selectedGuestId)?.full_name ?? "",
                        )
                      : t("seating.drag_help")}
                </p>
                <SeatPanelProgress
                  progress={seatingProgress(eligibleGuestCount, eligibleSeatedCount)}
                  t={t}
                />
                {/* Capacity line: enough chairs for everyone who said yes? */}
                {totalChairs > 0 && (
                  <p
                    className={`mb-1.5 text-[11px] tabular-nums ${
                      totalChairs < confirmedGuests
                        ? "font-medium text-blush-700 dark:text-blush-300"
                        : "text-ink-500 dark:text-umber-300"
                    }`}
                  >
                    {t("seating.capacity_line")
                      .replace("{chairs}", String(totalChairs))
                      .replace("{confirmed}", String(confirmedGuests))}
                  </p>
                )}
                {declinedSeatedCount > 0 && (
                  <p className="mb-1.5 rounded-md bg-blush-50 px-2 py-1 text-[11px] text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
                    {t("seating.declined_seated_warning").replace(
                      "{n}",
                      String(declinedSeatedCount),
                    )}
                  </p>
                )}
                {/* Guest search — accent-insensitive, "/" focuses. */}
                <div className="relative mb-2">
                  <Search
                    size={13}
                    aria-hidden
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-400"
                  />
                  <input
                    ref={guestSearchRef}
                    type="search"
                    value={guestQuery}
                    onChange={(e) => setGuestQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.currentTarget.blur();
                        setGuestQuery("");
                      }
                    }}
                    placeholder={t("seating.guest_search_placeholder")}
                    aria-label={t("seating.guest_search_placeholder")}
                    className="w-full rounded-lg border border-paper-300 bg-paper-50 py-1 pl-7 pr-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-ink-700 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:placeholder:text-umber-400 dark:focus:border-paper-100"
                  />
                </div>
                {declinedUnseatedCount > 0 && (
                  <button
                    type="button"
                    className="mb-2 text-[11px] text-ink-500 underline decoration-dotted underline-offset-2 hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
                    onClick={() => setShowDeclined((v) => !v)}
                    aria-pressed={showDeclined}
                  >
                    {(showDeclined
                      ? t("seating.hide_declined_toggle")
                      : t("seating.show_declined_toggle")
                    ).replace("{n}", String(declinedUnseatedCount))}
                  </button>
                )}
                {guests.length > 0 && unassigned.length === 0 && partnerSlots.length === 0 ? (
                  <p className="mt-3 text-xs text-ink-500 dark:text-umber-300">
                    {t("seating.no_unassigned")}
                  </p>
                ) : (
                  <ul
                    className="space-y-2 overflow-y-auto overscroll-contain pl-1 pt-1.5"
                    style={{ maxHeight: "calc(100vh - 320px)" }}
                  >
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
                    {guestQuery.trim() !== "" && unassignedEntries.length === 0 && (
                      <li className="px-1 py-2 text-xs text-ink-500 dark:text-umber-300">
                        {t("seating.guest_search_empty")}
                      </li>
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
            )}
          </div>

          {/* TableCard grid — scroll down to see per-table seat assignments */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
        </>
      )}

      {preview && (
        <Dialog
          open={true}
          title={`${t("seating.preview_title")}: ${preview.label}`}
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
            /* `h-[85vh]` on phones leaves room for the close + open-in-tab
             * fallback while still giving readers a usable preview window;
             * `sm:h-[70vh]` keeps laptop screens from going almost full-
             * height. */
            className="block h-[85vh] w-full rounded-xl border border-paper-300 bg-paper-50 sm:h-[70vh] dark:border-umber-700 dark:bg-umber-900"
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
            <ShortcutRow keys={["R", "Shift+R"]} label={t("seating.shortcut_rotate")} />
            <ShortcutRow keys={["Cmd/Ctrl", "+", "−", "0"]} label={t("seating.shortcut_zoom")} />
            <ShortcutRow keys={["Cmd/Ctrl", "Z"]} label={t("seating.shortcut_undo")} />
            <ShortcutRow keys={["Shift", "Cmd/Ctrl", "Z"]} label={t("seating.shortcut_redo")} />
          </ul>
        </Dialog>
      )}

      {seatPicker && (
        <SeatPickerPopover
          at={seatPicker}
          tableLabel={tables.find((tb) => tb.id === seatPicker.tableId)?.label ?? ""}
          pool={[...partnerSlots.flatMap((s) => (s.guest ? [s.guest] : [])), ...unassigned]}
          onPick={async (guestId) => {
            const p = seatPicker;
            setSeatPicker(null);
            await requestAssign(p.tableId, p.seatIndex, guestId);
          }}
          onClose={() => setSeatPicker(null)}
          t={t}
        />
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

// Seating progress, folded into the unassigned ("Nincs helye") panel so it
// doesn't need its own row above the canvas — the panel's count badge already
// carries the remaining number. A slim track + a compact "{seated} / {total}"
// caption. Computed from the pure `seatingProgress` helper so the numbers stay
// honest and unit-testable.
function SeatPanelProgress({
  progress,
  t,
}: {
  progress: ReturnType<typeof seatingProgress>;
  t: ReturnType<typeof useT>["t"];
}) {
  // Nothing to seat yet — skip entirely so an empty workspace doesn't show a
  // confusing "0 / 0".
  if (progress.total === 0) return null;
  return (
    <div className="mb-2.5">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-800"
        role="progressbar"
        aria-valuenow={progress.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("seating.progress_label")
          .replace("{seated}", String(progress.seated))
          .replace("{total}", String(progress.total))}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            progress.complete ? "bg-sage-500 dark:bg-sage-400" : "bg-ink-900 dark:bg-paper-50"
          }`}
          style={{ width: `${Math.max(progress.pct, progress.seated > 0 ? 4 : 0)}%` }}
        />
      </div>
      <p
        className={`mt-1.5 text-[11px] tabular-nums ${
          progress.complete
            ? "text-sage-600 dark:text-sage-300"
            : "text-ink-500 dark:text-umber-300"
        }`}
      >
        {progress.complete
          ? t("seating.progress_done")
          : t("seating.progress_label")
              .replace("{seated}", String(progress.seated))
              .replace("{total}", String(progress.total))}
      </p>
    </div>
  );
}

// Inline guest picker, opened by clicking an EMPTY chair when no guest is
// armed. A small anchored card with an autofocused search + the unassigned
// pool; picking a guest routes through the same conflict-aware assign as
// drag-and-drop. Escape or outside-click closes without touching anything.
function SeatPickerPopover({
  at,
  tableLabel,
  pool,
  onPick,
  onClose,
  t,
}: {
  at: { x: number; y: number; seatIndex: number };
  tableLabel: string;
  pool: Guest[];
  onPick: (guestId: number) => void;
  onClose: () => void;
  t: ReturnType<typeof useT>["t"];
}) {
  const [query, setQuery] = useState("");
  const q = normalizeName(query.trim());
  const matches = q ? pool.filter((g) => normalizeName(g.full_name).includes(q)) : pool;
  // Clamp the card inside the viewport (280 × ~320 px card).
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 296));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 340));
  return (
    <div
      className="fixed inset-0 z-[70]"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={t("seating.seat_picker_title")
          .replace("{table}", tableLabel)
          .replace("{seat}", String(at.seatIndex + 1))}
        className="absolute flex w-[280px] flex-col overflow-hidden rounded-xl border border-paper-300 bg-paper-50 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="border-b border-paper-200 px-3 py-2 text-xs font-semibold text-ink-900 dark:border-umber-700 dark:text-paper-50">
          {t("seating.seat_picker_title")
            .replace("{table}", tableLabel)
            .replace("{seat}", String(at.seatIndex + 1))}
        </p>
        <div className="relative border-b border-paper-200 dark:border-umber-700">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-400"
          />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("seating.guest_search_placeholder")}
            aria-label={t("seating.guest_search_placeholder")}
            className="w-full bg-transparent py-2 pl-8 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none dark:text-paper-50 dark:placeholder:text-umber-400"
          />
        </div>
        <ul className="max-h-56 overflow-y-auto overscroll-contain p-1">
          {matches.length === 0 && (
            <li className="px-2 py-2 text-xs text-ink-500 dark:text-umber-300">
              {t("seating.guest_search_empty")}
            </li>
          )}
          {matches.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink-800 transition-colors hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
                onClick={() => onPick(g.id)}
              >
                {g.kind === "baby" && (
                  <Baby size={13} aria-hidden className="shrink-0 text-blush-500" />
                )}
                <span className="min-w-0 flex-1 truncate">{g.full_name}</span>
                {g.dietary && (
                  <Wheat
                    size={12}
                    aria-hidden
                    className="shrink-0 text-umber-500 dark:text-umber-300"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Quiet autosave chip in the toolbar. Three states: saving (spinner),
// saved (check, fades ~2s after the queue settles), failed (persists until
// the next successful save). Renders nothing when idle so the toolbar stays
// clean; role="status" lets screen readers hear the transitions.
function SaveStatusChip({
  pending,
  failed,
  savedFlash,
  t,
}: {
  pending: boolean;
  failed: boolean;
  savedFlash: boolean;
  t: ReturnType<typeof useT>["t"];
}) {
  return (
    <span
      role="status"
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] ${
        failed && !pending
          ? "text-blush-700 dark:text-blush-300"
          : "text-ink-500 dark:text-umber-300"
      }`}
    >
      {pending ? (
        <>
          <Loader2 size={12} aria-hidden className="animate-spin" />
          {t("seating.autosave_saving")}
        </>
      ) : failed ? (
        t("seating.autosave_failed")
      ) : savedFlash ? (
        <>
          <Check size={12} aria-hidden />
          {t("seating.autosave_saved")}
        </>
      ) : null}
    </span>
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
  showFitPrompt,
  onDismissFit,
  onAcceptFit,
  t,
}: {
  table: SeatingTable | null;
  onPatch: (patch: Partial<SeatingTable>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRotate: () => void;
  /** Fires when the user clicks + on the seats stepper while at the cap. */
  onSeatsAtCap: () => void;
  /** True right after a resize grew the seat cap past the current count. */
  showFitPrompt?: boolean;
  onDismissFit?: () => void;
  /** Accepts the fit prompt with the target seat count. */
  onAcceptFit?: (nextSeats: number) => void;
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
  // Live seat cap: geometry bound + the server's hard 1-40 range.
  const seatCap = Math.min(
    MAX_TABLE_SEATS,
    maxSeatsForTable(table.shape, table.width_mm, table.length_mm),
  );
  // Recomputed live so a stepper change or another resize keeps the prompt
  // honest (it hides itself the moment no extra chairs fit).
  const fitExtra = showFitPrompt ? seatCap - table.seats : 0;

  // Every control carries its own unit (cm, °, /cap) or is a picture, so the
  // uppercase section captions were pure vertical cost — the panel is a dense
  // instrument now, one glance from label to value.
  return (
    <div className="card space-y-2.5 p-3">
      <EditableHeading
        value={table.label}
        onCommit={(label) => onPatch({ label })}
        subtitle={`${t(`seating.shape_${table.shape}`)} · ${t("seating.seats_count").replace(
          "{n}",
          String(table.seats),
        )}`}
        editAriaLabel={t("seating.table_label_prompt")}
        placeholder={t("seating.table_name_placeholder")}
      />

      {/* Naming nudge — generic "Table 4" labels are a planning smell. While
          the label is still an auto-default we coax the user toward a
          meaningful name; the hint disappears the moment they rename it. */}
      {isDefaultTableLabel(table.label, t("seating.table_default_label")) && (
        <p className="-mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-ink-500 dark:text-umber-300">
          <Pencil
            size={12}
            aria-hidden
            className="mt-0.5 shrink-0 text-ink-400 dark:text-umber-400"
          />
          <span>{t("seating.name_table_hint")}</span>
        </p>
      )}

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

      {/* Seats on the left, rotation on the right: the two dials you nudge
          most, side by side and reachable without scrolling. */}
      <div className="grid grid-cols-2 items-start gap-2">
        <SeatsStepper
          value={table.seats}
          max={seatCap}
          onChange={(n) => {
            if (n !== table.seats) onPatch({ seats: n });
          }}
          onIncDenied={onSeatsAtCap}
          atCapHint={t("seating.seats_at_cap_hint")}
          capTooltip={t("seating.seats_cap_tooltip")
            .replace("{max}", String(seatCap))
            .replace(
              "{size}",
              String(Math.round((hasTwoDims ? table.length_mm : table.width_mm) / 10)),
            )}
          addLabel={t("seating.add_seat")}
          removeLabel={t("seating.remove_seat")}
        />
        <div
          className="flex items-center gap-1"
          title={table.shape === "round" ? t("seating.rotation_round_hint") : undefined}
        >
          <div className="min-w-0 flex-1">
            <SuffixedInput
              suffix="°"
              min={0}
              max={359}
              step={5}
              ariaLabel={t("seating.rotation_label")}
              defaultValue={table.rotation_deg}
              inputKey={`${table.id}-${table.rotation_deg}-rot`}
              onCommit={(deg) => {
                const norm = ((Math.round(deg) % 360) + 360) % 360;
                if (norm !== table.rotation_deg) onPatch({ rotation_deg: norm });
              }}
            />
          </div>
          <button
            type="button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-paper-200 bg-paper-50 text-ink-700 transition-colors hover:bg-paper-100 md:h-8 md:w-8 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700"
            onClick={onRotate}
            aria-label={t("seating.rotate_table")}
            title={t("seating.rotate_table")}
          >
            <RotateCw size={13} aria-hidden />
          </button>
        </div>
      </div>
      {fitExtra > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-sage-300 bg-sage-50 px-2 py-1.5 dark:border-sage-500/40 dark:bg-sage-500/10">
          <p className="flex-1 text-[11px] leading-snug text-sage-700 dark:text-sage-300">
            {t("seating.seats_fit_more_prompt").replace("{n}", String(fitExtra))}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-md bg-sage-600 px-2 py-1 text-[11px] font-semibold text-paper-50 transition-colors hover:bg-sage-700"
            onClick={() => onAcceptFit?.(table.seats + fitExtra)}
          >
            {t("seating.seats_fit_more_action").replace("{n}", String(fitExtra))}
          </button>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-sage-600 hover:bg-sage-100 dark:text-sage-300 dark:hover:bg-sage-500/20"
            onClick={onDismissFit}
            aria-label={t("common.cancel")}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}

      <div>
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
        {/* One-tap catalogue sizes for the current shape. Each chip shows
            the size and how many chairs it fits, teaching the size-seats
            relationship where the decision happens. */}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {TABLE_SIZE_PRESETS[table.shape].map((p) => {
            const active = table.width_mm === p.width_mm && table.length_mm === p.length_mm;
            const cap = Math.min(
              MAX_TABLE_SEATS,
              maxSeatsForTable(table.shape, p.width_mm, p.length_mm),
            );
            const label = hasTwoDims
              ? `${Math.round(p.length_mm / 10)}×${Math.round(p.width_mm / 10)}`
              : table.shape === "round"
                ? `Ø${Math.round(p.width_mm / 10)}`
                : `${Math.round(p.width_mm / 10)}`;
            return (
              <button
                key={`${p.width_mm}x${p.length_mm}`}
                type="button"
                onClick={() => {
                  if (!active) onPatch({ width_mm: p.width_mm, length_mm: p.length_mm });
                }}
                aria-pressed={active}
                title={t("seating.seats_cap_tooltip")
                  .replace("{max}", String(cap))
                  .replace(
                    "{size}",
                    String(Math.round((hasTwoDims ? p.length_mm : p.width_mm) / 10)),
                  )}
                className={`rounded-full border px-2 py-0.5 text-[10px] tabular-nums transition-colors ${
                  active
                    ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
                    : "border-paper-300 bg-paper-50 text-ink-600 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-200 dark:hover:border-umber-500"
                }`}
              >
                {label} cm · {cap}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row actions live as icons with tooltips; the position readout rides
          along on the same line instead of claiming one of its own. */}
      <div className="flex items-center gap-1 border-t border-paper-200 pt-2 dark:border-umber-700">
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-paper-100 md:h-7 md:w-7 dark:text-paper-100 dark:hover:bg-umber-700"
          onClick={onDuplicate}
          aria-label={t("seating.duplicate_table")}
          title={t("seating.duplicate_table")}
        >
          <Copy size={13} aria-hidden />
        </button>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-lg text-blush-700 transition-colors hover:bg-blush-50 md:h-7 md:w-7 dark:text-blush-300 dark:hover:bg-blush-400/15"
          onClick={onDelete}
          aria-label={t("seating.delete_table")}
          title={t("seating.delete_table")}
        >
          <Trash2 size={13} aria-hidden />
        </button>
        <span className="ml-auto truncate text-[10px] lowercase tabular-nums text-ink-400 dark:text-umber-300">
          {t("seating.position_label_full").replace("{x}", xMeters).replace("{y}", yMeters)}
        </span>
      </div>

      {/* Seat-layout preview — click cycles a chair through:
          normal → baby (icon, still seatable) → disabled (×, blocked) →
          normal. Two independent sets on the wire (`disabled_seats`,
          `baby_seats`) keep the model simple. */}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-umber-300">
          {t("seating.layout_enabled_of_total")
            .replace("{enabled}", String(table.seats - (table.disabled_seats?.length ?? 0)))
            .replace("{total}", String(table.seats))}
        </p>
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
      </div>
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
  const chairs = chairOffsets(table.shape, table.seats, rx, ry);
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
            {/* Seat number — small but readable. Kept upright (not
                counter-rotated to the chair) so it reads consistently no
                matter which edge of the table the chair sits on. Skipped
                for disabled seats since the × already fills the centre. */}
            {!isDisabled && (
              <text
                x={px}
                y={py}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-ink-800 font-semibold dark:fill-ink-900"
                style={{ fontSize: 8, pointerEvents: "none" }}
              >
                {i + 1}
              </text>
            )}
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

// Inline-editable heading. Click the title (or the pencil) to edit; commit
// on blur or Enter, cancel on Escape. We avoid a duplicate "name" Field
// because the heading IS the name — one source of truth.
function EditableHeading({
  value,
  onCommit,
  subtitle,
  editAriaLabel,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  subtitle: string;
  editAriaLabel: string;
  placeholder?: string;
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
          placeholder={placeholder}
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
          className="w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 font-grotesk text-xl text-ink-900 focus:border-ink-700 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:focus:border-paper-100"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex w-full items-center gap-2 rounded-lg text-left transition-colors hover:bg-paper-100 dark:hover:bg-umber-700"
          aria-label={editAriaLabel}
        >
          {/* Dotted underline + always-visible pencil so the name reads as
              editable without hunting for a hover state. */}
          <h3 className="flex-1 truncate font-grotesk text-lg leading-tight text-ink-900 underline decoration-paper-400 decoration-dotted underline-offset-4 dark:text-paper-50 dark:decoration-umber-500">
            {value}
          </h3>
          <Pencil
            size={13}
            aria-hidden
            className="text-ink-300 opacity-50 transition-opacity group-hover:opacity-100 dark:text-umber-300"
          />
        </button>
      )}
      <p className="text-[11px] text-ink-500 dark:text-umber-300">{subtitle}</p>
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
  capTooltip,
  addLabel,
  removeLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  /** Fires when the user clicks + at the cap. Parent surfaces a toast. */
  onIncDenied?: () => void;
  max: number;
  /** Inline hint shown only after the user tries to grow past the cap. */
  atCapHint?: string;
  /** Explains where the cap comes from ("max 7 chairs at 200 cm"). */
  capTooltip?: string;
  addLabel?: string;
  removeLabel?: string;
}) {
  const upper = Math.max(1, max);
  const atMax = value >= upper;
  // The hint is an explanation for a blocked action, not an always-on label —
  // show it only once the user actually clicks + at the cap, and clear it as
  // soon as the count or capacity changes (decremented, table resized, or a
  // different table selected).
  const [showAtCapHint, setShowAtCapHint] = useState(false);
  useEffect(() => {
    setShowAtCapHint(false);
  }, [value, upper]);
  const dec = () => onChange(Math.max(1, value - 1));
  // + stays clickable past the cap so the parent can fire a toast — a
  // disabled HTML button swallows the click, leaving the user with no
  // explanation. We mark the button aria-disabled instead.
  const inc = () => {
    if (atMax) {
      setShowAtCapHint(true);
      onIncDenied?.();
      return;
    }
    onChange(value + 1);
  };
  const decDisabled = value <= 1;
  return (
    <div className="block">
      {/* Fills its grid cell so it lines up with the size/rotation fields next
          to it — the -/+ pair sits at the edges, the count in the middle. */}
      <div className="flex h-11 w-full items-center justify-between rounded-lg border border-paper-200 bg-paper-50 px-0.5 md:h-8 dark:border-umber-700 dark:bg-umber-800">
        <button
          type="button"
          onClick={dec}
          disabled={decDisabled}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-700 transition-colors hover:bg-paper-100 disabled:cursor-not-allowed md:h-7 md:w-7 disabled:text-ink-300 disabled:hover:bg-transparent dark:text-paper-100 dark:hover:bg-umber-700 dark:disabled:text-umber-300"
          aria-label={removeLabel ?? "−"}
          title={removeLabel}
        >
          <Minus size={14} aria-hidden />
        </button>
        <span className="text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
          {value}
        </span>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={inc}
            aria-disabled={atMax || undefined}
            className={`grid h-9 w-9 place-items-center rounded-md transition-colors md:h-7 md:w-7 ${
              atMax
                ? "text-ink-300 hover:bg-blush-50 dark:text-umber-300 dark:hover:bg-blush-400/15"
                : "text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
            }`}
            aria-label={addLabel ?? "+"}
            title={addLabel}
          >
            <Plus size={14} aria-hidden />
          </button>
          {/* The cap is real information ("this is all that physically fits"),
              not decoration — expose it to AT and explain it on hover. */}
          <span
            className="cursor-help pr-1.5 text-[11px] tabular-nums text-ink-400 underline decoration-dotted underline-offset-2 dark:text-umber-300"
            title={capTooltip}
            aria-label={capTooltip}
          >
            /{upper}
          </span>
        </div>
      </div>
      {atMax && showAtCapHint && atCapHint && (
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
        /* h-10/md:h-8 matches the seats stepper and the rotate button so the
           whole instrument row reads as one band. */
        className="input h-11 min-h-0 py-0 pr-8 text-base md:h-8 md:text-sm"
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
              "flex h-11 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ink-700 md:h-9",
              active
                ? "border-umber-400 bg-umber-50 dark:border-umber-400 dark:bg-umber-700/40"
                : "border-paper-200 bg-paper-50 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:hover:bg-umber-700",
            ].join(" ")}
          >
            <Icon
              size={18}
              className={
                active ? "text-umber-600 dark:text-umber-300" : "text-ink-500 dark:text-umber-300"
              }
            />
          </button>
        );
      })}
    </div>
  );
}

function TableSeatPanel({
  table,
  seatGuests,
  candidates,
  onAssign,
  onUnassign,
  onClose,
  t,
}: {
  table: SeatingTable;
  seatGuests: Map<number, { id: number; name: string; dietary?: string | null }> | undefined;
  candidates: { id: number; name: string }[];
  onAssign: (seatIndex: number, guestId: number) => void;
  onUnassign: (guestId: number) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const filled = seatGuests?.size ?? 0;
  const disabledSet = new Set(table.disabled_seats ?? []);
  // Which empty seat currently has its inline "seat someone here" typeahead
  // open, plus its live query. Only one picker is open at a time.
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  const [pickQuery, setPickQuery] = useState("");
  const pickInputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = (seatIndex: number) => {
    setOpenSeat(seatIndex);
    setPickQuery("");
  };
  const closePicker = () => {
    setOpenSeat(null);
    setPickQuery("");
  };

  const pickMatches = useMemo(() => {
    const q = normalizeName(pickQuery.trim());
    const rows =
      q === "" ? candidates : candidates.filter((c) => normalizeName(c.name).includes(q));
    return rows.slice(0, 40);
  }, [candidates, pickQuery]);

  // Focus the search box as soon as a picker opens.
  useEffect(() => {
    if (openSeat !== null) pickInputRef.current?.focus();
  }, [openSeat]);

  return (
    <div className="flex w-full shrink-0 flex-col rounded-xl border border-paper-200 bg-paper-50 md:h-full md:w-[280px] dark:border-umber-700 dark:bg-umber-900">
      <div className="flex items-start justify-between gap-2 border-b border-paper-200 px-3 py-2.5 dark:border-umber-700">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900 dark:text-paper-50">
            {table.label || `${table.id}`}
          </p>
          <p className="text-[11px] text-ink-500 dark:text-umber-400">
            {t("seating.table_panel_filled")
              .replace("{filled}", String(filled))
              .replace("{total}", String(table.seats))}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-0.5 shrink-0 rounded p-0.5 text-ink-400 hover:bg-paper-200 hover:text-ink-700 dark:text-umber-400 dark:hover:bg-umber-800 dark:hover:text-paper-100"
          aria-label={t("seating.table_panel_close")}
        >
          <X size={14} />
        </button>
      </div>

      <ol
        className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-2"
        style={{ maxHeight: "calc(100vh - 260px)" }}
      >
        {Array.from({ length: table.seats }, (_, i) => {
          if (disabledSet.has(i)) return null;
          const guest = seatGuests?.get(i) ?? null;
          const picking = openSeat === i;
          return (
            <li
              key={i}
              className={`rounded-lg text-sm ${
                guest
                  ? "flex items-center gap-2 bg-ink-50 px-2 py-1.5 dark:bg-umber-800"
                  : picking
                    ? "bg-paper-100 p-2 dark:bg-umber-850"
                    : "bg-paper-100 dark:bg-umber-850"
              }`}
            >
              {guest ? (
                <>
                  <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-ink-400 dark:text-umber-500">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate font-medium text-ink-900 dark:text-paper-50">
                    {guest.name}
                  </span>
                  {guest.dietary && (
                    <span title={guest.dietary} className="shrink-0">
                      <Wheat
                        size={12}
                        aria-label={guest.dietary}
                        className="text-umber-500 dark:text-umber-300"
                      />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onUnassign(guest.id)}
                    className="shrink-0 rounded p-1.5 text-ink-400 hover:bg-paper-200 hover:text-ink-700 md:p-0.5 dark:text-umber-400 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                    aria-label={t("seating.table_panel_unassign")}
                    title={t("seating.table_panel_unassign")}
                  >
                    <X size={11} />
                  </button>
                </>
              ) : picking ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-ink-400 dark:text-umber-500">
                      {i + 1}
                    </span>
                    <div className="relative flex-1">
                      <Search
                        size={12}
                        aria-hidden
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-400"
                      />
                      <input
                        ref={pickInputRef}
                        type="search"
                        value={pickQuery}
                        onChange={(e) => setPickQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            closePicker();
                          } else if (e.key === "Enter" && pickMatches[0]) {
                            e.preventDefault();
                            onAssign(i, pickMatches[0].id);
                            closePicker();
                          }
                        }}
                        placeholder={t("seating.table_panel_assign_placeholder")}
                        aria-label={t("seating.table_panel_assign_placeholder")}
                        className="w-full rounded-lg border border-paper-300 bg-paper-50 py-1 pl-7 pr-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-ink-700 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:placeholder:text-umber-400 dark:focus:border-paper-100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={closePicker}
                      className="shrink-0 rounded p-1.5 text-ink-400 hover:bg-paper-200 hover:text-ink-700 md:p-0.5 dark:text-umber-400 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                      aria-label={t("seating.table_panel_close")}
                    >
                      <X size={11} />
                    </button>
                  </div>
                  <ul className="ml-7 max-h-44 space-y-0.5 overflow-y-auto overscroll-contain">
                    {candidates.length === 0 ? (
                      <li className="px-2 py-1.5 text-xs text-ink-500 dark:text-umber-300">
                        {t("seating.table_panel_assign_none")}
                      </li>
                    ) : pickMatches.length === 0 ? (
                      <li className="px-2 py-1.5 text-xs text-ink-500 dark:text-umber-300">
                        {t("seating.table_panel_assign_no_match")}
                      </li>
                    ) : (
                      pickMatches.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              onAssign(i, c.id);
                              closePicker();
                            }}
                            className="flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-xs font-medium text-ink-800 hover:bg-umber-100 dark:text-paper-100 dark:hover:bg-umber-700"
                          >
                            <User size={12} className="shrink-0 text-ink-400 dark:text-umber-400" />
                            <span className="truncate">{c.name}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openPicker(i)}
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-paper-200 dark:hover:bg-umber-800"
                  aria-label={t("seating.table_panel_assign_here")}
                  title={t("seating.table_panel_assign_here")}
                >
                  <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-ink-400 dark:text-umber-500">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-xs text-ink-500 dark:text-umber-300">
                    {t("seating.table_panel_empty_seat")}
                  </span>
                  <Plus
                    size={13}
                    className="shrink-0 text-ink-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-umber-400"
                    aria-hidden
                  />
                </button>
              )}
            </li>
          );
        })}
      </ol>
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
  onTapSeat: (tableId: number, seatIndex: number, at?: { x: number; y: number }) => void;
  t: ReturnType<typeof useT>["t"];
}) {
  const seatToAssign = new Map(assignments.map((a) => [a.seat_index, a]));

  return (
    <div
      className={`card !border-ink-800 cursor-pointer transition-shadow ${
        isSelected ? "ring-2 ring-umber-600 dark:ring-umber-400/60" : "hover:shadow-pop"
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
                <h3 className="font-grotesk text-xl">{table.label}</h3>
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
                  // Empty seats are always click targets now (they open the
                  // inline guest picker outside tap mode).
                  const tappable = (tapMode && (selectedGuestId !== null || guest)) || !guest;
                  // Seat <li> is keyboard-actionable too — Enter/Space drops
                  // the currently-selected guest into this seat (mirroring
                  // the tap behaviour). Empty seats are skipped from focus
                  // unless a guest is queued for placement, to avoid a
                  // forest of Tab stops for the keyboard-only user.
                  const seatFocusable = selectedGuestId !== null || guest !== undefined;
                  // When the guest in this seat is the currently-selected
                  // one, lift the highlight ring to the seat <li> so the
                  // whole tile reads as selected — previously the ring sat
                  // on `<DraggableGuest>` and only outlined the text.
                  const seatIsSelected = guest !== undefined && selectedGuestId === guest.id;
                  return (
                    <li
                      key={idx}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDropSeat(table.id, idx, e)}
                      onClick={(e) => {
                        // Tap mode: place/select via the armed payload.
                        // Outside tap mode an EMPTY seat still responds —
                        // it opens the inline guest picker at the click.
                        if (!tapMode && guest) return;
                        e.stopPropagation();
                        onTapSeat(table.id, idx, { x: e.clientX, y: e.clientY });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
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
                          ? `flex items-baseline gap-2 rounded-lg border border-ink-300 bg-paper-50 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:focus-visible:ring-umber-300 ${tappable ? "cursor-pointer" : ""} ${seatIsSelected ? "ring-2 ring-blush-500 dark:ring-blush-400/60" : ""}`
                          : `flex items-baseline gap-2 rounded-lg border border-dashed border-paper-300 bg-paper-100 px-2 py-1.5 text-xs text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-300 dark:focus-visible:ring-umber-300 ${tappable ? "cursor-pointer ring-1 ring-blush-200 dark:ring-blush-400/40" : ""}`
                      }
                    >
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-400 dark:text-umber-300">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
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
                          <span className="inline-flex items-center gap-1 text-ink-400 dark:text-umber-300">
                            <Plus size={11} aria-hidden />
                            {t("seating.empty_seat_add")}
                          </span>
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
            ? "rounded-lg border border-ink-700 bg-transparent px-2 py-1.5 text-sm font-medium text-ink-900 hover:border-ink-900 dark:border-paper-200 dark:bg-transparent dark:text-paper-50 dark:hover:border-paper-50"
            : "rounded-lg border border-paper-300 bg-paper-50 px-2 py-1.5 text-sm text-ink-800 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600",
        tapMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        // In `compact` mode this row sits inside a seat <li> which already
        // shows the selection ring on the whole tile (see TableCard
        // `seatIsSelected`). Drawing the same ring around the text inside
        // would double up + outline only the name — which is the bug
        // flagged in the seat-selection screenshot.
        selected && !compact ? "ring-2 ring-blush-500 dark:ring-blush-400/60" : "",
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
            className="mr-1 inline-block align-text-bottom text-ink-900 dark:text-paper-50"
          />
        ) : (
          <Crown
            size={compact ? 14 : 16}
            aria-hidden
            className="mr-1 inline-block align-text-bottom text-ink-900 dark:text-paper-50"
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
      {/* Supplier badge so vendors (DJ, photographer) stand out in the pool —
          couples usually seat them apart at a supplier table. */}
      {guest.is_supplier && !partnerRole && (
        <Briefcase
          size={compact ? 13 : 15}
          aria-hidden
          className="mr-1 inline-block align-text-bottom text-umber-600 dark:text-umber-300"
        />
      )}
      {guest.full_name}
      {/* Dietary flag — full free-text in the tooltip so the couple can
          seat allergies thoughtfully (kitchen-side tally comes later). */}
      {guest.dietary && (
        <span title={guest.dietary} className="ml-1 inline-block align-text-bottom">
          <Wheat
            size={compact ? 11 : 13}
            aria-label={guest.dietary}
            className="text-umber-500 dark:text-umber-300"
          />
        </span>
      )}
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
        className="absolute bottom-1 left-1.5 top-1 w-0.5 rounded-full bg-blush-400 dark:bg-umber-400"
      />
      {/* Floating count chip on the top-left edge — identifies the
          household at a glance without occupying a row of the card. */}
      <span
        title={ariaLabel}
        className="absolute -left-1 -top-1.5 inline-flex h-4 items-center gap-0.5 rounded-full bg-blush-400 px-1.5 text-[9px] font-bold leading-none text-white shadow-sm dark:bg-umber-400 dark:text-ink-900"
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
        className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 opacity-80 transition-opacity hover:bg-paper-200 hover:text-ink-700 hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-200 dark:hover:bg-umber-700 dark:hover:text-paper-100 dark:focus-visible:ring-umber-300"
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

/** Single print affordance for the seating chart. One Printer button that
 *  opens a small menu with the A4 / A3 paper sizes, replacing the pair of
 *  side-by-side format buttons. Mirrors the click-outside-to-close menu
 *  idiom used by the budget AddLinePicker. */
function PrintChartMenu({
  disabled,
  onPick,
  onPlaceCards,
  grouped,
  iconOnly,
}: {
  disabled: boolean;
  onPick: (format: "a4" | "a3") => void;
  onPlaceCards?: () => void;
  grouped?: boolean;
  iconOnly?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((o) => !o);
  }

  return (
    <div ref={wrapperRef} className="relative flex items-stretch">
      <button
        ref={btnRef}
        type="button"
        className={grouped ? "icon-group-item" : "btn-outline"}
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("seating.print_chart")}
        title={t("seating.print_chart")}
      >
        <Printer size={16} aria-hidden />
        {!iconOnly && <span>{t("seating.print_chart")}</span>}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && dropPos && (
        <div
          role="menu"
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left }}
          className="z-50 w-44 rounded-xl border border-paper-300 bg-white p-2 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          {(["a4", "a3"] as const).map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-800 transition hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
              onClick={() => {
                setOpen(false);
                onPick(format);
              }}
            >
              <Printer size={14} className="text-ink-500 dark:text-umber-300" />
              {format === "a4" ? t("seating.print_format_a4") : t("seating.print_format_a3")}
            </button>
          ))}
          {onPlaceCards && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-800 transition hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
              onClick={() => {
                setOpen(false);
                onPlaceCards();
              }}
            >
              <Printer size={14} className="text-ink-500 dark:text-umber-300" />
              {t("seating.print_place_cards")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
