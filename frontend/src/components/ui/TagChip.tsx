import { Check, X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type TagChipProps = {
  label: string;
  selected: boolean;
  onToggle: () => void;
  /** Optional decorative icon shown before the label. */
  icon?: ReactNode;
  /** When true, the chip renders an inline X and calls onRemove instead of toggling. */
  removable?: boolean;
  onRemove?: () => void;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "aria-pressed" | "type">;

/** Multi-select chip — toggle in a group of independent selections.
 *  For single-select use SegmentedControl. */
export function TagChip({
  label,
  selected,
  onToggle,
  icon,
  removable = false,
  onRemove,
  disabled,
  className,
  ...rest
}: TagChipProps) {
  const base =
    "relative inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";
  const variant = selected
    ? "border-2 border-ink-700 bg-ink-700 text-paper-100 dark:border-umber-600 dark:bg-umber-700 dark:text-paper-50"
    : "border border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600";

  if (removable) {
    return (
      <span
        className={[base, variant, className ?? ""].filter(Boolean).join(" ")}
        aria-disabled={disabled || undefined}
      >
        {icon}
        <span>{label}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="-mr-1 rounded-full p-0.5 hover:bg-ink-600/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-200 dark:hover:bg-paper-50/20 dark:focus-visible:ring-paper-100"
          aria-label={`Remove ${label}`}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className={[base, variant, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {selected ? <Check size={14} aria-hidden="true" /> : icon}
      <span>{label}</span>
    </button>
  );
}
