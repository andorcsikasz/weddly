// What an image upload looks like while it is happening.
//
// The vendor listing editor had exactly two states, both of them silent: the
// picked file appeared instantly (an object-URL) and a toast arrived some
// seconds later. In between — the whole time the bytes are actually going up —
// nothing on the frame moved. On a phone, with a 6 MB photo straight off the
// camera and hotel wifi, that is twenty seconds of a page that looks like it
// ignored the tap, which is exactly when a vendor taps again.
//
// So the frame itself reports, in three states and almost no words:
//
//   uploading → a ring on a scrim, with the real percentage inside it when the
//               transport can measure the body (XHR can; fetch cannot), and a
//               spinning arc when it cannot.
//   done      → a tick, for a moment, then gone. Confirmation belongs on the
//               thing that changed, not in a toast in the opposite corner.
//   error     → an amber alert and a retry glyph, ON the frame that failed.
//               Amber and not red because this portal's tone table already
//               spells "needs attention" amber (see ProgressRing), and a
//               failed upload is a thing to retry, not a fault to report.
//
// Cloud-fetch latency is the fourth state and it is NOT here: an <img> that
// hasn't decoded yet is `SmartImage`'s shimmer, because only the <img> knows
// when it settles.

import { AlertTriangle, Check, RotateCw } from "lucide-react";
import { ProgressRing } from "./ProgressRing";

export type UploadState =
  /** Bytes in flight. `pct` is null while the body length is unknown. */
  { kind: "uploading"; pct: number | null } | { kind: "done" } | { kind: "error" };

export function UploadStateOverlay({
  state,
  onRetry,
  retryLabel,
  progressLabel,
  doneLabel,
  errorLabel,
  compact = false,
}: {
  state: UploadState;
  onRetry?: () => void;
  retryLabel: string;
  /** Receives the rounded percentage; also the ring's accessible name. */
  progressLabel: (pct: number) => string;
  doneLabel: string;
  errorLabel: string;
  /** Gallery-tile sizing — a 3:2 thumbnail is a third of the cover's width. */
  compact?: boolean;
}) {
  const ringSize = compact ? 34 : 56;
  const glyph = compact ? 18 : 26;
  return (
    <span
      // `aria-live` so the state is announced as it changes; the ring alone
      // would be a silent picture to a screen reader.
      aria-live="polite"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-ink-900/65 backdrop-blur-[1px]"
    >
      {state.kind === "uploading" && (
        // A body whose length the browser can't measure gets a spinning
        // quarter-arc: a ring frozen at some arbitrary percentage would be a
        // lie, and one frozen at 0 reads as stalled.
        <span className={state.pct === null ? "motion-safe:animate-spin" : undefined}>
          <ProgressRing
            pct={state.pct === null ? 25 : state.pct * 100}
            size={ringSize}
            stroke={compact ? 3 : 4}
            tone="active"
            label={progressLabel(Math.round((state.pct ?? 0) * 100))}
          >
            {state.pct !== null && (
              <span
                className={`font-grotesk font-semibold tabular-nums leading-none text-paper-50 ${
                  compact ? "text-[9px]" : "text-xs"
                }`}
              >
                {Math.round(state.pct * 100)}
              </span>
            )}
          </ProgressRing>
        </span>
      )}
      {state.kind === "done" && (
        <Check
          size={glyph}
          strokeWidth={2.5}
          className="text-sage-300"
          aria-label={doneLabel}
          role="img"
        />
      )}
      {state.kind === "error" && (
        <>
          <AlertTriangle
            size={glyph}
            strokeWidth={1.75}
            className="text-amber-400"
            aria-label={errorLabel}
            role="img"
          />
          {onRetry && (
            <button
              type="button"
              onClick={(e) => {
                // The frame underneath is itself a click target (it opens the
                // file picker), and retrying should re-send, not re-prompt.
                e.stopPropagation();
                onRetry();
              }}
              aria-label={retryLabel}
              title={retryLabel}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-paper-50/90 text-ink-900 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-paper-100"
            >
              <RotateCw size={compact ? 14 : 16} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </span>
  );
}
