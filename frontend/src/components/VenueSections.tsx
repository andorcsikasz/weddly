// Couple-facing venue sections (shared/venue.ts), rendered on the vendor
// profile page and, for the estimate panel, inside the vendor's own editor so
// "what will a couple see for this date?" has one answer.
//
// Everything unanswered renders NOTHING rather than a "no": the profile is
// optional field by field, and "parking: no" is a claim the vendor never made.

import { useEffect, useState } from "react";
import { CalendarDays, CircleAlert, CloudRain, Sparkles, Users } from "lucide-react";
import {
  matchVenuePricing,
  PRICED_MODES,
  ruleIsYearRound,
  type VenueDetail,
  type VenueEstimateLine,
  type VenuePriceItem,
  type VenuePricingMatch,
  type VenuePricingRule,
} from "@shared/venue";
import type { Currency } from "@shared/currency";
import { formatMoney, intlLocale } from "../lib/format";
import type { Locale } from "../lib/i18n";
import { MoneyInput } from "./MoneyInput";

type T = (k: string, vars?: Record<string, string | number>) => string;

const H2 = "text-2xl font-bold tracking-tight text-ink-900 dark:text-paper-50";
const H3 = "text-sm font-semibold text-ink-900 dark:text-paper-50";
const CHIP =
  "inline-flex items-center rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100";

export function monthLabel(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, month - 1, 1)),
  );
}

/** "May–Sep · Sat · 100+ guests": the rule's condition in one line. */
export function ruleConditionLabel(rule: VenuePricingRule, locale: Locale, t: T): string {
  const parts: string[] = [];
  parts.push(
    ruleIsYearRound(rule)
      ? t("venue.all_year")
      : `${monthLabel(rule.start_month, locale)}–${monthLabel(rule.end_month, locale)}`,
  );
  parts.push(rule.days.map((d) => t(`venue.day_short.${d}`)).join(", "));
  if (rule.min_guests !== null && rule.max_guests !== null) {
    parts.push(t("venue.guests_between", { min: rule.min_guests, max: rule.max_guests }));
  } else if (rule.min_guests !== null) {
    parts.push(t("venue.guests_min", { n: rule.min_guests }));
  } else if (rule.max_guests !== null) {
    parts.push(t("venue.guests_max", { n: rule.max_guests }));
  }
  return parts.join(" · ");
}

export function itemLabel(item: VenuePriceItem, t: T): string {
  return item.label ?? t(`venue.item.${item.key}`);
}

/** The item's own price, as the vendor stated it ("30 990 Ft / guest"). */
export function itemPriceLabel(
  item: VenuePriceItem,
  currency: Currency,
  locale: Locale,
  t: T,
): string {
  if (!PRICED_MODES.includes(item.mode) || item.amount === null) {
    return t(`venue.mode.${item.mode}`);
  }
  const money = formatMoney(item.amount, currency, locale);
  switch (item.mode) {
    case "per_guest":
      return t("venue.price_per_guest", { amount: money });
    case "per_room":
      return t("venue.price_per_room", { amount: money });
    case "per_hour":
      return t("venue.price_per_hour", { amount: money });
    case "from":
      return t("venue.price_from", { amount: money });
    default:
      return money;
  }
}

// ── Tags ───────────────────────────────────────────────────────────────────

export function VenueTagChips({ venue, t }: { venue: VenueDetail; t: T }) {
  const p = venue.profile;
  const tags = [
    ...p.venue_types.map((k) => t(`venue.type.${k}`)),
    ...p.settings.map((k) => t(`venue.setting.${k}`)),
    ...p.styles.map((k) => t(`venue.style.${k}`)),
  ];
  if (tags.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((label) => (
        <span key={label} className={CHIP}>
          {label}
        </span>
      ))}
    </div>
  );
}

// ── Capacity, facilities, spaces ───────────────────────────────────────────

/** Whether `VenueOverviewSection` has anything to draw, so a nav tab never
 *  points at a section that rendered nothing. */
export function venueHasOverview(venue: VenueDetail): boolean {
  const p = venue.profile;
  return (
    p.max_seated !== null ||
    p.max_ceremony !== null ||
    p.max_standing !== null ||
    p.min_guests !== null ||
    p.facilities.length > 0 ||
    venue.spaces.length > 0
  );
}

export function VenueOverviewSection({
  id,
  venue,
  currency,
  locale,
  t,
}: {
  id: string;
  venue: VenueDetail;
  currency: Currency;
  locale: Locale;
  t: T;
}) {
  const p = venue.profile;
  const capacities = [
    p.max_seated !== null ? t("venue.cap_seated", { n: p.max_seated }) : null,
    p.max_ceremony !== null ? t("venue.cap_ceremony", { n: p.max_ceremony }) : null,
    p.max_standing !== null ? t("venue.cap_standing", { n: p.max_standing }) : null,
    p.min_guests !== null ? t("venue.cap_min", { n: p.min_guests }) : null,
  ].filter((s): s is string => s !== null);
  if (!venueHasOverview(venue)) return null;

  return (
    <section id={id} className="mb-12 scroll-mt-36">
      <h2 className={`${H2} mb-4`}>{t("venue.section_title")}</h2>

      {capacities.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-700 dark:text-umber-100">
          {capacities.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <Users size={15} strokeWidth={1.5} aria-hidden className="text-ink-500" />
              {c}
            </span>
          ))}
        </div>
      )}

      {p.facilities.length > 0 && (
        <ul className="mb-6 grid gap-x-6 gap-y-2 text-sm text-ink-700 sm:grid-cols-2 dark:text-umber-100">
          {p.facilities.map((f) => (
            <li key={f} className="inline-flex items-center gap-2">
              <Sparkles size={14} strokeWidth={1.5} aria-hidden className="text-ink-500" />
              {f === "accommodation" && p.accommodation_capacity !== null
                ? t("venue.facility_accommodation_n", { n: p.accommodation_capacity })
                : t(`venue.facility.${f}`)}
            </li>
          ))}
        </ul>
      )}

      {venue.spaces.length > 0 && (
        <>
          <h3 className={`${H3} mb-3`}>{t("venue.spaces_title")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {venue.spaces.map((s) => (
              <article
                key={s.id}
                className="overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700"
              >
                {s.photo_urls[0] && (
                  <img
                    src={s.photo_urls[0]}
                    alt=""
                    loading="lazy"
                    className="aspect-[16/9] w-full object-cover"
                  />
                )}
                <div className="space-y-1.5 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="font-semibold text-ink-900 dark:text-paper-50">{s.name}</h4>
                    {s.capacity !== null && (
                      <span className="shrink-0 text-xs text-ink-500 dark:text-umber-300">
                        {t("venue.space_capacity_n", { n: s.capacity })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-500 dark:text-umber-300">
                    {[
                      ...s.uses.map((u) => t(`venue.space_use.${u}`)),
                      s.setting ? t(`venue.space_setting.${s.setting}`) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {s.description && (
                    <p className="text-sm text-ink-700 dark:text-umber-100">{s.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {s.fee === "included" && (
                      <span className={CHIP}>{t("venue.space_fee_included")}</span>
                    )}
                    {s.fee === "extra" && (
                      <span className={CHIP}>
                        {s.fee_amount !== null
                          ? t("venue.space_fee_extra_n", {
                              amount: formatMoney(s.fee_amount, currency, locale),
                            })
                          : t("venue.space_fee_extra")}
                      </span>
                    )}
                    {s.weather_backup && (
                      <span className={`${CHIP} gap-1`}>
                        <CloudRain size={12} strokeWidth={1.5} aria-hidden />
                        {t("venue.space_weather_backup")}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── Catering, drinks, suppliers ────────────────────────────────────────────

export function VenueRulesSection({ id, venue, t }: { id: string; venue: VenueDetail; t: T }) {
  const p = venue.profile;
  const blocks: { title: string; items: string[]; note?: string | null }[] = [
    {
      title: t("venue.catering_label"),
      items: p.catering.map((k) => t(`venue.catering.${k}`)),
      note: p.catering_partners
        ? t("venue.catering_partners_line", { partners: p.catering_partners })
        : null,
    },
    { title: t("venue.drinks_label"), items: p.drinks.map((k) => t(`venue.drinks.${k}`)) },
    {
      title: t("venue.suppliers_label"),
      items: [
        ...(p.supplier_policy ? [t(`venue.supplier_policy.${p.supplier_policy}`)] : []),
        ...p.external_allowed.map((k) => t(`venue.external.${k}`)),
      ],
    },
  ].filter((b) => b.items.length > 0 || b.note);
  if (blocks.length === 0 && !p.rules_note) return null;
  return (
    <section id={id} className="mb-12 scroll-mt-36">
      <h2 className={`${H2} mb-4`}>{t("venue.rules_title")}</h2>
      <div className="grid gap-5 sm:grid-cols-3">
        {blocks.map((b) => (
          <div key={b.title}>
            <h3 className={`${H3} mb-2`}>{b.title}</h3>
            <ul className="space-y-1 text-sm text-ink-700 dark:text-umber-100">
              {b.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            {b.note && <p className="mt-2 text-xs text-ink-500 dark:text-umber-300">{b.note}</p>}
          </div>
        ))}
      </div>
      {p.rules_note && (
        <p className="mt-4 text-sm text-ink-600 dark:text-umber-200">{p.rules_note}</p>
      )}
    </section>
  );
}

// ── Rates + estimate ───────────────────────────────────────────────────────

function lineValue(
  line: VenueEstimateLine,
  currency: Currency,
  locale: Locale,
  t: T,
): { text: string; highlight: boolean } {
  switch (line.status) {
    case "charged":
      return { text: formatMoney(line.subtotal ?? 0, currency, locale), highlight: false };
    case "free":
      return { text: t("venue.status.free"), highlight: true };
    case "included":
      return { text: t("venue.status.included"), highlight: true };
    default:
      return { text: t(`venue.status.${line.status}`), highlight: false };
  }
}

/** One rule's price items as the vendor stated them. */
function RuleItems({
  rule,
  currency,
  locale,
  t,
}: {
  rule: VenuePricingRule;
  currency: Currency;
  locale: Locale;
  t: T;
}) {
  if (!rule.available) {
    return (
      <p className="text-sm text-ink-500 dark:text-umber-300">{t("venue.rule_unavailable")}</p>
    );
  }
  return (
    <ul className="divide-y divide-paper-200 text-sm dark:divide-umber-700">
      {rule.items.map((item, i) => {
        const highlight = item.mode === "free" || item.mode === "included";
        return (
          <li key={`${item.key}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="text-ink-700 dark:text-umber-100">
              {itemLabel(item, t)}
              {item.optional && (
                <span className="ml-1.5 text-xs text-ink-400 dark:text-umber-400">
                  {t("venue.status.optional")}
                </span>
              )}
            </span>
            <span
              className={
                highlight
                  ? "font-medium text-sage-700 dark:text-sage-300"
                  : "tabular-nums text-ink-900 dark:text-paper-50"
              }
            >
              {itemPriceLabel(item, currency, locale, t)}
            </span>
          </li>
        );
      })}
      {rule.min_spend !== null && (
        <li className="flex items-baseline justify-between gap-3 py-1.5 text-ink-500 dark:text-umber-300">
          <span>{t("venue.min_spend")}</span>
          <span className="tabular-nums">{formatMoney(rule.min_spend, currency, locale)}</span>
        </li>
      )}
    </ul>
  );
}

function EstimateResult({
  match,
  guests,
  currency,
  locale,
  t,
}: {
  match: VenuePricingMatch;
  guests: number | null;
  currency: Currency;
  locale: Locale;
  t: T;
}) {
  if (match.kind === "no_rules") return null;
  if (match.kind === "no_date") {
    return (
      <p className="text-sm text-ink-500 dark:text-umber-300">{t("venue.estimate_no_date")}</p>
    );
  }
  if (match.kind === "no_match") {
    return (
      <p className="text-sm text-ink-600 dark:text-umber-200">{t("venue.estimate_no_match")}</p>
    );
  }
  if (match.kind === "unavailable") {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
        <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
        {t("venue.estimate_unavailable", { rule: match.rule.name })}
      </p>
    );
  }
  const { rule, estimate, fit, over_capacity } = match;
  const warnings: string[] = [];
  if (fit === "below_min" && rule.min_guests !== null && guests !== null) {
    warnings.push(t("venue.fit_below", { n: rule.min_guests, guests }));
  }
  if (fit === "above_max" && rule.max_guests !== null && guests !== null) {
    warnings.push(t("venue.fit_above", { n: rule.max_guests, guests }));
  }
  if (over_capacity) warnings.push(t("venue.over_capacity"));
  const total = formatMoney(estimate.total, currency, locale);
  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {rule.name} · {ruleConditionLabel(rule, locale, t)}
      </p>
      {warnings.map((w) => (
        <p
          key={w}
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          {w}
        </p>
      ))}
      <ul className="divide-y divide-paper-200 text-sm dark:divide-umber-700">
        {estimate.lines.map((line, i) => {
          const v = lineValue(line, currency, locale, t);
          return (
            <li
              key={`${line.item.key}-${i}`}
              className="flex items-baseline justify-between gap-3 py-1.5"
            >
              <span className="text-ink-700 dark:text-umber-100">
                {itemLabel(line.item, t)}
                {line.status === "charged" && line.item.mode !== "fixed" && (
                  <span className="ml-1.5 text-xs text-ink-400 dark:text-umber-400">
                    {itemPriceLabel(line.item, currency, locale, t)}
                  </span>
                )}
                {(line.status === "optional" || line.status === "refundable") &&
                  line.item.amount !== null && (
                    <span className="ml-1.5 text-xs text-ink-400 dark:text-umber-400">
                      {itemPriceLabel(line.item, currency, locale, t)}
                    </span>
                  )}
              </span>
              <span
                className={
                  v.highlight
                    ? "font-medium text-sage-700 dark:text-sage-300"
                    : line.status === "charged"
                      ? "tabular-nums text-ink-900 dark:text-paper-50"
                      : "text-xs text-ink-500 dark:text-umber-300"
                }
              >
                {v.text}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between border-t border-paper-300 pt-3 dark:border-umber-600">
        <span className="font-semibold text-ink-900 dark:text-paper-50">
          {t("venue.estimate_total")}
        </span>
        <span className="text-lg font-bold tabular-nums text-ink-900 dark:text-paper-50">
          {estimate.is_from ? t("venue.price_from", { amount: total }) : total}
        </span>
      </div>
      {estimate.min_spend_applied && rule.min_spend !== null && (
        <p className="text-xs text-ink-500 dark:text-umber-300">
          {t("venue.min_spend_applied", { amount: formatMoney(rule.min_spend, currency, locale) })}
        </p>
      )}
      <p className="text-xs text-ink-400 dark:text-umber-400">{t("venue.estimate_disclaimer")}</p>
    </div>
  );
}

export interface VenueEstimateRequest {
  date: string;
  guests: number | null;
  rule: string | null;
  total: string | null;
}

/** Date + guest-count picker with the matching rule and its breakdown. */
export function VenueEstimatePanel({
  venue,
  initialDate,
  initialGuests,
  locale,
  t,
  onRequest,
}: {
  venue: VenueDetail;
  initialDate: string | null;
  initialGuests: number | null;
  locale: Locale;
  t: T;
  onRequest?: (req: VenueEstimateRequest) => void;
}) {
  const [date, setDate] = useState(initialDate?.slice(0, 10) ?? "");
  const [guests, setGuests] = useState(initialGuests !== null ? String(initialGuests) : "");
  // The couple's own date and headcount arrive after mount; take them once
  // unless the couple has already typed something here.
  useEffect(() => {
    if (initialDate) setDate((d) => d || initialDate.slice(0, 10));
  }, [initialDate]);
  useEffect(() => {
    if (initialGuests !== null) setGuests((g) => g || String(initialGuests));
  }, [initialGuests]);

  const guestCount = guests === "" ? null : Number(guests);
  const match = matchVenuePricing(venue, { date: date || null, guests: guestCount });
  const currency = venue.currency;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label inline-flex items-center gap-1.5">
            <CalendarDays size={14} strokeWidth={1.5} aria-hidden />
            {t("venue.estimate_date")}
          </span>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="field-label inline-flex items-center gap-1.5">
            <Users size={14} strokeWidth={1.5} aria-hidden />
            {t("venue.estimate_guests")}
          </span>
          <MoneyInput
            className="input"
            value={guests}
            onChange={(d) => setGuests(d.slice(0, 5))}
            locale={locale}
            placeholder="100"
          />
        </label>
      </div>
      <EstimateResult match={match} guests={guestCount} currency={currency} locale={locale} t={t} />
      {onRequest && match.kind !== "no_rules" && (
        <button
          type="button"
          className="btn-accent w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() =>
            onRequest({
              date,
              guests: guestCount,
              rule:
                match.kind === "priced" || match.kind === "unavailable" ? match.rule.name : null,
              total:
                match.kind === "priced"
                  ? formatMoney(match.estimate.total, currency, locale)
                  : null,
            })
          }
          disabled={!date}
        >
          {t("venue.request_offer")}
        </button>
      )}
    </div>
  );
}

export function VenueRatesSection({
  id,
  venue,
  initialDate,
  initialGuests,
  locale,
  t,
  onRequest,
}: {
  id: string;
  venue: VenueDetail;
  initialDate: string | null;
  initialGuests: number | null;
  locale: Locale;
  t: T;
  onRequest?: (req: VenueEstimateRequest) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (venue.pricing_rules.length === 0) return null;
  return (
    <section id={id} className="mb-12 scroll-mt-36">
      <h2 className={H2}>{t("venue.rates_title")}</h2>
      <p className="mb-4 mt-1 text-sm text-ink-500 dark:text-umber-300">
        {t("venue.rates_subtitle")}
      </p>
      <div className="rounded-2xl border border-paper-200 p-4 sm:p-5 dark:border-umber-700">
        <VenueEstimatePanel
          venue={venue}
          initialDate={initialDate}
          initialGuests={initialGuests}
          locale={locale}
          t={t}
          onRequest={onRequest}
        />
      </div>
      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        aria-expanded={showAll}
        className="mt-4 text-sm font-medium text-ink-700 underline decoration-ink-300 underline-offset-2 dark:text-umber-100"
      >
        {showAll
          ? t("venue.all_rates_hide")
          : t("venue.all_rates", { n: venue.pricing_rules.length })}
      </button>
      {showAll && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {venue.pricing_rules.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border border-paper-200 p-4 dark:border-umber-700"
            >
              <div className="mb-2">
                <h3 className={H3}>{r.name}</h3>
                <p className="text-xs text-ink-500 dark:text-umber-300">
                  {ruleConditionLabel(r, locale, t)}
                </p>
              </div>
              <RuleItems rule={r} currency={venue.currency} locale={locale} t={t} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
