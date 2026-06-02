import type { ReactNode } from "react";

/** Rounded-full status filter chip used in the waitlist + suppliers admin
 *  pages. Active = neutral-filled, inactive = paper-bordered with a
 *  koromfekete hover. Centralised so both inboxes share one focus ring + transition
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
    "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40";
  const cls = active
    ? `${baseCls} border border-neutral-900 bg-neutral-900 text-paper-100 dark:border-neutral-500/50 dark:bg-neutral-500/30 dark:text-neutral-100`
    : `${baseCls} border border-paper-300 bg-paper-50 text-neutral-950 hover:border-neutral-300 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-neutral-200 dark:hover:border-neutral-400/40 dark:hover:bg-umber-700`;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cls}>
      {label}
    </button>
  );
}
