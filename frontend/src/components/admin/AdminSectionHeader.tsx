import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** Section header inside an admin page: uppercase eyebrow h2 + optional
 *  count chip + optional inline actions. Locks in the six-level scale's
 *  section-title row (text-[11px] uppercase tracking-[0.08em] text-neutral-500)
 *  so the workspaces / orphans / demo splits on AdminUsersPage all read as
 *  one rhythm. When `collapse` is supplied a leading chevron toggle sits to
 *  the left of the title so every collapsible section folds the same way.
 */
export function AdminSectionHeader({
  title,
  count,
  actions,
  description,
  collapse,
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
  collapse?: { open: boolean; onToggle: () => void; label: string };
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {collapse && (
            <button
              type="button"
              onClick={collapse.onToggle}
              aria-expanded={collapse.open}
              aria-label={collapse.label}
              title={collapse.label}
              className="inline-flex items-center rounded-md p-0.5 text-neutral-500 hover:bg-paper-100 hover:text-neutral-700 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-100"
            >
              {collapse.open ? (
                <ChevronDown size={16} aria-hidden />
              ) : (
                <ChevronRight size={16} aria-hidden />
              )}
            </button>
          )}
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-umber-300">
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {actions}
          {count != null && (
            <span className="text-xs text-neutral-500 dark:text-umber-300">{count}</span>
          )}
        </div>
      </div>
      {description != null && (
        <p className="mt-1 text-xs text-neutral-500 dark:text-umber-300">{description}</p>
      )}
    </div>
  );
}
