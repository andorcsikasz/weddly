import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { Currency } from "@shared/types";
import en from "../locales/en";
import type { LocaleMessages } from "../locales/keys";

export type Locale = "hu" | "en";

const STORAGE_KEY = "weddly.locale";
// Preferred display currency, set explicitly by the user via the prompt
// that opens on the first language switch. Once stored, language flips no
// longer change the currency on public surfaces (landing demo, pricing).
const CURRENCY_KEY = "weddly.currency";

// Locale-tree cache. EN is bundled eagerly (Next-9: was 162KB; previously
// hu+en together inflated the initial chunk by 347KB / 63% of `index.js`).
// HU is dynamically imported the first time setLocale("hu") fires; the
// promise is cached so a back-and-forth flip doesn't re-fetch. Real HU
// users (navigator.language=hu) pay one extra network round trip on the
// I18nProvider mount; everyone else (EN default, FR, DE, …) saves the
// full HU chunk.
const TREES: Partial<Record<Locale, LocaleMessages>> = { en };
let huPromise: Promise<LocaleMessages> | null = null;
function loadHu(): Promise<LocaleMessages> {
  if (TREES.hu) return Promise.resolve(TREES.hu);
  if (huPromise) return huPromise;
  huPromise = import("../locales/hu").then((mod) => {
    TREES.hu = mod.default;
    return mod.default;
  });
  return huPromise;
}

/** Test-only: synchronously populate the HU locale tree so render() can assert
 *  on HU labels without an extra waitFor(). Production code never calls this —
 *  the lazy import keeps the HU chunk out of the initial bundle for EN users. */
export async function _preloadHuForTests(): Promise<void> {
  await loadHu();
}

interface I18nState {
  locale: Locale;
  /** Switch UI locale. By default, the FIRST call without a stored
   *  `currencyPref` defers the switch and surfaces a currency-pref prompt
   *  (so flipping HU → EN doesn't silently re-denominate the budget demo
   *  from Ft to €). Pass `silent: true` for non-user-initiated syncs (e.g.
   *  hydrating from `user.locale` on login). */
  setLocale: (l: Locale, opts?: { silent?: boolean }) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
  /** Last currency the user picked in the language-switch prompt. `null`
   *  until they pick — public surfaces fall back to a locale-derived
   *  default in that case. */
  currencyPref: Currency | null;
  /** Locale the user requested but hasn't confirmed yet (prompt in flight).
   *  `<CurrencyPrefDialog>` reads this to decide when to render. */
  pendingLocale: Locale | null;
  /** Save the picked currency and, if a locale switch is pending, apply it. */
  confirmCurrencyPref: (c: Currency) => void;
  /** Drop the pending locale switch without changing currency or locale. */
  cancelPendingLocale: () => void;
}

const I18nContext = createContext<I18nState | null>(null);

function detectInitialCurrency(): Currency | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(CURRENCY_KEY);
    if (saved === "HUF" || saved === "EUR" || saved === "USD") return saved;
  } catch {
    // localStorage may be blocked
  }
  return null;
}

function detectInitial(): Locale {
  // Host-driven signal wins: visiting the EN canonical (e.g. weddly.com)
  // forces EN regardless of localStorage or navigator.language. Matches
  // the backend `localeForHost` policy so SSR + client agree on the first
  // render. Build-time `VITE_EN_CANONICAL_HOST` is empty in single-host
  // deploys (status quo) and populated once the user activates weddly.com.
  if (typeof window !== "undefined") {
    const enHost = (import.meta.env.VITE_EN_CANONICAL_HOST ?? "").trim().toLowerCase();
    if (enHost && window.location.hostname.toLowerCase() === enHost) {
      return "en";
    }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "hu" || saved === "en") return saved;
  } catch {
    // localStorage may be blocked
  }
  // Otherwise: sniff navigator.language. HU-speaking browser → HU, every-
  // thing else (FR, DE, ES, EN, …) → EN. This is the post-international-
  // expansion default; an unsaved visitor is more likely to want EN.
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

/** Walks both trees and warns on missing keys. Catches translation drift early.
 *  Dev-only — gated by `import.meta.env.DEV` so the production bundle never
 *  loads the HU chunk just to lint it. */
async function warnDriftDev() {
  const huTree = await loadHu();
  const flatten = (obj: Record<string, unknown>, prefix = ""): string[] => {
    const out: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") out.push(...flatten(v as Record<string, unknown>, full));
      else out.push(full);
    }
    return out;
  };
  const huKeys = new Set(flatten(huTree as unknown as Record<string, unknown>));
  const enKeys = new Set(flatten(en as unknown as Record<string, unknown>));
  for (const k of huKeys) if (!enKeys.has(k)) console.warn("[i18n] missing in en:", k);
  for (const k of enKeys) if (!huKeys.has(k)) console.warn("[i18n] missing in hu:", k);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitial);
  const [currencyPref, setCurrencyPrefState] = useState<Currency | null>(detectInitialCurrency);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  // Bumps when the dynamic HU import resolves, so components re-render with
  // the freshly-loaded tree once it's available. Without this, the initial
  // HU detection would render with EN strings (the fallback) until the user
  // flipped something that triggered a re-render.
  const [huLoadedAt, setHuLoadedAt] = useState<number>(0);

  // On mount: if HU is the initial locale, kick off the import so the user
  // doesn't see EN strings flash before the dynamic chunk lands. The flash
  // window is one paint frame in practice — Vite splits the chunk into a
  // sibling preload, but a slow network is still a slow network.
  useEffect(() => {
    if (locale === "hu" && !TREES.hu) {
      void loadHu().then(() => setHuLoadedAt(Date.now()));
    }
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (import.meta.env.DEV) void warnDriftDev();
  }, [locale]);

  /** Apply the locale unconditionally — bypasses the currency prompt.
   *  Used both for explicit silent switches (auth sync) and as the inner
   *  commit step after the user confirms a currency pick. */
  const applyLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    if (l === "hu" && !TREES.hu) {
      // Flip the state first so the rest of the UI snaps to its new locale
      // immediately; the HU chunk arrives a tick later and triggers a
      // re-render via `huLoadedAt`. The EN fallback in `t()` means the
      // interim isn't blank, just temporarily in EN.
      setLocaleState(l);
      void loadHu().then(() => setHuLoadedAt(Date.now()));
    } else {
      setLocaleState(l);
    }
  }, []);

  const setLocale = useCallback(
    (l: Locale, opts?: { silent?: boolean }) => {
      // No-op when already on the requested locale — avoids opening the
      // currency prompt for an idempotent click.
      if (l === locale) return;
      // `silent: true` skips the prompt entirely (auth hydration, programmatic
      // sync). Same for already-picked currency — once the user has answered
      // once, future flips don't re-ask.
      if (opts?.silent || currencyPref !== null) {
        applyLocale(l);
        return;
      }
      setPendingLocale(l);
    },
    [locale, currencyPref, applyLocale],
  );

  const confirmCurrencyPref = useCallback(
    (c: Currency) => {
      try {
        localStorage.setItem(CURRENCY_KEY, c);
      } catch {
        // ignore
      }
      setCurrencyPrefState(c);
      if (pendingLocale) {
        applyLocale(pendingLocale);
        setPendingLocale(null);
      }
    },
    [pendingLocale, applyLocale],
  );

  const cancelPendingLocale = useCallback(() => {
    setPendingLocale(null);
  }, []);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => {
      // `huLoadedAt` is read here only to make the closure re-evaluate when
      // the dynamic HU import lands — without referencing it, useCallback
      // would memoise against a stale TREES.hu of `undefined`.
      void huLoadedAt;
      // Fall back to EN whenever the requested tree isn't ready yet (HU
      // mid-load) — better than showing the raw key. Once the chunk lands,
      // the next render uses the real HU string.
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
    [locale, huLoadedAt],
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        t,
        currencyPref,
        pendingLocale,
        confirmCurrencyPref,
        cancelPendingLocale,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: "hu" as const,
      setLocale: () => {},
      t: (path: string, vars?: Record<string, string | number>) => interpolate(path, vars),
      currencyPref: null as Currency | null,
      pendingLocale: null as Locale | null,
      confirmCurrencyPref: (_c: Currency) => {},
      cancelPendingLocale: () => {},
    };
  }
  return ctx;
}
