import type { ReactNode } from "react";

/** Standard admin-page header: page title (h1) + optional subtitle + optional
 *  right-aligned action slot. Every Admin*Page should open with this so the
 *  six-level type scale (h1: `text-2xl font-semibold tracking-tight`,
 *  caption: `text-xs text-ink-500`) renders identically across the section.
 *
 *  Children render below the title row — used by AdminSuppliersPage for the
 *  SegmentedControl that toggles moderation vs. directory views.
 */
export function AdminPageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle != null && (
            <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{subtitle}</p>
          )}
        </div>
        {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children != null && <div className="mt-3">{children}</div>}
    </header>
  );
}
