// Static guard: every `t("literal.key")` in the frontend source must resolve.
//
// Why this exists: `missingKeyFallback` in lib/i18n.tsx prints the raw dotted
// path in DEV (loud, with a console warning) but the HUMANISED LAST SEGMENT in
// PROD. So a key that exists in no tree looks obviously broken on a developer's
// machine and reads as plausible English junk in the shipped build — "Custom
// row add aria" on a button, "Assignee bride" where a person's name goes. That
// asymmetry is exactly why a whole set of dead keys survived for months.
//
// Resolution is checked against the EN tree ALONE, on purpose. EN is the
// fallback every locale falls through to inside `t()`, so a key missing from EN
// is dead in every language; a key present in EN but missing from HU merely
// reads in English, which is drift (`warnDriftDev`'s job), not a broken screen.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import en from "../src/locales/en";

const SRC = join(import.meta.dir, "..", "src");

/** Source trees the scan skips. The locale files themselves contain no call
 *  sites, and scripts/ never renders. */
const SKIP_DIRS = new Set(["locales", "node_modules"]);

interface CallSite {
  file: string;
  line: number;
  key: string;
  /** True when the call may pass a numeric `count`/`n`, i.e. when `t()` would
   *  consider the `_one`/`_other` plural variants. */
  mayPluralise: boolean;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Blank out `//` and block comments, and the bodies of string/template
 *  literals that are NOT the first argument of a `t(` call, so a key path
 *  quoted inside prose ("we removed budget.old_key") can't be mistaken for a
 *  live call site. Characters are replaced with spaces rather than deleted so
 *  every offset — and therefore every reported line number — stays true. */
function blankComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  let quote: string | null = null;
  while (i < n) {
    const c = src[i] as string;
    if (quote) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i += 1;
      }
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Consume the balanced argument list starting at the `(` index. Returns the
 *  raw inner text, or null if the call is unterminated (never, in valid TS). */
function readArgs(src: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i] as string;
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Every `t(...)` call in a file, split into literal-key call sites and the
 *  count of dynamic ones a static scan cannot judge. The lookbehind rejects
 *  `.t(`, `format(`, `translate(` and any identifier ending in t. */
function scanFile(file: string): { sites: CallSite[]; dynamic: number } {
  const raw = readFileSync(file, "utf8");
  const src = blankComments(raw);
  const sites: CallSite[] = [];
  let dynamic = 0;
  const re = /(?<![A-Za-z0-9_$.])t\s*\(/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    const open = m.index + m[0].length - 1;
    const args = readArgs(src, open);
    if (args !== null) {
      const first = /^\s*(["'])([A-Za-z0-9_.\-]*)\1\s*(,|$)/.exec(args);
      if (first && first[2]) {
        const rest = args.slice(first[0].length);
        // Faithful to `pickCount`: a literal `count:` / `n:` makes `t()` look
        // for the plural variants. A vars object we cannot read statically
        // (a variable, a spread, a conditional) is treated as possibly
        // carrying a count, so the scan never invents a failure.
        const literalObject = /^\s*\{/.test(rest) && !rest.includes("...");
        const mayPluralise = literalObject
          ? /(^|[{,\s])(count|n)\s*:/.test(rest)
          : rest.trim() !== "";
        sites.push({
          file,
          line: src.slice(0, m.index).split("\n").length,
          key: first[2],
          mayPluralise,
        });
      } else {
        // A template literal, a variable, a ternary — `t(\`suppliers.cat.${s}\`)`
        // and friends. Unknowable without running the app.
        dynamic += 1;
      }
    }
    m = re.exec(src);
  }
  return { sites, dynamic };
}

/** Mirror of `resolve()` in lib/i18n.tsx: walk the dotted path, and only a
 *  string counts as resolved (a path that lands on a nested object does not). */
function resolves(tree: unknown, path: string): boolean {
  let cur: unknown = tree;
  for (const p of path.split(".")) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return false;
    }
  }
  return typeof cur === "string";
}

/** Mirror of the resolution ladder inside `t()`: with a count in hand it tries
 *  `<path>_one` / `<path>_other` first and falls back to the bare path; with no
 *  count only the bare path is ever looked up. */
function isLive(site: CallSite): boolean {
  if (resolves(en, site.key)) return true;
  if (!site.mayPluralise) return false;
  return resolves(en, `${site.key}_one`) || resolves(en, `${site.key}_other`);
}

describe("i18n key integrity", () => {
  const files = walk(SRC);
  const sites: CallSite[] = [];
  let dynamic = 0;
  for (const f of files) {
    const r = scanFile(f);
    sites.push(...r.sites);
    dynamic += r.dynamic;
  }

  test("the scan actually found call sites", () => {
    // A regex that quietly stops matching would turn this whole file into a
    // test that passes by finding nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(sites.length).toBeGreaterThan(3000);
  });

  test("every literal t() key resolves in the EN tree", () => {
    const dead = sites.filter((s) => !isLive(s));
    const report = dead
      .map((s) => `  ${relative(SRC, s.file)}:${s.line}  t("${s.key}")`)
      .sort()
      .join("\n");
    const summary =
      `scanned ${sites.length} literal t() call sites across ${files.length} files; ` +
      `${dynamic} dynamic keys skipped (template literals / variables — unknowable statically)`;
    // Printed on a PASS too: the skipped count is this guard's blind spot, and
    // a blind spot nobody can see the size of is the one that grows.
    console.log(`[i18n guard] ${summary}`);
    expect(
      dead.length === 0 ? summary : `${dead.length} dead i18n key(s) — ${summary}\n${report}`,
    ).toBe(summary);
  });
});
