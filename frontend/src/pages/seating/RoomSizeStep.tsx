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

/** One-tap starting points, from a restaurant back room to a large hall.
 *  Values, not copy: "15 × 10" reads the same in every language. */
const ROOM_PRESETS: ReadonlyArray<RoomSizeDraft> = [
  { w: "10", h: "8" },
  { w: "15", h: "10" },
  { w: "20", h: "12" },
  { w: "30", h: "15" },
];

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
  // glance. Longest side fills the frame; the other scales with it, and the
  // two numbers sit on the edges they measure.
  const FRAME_W = 220;
  const FRAME_H = 132;
  const ratio = parsed ? parsed.w / parsed.h : 12 / 9;
  const fit = Math.min(FRAME_W / ratio, FRAME_H);
  const pw = Math.max(24, fit * ratio);
  const ph = Math.max(24, fit);
  const fmt = (mm: number) => String(Math.round(mm / 100) / 10);

  return (
    <div>
      <h2 className="font-grotesk text-[1.75rem] font-bold leading-tight tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
        {t("seating.room_step_title")}
      </h2>
      <p className="mt-2 text-base text-ink-500 dark:text-umber-300">
        {t("seating.room_step_hint")}
      </p>

      <div
        aria-hidden
        className="mt-7 flex h-52 items-center justify-center rounded-2xl border border-paper-200 bg-white dark:border-umber-700 dark:bg-umber-800"
      >
        <div
          className="relative rounded-md border-2 border-ink-900 bg-paper-100 transition-all duration-300 dark:border-paper-50 dark:bg-umber-700"
          style={{ width: pw, height: ph }}
        >
          {parsed && (
            <>
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums text-ink-700 dark:text-paper-200">
                {fmt(parsed.w)} m
              </span>
              <span className="absolute -right-2 top-1/2 -translate-y-1/2 translate-x-full whitespace-nowrap text-xs font-semibold tabular-nums text-ink-700 dark:text-paper-200">
                {fmt(parsed.h)} m
              </span>
            </>
          )}
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

      <div className="mt-3 flex flex-wrap gap-2">
        {ROOM_PRESETS.map((preset) => {
          const on = parsed !== null && fmt(parsed.w) === preset.w && fmt(parsed.h) === preset.h;
          return (
            <button
              key={`${preset.w}x${preset.h}`}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(preset)}
              className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium tabular-nums transition-colors ${
                on
                  ? "border-ink-900 text-ink-900 dark:border-paper-50 dark:text-paper-50"
                  : "border-paper-200 bg-white text-ink-600 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-200 dark:hover:border-umber-500"
              }`}
            >
              {preset.w} × {preset.h}
            </button>
          );
        })}
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
