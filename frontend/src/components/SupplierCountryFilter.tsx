// Country picker for the supplier directory filter bar (next to Árszint /
// Vendégszám). Scopes the curated catalogue to one country, or "Mind"/All for
// the full set. It seeds from the couple's onboarding country (passed as
// `homeCountry`), which is also the reset target and the first listed option.
//
// A native <select> can't show a flag + reset affordance or a per-option
// count, so this is a small hand-rolled listbox: a compact trigger (flag +
// localised name on sm+, flag + ISO code on mobile) with an inline ✕ to reset,
// and a menu that lists every country the catalogue covers with its count.

import { countryName } from "@shared/country_list";
import type { SupplierCountryCount } from "@shared/suppliers";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "../lib/i18n";

/** ISO 3166-1 alpha-2 → flag emoji via regional-indicator symbols. Returns ""
 *  for anything that isn't two ASCII letters so a bad code renders as no glyph
 *  rather than tofu. */
function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

type Props = {
  /** Current selection: "all" (or "") for the full catalogue, else an ISO code. */
  value: string;
  /** The couple's own country — sorted first and used as the ✕ reset target.
   *  Empty string when there's no workspace (anonymous / no couple). */
  homeCountry: string;
  /** Every country the catalogue covers, with curated counts. */
  countries: SupplierCountryCount[];
  /** Emits "all" or an ISO code. */
  onChange: (next: string) => void;
};

export function SupplierCountryFilter({ value, homeCountry, countries, onChange }: Props) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  // Click-outside + Escape collapse the menu. Pointerdown (not click) so a tap
  // on an option still commits before the outside handler fires.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Menu order: the couple's own country first (localised relevance), then the
  // rest alphabetical by localised name. "Mind"/All is rendered separately at
  // the top. The home country is folded in even with a zero count so it's
  // always selectable.
  const { total, ordered } = useMemo(() => {
    const byCode = new Map(countries.map((c) => [c.code, c.count]));
    if (homeCountry && !byCode.has(homeCountry)) byCode.set(homeCountry, 0);
    const sum = [...byCode.values()].reduce((a, b) => a + b, 0);
    const rest = [...byCode.entries()]
      .filter(([code]) => code !== homeCountry)
      .sort((a, b) => countryName(a[0], locale).localeCompare(countryName(b[0], locale), locale))
      .map(([code, count]) => ({ code, count }));
    const list =
      homeCountry && byCode.has(homeCountry)
        ? [{ code: homeCountry, count: byCode.get(homeCountry) ?? 0 }, ...rest]
        : rest;
    return { total: sum, ordered: list };
  }, [countries, homeCountry, locale]);

  const isAll = value === "all" || value === "";
  const activeCountry = isAll ? null : value;
  const home = homeCountry || "all";
  // ✕ only when the current pick isn't the home/default state.
  const canReset = value !== home && !(isAll && home === "all");

  const triggerName = activeCountry
    ? countryName(activeCountry, locale)
    : t("suppliers.country_filter_all");

  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
        {t("suppliers.country_filter_label")}
      </span>
      <div className="relative" ref={wrapRef}>
        <div
          className={
            activeCountry
              ? "inline-flex items-center rounded-full border border-ink-700 bg-paper-50 dark:border-paper-50 dark:bg-umber-800"
              : "inline-flex items-center rounded-full border border-transparent"
          }
        >
          <button
            type="button"
            data-testid="country-filter-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label={t("suppliers.country_filter_label")}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[11px] font-semibold tracking-[0.02em] text-ink-800 transition hover:text-ink-900 dark:text-paper-100"
          >
            <span aria-hidden className="text-[13px] leading-none">
              {activeCountry ? flagEmoji(activeCountry) : "🌍"}
            </span>
            {/* Full localised name on sm+; bare ISO code on mobile to keep the
                already-busy filter bar from overflowing. */}
            <span className="hidden sm:inline">{triggerName}</span>
            <span className="uppercase sm:hidden">
              {activeCountry ?? t("suppliers.country_filter_all")}
            </span>
            <ChevronDown size={12} aria-hidden className="text-ink-400 dark:text-umber-300" />
          </button>
          {canReset && (
            <button
              type="button"
              onClick={() => {
                onChange(home);
                setOpen(false);
              }}
              aria-label={t("suppliers.country_filter_reset")}
              title={t("suppliers.country_filter_reset")}
              className="mr-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-400 transition hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
            >
              <X size={12} aria-hidden />
            </button>
          )}
        </div>
        {open && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t("suppliers.country_filter_label")}
            className="absolute left-0 z-30 mt-1 max-h-72 min-w-[12rem] overflow-y-auto rounded-xl border border-paper-300 bg-paper-50 py-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
          >
            <CountryOption
              flag="🌍"
              label={t("suppliers.country_filter_all")}
              count={total}
              selected={isAll}
              onPick={() => {
                onChange("all");
                setOpen(false);
              }}
            />
            <li className="my-1 border-t border-paper-200 dark:border-umber-700" aria-hidden />
            {ordered.map((o) => (
              <CountryOption
                key={o.code}
                flag={flagEmoji(o.code)}
                label={countryName(o.code, locale)}
                count={o.count}
                selected={value === o.code}
                onPick={() => {
                  onChange(o.code);
                  setOpen(false);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CountryOption({
  flag,
  label,
  count,
  selected,
  onPick,
}: {
  flag: string;
  label: string;
  count: number;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onPick}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition ${
          selected
            ? "bg-paper-200 text-ink-900 dark:bg-umber-700 dark:text-paper-50"
            : "text-ink-800 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700/60"
        }`}
      >
        <span aria-hidden className="text-base leading-none">
          {flag}
        </span>
        <span className="flex-1 truncate">{label}</span>
        <span className="tabular-nums text-[11px] text-ink-400 dark:text-umber-300">{count}</span>
      </button>
    </li>
  );
}
