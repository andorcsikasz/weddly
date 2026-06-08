// Wedding cake & drinks calculator. Surfaced from the suppliers directory when
// a food/drink category (cake_dessert, bar_drinks, catering) is selected. The
// figures and per-person portions mirror the "Esküvői süti és ital kalkulátor"
// spreadsheet by Cilinderesek: guest count + per-head portions + a safety
// buffer drive the quantities, the couple fills in unit prices, totals follow.
//
// The calculation is couple-wide (it depends on the guest count, not on any one
// supplier), so a single shared instance is opened from the category header.

import type { Currency } from "@shared/types";
import { Calculator, Pencil } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { currencySymbol, formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";
import { Button, Dialog } from "./ui";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Couple's display currency — drives the price symbol + total formatting. */
  currency?: Currency;
  /** Seeds the guest-count field. Falls back to 70 (the spreadsheet's sample)
   *  when the couple hasn't pinned a guest count yet. */
  defaultGuests?: number | null;
};

/** A wine bottle is 0.75 l — the divisor that turns "litres of wine" into
 *  "bottles to buy". The spreadsheet bakes this constant into the bor row. */
const WINE_BOTTLE_L = 0.75;

/** Every editable field, stored as the raw string the user typed so clearing a
 *  cell to retype doesn't snap back to 0. Parsed with {@link num} on compute. */
type FieldKey =
  | "guests"
  | "sweetsBuffer"
  | "drinksBuffer"
  | "pSweet"
  | "pSavory"
  | "pCake"
  | "pSpirits"
  | "pWine"
  | "pChampagne"
  | "pBeerMugs"
  | "pBeerMugSize"
  | "priceSweet"
  | "priceSavory"
  | "priceCake"
  | "priceSpirits"
  | "priceWine"
  | "priceChampagne"
  | "priceBeer";

type Fields = Record<FieldKey, string>;

/** Per-person portions + buffers. Universal defaults (kg, litres, slices,
 *  bottles per head) — these read the same in any currency. */
const PORTION_DEFAULTS = {
  sweetsBuffer: "10",
  drinksBuffer: "10",
  pSweet: "0.1",
  pSavory: "0.2",
  pCake: "0.8",
  pSpirits: "0.2",
  pWine: "0.45",
  pChampagne: "0.17",
  pBeerMugs: "2",
  pBeerMugSize: "0.5",
} as const;

/** Sample unit prices from the spreadsheet, in Forint. Only seeded for HUF
 *  couples — for any other currency the magnitudes would be nonsense, so we
 *  start those blank and let the couple fill their own market prices in. */
const PRICE_DEFAULTS_HUF = {
  priceSweet: "4500",
  priceSavory: "4500",
  priceCake: "1500",
  priceSpirits: "5000",
  priceWine: "2800",
  priceChampagne: "4000",
  priceBeer: "700",
} as const;

function initialFields(currency: Currency, defaultGuests: number | null | undefined): Fields {
  const guests =
    defaultGuests && Number.isFinite(defaultGuests) && defaultGuests > 0
      ? String(Math.round(defaultGuests))
      : "70";
  const blankPrices = {
    priceSweet: "",
    priceSavory: "",
    priceCake: "",
    priceSpirits: "",
    priceWine: "",
    priceChampagne: "",
    priceBeer: "",
  };
  return {
    guests,
    ...PORTION_DEFAULTS,
    ...(currency === "HUF" ? PRICE_DEFAULTS_HUF : blankPrices),
  };
}

/** Parse a field to a non-negative number, treating blanks/garbage as 0. */
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Per-head portion field → its i18n label key under suppliers.calc. Drives the
 *  inline editor that opens when a quantity cell is tapped. */
const PORTION_LABEL_KEY: Partial<Record<FieldKey, string>> = {
  pSweet: "portion_sweet",
  pSavory: "portion_savory",
  pCake: "portion_cake",
  pSpirits: "portion_spirits",
  pWine: "portion_wine",
  pChampagne: "portion_champagne",
  pBeerMugs: "portion_beer_mugs",
  pBeerMugSize: "portion_beer_mug_size",
};

interface Row {
  key: string;
  /** i18n key under suppliers.calc for the item label. */
  labelKey: string;
  qty: number;
  /** Unit i18n key under suppliers.calc (unit_kg, unit_liter, …). */
  unitKey: string;
  priceField: FieldKey;
  /** Per-head portion field(s) that drive this row's quantity. Surfaced in the
   *  inline editor when the quantity cell is tapped. */
  portions: FieldKey[];
  total: number;
}

export function CakeDrinksCalculator({ open, onClose, currency = "HUF", defaultGuests }: Props) {
  const { t, locale } = useT();
  const loc = locale === "hu" ? "hu" : "en";
  const [fields, setFields] = useState<Fields>(() => initialFields(currency, defaultGuests));
  // Which row's per-head portion editor is open (tapped quantity), if any.
  const [editingRow, setEditingRow] = useState<string | null>(null);

  // Reset to fresh defaults each time the modal opens, so a new guest count or
  // currency from the page is picked up.
  useEffect(() => {
    if (open) {
      setFields(initialFields(currency, defaultGuests));
      setEditingRow(null);
    }
  }, [open, currency, defaultGuests]);

  function set(key: FieldKey, value: string) {
    setFields((cur) => ({ ...cur, [key]: value }));
  }

  const { sweets, cake, drinks, sweetsTotal, cakeTotal, drinksTotal, grandTotal } = useMemo(() => {
    const guests = num(fields.guests);
    const sweetsMul = 1 + num(fields.sweetsBuffer) / 100;
    const drinksMul = 1 + num(fields.drinksBuffer) / 100;

    const qtySweet = guests * num(fields.pSweet) * sweetsMul;
    const qtySavory = guests * num(fields.pSavory) * sweetsMul;
    const qtyCake = guests * num(fields.pCake); // no buffer on cake slices
    const qtySpirits = guests * num(fields.pSpirits) * drinksMul;
    const qtyWine = (guests * num(fields.pWine) * drinksMul) / WINE_BOTTLE_L;
    const qtyChampagne = guests * num(fields.pChampagne) * drinksMul;
    const qtyBeer = guests * num(fields.pBeerMugs) * num(fields.pBeerMugSize) * drinksMul;

    const mk = (
      key: string,
      labelKey: string,
      qty: number,
      unitKey: string,
      priceField: FieldKey,
      portions: FieldKey[],
    ): Row => ({
      key,
      labelKey,
      qty,
      unitKey,
      priceField,
      portions,
      total: Math.round(qty * num(fields[priceField])),
    });

    const sweets: Row[] = [
      mk("sweet", "item_sweet_pastry", qtySweet, "unit_kg", "priceSweet", ["pSweet"]),
      mk("savory", "item_savory_pastry", qtySavory, "unit_kg", "priceSavory", ["pSavory"]),
    ];
    const cake: Row[] = [mk("cake", "item_cake", qtyCake, "unit_slice", "priceCake", ["pCake"])];
    const drinks: Row[] = [
      mk("spirits", "item_spirits", qtySpirits, "unit_liter", "priceSpirits", ["pSpirits"]),
      mk("wine", "item_wine", qtyWine, "unit_bottle", "priceWine", ["pWine"]),
      mk("champagne", "item_champagne", qtyChampagne, "unit_bottle", "priceChampagne", [
        "pChampagne",
      ]),
      mk("beer", "item_beer", qtyBeer, "unit_liter", "priceBeer", ["pBeerMugs", "pBeerMugSize"]),
    ];

    const sum = (rows: Row[]) => rows.reduce((a, r) => a + r.total, 0);
    const sweetsTotal = sum(sweets);
    const cakeTotal = sum(cake);
    const drinksTotal = sum(drinks);
    return {
      sweets,
      cake,
      drinks,
      sweetsTotal,
      cakeTotal,
      drinksTotal,
      grandTotal: sweetsTotal + cakeTotal + drinksTotal,
    };
  }, [fields]);

  const symbol = currencySymbol(currency, loc);
  // Quantities (kg, litres, bottles) carry a meaningful decimal — 7.7 kg, 46.2
  // bottles — so unlike money they're shown to one fractional digit.
  const qtyFmt = new Intl.NumberFormat(loc === "hu" ? "hu-HU" : "en-GB", {
    maximumFractionDigits: 1,
  });

  // Compact number input cell. step="any" lets the portions take decimals.
  const numField = (key: FieldKey, label: string, step = "any", width = "w-full") => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        className={`input !py-1.5 text-sm ${width}`}
        value={fields[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );

  const renderRows = (rows: Row[]) =>
    rows.map((r) => {
      const itemLabel = t(`suppliers.calc.${r.labelKey}`);
      const isEditing = editingRow === r.key;
      return (
        <Fragment key={r.key}>
          <tr className="border-t border-paper-200 dark:border-umber-700">
            <td className="py-2 pr-2 text-ink-800 dark:text-paper-100">{itemLabel}</td>
            <td className="py-1.5 px-2 text-right">
              {/* Tap the quantity to fine-tune the per-head portion(s) inline. */}
              <button
                type="button"
                onClick={() => setEditingRow(isEditing ? null : r.key)}
                aria-expanded={isEditing}
                aria-label={`${itemLabel} — ${t("suppliers.calc.qty_edit_hint")}`}
                title={t("suppliers.calc.qty_edit_hint")}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700/60"
              >
                <span className="border-b border-dashed border-ink-300 dark:border-umber-400">
                  {qtyFmt.format(r.qty)}{" "}
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    {t(`suppliers.calc.${r.unitKey}`)}
                  </span>
                </span>
                <Pencil size={11} className="text-ink-400 dark:text-umber-300" aria-hidden />
              </button>
            </td>
            <td className="py-1.5 px-2">
              <div className="flex items-center justify-end gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  aria-label={`${itemLabel} — ${t("suppliers.calc.col_unit_price")}`}
                  className="input !py-1 w-24 text-right text-sm"
                  value={fields[r.priceField]}
                  onChange={(e) => set(r.priceField, e.target.value)}
                />
                <span className="text-xs text-ink-500 dark:text-umber-300">{symbol}</span>
              </div>
            </td>
            <td className="py-2 pl-2 text-right tabular-nums font-medium text-ink-900 dark:text-paper-50">
              {formatMoney(r.total, currency, loc)}
            </td>
          </tr>
          {isEditing && (
            <tr className="bg-paper-100/60 dark:bg-umber-700/40">
              <td colSpan={4} className="px-2 pb-3 pt-1">
                <div className="flex flex-wrap items-end gap-3">
                  <span className="self-center text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
                    {t("suppliers.calc.qty_edit_hint")}
                  </span>
                  {r.portions.map((pf) => (
                    <Fragment key={pf}>
                      {numField(
                        pf,
                        t(`suppliers.calc.${PORTION_LABEL_KEY[pf] ?? ""}`),
                        "any",
                        "w-28",
                      )}
                    </Fragment>
                  ))}
                </div>
              </td>
            </tr>
          )}
        </Fragment>
      );
    });

  const subtotalRow = (labelKey: string, value: number) => (
    <tr className="border-t border-paper-300 dark:border-umber-600 bg-paper-100/60 dark:bg-umber-700/40">
      <td
        colSpan={3}
        className="py-1.5 pr-2 text-xs font-medium uppercase tracking-wide text-ink-600 dark:text-umber-200"
      >
        {t(`suppliers.calc.${labelKey}`)}
      </td>
      <td className="py-1.5 pl-2 text-right tabular-nums font-semibold text-ink-900 dark:text-paper-50">
        {formatMoney(value, currency, loc)}
      </td>
    </tr>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      role="dialog"
      size="lg"
      title={t("suppliers.calc.title")}
      closeOnBackdrop
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setFields(initialFields(currency, defaultGuests))}
          >
            {t("suppliers.calc.reset")}
          </Button>
          <Button type="button" variant="primary" onClick={onClose}>
            {t("suppliers.calc.close")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-ink-500 dark:text-umber-300">{t("suppliers.calc.intro")}</p>

        {/* Headline inputs: guest count + the two safety buffers. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {numField("guests", t("suppliers.calc.guests_label"), "1")}
          {numField("sweetsBuffer", t("suppliers.calc.sweets_buffer_label"), "1")}
          {numField("drinksBuffer", t("suppliers.calc.drinks_buffer_label"), "1")}
        </div>

        {/* Quantities + prices + totals, grouped sweets / cake / drinks. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
                <th className="pb-2 pr-2 font-medium">{t("suppliers.calc.col_item")}</th>
                <th className="pb-2 px-2 text-right font-medium">{t("suppliers.calc.col_qty")}</th>
                <th className="pb-2 px-2 text-right font-medium">
                  {t("suppliers.calc.col_unit_price")}
                </th>
                <th className="pb-2 pl-2 text-right font-medium">
                  {t("suppliers.calc.col_total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {renderRows(sweets)}
              {subtotalRow("subtotal_sweets", sweetsTotal)}
              {renderRows(cake)}
              {subtotalRow("subtotal_cake", cakeTotal)}
              {renderRows(drinks)}
              {subtotalRow("subtotal_drinks", drinksTotal)}
              <tr className="border-t-2 border-ink-700 dark:border-umber-400">
                <td
                  colSpan={3}
                  className="py-2.5 pr-2 text-sm font-semibold text-ink-900 dark:text-paper-50"
                >
                  {t("suppliers.calc.grand_total")}
                </td>
                <td className="py-2.5 pl-2 text-right tabular-nums text-base font-bold text-ink-900 dark:text-paper-50">
                  {formatMoney(grandTotal, currency, loc)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="rounded-xl bg-paper-100 dark:bg-umber-700/60 px-3 py-2 text-xs text-ink-500 dark:text-umber-300">
          {t("suppliers.calc.note")}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-ink-400 dark:text-umber-300">
          <Calculator size={12} aria-hidden />
          {t("suppliers.calc.powered_by")}
        </p>
      </div>
    </Dialog>
  );
}
