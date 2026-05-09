// Floor-plan map. SVG canvas where each table is a draggable shape with
// chairs auto-positioned around the perimeter. The user world is in
// millimetres (matches what the PDF renderer consumes), so what you see on
// screen is what you'll get on the printed seating chart.
//
// Persistence rule: drag updates local x_mm/y_mm in real time but only PATCHes
// the server on pointer-up — otherwise we'd spam the API every 16ms.

import type { SeatAssignment, SeatingTable } from "@shared/types";
import { chairOffsets } from "@shared/seating";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";

// Default room: 12m × 9m. Wide enough for a 200-person wedding without feeling
// cramped; the SVG scales to its container so absolute pixels don't matter.
const ROOM_W_MM = 12_000;
const ROOM_H_MM = 9_000;
const GRID_STEP_MM = 1_000; // 1-metre grid lines

interface Props {
  tables: SeatingTable[];
  assignments: SeatAssignment[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Called once on pointer-up after a drag, with rounded mm coordinates. */
  onMove: (id: number, x_mm: number, y_mm: number) => void;
}

interface DragState {
  tableId: number;
  // Offset (in mm) from the table centre to the pointer at drag-start, so
  // the table doesn't jump on grab.
  grabOffsetX: number;
  grabOffsetY: number;
}

export function SeatingMap({ tables, assignments, selectedId, onSelect, onMove }: Props) {
  const { t } = useT();
  const svgRef = useRef<SVGSVGElement | null>(null);
  // We mirror table positions locally so dragging is smooth without round-
  // tripping to the server. Keyed by table id; falls back to the prop value.
  const [localPos, setLocalPos] = useState<Map<number, { x: number; y: number }>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);

  // Reset local overrides whenever the underlying tables prop changes
  // (e.g. server refresh). Otherwise stale drag positions could linger.
  useEffect(() => {
    setLocalPos(new Map());
  }, [tables]);

  const seatsByTable = new Map<number, SeatAssignment[]>();
  for (const a of assignments) {
    if (!seatsByTable.has(a.table_id)) seatsByTable.set(a.table_id, []);
    seatsByTable.get(a.table_id)!.push(a);
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

  function startDrag(e: React.PointerEvent<SVGGElement>, table: SeatingTable) {
    // Don't start a drag from secondary clicks (right-click etc).
    if (e.button !== 0) return;
    const p = toSvgPoint(e.clientX, e.clientY);
    if (!p) return;
    const cur = localPos.get(table.id) ?? { x: table.x_mm, y: table.y_mm };
    setDrag({
      tableId: table.id,
      grabOffsetX: p.x - cur.x,
      grabOffsetY: p.y - cur.y,
    });
    onSelect(table.id);
    // Capture pointer so we keep getting events even outside the SVG.
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function moveDrag(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = toSvgPoint(e.clientX, e.clientY);
    if (!p) return;
    const newX = clamp(Math.round(p.x - drag.grabOffsetX), 0, ROOM_W_MM);
    const newY = clamp(Math.round(p.y - drag.grabOffsetY), 0, ROOM_H_MM);
    setLocalPos((prev) => {
      const next = new Map(prev);
      next.set(drag.tableId, { x: newX, y: newY });
      return next;
    });
  }

  function endDrag(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const pos = localPos.get(drag.tableId);
    if (pos) onMove(drag.tableId, pos.x, pos.y);
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
            const filled = seatsByTable.get(table.id)?.length ?? 0;
            return (
              <TableShape
                key={table.id}
                table={table}
                cx={pos.x}
                cy={pos.y}
                filledSeats={filled}
                isSelected={selectedId === table.id}
                onPointerDown={(e) => startDrag(e, table)}
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
}

function TableShape({ table, cx, cy, filledSeats, isSelected, onPointerDown }: TableShapeProps) {
  // Half-dimensions used for shape rendering and chair placement.
  const { rx, ry } = halfDims(table);
  const chairs = chairOffsets(table.shape, table.seats, rx, ry);
  // Selection highlight uses our blush accent; default uses ink.800.
  const strokeClass = isSelected ? "stroke-blush-600" : "stroke-ink-800";
  const strokeWidth = isSelected ? 18 : 10;

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
        <circle r={rx} className={`fill-paper-100 ${strokeClass}`} strokeWidth={strokeWidth} />
      ) : (
        <rect
          x={-rx}
          y={-ry}
          width={rx * 2}
          height={ry * 2}
          className={`fill-paper-100 ${strokeClass}`}
          strokeWidth={strokeWidth}
          rx={40}
        />
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
