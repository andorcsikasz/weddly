// The in-page section nav of a long profile: a row of tabs that jump to a
// section and light the one being read. Shared by the couple-facing vendor page
// and the vendor's own listing editor, which are laid out in the same order on
// purpose, so the two navs are the same component with different items.
//
// Purely presentational: the caller owns which section is active (see
// `useActiveSection`) and how to scroll. Sticky positioning is the caller's too,
// through `className`, because the two pages sit under different headers.

export interface SectionNavItem {
  id: string;
  label: string;
}

export function SectionNav({
  items,
  active,
  onSelect,
  ariaLabel,
  className = "",
  style,
}: {
  items: readonly SectionNavItem[];
  active: string | null;
  onSelect: (id: string) => void;
  ariaLabel: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      style={style}
      className={`border-b border-paper-300 bg-paper-50/95 backdrop-blur dark:border-umber-700 dark:bg-umber-900/95 ${className}`}
    >
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={on ? "true" : undefined}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-400 ${
                on
                  ? "border-ink-900 font-semibold text-ink-900 dark:border-paper-50 dark:text-paper-50"
                  : "border-transparent text-ink-500 hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-100"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
