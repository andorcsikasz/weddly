// Display helpers shared across the planner workspace.
//
// Two concerns live here so the dashboard, client roster, calendar and stats
// all render couples the same way:
//   1. titleCaseName  - couples often type their names lowercase ("v & v").
//      The stored value is left untouched; only the displayed string is
//      Title-Cased so the B2B planner surface reads as a real CRM.
//   2. clientColor     - a stable colour per client so a planner can tell
//      clients apart at a glance (calendar events, roster dots, legends).
//
// Colours come from the `chart` palette in tailwind.config.js. The class
// strings below are written as full literals so Tailwind's content scanner
// (which globs ./src/**/*.{ts,tsx}) keeps them through purge. Do not build
// these names by concatenation - that would drop them from the build.

/**
 * Title-case a couple/person name for DISPLAY only. Capitalises the first
 * letter of each whitespace-separated word, leaves separators like "&" and
 * already-mixed-case tokens (e.g. "McKay") sensibly alone. Never mutate the
 * stored value with this - it is a presentation helper.
 */
export function titleCaseName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token; // preserve the original spacing
      if (token === "&" || token === "+") return token; // join glyphs stay put
      // Leave tokens that already carry an internal capital (McKay, DeLuca).
      if (/[A-Z]/.test(token.slice(1))) return token;
      const first = token.charAt(0);
      return first.toLocaleUpperCase() + token.slice(1);
    })
    .join("");
}

export interface ClientColor {
  /** Solid dot / chip fill, e.g. a calendar event block or roster swatch. */
  dot: string;
  /** Soft tinted background for surfaces behind text. */
  soft: string;
  /** Text colour matching the client's hue. */
  text: string;
  /** Border colour matching the client's hue. */
  border: string;
}

// One entry per chart hue. Order is stable so a given index always maps to
// the same colour. Full literal class strings - see file header.
const CLIENT_COLORS: ClientColor[] = [
  { dot: "bg-chart-terracotta", soft: "bg-chart-terracotta/10", text: "text-chart-terracotta", border: "border-chart-terracotta" },
  { dot: "bg-chart-sage", soft: "bg-chart-sage/10", text: "text-chart-sage", border: "border-chart-sage" },
  { dot: "bg-chart-taupe", soft: "bg-chart-taupe/10", text: "text-chart-taupe", border: "border-chart-taupe" },
  { dot: "bg-chart-rose", soft: "bg-chart-rose/10", text: "text-chart-rose", border: "border-chart-rose" },
  { dot: "bg-chart-olive", soft: "bg-chart-olive/10", text: "text-chart-olive", border: "border-chart-olive" },
  { dot: "bg-chart-ochre", soft: "bg-chart-ochre/10", text: "text-chart-ochre", border: "border-chart-ochre" },
  { dot: "bg-chart-sand", soft: "bg-chart-sand/10", text: "text-chart-sand", border: "border-chart-sand" },
];

/**
 * Map a client (couple) id to a stable colour from the chart palette. The
 * same id always yields the same hue across every planner surface.
 */
export function clientColor(coupleId: number | string): ClientColor {
  const n =
    typeof coupleId === "number"
      ? coupleId
      : Array.from(String(coupleId)).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const idx = ((Math.abs(Math.trunc(n)) % CLIENT_COLORS.length) + CLIENT_COLORS.length) % CLIENT_COLORS.length;
  return CLIENT_COLORS[idx]!;
}
