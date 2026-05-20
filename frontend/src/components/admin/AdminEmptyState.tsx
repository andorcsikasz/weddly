import type { ReactNode } from "react";

/** Empty-state surface used when an admin list/table has no rows. Drops the
 *  `.card` chrome's heavier shadow in favour of the lighter ring + paper
 *  fill so empty states don't pretend to carry content.
 */
export function AdminEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-paper-50 p-4 text-center text-sm text-ink-500 ring-1 ring-ink-100 dark:bg-umber-900 dark:text-umber-300 dark:ring-umber-700">
      {children}
    </div>
  );
}
