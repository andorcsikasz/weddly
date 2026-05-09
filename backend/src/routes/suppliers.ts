// Static suppliers directory (v1). Public read-only. v2 swaps this for the
// `suppliers` DB table + booking/messaging.

import { DIRECTORY } from "../domain/suppliers_data";
import { json, type Router } from "../lib/http";

export function registerSupplierRoutes(router: Router) {
  router.get("/api/suppliers", (ctx) => {
    const cat = ctx.url.searchParams.get("category");
    const filtered = cat ? DIRECTORY.filter((s) => s.category === cat) : DIRECTORY;
    return json({ suppliers: filtered });
  });
}
