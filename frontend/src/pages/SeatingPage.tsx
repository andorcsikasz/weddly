// Seating page. Two surfaces stacked vertically:
//   1. Floor-plan map at the top — drag tables to position, click to select,
//      edit shape/seats/dimensions in the inline editor panel.
//   2. The seat-assignment grid below — drag guests onto specific seats.
// We trade pixel-perfect placement on the assignment grid for an approachable
// column layout; the map is where pixel-perfect (millimetre) layout lives,
// and that's what the PDF export consumes.

import type { Guest, SeatAssignment, SeatingTable, TableShape } from "@shared/types";
import { ChefHat, HelpCircle, Plus, Printer, Trash2, Undo2 } from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Button, Dialog, useConfirm, useToast } from "../components/ui";
import { fetchPdfBlob, guestApi, seatingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { ROOM_DIMS, SeatingMap } from "./seating/SeatingMap";

const SHAPES: TableShape[] = ["round", "long", "square"];

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
      x_mm: ROOM_DIMS.W_MM / 2 + offset - 1600,
      y_mm: ROOM_DIMS.H_MM / 2,
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
      const blob = await fetchPdfBlob(path);
      const url = URL.createObjectURL(blob);
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
          <iframe
            src={preview.url}
            title={preview.label}
            className="h-[60vh] w-full rounded-xl border border-paper-300 bg-paper-50"
          />
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

  // For round and square the two dimensions are kept in lockstep server-side,
  // so the UI hides the length input and shows a single "size" control.
  const isLong = table.shape === "long";

  // m + cm split for the "Position" readout. Mm → "X.Y m" with one decimal
  // is more readable than raw cm at room scale.
  const xMeters = (table.x_mm / 1000).toFixed(1);
  const yMeters = (table.y_mm / 1000).toFixed(1);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-serif text-xl">{table.label}</h3>
        <button
          type="button"
          className="btn-ghost btn-sm text-blush-700"
          onClick={onDelete}
          aria-label={t("seating.delete_table")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <Field label={t("seating.table_label_prompt")}>
        <input
          type="text"
          className="input py-1.5 text-sm"
          defaultValue={table.label}
          key={`${table.id}-label`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== table.label) onPatch({ label: v });
          }}
        />
      </Field>

      <Field label={t("seating.shape_label")}>
        <select
          className="input py-1.5 text-sm"
          value={table.shape}
          onChange={(e) => onPatch({ shape: e.target.value as TableShape })}
        >
          {SHAPES.map((s) => (
            <option key={s} value={s}>
              {t(`seating.shape_${s}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("seating.seats_label")}>
        <input
          type="number"
          min={1}
          max={40}
          className="input py-1.5 text-sm"
          defaultValue={table.seats}
          key={`${table.id}-seats`}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1 && n <= 40 && n !== table.seats) {
              onPatch({ seats: Math.round(n) });
            }
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={isLong ? t("seating.length_mm_label") : t("seating.size_mm_label")}>
          <SuffixedInput
            suffix="cm"
            min={10}
            max={1000}
            step={5}
            defaultValue={Math.round((isLong ? table.length_mm : table.width_mm) / 10)}
            inputKey={`${table.id}-primary`}
            onCommit={(cm) => {
              const mm = Math.round(cm) * 10;
              if (isLong) {
                if (mm !== table.length_mm) onPatch({ length_mm: mm });
              } else {
                // Round/square keep both dimensions equal.
                if (mm !== table.width_mm) {
                  onPatch({ width_mm: mm, length_mm: mm });
                }
              }
            }}
          />
        </Field>

        {isLong && (
          <Field label={t("seating.width_mm_label")}>
            <SuffixedInput
              suffix="cm"
              min={10}
              max={1000}
              step={5}
              defaultValue={Math.round(table.width_mm / 10)}
              inputKey={`${table.id}-secondary`}
              onCommit={(cm) => {
                const mm = Math.round(cm) * 10;
                if (mm !== table.width_mm) onPatch({ width_mm: mm });
              }}
            />
          </Field>
        )}
      </div>

      <p className="text-xs text-ink-400">
        {t("seating.position_label_full").replace("{x}", xMeters).replace("{y}", yMeters)}
      </p>
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
}: {
  suffix: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  inputKey: string;
  onCommit: (value: number) => void;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
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
