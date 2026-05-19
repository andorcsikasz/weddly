// Floor-plan map. SVG canvas where each table is a draggable shape with
// chairs auto-positioned around the perimeter. The user world is in
// millimetres (matches what the PDF renderer consumes), so what you see on
// screen is what you'll get on the printed seating chart.
//
// Persistence rule: drag/resize/seat-change updates local state in real time
// but only PATCHes the server on pointer-up — otherwise we'd spam the API.

import type { SeatAssignment, SeatingTable } from "@shared/types";
import { chairOffsets, maxSeatsForTable } from "@shared/seating";
import { Baby, Maximize2, Minus, Plus, X } from "lucide-react";
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
}: Props) {
  const { t } = useT();
  // Local aliases keep the rest of the component readable; the rendering
  // and clamp logic still references these in mm.
  const ROOM_W_MM = roomWidthMm;
  const ROOM_H_MM = roomHeightMm;
  const svgRef = useRef<SVGSVGElement | null>(null);
  // We mirror table positions / dimensions locally so dragging is smooth
  // without round-tripping to the server. Keyed by table id; falls back to
  // the prop value when nothing is overridden.
  const [localPos, setLocalPos] = useState<Map<number, { x: number; y: number }>>(new Map());
  const [localDims, setLocalDims] = useState<Map<number, { width_mm: number; length_mm: number }>>(
    new Map(),
  );
  const [drag, setDrag] = useState<DragState | null>(null);

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

  // Pick a scale + SVG pixel size for the EXPANDED overlay only.
  // Always "max-scale": pick the larger of the two fit ratios so the
  // shorter axis fills the wrapper and the longer axis overflows. This
  // guarantees the canvas is scrollable in expanded mode regardless of
  // room size or aspect — what the user wants when they click maximise to
  // dig into details.
  //
  // The inline card stays on plain fit-to-meet — the user wants to *see
  // the whole room at a glance* in the editor surface; the expand button
  // is the affordance for "I want to scroll around at a useful zoom".
  const svgSize = useMemo<{ width: number | string; height: number | string }>(() => {
    if (!expanded || !wrapperPx || wrapperPx.w <= 0 || wrapperPx.h <= 0) {
      return { width: "100%", height: "100%" };
    }
    const scale = Math.max(wrapperPx.w / ROOM_W_MM, wrapperPx.h / ROOM_H_MM);
    return { width: ROOM_W_MM * scale, height: ROOM_H_MM * scale };
  }, [expanded, wrapperPx, ROOM_W_MM, ROOM_H_MM]);

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
          <h2 className="text-base">{t("seating.map_title")}</h2>
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
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md border border-paper-300 bg-paper-50 p-1.5 text-ink-500 transition-colors hover:border-ink-700 hover:text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-200 dark:hover:border-paper-100 dark:hover:text-paper-100"
            aria-label={expanded ? t("seating.map_collapse") : t("seating.map_expand")}
            title={expanded ? t("seating.map_collapse") : t("seating.map_expand")}
          >
            {expanded ? <X size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        </div>
      </header>
      {/* Two-level wrapper structure so the SVG can be both centred (when
          smaller than the viewport) and fully scrollable (when bigger).
          Putting `align-items: center` directly on the scroll container
          would push an overlarge SVG's top above the container's content
          edge — the area is *unreachable* by the scrollbar (a known flex
          + overflow gotcha). Splitting it: the outer div owns the scroll
          and the fixed viewport size, the inner div owns the centring and
          grows to enclose the SVG. */}
      <div
        ref={scrollWrapperRef}
        className={`relative overflow-auto bg-paper-50 dark:bg-umber-900 ${
          expanded ? "min-h-0 flex-1 p-4" : "h-[60vh] max-h-[640px] w-full"
        }`}
      >
        <div className="flex min-h-full min-w-full items-center justify-center">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${ROOM_W_MM} ${ROOM_H_MM}`}
            preserveAspectRatio="xMidYMid meet"
            style={{
              width: svgSize.width,
              height: svgSize.height,
              flexShrink: 0,
            }}
            className="block select-none touch-none focus:outline-none"
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
                  onPointerDown={(e) => startMove(e, table)}
                  onHandlePointerDown={(e, h) => startResize(e, table, h)}
                  onSeatsDelta={(delta) => onSeatsChange(table.id, delta)}
                  t={t}
                />
              );
            })}
          </svg>
        </div>
      </div>
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
            onMouseDown={(e) => {
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

  return <div className="card overflow-hidden p-0">{cardContent}</div>;
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
    "w-8 border-0 bg-transparent p-0 text-right text-sm font-medium text-ink-700 tabular-nums focus:outline-none focus:underline focus:decoration-dotted hover:underline hover:decoration-dotted dark:text-paper-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
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
      <span aria-hidden>×</span>
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
        className="stroke-paper-500"
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
        className="stroke-paper-500"
        strokeWidth={8}
        strokeDasharray="60 60"
      />,
    );
  }
  return (
    <g>
      <rect x={0} y={0} width={widthMm} height={heightMm} className="fill-paper-50" />
      {lines}
      {/* Room boundary — chunky ink frame around the planning canvas so the
          area reads as the actual venue floorplan rather than a free-floating
          grid. `pointer-events: none` so tables on the edge stay draggable
          and clicks in negative space still bubble to the SVG root for the
          deselect-on-empty handler. Stroke is ~5x the grid hairline so it
          pops without competing with the table fills. */}
      <rect
        x={0}
        y={0}
        width={widthMm}
        height={heightMm}
        className="fill-none stroke-ink-700"
        strokeWidth={60}
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
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onHandlePointerDown: (e: React.PointerEvent<SVGElement>, handle: HandleDir) => void;
  onSeatsDelta: (delta: number) => void;
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
  onPointerDown,
  onHandlePointerDown,
  onSeatsDelta,
  t,
}: TableShapeProps) {
  // Half-dimensions used for shape rendering and chair placement.
  const { rx, ry } = halfDims(table);
  const chairs = chairOffsets(table.shape, table.seats, rx, ry);

  // Stationery aesthetic from the landing-page mockup: clean white-ish
  // table body, dark navy single stroke, blush rounded-rect chairs spaced
  // just outside the perimeter. Selection swaps the body to a warm blush
  // tint AND thickens the stroke so the active table is unmissable on
  // a crowded floor plan.
  const strokeClass = isSelected ? "stroke-blush-700" : "stroke-ink-800";
  const strokeWidth = isSelected ? 22 : 14;
  const fillClass = isSelected ? "fill-blush-400" : "fill-paper-50";

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
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        // Enter/Space selects the table for the editor panel — mirrors a
        // click. Arrow/[/]/Delete shortcuts are intercepted by the parent
        // SeatingMap keydown handler, so we let those bubble through.
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        // Reuse onPointerDown's selection side-effect by emitting a synthetic
        // pointer-like event. SeatingMap calls onSelect inside startMove —
        // for keyboard users we'd just want selection, no drag. The parent
        // canvas listens to focus-within for this too, so the cheapest fix
        // is to dispatch a click on the element.
        (e.currentTarget as Element & { click?: () => void }).click?.();
      }}
      style={{ cursor: "grab" }}
      // Keyboard a11y: focusable, Enter/Space mimics a click-to-select, and
      // arrow/[/]/Delete shortcuts are handled by the parent SeatingMap so a
      // single keydown listener can govern the whole canvas.
      tabIndex={0}
      role="button"
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

      {/* Chairs. Each chair is a rounded rect tangent to the perimeter, in
          blush — empty seats read soft, filled seats read warmer. The
          chair's long axis runs along the table edge (perpendicular to the
          radial direction), so it visually "faces" the table like a real
          chair from above. Disabled seats render as a muted ghost with a
          small × so the couple sees the slot exists but is intentionally
          unused. */}
      {chairs.map((c, i) => {
        const isFilled = i < filledSeats;
        const isDisabled = disabledSet.has(i);
        // Show the baby icon either when the chair is *flagged* (needs a
        // high chair) or when an actual baby guest is currently sitting
        // there. Both states read the same way: a Baby icon overlaying
        // the chair so the venue knows to bring (or already brought) a
        // high chair.
        const isBaby = !isDisabled && (babySet.has(i) || (babySeatedSet?.has(i) ?? false));
        const cosA = Math.cos(c.angle);
        const sinA = Math.sin(c.angle);
        const px = c.dx + cosA * chairPushMm;
        const py = c.dy + sinA * chairPushMm;
        const rotDeg = (c.angle * 180) / Math.PI + 90;
        const fillClassName = isDisabled
          ? "fill-paper-200"
          : isFilled
            ? "fill-ink-800"
            : "fill-blush-300";
        // Small × across a disabled chair, drawn in its rotated local frame
        // so it sits centred on the chair regardless of where it is on
        // the table.
        const crossLen = chairHeightMm * 0.45;
        // Baby icon — the lucide Baby glyph, sized to fit roughly two
        // thirds of the chair so it reads at the canvas zoom.
        const babyIconSize = chairHeightMm * 0.72;
        return (
          <g key={i}>
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
                  className={`fill-none ${isFilled ? "stroke-paper-50" : "stroke-ink-700"}`}
                  strokeWidth={2}
                />
              </g>
            )}
            {!isDisabled && !isBaby && (
              <text
                x={px}
                y={py}
                transform={`rotate(${-rotation} ${px} ${py})`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={chairHeightMm * 0.6}
                fontFamily='"Cormorant Garamond", Georgia, serif'
                fontWeight={600}
                className={isFilled ? "fill-paper-50" : "fill-ink-700"}
                style={{ pointerEvents: "none" }}
              >
                {i + 1}
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
              fontFamily='"Cormorant Garamond", Georgia, serif'
              fontWeight={600}
              className={isSelected ? "fill-paper-50" : "fill-blush-700"}
            >
              {lines.length === 1 ? (
                lines[0]
              ) : (
                <>
                  <tspan x={0} dy={-labelSize * 0.55}>
                    {lines[0]}
                  </tspan>
                  <tspan x={0} dy={labelSize * 1.1}>
                    {lines[1]}
                  </tspan>
                </>
              )}
            </text>
          </g>
        );
      })()}

      {/* Selection-only affordances: resize handles + seat buttons. */}
      {isSelected && (
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
            // + stays clickable past the perimeter cap so the parent's
            // onSeatsChange can fire a toast explaining why it didn't work.
            // We still mark the visual as muted via canIncrement → muted=true.
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
  // Handles are SOLID blush-filled rectangles — deliberately a different
  // shape AND fill from the hollow chair circles, so the user can never
  // confuse "I'm grabbing a chair" with "I'm grabbing a resize knob".
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
      className="fill-blush-600 stroke-paper-50"
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

// Decide how many lines a table label should occupy.
// One line if the estimated width fits `maxWidth` at `fontSize`; otherwise
// split at the space closest to the middle. Falls back to a hard mid-word
// split if there's no space at all. Always returns at most 2 lines — beyond
// that the label is too long for the table and the second line is just
// wrapped as-is (the user can rename if it still overflows).
//
// Width estimation uses 0.52 of fontSize per character — a reasonable
// average for Cormorant Garamond at body weights. Good enough as a
// "should I wrap?" decision without measuring the actual rendered text.
function wrapLabel(label: string, maxWidth: number, fontSize: number): string[] {
  const avgCharWidth = fontSize * 0.52;
  const estWidth = label.length * avgCharWidth;
  if (estWidth <= maxWidth) return [label];
  // Find the space closest to the middle.
  const mid = label.length / 2;
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== " ") continue;
    const d = Math.abs(i - mid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best === -1) {
    // No space — hard split at the middle character.
    const cut = Math.floor(mid);
    return [label.slice(0, cut), label.slice(cut)];
  }
  return [label.slice(0, best).trim(), label.slice(best + 1).trim()];
}

export const ROOM_DIMS = { W_MM: DEFAULT_ROOM_W_MM, H_MM: DEFAULT_ROOM_H_MM };
