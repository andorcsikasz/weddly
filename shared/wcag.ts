// Tiny, dependency-free WCAG contrast helpers. Shared by both sides so the
// Design feature can (a) pick a contrast-safe accent-text colour at resolve
// time and (b) warn the couple in the editor when a custom colour pairing
// would be hard to read. Pure functions, no DOM.

/** `#RRGGBB` (or `#RGB`) -> [r, g, b] in 0..255. Returns null for anything
 *  that isn't a valid hex colour, so callers can fall back gracefully. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** Relative luminance per WCAG 2.x for an sRGB colour given as 0..255. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio (1..21) between two hex colours. Returns 1 (worst) when
 *  either colour fails to parse, so a malformed value never reads as "passes". */
export function getContrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA pass for normal-size text (4.5:1). */
export function isAA(hexFg: string, hexBg: string): boolean {
  return getContrastRatio(hexFg, hexBg) >= 4.5;
}

/** WCAG AA pass for large/bold text + UI components (3:1). */
export function isAALarge(hexFg: string, hexBg: string): boolean {
  return getContrastRatio(hexFg, hexBg) >= 3;
}
