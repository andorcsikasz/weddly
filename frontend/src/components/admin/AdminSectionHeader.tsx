import type { ReactNode } from "react";

/** Section header inside an admin page — uppercase eyebrow h2 + optional
 *  count chip + optional inline actions. Locks in the six-level scale's
 *  section-title row (text-[11px] uppercase tracking-[0.08em] text-neutral-500)
 *  so the workspaces / orphans / demo splits on AdminUsersPage all read as
 *  one rhythm.
 */
export function AdminSectionHeader({
  title,
  count,
  actions,
  description,
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-umber-300">
          {title}
        </h2>
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
