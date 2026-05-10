// Floor-plan map. SVG canvas where each table is a draggable shape with
// chairs auto-positioned around the perimeter. The user world is in
// millimetres (matches what the PDF renderer consumes), so what you see on
// screen is what you'll get on the printed seating chart.
//
// Persistence rule: drag/resize/seat-change updates local state in real time
// but only PATCHes the server on pointer-up — otherwise we'd spam the API.

import type { SeatAssignment, SeatingTable } from "@shared/types";
import { chairOffsets } from "@shared/seating";
import { Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";

// Default room: 12m × 9m. Wide enough for a 200-person wedding without feeling
// cramped; the SVG scales to its container so absolute pixels don't matter.
// These are *defaults* — the actual canvas size is per-couple state owned by
// SeatingPage and passed as a prop, with localStorage persistence today.
const DEFAULT_ROOM_W_MM = 12_000;
const DEFAULT_ROOM_H_MM = 9_000;
// Sensible bounds for the editable input: 3m (intimate) to 50m (ballroom).
const MIN_ROOM_MM = 3_000;
const MAX_ROOM_MM = 50_000;
const GRID_STEP_MM = 1_000; // 1-metre grid lines

const MIN_DIM_MM = 100;
const MAX_DIM_MM = 10_000;
const MIN_SEATS = 1;
const MAX_SEATS = 40;

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
      const newX = clamp(Math.round(p.x - drag.grabOffsetX), 0, ROOM_W_MM);
      const newY = clamp(Math.round(p.y - drag.grabOffsetY), 0, ROOM_H_MM);
      setLocalPos((prev) => {
        const next = new Map(prev);
        next.set(drag.tableId, { x: newX, y: newY });
        return next;
      });
      return;
    }

    // Resize. Symmetric around the table centre: new side = 2 × |pointer - centre|
    // along the relevant axis. For uniform-scale shapes (round/square) we use
    // the larger of |dx|/|dy|.
    const table = tables.find((tb) => tb.id === drag.tableId);
    if (!table) return;
    const dx = Math.abs(p.x - drag.cx);
    const dy = Math.abs(p.y - drag.cy);
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
      // Mirror locally for instant feedback, then persist.
      setLocalPos((prev) => {
        const next = new Map(prev);
        next.set(table.id, { x: newX, y: newY });
        return next;
      });
      onMove(table.id, newX, newY);
    },
    [selectedId, tables, localPos, onMove, onSeatsChange, onDeleteTable, onAddTable],
  );

  return (
    <div className="card overflow-hidden p-0">
      <header className="flex items-center justify-between gap-2 border-b border-paper-200 px-4 py-2.5">
        <div>
          <h2 className="text-base">{t("seating.map_title")}</h2>
          <p className="text-xs text-ink-500">{t("seating.map_help")}</p>
        </div>
        <RoomDimsInput
          widthMm={ROOM_W_MM}
          heightMm={ROOM_H_MM}
          onChange={onRoomChange}
          widthAriaLabel={t("seating.room_width_aria")}
          heightAriaLabel={t("seating.room_height_aria")}
        />
      </header>
      <div className="relative bg-paper-50">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${ROOM_W_MM} ${ROOM_H_MM}`}
          // 4:3 aspect; height is set via CSS so the SVG stays responsive.
          className="block h-[60vh] max-h-[640px] w-full select-none touch-none focus:outline-none"
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
  const cls =
    "w-12 rounded-md border border-paper-300 bg-paper-50 px-1.5 py-0.5 text-right text-xs text-ink-700 focus:border-ink-700 focus:outline-none";
  return (
    <span className="flex items-center gap-1 text-xs text-ink-400">
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
  // Faint dashed 1m grid plus a soft room border. The dashes match the
  // landing-page mockup aesthetic — feels like graph paper rather than a
  // technical CAD grid.
  const lines: React.ReactElement[] = [];
  for (let x = GRID_STEP_MM; x < widthMm; x += GRID_STEP_MM) {
    lines.push(
      <line
        key={`vx-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={heightMm}
        className="stroke-paper-300"
        strokeWidth={4}
        strokeDasharray="40 80"
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
        className="stroke-paper-300"
        strokeWidth={4}
        strokeDasharray="40 80"
      />,
    );
  }
  return (
    <g>
      <rect x={0} y={0} width={widthMm} height={heightMm} className="fill-paper-50" />
      {lines}
    </g>
  );
}

interface TableShapeProps {
  table: SeatingTable;
  cx: number;
  cy: number;
  filledSeats: number;
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
  // just outside the perimeter. Selection lifts the stroke without changing
  // the warmth of the fill.
  const strokeClass = isSelected ? "stroke-blush-600" : "stroke-ink-800";
  const strokeWidth = isSelected ? 22 : 14;
  const fillClass = "fill-paper-50";

  // Long and head get a softer banquet-bench corner; square stays tighter.
  const rectCorner =
    table.shape === "long" || table.shape === "head"
      ? Math.min(80, ry * 0.4)
      : table.shape === "square"
        ? 40
        : 0;

  // Chair geometry — proportional to the smaller half-dim so chairs read
  // sensibly on tiny round tables AND on wide head tables. Width is the
  // long axis (tangent to the table edge); height is the depth.
  const minHalf = Math.min(rx, ry);
  const chairWidthMm = Math.max(180, Math.min(320, minHalf * 0.36));
  const chairHeightMm = Math.max(130, Math.min(220, minHalf * 0.27));
  const chairCorner = chairHeightMm * 0.3;
  // Centre of chair sits just outside the table edge.
  const chairPushMm = chairHeightMm / 2 + 40;

  // Handle set per shape. Round → 4 cardinal handles. Square/long → 8 handles.
  const handles: HandleDir[] =
    table.shape === "round" ? ["n", "e", "s", "w"] : ["n", "e", "s", "w", "ne", "nw", "se", "sw"];

  // Seat buttons sit just above the top edge in mm space.
  const seatBtnY = -ry - 320;
  const seatBtnGap = 480;
  const canDecrement = table.seats > MIN_SEATS;
  const canIncrement = table.seats < MAX_SEATS;

  // a11y label combines name + shape + seat count for screen readers.
  const ariaLabel = t("seating.table_aria_label")
    .replace("{name}", table.label)
    .replace("{seats}", String(table.seats));

  return (
    <g
      transform={`translate(${cx} ${cy})`}
      data-seating-table={table.id}
      onPointerDown={onPointerDown}
      style={{ cursor: "grab" }}
      // Keyboard a11y: focusable, Enter/Space mimics a click-to-select, and
      // arrow/[/]/Delete shortcuts are handled by the parent SeatingMap so a
      // single keydown listener can govern the whole canvas.
      tabIndex={0}
      role="group"
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
          chair from above. */}
      {chairs.map((c, i) => {
        const isFilled = i < filledSeats;
        const cosA = Math.cos(c.angle);
        const sinA = Math.sin(c.angle);
        const px = c.dx + cosA * chairPushMm;
        const py = c.dy + sinA * chairPushMm;
        const rotDeg = (c.angle * 180) / Math.PI + 90;
        return (
          <rect
            key={i}
            x={px - chairWidthMm / 2}
            y={py - chairHeightMm / 2}
            width={chairWidthMm}
            height={chairHeightMm}
            rx={chairCorner}
            transform={`rotate(${rotDeg} ${px} ${py})`}
            className={isFilled ? "fill-blush-600" : "fill-blush-300"}
          />
        );
      })}

      {/* Label — serif, in the warm blush from the brand palette. */}
      <text
        x={0}
        y={Math.min(rx, ry) * 0.15}
        textAnchor="middle"
        fontSize={Math.min(rx, ry) * 0.42}
        fontFamily='"Cormorant Garamond", Georgia, serif'
        fontWeight={600}
        className="fill-blush-700"
        style={{ pointerEvents: "none" }}
      >
        {table.label}
      </text>

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
            disabled={!canIncrement}
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
  onActivate,
  label,
}: {
  cx: number;
  cy: number;
  kind: "plus" | "minus";
  disabled: boolean;
  onActivate: () => void;
  label: string;
}) {
  const Icon = kind === "plus" ? Plus : Minus;
  const radius = 180;
  // The lucide icon is rendered into a 24×24 box; scale it up to roughly
  // 60% of the circle diameter for a clear glyph at canvas zoom.
  const iconSize = radius * 1.2;
  const fillClass = disabled ? "fill-paper-200" : "fill-paper-50";
  const strokeClass = disabled ? "stroke-ink-300" : "stroke-blush-600";
  const iconColor = disabled ? "stroke-ink-300" : "stroke-blush-700";

  return (
    <g
      transform={`translate(${cx} ${cy})`}
      style={{ cursor: disabled ? "not-allowed" : "pointer" }}
      role="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
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

export const ROOM_DIMS = { W_MM: DEFAULT_ROOM_W_MM, H_MM: DEFAULT_ROOM_H_MM };
