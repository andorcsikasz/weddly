// A palette drawn as ONE weighted bar rather than four equal dots.
//
// The widths come from `PALETTE_ROLE_WEIGHTS`, which describes how much of a
// rendered guest page each role actually covers (mostly background, then body
// text, then headings, then accent). Four equal swatches imply four equal
// decisions and make every palette read the same; the weighted bar shows what
// the page will actually feel like, which is the only question being asked.

import { COLOR_ROLES, type ColorRole, PALETTE_ROLE_WEIGHTS } from "@shared/design";

/** Draw order: widest first, so the bar reads background → text → primary →
 *  accent left to right and the thin accent sliver always lands on the end. */
const ORDER: ColorRole[] = ["background", "text", "primary", "accent"];

export function PaletteBar({
  colors,
  overridden,
  className,
}: {
  /** Fully resolved hex per role (palette + any custom overrides applied). */
  colors: Record<ColorRole, string>;
  /** Roles the couple has pinned by hand. Each gets a dot so a customised
   *  palette is legible as customised without a separate badge or count. */
  overridden?: Partial<Record<ColorRole, boolean>>;
  className?: string;
}) {
  return (
    <span
      className={`flex h-2.5 w-full overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/15 ${className ?? ""}`}
      aria-hidden
    >
      {ORDER.map((role) => (
        <span
          key={role}
          className="relative flex items-center justify-center"
          style={{ width: `${PALETTE_ROLE_WEIGHTS[role]}%`, backgroundColor: colors[role] }}
        >
          {overridden?.[role] && (
            <span className="h-1 w-1 rounded-full bg-ink-900 ring-1 ring-white/70 dark:bg-paper-100 dark:ring-black/40" />
          )}
        </span>
      ))}
    </span>
  );
}

/** Resolved-colour map for a design, in the shape `PaletteBar` wants. Kept here
 *  so callers don't each re-derive it from `toPublicDesign`. */
export function roleColors(resolved: {
  primary: string;
  background: string;
  accent: string;
  text: string;
}): Record<ColorRole, string> {
  const map: Record<ColorRole, string> = {
    primary: resolved.primary,
    background: resolved.background,
    accent: resolved.accent,
    text: resolved.text,
  };
  // Assert every role is covered, so adding a COLOR_ROLE fails loudly here
  // rather than silently dropping a band off the bar.
  for (const role of COLOR_ROLES) if (!map[role]) map[role] = resolved.text;
  return map;
}
