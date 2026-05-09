// Public suppliers directory. Merges the static curated list with active
// user-submitted entries. v2 will swap the static list for a `suppliers` table.

import type { SupplierCategory } from "@shared/suppliers";
import { listActiveCommunitySuppliers, toDirectorySupplier } from "../domain/community_suppliers";
import { DIRECTORY } from "../domain/suppliers_data";
import { json, type Router } from "../lib/http";

export function registerSupplierRoutes(router: Router) {
  router.get("/api/suppliers", (ctx) => {
    const cat = ctx.url.searchParams.get("category");
    const curated = cat ? DIRECTORY.filter((s) => s.category === cat) : DIRECTORY;
    const community = listActiveCommunitySuppliers((cat as SupplierCategory | null) ?? null);
    return json({ suppliers: [...curated, ...community.map(toDirectorySupplier)] });
  });
}
