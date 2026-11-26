// "Your list" as a table: every supplier the couple has picked, one row each.
//
// For a venue the columns are what it provides (accommodation, parking, catering,
// drinks...) and its price for the couple's own date and headcount. A venue that
// has not answered a question shows a dash, never a "no": the table only says no
// where the venue has said something.
//
// Each row with something to break down can open it underneath: what the price
// covers. For a venue that is one line per item (catering, 17 000 Ft; accommodation,
// included; drinks, to be asked). For anyone else it is one line per package, with
// the package's own description (its photo count, its hours).

import type { PickTable, PickTableLine, PickTableRow } from "@shared/picks";
import { VENUE_FACILITIES } from "@shared/venue";
import { Check, ChevronDown, Minus } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { picksApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";

const DASH = "–";

type Currency = "HUF" | "EUR" | "USD";
type Locale = "hu" | "en";
type TFn = (key: string, vars?: Record<string, string | number>) => string;

function PriceCell({
  row,
  currency,
  locale,
  t,
}: {
  row: PickTableRow;
  currency: Currency;
  locale: Locale;
  t: TFn;
}) {
  if (!row.price) return <span className="text-ink-400 dark:text-umber-400">{DASH}</span>;
  const p = row.price;
  if (p.kind !== "priced") {
    return (
      <span className="text-xs text-ink-500 dark:text-umber-300">
        {t(`suppliers.table.reason_${p.kind}`)}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium text-ink-900 dark:text-paper-50">
        {p.is_from ? `${t("suppliers.table.price_from")} ` : ""}
        {formatMoney(p.total, currency, locale)}
      </span>
      {p.over_capacity && (
        <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-300">
          {t("suppliers.table.over_capacity")}
        </span>
      )}
    </span>
  );
}

function Answer({ row, facility, t }: { row: PickTableRow; facility: string; t: TFn }) {
  const v = row.venue;
  if (!v) return null;
  if (!v.has_profile) {
    return (
      <span className="text-ink-400 dark:text-umber-400" aria-label={t("suppliers.table.unknown")}>
        {DASH}
      </span>
    );
  }
  if (v.facilities.includes(facility)) {
    return (
      <Check
        size={16}
        strokeWidth={1.5}
        className="text-sage-700 dark:text-sage-300"
        aria-label={t("suppliers.table.yes")}
      />
    );
  }
  // Said something about facilities, and this one was not among them.
  if (v.facilities.length > 0) {
    return (
      <Minus
        size={16}
        strokeWidth={1.5}
        className="text-ink-400 dark:text-umber-400"
        aria-label={t("suppliers.table.no")}
      />
    );
  }
  return (
    <span className="text-ink-400 dark:text-umber-400" aria-label={t("suppliers.table.unknown")}>
      {DASH}
    </span>
  );
}

/** A breakdown line's name: a venue item's label, or the package's own name. */
function lineLabel(line: PickTableLine, tRaw: (key: string) => string): string {
  if (!line.item || line.item === "custom") return line.label;
  return line.label || tRaw(`venue.item.${line.item}`);
}

function BreakdownLine({
  line,
  currency,
  locale,
  tRaw,
  t,
}: {
  line: PickTableLine;
  currency: Currency;
  locale: Locale;
  tRaw: (key: string) => string;
  t: TFn;
}) {
  const badge =
    line.provided === "yes"
      ? "text-sage-700 dark:text-sage-300"
      : line.provided === "no"
        ? "text-ink-500 dark:text-umber-300"
        : "text-amber-700 dark:text-amber-300";
  let amount = DASH;
  if (line.amount !== null) {
    amount = formatMoney(line.amount, currency, locale);
    if (line.amount_max !== null) {
      amount = `${amount} – ${formatMoney(line.amount_max, currency, locale)}`;
    }
    if (line.per === "per_person") amount = `${amount} ${t("suppliers.table.per_person")}`;
  } else if (line.provided === "yes") {
    amount = t("suppliers.table.included");
  }
  const note = line.note_key ? t(`suppliers.table.note_${line.note_key}`) : null;
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
      <span className="w-64 shrink-0 text-sm font-medium text-ink-900 dark:text-paper-50">
        {lineLabel(line, tRaw)}
        {note && (
          <span className="ml-2 text-xs font-normal text-ink-500 dark:text-umber-300">{note}</span>
        )}
      </span>
      <span className={`text-xs font-medium uppercase tracking-wide ${badge}`}>
        {t(`suppliers.table.provided_${line.provided}`)}
      </span>
      <span className="whitespace-nowrap text-sm text-ink-800 dark:text-paper-100">{amount}</span>
      {line.description && (
        <span className="basis-full text-xs text-ink-500 dark:text-umber-300">
          {line.description}
        </span>
      )}
    </li>
  );
}

export function SupplierPicksTable({
  refreshKey,
}: {
  /** Changes whenever the couple's picks change, so the table re-reads them. */
  refreshKey: string;
}) {
  const { t: tRaw, locale } = useT();
  const t: TFn = (key, vars) => tRaw(key as never, vars as never) as string;
  const tr = (key: string) => tRaw(key as never) as string;
  const [data, setData] = useState<PickTable | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    picksApi
      .table()
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (failed) {
    return (
      <p className="py-10 text-center text-sm text-ink-500 dark:text-umber-300">
        {t("suppliers.table.error")}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="py-10 text-center text-sm text-ink-500 dark:text-umber-300">
        {t("suppliers.table.loading")}
      </p>
    );
  }
  if (data.rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-500 dark:text-umber-300">
        {t("suppliers.table.empty")}
      </p>
    );
  }

  const currency = data.currency as Currency;
  const loc = locale as Locale;
  const hasVenue = data.rows.some((r) => r.category === "venue");
  const columns = 3 + (hasVenue ? 3 + VENUE_FACILITIES.length : 0);
  const th =
    "whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300";
  const td = "px-3 py-3 align-middle text-sm text-ink-800 dark:text-paper-100";

  function toggle(id: string) {
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section
      aria-label={t("suppliers.table.title")}
      className="overflow-x-auto rounded-2xl border border-paper-200 bg-paper-50 dark:border-umber-700 dark:bg-umber-800"
    >
      <table className="w-full min-w-[40rem] border-collapse">
        <thead className="border-b border-paper-200 dark:border-umber-700">
          <tr>
            <th scope="col" className={`${th} sticky left-0 bg-paper-50 dark:bg-umber-800`}>
              {t("suppliers.table.vendor")}
            </th>
            <th scope="col" className={th}>
              {t("suppliers.table.price")}
            </th>
            <th scope="col" className={th}>
              {t("suppliers.table.planned")}
            </th>
            {hasVenue && (
              <th scope="col" className={th}>
                {t("suppliers.table.seats")}
              </th>
            )}
            {hasVenue &&
              VENUE_FACILITIES.map((f) => (
                <th scope="col" key={f} className={th}>
                  {tr(`venue.facility.${f}`)}
                </th>
              ))}
            {hasVenue && (
              <th scope="col" className={th}>
                {tr("venue.catering_label")}
              </th>
            )}
            {hasVenue && (
              <th scope="col" className={th}>
                {tr("venue.drinks_label")}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-200 dark:divide-umber-700">
          {data.rows.map((row) => {
            const expanded = open.has(row.supplier_id);
            const hasBreakdown = row.breakdown !== null && row.breakdown.length > 0;
            return (
              <Fragment key={row.supplier_id}>
                <tr data-supplier-id={row.supplier_id}>
                  <td className={`${td} sticky left-0 bg-paper-50 dark:bg-umber-800`}>
                    <div className="flex min-w-[12rem] items-start gap-2">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium text-ink-900 dark:text-paper-50">
                          {row.name}
                        </span>
                        <span className="text-xs text-ink-500 dark:text-umber-300">
                          {tr(`suppliers.cat.${row.category}`)}
                          {row.city ? ` · ${row.city}` : ""}
                          {row.role === "extra" ? ` · ${t("suppliers.table.role_extra")}` : ""}
                        </span>
                      </div>
                      {hasBreakdown && (
                        <button
                          type="button"
                          onClick={() => toggle(row.supplier_id)}
                          aria-expanded={expanded}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-paper-300 px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:border-ink-500 dark:border-umber-600 dark:text-paper-100 dark:hover:border-umber-500"
                        >
                          {expanded
                            ? t("suppliers.table.hide_breakdown")
                            : t("suppliers.table.show_breakdown")}
                          <ChevronDown
                            size={12}
                            aria-hidden
                            className={expanded ? "rotate-180 transition" : "transition"}
                          />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={td}>
                    <PriceCell row={row} currency={currency} locale={loc} t={t} />
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {row.planned !== null ? formatMoney(row.planned, currency, loc) : DASH}
                  </td>
                  {hasVenue && (
                    <td className={td}>
                      {row.venue?.max_seated != null ? row.venue.max_seated : DASH}
                    </td>
                  )}
                  {hasVenue &&
                    VENUE_FACILITIES.map((f) => (
                      <td key={f} className={`${td} text-center`}>
                        {row.category === "venue" ? <Answer row={row} facility={f} t={t} /> : null}
                      </td>
                    ))}
                  {hasVenue && (
                    <td className={td}>
                      {row.venue && row.venue.catering.length > 0
                        ? row.venue.catering.map((c) => tr(`venue.catering.${c}`)).join(", ")
                        : DASH}
                    </td>
                  )}
                  {hasVenue && (
                    <td className={td}>
                      {row.venue && row.venue.drinks.length > 0
                        ? row.venue.drinks.map((d) => tr(`venue.drinks.${d}`)).join(", ")
                        : DASH}
                    </td>
                  )}
                </tr>
                {expanded && hasBreakdown && (
                  <tr className="bg-paper-100/60 dark:bg-umber-900/40">
                    <td colSpan={columns} className="px-4 py-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
                        {t("suppliers.table.breakdown_title")}
                      </p>
                      <ul className="divide-y divide-paper-200 dark:divide-umber-700">
                        {(row.breakdown ?? []).map((line, i) => (
                          <BreakdownLine
                            key={`${line.item ?? line.label}-${i}`}
                            line={line}
                            currency={currency}
                            locale={loc}
                            tRaw={tr}
                            t={t}
                          />
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
