// Wedding cake & drinks calculator. Surfaced from the suppliers directory when
// a food/drink category (cake_dessert, bar_drinks, catering) is selected. The
// figures and per-person portions mirror the "Esküvői süti és ital kalkulátor"
// spreadsheet by Cilinderesek: guest count + per-head portions + a safety
// buffer drive the quantities, the couple fills in unit prices, totals follow.
//
// The calculation is couple-wide (it depends on the guest count, not on any one
// supplier), so a single shared instance is opened from the category header.

import type { Currency } from "@shared/types";
import { Check, Minus, Pencil, Plus } from "lucide-react";
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

/** Row key → its item-label i18n key under suppliers.calc. Lets the onboarding
 *  chips reuse the same labels the receipt rows show. */
const ITEM_LABEL_KEY: Record<string, string> = {
  sweet: "item_sweet_pastry",
  savory: "item_savory_pastry",
  cake: "item_cake",
  spirits: "item_spirits",
  wine: "item_wine",
  champagne: "item_champagne",
  beer: "item_beer",
};

/** The mini onboarding question series shown before the calculator. Each step
 *  asks the couple which items they'll actually serve; anything they leave
 *  unchecked lands in `excluded` and computes as 0 (e.g. "no beer" → beer 0). */
const ONB_QUESTIONS: { titleKey: string; keys: string[] }[] = [
  { titleKey: "onb_drinks_q", keys: ["spirits", "wine", "champagne", "beer"] },
  { titleKey: "onb_sweets_q", keys: ["sweet", "savory", "cake"] },
];

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
  // Row keys the couple struck out (tapped the item name, or unchecked in the
  // onboarding) — their total counts as 0 and they drop out of every subtotal.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  // Index into ONB_QUESTIONS while the mini onboarding runs; once it reaches the
  // question count the calculator itself is shown.
  const [onbStep, setOnbStep] = useState<number>(0);

  // Reset to fresh defaults each time the modal opens, so a new guest count or
  // currency from the page is picked up.
  useEffect(() => {
    if (open) {
      setFields(initialFields(currency, defaultGuests));
      setEditingRow(null);
      setExcluded(new Set());
      setOnbStep(0);
    }
  }, [open, currency, defaultGuests]);

  function set(key: FieldKey, value: string) {
    setFields((cur) => ({ ...cur, [key]: value }));
  }

  function toggleExcluded(key: string) {
    setExcluded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
      // Struck-out rows count as 0 in their subtotal and the grand total.
      total: excluded.has(key) ? 0 : Math.round(qty * num(fields[priceField])),
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
  }, [fields, excluded]);

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

  // Bump the guest count by a step from the stepper buttons, clamped at 0.
  const stepGuests = (delta: number) =>
    set("guests", String(Math.max(0, Math.round(num(fields.guests)) + delta)));

  // One receipt-style line item: name on top (tap to strike out), and below it
  // the editable "quantity × unit price" that drives the line total on the right.
  const renderRow = (r: Row) => {
    const itemLabel = t(`suppliers.calc.${r.labelKey}`);
    const isEditing = editingRow === r.key;
    const isExcluded = excluded.has(r.key);
    return (
      <div key={r.key} className="py-3 first:pt-1 last:pb-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Tap the item name to strike it out — its total drops to 0. */}
            <button
              type="button"
              onClick={() => toggleExcluded(r.key)}
              aria-pressed={isExcluded}
              title={t("suppliers.calc.item_toggle_hint")}
              className={`text-left text-sm font-medium ${
                isExcluded
                  ? "text-ink-400 line-through dark:text-umber-400"
                  : "text-ink-900 dark:text-paper-50"
              }`}
            >
              {itemLabel}
            </button>
            <div
              className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 ${
                isExcluded ? "opacity-40" : ""
              }`}
            >
              {/* Tap the quantity to fine-tune the per-head portion(s) inline. */}
              <button
                type="button"
                onClick={() => setEditingRow(isEditing ? null : r.key)}
                aria-expanded={isEditing}
                aria-label={`${itemLabel}: ${t("suppliers.calc.qty_edit_hint")}`}
                title={t("suppliers.calc.qty_edit_hint")}
                className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2.5 py-1 text-xs font-medium tabular-nums text-ink-700 hover:bg-paper-200 dark:bg-umber-700/60 dark:text-paper-100 dark:hover:bg-umber-700"
              >
                {qtyFmt.format(r.qty)} {t(`suppliers.calc.${r.unitKey}`)}
                <Pencil size={11} className="text-ink-400 dark:text-umber-300" aria-hidden />
              </button>
              <span className="text-ink-300 dark:text-umber-500" aria-hidden>
                &times;
              </span>
              <div className="inline-flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  aria-label={`${itemLabel}: ${t("suppliers.calc.col_unit_price")}`}
                  className="input !py-1 w-20 text-right text-sm"
                  value={fields[r.priceField]}
                  onChange={(e) => set(r.priceField, e.target.value)}
                />
                <span className="text-xs text-ink-500 dark:text-umber-300">{symbol}</span>
              </div>
            </div>
          </div>
          <div
            className={`shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50 ${
              isExcluded ? "opacity-40" : ""
            }`}
          >
            {formatMoney(r.total, currency, loc)}
          </div>
        </div>
        {isEditing && (
          <div className="mt-2 rounded-xl bg-paper-100/70 px-3 py-2.5 dark:bg-umber-700/40">
            <div className="flex flex-wrap items-end gap-3">
              <span className="self-center text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("suppliers.calc.qty_edit_hint")}
              </span>
              {r.portions.map((pf) => (
                <Fragment key={pf}>
                  {numField(pf, t(`suppliers.calc.${PORTION_LABEL_KEY[pf] ?? ""}`), "any", "w-28")}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // A grouped card (sweets / cake / drinks) with its running subtotal in the head.
  const renderSection = (titleKey: string, subtotal: number, rows: Row[]) => (
    <div className="overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700">
      <div className="flex items-center justify-between border-b border-paper-200 bg-paper-100/60 px-4 py-2.5 dark:border-umber-700 dark:bg-umber-700/30">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-600 dark:text-umber-200">
          {t(`suppliers.calc.${titleKey}`)}
        </span>
        <span className="text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
          {formatMoney(subtotal, currency, loc)}
        </span>
      </div>
      <div className="divide-y divide-paper-200 px-4 dark:divide-umber-700/60">
        {rows.map(renderRow)}
      </div>
    </div>
  );

  // A buffer (%) card with the value shown big and a trailing percent glyph.
  const bufferCard = (key: FieldKey, label: string) => (
    <div className="rounded-2xl border border-paper-200 px-4 py-3 dark:border-umber-700">
      <span className="block text-xs font-medium text-ink-500 dark:text-umber-300">{label}</span>
      <div className="mt-1.5 flex items-baseline gap-1">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className="w-full min-w-0 bg-transparent text-lg font-semibold tabular-nums text-ink-900 focus:outline-none dark:text-paper-50"
          value={fields[key]}
          onChange={(e) => set(key, e.target.value)}
        />
        <span className="text-base font-semibold text-ink-400 dark:text-umber-300">%</span>
      </div>
    </div>
  );

  // The mini onboarding screen for the current step: a selectable chip per item.
  // Checked = served (counted); unchecked = excluded → that line computes as 0.
  const onboarding = onbStep < ONB_QUESTIONS.length;
  const question = ONB_QUESTIONS[onbStep];
  const renderOnboarding = () =>
    question && (
      <div className="space-y-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400 dark:text-umber-300">
          {ONB_QUESTIONS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === onbStep
                  ? "w-5 bg-ink-800 dark:bg-paper-100"
                  : "w-1.5 bg-paper-300 dark:bg-umber-600"
              }`}
            />
          ))}
          <span className="ml-1 tabular-nums">
            {onbStep + 1} / {ONB_QUESTIONS.length}
          </span>
        </span>
        <h3 className="font-grotesk text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t(`suppliers.calc.${question.titleKey}`)}
        </h3>
        <p className="text-sm text-ink-500 dark:text-umber-300">{t("suppliers.calc.onb_hint")}</p>
        <div className="flex flex-wrap gap-2">
          {question.keys.map((k) => {
            const served = !excluded.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleExcluded(k)}
                aria-pressed={served}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  served
                    ? "border-ink-800 bg-ink-800 text-paper-50 dark:border-umber-400 dark:bg-umber-900"
                    : "border-paper-300 text-ink-500 hover:bg-paper-100 dark:border-umber-600 dark:text-umber-300 dark:hover:bg-umber-700/50"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    served
                      ? "border-paper-50 bg-paper-50/20"
                      : "border-paper-400 dark:border-umber-500"
                  }`}
                >
                  {served && <Check size={11} strokeWidth={3} aria-hidden />}
                </span>
                {t(`suppliers.calc.${ITEM_LABEL_KEY[k] ?? ""}`)}
              </button>
            );
          })}
        </div>
      </div>
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
        onboarding ? (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => (onbStep > 0 ? setOnbStep(onbStep - 1) : onClose())}
            >
              {t(onbStep > 0 ? "suppliers.calc.onb_back" : "suppliers.calc.close")}
            </Button>
            <Button type="button" variant="primary" onClick={() => setOnbStep(onbStep + 1)}>
              {t(
                onbStep === ONB_QUESTIONS.length - 1
                  ? "suppliers.calc.onb_done"
                  : "suppliers.calc.onb_next",
              )}
            </Button>
          </>
        ) : (
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
        )
      }
    >
      {onboarding ? (
        renderOnboarding()
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("suppliers.calc.intro")}</p>

          {/* Headline inputs: guest count (with stepper) + the two safety buffers. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-paper-200 px-4 py-3 dark:border-umber-700">
              <span className="block text-xs font-medium text-ink-500 dark:text-umber-300">
                {t("suppliers.calc.guests_label")}
              </span>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => stepGuests(-1)}
                  aria-label="-1"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-paper-300 text-ink-600 hover:bg-paper-100 dark:border-umber-600 dark:text-umber-200 dark:hover:bg-umber-700"
                >
                  <Minus size={15} aria-hidden />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="w-full min-w-0 bg-transparent text-center text-lg font-semibold tabular-nums text-ink-900 focus:outline-none dark:text-paper-50"
                  value={fields.guests}
                  onChange={(e) => set("guests", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => stepGuests(1)}
                  aria-label="+1"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-paper-300 text-ink-600 hover:bg-paper-100 dark:border-umber-600 dark:text-umber-200 dark:hover:bg-umber-700"
                >
                  <Plus size={15} aria-hidden />
                </button>
              </div>
            </div>
            {bufferCard("sweetsBuffer", t("suppliers.calc.sweets_buffer_label"))}
            {bufferCard("drinksBuffer", t("suppliers.calc.drinks_buffer_label"))}
          </div>

          {/* Item lines grouped sweets / cake / drinks, each card carrying its subtotal. */}
          {renderSection("subtotal_sweets", sweetsTotal, sweets)}
          {renderSection("subtotal_cake", cakeTotal, cake)}
          {renderSection("subtotal_drinks", drinksTotal, drinks)}

          {/* Fare-estimate-style grand total. */}
          <div className="flex items-center justify-between rounded-2xl bg-ink-900 px-5 py-4 dark:bg-umber-900">
            <span className="text-sm font-semibold uppercase tracking-wide text-paper-200 dark:text-umber-200">
              {t("suppliers.calc.grand_total")}
            </span>
            <span className="text-2xl font-bold tabular-nums text-paper-50">
              {formatMoney(grandTotal, currency, loc)}
            </span>
          </div>

          <p className="rounded-xl bg-paper-100 px-3 py-2 text-xs text-ink-500 dark:bg-umber-700/60 dark:text-umber-300">
            {t("suppliers.calc.note")}
          </p>
        </div>
      )}
    </Dialog>
  );
}
