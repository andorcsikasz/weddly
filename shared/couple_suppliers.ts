// "Csinálom magam" / DIY supplier entries. Private to a couple — never shown
// in the public directory, never moderated, never seen by other couples. The
// couple uses these to mark categories they're handling in-house (mum cooking,
// friend DJ-ing, etc.) so the directory page reflects their plan and the
// budget page shows the cost alongside booked vendors.
//
// A row that names a real BUSINESS is the exception, and `listing_id` is how it
// stops being a second card for something Weddly already shows: it binds the row
// to a directory listing, either one that existed all along or one we published
// on the couple's behalf. See the field's own note.

import type { SupplierCategory } from "./suppliers";

/** The directory listing a private row turned out to name. Carried on the DTO
 *  so ANY surface — the directory page, the planning board, the guest-page
 *  venue picker — can offer to switch to it, rather than each one loading and
 *  folding the whole directory to work it out for itself. */
export interface CoupleSupplierDirectoryMatch {
  /** Public directory id (`v12`, `c5`, or a curated slug). */
  id: string;
  name: string;
  city: string | null;
  category: SupplierCategory;
  hero_image_url: string | null;
}

export interface CoupleSupplier {
  id: string;
  /** Discriminator — the directory list renders curated / community / self
   *  cards with the same shell but distinct styling. */
  source: "self";
  name: string;
  category: SupplierCategory;
  notes: string | null;
  /** Integer Forint. Null = no price set yet. Setting a positive value
   *  causes the backend to create / update a paired `budget_lines` row. */
  price_huf: number | null;
  /** "Already paid?" flag. Defaults to false on create. When false the
   *  mirrored budget line carries the price in `planned_huf` only — the
   *  actual_huf stays at 0 so the dashboard doesn't read DIY plans as
   *  realized spend (Loop C₂ fix). When true, both columns equal price. */
  paid: boolean;
  /** Auto-managed FK to the locked budget line that mirrors `price_huf`.
   *  Null when there is no price or the line was removed externally. */
  budget_line_id: number | null;
  /** Payment schedule. Empty when the couple paid in one go (the `paid`
   *  boolean governs in that case). When non-empty, these installments are
   *  the source of truth: `paid` is derived (fully settled) and the mirrored
   *  budget line's actual_huf equals the sum of paid installments. Ordered by
   *  sort_order then due_date. */
  installments: SupplierInstallment[];
  /** Short free-text reminder of what to do next with this vendor (Kanban board). */
  next_step: string | null;
  /** 0–100 likelihood estimate used on the Kanban board to sort/colour cards. */
  probability: number | null;
  /** Location + contact, populated when this DIY entry is a real place the
   *  couple pinned on the map (chiefly a `category:"venue"` added from the
   *  guest-page venue picker). All null for the ordinary "mum's cooking" rows.
   *  `lat`/`lng` are set together; selecting such a venue copies them onto
   *  `couples.location_lat/lng` so the guest-page map pin can show. */
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  /** The directory listing this row stands for, once it has one. Set by the
   *  adopt path (the couple confirmed their row is a business Weddly already
   *  lists) or by the publish path (the business was new, so we listed it).
   *  Every surface renders such a row FROM the listing, which is what keeps one
   *  business to one card. Null for an ordinary private entry. */
  listing_id: string | null;
  /** A listing whose name folds to this row's, when the row isn't bound to one
   *  yet. The repair affordance: "this is already on Weddly, switch to it".
   *  Always null once `listing_id` is set — the question is answered. */
  directory_match: CoupleSupplierDirectoryMatch | null;
  created_at: number;
  updated_at: number;
}

/** One scheduled payment toward a supplier (deposit, balance, ...). */
export interface SupplierInstallment {
  id: number;
  supplier_id: string;
  /** Free-text name like "Deposit" / "Foglaló". Null when unlabelled. */
  label: string | null;
  /** Integer minor units of the couple's currency (see CoupleSupplier.price_huf). */
  amount_huf: number;
  /** ISO YYYY-MM-DD. Null = undated ("on the day"). */
  due_date: string | null;
  /** Derived from paid_at. */
  paid: boolean;
  /** Epoch ms when marked paid; null when unpaid. */
  paid_at: number | null;
  sort_order: number;
}

export interface CreateInstallmentInput {
  label?: string | null;
  amount_huf: number;
  due_date?: string | null;
  paid?: boolean;
}

export interface UpdateInstallmentInput {
  label?: string | null;
  amount_huf?: number;
  due_date?: string | null;
  paid?: boolean;
}

/** Location + contact a caller may set on a DIY entry (a mapped venue). `lat`
 *  and `lng` must be sent together; a string field sent as `""` clears it. */
export interface CoupleSupplierPlaceInput {
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

export interface CreateCoupleSupplierInput extends CoupleSupplierPlaceInput {
  name: string;
  category: SupplierCategory;
  notes?: string | null;
  price_huf?: number | null;
  /** Defaults to false on the server. */
  paid?: boolean;
  probability?: number | null;
  next_step?: string | null;
  /** The server refuses a name that folds to a listing it already carries, so
   *  the row can't become a second card for one business. Send this ONLY when
   *  the couple was shown the match and answered "this is a different vendor" —
   *  two real businesses can share a name in two different towns. */
  confirm_not_listed?: boolean;
}

export interface UpdateCoupleSupplierInput extends CoupleSupplierPlaceInput {
  name?: string;
  category?: SupplierCategory;
  notes?: string | null;
  price_huf?: number | null;
  paid?: boolean;
  probability?: number | null;
  next_step?: string | null;
}
