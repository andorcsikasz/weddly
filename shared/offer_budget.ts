// A chosen vendor offer, broken into budget lines. Pure module: no DB, no clock,
// so the compare page (the "by budget category" row), the "Add to budget"
// preview and the backend that writes the lines all read ONE answer.
//
// Why this exists: an offer is one document from one vendor, but a wedding
// budget is split by what the money buys. A venue's quote can carry hire (venue),
// a per-guest menu (catering), an open bar (drinks) and a service charge on the
// last two. Pasting the total into "Venue" hides the catering the couple is
// actually paying for and breaks the per-guest scaling the budget does on
// catering and drinks.
//
// Rules worth not re-deriving:
//   - **The lines are DERIVED from the stored payload, never typed.** The same
//     (payload, guests, chosen extras) always yields the same rows, so the
//     server can recompute them and trust nothing the client says about money.
//   - **The sum is the offer total.** `offerBudgetBreakdown(...).total` equals
//     `offerTotalAt(payload, guests)` plus the chosen optional extras. A split
//     that lost or invented money is worse than no split.
//   - **A service charge follows the money it is charged on.** "10% service on
//     food and drinks" spreads over catering and drinks by their share, not
//     onto the venue hire. It is stored as an amount, so it is right at the
//     headcount the offer was priced at and rescales with the category after.
//   - **A discount reduces, it never goes negative.** Budget lines cannot hold a
//     negative amount, so a discount is taken off the largest rows of its own
//     category (then of the rest), never below zero.
//   - **Classification is by words and the couple can override it.** The label
//     decides ("open bar" is drinks), the offer's own category is the fallback,
//     and the preview lets the couple move any row. A wrong guess costs one
//     click, a silent wrong guess costs a wrong budget.

import { SUPPLIER_TO_BUDGET } from "./suppliers";
import type { BudgetCategory } from "./types";
import type { OfferItemKind, VendorOfferPayload } from "./vendor_offers";

/** Budget categories whose planned amount rescales with the headcount slider.
 *  Mirrors `PER_GUEST_CATEGORIES` in CostPlanningCard (the budget's own rule);
 *  kept here so the backend can store amounts at the baseline headcount. */
export const OFFER_PER_GUEST_CATEGORIES: ReadonlySet<BudgetCategory> = new Set([
  "catering",
  "drinks",
  "cake_dessert",
  "favours",
  "stationery",
]);

export const OFFER_BUDGET_CATEGORIES: readonly BudgetCategory[] = [
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
];

export interface OfferBudgetRow {
  /** Index of the payload line item this row comes from, or -1 for a row made
   *  by spreading a service charge across categories. */
  source: number;
  label: string;
  category: BudgetCategory;
  /** Whole units of the offer's currency, at the offer's guest count. */
  amount: number;
  kind: OfferItemKind;
  /** True for an optional extra the couple chose to include. */
  optional: boolean;
  /** The per-guest rate when the row is priced per person, else null. */
  per_person: number | null;
}

export interface OfferBudgetBreakdown {
  rows: OfferBudgetRow[];
  total: number;
  /** Amount per category, for the "by budget category" comparison row. */
  by_category: Partial<Record<BudgetCategory, number>>;
}

// Word lists run on the label AFTER accents are stripped and it is lowercased,
// so none of the patterns carry accents. Whole-word where a short stem would
// otherwise match inside an unrelated word ("bar" in "radar", "ital" in
// "italian", "essen" in "essential"). They cover the words a venue or caterer
// quotes in the five UI languages; a miss falls back to the offer's own
// category rather than guessing.
const DRINKS =
  /\bdrinks?\b|\bbar\b|open bar|beverage|\bwine|\bbeer|spritz|aperol|cocktail|champagne|sparkling|toast|froccs|\bital(ok|csomag|ful)?\b|pezsg|bebida|\bvino\b|cerveza|\bpice\b|getrank|\bsekt\b|\bbier\b/;
const CAKE =
  /\bcake|dessert|\bsweets?\b|\btorta\b|sutemeny|\btarta\b|postre|kolac|\btorte\b|kuchen|nachtisch/;
const CATERING =
  /catering|\bmenu\b|\bmeals?\b|\bfood\b|dinner|lunch|buffet|canap|starter|main course|\betel|vendegl|vacsora|\bebed\b|comida|\bcena\b|banquete|\bhrana\b|\bjelo\b|\bessen\b|speisen|verpflegung/;
const DECOR = /decor|flower|floral|dekor|virag|flores|cvije|blumen|\bdeko\b/;
const MUSIC = /\bdj\b|music|\bband\b|\bzene|musica|glazba|musik|sound/;
const PHOTO = /photo|video|\bfoto|\bfilm\b/;
const TRANSPORT = /transport|shuttle|\bbus\b|car hire|\blimo\b|szallit|prijevoz|transfer/;
const SERVICE_CHARGE =
  /service charge|service fee|\bservice\b|szerviz|servicio|\bservis\b|bedienung|gratuity|\btip\b|propina|napojnica/;
const NOT_SERVICE_CHARGE = /clean|takarit|limpieza|ciscenje|reinigung|setup|set-up|teardown/;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The budget bucket an offer's own supplier category belongs to. */
export function offerPrimaryCategory(offerCategory: string): BudgetCategory {
  const table = SUPPLIER_TO_BUDGET as Record<string, string | undefined>;
  const hit = table[offerCategory];
  return (OFFER_BUDGET_CATEGORIES as readonly string[]).includes(hit ?? "")
    ? (hit as BudgetCategory)
    : "other";
}

/** Which budget category a line item belongs to, from its label. Drinks is
 *  tested before catering because "welcome drink with canapés" is the bar. */
export function classifyOfferItem(label: string, primary: BudgetCategory): BudgetCategory {
  const l = fold(label);
  if (DRINKS.test(l)) return "drinks";
  if (CAKE.test(l)) return "cake_dessert";
  if (CATERING.test(l)) return "catering";
  if (DECOR.test(l)) return "decor_floral";
  if (MUSIC.test(l)) return "music_dj";
  if (PHOTO.test(l)) return "photo_video";
  if (TRANSPORT.test(l)) return "transport";
  return primary;
}

/** A fee that is a percentage of food and drink, by its label. */
export function isServiceCharge(label: string): boolean {
  const l = fold(label);
  return SERVICE_CHARGE.test(l) && !NOT_SERVICE_CHARGE.test(l);
}

function sumBy(rows: OfferBudgetRow[]): Partial<Record<BudgetCategory, number>> {
  const out: Partial<Record<BudgetCategory, number>> = {};
  for (const r of rows) out[r.category] = (out[r.category] ?? 0) + r.amount;
  return out;
}

/** Spread `amount` over `weights` so the parts sum exactly (drift folded into
 *  the largest part). Zero weights fall back to the first key. */
function spread(amount: number, weights: [BudgetCategory, number][]): [BudgetCategory, number][] {
  const totalW = weights.reduce((s, [, w]) => s + w, 0);
  if (weights.length === 0) return [];
  if (totalW <= 0) return weights.map(([c], i) => [c, i === 0 ? amount : 0]);
  const parts = weights.map(
    ([c, w]) => [c, Math.round((w / totalW) * amount)] as [BudgetCategory, number],
  );
  const drift = amount - parts.reduce((s, [, v]) => s + v, 0);
  if (drift !== 0) {
    let big = 0;
    parts.forEach(([, v], i) => {
      if (v > (parts[big]?.[1] ?? 0)) big = i;
    });
    const p = parts[big];
    if (p) parts[big] = [p[0], p[1] + drift];
  }
  return parts;
}

/** Take `amount` off the rows, largest first, preferring `category`'s own rows.
 *  Never below zero. Whatever cannot be taken is dropped (the offer total is
 *  clamped at zero the same way). */
function applyDiscount(rows: OfferBudgetRow[], category: BudgetCategory, amount: number): void {
  let left = amount;
  const order = [
    ...rows.filter((r) => r.category === category),
    ...rows.filter((r) => r.category !== category),
  ].sort(
    (a, b) =>
      Number(b.category === category) - Number(a.category === category) || b.amount - a.amount,
  );
  for (const r of order) {
    if (left <= 0) break;
    const cut = Math.min(r.amount, left);
    r.amount -= cut;
    left -= cut;
  }
}

export interface BreakdownOptions {
  /** Headcount the amounts are computed at. Falls back to the offer's own. */
  guests: number | null;
  /** Indexes of optional line items the couple chose to include. */
  includeOptional?: readonly number[];
  /** Category overrides by source index (the couple moved a row). */
  overrides?: Readonly<Record<number, BudgetCategory>>;
}

export function offerBudgetBreakdown(
  p: VendorOfferPayload,
  opts: BreakdownOptions,
): OfferBudgetBreakdown {
  const guests = opts.guests ?? p.guest_count ?? 0;
  const primary = offerPrimaryCategory(p.category);
  const chosen = new Set(opts.includeOptional ?? []);

  const rows: OfferBudgetRow[] = [];
  const fees: { index: number; label: string; amount: number; optional: boolean }[] = [];
  const discounts: { category: BudgetCategory; amount: number }[] = [];

  p.line_items.forEach((it, index) => {
    if (it.optional && !chosen.has(index)) return;
    const amount = it.kind === "per_person" ? it.amount * guests : it.amount;
    const category = opts.overrides?.[index] ?? classifyOfferItem(it.label, primary);
    if (it.kind === "discount") {
      discounts.push({ category, amount });
      return;
    }
    if (it.kind === "fee" && !opts.overrides?.[index] && isServiceCharge(it.label)) {
      fees.push({ index, label: it.label, amount, optional: it.optional });
      return;
    }
    rows.push({
      source: index,
      label: it.label,
      category,
      amount,
      kind: it.kind,
      optional: it.optional,
      per_person: it.kind === "per_person" ? it.amount : null,
    });
  });

  // A printed total with no lines: one row under the offer's own category.
  if (p.line_items.length === 0 && p.stated_total !== null) {
    rows.push({
      source: -1,
      label: p.vendor_name,
      category: primary,
      amount: p.stated_total,
      kind: "base",
      optional: false,
      per_person: null,
    });
  }

  // Service charges follow the food and drink they are charged on.
  const food = sumBy(rows.filter((r) => r.category === "catering" || r.category === "drinks"));
  for (const f of fees) {
    const weights = (["catering", "drinks"] as BudgetCategory[])
      .map((c) => [c, food[c] ?? 0] as [BudgetCategory, number])
      .filter(([, w]) => w > 0);
    const targets = weights.length > 0 ? weights : ([[primary, 1]] as [BudgetCategory, number][]);
    for (const [category, amount] of spread(f.amount, targets)) {
      if (amount <= 0) continue;
      rows.push({
        source: f.index,
        label: targets.length > 1 ? `${f.label} (${category})` : f.label,
        category,
        amount,
        kind: "fee",
        optional: f.optional,
        per_person: null,
      });
    }
  }

  for (const d of discounts) applyDiscount(rows, d.category, d.amount);

  const kept = rows.filter((r) => r.amount > 0);
  const by_category = sumBy(kept);
  return {
    rows: kept,
    total: kept.reduce((s, r) => s + r.amount, 0),
    by_category,
  };
}

/** What a row is stored as in the budget. The budget keeps a per-guest
 *  category's planned amount AT THE BASELINE headcount and rescales it with the
 *  slider, so a row in such a category is stored as `amount × baseline / guests`
 *  and displays as `amount` when the slider is at `guests`. Other categories
 *  store the amount as is. A frozen category does not rescale, so it stores the
 *  amount as is too. */
export function storedPlannedAmount(
  row: Pick<OfferBudgetRow, "amount" | "category">,
  guests: number,
  baseline: number,
  frozen: ReadonlySet<BudgetCategory> = new Set(),
): number {
  if (!OFFER_PER_GUEST_CATEGORIES.has(row.category) || frozen.has(row.category)) return row.amount;
  if (guests <= 0 || baseline <= 0) return row.amount;
  return Math.round((row.amount * baseline) / guests);
}

// ── API contract ───────────────────────────────────────────────────────────

/** Body of `POST /api/vendor-offers/:id/budget`. The server recomputes every
 *  amount from the stored payload; the client only says WHICH extras are in,
 *  WHERE a row was moved, and which of its own estimate lines the quote replaces. */
export interface ApplyOfferToBudgetInput {
  /** Headcount the amounts are priced at (the compare page's slider). */
  guests: number;
  /** The budget's baseline headcount, so per-guest categories are stored at it. */
  baseline: number;
  include_optional?: number[];
  /** Source index (as a string key) → budget category the couple chose. */
  categories?: Record<string, BudgetCategory>;
  /** The couple's own unmanaged estimate lines (e.g. the "Venue" row) this quote
   *  replaces, so the category is not counted twice. */
  retire_line_ids?: number[];
}

export interface ApplyOfferToBudgetResult {
  /** The lines now carrying this offer, as stored. */
  line_ids: number[];
  retired_line_ids: number[];
  total: number;
}
