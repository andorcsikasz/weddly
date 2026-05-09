import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

type SegmentedControlProps<T extends string> = {
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (v: T) => void;
  className?: string;
  /** Stack icons over labels at narrow widths instead of side-by-side. */
  compact?: boolean;
};

/** Single-select segmented control. Roving tabindex, arrow-key navigation,
 *  Home/End to jump. Renders as role="radiogroup". For multi-select use
 *  TagChip in a row. */
export function SegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  className,
  compact = false,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const buttonsRef = useRef<HTMLButtonElement[]>([]);

  function focusIndex(i: number) {
    const total = options.length;
    if (total === 0) return;
    const next = ((i % total) + total) % total;
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      buttonsRef.current[next]?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const cur = options.findIndex((o) => o.value === value);
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusIndex(cur + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusIndex(cur - 1);
        break;
      case "Home":
        e.preventDefault();
        focusIndex(0);
        break;
      case "End":
        e.preventDefault();
        focusIndex(options.length - 1);
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      id={groupId}
      className={[
        "inline-flex max-w-full overflow-x-auto rounded-full border border-paper-300 bg-paper-100 p-1 [&::-webkit-scrollbar]:hidden",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              if (el) buttonsRef.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={onKey}
            className={[
              "min-h-tap whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ink-700",
              compact ? "flex flex-col items-center gap-0.5" : "inline-flex items-center gap-1.5",
              active ? "bg-ink-800 text-paper-50 shadow-soft" : "text-ink-700 hover:text-ink-900",
            ].join(" ")}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
