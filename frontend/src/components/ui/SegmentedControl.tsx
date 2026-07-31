import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Accessible name + tooltip, for a pill whose visible label is not a name:
   *  an audience picker showing headcounts renders "42", which is the fact the
   *  user is choosing on but tells a screen reader nothing. */
  ariaLabel?: string;
};

/** Which fill the selected pill wears. The palette is unchanged from the
 *  hand-rolled controls this replaced — `ink` is the app-wide default, `steel`
 *  belongs to the vendor calendar, which has used it since it shipped. */
export type SegmentedTone = "ink" | "steel";

/** Corner treatment. `pill` is for a control that sits in a row of pill-shaped
 *  filters (the vendor calendar toolbar next to "Ma" and the view dropdown),
 *  where a rounded rectangle is the one square thing in the row. */
export type SegmentedShape = "rounded" | "pill";

/** `sm` matches the height of a `px-3.5 py-1.5` toolbar pill (34px) so the
 *  control lines up with its neighbours instead of towering over them. It gives
 *  up `min-h-tap`, which is why it is opt-in: only use it in a row that is
 *  already built at that height. */
export type SegmentedSize = "md" | "sm";

type SegmentedControlProps<T extends string> = {
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (v: T) => void;
  className?: string;
  /** Stack icons over labels at narrow widths instead of side-by-side. */
  compact?: boolean;
  tone?: SegmentedTone;
  shape?: SegmentedShape;
  size?: SegmentedSize;
  /** Hide the labels below `sm`, leaving icon-only pills. The label still
   *  reaches assistive tech through the button's aria-label. */
  hideLabelsOnMobile?: boolean;
};

const TONE_PILL: Record<SegmentedTone, string> = {
  ink: "bg-neutral-800 shadow-soft dark:bg-umber-700",
  steel: "bg-steel-600",
};
const TONE_ACTIVE_TEXT: Record<SegmentedTone, string> = {
  ink: "text-paper-50",
  steel: "text-white",
};
const SHAPE_BOX: Record<SegmentedShape, string> = {
  rounded: "rounded-xl",
  pill: "rounded-full",
};
const SHAPE_ITEM: Record<SegmentedShape, string> = {
  rounded: "rounded-lg",
  pill: "rounded-full",
};
// The three size-dependent numbers have to agree: the box padding, the pill's
// inset (it must clear that padding exactly) and the button's own height.
const SIZE_BOX: Record<SegmentedSize, string> = { md: "p-1", sm: "p-0.5" };
const SIZE_PILL_INSET: Record<SegmentedSize, string> = {
  md: "top-1 bottom-1",
  sm: "top-0.5 bottom-0.5",
};
// `min-h-7` rather than padding alone, so an icon-only button (hideLabelsOnMobile)
// keeps the same 34px total as one with a label.
const SIZE_BUTTON: Record<SegmentedSize, string> = {
  md: "min-h-tap px-4 py-1.5",
  sm: "min-h-7 px-3 py-1",
};

/** Single-select segmented control. Roving tabindex, arrow-key navigation,
 *  Home/End to jump. Renders as role="radiogroup". For multi-select use
 *  TagChip in a row.
 *
 *  The selection is ONE pill that slides between the options rather than a
 *  background that switches on whichever button happens to be active. The
 *  difference is what the movement says: a jump reads as two separate states
 *  blinking, a slide reads as one object you moved, which is why every native
 *  segmented control animates it.
 *
 *  It's measured, not guessed. The labels are localised and the container can
 *  scroll, so the geometry only exists at runtime: the pill reads the active
 *  button's `offsetLeft`/`offsetWidth` and animates `transform` + `width`
 *  (compositor-friendly; `left` would lay out on every frame). A
 *  ResizeObserver re-measures on width changes, a late-loading font, or a
 *  locale switch that makes every label a different length.
 *
 *  Two things it deliberately does NOT do: animate on first paint (the pill
 *  would fly in from the left edge on mount), and animate at all when the
 *  visitor asks for reduced motion. */
export function SegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  className,
  compact = false,
  tone = "ink",
  shape = "rounded",
  size = "md",
  hideLabelsOnMobile = false,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const buttonsRef = useRef<HTMLButtonElement[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // Off until the pill has been placed once, so the first paint has it already
  // sitting under the active option instead of travelling there.
  const [slides, setSlides] = useState(false);

  const measure = useCallback(() => {
    const idx = options.findIndex((o) => o.value === value);
    const el = buttonsRef.current[idx];
    if (!el || !listRef.current) return;
    setPill((prev) =>
      prev && prev.left === el.offsetLeft && prev.width === el.offsetWidth
        ? prev
        : { left: el.offsetLeft, width: el.offsetWidth },
    );
  }, [options, value]);

  // Layout effect, not an effect: the pill has to be positioned in the same
  // frame the buttons are laid out, or it flashes at the wrong place.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (pill && !slides) {
      // One frame after the first placement — flipping it in the same commit
      // would let the browser animate that initial jump.
      const raf = requestAnimationFrame(() => setSlides(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [pill, slides]);

  // Width changes (viewport, a font finally loading, a locale switch that
  // relabels everything) move the buttons without changing `value`.
  useEffect(() => {
    const box = listRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    for (const b of buttonsRef.current) if (b) ro.observe(b);
    return () => ro.disconnect();
  }, [measure]);

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
      ref={listRef}
      // `relative` makes this the offsetParent the pill is measured against.
      className={[
        "relative inline-flex max-w-full overflow-x-auto border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800 [&::-webkit-scrollbar]:hidden",
        SHAPE_BOX[shape],
        SIZE_BOX[size],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* The travelling selection. Decorative: `aria-checked` on the buttons
          already carries the state, and a second announcement would just be
          noise. Sits under the labels (`z-0` vs `z-10`) so the text stays
          readable through the move. */}
      {pill && (
        <span
          aria-hidden="true"
          className={[
            "pointer-events-none absolute left-0 z-0 motion-reduce:transition-none",
            SIZE_PILL_INSET[size],
            SHAPE_ITEM[shape],
            TONE_PILL[tone],
            slides
              ? "transition-[transform,width] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
              : "",
          ].join(" ")}
          style={{ transform: `translateX(${pill.left}px)`, width: `${pill.width}px` }}
        />
      )}
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
            aria-label={opt.ariaLabel ?? (hideLabelsOnMobile ? opt.label : undefined)}
            title={opt.ariaLabel}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={onKey}
            className={[
              // Only the TEXT colour transitions here. The fill moved out to the
              // pill above, so a background transition on the button would fight
              // it and leave a ghost behind the slide.
              "relative z-10 whitespace-nowrap text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-700 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100",
              SHAPE_ITEM[shape],
              SIZE_BUTTON[size],
              compact ? "flex flex-col items-center gap-0.5" : "inline-flex items-center gap-1.5",
              active
                ? TONE_ACTIVE_TEXT[tone]
                : "text-neutral-700 hover:text-neutral-900 dark:text-paper-100 dark:hover:text-paper-50",
            ].join(" ")}
          >
            {opt.icon}
            <span className={hideLabelsOnMobile ? "hidden sm:inline" : undefined}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
