import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import en from "../locales/en";
import hu from "../locales/hu";
import type { LocaleMessages } from "../locales/keys";

export type Locale = "hu" | "en";

const STORAGE_KEY = "weddly.locale";
const TREES: Record<Locale, LocaleMessages> = { hu, en };

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "hu" || saved === "en") return saved;
  } catch {
    // localStorage may be blocked
  }
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("hu")) {
    return "hu";
  }
  return "en";
}

function resolve(tree: LocaleMessages, path: string): string | null {
  const parts = path.split(".");
  let cur: unknown = tree;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return typeof cur === "string" ? cur : null;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

/** Pull a numeric count from interpolation vars. Accepts `count` first, then
 *  falls back to `n` so existing call sites that pass `{ n: 5 }` get plural
 *  picking for free. Strings are ignored (formatted output, not a raw count). */
function pickCount(vars?: Record<string, string | number>): number | null {
  if (!vars) return null;
  const c = vars.count;
  if (typeof c === "number") return c;
  const n = vars.n;
  if (typeof n === "number") return n;
  return null;
}

/** Walks both trees and warns on missing keys. Catches translation drift early. */
function warnDrift() {
  const flatten = (obj: Record<string, unknown>, prefix = ""): string[] => {
    const out: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") out.push(...flatten(v as Record<string, unknown>, full));
      else out.push(full);
    }
    return out;
  };
  const huKeys = new Set(flatten(hu as unknown as Record<string, unknown>));
  const enKeys = new Set(flatten(en as unknown as Record<string, unknown>));
  for (const k of huKeys) if (!enKeys.has(k)) console.warn("[i18n] missing in en:", k);
  for (const k of enKeys) if (!huKeys.has(k)) console.warn("[i18n] missing in hu:", k);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitial);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (import.meta.env.DEV) warnDrift();
  }, [locale]);

  const setLocale = (l: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    setLocaleState(l);
  };

  const t = (path: string, vars?: Record<string, string | number>) => {
    const tree = TREES[locale];
    const count = pickCount(vars);
    if (count !== null) {
      const variant = count === 1 ? `${path}_one` : `${path}_other`;
      const pluralForm = resolve(tree, variant);
      if (pluralForm !== null) return interpolate(pluralForm, vars);
    }
    const base = resolve(tree, path);
    return interpolate(base ?? path, vars);
  };

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: "hu" as const,
      setLocale: () => {},
      t: (path: string, vars?: Record<string, string | number>) => interpolate(path, vars),
    };
  }
  return ctx;
}
