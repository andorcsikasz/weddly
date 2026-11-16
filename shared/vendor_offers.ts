// A vendor's priced offer, as the couple types it in by hand or (usually) as
// an LLM extracts it from a PDF / email. Pure module: no DB, no clock of its
// own (callers pass `today`), so the backend validator, the importer UI and the
// comparison maths all read ONE definition.

import type { Currency } from "./currency";

export const OFFER_SCHEMA = "weddly.offer.v1";
export const OFFER_ITEMS_MAX = 60;
export const OFFER_LIST_MAX = 30;
export const OFFER_TEXT_MAX = 600;
export const OFFER_AMOUNT_MAX = 1_000_000_000;

export const OFFER_ITEM_KINDS = ["base", "per_person", "extra", "fee", "discount"] as const;
export type OfferItemKind = (typeof OFFER_ITEM_KINDS)[number];

export const OFFER_STATUSES = ["open", "shortlisted", "chosen", "rejected"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

const CURRENCIES: readonly Currency[] = [
  "EUR",
  "HUF",
  "GBP",
  "CHF",
  "PLN",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
  "RON",
  "JPY",
  "USD",
];

export interface OfferLineItem {
  label: string;
  /** Whole units of the offer's currency. per_person is PER GUEST; discount is
   *  entered as a positive number and subtracted. */
  amount: number;
  kind: OfferItemKind;
  /** An optional extra is shown but not counted in the base total. */
  optional: boolean;
}

export interface VendorOfferPayload {
  schema: typeof OFFER_SCHEMA;
  vendor_name: string;
  category: string;
  currency: Currency;
  /** Date the vendor's document says the prices are true as of (YYYY-MM-DD). */
  quoted_at: string;
  valid_until: string | null;
  event_date: string | null;
  guest_count: number | null;
  /** The figure printed on the offer, when it states one. */
  stated_total: number | null;
  line_items: OfferLineItem[];
  deposit_amount: number | null;
  payment_terms: string | null;
  inclusions: string[];
  exclusions: string[];
  cancellation: string | null;
  notes: string | null;
}

export interface VendorOffer {
  id: number;
  supplier_id: string | null;
  vendor_name: string;
  category: string;
  currency: Currency;
  quoted_at: string;
  valid_until: string | null;
  /** Server-computed with `offerTotalAt(payload, payload.guest_count)`. */
  total: number;
  status: OfferStatus;
  payload: VendorOfferPayload;
  created_at: number;
}

export type ParseResult = { ok: true; offer: VendorOfferPayload } | { ok: false; errors: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** An LLM answer is usually wrapped in a ```json fence or prose; take the
 *  outermost object. */
export function extractJsonText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

function money(v: unknown, path: string, errors: string[], allowNull: boolean): number | null {
  if (v === null || v === undefined) {
    if (!allowNull) errors.push(`${path} is required`);
    return null;
  }
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > OFFER_AMOUNT_MAX) {
    errors.push(`${path} must be a non-negative number (no currency symbol, no text)`);
    return null;
  }
  return Math.round(v);
}

function text(v: unknown, path: string, errors: string[], max = OFFER_TEXT_MAX): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") {
    errors.push(`${path} must be a string or null`);
    return null;
  }
  const t = v.trim();
  if (t.length > max) {
    errors.push(`${path} is too long (max ${max})`);
    return null;
  }
  return t || null;
}

function strList(v: unknown, path: string, errors: string[]): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.length > OFFER_LIST_MAX) {
    errors.push(`${path} must be an array of at most ${OFFER_LIST_MAX} strings`);
    return [];
  }
  const out: string[] = [];
  v.forEach((s, i) => {
    const t = text(s, `${path}[${i}]`, errors, 200);
    if (t) out.push(t);
  });
  return out;
}

/** Validate an already-parsed object. Errors name the offending path so the
 *  couple can paste them straight back to the LLM ("fix these"). */
export function validateVendorOffer(input: unknown): ParseResult {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["The JSON must be one object"] };
  }
  const o = input as Record<string, unknown>;

  if (o.schema !== OFFER_SCHEMA) errors.push(`schema must be "${OFFER_SCHEMA}"`);

  const vendor =
    typeof o.vendor === "object" && o.vendor !== null
      ? (o.vendor as Record<string, unknown>)
      : null;
  const vendorName = text(vendor?.name ?? o.vendor_name, "vendor.name", errors, 120);
  if (!vendorName) errors.push("vendor.name is required");
  const category = text(vendor?.category ?? o.category, "vendor.category", errors, 40) ?? "other";

  const currency = o.currency;
  if (typeof currency !== "string" || !CURRENCIES.includes(currency as Currency)) {
    errors.push(`currency must be one of ${CURRENCIES.join(", ")}`);
  }

  if (!isIsoDate(o.quoted_at)) errors.push("quoted_at must be a real date as YYYY-MM-DD");
  const validUntil = o.valid_until ?? null;
  if (validUntil !== null && !isIsoDate(validUntil)) {
    errors.push("valid_until must be YYYY-MM-DD or null");
  }
  const eventDate = o.event_date ?? null;
  if (eventDate !== null && !isIsoDate(eventDate)) {
    errors.push("event_date must be YYYY-MM-DD or null");
  }
  if (isIsoDate(o.quoted_at) && isIsoDate(validUntil) && validUntil < o.quoted_at) {
    errors.push("valid_until cannot be before quoted_at");
  }

  let guests: number | null = null;
  if (o.guest_count !== null && o.guest_count !== undefined) {
    if (
      typeof o.guest_count !== "number" ||
      !Number.isInteger(o.guest_count) ||
      o.guest_count < 1 ||
      o.guest_count > 5000
    ) {
      errors.push("guest_count must be a whole number between 1 and 5000, or null");
    } else guests = o.guest_count;
  }

  const stated = money(o.stated_total, "stated_total", errors, true);
  const deposit = money(o.deposit_amount, "deposit_amount", errors, true);

  const items: OfferLineItem[] = [];
  if (o.line_items !== undefined && o.line_items !== null) {
    if (!Array.isArray(o.line_items) || o.line_items.length > OFFER_ITEMS_MAX) {
      errors.push(`line_items must be an array of at most ${OFFER_ITEMS_MAX} items`);
    } else {
      o.line_items.forEach((raw, i) => {
        const p = `line_items[${i}]`;
        if (typeof raw !== "object" || raw === null) {
          errors.push(`${p} must be an object`);
          return;
        }
        const r = raw as Record<string, unknown>;
        const label = text(r.label, `${p}.label`, errors, 120);
        if (!label) errors.push(`${p}.label is required`);
        const amount = money(r.amount, `${p}.amount`, errors, false);
        const kind = r.kind ?? "base";
        if (typeof kind !== "string" || !OFFER_ITEM_KINDS.includes(kind as OfferItemKind)) {
          errors.push(`${p}.kind must be one of ${OFFER_ITEM_KINDS.join(", ")}`);
        }
        if (label && amount !== null && OFFER_ITEM_KINDS.includes(kind as OfferItemKind)) {
          items.push({
            label,
            amount,
            kind: kind as OfferItemKind,
            optional: r.optional === true,
          });
        }
      });
    }
  }

  if (stated === null && items.length === 0) {
    errors.push("Give either stated_total or at least one line_items entry");
  }
  if (items.some((i) => i.kind === "per_person") && guests === null) {
    errors.push("guest_count is required when a line item is per_person");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    offer: {
      schema: OFFER_SCHEMA,
      vendor_name: vendorName as string,
      category,
      currency: currency as Currency,
      quoted_at: o.quoted_at as string,
      valid_until: validUntil as string | null,
      event_date: eventDate as string | null,
      guest_count: guests,
      stated_total: stated,
      line_items: items,
      deposit_amount: deposit,
      payment_terms: text(o.payment_terms, "payment_terms", errors),
      inclusions: strList(o.inclusions, "inclusions", errors),
      exclusions: strList(o.exclusions, "exclusions", errors),
      cancellation: text(o.cancellation, "cancellation", errors),
      notes: text(o.notes, "notes", errors),
    },
  };
}

export function parseVendorOffer(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonText(raw));
  } catch {
    return { ok: false, errors: ["That is not valid JSON. Paste the model's answer exactly."] };
  }
  return validateVendorOffer(value);
}

// ── Maths ─────────────────────────────────────────────────────────────────

/** Total at a given headcount. Line items win when present (so the guest slider
 *  has something to scale); otherwise the printed total stands. Optional extras
 *  are excluded: the headline number is what the vendor commits to, and
 *  `offerOptionalTotal` is what the extras would add. */
export function offerTotalAt(p: VendorOfferPayload, guests: number | null): number {
  if (p.line_items.length === 0) return p.stated_total ?? 0;
  let total = 0;
  for (const it of p.line_items) {
    if (it.optional) continue;
    const g = guests ?? p.guest_count ?? 0;
    const v = it.kind === "per_person" ? it.amount * g : it.amount;
    total += it.kind === "discount" ? -v : v;
  }
  return Math.max(0, Math.round(total));
}

export function offerOptionalTotal(p: VendorOfferPayload): number {
  const g = p.guest_count ?? 0;
  return p.line_items
    .filter((i) => i.optional && i.kind !== "discount")
    .reduce((s, i) => s + (i.kind === "per_person" ? i.amount * g : i.amount), 0);
}

/** Does the printed total disagree with the sum of its own lines? Flag, never
 *  silently pick: a vendor PDF with an arithmetic slip is worth knowing about. */
export function offerMismatch(p: VendorOfferPayload): { stated: number; computed: number } | null {
  if (p.stated_total === null || p.line_items.length === 0) return null;
  const computed = offerTotalAt(p, p.guest_count);
  const tolerance = Math.max(1, p.stated_total * 0.01);
  return Math.abs(computed - p.stated_total) > tolerance
    ? { stated: p.stated_total, computed }
    : null;
}

/** Composition for the stacked bar: positive kinds only, discount reported
 *  separately so a segment never has negative width. */
export function offerComposition(
  p: VendorOfferPayload,
  guests: number | null,
): { kind: OfferItemKind; amount: number }[] {
  const g = guests ?? p.guest_count ?? 0;
  const acc = new Map<OfferItemKind, number>();
  for (const it of p.line_items) {
    if (it.optional) continue;
    const v = it.kind === "per_person" ? it.amount * g : it.amount;
    acc.set(it.kind, (acc.get(it.kind) ?? 0) + v);
  }
  return OFFER_ITEM_KINDS.filter((k) => (acc.get(k) ?? 0) > 0).map((kind) => ({
    kind,
    amount: acc.get(kind) ?? 0,
  }));
}

export type OfferFreshness = "expired" | "fresh" | "aging" | "stale";

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / DAY_MS);
}

/** How far to trust the numbers. `today` is passed in (YYYY-MM-DD). Expiry
 *  beats age; without a stated expiry, age alone decides. */
export function offerFreshness(
  o: { quoted_at: string; valid_until: string | null },
  today: string,
): { state: OfferFreshness; age_days: number; days_left: number | null } {
  const age = Math.max(0, dayNumber(today) - dayNumber(o.quoted_at));
  const left = o.valid_until ? dayNumber(o.valid_until) - dayNumber(today) : null;
  if (left !== null && left < 0) return { state: "expired", age_days: age, days_left: left };
  const state: OfferFreshness = age <= 14 ? "fresh" : age <= 45 ? "aging" : "stale";
  return { state, age_days: age, days_left: left };
}

/** The prompt the couple copies into any LLM together with the vendor's PDF or
 *  email. Built here so the schema it quotes can never drift from the
 *  validator above. */
export function buildOfferPrompt(opts: {
  currency: Currency;
  guestCount: number | null;
  eventDate: string | null;
  today: string;
}): string {
  const example: VendorOfferPayload = {
    schema: OFFER_SCHEMA,
    vendor_name: "Example Catering Ltd",
    category: "catering",
    currency: opts.currency,
    quoted_at: opts.today,
    valid_until: null,
    event_date: opts.eventDate,
    guest_count: opts.guestCount ?? 80,
    stated_total: null,
    line_items: [
      { label: "Menu, 3 courses", amount: 62, kind: "per_person", optional: false },
      { label: "Service staff", amount: 900, kind: "fee", optional: false },
      { label: "Late-night snack", amount: 9, kind: "per_person", optional: true },
    ],
    deposit_amount: null,
    payment_terms: null,
    inclusions: [],
    exclusions: [],
    cancellation: null,
    notes: null,
  };
  return [
    "You are extracting a wedding vendor's price offer into JSON for a comparison tool.",
    "I will attach or paste the vendor's offer (PDF text, email or chat). Read all of it.",
    "",
    "Return ONLY one JSON object, no prose and no markdown, matching exactly this shape:",
    JSON.stringify(example, null, 2),
    "",
    "Rules:",
    `- "schema" is always "${OFFER_SCHEMA}".`,
    `- category is one of: ${CATEGORY_HINT}. Use "other" if none fit.`,
    `- Money fields are plain numbers in whole ${opts.currency} units: no symbols, no thousands separators, no text. If the offer is in another currency, keep its numbers and set "currency" to that currency's ISO code.`,
    '- Dates are YYYY-MM-DD. "quoted_at" is the date printed on the offer (or the email date). "valid_until" is the offer\'s stated expiry, else null.',
    '- Each priced thing is one line_items entry. kind: "base" = fixed package or hire price, "per_person" = price PER GUEST (amount is the per-guest figure), "extra" = add-on, "fee" = service, travel, setup or overtime fee, "discount" = a reduction (write the amount as a positive number).',
    '- Mark anything the vendor presents as optional or "on request" with "optional": true.',
    '- "stated_total" is the grand total printed on the offer, else null. Never calculate it yourself and never invent line items to make it add up.',
    '- "guest_count" is the headcount the prices assume, else null. It is required when any item is per_person.',
    '- Put what is included in "inclusions" and what is explicitly NOT included (or charged separately) in "exclusions", as short phrases in the offer\'s own wording.',
    "- Use null for anything the offer does not state. Do not guess.",
    opts.guestCount
      ? `- My expected guest count is ${opts.guestCount}; if the offer assumes a different number, report the offer's number.`
      : "",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

const CATEGORY_HINT =
  "venue, accommodation, catering, cake_dessert, bar_drinks, florist, wedding_decor, lighting, photography, videography, photo_booth, dj, live_music, entertainment, celebrant, hair_makeup, suit_formal, bridal_boutique, invitation_graphics, transport, wedding_planner";
