// Seating page. Two surfaces stacked vertically:
//   1. Floor-plan map at the top — drag tables to position, click to select,
//      edit shape/seats/dimensions in the inline editor panel.
//   2. The seat-assignment grid below — drag guests onto specific seats.
// We trade pixel-perfect placement on the assignment grid for an approachable
// column layout; the map is where pixel-perfect (millimetre) layout lives,
// and that's what the PDF export consumes.

import type { Guest, SeatAssignment, SeatingTable, TableShape } from "@shared/types";
import {
  ChefHat,
  Circle,
  HelpCircle,
  Minus,
  Pencil,
  Plus,
  Printer,
  RectangleHorizontal,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Button, Dialog, useConfirm, useToast } from "../components/ui";
import { fetchPdfBlob, guestApi, seatingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { ROOM_DIMS, SeatingMap } from "./seating/SeatingMap";

const SHAPES: TableShape[] = ["round", "long", "square", "head"];

interface DragData {
  guestId: number;
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
  const confirm = useConfirm();
  const toast = useToast();
  const [tables, setTables] = useState<SeatingTable[]>([]);
  const [assignments, setAssignments] = useState<SeatAssignment[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
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
    const [plan, gs] = await Promise.all([seatingApi.plan(), guestApi.list()]);
    setTables(plan.tables);
    setAssignments(plan.assignments);
    setGuests(gs.guests);
  }

  useEffect(() => {
    refresh();
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
  const unassigned = useMemo(() => guests.filter((g) => !seatedIds.has(g.id)), [guests, seatedIds]);
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
      await seatingApi.assign({ table_id: tableId, seat_index: seatIndex, guest_id: guestId });
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
      await refresh();
    },
    [findAssignmentForGuest, guestById, tables, pushUndo, announceUndoable, t],
  );

  const unassignGuest = useCallback(
    async (guestId: number, opts?: { silentUndo?: boolean }) => {
      const previous = findAssignmentForGuest(guestId);
      if (!previous) return;
      await seatingApi.unassign(guestId);
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
      await refresh();
    },
    [findAssignmentForGuest, guestById, pushUndo, announceUndoable, t],
  );

  // Compose: swap two guests between seats. The "before" snapshot has the
  // incoming guest possibly sitting elsewhere (or unseated) and the occupant
  // sitting at the target seat. After: incoming sits at target, occupant sits
  // at incoming's old seat (or becomes unassigned if incoming was unseated).
  const swapGuests = useCallback(
    async (
      incomingGuestId: number,
      occupantGuestId: number,
      targetTableId: number,
      targetSeatIndex: number,
    ) => {
      const incomingPrev = findAssignmentForGuest(incomingGuestId);
      // Unassign the occupant first to free the target seat.
      await seatingApi.unassign(occupantGuestId);
      await seatingApi.assign({
        table_id: targetTableId,
        seat_index: targetSeatIndex,
        guest_id: incomingGuestId,
      });
      if (incomingPrev) {
        await seatingApi.assign({
          table_id: incomingPrev.table_id,
          seat_index: incomingPrev.seat_index,
          guest_id: occupantGuestId,
        });
      }
      pushUndo({
        label: t("seating.undo_label"),
        undo: async () => {
          // Reverse: unassign incoming, then put occupant back at target,
          // and (if applicable) put incoming back at its old seat.
          await seatingApi.unassign(incomingGuestId);
          if (incomingPrev) await seatingApi.unassign(occupantGuestId);
          await seatingApi.assign({
            table_id: targetTableId,
            seat_index: targetSeatIndex,
            guest_id: occupantGuestId,
          });
          if (incomingPrev) {
            await seatingApi.assign({
              table_id: incomingPrev.table_id,
              seat_index: incomingPrev.seat_index,
              guest_id: incomingGuestId,
            });
          }
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
      await refresh();
    },
    [findAssignmentForGuest, guestById, pushUndo, announceUndoable, t],
  );

  const replaceAtSeat = useCallback(
    async (
      tableId: number,
      seatIndex: number,
      incomingGuestId: number,
      occupantGuestId: number,
    ) => {
      const incomingPrev = findAssignmentForGuest(incomingGuestId);
      await seatingApi.unassign(occupantGuestId);
      await seatingApi.assign({
        table_id: tableId,
        seat_index: seatIndex,
        guest_id: incomingGuestId,
      });
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
      await refresh();
    },
    [findAssignmentForGuest, guestById, pushUndo, announceUndoable, t],
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
    await seatingApi.updateTable(table.id, { ...table, ...patch });
    pushUndo({
      label: t("seating.undo_label"),
      undo: async () => {
        await seatingApi.updateTable(table.id, { ...table, ...before });
      },
    });
    refresh();
  }

  async function moveTable(id: number, x_mm: number, y_mm: number) {
    const table = tables.find((tb) => tb.id === id);
    if (!table) return;
    if (table.x_mm === x_mm && table.y_mm === y_mm) return;
    await patchTable(table, { x_mm, y_mm });
    announceUndoable(t("seating.toast_moved").replace("{table}", table.label));
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
    const next = Math.max(1, Math.min(40, table.seats + delta));
    if (next === table.seats) return;
    await patchTable(table, { seats: next });
  }

  async function dropToSeat(tableId: number, seatIndex: number, e: DragEvent) {
    e.preventDefault();
    const data = readDragData(e);
    if (!data) return;
    await requestAssign(tableId, seatIndex, data.guestId);
  }

  async function dropToUnassigned(e: DragEvent) {
    e.preventDefault();
    const data = readDragData(e);
    if (!data) return;
    await unassignGuest(data.guestId);
  }

  // Two-step download: fetch the PDF, show it in an in-page preview dialog,
  // and only persist to disk when the user explicitly confirms. The blob URL
  // is reused for both the iframe preview and the final download so we don't
  // round-trip the server twice.
  async function requestDownload(path: string, filename: string, label: string) {
    if (previewLoading) return;
    setPreviewLoading(path);
    try {
      const raw = await fetchPdfBlob(path);
      // Explicitly type the blob so the in-browser PDF viewer always picks
      // it up — `res.blob()` should preserve Content-Type but some servers /
      // proxies strip it, and a typeless blob renders as "download" only.
      const typed =
        raw.type === "application/pdf" ? raw : raw.slice(0, raw.size, "application/pdf");
      const url = URL.createObjectURL(typed);
      setPreview({ url, filename, label });
    } finally {
      setPreviewLoading(null);
    }
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
  const handleTapGuest = useCallback((guest: Guest) => {
    setSelectedGuestId((cur) => (cur === guest.id ? null : guest.id));
  }, []);

  const handleTapSeat = useCallback(
    async (tableId: number, seatIndex: number) => {
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
    [selectedGuestId, findAssignmentAtSeat, requestAssign],
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

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>{t("seating.title")}</h1>
          <p className="mt-1 text-sm text-ink-500">{t("seating.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline"
            onClick={() => setShortcutsOpen(true)}
            aria-label={t("seating.shortcuts_button_label")}
            title={t("seating.shortcuts_button_label")}
          >
            <HelpCircle size={16} /> ?
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={previewLoading !== null}
            onClick={() =>
              requestDownload(
                "/api/print/seating/a4",
                "weddly-seating-a4.pdf",
                t("seating.print_a4"),
              )
            }
          >
            <Printer size={16} /> {t("seating.print_a4")}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={previewLoading !== null}
            onClick={() =>
              requestDownload(
                "/api/print/seating/a3",
                "weddly-seating-a3.pdf",
                t("seating.print_a3"),
              )
            }
          >
            <Printer size={16} /> {t("seating.print_a3")}
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
          <button type="button" className="btn-primary" onClick={addTable}>
            <Plus size={16} /> {t("seating.add_table")}
          </button>
        </div>
      </header>

      {tables.length === 0 ? (
        <div className="card stationery text-center">
          <ChefHat size={28} className="mx-auto text-ink-500" />
          <h3 className="mt-3 text-base font-semibold">{t("seating.no_tables")}</h3>
          <p className="mt-1 text-sm text-ink-600">{t("seating.add_first_table")}</p>
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
          />
          <TableEditor
            table={selected}
            onPatch={(patch) => selected && patchTable(selected, patch)}
            onDelete={() => selected && deleteTable(selected)}
            t={t}
          />
        </div>
      )}

      {tables.length > 0 && (
        <div className="mb-4 mt-2 border-t border-paper-300 pt-4">
          <h2 className="text-base">{t("seating.assignments_section_title")}</h2>
          <p className="mt-1 text-xs text-ink-500">{t("seating.assignments_section_hint")}</p>
          {tapMode && (
            <div className="mt-3 rounded-lg border border-blush-200 bg-blush-50 px-3 py-2 text-xs text-blush-900">
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
                  setTapModeUser((v) => !v);
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
                ? "ring-2 ring-blush-500 bg-blush-50"
                : "ring-2 ring-blush-300 ring-dashed"
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
          <p className="mt-1 text-xs text-ink-500">
            {draggingSeatedId !== null
              ? unassignedHover
                ? t("seating.drop_to_unassign_active")
                : t("seating.drop_to_unassign")
              : tapMode
                ? t("seating.tap_select_help")
                : t("seating.drag_help")}
          </p>
          {unassigned.length === 0 ? (
            <p className="mt-4 text-sm text-ink-600">{t("seating.no_unassigned")}</p>
          ) : (
            <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
              {unassigned.map((g) => (
                <li key={g.id}>
                  <DraggableGuest
                    guest={g}
                    tapMode={tapMode}
                    selected={selectedGuestId === g.id}
                    onTap={handleTapGuest}
                  />
                </li>
              ))}
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
          <p className="mb-3 text-sm text-ink-600">{t("seating.preview_help")}</p>
          {/* <object> is the most reliable cross-browser embed for PDFs from
              blob URLs — Chrome, Firefox and Safari all hand it to their
              built-in PDF viewer. <embed> renders inside <object> on
              browsers that prefer it; if neither works the user gets a
              direct "Open in new tab" fallback. */}
          <object
            data={preview.url}
            type="application/pdf"
            aria-label={preview.label}
            className="block h-[70vh] w-full rounded-xl border border-paper-300 bg-paper-50"
          >
            <embed src={preview.url} type="application/pdf" className="block h-full w-full" />
            <div className="p-4 text-sm text-ink-600">
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="underline">
                {t("seating.preview_open_in_new_tab")}
              </a>
            </div>
          </object>
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
          <p className="text-sm text-ink-700">
            {t("seating.swap_seats_body")
              .replace("{occupant}", conflictPrompt.occupant.full_name)
              .replace("{guest}", conflictPrompt.incoming.full_name)}
          </p>
        </Dialog>
      )}
    </AppShell>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-ink-700">{label}</span>
      <span className="flex flex-wrap gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="rounded border border-paper-300 bg-paper-100 px-1.5 py-0.5 text-xs font-mono text-ink-700"
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
  t,
}: {
  table: SeatingTable | null;
  onPatch: (patch: Partial<SeatingTable>) => void;
  onDelete: () => void;
  t: ReturnType<typeof useT>["t"];
}) {
  if (!table) {
    return (
      <div className="card text-sm text-ink-500">
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
        subtitle={`${t(`seating.shape_${table.shape}`)} · ${table.seats} ${t(
          "seating.seats_label",
        ).toLowerCase()}`}
        editAriaLabel={t("seating.table_label_prompt")}
      />

      <Section label={t("seating.shape_label")}>
        <ShapePicker
          value={table.shape}
          onChange={(v) => onPatch({ shape: v })}
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
          onChange={(n) => {
            if (n !== table.seats) onPatch({ seats: n });
          }}
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

      <div className="flex items-center justify-between gap-2 border-t border-paper-200 pt-3 text-xs text-ink-500">
        <span>
          {t("seating.position_label_full").replace("{x}", xMeters).replace("{y}", yMeters)}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-blush-700 transition-colors hover:bg-blush-50"
          onClick={onDelete}
          aria-label={t("seating.delete_table")}
        >
          <Trash2 size={14} aria-hidden />
          <span>{t("seating.delete_table")}</span>
        </button>
      </div>
    </div>
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
          className="w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 font-serif text-xl text-ink-900 focus:border-ink-700 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex w-full items-center gap-2 rounded-lg text-left transition-colors hover:bg-paper-100"
          aria-label={editAriaLabel}
        >
          <h3 className="flex-1 truncate font-serif text-xl text-ink-900">{value}</h3>
          <Pencil
            size={14}
            aria-hidden
            className="text-ink-300 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
      )}
      <p className="mt-1 text-xs text-ink-500">{subtitle}</p>
    </div>
  );
}

// Section header + body. Replaces the verbose <Field label> wrapper inside
// the table editor with a slightly larger, more "card section" feel — uppercase
// label, tighter spacing.
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        {label}
      </p>
      {children}
    </div>
  );
}

// Numeric stepper with -/+ buttons either side of the value. Mirrors the
// in-canvas seat buttons so the user has the same affordance both places.
function SeatsStepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const dec = () => onChange(Math.max(1, value - 1));
  const inc = () => onChange(Math.min(40, value + 1));
  const decDisabled = value <= 1;
  const incDisabled = value >= 40;
  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-paper-200 bg-paper-50 p-1">
      <button
        type="button"
        onClick={dec}
        disabled={decDisabled}
        className="grid h-8 w-8 place-items-center rounded-lg text-ink-700 transition-colors hover:bg-paper-100 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent"
        aria-label="−"
      >
        <Minus size={16} aria-hidden />
      </button>
      <span className="min-w-[2ch] text-center text-base font-semibold tabular-nums text-ink-900">
        {value}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={incDisabled}
        className="grid h-8 w-8 place-items-center rounded-lg text-ink-700 transition-colors hover:bg-paper-100 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent"
        aria-label="+"
      >
        <Plus size={16} aria-hidden />
      </button>
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
        className="input py-1.5 pr-9 text-sm"
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
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-ink-400"
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
      <span className="mb-1 flex items-center justify-between text-ink-500">
        <span>{label}</span>
        {hint && <span className="text-ink-300">{hint}</span>}
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
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-2 gap-1.5">
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
            className={[
              "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ink-700",
              active
                ? "border-blush-300 bg-blush-50 text-ink-900"
                : "border-paper-200 bg-paper-50 text-ink-600 hover:bg-paper-100",
            ].join(" ")}
          >
            <Icon size={18} className={active ? "text-blush-700" : "text-ink-500"} />
            <span>{labels[s]}</span>
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
        isSelected ? "ring-2 ring-blush-400" : "hover:shadow-pop"
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
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-xl">{table.label}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {t(`seating.shape_${table.shape}`)} · {table.seats} {t("seating.seats_label")}
          </p>
        </div>
      </div>

      <ol className="mt-4 grid grid-cols-2 gap-2">
        {Array.from({ length: table.seats }).map((_, idx) => {
          const a = seatToAssign.get(idx);
          const guest = a ? guestById.get(a.guest_id) : undefined;
          const tappable = tapMode && (selectedGuestId !== null || guest);
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
              className={
                guest
                  ? `rounded-lg border border-ink-300 bg-paper-50 px-2 py-1.5 text-sm ${tappable ? "cursor-pointer" : ""}`
                  : `rounded-lg border border-dashed border-paper-300 bg-paper-100 px-2 py-1.5 text-xs text-ink-400 ${tappable ? "cursor-pointer ring-1 ring-blush-200" : ""}`
              }
            >
              <span className="text-[10px] uppercase tracking-wider text-ink-400">#{idx + 1}</span>
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
}: {
  guest: Guest;
  compact?: boolean;
  onDragStart?: () => void;
  onDragEnd?: (e: DragEvent) => void;
  tapMode?: boolean;
  selected?: boolean;
  onTap?: (guest: Guest) => void;
}) {
  function onDragStart(e: DragEvent) {
    const data: DragData = { guestId: guest.id };
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
        if (tapMode && onTap) onTap(guest);
      }}
      className={[
        compact
          ? "text-sm font-medium text-ink-900"
          : "rounded-lg border border-paper-300 bg-paper-50 px-2 py-1.5 text-sm text-ink-800 hover:border-ink-400",
        tapMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        selected ? "ring-2 ring-blush-500" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {guest.full_name}
    </div>
  );
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
