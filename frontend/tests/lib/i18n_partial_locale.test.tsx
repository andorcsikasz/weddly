// The contract that makes a PARTIAL locale tree safe to ship.
//
// Croatian and German translate the vendor-facing surface and nothing else, so
// most of `LocaleMessages` is deliberately absent from their trees. That is only
// tolerable because `t()` resolves active-tree-then-EN per KEY: a screen the
// translator never reached reads as English, never as a blank or a dotted path.
// Pinned here because it is the difference between "not translated yet" and
// "visibly broken", and nothing else in the build would catch a regression —
// `warnDrift` deliberately skips the missing-key direction for these two.
//
// Also pins the locale contract itself: the switcher list, the persisted set the
// backend accepts, and the Intl tag each locale formats numbers and dates with.
// A locale in LOCALES that the write path rejects is exactly the bug Spanish sat
// in for a year (picked in the UI, saved as "en" server-side).

import { UI_LOCALES } from "@shared/locales";
import { describe, expect, it } from "bun:test";
import de from "@/locales/de";
import en from "@/locales/en";
import hr from "@/locales/hr";
import { intlLocale } from "@/lib/format";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n";

type Tree = Record<string, unknown>;

function flatten(obj: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(full, v);
    else if (v && typeof v === "object") {
      for (const [ik, iv] of flatten(v as Tree, full)) out.set(ik, iv);
    }
  }
  return out;
}

const EN = flatten(en as unknown as Tree);
const PARTIAL = [
  ["hr", flatten(hr as unknown as Tree)],
  ["de", flatten(de as unknown as Tree)],
] as const;

describe("the shipped locale set", () => {
  it("is the same list the backend persists", () => {
    expect([...LOCALES]).toEqual([...UI_LOCALES]);
  });

  it("gives every locale a switcher label and its own Intl tag", () => {
    for (const l of LOCALES) {
      expect(LOCALE_NAMES[l]).toBeTruthy();
    }
    // Croatian and German must NOT collapse onto en-GB: the copy can lag, but
    // money, dates and number grouping come from the platform and are correct
    // from the first render.
    expect(intlLocale("hr")).toBe("hr-HR");
    expect(intlLocale("de")).toBe("de-DE");
    expect(new Set(LOCALES.map(intlLocale)).size).toBe(LOCALES.length);
  });
});

describe("a partial locale tree", () => {
  it("only ever defines keys that exist in EN", () => {
    // A key at a path EN doesn't have can never be read by `t()` — it is dead
    // weight at best and a typo'd path at worst. TypeScript catches the typo;
    // this catches a key EN later dropped.
    for (const [name, flat] of PARTIAL) {
      const orphans = [...flat.keys()].filter((k) => !EN.has(k));
      expect(`${name}: ${orphans.join(", ")}`).toBe(`${name}: `);
    }
  });

  it("keeps every interpolation placeholder EN uses", () => {
    // `interpolate()` prints an unknown {token} verbatim and silently omits a
    // missing one, so a dropped placeholder is a user-visible defect that no
    // type check can see.
    const ph = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(",");
    for (const [name, flat] of PARTIAL) {
      for (const [key, value] of flat) {
        expect(`${name} ${key}: ${ph(value)}`).toBe(`${name} ${key}: ${ph(EN.get(key) ?? "")}`);
      }
    }
  });

  it("never defines an empty string, which would render as a blank label", () => {
    for (const [name, flat] of PARTIAL) {
      const blanks = [...flat.entries()].filter(([, v]) => v.trim() === "").map(([k]) => k);
      expect(`${name}: ${blanks.join(", ")}`).toBe(`${name}: `);
    }
  });

  it("covers the vendor settings screen the language picker lives on", () => {
    // The whole point of the partial scope. If these drift out, a Croatian or
    // German vendor lands on a half-English settings page from the very screen
    // where they chose the language.
    const mustHave = [
      "vendor.settings.page_title",
      "vendor.settings.locale_label",
      "vendor.nav.settings",
      "vendor.nav.dashboard",
      "vendor.dashboard.page_title",
      "vendor.clients.page_title",
      "profile.account_locale_help",
      "profile.account_title",
      "profile.security_pw_current",
      "common.save",
    ];
    for (const [name, flat] of PARTIAL) {
      for (const key of mustHave) {
        expect(`${name} ${key}: ${flat.has(key)}`).toBe(`${name} ${key}: true`);
      }
    }
  });
});
