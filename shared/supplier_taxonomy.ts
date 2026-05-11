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
}
