// Resolve a public directory id (`v{N}` claimed listing, `c{N}` community
// submission, or a curated slug) back to its DirectorySupplierBase. Shared by
// the suppliers route (detail + tracked redirect) and the SEO layer (per-vendor
// og:card meta), so the "what does this public id point at" rule lives in ONE
// place. A hidden/deleted curated entry resolves to null on every public path.

import type { DirectorySupplierBase } from "@shared/suppliers";
import { listActiveCommunitySuppliers, toDirectorySupplierBase } from "./community_suppliers";
import { isCuratedPubliclyVisible } from "./curated_overrides";
import { getClaimedDirectoryBaseById } from "./listings";
import { DIRECTORY } from "./suppliers_data";

export function resolveSupplierBase(supplierId: string): DirectorySupplierBase | null {
  const curated = DIRECTORY.find((s) => s.id === supplierId);
  // A hidden/deleted curated entry 404s on the public detail + redirect paths.
  if (curated) return isCuratedPubliclyVisible(supplierId) ? curated : null;
  if (supplierId.startsWith("c")) {
    const community = listActiveCommunitySuppliers().find((c) => `c${c.id}` === supplierId);
    if (community) return toDirectorySupplierBase(community);
    // Fall through: a claimed community entry can also carry a c-id.
  }
  // Standalone registered-vendor ('claimed') listing (self-serve id `v{N}`).
  return getClaimedDirectoryBaseById(supplierId);
}
