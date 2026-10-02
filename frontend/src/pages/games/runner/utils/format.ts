/**
 * What the HUD and the game-over card print.
 *
 * Every money figure is `formatMoney(amount, currency, locale)` with the
 * couple's OWN currency — never a `formatHuf` and never a hardcoded symbol. The
 * game scores in `RUN_ECONOMY[currency]` units (a HUF coin is 10 000, a EUR coin
 * is 10), and the platform formats and groups them for the reader's locale, so
 * the same score reads correctly in Budapest and in Berlin with no branch here.
 *
 * THERE IS DELIBERATELY NO SECOND MONEY FORMATTER IN THIS GAME. A runner is
 * tempting to hand-roll — a prefix glyph, a dot-grouped forint scoreboard — but
 * every such formatter is a second answer to "how does money look in this app",
 * and the day the currency list or the locale list grows, the HUD and the budget
 * page disagree on screen. `formatMoney` is the app's one money path; this file
 * is a thin named wrapper over it so the call sites read as game vocabulary
 * instead of Intl options.
 *
 * A label never spells the currency out: one string per locale cannot say what
 * the couple picked per workspace, so the glyph travels with the NUMBER (which
 * `formatMoney` already does via `narrowSymbol`), and `runSymbol` exists for the
 * two places that genuinely need it standing beside a bare figure.
 */

import type { UiLocale } from "@shared/locales";
import { coinValue, economyFor, pickupValue, type CashId } from "@shared/runner";
import type { Currency } from "@shared/types";
import { currencySymbol, formatMoney, intlLocale } from "@/lib/format";

/** A score, a bill or a pickup, in the run's own currency. */
export function runMoney(amount: number, currency: Currency, locale: UiLocale): string {
  return formatMoney(amount, currency, locale);
}

/** What ONE hit costs, in the run's currency.
 *
 *  This exists as a function, rather than a value passed down from the engine,
 *  because the two PRINTED props in the world quote it on a canvas texture. Those
 *  textures are cached by their CONTENT, so the number has to be a finished
 *  string before it is ever drawn, and it therefore cannot depend on the frame
 *  the engine happens to be in. */
export function expenseFor(currency: Currency): number {
  return economyFor(currency).expensePerHit;
}

/** The currency glyph alone, for the HUD's leading figure and the game-over card.
 *  Beside the number, never inside a translated label. */
export function runSymbol(currency: Currency, locale: UiLocale): string {
  return currencySymbol(currency, locale);
}

/** What ONE collectible is worth, for the floating pickup text. A `bag` slot
 *  collects a tote, which is why it cannot go through `coinValue`. */
export function pickupLabel(tier: CashId | "bag", currency: Currency, locale: UiLocale): string {
  return formatMoney(pickupValue(tier, currency), currency, locale);
}

/** The per-tier figures, for the menu's "what's on the track" strip. */
export function tierValues(currency: Currency): Record<CashId, number> {
  return {
    coin: coinValue("coin", currency),
    bundle: coinValue("bundle", currency),
    envelope: coinValue("envelope", currency),
  };
}

/** Metres travelled. Grouped like money, because it is a big number for the same
 *  reason a score is — and grouped through `intlLocale`, never through a local
 *  `locale === "hu" ? … : …`, which is the exact shape that silently handed every
 *  locale added after Hungarian the en-GB format. */
export function runDistance(metres: number, locale: UiLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.round(metres)),
  );
}
