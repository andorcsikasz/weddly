// "Add to budget" for the offer the couple chose. Shows the breakdown BEFORE
// anything is written: what each line buys (venue hire, catering, drinks, a
// service charge spread over food and drink), the budget category it lands in
// (movable), the optional extras they may take, and which of their own estimate
// lines the quote replaces so the category is not counted twice.
//
// The amounts here come from the same shared module the server recomputes them
// with (`shared/offer_budget.ts`), so the preview cannot promise a number the
// budget will not hold. The server is the authority; this is the honest preview.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OFFER_BUDGET_CATEGORIES, offerBudgetBreakdown } from "@shared/offer_budget";
import type { BudgetCategory, BudgetLine, Couple } from "@shared/types";
import type { VendorOffer } from "@shared/vendor_offers";
import { ApiError } from "../lib/api";
import { guestCountBaseline, isCategoryHolderLine, isSupplierManagedLine } from "../lib/budget";
import { budgetApi, coupleApi, offerBudgetApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";
import { Button, Dialog, Skeleton, useToast } from "./ui";

/** Honeymoon has its own presets and never belongs to a vendor offer. */
const PICKABLE: readonly BudgetCategory[] = OFFER_BUDGET_CATEGORIES.filter(
  (c) => c !== "honeymoon",
);

type Props = {
  open: boolean;
  offer: VendorOffer | null;
  /** The headcount the compare page is pricing at. */
  guests: number;
  onClose: () => void;
  /** Called after the budget was changed so the page reloads the offers. */
  onChanged: () => void;
};

export function OfferBudgetDialog({ open, offer, guests, onClose, onChanged }: Props) {
  const { t, locale } = useT();
  const toast = useToast();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [lines, setLines] = useState<BudgetLine[] | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, BudgetCategory>>({});
  // Explicit ticks and un-ticks on the estimate lines. A line with no entry
  // follows the default (the budget's own category estimate is replaced).
  const [retireChoice, setRetireChoice] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offerId = offer?.id ?? null;

  // Fresh state each time the dialog opens for an offer, plus the two reads it
  // needs: the couple (baseline headcount, frozen categories, currency) and the
  // current budget lines (the estimates this quote may replace).
  useEffect(() => {
    if (!open || offerId === null) return;
    setCouple(null);
    setLines(null);
    setInclude(new Set());
    setOverrides({});
    setRetireChoice({});
    setError(null);
    let live = true;
    coupleApi
      .current()
      .then(({ couple: c }) => live && setCouple(c ?? null))
      .catch(() => undefined);
    budgetApi
      .listLines()
      .then(({ lines: l }) => live && setLines(l))
      .catch(() => live && setLines([]));
    return () => {
      live = false;
    };
  }, [open, offerId]);

  const breakdown = useMemo(
    () =>
      offer
        ? offerBudgetBreakdown(offer.payload, {
            guests,
            includeOptional: [...include],
            overrides,
          })
        : null,
    [offer, guests, include, overrides],
  );

  const touched = useMemo(
    () => new Set<BudgetCategory>((breakdown?.rows ?? []).map((r) => r.category)),
    [breakdown],
  );

  // Plain, money-free lines in a touched category: the couple's own estimates.
  const candidates = useMemo(
    () =>
      (lines ?? [])
        .filter(
          (l) =>
            touched.has(l.category) &&
            !isSupplierManagedLine(l) &&
            !l.vendor_offer_id &&
            l.planned_huf > 0 &&
            l.actual_huf === 0 &&
            l.paid_huf === 0,
        )
        .sort(
          (a, b) =>
            Number(isCategoryHolderLine(b, b.category)) -
            Number(isCategoryHolderLine(a, a.category)),
        ),
    [lines, touched],
  );

  // Estimate lines the budget started with ("Venue 1,100,000") are replaced by
  // default: that is exactly what a real quote supersedes. Anything else the
  // couple typed stays untouched until they say so.
  const retire = useMemo(() => {
    const out = new Set<number>();
    for (const l of candidates) {
      const choice = retireChoice[l.id];
      if (choice ?? isCategoryHolderLine(l, l.category)) out.add(l.id);
    }
    return out;
  }, [candidates, retireChoice]);

  const frozenHit = useMemo(
    () => (couple ? [...touched].filter((c) => couple.frozen_categories.includes(c)) : []),
    [couple, touched],
  );
  const currencyMismatch = couple && offer && couple.currency && couple.currency !== offer.currency;

  const money = useCallback(
    (n: number) => formatMoney(n, offer?.currency ?? "EUR", locale),
    [offer, locale],
  );
  const catName = (c: BudgetCategory) => t(`budget.cat.${c}`);

  if (!offer || !breakdown) return null;

  const optionalItems = offer.payload.line_items
    .map((it, index) => ({ it, index }))
    .filter(({ it }) => it.optional && it.kind !== "discount");
  const already = (offer.budget_lines ?? 0) > 0;
  const baseline = couple ? guestCountBaseline(couple, 0) : guests;

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      await offerBudgetApi.apply(offer.id, {
        guests,
        baseline,
        include_optional: [...include],
        categories: Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v])),
        retire_line_ids: [...retire],
      });
      toast.success(t("offers.budget.done"));
      onChanged();
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const removeAll = async () => {
    setSaving(true);
    setError(null);
    try {
      await offerBudgetApi.remove(offer.id);
      toast.success(t("offers.budget.removed"));
      onChanged();
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  function describeError(e: unknown): string {
    if (e instanceof ApiError) {
      const d = (e.detail && typeof e.detail === "object" ? e.detail : {}) as {
        code?: string;
        categories?: BudgetCategory[];
        offer_currency?: string;
        budget_currency?: string;
      };
      if (d.code === "frozen") {
        return t("offers.budget.err_frozen", {
          categories: (d.categories ?? []).map(catName).join(", "),
        });
      }
      if (d.code === "currency_mismatch") {
        return t("offers.budget.err_currency", {
          offer: d.offer_currency ?? "",
          budget: d.budget_currency ?? "",
        });
      }
      if (d.code === "offer_lines_in_use") return t("offers.budget.err_in_use");
      return e.message;
    }
    return t("common.error_generic");
  }

  const blocked = frozenHit.length > 0 || Boolean(currencyMismatch);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="lg"
      title={
        already
          ? t("offers.budget.title_update")
          : t("offers.budget.title", { vendor: offer.vendor_name })
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>
            {already && (
              <Button variant="outline" type="button" onClick={removeAll} disabled={saving}>
                {t("offers.budget.remove")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" type="button" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              autoFocus
              onClick={apply}
              loading={saving}
              disabled={blocked || breakdown.rows.length === 0 || couple === null}
            >
              {already ? t("offers.budget.confirm_update") : t("offers.budget.confirm")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="text-sm text-ink-600 dark:text-paper-300">{t("offers.budget.intro")}</p>
          <p className="mt-1 text-xs text-ink-500 dark:text-paper-400">
            {t("offers.budget.priced_for", { n: guests })} · {t("offers.budget.per_guest_note")}
          </p>
        </div>

        {frozenHit.length > 0 && (
          <Callout>
            {t("offers.budget.err_frozen", { categories: frozenHit.map(catName).join(", ") })}
          </Callout>
        )}
        {currencyMismatch && couple && (
          <Callout>
            {t("offers.budget.err_currency", {
              offer: offer.currency,
              budget: couple.currency ?? "",
            })}
          </Callout>
        )}
        {error && <Callout>{error}</Callout>}

        {optionalItems.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
              {t("offers.budget.optional_title")}
            </h3>
            <p className="text-xs text-ink-500 dark:text-paper-400">
              {t("offers.budget.optional_hint")}
            </p>
            <ul className="mt-2 space-y-1.5">
              {optionalItems.map(({ it, index }) => {
                const amount = it.kind === "per_person" ? it.amount * guests : it.amount;
                return (
                  <li key={index}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-paper-100">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={include.has(index)}
                        onChange={(e) =>
                          setInclude((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(index);
                            else next.delete(index);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      <span className="tabular-nums text-ink-600 dark:text-paper-300">
                        +{money(amount)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section>
          <ul className="divide-y divide-paper-200 rounded-xl border border-paper-200 dark:divide-umber-700 dark:border-umber-700">
            {breakdown.rows.map((r) => (
              <li
                key={`${r.source}-${r.category}-${r.label}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 text-sm text-ink-900 dark:text-paper-50">
                  {r.label}
                </span>
                {r.source >= 0 ? (
                  <select
                    aria-label={t("offers.budget.category")}
                    value={r.category}
                    onChange={(e) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [r.source]: e.target.value as BudgetCategory,
                      }))
                    }
                    className="input w-auto text-base"
                  >
                    {PICKABLE.map((c) => (
                      <option key={c} value={c}>
                        {catName(c)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-ink-600 dark:text-paper-300">
                    {catName(r.category)}
                  </span>
                )}
                <span className="w-28 text-right text-sm font-medium tabular-nums text-ink-900 dark:text-paper-50">
                  {money(r.amount)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between px-3 text-sm">
            <span className="text-ink-600 dark:text-paper-300">{t("offers.budget.total")}</span>
            <span className="text-base font-semibold tabular-nums text-ink-900 dark:text-paper-50">
              {money(breakdown.total)}
            </span>
          </div>
        </section>

        {lines === null ? (
          <Skeleton variant="line" height="3rem" />
        ) : (
          candidates.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                {t("offers.budget.replace_title")}
              </h3>
              <p className="text-xs text-ink-500 dark:text-paper-400">
                {t("offers.budget.replace_hint")}
              </p>
              <ul className="mt-2 space-y-1.5">
                {candidates.map((l) => (
                  <li key={l.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-paper-100">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={retire.has(l.id)}
                        onChange={(e) =>
                          setRetireChoice((prev) => ({ ...prev, [l.id]: e.target.checked }))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {l.label}
                        <span className="text-ink-500 dark:text-paper-400">
                          {" "}
                          · {catName(l.category)}
                        </span>
                      </span>
                      <span className="tabular-nums text-ink-600 dark:text-paper-300">
                        {money(l.planned_huf)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}

        {already && (
          <Link
            to="/app/budget"
            className="inline-block text-sm text-ink-700 underline underline-offset-4 dark:text-paper-200"
          >
            {t("offers.budget.view")}
          </Link>
        )}
      </div>
    </Dialog>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100"
    >
      {children}
    </p>
  );
}
