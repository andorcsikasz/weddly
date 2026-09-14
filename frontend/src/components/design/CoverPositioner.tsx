// Drag-to-reposition + zoom + height control for a photo shown inside a
// fixed-aspect frame (the guest-page hero and the two optional photo bands
// all crop to a wide band). The couple drags the image to pick the focal
// point, zooms in to crop tighter, and slides the height control to make the
// band shorter/taller. `x`/`y` are object-position percentages (0..100);
// `scale` is a zoom percent (100 = fit, up to 300); `height` is a percent of
// the band's default aspect ratio (100 = the page's normal aspect-[21/9]
// shape, 50 = half as tall, 200 = twice as tall). `onChange` fires live
// (updates the preview); `onCommit` fires on release (persists).
//
// Zoom is cover-only (`showZoom`, default true): the two optional photo slots
// don't crop tighter, only reposition + resize the band, so callers for those
// pass `showZoom={false}` and a fixed `scale={100}`. Dragging the photo right
// reveals its left edge, so a rightward drag lowers object-position-x — the
// natural "move the photo" feel.
//
// Shared by the Design editor's PhotoDock (cover + both slots) and the
// guest-page editor's own cover-adjust dialog, so the crop the couple sees
// while adjusting matches exactly what WeddingSiteView renders (same
// object-position + transform + aspect-ratio formula on both ends).

import { Move, RectangleVertical, ZoomIn } from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "../../lib/i18n";

export const COVER_SCALE_MIN = 100;
export const COVER_SCALE_MAX = 300;
export const BAND_HEIGHT_MIN = 50;
export const BAND_HEIGHT_MAX = 200;

/** The band's aspect-ratio CSS value for a given height percent (100 = the
 *  page's normal 21/9 shape). Shared with WeddingSiteView so the adjuster's
 *  own preview box matches the real page exactly. */
export function bandAspectRatio(heightPct: number): string {
  return `21 / ${(9 * (heightPct / 100)).toFixed(3)}`;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function CoverPositioner({
  src,
  x,
  y,
  scale,
  showZoom = true,
  height,
  filter,
  onChange,
  onCommit,
  hint,
}: {
  src: string;
  x: number;
  y: number;
  scale: number;
  /** Hide the zoom row for callers with no crop-tighter concept (the two
   *  optional photo slots). Default true (the cover keeps zoom). */
  showZoom?: boolean;
  /** Band height, percent of the default aspect ratio (100 = unchanged). */
  height: number;
  /** Optional CSS filter (e.g. grayscale) so the adjust view matches the page. */
  filter?: string;
  onChange: (x: number, y: number, scale: number, height: number) => void;
  onCommit: (x: number, y: number, scale: number, height: number) => void;
  hint: string;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function nextFrom(e: { clientX: number; clientY: number }): [number, number] | null {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    // Divide by the zoom factor so the drag feels consistent when zoomed in
    // (the enlarged image needs a smaller object-position step per pixel).
    const s = Math.max(1, scale / 100);
    const dxPct = (((e.clientX - d.sx) / rect.width) * 100) / s;
    const dyPct = (((e.clientY - d.sy) / rect.height) * 100) / s;
    return [clampPct(d.px - dxPct), clampPct(d.py - dyPct)];
  }

  return (
    <div className="mt-2">
      <div
        ref={ref}
        className={`relative w-full select-none overflow-hidden rounded-lg border border-paper-300 dark:border-umber-700 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{ aspectRatio: bandAspectRatio(height), touchAction: "none" }}
        onPointerDown={(e) => {
          ref.current?.setPointerCapture(e.pointerId);
          drag.current = { sx: e.clientX, sy: e.clientY, px: x, py: y };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const n = nextFrom(e);
          if (n) onChange(n[0], n[1], scale, height);
        }}
        onPointerUp={(e) => {
          const n = nextFrom(e);
          ref.current?.releasePointerCapture(e.pointerId);
          drag.current = null;
          setDragging(false);
          if (n) {
            onChange(n[0], n[1], scale, height);
            onCommit(n[0], n[1], scale, height);
          }
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full object-cover"
          style={{
            objectPosition: `${x}% ${y}%`,
            transform: `scale(${Math.max(1, scale / 100)})`,
            transformOrigin: `${x}% ${y}%`,
            filter,
          }}
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/55 to-transparent px-2 py-1.5 text-[11px] font-medium text-white">
          <Move size={12} aria-hidden />
          {hint}
        </span>
      </div>
      {/* Zoom slider — cover only. onChange updates the preview live; commit on
          release. */}
      {showZoom && (
        <label className="mt-2 flex items-center gap-2">
          <ZoomIn size={14} className="shrink-0 text-ink-500 dark:text-umber-300" aria-hidden />
          <span className="sr-only">{t("design.web.cover_zoom")}</span>
          <input
            type="range"
            min={COVER_SCALE_MIN}
            max={COVER_SCALE_MAX}
            step={1}
            value={scale}
            aria-label={t("design.web.cover_zoom")}
            onChange={(e) => onChange(x, y, Number(e.target.value), height)}
            onPointerUp={() => onCommit(x, y, scale, height)}
            onKeyUp={() => onCommit(x, y, scale, height)}
            onBlur={() => onCommit(x, y, scale, height)}
            className="h-1.5 w-full cursor-pointer accent-ink-900 dark:accent-paper-100"
          />
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-ink-500 dark:text-umber-300">
            {Math.round(scale)}%
          </span>
        </label>
      )}
      {/* Height slider — every caller. Shorter/taller band, independent of the
          crop above (dragging the position box already shows the new shape:
          its own aspect-ratio follows this value). */}
      <label className="mt-2 flex items-center gap-2">
        <RectangleVertical
          size={14}
          className="shrink-0 text-ink-500 dark:text-umber-300"
          aria-hidden
        />
        <span className="sr-only">{t("design.web.band_height")}</span>
        <input
          type="range"
          min={BAND_HEIGHT_MIN}
          max={BAND_HEIGHT_MAX}
          step={1}
          value={height}
          aria-label={t("design.web.band_height")}
          onChange={(e) => onChange(x, y, scale, Number(e.target.value))}
          onPointerUp={() => onCommit(x, y, scale, height)}
          onKeyUp={() => onCommit(x, y, scale, height)}
          onBlur={() => onCommit(x, y, scale, height)}
          className="h-1.5 w-full cursor-pointer accent-ink-900 dark:accent-paper-100"
        />
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-ink-500 dark:text-umber-300">
          {Math.round(height)}%
        </span>
      </label>
    </div>
  );
}
