// Admin-editable supplier taxonomy contract.
//
// V1 of the directory used a TypeScript literal union in shared/suppliers.ts
// (SupplierCategory). This contract represents the same data as DB-backed
// rows so admins can rename / reorder / create groups and categories.

export interface AdminSupplierGroup {
  id: number;
  /** URL-safe identifier; stable across renames so existing references hold. */
  slug: string;
  label_hu: string;
  label_en: string;
  sort_order: number;
  /** When true, the group + all its categories are filtered out of the
   *  public taxonomy endpoint (couple-facing dropdowns + the directory).
   *  Admin keeps seeing them on /app/admin/categories so they can unhide.
   *  Reversible alternative to delete — community-supplier rows referencing
   *  a hidden category don't orphan. */
  hidden: boolean;
}

export interface AdminSupplierCategory {
  id: number;
  group_id: number;
  slug: string;
  label_hu: string;
  label_en: string;
  /** Budget-line bucket this category folds into for the cost panel
   *  (see SUPPLIER_TO_BUDGET in shared/suppliers.ts for the legacy map). */
  budget_category: string;
  sort_order: number;
  /** When true, the category is filtered out of the public taxonomy
   *  endpoint. Admin keeps the row to allow unhide; community-supplier
   *  references survive (the slug still resolves). Soft-delete companion
   *  to the hard DELETE which is gated on those references being zero. */
  hidden: boolean;
}

/** Wire shape for the public `GET /api/supplier-categories` endpoint and
 *  the admin list endpoint — categories are nested under their group. */
export interface SupplierTaxonomyGroup extends AdminSupplierGroup {
  categories: AdminSupplierCategory[];
}

export interface SupplierTaxonomy {
  groups: SupplierTaxonomyGroup[];
}

// ─── Write inputs ────────────────────────────────────────────────────────────

export interface CreateSupplierGroupInput {
  slug: string;
  label_hu: string;
  label_en: string;
  sort_order?: number;
}

export interface UpdateSupplierGroupInput {
  slug?: string;
  label_hu?: string;
  label_en?: string;
  sort_order?: number;
  /** Toggle visibility on the public taxonomy endpoint. True hides the
   *  group + every category under it; false brings them back. */
  hidden?: boolean;
}

export interface CreateSupplierCategoryInput {
  group_id: number;
  slug: string;
  label_hu: string;
  label_en: string;
  budget_category?: string;
  sort_order?: number;
}

export interface UpdateSupplierCategoryInput {
  group_id?: number;
  slug?: string;
  label_hu?: string;
  label_en?: string;
  budget_category?: string;
  sort_order?: number;
  /** Toggle visibility on the public taxonomy endpoint. True hides only
   *  this category; the parent group stays visible if it has other
   *  non-hidden categories. */
  hidden?: boolean;
}
