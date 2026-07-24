import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import en from "../locales/en";
import type { LocaleMessages } from "../locales/keys";

export type Locale = "hu" | "en" | "es";

/** Every UI locale the app ships. EN is the bundled default; the rest are
 *  dynamically imported on first use (see `loadTree`). Order is the order the
 *  language switcher cycles through. */
export const LOCALES: readonly Locale[] = ["en", "hu", "es"];

/** Display name of each locale in its OWN language, for switcher labels. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hu: "Magyar",
  es: "Español",
};

const STORAGE_KEY = "weddly.locale";

// Locale-tree cache. EN is bundled eagerly (keeps the initial chunk small —
// hu+en together previously inflated `index.js` by ~347KB / 63%). HU and ES
// are each dynamically imported the first time they're selected; the import
// promise is cached per-locale so a back-and-forth flip doesn't re-fetch.
// Real non-EN users pay one extra network round trip on the I18nProvider
// mount; everyone on the EN default saves the full translation chunk.
const TREES: Partial<Record<Locale, LocaleMessages>> = { en };
const lazyPromises: Partial<Record<Locale, Promise<LocaleMessages>>> = {};

/** Load a locale tree, dynamically importing the non-EN ones on demand. EN is
 *  always resolved from the eager bundle. The per-locale promise cache means a
 *  concurrent second call while the import is in flight reuses it. */
function loadTree(locale: Locale): Promise<LocaleMessages> {
  const cached = TREES[locale];
  if (cached) return Promise.resolve(cached);
  const inflight = lazyPromises[locale];
  if (inflight) return inflight;
  // EN is always in TREES, so we only ever dynamic-import hu or es here.
  const mod = locale === "hu" ? import("../locales/hu") : import("../locales/es");
  const promise = mod.then((m) => {
    TREES[locale] = m.default;
    return m.default;
  });
  lazyPromises[locale] = promise;
  return promise;
}

/** Test-only: synchronously populate the HU locale tree so render() can assert
 *  on HU labels without an extra waitFor(). Production code never calls this —
 *  the lazy import keeps the HU chunk out of the initial bundle for EN users. */
export async function _preloadHuForTests(): Promise<void> {
  await loadTree("hu");
}

/** Test-only companion to `_preloadHuForTests` for the ES locale tree. */
export async function _preloadEsForTests(): Promise<void> {
  await loadTree("es");
}

interface I18nState {
  locale: Locale;
  /** Switch UI locale. The display currency on public surfaces is derived
   *  from the locale (HU → HUF, everything else → EUR), so flipping the
   *  language re-denominates prices to match. The `opts` arg is accepted
   *  for call-site compatibility but no longer changes behaviour. */
  setLocale: (l: Locale, opts?: { silent?: boolean }) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function detectInitial(): Locale {
  // EN is the default everywhere. The product is positioned as
  // international-first; navigators no longer auto-flip the UI. A user who
  // explicitly picks a language via the locale switcher saves the choice to
  // localStorage and it sticks across visits.
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "hu" || saved === "en" || saved === "es") return saved;
  } catch {
    // localStorage may be blocked
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

/** Walks the non-EN trees against EN and warns on missing keys. Catches
 *  translation drift early. Dev-only — gated by `import.meta.env.DEV` so the
 *  production bundle never loads a translation chunk just to lint it. */
async function warnDriftDev() {
  const flatten = (obj: Record<string, unknown>, prefix = ""): string[] => {
    const out: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") out.push(...flatten(v as Record<string, unknown>, full));
      else out.push(full);
    }
    return out;
  };
  const enKeys = new Set(flatten(en as unknown as Record<string, unknown>));
  for (const loc of ["hu", "es"] as const) {
    const tree = await loadTree(loc);
    const keys = new Set(flatten(tree as unknown as Record<string, unknown>));
    for (const k of keys)
      if (!enKeys.has(k)) console.warn(`[i18n] missing in en (present in ${loc}):`, k);
    for (const k of enKeys) if (!keys.has(k)) console.warn(`[i18n] missing in ${loc}:`, k);
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitial);
  // Bumps when a dynamic locale import resolves, so components re-render with
  // the freshly-loaded tree once it's available. Without this, the initial
  // non-EN detection would render with EN strings (the fallback) until the user
  // flipped something that triggered a re-render.
  const [lazyLoadedAt, setLazyLoadedAt] = useState<number>(0);

  // On mount: if a lazy (non-EN) locale is the initial one, kick off the import
  // so the user doesn't see EN strings flash before the dynamic chunk lands.
  // The flash window is one paint frame in practice — Vite splits the chunk
  // into a sibling preload, but a slow network is still a slow network.
  useEffect(() => {
    if (locale !== "en" && !TREES[locale]) {
      void loadTree(locale).then(() => setLazyLoadedAt(Date.now()));
    }
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (import.meta.env.DEV) void warnDriftDev();
  }, [locale]);

  const setLocale = useCallback(
    (l: Locale) => {
      // No-op when already on the requested locale.
      if (l === locale) return;
      try {
        localStorage.setItem(STORAGE_KEY, l);
      } catch {
        // ignore
      }
      if (l !== "en" && !TREES[l]) {
        // Flip the state first so the rest of the UI snaps to its new locale
        // immediately; the translation chunk arrives a tick later and triggers
        // a re-render via `lazyLoadedAt`. The EN fallback in `t()` means the
        // interim isn't blank, just temporarily in EN.
        setLocaleState(l);
        void loadTree(l).then(() => setLazyLoadedAt(Date.now()));
      } else {
        setLocaleState(l);
      }
    },
    [locale],
  );

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => {
      // `lazyLoadedAt` is read here only to make the closure re-evaluate when
      // a dynamic import lands — without referencing it, useCallback would
      // memoise against a stale TREES entry of `undefined`.
      void lazyLoadedAt;
      // Fall back to EN whenever the requested tree isn't ready yet (non-EN
      // mid-load) — better than showing the raw key. Once the chunk lands,
      // the next render uses the real translated string.
      const tree = TREES[locale] ?? en;
      const count = pickCount(vars);
      if (count !== null) {
        const variant = count === 1 ? `${path}_one` : `${path}_other`;
        const pluralForm = resolve(tree, variant);
        if (pluralForm !== null) return interpolate(pluralForm, vars);
      }
      const base = resolve(tree, path);
      return interpolate(base ?? path, vars);
    },
    [locale, lazyLoadedAt],
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        t,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

/** The next locale in the switcher cycle after `current` (wraps around). Used
 *  by the compact language toggles that step through en → hu → es → en. */
export function nextLocale(current: Locale): Locale {
  const idx = LOCALES.indexOf(current);
  return LOCALES[(idx + 1) % LOCALES.length] ?? "en";
}

/** Narrow a UI locale to the set of locales that long-form CONTENT is authored
 *  in (currently HU + EN): blog posts, tool FAQs, planning/schedule template
 *  text, and other hu/en-keyed maps. ES — and any future UI-only locale — has
 *  a translated interface but no bespoke content, so it reads that content in
 *  EN. Use this to index any `{ hu, en }`-shaped record by the live locale. */
export function contentLocale(locale: Locale): "hu" | "en" {
  return locale === "hu" ? "hu" : "en";
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
