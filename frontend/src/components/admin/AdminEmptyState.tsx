import type { ReactNode } from "react";

interface AdminEmptyStateProps {
  /** Headline copy. Used to be the only content; now optional so the
   *  caller can drive everything via richer slots below. */
  title?: ReactNode;
  /** Secondary explanatory line, rendered under the title in muted ink. */
  description?: ReactNode;
  /** Optional decorative icon, typically a lucide glyph sized ~28-32px.
   *  Rendered above the title in ink-400 so it doesn't compete with copy. */
  icon?: ReactNode;
  /** Optional CTA — usually a <button> or <Link>. Rendered under the
   *  description; consumers handle their own styling so any of the
   *  .btn-* shells (or a plain link) works. */
  action?: ReactNode;
  /** Backwards compat: the original API was a single ReactNode child
   *  rendered as the message. All existing call sites pass a string this
   *  way; preserve the behaviour so the page-overhaul agents can migrate
   *  to `title=` at their own pace. */
  children?: ReactNode;
}

/** Empty-state surface used when an admin list/table has no rows.
 *  Composes the `.admin-card` chrome so empty states sit on the same
 *  resting surface as the rest of the admin shell. The icon → title →
 *  description → action stack is the canonical "do something next"
 *  layout; passing just a string `children` (or `title`) collapses to
 *  the old one-line look. */
export function AdminEmptyState({
  title,
  description,
  icon,
  action,
  children,
}: AdminEmptyStateProps) {
  // Legacy single-string call sites land in `children`; promote to the
  // headline slot so they get the same look as a `title=` caller and the
  // muted-ink colour the original component used.
  const headline = title ?? children;
  return (
    <div className="admin-card flex flex-col items-center justify-center space-y-2 py-8 text-center">
      {icon != null && (
        <span aria-hidden="true" className="inline-flex text-ink-400 dark:text-umber-300">
          {icon}
        </span>
      )}
      {headline != null && (
        <p className="text-sm text-ink-700 dark:text-paper-100">{headline}</p>
      )}
      {description != null && (
        <p className="text-xs text-ink-500 dark:text-umber-300">{description}</p>
      )}
      {action != null && <div className="pt-1">{action}</div>}
    </div>
  );
}
