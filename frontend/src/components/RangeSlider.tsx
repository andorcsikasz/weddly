/**
 * Two-thumb range slider built from two stacked native `<input type="range">`,
 * so keyboard, touch and screen readers work without any custom handling.
 * The inputs are transparent and only their thumbs take pointer events
 * (`.range-dual` in index.css); the filled segment between them is drawn here.
 *
 * Values are the caller's; a thumb cannot cross its partner, it stops `step`
 * short of it. `max` is a display ceiling, so a value above it (typed in an
 * older draft) pins the thumb to the end rather than breaking the track.
 */
type Props = {
  min: number;
  max: number;
  step: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  lowLabel: string;
  highLabel: string;
  /** Rendered under the track at each end, e.g. "0" and "500+". */
  minCaption?: string;
  maxCaption?: string;
};

export function RangeSlider({
  min,
  max,
  step,
  low,
  high,
  onChange,
  lowLabel,
  highLabel,
  minCaption,
  maxCaption,
}: Props) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const lo = clamp(low);
  const hi = clamp(high);
  const pct = (n: number) => ((n - min) / (max - min)) * 100;

  return (
    <div>
      <div className="range-dual relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-paper-300 dark:bg-umber-700" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-umber-900 dark:bg-paper-50"
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        <input
          type="range"
          aria-label={lowLabel}
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={(e) => onChange(Math.min(Number(e.target.value), hi - step), high)}
          // When both thumbs sit at the top end, the low one must be on top
          // or it could never be dragged back down.
          className={lo >= max - step ? "z-20" : "z-10"}
        />
        <input
          type="range"
          aria-label={highLabel}
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={(e) => onChange(low, Math.max(Number(e.target.value), lo + step))}
          className="z-10"
        />
      </div>
      {(minCaption || maxCaption) && (
        <div className="mt-1 flex justify-between text-xs text-umber-500 dark:text-umber-300">
          <span>{minCaption}</span>
          <span>{maxCaption}</span>
        </div>
      )}
    </div>
  );
}

/** One-thumb twin of `RangeSlider`: same track, same thumb, filled from the
 *  left end up to the value. */
export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  label,
  minCaption,
  maxCaption,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  label: string;
  minCaption?: string;
  maxCaption?: string;
}) {
  const v = Math.min(max, Math.max(min, value));
  const pct = ((v - min) / (max - min)) * 100;
  return (
    <div>
      <div className="range-dual relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-paper-300 dark:bg-umber-700" />
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-umber-900 dark:bg-paper-50"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={v}
          onChange={(e) => onChange(Number(e.target.value))}
          className="z-10"
        />
      </div>
      {(minCaption || maxCaption) && (
        <div className="mt-1 flex justify-between text-xs text-umber-500 dark:text-umber-300">
          <span>{minCaption}</span>
          <span>{maxCaption}</span>
        </div>
      )}
    </div>
  );
}
