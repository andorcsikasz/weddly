// Floor-plan map. SVG canvas where each table is a draggable shape with
// chairs auto-positioned around the perimeter. The user world is in
// millimetres (matches what the PDF renderer consumes), so what you see on
// screen is what you'll get on the printed seating chart.
//
// Persistence rule: drag/resize/seat-change updates local state in real time
// but only PATCHes the server on pointer-up — otherwise we'd spam the API.

import type { SeatAssignment, SeatingTable } from "@shared/types";
import { chairOffsets, maxSeatsForTable } from "@shared/seating";
import { Baby, Locate, Maximize2, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../lib/i18n";

// Default room: 12m × 9m. Wide enough for a 200-person wedding without feeling
// cramped; the SVG scales to its container so absolute pixels don't matter.
// These are *defaults* — the actual canvas size is per-couple state owned by
// SeatingPage and passed as a prop, with localStorage persistence today.
const DEFAULT_ROOM_W_MM = 12_000;
const DEFAULT_ROOM_H_MM = 9_000;
// Sensible bounds for the editable input: 3m (intimate) to 50m (ballroom).
const MIN_ROOM_MM = 3_000;
const MAX_ROOM_MM = 100_000;
const GRID_STEP_MM = 500; // 50-cm grid lines — fine enough to plan furniture against

const MIN_DIM_MM = 100;
const MAX_DIM_MM = 10_000;
const MIN_SEATS = 1;
const MAX_SEATS = 40;
// Standard chair dimensions in mm. Stays constant regardless of table size —
// real chairs don't shrink when you swap to a smaller table.
const CHAIR_WIDTH_MM = 440;
const CHAIR_HEIGHT_MM = 360;
const CHAIR_CORNER_MM = 90;

// Keyboard nudge granularity. 100mm matches the chair-placement grain;
// shift drops to a precise 10mm for fine alignment.
const NUDGE_COARSE_MM = 100;
const NUDGE_FINE_MM = 10;

type HandleDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface Props {
  tables: SeatingTable[];
  assignments: SeatAssignment[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Called once on pointer-up after a move drag, with rounded mm coordinates. */
  onMove: (id: number, x_mm: number, y_mm: number) => void;
  /** Called once on pointer-up after a resize drag, with rounded mm dimensions. */
  onResize: (id: number, width_mm: number, length_mm: number) => void;
  /** Called when the user clicks the +/- seat buttons. delta is +1 or -1. */
  onSeatsChange: (id: number, delta: number) => void;
  /** Optional: invoked when the user presses Delete on the selected table. */
  onDeleteTable?: (id: number) => void;
  /** Optional: invoked when the user presses N (no modifier) on the canvas. */
  onAddTable?: () => void;
  /** When true, the in-canvas drop hint switches to the highlight stripe. */
  unassignedHighlight?: boolean;
  /** Room canvas dimensions in millimetres. Optional — defaults to 12×9 m. */
  roomWidthMm?: number;
  roomHeightMm?: number;
  /** Called when the user commits a new room size in the inline inputs. */
  onRoomChange?: (widthMm: number, heightMm: number) => void;
  /** Seat indices per table currently occupied by a baby guest. Drives the
   *  baby-icon overlay on the chair, independent of the baby_seats "needs
   *  a high chair" flag on the table itself. */
  babySeatsByTable?: Map<number, Set<number>>;
  /** Makes the map fill its parent height (like seatMode does) without
   *  disabling table drag/resize. Use in edit mode when the outer container
   *  is already flex with a known height. */
  fullHeight?: boolean;
  /** When true, switches the canvas into "seat guests" mode: table drag/resize
   *  is disabled and each chair becomes a drag-drop target + tap target. */
  seatMode?: boolean;
  /** Per-table, per-seat: the guest currently occupying that seat (for name
   *  rendering on chairs in seat mode). Map<tableId, Map<seatIndex, {id, name}>>. */
  seatGuestsByTable?: Map<number, Map<number, { id: number; name: string }>>;
  /** Called when the user drops a guest onto a specific chair in seat mode. */
  onDropSeat?: (tableId: number, seatIndex: number, e: React.DragEvent) => void;
  /** Called when the user taps/clicks a chair in seat mode. */
  onTapSeat?: (tableId: number, seatIndex: number) => void;
  /** Whether tap-to-place mode is active (affects cursor + visual hint). */
  tapMode?: boolean;
  /** Guest id currently selected for placement — highlights their chair. */
  selectedGuestId?: number | null;
  /** Called when the user starts dragging a seated guest from the SVG. */
  onChairDragStart?: (tableId: number, seatIndex: number, guestId: number) => void;
  /** Called when a drag from an SVG chair ends. */
  onChairDragEnd?: (e: React.DragEvent) => void;
  /** Pointer-event chair drag: called when the guest is released over a seat. */
  onSeatDrop?: (tableId: number, seatIndex: number, guestId: number) => void;
  /** Pointer-event chair drag: called when released outside any seat (unassign). */
  onSeatRelease?: (guestId: number) => void;
  /** Pointer-event chair drag: called when the drag gesture ends (drop or release). */
  onChairDragFinish?: () => void;
}

type DragState =
  | {
      kind: "move";
      tableId: number;
      // Offset (in mm) from the table centre to the pointer at drag-start, so
      // the table doesn't jump on grab.
      grabOffsetX: number;
      grabOffsetY: number;
    }
  | {
      kind: "resize";
      tableId: number;
      handle: HandleDir;
      // Table centre and starting dimensions captured at drag-start.
      cx: number;
      cy: number;
      startWidthMm: number;
      startLengthMm: number;
    }
  | {
      kind: "chair";
      tableId: number;
      seatIndex: number;
      guestId: number;
      guestName: string;
      /** Client coords at drag-start — used to place the ghost before the first pointermove. */
      initX: number;
      initY: number;
    };

export function SeatingMap({
  tables,
  assignments,
  selectedId,
  onSelect,
  onMove,
  onResize,
  onSeatsChange,
  onDeleteTable,
  onAddTable,
  unassignedHighlight,
  roomWidthMm = DEFAULT_ROOM_W_MM,
  roomHeightMm = DEFAULT_ROOM_H_MM,
  onRoomChange,
  babySeatsByTable,
  fullHeight = false,
  seatMode = false,
  seatGuestsByTable,
  onDropSeat,
  onTapSeat,
  tapMode,
  selectedGuestId,
  onChairDragStart,
  onChairDragEnd,
  onSeatDrop,
  onSeatRelease,
  onChairDragFinish,
}: Props) {
  const { t } = useT();
  // Local aliases keep the rest of the component readable; the rendering
  // and clamp logic still references these in mm.
  const ROOM_W_MM = roomWidthMm;
  const ROOM_H_MM = roomHeightMm;
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Coarse-pointer = touch device. We relax `touch-action: none` on tables
  // to `pan-y` so vertical page scroll still works when a finger lands on
  // a table — the previous behaviour trapped mobile users inside the
  // canvas. Detected lazily on mount; not re-evaluated on resize (a desktop
  // user plugging in a tablet mid-session is not a real flow).
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
  }, []);
  // We mirror table positions / dimensions locally so dragging is smooth
  // without round-tripping to the server. Keyed by table id; falls back to
  // the prop value when nothing is overridden.
  const [localPos, setLocalPos] = useState<Map<number, { x: number; y: number }>>(new Map());
  const [localDims, setLocalDims] = useState<Map<number, { width_mm: number; length_mm: number }>>(
    new Map(),
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  /** Ref to the floating ghost div — position updated imperatively on pointermove. */
  const chairGhostRef = useRef<HTMLDivElement | null>(null);
  /** Which chair the user is currently hovering over during a pointer-event chair drag. */
  const [chairDragHoverTarget, setChairDragHoverTarget] = useState<{
    tableId: number;
    seatIndex: number;
  } | null>(null);

  // Keyboard nudges fire onMove on every keydown which, when the user holds an
  // arrow key, sends a PATCH per step. Each PATCH uses the *same* stale
  // `If-Match` ETag (the next tick's refresh hasn't landed yet) so all but the
  // first 409 with "another user modified this table". Debounce: update the
  // local visual state instantly but only flush the LAST target to the server
  // after a short idle pause.
  const pendingKeyMoveRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const keyMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushKeyMove = useCallback(() => {
    const pending = pendingKeyMoveRef.current;
    if (!pending) return;
    pendingKeyMoveRef.current = null;
    if (keyMoveTimerRef.current) {
      clearTimeout(keyMoveTimerRef.current);
      keyMoveTimerRef.current = null;
    }
    onMove(pending.id, pending.x, pending.y);
  }, [onMove]);
  // Flush on unmount so a pending move isn't lost if the user navigates away.
  useEffect(
    () => () => {
      flushKeyMove();
    },
    [flushKeyMove],
  );
  // When true, the whole card mounts into a fullscreen portal at 90vw × 90vh.
  // Same SVG inside — viewBox-based scaling means tables stay correctly
  // proportioned regardless of container size, so all drag/resize logic
  // continues to work without changes.
  const [expanded, setExpanded] = useState(false);

  // Wrapper sizing. We measure the scroll container so the SVG can be drawn
  // at a "useful" zoom level instead of the default fit-to-meet behaviour,
  // which makes elongated rooms (e.g. 10×50 m) render as a tiny strip with
  // huge empty bands on the sides. Re-attach when `expanded` toggles since
  // React unmounts the cardContent and remounts it inside the portal.
  const scrollWrapperRef = useRef<HTMLDivElement | null>(null);
  const [wrapperPx, setWrapperPx] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = scrollWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setWrapperPx({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  // When the room or wrapper resizes in expanded mode, the SVG's pixel
  // dimensions jump. The browser keeps scrollTop/scrollLeft byte values, so
  // the user lands at an arbitrary corner of the new layout. Re-centre so
  // the change feels like "the camera stayed put" instead of teleporting.
  // Only runs in expanded mode; inline mode never overflows.
  useEffect(() => {
    if (!expanded) return;
    const el = scrollWrapperRef.current;
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [expanded, ROOM_W_MM, ROOM_H_MM, wrapperPx?.w, wrapperPx?.h]);

  // Pick a scale + SVG pixel size.
  // - Inline (no fullHeight, seatMode, expanded): SVG fills its container with CSS %.
  // - fullHeight/edit mode: fit-to-contain (min scale) so the whole floor plan is
  //   always visible without scrolling, regardless of room dimensions.
  // - seatMode / expanded: fill (max scale) so the canvas overflows and is pannable.
  const svgSize = useMemo<{ width: number | string; height: number | string }>(() => {
    if (!wrapperPx || wrapperPx.w <= 0 || wrapperPx.h <= 0) {
      return { width: "100%", height: "100%" };
    }
    if (!expanded && !seatMode && !fullHeight) {
      return { width: "100%", height: "100%" };
    }
    if ((fullHeight || seatMode) && !expanded) {
      // Fit the entire floor plan inside the wrapper — no scrolling needed.
      const scale = Math.min(wrapperPx.w / ROOM_W_MM, wrapperPx.h / ROOM_H_MM);
      return { width: ROOM_W_MM * scale, height: ROOM_H_MM * scale };
    }
    // expanded: zoom-to-fill so the user can pan.
    const scale = Math.max(wrapperPx.w / ROOM_W_MM, wrapperPx.h / ROOM_H_MM);
    return { width: ROOM_W_MM * scale, height: ROOM_H_MM * scale };
  }, [expanded, seatMode, fullHeight, wrapperPx, ROOM_W_MM, ROOM_H_MM]);

  // ESC closes the expanded overlay. Lock body scroll while open so the
  // backdrop doesn't reveal the page underneath when the user scrolls.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setExpanded(false);
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  // Reset local overrides whenever the underlying tables prop changes
  // (e.g. server refresh). Otherwise stale drag positions could linger.
  useEffect(() => {
    setLocalPos(new Map());
    setLocalDims(new Map());
  }, [tables]);

  const seatsByTable = new Map<number, SeatAssignment[]>();
  for (const a of assignments) {
    if (!seatsByTable.has(a.table_id)) seatsByTable.set(a.table_id, []);
    const arr = seatsByTable.get(a.table_id);
    if (arr) arr.push(a);
  }

  // Convert a pointer event to SVG-user-space mm coordinates. Returns null
  // if the SVG isn't mounted (shouldn't happen during a real drag).
  const toSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  function startMove(e: React.PointerEvent<SVGGElement>, table: SeatingTable) {
    if (e.button !== 0) return;
    const p = toSvgPoint(e.clientX, e.clientY);
    if (!p) return;
    const cur = localPos.get(table.id) ?? { x: table.x_mm, y: table.y_mm };
    setDrag({
      kind: "move",
      tableId: table.id,
      grabOffsetX: p.x - cur.x,
      grabOffsetY: p.y - cur.y,
    });
    onSelect(table.id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function startResize(e: React.PointerEvent<SVGElement>, table: SeatingTable, handle: HandleDir) {
    if (e.button !== 0) return;
    const pos = localPos.get(table.id) ?? { x: table.x_mm, y: table.y_mm };
    const dims = localDims.get(table.id) ?? {
      width_mm: table.width_mm,
      length_mm: table.length_mm,
    };
    setDrag({
      kind: "resize",
      tableId: table.id,
      handle,
      cx: pos.x,
      cy: pos.y,
      startWidthMm: dims.width_mm,
      startLengthMm: dims.length_mm,
    });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function moveDrag(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    if (drag.kind === "chair") {
      // Move ghost directly via DOM — avoids a re-render on every pointermove.
      if (chairGhostRef.current) {
        chairGhostRef.current.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      }
      // Find which chair (if any) the cursor is over, skipping the source seat.
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let found: { tableId: number; seatIndex: number } | null = null;
      for (const el of els) {
        const chair = (el as Element).closest?.("[data-seat-index]") as Element | null;
        if (!chair) continue;
        const seatIdx = chair.getAttribute("data-seat-index");
        const tblId = chair.getAttribute("data-table-id");
        if (seatIdx === null || tblId === null) continue;
        const tId = Number(tblId);
        const sIdx = Number(seatIdx);
        if (tId === drag.tableId && sIdx === drag.seatIndex) continue; // skip source
        found = { tableId: tId, seatIndex: sIdx };
        break;
      }
      // Only trigger a re-render when the hovered chair actually changes.
      setChairDragHoverTarget((prev) => {
        if (prev?.tableId === found?.tableId && prev?.seatIndex === found?.seatIndex) return prev;
        return found;
      });
      return;
    }
    const p = toSvgPoint(e.clientX, e.clientY);
    if (!p) return;

    if (drag.kind === "move") {
      const tableId = drag.tableId;
      const moving = tables.find((tb) => tb.id === tableId);
      const fallback = moving ? { x: moving.x_mm, y: moving.y_mm } : { x: 0, y: 0 };
      const last = localPos.get(tableId) ?? fallback;
      const nextX = clamp(Math.round(p.x - drag.grabOffsetX), 0, ROOM_W_MM);
      const nextY = clamp(Math.round(p.y - drag.grabOffsetY), 0, ROOM_H_MM);
      if (nextX === last.x && nextY === last.y) return;
      setLocalPos((prev) => {
        const next = new Map(prev);
        next.set(tableId, { x: nextX, y: nextY });
        return next;
      });
      return;
    }

    // Resize. Symmetric around the table centre: new side = 2 × |pointer - centre|
    // along the relevant axis. For uniform-scale shapes (round/square) we use
    // the larger of |dx|/|dy|.
    //
    // The pointer comes in canvas coordinates. If the table is rotated, we
    // un-rotate the pointer delta into the table's local frame so that
    // dragging an "east" handle still grows the length (length is always the
    // table's local x-axis, no matter how the table is visually oriented).
    const table = tables.find((tb) => tb.id === drag.tableId);
    if (!table) return;
    const rotRad = ((table.rotation_deg ?? 0) * Math.PI) / 180;
    const px = p.x - drag.cx;
    const py = p.y - drag.cy;
    const cosR = Math.cos(-rotRad);
    const sinR = Math.sin(-rotRad);
    const lx = px * cosR - py * sinR;
    const ly = px * sinR + py * cosR;
    const dx = Math.abs(lx);
    const dy = Math.abs(ly);
    const uniform = table.shape === "round" || table.shape === "square";

    let newWidth = drag.startWidthMm;
    let newLength = drag.startLengthMm;

    if (uniform) {
      const side = clamp(Math.round(2 * Math.max(dx, dy)), MIN_DIM_MM, MAX_DIM_MM);
      newWidth = side;
      newLength = side;
    } else {
      // Long: corners adjust both axes; edges adjust the matching axis only.
      // Length is the horizontal axis (x), width is the vertical axis (y).
      const handle = drag.handle;
      const adjustsX = handle === "e" || handle === "w" || handle.length === 2;
      const adjustsY = handle === "n" || handle === "s" || handle.length === 2;
      if (adjustsX) newLength = clamp(Math.round(2 * dx), MIN_DIM_MM, MAX_DIM_MM);
      if (adjustsY) newWidth = clamp(Math.round(2 * dy), MIN_DIM_MM, MAX_DIM_MM);
    }

    setLocalDims((prev) => {
      const next = new Map(prev);
      next.set(drag.tableId, { width_mm: newWidth, length_mm: newLength });
      return next;
    });
  }

  function endDrag(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    if (drag.kind === "chair") {
      // Ignore pointer-leave — with capture active the pointer may briefly leave
      // the SVG bounds while the user drags over the HTML unassigned panel.
      if (e.type === "pointerleave") return;
      const { guestId, tableId: srcTableId, seatIndex: srcSeatIndex } = drag;
      setDrag(null);
      setChairDragHoverTarget(null);
      // Use closest() so that even when elementsFromPoint returns a leaf element
      // (e.g. the <rect> inside the chair <g>) we still find the <g> ancestor
      // that carries data-seat-index / data-table-id.
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let dropped = false;
      for (const el of els) {
        const chair = (el as Element).closest?.("[data-seat-index]") as Element | null;
        if (!chair) continue;
        const seatIdx = chair.getAttribute("data-seat-index");
        const tblId = chair.getAttribute("data-table-id");
        if (seatIdx === null || tblId === null) continue;
        const tId = Number(tblId);
        const sIdx = Number(seatIdx);
        // Skip the source seat — dropping back on yourself is a no-op, not a move.
        if (tId === srcTableId && sIdx === srcSeatIndex) continue;
        onSeatDrop?.(tId, sIdx, guestId);
        dropped = true;
        break;
      }
      if (!dropped) onSeatRelease?.(guestId);
      onChairDragFinish?.();
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      return;
    }
    if (drag.kind === "move") {
      const pos = localPos.get(drag.tableId);
      if (pos) onMove(drag.tableId, pos.x, pos.y);
    } else {
      const dims = localDims.get(drag.tableId);
      if (dims) onResize(drag.tableId, dims.width_mm, dims.length_mm);
    }
    setDrag(null);
    // Best-effort release; not all browsers flag this on the SVG itself, so
    // we silently ignore the failure.
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }

  // Keyboard shortcuts when a table is focused/selected. Only fire when the
  // event target is one of our SVG nodes (table group or canvas) so typing in
  // unrelated inputs elsewhere on the page never triggers nudges.
  const handleKey = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      const target = e.target as Element | null;
      const insideTable = target?.closest?.("[data-seating-table]") != null;
      const onCanvas = target === svgRef.current;
      if (!insideTable && !onCanvas) return;

      // "N" with no modifier on the canvas (or any focused table) adds a new
      // table. Spec: triggers when canvas focused — we accept either.
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (onAddTable) {
          e.preventDefault();
          onAddTable();
          return;
        }
      }

      // From here on we need a selected table.
      if (selectedId === null) return;
      const table = tables.find((tb) => tb.id === selectedId);
      if (!table) return;

      const step = e.shiftKey ? NUDGE_FINE_MM : NUDGE_COARSE_MM;
      const pos = localPos.get(table.id) ?? { x: table.x_mm, y: table.y_mm };

      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case "ArrowLeft":
          dx = -step;
          break;
        case "ArrowRight":
          dx = step;
          break;
        case "ArrowUp":
          dy = -step;
          break;
        case "ArrowDown":
          dy = step;
          break;
        case "[":
          e.preventDefault();
          onSeatsChange(table.id, -1);
          return;
        case "]":
          e.preventDefault();
          onSeatsChange(table.id, 1);
          return;
        case "Delete":
        case "Backspace":
          if (onDeleteTable) {
            e.preventDefault();
            onDeleteTable(table.id);
          }
          return;
        default:
          return;
      }
      if (dx === 0 && dy === 0) return;
      e.preventDefault();
      const newX = clamp(pos.x + dx, 0, ROOM_W_MM);
      const newY = clamp(pos.y + dy, 0, ROOM_H_MM);
      setLocalPos((prev) => {
        const next = new Map(prev);
        next.set(table.id, { x: newX, y: newY });
        return next;
      });
      // Coalesce a held arrow key into a single PATCH on key-up (or after a
      // short idle pause). Stores the latest target so the server eventually
      // sees the final position, not every step along the way.
      pendingKeyMoveRef.current = { id: table.id, x: newX, y: newY };
      if (keyMoveTimerRef.current) clearTimeout(keyMoveTimerRef.current);
      keyMoveTimerRef.current = setTimeout(flushKeyMove, 250);
      // Auto-scroll the viewport to keep the nudged table in view. Critical
      // in the expanded overlay where the SVG is bigger than the wrapper —
      // without this, a held arrow key walks the table off-screen with no
      // way to follow. `nearest` minimises jitter (only scrolls when the
      // table actually leaves the visible area).
      requestAnimationFrame(() => {
        const el = svgRef.current?.querySelector(`[data-seating-table="${table.id}"]`);
        if (el instanceof Element) el.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [
      selectedId,
      tables,
      localPos,
      flushKeyMove,
      onSeatsChange,
      onDeleteTable,
      onAddTable,
      ROOM_W_MM,
      ROOM_H_MM,
    ],
  );

  const cardContent = (
    <>
      <header className="flex items-center justify-between gap-2 border-b border-paper-200 px-4 py-2.5 dark:border-umber-700">
        <div>
          <h2 className="text-base font-grotesk">{t("seating.map_title")}</h2>
          <p className="text-xs text-ink-500 dark:text-umber-300">{t("seating.map_help")}</p>
        </div>
        <div className="flex items-center gap-2">
          <RoomDimsInput
            widthMm={ROOM_W_MM}
            heightMm={ROOM_H_MM}
            onChange={onRoomChange}
            widthAriaLabel={t("seating.room_width_aria")}
            heightAriaLabel={t("seating.room_height_aria")}
          />
          {expanded && (
            <button
              type="button"
              onClick={() => {
                // Re-centre: scroll so the wrapper's viewport is in the
                // middle of the (always-overflowing) SVG. Handy when the
                // user scrolls deep into a 50 m room and wants to "go back
                // to the middle". The `Math.max` fit guarantees at least
                // one axis is bigger than the wrapper, so the scrollLefts
                // are non-zero.
                const el = scrollWrapperRef.current;
                if (!el) return;
                el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
                el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
              }}
              className="rounded-md border border-ink-700 p-1.5 text-ink-700 transition-colors hover:bg-paper-100 dark:border-paper-100 dark:text-paper-100 dark:hover:bg-umber-800"
              aria-label={t("seating.map_recenter")}
              title={t("seating.map_recenter")}
            >
              <Locate size={16} aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md border border-ink-700 p-1.5 text-ink-700 transition-colors hover:bg-paper-100 dark:border-paper-100 dark:text-paper-100 dark:hover:bg-umber-800"
            aria-label={expanded ? t("seating.map_collapse") : t("seating.map_expand")}
            title={expanded ? t("seating.map_collapse") : t("seating.map_expand")}
          >
            {expanded ? <X size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        </div>
      </header>
      {/* Three layout regimes:
          - INLINE/EDIT: fixed 60 vh frame, no scroll. Fit-to-meet.
          - INLINE/SEAT: flex-1 (grows to fill the outer card which is h-full)
            with overflow-auto so the user can pan/scroll a large room.
          - EXPANDED (portal overlay): same as before — min-h-0 flex-1
            overflow-auto so an overlarge SVG is scrollable. */}
      <div
        ref={scrollWrapperRef}
        className={`relative bg-paper-50 dark:bg-umber-900 ${
          expanded
            ? "min-h-0 flex-1 overflow-auto p-4"
            : seatMode || fullHeight
              ? "min-h-0 flex-1 overflow-hidden"
              : "h-[60vh] max-h-[640px] w-full overflow-hidden"
        }`}
      >
        <div
          className={
            expanded || seatMode || fullHeight
              ? "flex min-h-full min-w-full items-center justify-center"
              : "h-full w-full"
          }
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${ROOM_W_MM} ${ROOM_H_MM}`}
            preserveAspectRatio="xMidYMid meet"
            style={
              expanded || seatMode || fullHeight
                ? { width: svgSize.width, height: svgSize.height, flexShrink: 0 }
                : { width: "100%", height: "100%" }
            }
            className="block select-none focus:outline-none"
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onKeyDown={handleKey}
            // Click on empty area to deselect.
            onClick={(e) => {
              if (e.target === svgRef.current) onSelect(null);
            }}
            aria-label={t("seating.map_title")}
            role="img"
            tabIndex={0}
          >
            <defs>
              {/* Diagonal stripe used to highlight a table when the unassigned
                panel is the active drop target. Defined once at the SVG root
                so any fill="url(#seat-drop-stripe)" can reference it. */}
              <pattern
                id="seat-drop-stripe"
                patternUnits="userSpaceOnUse"
                width={120}
                height={120}
                patternTransform="rotate(45)"
              >
                <rect width={120} height={120} className="fill-blush-50" />
                <line x1={0} y1={0} x2={0} y2={120} className="stroke-blush-200" strokeWidth={40} />
              </pattern>
            </defs>
            <Grid widthMm={ROOM_W_MM} heightMm={ROOM_H_MM} />
            {unassignedHighlight && (
              <rect
                x={0}
                y={0}
                width={ROOM_W_MM}
                height={ROOM_H_MM}
                fill="url(#seat-drop-stripe)"
                opacity={0.4}
                style={{ pointerEvents: "none" }}
              />
            )}
            {tables.map((table) => {
              const pos = localPos.get(table.id) ?? { x: table.x_mm, y: table.y_mm };
              const dims = localDims.get(table.id) ?? {
                width_mm: table.width_mm,
                length_mm: table.length_mm,
              };
              // Build a synthetic table with the live local dimensions so the
              // shape redraws under the cursor during a resize drag.
              const liveTable: SeatingTable = { ...table, ...dims };
              const filled = seatsByTable.get(table.id)?.length ?? 0;
              return (
                <TableShape
                  key={table.id}
                  table={liveTable}
                  cx={pos.x}
                  cy={pos.y}
                  filledSeats={filled}
                  babySeatedSet={babySeatsByTable?.get(table.id)}
                  isSelected={selectedId === table.id}
                  coarsePointer={coarsePointer}
                  onPointerDown={(e) => startMove(e, table)}
                  onHandlePointerDown={(e, h) => startResize(e, table, h)}
                  onSeatsDelta={(delta) => onSeatsChange(table.id, delta)}
                  seatMode={seatMode}
                  seatGuests={seatGuestsByTable?.get(table.id)}
                  selectedGuestId={selectedGuestId}
                  tapMode={tapMode}
                  onDropSeat={(seatIndex, e) => onDropSeat?.(table.id, seatIndex, e)}
                  onTapSeat={(seatIndex) => onTapSeat?.(table.id, seatIndex)}
                  onChairDragStart={(seatIndex, guestId) =>
                    onChairDragStart?.(table.id, seatIndex, guestId)
                  }
                  onChairDragEnd={onChairDragEnd}
                  draggingSeatIndex={
                    drag?.kind === "chair" && drag.tableId === table.id ? drag.seatIndex : null
                  }
                  onTableClick={() => onSelect(table.id)}
                  onChairPointerDown={(e, seatIndex, guestId) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    (e.currentTarget as Element).setPointerCapture(e.pointerId);
                    const guestName = seatGuestsByTable?.get(table.id)?.get(seatIndex)?.name ?? "";
                    setDrag({
                      kind: "chair",
                      tableId: table.id,
                      seatIndex,
                      guestId,
                      guestName,
                      initX: e.clientX,
                      initY: e.clientY,
                    });
                    onChairDragStart?.(table.id, seatIndex, guestId);
                  }}
                  pointerHoverSeat={
                    drag?.kind === "chair" && chairDragHoverTarget?.tableId === table.id
                      ? chairDragHoverTarget.seatIndex
                      : null
                  }
                  t={t}
                />
              );
            })}
          </svg>
        </div>
      </div>
      {/* Drag ghost — floats at cursor position during a pointer-event chair drag. */}
      {drag?.kind === "chair" &&
        createPortal(
          <div
            ref={chairGhostRef}
            className="pointer-events-none fixed left-0 top-0 z-[9999] select-none rounded bg-ink-800 px-2 py-1 text-xs font-semibold text-paper-50 shadow-lg dark:bg-umber-800"
            style={{
              transform: `translate(${drag.initX + 14}px, ${drag.initY + 14}px)`,
            }}
          >
            {drag.guestName}
          </div>,
          document.body,
        )}
    </>
  );

  if (expanded) {
    // Empty placeholder keeps the parent grid slot occupied so the side
    // TableEditor doesn't reflow while the map sits in the overlay.
    return (
      <>
        <div aria-hidden className="h-[60vh] max-h-[640px]" />
        {createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm"
            /* `onPointerDown` catches both touch and mouse — the old
             * `onMouseDown` left mobile users stranded in expanded mode
             * (ESC works but isn't reachable from a phone keyboard). */
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setExpanded(false);
            }}
          >
            <div className="card flex h-[90vh] w-[90vw] flex-col overflow-hidden p-0 shadow-pop">
              {cardContent}
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <div
      className={`card overflow-hidden p-0 ${seatMode || fullHeight ? "flex h-full flex-col" : ""}`}
    >
      {cardContent}
    </div>
  );
}

function RoomDimsInput({
  widthMm,
  heightMm,
  onChange,
  widthAriaLabel,
  heightAriaLabel,
}: {
  widthMm: number;
  heightMm: number;
  onChange?: (widthMm: number, heightMm: number) => void;
  widthAriaLabel: string;
  heightAriaLabel: string;
}) {
  // Keep input as raw text while focused so the user can clear-and-retype
  // without the field re-rounding mid-edit. Commit on blur.
  function commit(nextW: number | null, nextH: number | null) {
    if (!onChange) return;
    const w = nextW != null ? clampRoom(Math.round(nextW * 1000)) : widthMm;
    const h = nextH != null ? clampRoom(Math.round(nextH * 1000)) : heightMm;
    if (w === widthMm && h === heightMm) return;
    onChange(w, h);
  }
  // Plain inline-text affordance: no box, just the number. A subtle dotted
  // underline appears on hover/focus so the user still knows it's editable.
  const cls =
    "w-7 border-0 bg-transparent p-0 text-center text-sm font-medium text-ink-700 tabular-nums outline-none dark:text-paper-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
  return (
    <span className="flex items-center gap-1 text-xs text-ink-400 dark:text-umber-300">
      <input
        type="number"
        min={MIN_ROOM_MM / 1000}
        max={MAX_ROOM_MM / 1000}
        step={0.5}
        defaultValue={Math.round(widthMm / 100) / 10}
        key={`w-${widthMm}`}
        aria-label={widthAriaLabel}
        className={cls}
        onBlur={(e) => {
          const v = Number(e.target.value);
          commit(Number.isFinite(v) ? v : null, null);
        }}
      />
      <span aria-hidden className="text-sm leading-none">
        ×
      </span>
      <input
        type="number"
        min={MIN_ROOM_MM / 1000}
        max={MAX_ROOM_MM / 1000}
        step={0.5}
        defaultValue={Math.round(heightMm / 100) / 10}
        key={`h-${heightMm}`}
        aria-label={heightAriaLabel}
        className={cls}
        onBlur={(e) => {
          const v = Number(e.target.value);
          commit(null, Number.isFinite(v) ? v : null);
        }}
      />
      <span>m</span>
    </span>
  );
}

function clampRoom(mm: number): number {
  return Math.max(MIN_ROOM_MM, Math.min(MAX_ROOM_MM, mm));
}

function Grid({ widthMm, heightMm }: { widthMm: number; heightMm: number }) {
  // Dashed 50 cm grid plus a soft room border. The dashes are deliberately
  // chunky (8 mm stroke, 60 / 60 mm pattern, paper-500) so the planning
  // grid reads at a glance — earlier versions were lost behind the table
  // fills at zoom-out.
  const lines: React.ReactElement[] = [];
  for (let x = GRID_STEP_MM; x < widthMm; x += GRID_STEP_MM) {
    lines.push(
      <line
        key={`vx-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={heightMm}
        className="stroke-paper-500 dark:stroke-umber-700"
        strokeWidth={8}
        strokeDasharray="60 60"
      />,
    );
  }
  for (let y = GRID_STEP_MM; y < heightMm; y += GRID_STEP_MM) {
    lines.push(
      <line
        key={`hy-${y}`}
        x1={0}
        y1={y}
        x2={widthMm}
        y2={y}
        className="stroke-paper-500 dark:stroke-umber-700"
        strokeWidth={8}
        strokeDasharray="60 60"
      />,
    );
  }
  return (
    <g>
      <rect
        x={0}
        y={0}
        width={widthMm}
        height={heightMm}
        className="fill-paper-50 dark:fill-umber-900"
      />
      {lines}
      {/* Room boundary — non-scaling-stroke keeps the visual border thickness
          constant in screen pixels regardless of room size or zoom level.
          strokeWidth={6} → ~3 px visible (outer half clips at the viewport). */}
      <rect
        x={0}
        y={0}
        width={widthMm}
        height={heightMm}
        className="fill-none stroke-ink-700 dark:stroke-umber-500"
        strokeWidth={6}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    </g>
  );
}

interface TableShapeProps {
  table: SeatingTable;
  cx: number;
  cy: number;
  filledSeats: number;
  /** Seat indices currently occupied by a baby guest — overlay a Baby icon. */
  babySeatedSet?: Set<number>;
  isSelected: boolean;
  /** True when the device has a coarse pointer (touch). We then relax the
   *  drag's `touch-action: none` to `pan-y` so the user can still scroll the
   *  page vertically when their finger lands on a table — the previous
   *  blanket `none` hijacked all vertical scroll, trapping mobile users
   *  inside the canvas. Horizontal drag still starts a table move. */
  coarsePointer?: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onHandlePointerDown: (e: React.PointerEvent<SVGElement>, handle: HandleDir) => void;
  onSeatsDelta: (delta: number) => void;
  /** When true: table drag/resize disabled; chairs become drop targets. */
  seatMode?: boolean;
  /** Per-seat guest info for name rendering in seat mode. */
  seatGuests?: Map<number, { id: number; name: string }>;
  /** Guest id currently selected for placement — shown highlighted. */
  selectedGuestId?: number | null;
  /** Whether tap-to-place is active — chairs respond to clicks. */
  tapMode?: boolean;
  /** Drop handler for each chair in seat mode. */
  onDropSeat?: (seatIndex: number, e: React.DragEvent) => void;
  /** Tap handler for each chair in seat mode. */
  onTapSeat?: (seatIndex: number) => void;
  /** Drag-start from an occupied chair in seat mode. */
  onChairDragStart?: (seatIndex: number, guestId: number) => void;
  /** Drag-end from an occupied chair in seat mode. */
  onChairDragEnd?: (e: React.DragEvent) => void;
  /** Seat index currently being pointer-dragged out of this table (for ghost visual). */
  draggingSeatIndex?: number | null;
  /** Seat index currently being hovered by a cross-table pointer drag — highlights the drop target. */
  pointerHoverSeat?: number | null;
  /** Pointer-down on an occupied chair — initiates a pointer-event drag. */
  onChairPointerDown?: (
    e: React.PointerEvent<SVGGElement>,
    seatIndex: number,
    guestId: number,
  ) => void;
  /** Click on the table body in seat mode — selects the table for the right panel. */
  onTableClick?: () => void;
  t: (
    key:
      | "seating.add_seat"
      | "seating.remove_seat"
      | "seating.seats_label"
      | "seating.shape_round"
      | "seating.shape_long"
      | "seating.shape_square"
      | "seating.table_aria_label",
  ) => string;
}

function TableShape({
  table,
  cx,
  cy,
  filledSeats,
  babySeatedSet,
  isSelected,
  coarsePointer = false,
  onPointerDown,
  onHandlePointerDown,
  onSeatsDelta,
  seatMode = false,
  seatGuests,
  selectedGuestId,
  tapMode,
  onDropSeat,
  onTapSeat,
  onChairDragStart,
  onChairDragEnd,
  draggingSeatIndex,
  pointerHoverSeat,
  onChairPointerDown,
  onTableClick,
  t,
}: TableShapeProps) {
  const [dragOverSeat, setDragOverSeat] = useState<number | null>(null);
  const [dragOverTable, setDragOverTable] = useState(false);
  // Clear the table-body hover highlight when an HTML5 drag ends (drop or cancel).
  useEffect(() => {
    if (!dragOverTable) return;
    function onDragEnd() {
      setDragOverTable(false);
    }
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, [dragOverTable]);
  // Half-dimensions used for shape rendering and chair placement.
  const { rx, ry } = halfDims(table);
  const chairs = chairOffsets(table.shape, table.seats, rx, ry);

  const strokeWidth = isSelected ? 22 : 14;

  // Long and head get a softer banquet-bench corner; square stays tighter.
  const rectCorner =
    table.shape === "long" || table.shape === "head"
      ? Math.min(80, ry * 0.4)
      : table.shape === "square"
        ? 40
        : 0;

  // Chair geometry — FIXED physical dimensions. A real banquet chair is
  // roughly 50×40 cm seen from above; we use 440×360 mm so the chair stays
  // a constant size regardless of the table it sits at. User explicitly
  // asked for this — scaling chairs with the table made small tables look
  // like they had child furniture.
  const chairWidthMm = CHAIR_WIDTH_MM;
  const chairHeightMm = CHAIR_HEIGHT_MM;
  const chairCorner = CHAIR_CORNER_MM;
  const disabledSet = new Set(table.disabled_seats ?? []);
  const babySet = new Set(table.baby_seats ?? []);
  // First non-disabled, non-occupied seat — used when a guest is dropped
  // onto the table body instead of a specific chair.
  const firstFreeSeat: number | null = seatMode
    ? (() => {
        for (let i = 0; i < table.seats; i++) {
          if (!disabledSet.has(i) && !(seatGuests?.has(i) ?? false)) return i;
        }
        return null;
      })()
    : null;
  const strokeClass = isSelected
    ? "stroke-umber-950 dark:stroke-paper-200"
    : dragOverTable && firstFreeSeat !== null
      ? "stroke-blush-500 dark:stroke-blush-400"
      : "stroke-ink-800 dark:stroke-umber-400";
  const fillClass = isSelected
    ? "fill-umber-900 dark:fill-paper-100"
    : dragOverTable && firstFreeSeat !== null
      ? "fill-blush-100 dark:fill-blush-400/20"
      : "fill-paper-50 dark:fill-umber-800";
  // Centre of chair sits just outside the table edge with a fixed gap.
  const chairPushMm = chairHeightMm / 2 + 40;

  // Handle set per shape. Round → 4 cardinal handles. Square/long → 8 handles.
  const handles: HandleDir[] =
    table.shape === "round" ? ["n", "e", "s", "w"] : ["n", "e", "s", "w", "ne", "nw", "se", "sw"];

  // Seat buttons sit just above the top edge in mm space.
  const seatBtnY = -ry - 320;
  const seatBtnGap = 480;
  const canDecrement = table.seats > MIN_SEATS;
  // Cap the in-canvas + button at whatever the table's perimeter allows
  // at 80 cm per chair — pressing it past the physical limit is silently
  // a no-op even when the server would clamp anyway, so the affordance
  // greys out instead.
  const maxSeats = Math.min(
    MAX_SEATS,
    maxSeatsForTable(table.shape, table.width_mm, table.length_mm),
  );
  const canIncrement = table.seats < maxSeats;

  // a11y label combines name + shape + seat count for screen readers.
  const ariaLabel = t("seating.table_aria_label")
    .replace("{name}", table.label)
    .replace("{seats}", String(table.seats));

  // Rotation is applied to the whole table group around (cx, cy). Defaults
  // to 0 for legacy rows (the field was added later, but the API mapper
  // normalises). The resize math reverses this rotation when interpreting
  // pointer deltas.
  const rotation = (((table.rotation_deg ?? 0) % 360) + 360) % 360;

  return (
    <g
      transform={`translate(${cx} ${cy}) rotate(${rotation})`}
      data-seating-table={table.id}
      onPointerDown={seatMode ? undefined : onPointerDown}
      onClick={
        seatMode && !tapMode
          ? (e: React.MouseEvent<SVGGElement>) => {
              e.stopPropagation();
              onTableClick?.();
            }
          : undefined
      }
      onDragOver={
        seatMode && firstFreeSeat !== null
          ? (e: React.DragEvent<SVGGElement>) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (!dragOverTable) setDragOverTable(true);
            }
          : undefined
      }
      onDragLeave={
        seatMode
          ? (e: React.DragEvent<SVGGElement>) => {
              if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverTable(false);
              }
            }
          : undefined
      }
      onDrop={
        seatMode && firstFreeSeat !== null
          ? (e: React.DragEvent<SVGGElement>) => {
              e.preventDefault();
              setDragOverTable(false);
              onDropSeat?.(firstFreeSeat, e);
            }
          : undefined
      }
      onKeyDown={(e) => {
        if (seatMode) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        (e.currentTarget as Element & { click?: () => void }).click?.();
      }}
      style={{
        cursor: seatMode ? "default" : "grab",
        touchAction: seatMode ? "auto" : coarsePointer ? "pan-y" : "none",
      }}
      tabIndex={seatMode ? -1 : 0}
      role={seatMode ? undefined : "button"}
      aria-label={ariaLabel}
    >
      {/* Table body — single clean stroke + warm fill. */}
      {table.shape === "round" ? (
        <circle r={rx} className={`${fillClass} ${strokeClass}`} strokeWidth={strokeWidth} />
      ) : (
        <rect
          x={-rx}
          y={-ry}
          width={rx * 2}
          height={ry * 2}
          className={`${fillClass} ${strokeClass}`}
          strokeWidth={strokeWidth}
          rx={rectCorner}
        />
      )}

      {/* Chairs. Each chair is a rounded rect tangent to the perimeter.
          In edit mode: blush for empty, navy for filled, × for disabled.
          In seat mode: chairs become drop targets, show guest names, and
          use a richer colour system (empty=blush-200, occupied=ink-700,
          selected-guest=blush-600, drag-hover=blush-400). */}
      {chairs.map((c, i) => {
        const isDisabled = disabledSet.has(i);
        const isBaby = !isDisabled && (babySet.has(i) || (babySeatedSet?.has(i) ?? false));
        const cosA = Math.cos(c.angle);
        const sinA = Math.sin(c.angle);
        const px = c.dx + cosA * chairPushMm;
        const py = c.dy + sinA * chairPushMm;
        const rotDeg = (c.angle * 180) / Math.PI + 90;

        // Use actual assignment data when available (both edit and seat mode).
        // Falls back to i < filledSeats (count-based) only when no assignment
        // map was provided — keeps the edit-mode view in sync with seat-mode.
        const seatGuest = seatGuests?.get(i) ?? null;
        const isOccupied = seatGuests ? seatGuest !== null : i < filledSeats;
        const isSelectedSeat = seatMode && seatGuest !== null && seatGuest.id === selectedGuestId;
        const isDragHover = seatMode && (dragOverSeat === i || pointerHoverSeat === i);
        const isDraggingOut = draggingSeatIndex === i;

        const fillClassName = isDisabled
          ? "fill-paper-200"
          : seatMode
            ? isDraggingOut
              ? "fill-ink-300 dark:fill-umber-600"
              : isDragHover
                ? isOccupied
                  ? "fill-blush-700"
                  : "fill-blush-400"
                : isSelectedSeat
                  ? "fill-blush-600"
                  : isOccupied
                    ? "fill-ink-700"
                    : "fill-blush-200"
            : isOccupied
              ? "fill-ink-800"
              : "fill-blush-300";

        const crossLen = chairHeightMm * 0.45;
        const babyIconSize = chairHeightMm * 0.72;

        // In seat mode, guest first name fits inside the chair.
        const guestLabel =
          seatMode && seatGuest
            ? (() => {
                const first = seatGuest.name.trim().split(/\s+/)[0] ?? seatGuest.name;
                return first.length <= 9 ? first : `${first.slice(0, 8)}.`;
              })()
            : null;

        const canDragOut = seatMode && !isDisabled && !tapMode && isOccupied && seatGuest !== null;
        return (
          <g
            key={i}
            data-seat-index={String(i)}
            data-table-id={String(table.id)}
            onPointerDown={
              canDragOut
                ? (e: React.PointerEvent<SVGGElement>) => {
                    e.stopPropagation();
                    onChairPointerDown?.(e, i, seatGuest!.id);
                  }
                : undefined
            }
            onDragOver={
              seatMode && !isDisabled
                ? (e: React.DragEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverSeat !== i) setDragOverSeat(i);
                  }
                : undefined
            }
            onDragLeave={
              seatMode && !isDisabled
                ? (e: React.DragEvent) => {
                    e.stopPropagation();
                    setDragOverSeat(null);
                  }
                : undefined
            }
            onDrop={
              seatMode && !isDisabled
                ? (e: React.DragEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverSeat(null);
                    setDragOverTable(false);
                    onDropSeat?.(i, e);
                  }
                : undefined
            }
            onClick={
              seatMode && !isDisabled
                ? (e: React.MouseEvent) => {
                    e.stopPropagation();
                    onTapSeat?.(i);
                  }
                : undefined
            }
            style={
              seatMode && !isDisabled
                ? { cursor: tapMode ? "pointer" : canDragOut ? "grab" : "default" }
                : undefined
            }
          >
            <rect
              x={px - chairWidthMm / 2}
              y={py - chairHeightMm / 2}
              width={chairWidthMm}
              height={chairHeightMm}
              rx={chairCorner}
              transform={`rotate(${rotDeg} ${px} ${py})`}
              className={fillClassName}
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
                  strokeWidth={24}
                  strokeLinecap="round"
                />
                <line
                  x1={crossLen / 2}
                  y1={-crossLen / 2}
                  x2={-crossLen / 2}
                  y2={crossLen / 2}
                  className="stroke-ink-500"
                  strokeWidth={24}
                  strokeLinecap="round"
                />
              </g>
            )}
            {isBaby && (
              <g
                transform={`translate(${px} ${py}) rotate(${rotDeg}) translate(${-babyIconSize / 2} ${-babyIconSize / 2})`}
                style={{ pointerEvents: "none" }}
              >
                <Baby
                  width={babyIconSize}
                  height={babyIconSize}
                  className={`fill-none ${isOccupied ? "stroke-paper-50" : "stroke-ink-700"}`}
                  strokeWidth={2}
                />
              </g>
            )}
            {/* In edit mode: seat number. In seat mode: guest first name, or a
                bold seat number on empty chairs. Empty seat numbers get the
                full chair-height type size (matching edit mode) and a dark
                ink fill so they stay legible at real planning zoom — the old
                0.26-width / ink-400 number was nearly invisible on the canvas
                (audit finding). */}
            {!isDisabled && !isBaby && (
              <text
                x={px}
                y={py}
                transform={`rotate(${-rotation} ${px} ${py})`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={
                  seatMode
                    ? guestLabel
                      ? chairWidthMm * 0.26
                      : chairHeightMm * 0.62
                    : chairHeightMm * 0.6
                }
                fontWeight={600}
                className={`font-grotesk ${
                  isDraggingOut
                    ? "fill-ink-500 dark:fill-umber-400"
                    : isOccupied
                      ? "fill-paper-50"
                      : "fill-ink-700"
                }`}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {seatMode ? (guestLabel ?? String(i + 1)) : i + 1}
              </text>
            )}
          </g>
        );
      })}

      {/* Label — serif, in the warm blush from the brand palette. We
          counter-rotate by -rotation so the text always reads upright in
          screen space, regardless of how the table is rotated. Label size
          is clamped: small enough that the round Table 4 doesn't shout
          over its neighbours, big enough that a narrow long/head table's
          label stays readable. If the label doesn't fit on one line at
          ~90% of the table's inner width, we wrap it to two lines so it
          stays on the table instead of bleeding past the edge. */}
      {(() => {
        const labelSize = Math.max(180, Math.min(220, Math.min(rx, ry) * 0.42));
        const baseY = labelSize * 0.35;
        // The available width depends on rotation orientation in *table*
        // space (the body extends 2*rx along its local x). The label is
        // counter-rotated, but the constraint stays in the table frame
        // because that's where it has to fit visually.
        const innerW = rx * 2 * 0.9;
        const lines = wrapLabel(table.label, innerW, labelSize);
        return (
          <g transform={`rotate(${-rotation})`} style={{ pointerEvents: "none" }}>
            <text
              x={0}
              y={baseY}
              textAnchor="middle"
              fontSize={labelSize}
              fontWeight={600}
              className={`font-grotesk ${isSelected ? "fill-paper-50 dark:fill-ink-900" : "fill-blush-700 dark:fill-umber-200"}`}
            >
              {lines.length === 1
                ? lines[0]
                : // Multi-line label. The first tspan's dy backs up by
                  // half the total stack height so the visual centre of
                  // all lines lands on the text element's y baseline.
                  // Each subsequent tspan advances by one line-height
                  // (1.1 × fontSize) from its predecessor.
                  lines.map((line, i) => {
                    const dy = i === 0 ? -labelSize * 0.55 * (lines.length - 1) : labelSize * 1.1;
                    return (
                      <tspan key={i} x={0} dy={dy}>
                        {line}
                      </tspan>
                    );
                  })}
            </text>
          </g>
        );
      })()}

      {/* Selection-only affordances: resize handles + seat buttons.
          Hidden in seat mode — tables are not editable there. */}
      {isSelected && !seatMode && (
        <>
          {handles.map((h) => (
            <ResizeHandle
              key={h}
              dir={h}
              rx={rx}
              ry={ry}
              shape={table.shape}
              onPointerDown={onHandlePointerDown}
            />
          ))}
          <SeatButton
            cx={-seatBtnGap / 2}
            cy={seatBtnY}
            kind="minus"
            disabled={!canDecrement}
            onActivate={() => onSeatsDelta(-1)}
            label={t("seating.remove_seat")}
          />
          <SeatButton
            cx={seatBtnGap / 2}
            cy={seatBtnY}
            kind="plus"
            disabled={false}
            muted={!canIncrement}
            onActivate={() => onSeatsDelta(1)}
            label={t("seating.add_seat")}
          />
        </>
      )}
    </g>
  );
}

function ResizeHandle({
  dir,
  rx,
  ry,
  shape,
  onPointerDown,
}: {
  dir: HandleDir;
  rx: number;
  ry: number;
  shape: SeatingTable["shape"];
  onPointerDown: (e: React.PointerEvent<SVGElement>, dir: HandleDir) => void;
}) {
  // Round tables only render cardinal handles. For round, project the handle
  // onto the circle perimeter so it sits ON the shape, not at a phantom
  // corner. Rectangles use a true bounding-box position.
  const pos = handlePosition(dir, rx, ry, shape);
  const cursor = handleCursor(dir);
  // Handles are SOLID espresso-filled rectangles (one step darker than the
  // selected body, with a white outline) — deliberately a different shape
  // AND fill from the hollow chair circles, so the user can never confuse
  // "I'm grabbing a chair" with "I'm grabbing a resize knob".
  // Side handles stretch along the edge they control (a bar that points
  // in the drag direction); corners are tidy squares.
  const isCorner = dir.length === 2;
  const isVerticalEdge = dir === "e" || dir === "w";
  const isHorizontalEdge = dir === "n" || dir === "s";
  const w = isCorner ? 130 : isVerticalEdge ? 90 : 240;
  const h = isCorner ? 130 : isHorizontalEdge ? 90 : 240;
  return (
    <rect
      x={pos.x - w / 2}
      y={pos.y - h / 2}
      width={w}
      height={h}
      rx={20}
      className="fill-umber-800 stroke-paper-50"
      strokeWidth={8}
      style={{ cursor }}
      onPointerDown={(e) => {
        // Don't bubble — the table body would otherwise start a move drag.
        e.stopPropagation();
        onPointerDown(e, dir);
      }}
    />
  );
}

function handlePosition(
  dir: HandleDir,
  rx: number,
  ry: number,
  shape: SeatingTable["shape"],
): { x: number; y: number } {
  if (shape === "round") {
    // Project cardinal onto the circle.
    const r = rx;
    switch (dir) {
      case "n":
        return { x: 0, y: -r };
      case "s":
        return { x: 0, y: r };
      case "e":
        return { x: r, y: 0 };
      case "w":
        return { x: -r, y: 0 };
      // Round only emits cardinals, but be safe for the type.
      default:
        return { x: 0, y: 0 };
    }
  }
  switch (dir) {
    case "n":
      return { x: 0, y: -ry };
    case "s":
      return { x: 0, y: ry };
    case "e":
      return { x: rx, y: 0 };
    case "w":
      return { x: -rx, y: 0 };
    case "ne":
      return { x: rx, y: -ry };
    case "nw":
      return { x: -rx, y: -ry };
    case "se":
      return { x: rx, y: ry };
    case "sw":
      return { x: -rx, y: ry };
  }
}

function handleCursor(dir: HandleDir): string {
  switch (dir) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
  }
}

function SeatButton({
  cx,
  cy,
  kind,
  disabled,
  muted,
  onActivate,
  label,
}: {
  cx: number;
  cy: number;
  kind: "plus" | "minus";
  /** Hard-disabled: swallows the click entirely (used for − at 1 seat). */
  disabled: boolean;
  /** Visually muted but still firing onActivate — used for + past the cap
   *  so the parent can surface a toast explaining the block. */
  muted?: boolean;
  onActivate: () => void;
  label: string;
}) {
  const Icon = kind === "plus" ? Plus : Minus;
  const radius = 180;
  // The lucide icon is rendered into a 24×24 box; scale it up to roughly
  // 60% of the circle diameter for a clear glyph at canvas zoom.
  const iconSize = radius * 1.2;
  const dim = disabled || muted;
  const fillClass = dim ? "fill-paper-200" : "fill-paper-50";
  const strokeClass = dim ? "stroke-ink-300" : "stroke-blush-600";
  const iconColor = dim ? "stroke-ink-300" : "stroke-blush-700";

  return (
    <g
      transform={`translate(${cx} ${cy})`}
      style={{ cursor: disabled ? "not-allowed" : "pointer" }}
      role="button"
      aria-label={label}
      aria-disabled={disabled || muted || undefined}
      onPointerDown={(e) => {
        // Don't start a move drag on the table.
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onActivate();
      }}
    >
      <circle r={radius} className={`${fillClass} ${strokeClass}`} strokeWidth={10} />
      <g
        transform={`translate(${-iconSize / 2} ${-iconSize / 2})`}
        style={{ pointerEvents: "none" }}
      >
        <Icon
          width={iconSize}
          height={iconSize}
          className={`fill-none ${iconColor}`}
          strokeWidth={2.5}
        />
      </g>
    </g>
  );
}

function halfDims(t: SeatingTable): { rx: number; ry: number } {
  if (t.shape === "round") {
    const r = t.width_mm / 2;
    return { rx: r, ry: r };
  }
  if (t.shape === "square") {
    const s = Math.max(t.width_mm, t.length_mm) / 2;
    return { rx: s, ry: s };
  }
  // Long and head tables — width is the shorter side (depth), length is the
  // longer side. Both orient horizontally so chairs sit naturally below /
  // along them.
  return { rx: t.length_mm / 2, ry: t.width_mm / 2 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Wrap a table label into up to 3 lines so it stays on the table body.
//
// Strategy: estimate text width as length × 0.56 × fontSize (a reasonable
// average for General Sans), then greedy word-pack into successive
// lines that each fit `maxWidth`. The last line absorbs any remaining
// words so we never produce more than MAX_LINES — better to slightly
// overflow the last line than to chop the label mid-sentence. Hard-cuts a
// single oversize word into MAX_LINES pieces if there are no spaces.
function wrapLabel(label: string, maxWidth: number, fontSize: number): string[] {
  const MAX_LINES = 3;
  const avgCharWidth = fontSize * 0.56;
  const maxChars = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  if (label.length <= maxChars) return [label];

  const words = label.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [label];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length <= maxChars || lines.length === MAX_LINES - 1) {
      // Either it fits, or we're on the last allowed line and just keep
      // appending so the rest of the label doesn't get truncated.
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);

  // No spaces: hard-cut into MAX_LINES roughly equal chunks.
  if (lines.length === 1 && lines[0]!.length > maxChars) {
    const whole = lines[0]!;
    const out: string[] = [];
    let rest = whole;
    while (rest.length > 0 && out.length < MAX_LINES) {
      out.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (rest.length > 0) {
      // Anything still left after MAX_LINES — fold into the last line.
      out[out.length - 1] = `${out[out.length - 1]}${rest}`;
    }
    return out;
  }
  return lines;
}

export const ROOM_DIMS = { W_MM: DEFAULT_ROOM_W_MM, H_MM: DEFAULT_ROOM_H_MM };
