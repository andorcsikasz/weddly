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
const ROOM_W_MM = 12_000;
const ROOM_H_MM = 9_000;
const GRID_STEP_MM = 1_000; // 1-metre grid lines

const MIN_DIM_MM = 100;
const MAX_DIM_MM = 10_000;
const MIN_SEATS = 1;
const MAX_SEATS = 40;

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
}: Props) {
  const { t } = useT();
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

  function startResize(
    e: React.PointerEvent<SVGCircleElement>,
    table: SeatingTable,
    handle: HandleDir,
  ) {
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

  return (
    <div className="card overflow-hidden p-0">
      <header className="flex items-center justify-between gap-2 border-b border-paper-200 px-4 py-2.5">
        <div>
          <h2 className="text-base">{t("seating.map_title")}</h2>
          <p className="text-xs text-ink-500">{t("seating.map_help")}</p>
        </div>
        <span className="text-xs text-ink-400">
          {(ROOM_W_MM / 1000).toFixed(0)} × {(ROOM_H_MM / 1000).toFixed(0)} m
        </span>
      </header>
      <div className="relative bg-paper-50">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${ROOM_W_MM} ${ROOM_H_MM}`}
          // 4:3 aspect; height is set via CSS so the SVG stays responsive.
          className="block h-[60vh] max-h-[640px] w-full select-none touch-none"
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          // Click on empty area to deselect.
          onClick={(e) => {
            if (e.target === svgRef.current) onSelect(null);
          }}
          aria-label={t("seating.map_title")}
          role="img"
        >
          <Grid />
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

function Grid() {
  // Faint 1m grid plus a stronger room border. We draw the lines inline
  // rather than via <pattern> so screenshots / a11y trees stay simple.
  const lines: React.ReactElement[] = [];
  for (let x = GRID_STEP_MM; x < ROOM_W_MM; x += GRID_STEP_MM) {
    lines.push(
      <line
        key={`vx-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={ROOM_H_MM}
        className="stroke-paper-300"
        strokeWidth={4}
      />,
    );
  }
  for (let y = GRID_STEP_MM; y < ROOM_H_MM; y += GRID_STEP_MM) {
    lines.push(
      <line
        key={`hy-${y}`}
        x1={0}
        y1={y}
        x2={ROOM_W_MM}
        y2={y}
        className="stroke-paper-300"
        strokeWidth={4}
      />,
    );
  }
  return (
    <g>
      <rect
        x={0}
        y={0}
        width={ROOM_W_MM}
        height={ROOM_H_MM}
        className="fill-paper-50 stroke-paper-500"
        strokeWidth={12}
      />
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
  onHandlePointerDown: (e: React.PointerEvent<SVGCircleElement>, handle: HandleDir) => void;
  onSeatsDelta: (delta: number) => void;
  t: (key: "seating.add_seat" | "seating.remove_seat") => string;
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

  const strokeClass = isSelected ? "stroke-blush-600" : "stroke-ink-800";
  const strokeWidth = isSelected ? 22 : 14;
  const fillClass = isSelected ? "fill-blush-50" : "fill-paper-50";

  // Inner accent rect/circle inset for a "double border" stationery feel.
  const innerInset = 60;
  const innerRx = Math.max(0, rx - innerInset);
  const innerRy = Math.max(0, ry - innerInset);

  // Long tables get more pronounced banquet-bench rounding; square keeps a
  // subtle 40mm corner.
  const rectCorner =
    table.shape === "long" ? Math.min(80, ry * 0.4) : table.shape === "square" ? 40 : 0;
  const innerRectCorner = Math.max(0, rectCorner - innerInset * 0.4);

  // Handle set per shape. Round → 4 cardinal handles. Square/long → 8 handles.
  const handles: HandleDir[] =
    table.shape === "round" ? ["n", "e", "s", "w"] : ["n", "e", "s", "w", "ne", "nw", "se", "sw"];

  // Seat buttons sit just above the top edge in mm space.
  const seatBtnY = -ry - 320;
  const seatBtnGap = 480;
  const canDecrement = table.seats > MIN_SEATS;
  const canIncrement = table.seats < MAX_SEATS;

  return (
    <g
      transform={`translate(${cx} ${cy})`}
      onPointerDown={onPointerDown}
      style={{ cursor: "grab" }}
      // Keyboard a11y: focusable and Enter/Space mimics a click-to-select.
      // (Drag is mouse-only; keyboard nudge isn't in v1 scope.)
      tabIndex={0}
    >
      {table.shape === "round" ? (
        <>
          <circle r={rx} className={`${fillClass} ${strokeClass}`} strokeWidth={strokeWidth} />
          {innerRx > 0 && (
            <circle
              r={innerRx}
              className="fill-none stroke-paper-300"
              strokeWidth={4}
              style={{ pointerEvents: "none" }}
            />
          )}
        </>
      ) : (
        <>
          <rect
            x={-rx}
            y={-ry}
            width={rx * 2}
            height={ry * 2}
            className={`${fillClass} ${strokeClass}`}
            strokeWidth={strokeWidth}
            rx={rectCorner}
          />
          {innerRx > 0 && innerRy > 0 && (
            <rect
              x={-innerRx}
              y={-innerRy}
              width={innerRx * 2}
              height={innerRy * 2}
              className="fill-none stroke-paper-300"
              strokeWidth={4}
              rx={innerRectCorner}
              style={{ pointerEvents: "none" }}
            />
          )}
        </>
      )}

      {/* Chairs */}
      {chairs.map((c, i) => (
        <circle
          key={i}
          cx={c.dx}
          cy={c.dy}
          r={90}
          className={`stroke-ink-500 ${i < filledSeats ? "fill-ink-600" : "fill-paper-50"}`}
          strokeWidth={6}
        />
      ))}

      {/* Label */}
      <text
        x={0}
        y={-10}
        textAnchor="middle"
        fontSize={Math.min(rx, ry) * 0.45}
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight={600}
        className="fill-ink-800"
        style={{ pointerEvents: "none" }}
      >
        {table.label}
      </text>
      <text
        x={0}
        y={Math.min(rx, ry) * 0.45 + 30}
        textAnchor="middle"
        fontSize={Math.min(rx, ry) * 0.3}
        fontFamily="Inter, system-ui, sans-serif"
        className="fill-ink-500"
        style={{ pointerEvents: "none" }}
      >
        {filledSeats} / {table.seats}
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
  onPointerDown: (e: React.PointerEvent<SVGCircleElement>, dir: HandleDir) => void;
}) {
  // Round tables only render cardinal handles. For round, project the handle
  // onto the circle perimeter so it sits ON the shape, not at a phantom
  // corner. Rectangles use a true bounding-box position.
  const pos = handlePosition(dir, rx, ry, shape);
  const cursor = handleCursor(dir);
  return (
    <circle
      cx={pos.x}
      cy={pos.y}
      r={70}
      className="fill-paper-50 stroke-blush-600"
      strokeWidth={6}
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
  // Long table — width is the shorter side, length is the longer side. We
  // orient long tables horizontally so the shape reads "long" by default.
  return { rx: t.length_mm / 2, ry: t.width_mm / 2 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export const ROOM_DIMS = { W_MM: ROOM_W_MM, H_MM: ROOM_H_MM };
