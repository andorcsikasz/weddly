// The couple's picks as a comparison table: see `PickTable` in shared/picks.ts.
//
// One pass over the picks, so every price comes from the same rule the couple
// page uses (`matchVenuePricing`), for the couple's own date and headcount. A
// venue that has not answered a question says so, rather than being marked "no".

import type {
  PickTable,
  PickTableLine,
  PickTablePrice,
  PickTableRow,
  PickTableVenue,
} from "@shared/picks";
import { isSentinelPick } from "@shared/picks";
import { matchVenuePricing, type VenueLineStatus, venueProfileHasContent } from "@shared/venue";
import { listListingPackages } from "./listings";
import { listExtrasForCouple, listPicksForCouple } from "./couple_picks";
import { getById as getSelfSupplier } from "./couple_suppliers";
import { type CoupleRow, rowToCurrency } from "./couples";
import { getVenueDetail } from "./venue_profile";
import { getCoupleSupplierCost } from "./supplier_costs";
import { resolveSupplierBase } from "./resolve_supplier";

function venueAnswers(detail: ReturnType<typeof getVenueDetail>): PickTableVenue {
  const p = detail.profile;
  return {
    has_profile: venueProfileHasContent(p),
    facilities: [...p.facilities],
    catering: [...p.catering],
    drinks: [...p.drinks],
    max_seated: p.max_seated,
    accommodation_capacity: p.accommodation_capacity,
  };
}

/** How a venue's estimate line reads to the couple: yes, no, or ask. */
function lineProvided(status: VenueLineStatus): PickTableLine["provided"] {
  if (status === "not_available") return "no";
  if (status === "on_request" || status === "needs_quantity") return "ask";
  return "yes";
}

function venueLineNote(status: VenueLineStatus): PickTableLine["note_key"] {
  if (status === "optional") return "optional";
  if (status === "refundable") return "refundable";
  return null;
}

/** The price, and what it covers, from one match so the two cannot disagree. */
function venuePriceAndLines(
  detail: ReturnType<typeof getVenueDetail>,
  country: string | null,
  weddingDate: string | null,
  guests: number | null,
): { price: PickTablePrice; breakdown: PickTableLine[] | null } {
  const match = matchVenuePricing(
    { pricing_rules: detail.pricing_rules, country, profile: detail.profile },
    { date: weddingDate, guests },
  );
  if (match.kind !== "priced") return { price: { kind: match.kind }, breakdown: null };
  const lines: PickTableLine[] = match.estimate.lines.map((line) => ({
    item: line.item.key,
    label: line.item.label ?? "",
    provided: lineProvided(line.status),
    amount: line.subtotal,
    amount_max: null,
    per: null,
    note_key: venueLineNote(line.status),
    description: null,
  }));
  return {
    price: {
      kind: "priced",
      total: match.estimate.total,
      is_from: match.estimate.is_from,
      over_capacity: match.over_capacity,
    },
    breakdown: lines,
  };
}

/** A supplier's packages as breakdown lines: each one's name, price and what it
 *  says it includes. */
function packageLines(listingId: string): PickTableLine[] | null {
  const packages = listListingPackages(listingId);
  if (packages.length === 0) return null;
  return packages.map((pkg) => ({
    item: null,
    label: pkg.name,
    provided: "yes",
    amount: pkg.price_min,
    amount_max: pkg.price_max,
    per: pkg.price_mode,
    note_key: null,
    description: pkg.description,
  }));
}

/** Every pick the couple has, primary first within each category, as one table. */
export function picksTableForCouple(couple: CoupleRow): PickTable {
  const currency = rowToCurrency(couple.currency);
  const country = couple.country ?? null;
  const weddingDate = couple.wedding_date ?? null;
  const guests = couple.planning_count ?? null;

  const picks = [
    ...listPicksForCouple(couple.id).map((p) => ({ ...p, role: "primary" as const })),
    ...listExtrasForCouple(couple.id).map((p) => ({ ...p, role: "extra" as const })),
  ];

  const rows: PickTableRow[] = [];
  for (const pick of picks) {
    if (isSentinelPick(pick.supplier_id)) continue;
    const planned = getCoupleSupplierCost(couple.id, pick.supplier_id)?.planned_huf ?? null;
    const listed = resolveSupplierBase(pick.supplier_id);
    if (listed) {
      const isVenue = listed.category === "venue";
      // A venue that has said nothing yet comes back empty: no answers, and no
      // price because it has no rules.
      const detail = isVenue ? getVenueDetail(listed.id, currency, country) : null;
      const venue = detail ? venuePriceAndLines(detail, country, weddingDate, guests) : null;
      rows.push({
        supplier_id: pick.supplier_id,
        role: pick.role,
        category: listed.category,
        name: listed.name,
        city: listed.city ?? null,
        price: venue ? venue.price : null,
        planned,
        breakdown: venue ? venue.breakdown : packageLines(listed.id),
        venue: detail ? venueAnswers(detail) : null,
      });
      continue;
    }
    // A "do it myself" card: no directory detail, only what the couple typed.
    const own = getSelfSupplier(pick.supplier_id, couple.id);
    if (!own) continue;
    rows.push({
      supplier_id: pick.supplier_id,
      role: pick.role,
      category: own.category,
      name: own.name,
      city: own.city ?? null,
      price: null,
      planned: planned ?? own.price_huf ?? null,
      breakdown: null,
      venue: null,
    });
  }

  return { currency, wedding_date: weddingDate, guest_count: guests, rows };
}
