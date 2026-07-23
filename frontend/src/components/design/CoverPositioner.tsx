// Drag-to-reposition + zoom control for a photo shown inside a fixed-aspect
// frame (the guest-page hero crops the cover to a wide band). The couple drags
// the image to pick the focal point and zooms in to crop tighter. `x`/`y` are
// object-position percentages (0..100); `scale` is a zoom percent (100 = fit,
// up to 300). `onChange` fires live (updates the preview); `onCommit` fires on
// release (persists). Dragging the photo right reveals its left edge, so a
// rightward drag lowers object-position-x — the natural "move the photo" feel.
//
// A sibling of the guest-page editor's positioner, but this one adds the zoom
// slider and renders the scale, so the Design editor's crop matches the guest
// page exactly (WeddingSiteView applies the same object-position + transform).

import { Move, ZoomIn } from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "../../lib/i18n";

export const COVER_SCALE_MIN = 100;
export const COVER_SCALE_MAX = 300;

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function CoverPositioner({
  src,
  x,
  y,
  scale,
  filter,
  onChange,
  onCommit,
  hint,
}: {
  src: string;
  x: number;
  y: number;
  scale: number;
  /** Optional CSS filter (e.g. grayscale) so the adjust view matches the page. */
  filter?: string;
  onChange: (x: number, y: number, scale: number) => void;
  onCommit: (x: number, y: number, scale: number) => void;
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
        style={{ aspectRatio: "21 / 9", touchAction: "none" }}
        onPointerDown={(e) => {
          ref.current?.setPointerCapture(e.pointerId);
          drag.current = { sx: e.clientX, sy: e.clientY, px: x, py: y };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const n = nextFrom(e);
          if (n) onChange(n[0], n[1], scale);
        }}
        onPointerUp={(e) => {
          const n = nextFrom(e);
          ref.current?.releasePointerCapture(e.pointerId);
          drag.current = null;
          setDragging(false);
          if (n) {
            onChange(n[0], n[1], scale);
            onCommit(n[0], n[1], scale);
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
      {/* Zoom slider. onChange updates the preview live; commit on release. */}
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
          onChange={(e) => onChange(x, y, Number(e.target.value))}
          onPointerUp={() => onCommit(x, y, scale)}
          onKeyUp={() => onCommit(x, y, scale)}
          onBlur={() => onCommit(x, y, scale)}
          className="h-1.5 w-full cursor-pointer accent-ink-900 dark:accent-paper-100"
        />
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-ink-500 dark:text-umber-300">
          {Math.round(scale)}%
        </span>
      </label>
    </div>
  );
}
