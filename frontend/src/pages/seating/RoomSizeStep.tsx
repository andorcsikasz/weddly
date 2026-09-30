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

export function RoomSizeStep({
  draft,
  onChange,
}: {
  draft: RoomSizeDraft;
  onChange: (next: RoomSizeDraft) => void;
}) {
  const { t } = useT();
  const parsed = parseRoomSize(draft);
  // Proportional outline of the room, so "20 × 8" reads as a long hall at a
  // glance. Longest side fills the box; the other scales with it.
  const BOX = 72;
  const ratio = parsed ? parsed.w / parsed.h : 12 / 9;
  const pw = ratio >= 1 ? BOX : Math.max(12, BOX * ratio);
  const ph = ratio >= 1 ? Math.max(12, BOX / ratio) : BOX;

  const inputCls =
    "input w-20 text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
  return (
    <fieldset className="mx-auto mt-5 max-w-md rounded-lg border border-paper-300 bg-paper-50/70 px-4 py-4 dark:border-umber-700 dark:bg-umber-900/40">
      <legend className="px-1 text-sm font-semibold text-ink-800 dark:text-paper-100">
        {t("seating.room_step_title")}
      </legend>
      <p className="text-xs text-ink-600 dark:text-umber-200">{t("seating.room_step_hint")}</p>
      <div className="mt-3 flex items-center justify-center gap-4">
        <div
          aria-hidden
          className="flex shrink-0 items-center justify-center"
          style={{ width: BOX, height: BOX }}
        >
          <div
            className="rounded-sm border-2 border-dashed border-ink-400 transition-all dark:border-umber-300"
            style={{ width: pw, height: ph }}
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col items-center gap-1 text-xs text-ink-600 dark:text-umber-200">
            {t("seating.room_step_width")}
            <input
              type="number"
              inputMode="decimal"
              min={MIN_ROOM_MM / 1000}
              max={MAX_ROOM_MM / 1000}
              step={0.5}
              value={draft.w}
              onChange={(e) => onChange({ ...draft, w: e.target.value })}
              aria-label={t("seating.room_width_aria")}
              className={inputCls}
            />
          </label>
          <span aria-hidden className="pb-2 text-sm text-ink-400">
            ×
          </span>
          <label className="flex flex-col items-center gap-1 text-xs text-ink-600 dark:text-umber-200">
            {t("seating.room_step_length")}
            <input
              type="number"
              inputMode="decimal"
              min={MIN_ROOM_MM / 1000}
              max={MAX_ROOM_MM / 1000}
              step={0.5}
              value={draft.h}
              onChange={(e) => onChange({ ...draft, h: e.target.value })}
              aria-label={t("seating.room_height_aria")}
              className={inputCls}
            />
          </label>
          <span className="pb-2 text-sm text-ink-600 dark:text-umber-200">m</span>
        </div>
      </div>
    </fieldset>
  );
}
