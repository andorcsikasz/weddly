// The couple's `venue_name/venue_city/venue_address/venue_phone` +
// `location_lat/location_lng` columns are a denormalized COPY of whatever the
// "venue" category `couple_picks` row currently points at (a directory
// listing or a DIY `couple_suppliers` entry) — see couple_picks.ts's own
// header comment. Kulcsinfó, the public guest page, the run-sheet header and
// the Design page all read the copy directly, never the pick.
//
// Before this file, the ONLY writer of the copy was GuestPageEditorPage's
// applyVenue()/removeVenue(), which PATCHes /api/couples/current in the same
// user action as the pick write. Every OTHER way to change "which vendor is
// our venue" — the generic pick/un-pick toggle on a browse card or a supplier
// detail page, adopting a listing over a DIY row, editing a picked DIY venue's
// address, deleting the DIY row that's picked — left the copy stale, so a
// couple could un-pick their venue from /app/vendors in one click and still
// see the old address/phone on Kulcsinfó and the old name on their published
// guest page. `syncCoupleVenueFromPick` is the fix: call it after ANY of
// those mutations and the copy always converges to the pick's current truth,
// without the caller having to reason about what changed.
import { isSentinelPick } from "@shared/picks";
import { db, now } from "../db";
import { getById as getDiySupplier } from "./couple_suppliers";
import { getPick } from "./couple_picks";
import { resolveSupplierBase } from "./resolve_supplier";

interface VenueSnapshot {
  name: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
}

const EMPTY_VENUE: VenueSnapshot = {
  name: null,
  city: null,
  address: null,
  phone: null,
  lat: null,
  lng: null,
};

function writeVenueSnapshot(coupleId: number, v: VenueSnapshot): void {
  db.prepare(
    `UPDATE couples
        SET venue_name = ?, venue_city = ?, venue_address = ?, venue_phone = ?,
            location_lat = ?, location_lng = ?, updated_at = ?
      WHERE id = ?`,
  ).run(v.name, v.city, v.address, v.phone, v.lat, v.lng, now(), coupleId);
}

/** Re-derive the couple's denormalized venue fields from whatever the
 *  "venue" category pick currently points at. Idempotent and cheap (one read,
 *  one write) — safe to call after any mutation that could plausibly have
 *  touched the venue pick or the thing it points at, rather than requiring
 *  the caller to know whether this particular change mattered. */
export function syncCoupleVenueFromPick(coupleId: number): void {
  const pick = getPick(coupleId, "venue");
  if (!pick || isSentinelPick(pick.supplier_id)) {
    writeVenueSnapshot(coupleId, EMPTY_VENUE);
    return;
  }

  const dir = resolveSupplierBase(pick.supplier_id);
  if (dir) {
    writeVenueSnapshot(coupleId, {
      name: dir.name,
      city: dir.city || null,
      address: dir.address,
      phone: dir.contact_phone,
      lat: dir.lat,
      lng: dir.lng,
    });
    return;
  }

  const diy = getDiySupplier(pick.supplier_id, coupleId);
  if (diy) {
    writeVenueSnapshot(coupleId, {
      name: diy.name,
      city: diy.city,
      address: diy.address,
      phone: diy.contact_phone,
      lat: diy.lat,
      lng: diy.lng,
    });
    return;
  }

  // The pick points at something that no longer resolves (a deleted DIY row
  // the caller forgot to clear, a curated slug that was retired, a hidden
  // community submission) — treat it the same as no pick: clear the copy
  // rather than let a dangling reference show a stale venue forever.
  writeVenueSnapshot(coupleId, EMPTY_VENUE);
}
