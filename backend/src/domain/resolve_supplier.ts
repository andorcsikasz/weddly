// Resolve a public directory id (`v{N}` claimed listing, `c{N}` community
// submission, or a curated slug) back to its DirectorySupplierBase. Shared by
// the suppliers route (detail + tracked redirect) and the SEO layer (per-vendor
// og:card meta), so the "what does this public id point at" rule lives in ONE
// place. A hidden/deleted curated entry resolves to null on every public path.

import type { DirectorySupplierBase } from "@shared/suppliers";
import { canonicalListingId } from "@shared/vendor_slug";
import { listActiveCommunitySuppliers, toDirectorySupplierBase } from "./community_suppliers";
import { isCuratedPubliclyVisible } from "./curated_overrides";
import { getClaimedDirectoryBaseById } from "./listings";
import { DIRECTORY } from "./suppliers_data";

export function resolveSupplierBase(supplierId: string): DirectorySupplierBase | null {
  // Exact curated slug first — curated ids are already human-readable, and this
  // wins over the pretty-id parsing below for a slug that happens to end in
  // `-v2` etc.
  const curated = DIRECTORY.find((s) => s.id === supplierId);
  // A hidden/deleted curated entry 404s on the public detail + redirect paths.
  if (curated) return isCuratedPubliclyVisible(supplierId) ? curated : null;

  // Accept a pretty share id (`magyar-foto-v12`): the trailing `v{N}` / `c{N}`
  // is the real id. Bare ids (`v12`, `c5`) pass straight through.
  const id = canonicalListingId(supplierId) ?? supplierId;

  if (id.startsWith("c")) {
    const community = listActiveCommunitySuppliers().find((c) => `c${c.id}` === id);
    if (community) return toDirectorySupplierBase(community);
    // Fall through: a claimed community entry can also carry a c-id.
  }
  // Standalone registered-vendor ('claimed') listing (self-serve id `v{N}`).
  return getClaimedDirectoryBaseById(id);
}
