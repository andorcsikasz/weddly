// The X/Y "tap where you think" pad — the heatmap slide's answer input, and
// (with `interactive` off) the same component draws the reveal scatter and
// the builder's target picker, so all three can never disagree about what a
// coordinate means. y=0 is the bottom of the pad (yLabel[0]), y=1 is the top
// (yLabel[1]); x follows reading order, left (xLabel[0]) to right (xLabel[1]).

import { useRef } from "react";

export interface HeatmapPoint {
  x: number;
  y: number;
}

function pick(el: HTMLDivElement, clientX: number, clientY: number): HeatmapPoint {
  const rect = el.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
  return { x, y };
}

export function HeatmapPad({
  xLabel,
  yLabel,
  mine,
  target,
  others,
  interactive,
  onPick,
}: {
  xLabel: [string, string];
  yLabel: [string, string];
  mine?: HeatmapPoint | null;
  target?: HeatmapPoint | null;
  others?: HeatmapPoint[];
  interactive?: boolean;
  onPick?: (point: HeatmapPoint) => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);

  function handlePointer(e: { clientX: number; clientY: number }) {
    if (!interactive || !padRef.current || !onPick) return;
    onPick(pick(padRef.current, e.clientX, e.clientY));
  }

  return (
    <div>
      <div className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-white/50">
        {yLabel[1]}
      </div>
      <div className="flex items-center gap-2">
        <div
          className="flex w-6 shrink-0 items-center justify-center text-center text-[10px] font-semibold uppercase tracking-wide text-white/50"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {xLabel[0]}
        </div>
        <div
          ref={padRef}
          className="qz-heatmap-pad"
          onClick={interactive ? (e) => handlePointer(e) : undefined}
          role={interactive ? "button" : undefined}
          aria-label={
            interactive ? `${xLabel[0]}–${xLabel[1]}, ${yLabel[0]}–${yLabel[1]}` : undefined
          }
        >
          {others?.map((p, i) => (
            <span
              key={`other-${i}`}
              className="qz-heatmap-dot"
              style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%`, opacity: 0.55 }}
            />
          ))}
          {target && (
            <span
              className="qz-heatmap-dot is-target"
              style={{ left: `${target.x * 100}%`, top: `${(1 - target.y) * 100}%` }}
            />
          )}
          {mine && (
            <span
              className="qz-heatmap-dot is-mine"
              style={{ left: `${mine.x * 100}%`, top: `${(1 - mine.y) * 100}%` }}
            />
          )}
        </div>
        <div
          className="flex w-6 shrink-0 items-center justify-center text-center text-[10px] font-semibold uppercase tracking-wide text-white/50"
          style={{ writingMode: "vertical-rl" }}
        >
          {xLabel[1]}
        </div>
      </div>
      <div className="mt-1 text-center text-xs font-semibold uppercase tracking-wide text-white/50">
        {yLabel[0]}
      </div>
    </div>
  );
}
