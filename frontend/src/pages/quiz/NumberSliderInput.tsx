// Numeric guess slide's slider — same range-fill idiom CostPlanningCard uses
// (`.range-fill` in index.css + a gradient computed from the thumb position),
// so the guest's slider reads as a real slider rather than a bare native
// input, without pulling in a slider library.

function rangeFillStyle(
  value: number,
  min: number,
  max: number,
  thumbPx = 22,
): { backgroundImage: string } {
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;
  const offsetPx = thumbPx * (0.5 - pct / 100);
  const stop = `calc(${pct}% + ${offsetPx.toFixed(3)}px)`;
  return {
    backgroundImage: `linear-gradient(to right, #45e39e 0%, #45e39e ${stop}, rgba(255,255,255,.18) ${stop}, rgba(255,255,255,.18) 100%)`,
  };
}

export function NumberSliderInput({
  min,
  max,
  step,
  unit,
  value,
  onChange,
  disabled,
}: {
  min: number;
  max: number;
  step: number;
  unit: string | null;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-4 text-center">
        <span className="text-5xl font-bold tabular-nums text-white">{value}</span>
        {unit && <span className="ml-2 text-lg text-white/60">{unit}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={rangeFillStyle(value, min, max)}
        className="h-3 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#45e39e]"
      />
      <div className="mt-1 flex justify-between text-xs text-white/40">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
