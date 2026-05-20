import type { ReactNode } from "react";

/** Rounded-full status filter chip used in the waitlist + suppliers admin
 *  pages. Active = violet-filled, inactive = paper-bordered with violet
 *  hover. Centralised so both inboxes share one focus ring + transition
 *  rhythm.
 */
export function AdminFilterChip({
  label,
  active,
  onClick,
}: {
  label: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  const baseCls =
    "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40";
  const cls = active
    ? `${baseCls} border border-violet-900 bg-violet-900 text-paper-100 dark:border-violet-500/50 dark:bg-violet-500/30 dark:text-violet-100`
    : `${baseCls} border border-paper-300 bg-paper-50 text-violet-950 hover:border-violet-300 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-violet-200 dark:hover:border-violet-400/40 dark:hover:bg-umber-700`;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cls}>
      {label}
    </button>
  );
}
