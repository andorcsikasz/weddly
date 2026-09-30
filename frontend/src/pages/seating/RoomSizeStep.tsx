// First-run room sizing, shown in the seating empty state before the first
// table exists. The canvas already has an inline W × H input in its header,
// but a couple who has never seen the canvas cannot know it is there, and
// every table they place lands relative to a 12 × 9 m room they never chose.
// Asking once, up front, means the first table is centred in THEIR room and
// the PDF prints at the size of the real hall.
//
// The values are kept as raw text so a half-typed "1" isn't clamped to 3 m
// mid-keystroke; the parent reads `parseRoomSize` when the couple commits.

import { MAX_ROOM_MM, MIN_ROOM_MM } from "@shared/seating";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { useT } from "../../lib/i18n";

export interface RoomSizeDraft {
  w: string;
  h: string;
}

export function roomDraftFromMm(widthMm: number, heightMm: number): RoomSizeDraft {
  return { w: String(Math.round(widthMm / 100) / 10), h: String(Math.round(heightMm / 100) / 10) };
}

/** Metres text → whole millimetres inside the editor's bounds, or null when a
 *  field is empty or not a number (the caller then keeps the current room). */
export function parseRoomSize(draft: RoomSizeDraft): { w: number; h: number } | null {
  const w = Number(draft.w.replace(",", "."));
  const h = Number(draft.h.replace(",", "."));
  if (!draft.w.trim() || !draft.h.trim() || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const clamp = (m: number) => Math.max(MIN_ROOM_MM, Math.min(MAX_ROOM_MM, Math.round(m * 1000)));
  return { w: clamp(w), h: clamp(h) };
}

/** Drag and arrow-key step: half a metre, the finest a couple can pace out. */
const ROOM_STEP_M = 0.5;
const snapMetres = (m: number) =>
  Math.max(
    MIN_ROOM_MM / 1000,
    Math.min(MAX_ROOM_MM / 1000, Math.round(m / ROOM_STEP_M) * ROOM_STEP_M),
  );

type DragAxis = "w" | "h" | "both";

export function RoomSizeStep({
  draft,
  onChange,
}: {
  draft: RoomSizeDraft;
  onChange: (next: RoomSizeDraft) => void;
}) {
  const { t } = useT();
  const parsed = parseRoomSize(draft);
  const wM = (parsed?.w ?? 12_000) / 1000;
  const hM = (parsed?.h ?? 9_000) / 1000;
  // Proportional outline of the room, so "20 × 8" reads as a long hall at a
  // glance. Longest side fills the frame; the other scales with it, and the
  // two numbers sit on the edges they measure.
  const FRAME_W = 220;
  const FRAME_H = 132;
  const fitScale = Math.min(FRAME_W / wM, FRAME_H / hM);
  // While an edge is being dragged the scale is FROZEN at what it was when the
  // drag began: refitting mid-drag would shrink the room under the pointer and
  // the edge would run away from the finger. It refits on release.
  const drag = useRef<{
    axis: DragAxis;
    x: number;
    y: number;
    w: number;
    h: number;
    scale: number;
  } | null>(null);
  const [frozenScale, setFrozenScale] = useState<number | null>(null);
  const scale = frozenScale ?? fitScale;
  const pw = Math.max(24, wM * scale);
  const ph = Math.max(24, hM * scale);
  const fmt = (m: number) => String(Math.round(m * 10) / 10);
  const emit = (w: number, h: number) => onChange({ w: String(w), h: String(h) });

  function startDrag(axis: DragAxis, e: PointerEvent<HTMLElement>) {
    // preventDefault stops text selection mid-drag, but it also swallows the
    // focus a click would give, so the arrow keys would never reach the handle.
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { axis, x: e.clientX, y: e.clientY, w: wM, h: hM, scale: fitScale };
    setFrozenScale(fitScale);
  }
  function moveDrag(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    // The room is centred in its frame, so it grows on both sides at once:
    // twice the pointer's travel keeps the grabbed edge under the pointer.
    const w = d.axis === "h" ? d.w : snapMetres(d.w + (2 * (e.clientX - d.x)) / d.scale);
    const h = d.axis === "w" ? d.h : snapMetres(d.h + (2 * (e.clientY - d.y)) / d.scale);
    if (w !== wM || h !== hM) emit(w, h);
  }
  function endDrag() {
    drag.current = null;
    setFrozenScale(null);
  }
  function onHandleKey(axis: "w" | "h", e: KeyboardEvent<HTMLElement>) {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : 0;
    if (dir === 0) return;
    e.preventDefault();
    if (axis === "w") emit(snapMetres(wM + dir * ROOM_STEP_M), hM);
    else emit(wM, snapMetres(hM + dir * ROOM_STEP_M));
  }
  const dragProps = (axis: DragAxis) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => startDrag(axis, e),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });
  const grip = "rounded-full bg-ink-900 dark:bg-paper-50";

  return (
    <div>
      <h2 className="font-grotesk text-[1.75rem] font-bold leading-tight tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
        {t("seating.room_step_title")}
      </h2>

      <div className="mt-8 flex h-52 select-none items-center justify-center rounded-2xl border border-paper-200 bg-white dark:border-umber-700 dark:bg-umber-800">
        <div
          className={`relative rounded-md border-2 border-ink-900 bg-paper-100 dark:border-paper-50 dark:bg-umber-700 ${
            frozenScale === null ? "transition-all duration-300" : ""
          }`}
          style={{ width: pw, height: ph }}
        >
          <span
            aria-hidden
            className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums text-ink-700 dark:text-paper-200"
          >
            {fmt(wM)} m
          </span>
          <span
            aria-hidden
            className="absolute -right-4 top-1/2 -translate-y-1/2 translate-x-full whitespace-nowrap text-xs font-semibold tabular-nums text-ink-700 dark:text-paper-200"
          >
            {fmt(hM)} m
          </span>
          {/* Right edge: width. */}
          <span
            role="slider"
            tabIndex={0}
            aria-label={t("seating.room_width_aria")}
            aria-orientation="horizontal"
            aria-valuemin={MIN_ROOM_MM / 1000}
            aria-valuemax={MAX_ROOM_MM / 1000}
            aria-valuenow={wM}
            aria-valuetext={`${fmt(wM)} m`}
            onKeyDown={(e) => onHandleKey("w", e)}
            {...dragProps("w")}
            className="group absolute -right-3 top-0 flex h-full w-6 cursor-ew-resize touch-none items-center justify-center rounded-full outline-none"
          >
            <span
              className={`${grip} h-8 w-1.5 transition-transform group-hover:scale-y-125 group-focus-visible:scale-y-125`}
            />
          </span>
          {/* Bottom edge: length. */}
          <span
            role="slider"
            tabIndex={0}
            aria-label={t("seating.room_height_aria")}
            aria-orientation="vertical"
            aria-valuemin={MIN_ROOM_MM / 1000}
            aria-valuemax={MAX_ROOM_MM / 1000}
            aria-valuenow={hM}
            aria-valuetext={`${fmt(hM)} m`}
            onKeyDown={(e) => onHandleKey("h", e)}
            {...dragProps("h")}
            className="group absolute -bottom-3 left-0 flex h-6 w-full cursor-ns-resize touch-none items-center justify-center rounded-full outline-none"
          >
            <span
              className={`${grip} h-1.5 w-8 transition-transform group-hover:scale-x-125 group-focus-visible:scale-x-125`}
            />
          </span>
          {/* Corner: both at once. Pointer only; the two edges above are the
              keyboard route, one dimension each. */}
          <span
            aria-hidden
            {...dragProps("both")}
            className="absolute -bottom-2.5 -right-2.5 h-5 w-5 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-ink-900 dark:border-umber-800 dark:bg-paper-50"
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <DimensionField
          label={t("seating.room_step_width")}
          ariaLabel={t("seating.room_width_aria")}
          value={draft.w}
          onChange={(w) => onChange({ ...draft, w })}
        />
        <DimensionField
          label={t("seating.room_step_length")}
          ariaLabel={t("seating.room_height_aria")}
          value={draft.h}
          onChange={(h) => onChange({ ...draft, h })}
        />
      </div>
    </div>
  );
}

/** A large number tile: the label sits small above a big borderless value,
 *  and the whole tile takes the dark outline while it has focus. */
function DimensionField({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block cursor-text rounded-2xl border-2 border-paper-200 bg-white px-4 py-3 transition-colors focus-within:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:focus-within:border-paper-50">
      <span className="block text-xs font-medium text-ink-500 dark:text-umber-300">{label}</span>
      <span className="mt-0.5 flex items-baseline gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          min={MIN_ROOM_MM / 1000}
          max={MAX_ROOM_MM / 1000}
          step={0.5}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel}
          className="w-full min-w-0 border-0 bg-transparent p-0 font-grotesk text-3xl font-semibold tabular-nums text-ink-900 outline-none focus:ring-0 [appearance:textfield] dark:text-paper-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-lg font-medium text-ink-400 dark:text-umber-400">m</span>
      </span>
    </label>
  );
}
