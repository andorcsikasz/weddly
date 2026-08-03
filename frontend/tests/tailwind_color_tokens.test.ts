// A Tailwind color class naming a palette that does not exist compiles to
// NOTHING, silently. There is no build error and no console warning: the
// element simply keeps whatever colour it already had, which in practice means
// a `dark:` variant vanishes and the light-mode value survives onto a dark
// page. That is exactly how `dark:text-cream-50` (there is no `cream` palette,
// only `paper`) left every package name and card title on the supplier detail
// page rendering as `text-ink-900`, near-black navy on a near-black surface,
// invisible until someone selected the text. The same shape had already cost
// us `blush-950`, which is why that stop carries a comment in the config.
//
// So this test resolves every colour utility in the app against the real
// palette. A shade is 50 or a round hundred (plus umber's 850), which is what
// separates a colour class from a structural one: `border-l-2`, `divide-y-0`
// and `ring-offset-2` all parse the same way and are none of our business.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/** Tailwind's own palettes, which we use alongside ours (rose for danger,
 *  amber for warnings) and which are therefore not misspellings. */
const TAILWIND_BUILTIN = new Set([
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);

const COLOR_UTILS = [
  "text",
  "bg",
  "border",
  "ring",
  "divide",
  "from",
  "to",
  "via",
  "placeholder",
  "decoration",
  "outline",
  "shadow",
  "accent",
  "caret",
  "fill",
  "stroke",
].join("|");

/** `dark:hover:text-paper-50` → utility `text`, palette `paper`, shade `50`. */
const CLASS_RE = new RegExp(`\\b(?:[a-z-]+:)*(?:${COLOR_UTILS})-([a-z]+)-(\\d+)\\b`, "g");

/** 50, then round hundreds (umber has an 850). Anything else is a width, a
 *  gap or an offset that merely looks like a colour. */
function isColorShade(shade: string): boolean {
  const n = Number(shade);
  return n === 50 || (n >= 100 && n % 50 === 0);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("tailwind colour tokens", () => {
  it("every colour class in src resolves to a real palette + shade", async () => {
    // Imported by computed path: the config is plain untyped JS, and a static
    // import of it is a TS7016 under this project's settings.
    const config = await import(join(ROOT, "tailwind.config.js"));
    const palette: Record<string, unknown> = config.default.theme.extend.colors;
    const shades = new Map<string, Set<string>>();
    for (const [name, value] of Object.entries(palette)) {
      shades.set(
        name,
        new Set(value !== null && typeof value === "object" ? Object.keys(value) : ["DEFAULT"]),
      );
    }

    const dead: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const [full, name, shade] of line.matchAll(CLASS_RE)) {
            if (!name || !shade || !isColorShade(shade)) continue;
            if (TAILWIND_BUILTIN.has(name)) continue;
            const known = shades.get(name);
            if (known?.has(shade)) continue;
            const why = known ? `palette "${name}" has no shade ${shade}` : `no palette "${name}"`;
            dead.push(`${relative(ROOT, file)}:${i + 1}  ${full}  (${why})`);
          }
        });
    }

    expect(dead).toEqual([]);
  });
});
