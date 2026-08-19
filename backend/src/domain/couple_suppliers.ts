// "Csinálom magam" supplier entries — couple-private. Owns its own price
// field and mirrors a positive value into a paired `budget_lines` row so
// /app/budget reflects DIY costs alongside booked vendors. The supplier
// row is the source of truth; the budget line is read-only and disappears
// when the price is cleared or the supplier is deleted.
//
// Loop C₂ fix: a DIY price is "planned" by default — actual_huf stays at 0
// until the couple ticks the `paid` toggle on the supplier card. Before
// this fix every DIY price was double-mirrored to both planned_huf and
// actual_huf on insert, which made the dashboard claim the couple had
// already spent the money on Mom's cooking. Existing rows (created before
// this column landed) keep their old actual_huf — we don't retroactively
// zero it out. That'd silently overwrite intentional data. The fix is
// forward-looking only.

import { randomBytes } from "node:crypto";
import type { CoupleSupplier, CoupleSupplierDirectoryMatch } from "@shared/couple_suppliers";
import { SUPPLIER_TO_BUDGET, type SupplierCategory } from "@shared/suppliers";
import { db, now } from "../db";
import { insertCommunitySupplier } from "./community_suppliers";
import { syncListingBudgetLine } from "./listing_budget_mirror";
import { findDirectoryTwinByName } from "./listings";
import { listForSupplier, recomputePaidState } from "./supplier_installments";

interface Row {
  id: string;
  couple_id: number;
  name: string;
  category: string;
  notes: string | null;
  price_huf: number | null;
  paid: number;
  budget_line_id: number | null;
  next_step: string | null;
  probability: number | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  listing_id: string | null;
  not_listed_confirmed: number;
  created_at: number;
  updated_at: number;
}

/** The listing this row already stands for, or the one it looks like.
 *
 *  A row that has answered the question asks nothing further: `listing_id` is a
 *  yes, `not_listed_confirmed` is a no, and re-offering the listing either way
 *  would be nagging about something the couple settled. */
function directoryMatchFor(r: Row): CoupleSupplierDirectoryMatch | null {
  if (r.listing_id || r.not_listed_confirmed === 1) return null;
  return findDirectoryTwinByName(r.name, r.category as SupplierCategory, { city: r.city });
}

function toDto(r: Row): CoupleSupplier {
  return {
    id: r.id,
    source: "self",
    name: r.name,
    category: r.category as SupplierCategory,
    notes: r.notes,
    price_huf: r.price_huf,
    paid: r.paid === 1,
    budget_line_id: r.budget_line_id,
    installments: listForSupplier(r.id),
    next_step: r.next_step,
    probability: r.probability,
    city: r.city,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    contact_email: r.contact_email,
    contact_phone: r.contact_phone,
    listing_id: r.listing_id,
    directory_match: directoryMatchFor(r),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** The location + contact slots a mapped venue can carry. Kept as one bag so
 *  insert/update thread them identically; every field independently nullable. */
interface PlaceFields {
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  contact_email: string | null;
  contact_phone: string | null;
}

export function listByCoupleId(coupleId: number): CoupleSupplier[] {
  const rows = db
    .prepare("SELECT * FROM couple_suppliers WHERE couple_id = ? ORDER BY created_at DESC")
    .all(coupleId) as Row[];
  return rows.map(toDto);
}

export function getById(id: string, coupleId: number): CoupleSupplier | null {
  const row = db
    .prepare("SELECT * FROM couple_suppliers WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as Row | undefined;
  return row ? toDto(row) : null;
}

/** Inserts a budget line that mirrors a DIY supplier's price. Returns the
 *  new line id. Idempotent caller — invoked only when `price > 0`.
 *  `paid` decides whether `actual_huf` matches the price (true) or stays
 *  at 0 (false, the default — planned-only). */
function insertBudgetLine(
  coupleId: number,
  supplierId: string,
  category: SupplierCategory,
  label: string,
  priceHuf: number,
  paid: boolean,
  ts: number,
): number {
  const r = db
    .prepare(
      `INSERT INTO budget_lines
         (couple_id, category, label, planned_huf, actual_huf, notes,
          couple_supplier_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      SUPPLIER_TO_BUDGET[category],
      label,
      priceHuf,
      paid ? priceHuf : 0,
      null,
      supplierId,
      ts,
      ts,
    );
  return Number(r.lastInsertRowid);
}

function updateBudgetLine(
  lineId: number,
  coupleId: number,
  category: SupplierCategory,
  label: string,
  priceHuf: number,
  paid: boolean,
  ts: number,
): void {
  db.prepare(
    `UPDATE budget_lines
        SET category = ?, label = ?, planned_huf = ?, actual_huf = ?, updated_at = ?
      WHERE id = ? AND couple_id = ?`,
  ).run(SUPPLIER_TO_BUDGET[category], label, priceHuf, paid ? priceHuf : 0, ts, lineId, coupleId);
}

function deleteBudgetLine(lineId: number, coupleId: number): void {
  db.prepare("DELETE FROM budget_lines WHERE id = ? AND couple_id = ?").run(lineId, coupleId);
}

interface InsertInput extends PlaceFields {
  name: string;
  category: SupplierCategory;
  notes: string | null;
  price_huf: number | null;
  paid: boolean;
  /** The directory listing this row stands for, when the caller already knows
   *  it (it published one, or the couple adopted an existing one). */
  listing_id?: string | null;
  /** The couple was shown a same-name listing and said theirs is a different
   *  business. Stops the card asking again. */
  not_listed_confirmed?: boolean;
}

export function insert(coupleId: number, input: InsertInput): CoupleSupplier {
  const ts = now();
  const id = randomBytes(8).toString("hex");

  // The budget_lines mirror and the couple_suppliers source-of-truth must
  // commit together — a partial failure would orphan a money-bearing budget
  // line whose supplier card never existed (and which the budget UI locks
  // against deletion). Wrap both writes in one transaction.
  db.transaction(() => {
    let budgetLineId: number | null = null;
    if (input.price_huf !== null && input.price_huf > 0) {
      budgetLineId = insertBudgetLine(
        coupleId,
        id,
        input.category,
        input.name,
        input.price_huf,
        input.paid,
        ts,
      );
    }

    db.prepare(
      `INSERT INTO couple_suppliers
       (id, couple_id, name, category, notes, price_huf, paid, budget_line_id,
        city, address, lat, lng, contact_email, contact_phone, listing_id,
        not_listed_confirmed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      coupleId,
      input.name,
      input.category,
      input.notes,
      input.price_huf,
      input.paid ? 1 : 0,
      budgetLineId,
      input.city,
      input.address,
      input.lat,
      input.lng,
      input.contact_email,
      input.contact_phone,
      input.listing_id ?? null,
      input.not_listed_confirmed ? 1 : 0,
      ts,
      ts,
    );
  })();

  const created = getById(id, coupleId);
  if (!created) throw new Error("Failed to read inserted couple_supplier");
  return created;
}

interface UpdateInput {
  name?: string;
  category?: SupplierCategory;
  notes?: string | null;
  price_huf?: number | null;
  paid?: boolean;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

export function update(id: string, coupleId: number, input: UpdateInput): CoupleSupplier | null {
  const existing = db
    .prepare("SELECT * FROM couple_suppliers WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as Row | undefined;
  if (!existing) return null;

  const ts = now();
  const newName = input.name ?? existing.name;
  const newCategory = (input.category ?? existing.category) as SupplierCategory;
  const newNotes = input.notes !== undefined ? input.notes : existing.notes;
  const newPrice = input.price_huf !== undefined ? input.price_huf : existing.price_huf;
  const newPaid = input.paid !== undefined ? input.paid : existing.paid === 1;
  // Place/contact fields: each is replaced only when the caller sent it, so a
  // partial PATCH (e.g. flipping `paid`) never wipes a venue's coordinates.
  const keep = <K extends keyof PlaceFields>(k: K, cur: PlaceFields[K]): PlaceFields[K] =>
    input[k] !== undefined ? (input[k] as PlaceFields[K]) : cur;
  const newCity = keep("city", existing.city);
  const newAddress = keep("address", existing.address);
  const newLat = keep("lat", existing.lat);
  const newLng = keep("lng", existing.lng);
  const newEmail = keep("contact_email", existing.contact_email);
  const newPhone = keep("contact_phone", existing.contact_phone);

  // Mirror + source-of-truth commit together (see insert()).
  db.transaction(() => {
    let newBudgetLineId: number | null = existing.budget_line_id;
    if (newPrice !== null && newPrice > 0) {
      if (newBudgetLineId !== null) {
        updateBudgetLine(newBudgetLineId, coupleId, newCategory, newName, newPrice, newPaid, ts);
      } else {
        newBudgetLineId = insertBudgetLine(
          coupleId,
          id,
          newCategory,
          newName,
          newPrice,
          newPaid,
          ts,
        );
      }
    } else if (newBudgetLineId !== null) {
      // Price cleared — drop the paired line.
      deleteBudgetLine(newBudgetLineId, coupleId);
      newBudgetLineId = null;
    }

    db.prepare(
      `UPDATE couple_suppliers
        SET name = ?, category = ?, notes = ?, price_huf = ?, paid = ?, budget_line_id = ?,
            city = ?, address = ?, lat = ?, lng = ?, contact_email = ?, contact_phone = ?,
            updated_at = ?
      WHERE id = ? AND couple_id = ?`,
    ).run(
      newName,
      newCategory,
      newNotes,
      newPrice,
      newPaid ? 1 : 0,
      newBudgetLineId,
      newCity,
      newAddress,
      newLat,
      newLng,
      newEmail,
      newPhone,
      ts,
      id,
      coupleId,
    );

    // If the supplier carries a payment schedule, the installments are the
    // source of truth: re-derive `paid` + the mirror's actual_huf from them,
    // overriding the manual all-or-nothing `paid` just written above. A no-op
    // when there are no installments.
    recomputePaidState(coupleId, id, ts);
  })();

  return getById(id, coupleId);
}

export function deleteById(id: string, coupleId: number): boolean {
  const existing = db
    .prepare(
      "SELECT budget_line_id, listing_id FROM couple_suppliers WHERE id = ? AND couple_id = ?",
    )
    .get(id, coupleId) as { budget_line_id: number | null; listing_id: string | null } | undefined;
  if (!existing) return false;

  // Drop the paired budget line and the supplier row together.
  const result = db.transaction(() => {
    if (existing.budget_line_id !== null) {
      deleteBudgetLine(existing.budget_line_id, coupleId);
    }
    const r = db
      .prepare("DELETE FROM couple_suppliers WHERE id = ? AND couple_id = ?")
      .run(id, coupleId);
    // This row was the reason the listing's own mirror stood down (one booked
    // vendor, one budget line). With the row gone the directory side is free to
    // answer for itself again, if it is still picked and still priced.
    if (existing.listing_id) syncListingBudgetLine(coupleId, existing.listing_id);
    return r;
  })();
  return result.changes > 0;
}

// ── Directory binding ───────────────────────────────────────────────────────
//
// A private row that names a real business gets bound to a `listings` id, and
// from then on every surface renders it FROM that listing. Two ways in:
//
//   adoptDirectoryListing — the business was already listed and the couple's row
//     was a second card for it. Nothing is destroyed: the row keeps its notes,
//     price, mirrored budget line and payment schedule (installments FK to it and
//     have no home on the listing side), it just stops being its own business.
//     The category PICK moves to the listing, which is what turns the couple's
//     bare name into the listing's photos, address and reviews.
//
//   publishAsCommunityListing — the business was NOT listed, so we list it. The
//     row lands in the ordinary community queue, which is also what makes it
//     reachable by the claim-invite campaign (it targets unclaimed active
//     listings with a contact email), so the vendor gets pulled into the flow
//     instead of living forever inside one couple's workspace.

/** Bind a private row to a listing and move its category pick there. Returns
 *  the updated row, or null when the row doesn't exist. */
export function bindListing(
  id: string,
  coupleId: number,
  listingId: string,
): CoupleSupplier | null {
  const ts = now();
  db.transaction(() => {
    db.prepare(
      "UPDATE couple_suppliers SET listing_id = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
    ).run(listingId, ts, id, coupleId);
    // The pick is what the rest of the app reads as "this is our vendor for this
    // category", so it has to follow the binding — otherwise the couple's chosen
    // venue is still their private row and the listing stays an also-ran.
    db.prepare(
      "UPDATE couple_picks SET supplier_id = ? WHERE couple_id = ? AND supplier_id = ?",
    ).run(listingId, coupleId, id);
    // From here the private row IS this listing, and it already owns a mirrored
    // budget line. A line the listing had earned on its own (the couple had
    // picked and priced it before adopting) would now be the second copy of one
    // vendor, so the mirror is re-run to withdraw it.
    syncListingBudgetLine(coupleId, listingId);
  })();
  return getById(id, coupleId);
}

/** Carry a bound row's price over to the per-couple cost row that directory
 *  suppliers use, so the money shows on the listing's own detail page too. The
 *  mirrored budget line stays where it is — this is an addition, not a move, and
 *  a cost row that already exists is left alone rather than overwritten. */
export function mirrorPriceToListingCost(coupleId: number, listingId: string, row: Row): void {
  if (row.price_huf === null || row.price_huf <= 0) return;
  const ts = now();
  db.prepare(
    `INSERT INTO couple_supplier_costs
       (couple_id, supplier_id, planned_huf, actual_huf, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(couple_id, supplier_id) DO NOTHING`,
  ).run(coupleId, listingId, row.price_huf, row.paid === 1 ? row.price_huf : 0, row.notes, ts, ts);
}

/** Enough of a business to be a directory card? Name and category alone are not:
 *  a row with no location can't be rendered as a card, can't be found by anyone
 *  searching a town, and can't be invited. That floor is also what keeps the
 *  genuinely private rows private — "Anyu főztje" and "Béla bácsi a zenén" are
 *  typed into a form that collects no address, phone or email at all, so they
 *  never reach this bar and are never published. */
export function isPublishableToDirectory(input: {
  city: string | null;
  address: string | null;
}): boolean {
  return Boolean(input.city?.trim() || input.address?.trim());
}

/** List a private row as a community submission and bind the row to it. The
 *  submission lands 'pending' like every other community entry: the admin queue
 *  is what stands between a logged-in couple and the public directory, and
 *  releasing it from there is also what sends the vendor their verify mail.
 *  Returns the new listing id, or null when the row isn't publishable. */
export function publishAsCommunityListing(
  coupleId: number,
  submitterUserId: number,
  row: Row,
): string | null {
  if (!isPublishableToDirectory(row)) return null;

  // Somebody may have added this business a moment ago and it is still sitting in
  // the moderation queue — invisible to the create guard, which only asks about
  // live listings. Join that row rather than putting a second copy behind it: one
  // business is one listing no matter how many couples booked it.
  const queued = findDirectoryTwinByName(row.name, row.category as SupplierCategory, {
    includePending: true,
    city: row.city,
  });
  if (queued) {
    bindListing(row.id, coupleId, queued.id);
    mirrorPriceToListingCost(coupleId, queued.id, row);
    return queued.id;
  }

  const communityId = insertCommunitySupplier(submitterUserId, {
    category: row.category as SupplierCategory,
    // 'user' rather than 'self': a couple recommending a vendor they booked is
    // exactly the "a user suggested you" case the claim invite is written for.
    submitter_type: "user",
    name: row.name,
    city: row.city?.trim() ?? "",
    address: row.address?.trim() ?? null,
    website: "",
    contact_email: row.contact_email?.trim() ?? null,
    contact_phone: row.contact_phone?.trim() ?? null,
    // The couple's notes are private to them; a public blurb is the vendor's own
    // words to write once they claim the listing.
    blurb: "",
    price_band: null,
  });
  const listingId = `c${communityId}`;
  bindListing(row.id, coupleId, listingId);
  mirrorPriceToListingCost(coupleId, listingId, row);
  return listingId;
}

/** Raw row read, for callers that need the pre-DTO columns (the adopt + publish
 *  paths, which work off `listing_id` and the money columns). */
export function getRowById(id: string, coupleId: number): Row | null {
  return (
    (db
      .prepare("SELECT * FROM couple_suppliers WHERE id = ? AND couple_id = ?")
      .get(id, coupleId) as Row | undefined) ?? null
  );
}

/** Used by couple purge — drops every DIY supplier for a couple. Linked
 *  budget lines are also dropped (they ON DELETE CASCADE via couple_id,
 *  but we walk the table here to be defensive and to keep audit visibility). */
export function purgeByCoupleId(coupleId: number): number {
  const r = db.prepare("DELETE FROM couple_suppliers WHERE couple_id = ?").run(coupleId);
  return r.changes;
}
