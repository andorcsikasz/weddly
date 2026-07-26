// Admin-editable supplier taxonomy (groups + categories).
//
// The taxonomy was originally a TypeScript literal union in
// shared/suppliers.ts (SUPPLIER_GROUPS / SupplierCategory). Phase 1 of the
// admin-editable feature moves it into two DB tables and seeds them once
// from the legacy constants + i18n labels. The existing static directory
// (suppliers_data.ts) and community submissions still reference categories
// by slug — the seed preserves those slugs so nothing breaks.

import type {
  AdminSupplierCategory,
  AdminSupplierGroup,
  SupplierTaxonomy,
} from "@shared/supplier_taxonomy";
import { db, now } from "../db";

export interface SupplierGroupRow {
  id: number;
  slug: string;
  label_hu: string;
  label_en: string;
  sort_order: number;
  /** 0 / 1; mapped to boolean on the DTO. */
  hidden: number;
  created_at: number;
  updated_at: number;
}

export interface SupplierCategoryRow {
  id: number;
  group_id: number;
  slug: string;
  label_hu: string;
  label_en: string;
  budget_category: string;
  sort_order: number;
  /** 0 / 1; mapped to boolean on the DTO. */
  hidden: number;
  created_at: number;
  updated_at: number;
}

export function toGroup(row: SupplierGroupRow): AdminSupplierGroup {
  return {
    id: row.id,
    slug: row.slug,
    label_hu: row.label_hu,
    label_en: row.label_en,
    sort_order: row.sort_order,
    hidden: row.hidden === 1,
  };
}

export function toCategory(row: SupplierCategoryRow): AdminSupplierCategory {
  return {
    id: row.id,
    group_id: row.group_id,
    slug: row.slug,
    label_hu: row.label_hu,
    label_en: row.label_en,
    budget_category: row.budget_category,
    sort_order: row.sort_order,
    hidden: row.hidden === 1,
  };
}

export function listGroups(): SupplierGroupRow[] {
  return db
    .prepare("SELECT * FROM supplier_groups ORDER BY sort_order ASC, id ASC")
    .all() as SupplierGroupRow[];
}

export function listCategories(): SupplierCategoryRow[] {
  return db
    .prepare("SELECT * FROM supplier_categories ORDER BY group_id ASC, sort_order ASC, id ASC")
    .all() as SupplierCategoryRow[];
}

export function getGroupById(id: number): SupplierGroupRow | null {
  return (
    (db.prepare("SELECT * FROM supplier_groups WHERE id = ?").get(id) as
      | SupplierGroupRow
      | undefined) ?? null
  );
}

export function getCategoryById(id: number): SupplierCategoryRow | null {
  return (
    (db.prepare("SELECT * FROM supplier_categories WHERE id = ?").get(id) as
      | SupplierCategoryRow
      | undefined) ?? null
  );
}

// Taxonomy is a small (~6 groups, ~14 categories) static-ish dataset read on
// every supplier-dropdown render and on app boot. The 500-user load test
// pushed `GET /api/supplier-categories` to p95 ≈ 2.1s under contention even
// though the on-disk data hadn't changed for the duration of the run.
// Memoise both rebuilt responses (public-filtered + admin-full) in-process
// and invalidate them on any admin mutation via invalidateTaxonomyCache().
let cachedPublicTaxonomy: SupplierTaxonomy | null = null;
let cachedAdminTaxonomy: SupplierTaxonomy | null = null;

export function invalidateTaxonomyCache(): void {
  cachedPublicTaxonomy = null;
  cachedAdminTaxonomy = null;
}

/** Public taxonomy — filters out hidden groups + hidden categories. A
 *  hidden GROUP masks every category under it regardless of the per-
 *  category flag, so the couple-facing dropdowns never surface a
 *  hidden branch even partially. */
export function buildTaxonomy(): SupplierTaxonomy {
  if (cachedPublicTaxonomy) return cachedPublicTaxonomy;
  const groups = listGroups().filter((g) => g.hidden !== 1);
  const categories = listCategories().filter((c) => c.hidden !== 1);
  const byGroup = new Map<number, AdminSupplierCategory[]>();
  for (const c of categories) {
    const arr = byGroup.get(c.group_id) ?? [];
    arr.push(toCategory(c));
    byGroup.set(c.group_id, arr);
  }
  cachedPublicTaxonomy = {
    groups: groups.map((g) => ({
      ...toGroup(g),
      categories: byGroup.get(g.id) ?? [],
    })),
  };
  return cachedPublicTaxonomy;
}

/** Admin taxonomy — every group + every category, hidden flag intact.
 *  Used by `/api/admin/supplier-taxonomy` so /app/admin/categories can
 *  render hidden rows with a badge + unhide button. Same shape as the
 *  public taxonomy so the admin page can reuse the existing UI. */
export function buildAdminTaxonomy(): SupplierTaxonomy {
  if (cachedAdminTaxonomy) return cachedAdminTaxonomy;
  const groups = listGroups();
  const categories = listCategories();
  const byGroup = new Map<number, AdminSupplierCategory[]>();
  for (const c of categories) {
    const arr = byGroup.get(c.group_id) ?? [];
    arr.push(toCategory(c));
    byGroup.set(c.group_id, arr);
  }
  cachedAdminTaxonomy = {
    groups: groups.map((g) => ({
      ...toGroup(g),
      categories: byGroup.get(g.id) ?? [],
    })),
  };
  return cachedAdminTaxonomy;
}

/** Bumps the next sort_order so newly created rows land at the end. */
function nextGroupOrder(): number {
  const r = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM supplier_groups")
    .get() as { n: number } | undefined;
  return r?.n ?? 10;
}

function nextCategoryOrder(groupId: number): number {
  const r = db
    .prepare(
      "SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM supplier_categories WHERE group_id = ?",
    )
    .get(groupId) as { n: number } | undefined;
  return r?.n ?? 10;
}

interface CreateGroupInput {
  slug: string;
  label_hu: string;
  label_en: string;
  sort_order?: number;
}

export function createGroup(input: CreateGroupInput): SupplierGroupRow {
  const ts = now();
  const sortOrder = input.sort_order ?? nextGroupOrder();
  const r = db
    .prepare(
      `INSERT INTO supplier_groups (slug, label_hu, label_en, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.slug, input.label_hu, input.label_en, sortOrder, ts, ts);
  const id = Number(r.lastInsertRowid);
  const row = getGroupById(id);
  if (!row) throw new Error("Failed to insert supplier_group");
  invalidateTaxonomyCache();
  return row;
}

interface UpdateGroupInput {
  slug?: string;
  label_hu?: string;
  label_en?: string;
  sort_order?: number;
  hidden?: boolean;
}

export function updateGroup(id: number, patch: UpdateGroupInput): SupplierGroupRow | null {
  const cur = getGroupById(id);
  if (!cur) return null;
  const ts = now();
  const nextHidden = patch.hidden === undefined ? cur.hidden : patch.hidden ? 1 : 0;
  db.prepare(
    `UPDATE supplier_groups
        SET slug = ?, label_hu = ?, label_en = ?, sort_order = ?, hidden = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    patch.slug ?? cur.slug,
    patch.label_hu ?? cur.label_hu,
    patch.label_en ?? cur.label_en,
    patch.sort_order ?? cur.sort_order,
    nextHidden,
    ts,
    id,
  );
  invalidateTaxonomyCache();
  return getGroupById(id);
}

/** Returns the number of categories in this group — used to gate delete. */
export function categoriesInGroup(groupId: number): number {
  const r = db
    .prepare("SELECT COUNT(*) AS c FROM supplier_categories WHERE group_id = ?")
    .get(groupId) as { c: number };
  return r.c;
}

export function deleteGroup(id: number): void {
  db.prepare("DELETE FROM supplier_groups WHERE id = ?").run(id);
  invalidateTaxonomyCache();
}

interface CreateCategoryInput {
  group_id: number;
  slug: string;
  label_hu: string;
  label_en: string;
  budget_category?: string;
  sort_order?: number;
}

export function createCategory(input: CreateCategoryInput): SupplierCategoryRow {
  const ts = now();
  const sortOrder = input.sort_order ?? nextCategoryOrder(input.group_id);
  const r = db
    .prepare(
      `INSERT INTO supplier_categories
         (group_id, slug, label_hu, label_en, budget_category, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.group_id,
      input.slug,
      input.label_hu,
      input.label_en,
      input.budget_category ?? "other",
      sortOrder,
      ts,
      ts,
    );
  const id = Number(r.lastInsertRowid);
  const row = getCategoryById(id);
  if (!row) throw new Error("Failed to insert supplier_category");
  invalidateTaxonomyCache();
  return row;
}

interface UpdateCategoryInput {
  group_id?: number;
  slug?: string;
  label_hu?: string;
  label_en?: string;
  budget_category?: string;
  sort_order?: number;
  hidden?: boolean;
}

export function updateCategory(id: number, patch: UpdateCategoryInput): SupplierCategoryRow | null {
  const cur = getCategoryById(id);
  if (!cur) return null;
  const ts = now();
  const nextHidden = patch.hidden === undefined ? cur.hidden : patch.hidden ? 1 : 0;
  db.prepare(
    `UPDATE supplier_categories
        SET group_id = ?, slug = ?, label_hu = ?, label_en = ?,
            budget_category = ?, sort_order = ?, hidden = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    patch.group_id ?? cur.group_id,
    patch.slug ?? cur.slug,
    patch.label_hu ?? cur.label_hu,
    patch.label_en ?? cur.label_en,
    patch.budget_category ?? cur.budget_category,
    patch.sort_order ?? cur.sort_order,
    nextHidden,
    ts,
    id,
  );
  invalidateTaxonomyCache();
  return getCategoryById(id);
}

/** Suppliers (curated + community) reference categories by slug. Gate
 *  category deletes on this count so the directory doesn't 404. */
export function suppliersInCategory(slug: string): number {
  // Curated suppliers live in code (suppliers_data.ts) and never reference
  // admin-deleted slugs by construction, so we only have to check community
  // submissions in the DB.
  const r = db
    .prepare("SELECT COUNT(*) AS c FROM community_suppliers WHERE category = ?")
    .get(slug) as { c: number };
  return r.c;
}

export function deleteCategory(id: number): void {
  db.prepare("DELETE FROM supplier_categories WHERE id = ?").run(id);
  invalidateTaxonomyCache();
}

// ─── Seed ────────────────────────────────────────────────────────────────────

interface SeedGroup {
  slug: string;
  label_hu: string;
  label_en: string;
  categories: { slug: string; label_hu: string; label_en: string; budget: string }[];
}

/**
 * Static taxonomy frozen from the legacy TypeScript literals + the
 * `suppliers.group.*` and `suppliers.cat.*` i18n keys. Seed runs ONCE on
 * boot when both tables are empty — after that the admin owns the data.
 */
const SEED: SeedGroup[] = [
  {
    slug: "planning_rentals",
    label_hu: "Szervezés",
    label_en: "Planning",
    categories: [
      {
        slug: "wedding_planner",
        label_hu: "Esküvőszervező",
        label_en: "Wedding planner",
        budget: "other",
      },
    ],
  },
  {
    slug: "venue_stay",
    label_hu: "Helyszín & szállás",
    label_en: "Venue & stay",
    categories: [
      { slug: "venue", label_hu: "Esküvői helyszín", label_en: "Wedding venue", budget: "venue" },
      { slug: "accommodation", label_hu: "Szállás", label_en: "Accommodation", budget: "other" },
      {
        slug: "tent_pavilion",
        label_hu: "Sátor & pavilon",
        label_en: "Tent & pavilion",
        budget: "venue",
      },
    ],
  },
  {
    slug: "food_drink",
    label_hu: "Étel & ital",
    label_en: "Food & drink",
    categories: [
      { slug: "catering", label_hu: "Catering", label_en: "Catering", budget: "catering" },
      {
        slug: "cake_dessert",
        label_hu: "Torta & desszert",
        label_en: "Cakes & desserts",
        budget: "cake_dessert",
      },
      {
        slug: "bar_drinks",
        label_hu: "Bár & koktél",
        label_en: "Bar & cocktails",
        budget: "drinks",
      },
      { slug: "food_trucks", label_hu: "Food truck", label_en: "Food trucks", budget: "catering" },
    ],
  },
  {
    slug: "decor_flowers",
    label_hu: "Dekor & virág",
    label_en: "Decor & flowers",
    categories: [
      {
        slug: "wedding_decor",
        label_hu: "Dekoráció",
        label_en: "Wedding decor",
        budget: "decor_floral",
      },
      { slug: "florist", label_hu: "Virágkötő", label_en: "Florist", budget: "decor_floral" },
      { slug: "lighting", label_hu: "Világítás", label_en: "Lighting", budget: "decor_floral" },
      {
        slug: "rental_equipment",
        label_hu: "Kölcsönzés & technika",
        label_en: "Rental & equipment",
        budget: "other",
      },
    ],
  },
  {
    slug: "media",
    label_hu: "Média",
    label_en: "Media",
    categories: [
      { slug: "photography", label_hu: "Fotó", label_en: "Photography", budget: "photo_video" },
      { slug: "videography", label_hu: "Videó", label_en: "Videography", budget: "photo_video" },
      {
        slug: "content_creator",
        label_hu: "Tartalomkészítő",
        label_en: "Content creator",
        budget: "photo_video",
      },
      {
        slug: "photo_booth",
        label_hu: "Fotófülke",
        label_en: "Photo booth",
        budget: "photo_video",
      },
    ],
  },
  {
    slug: "entertainment",
    label_hu: "Zene & szórakoztatás",
    label_en: "Entertainment",
    categories: [
      { slug: "dj", label_hu: "DJ", label_en: "DJ", budget: "music_dj" },
      { slug: "live_music", label_hu: "Élőzene", label_en: "Live music", budget: "music_dj" },
      {
        slug: "entertainment",
        label_hu: "Műsor & animáció",
        label_en: "Entertainment",
        budget: "music_dj",
      },
      {
        slug: "mc_celebrant",
        label_hu: "Ceremóniamester",
        label_en: "Master of ceremonies",
        budget: "music_dj",
      },
      {
        slug: "celebrant",
        label_hu: "Szertartásvezető",
        label_en: "Celebrant",
        budget: "other",
      },
      {
        slug: "sound_tech",
        label_hu: "Hangtechnika",
        label_en: "Sound & AV tech",
        budget: "music_dj",
      },
    ],
  },
  {
    slug: "fashion_beauty",
    label_hu: "Divat & szépség",
    label_en: "Fashion & beauty",
    categories: [
      {
        slug: "bridal_boutique",
        label_hu: "Menyasszonyi ruha",
        label_en: "Bridal boutique",
        budget: "attire",
      },
      {
        slug: "suit_formal",
        label_hu: "Öltöny & alkalmi",
        label_en: "Suit & formal wear",
        budget: "attire",
      },
      {
        slug: "hair_makeup",
        label_hu: "Smink & haj",
        label_en: "Hair & makeup",
        budget: "hair_makeup",
      },
      { slug: "nails", label_hu: "Köröm", label_en: "Nails", budget: "hair_makeup" },
      {
        slug: "wedding_jewelry",
        label_hu: "Ékszer",
        label_en: "Wedding jewelry",
        budget: "rings",
      },
    ],
  },
  {
    slug: "paper_design",
    label_hu: "Papír & grafika",
    label_en: "Paper goods & design",
    categories: [
      {
        slug: "stationery",
        label_hu: "Meghívó & papíráru",
        label_en: "Invitations & paper goods",
        budget: "stationery",
      },
      {
        slug: "invitation_graphics",
        label_hu: "Meghívó & esküvői grafika",
        label_en: "Invitation & wedding graphics",
        budget: "stationery",
      },
    ],
  },
  {
    slug: "transport",
    label_hu: "Transzfer",
    label_en: "Transport",
    categories: [
      {
        slug: "transport",
        label_hu: "Transzfer",
        label_en: "Wedding transport",
        budget: "transport",
      },
    ],
  },
];

/** Idempotent. On an empty DB it lays down the full SEED. On an existing DB
 *  it only inserts missing seed groups/categories (matched by slug) — never
 *  modifies or deletes admin-edited rows. This lets us add new entries to
 *  SEED and have them appear in prod on next boot without a manual migration,
 *  while still respecting any renames the admin has done. Safe on every boot. */
export function seedSupplierTaxonomy(): void {
  const ts = now();
  const existingGroups = listGroups();
  const groupIdBySlug = new Map<string, number>();
  for (const g of existingGroups) groupIdBySlug.set(g.slug, g.id);

  let groupOrder = existingGroups.reduce((m, g) => Math.max(m, g.sort_order), 0) + 10;
  for (const g of SEED) {
    let groupId = groupIdBySlug.get(g.slug);
    if (groupId === undefined) {
      const groupRes = db
        .prepare(
          `INSERT INTO supplier_groups (slug, label_hu, label_en, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(g.slug, g.label_hu, g.label_en, groupOrder, ts, ts);
      groupId = Number(groupRes.lastInsertRowid);
      groupIdBySlug.set(g.slug, groupId);
      groupOrder += 10;
    }

    const existingCats = db
      .prepare("SELECT slug, sort_order FROM supplier_categories WHERE group_id = ?")
      .all(groupId) as { slug: string; sort_order: number }[];
    let catOrder = existingCats.reduce((m, c) => Math.max(m, c.sort_order), 0) + 10;
    for (const c of g.categories) {
      // `slug` is globally UNIQUE. Look it up across ALL groups, not just this
      // one, so the v2 restructure (which MOVES some kept-slug categories, e.g.
      // entertainment/sound_tech, to a new group) can't hit a UNIQUE violation.
      const existing = db
        .prepare("SELECT id, group_id FROM supplier_categories WHERE slug = ?")
        .get(c.slug) as { id: number; group_id: number } | undefined;
      if (existing) {
        // A category that moved groups: re-parent it to its v2 group ONCE and
        // refresh its labels/budget + unhide. After this, group_id matches, so
        // subsequent boots skip it — admin edits from then on are preserved.
        if (existing.group_id !== groupId) {
          db.prepare(
            `UPDATE supplier_categories
                SET group_id = ?, label_hu = ?, label_en = ?, budget_category = ?, hidden = 0, updated_at = ?
              WHERE id = ?`,
          ).run(groupId, c.label_hu, c.label_en, c.budget, ts, existing.id);
          catOrder += 10;
        }
        continue;
      }
      db.prepare(
        `INSERT INTO supplier_categories
           (group_id, slug, label_hu, label_en, budget_category, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(groupId, c.slug, c.label_hu, c.label_en, c.budget, catOrder, ts, ts);
      catOrder += 10;
    }
  }
  invalidateTaxonomyCache();
}

/** The v2 taxonomy (July 2026) reshaped the groups. The additive seed above adds
 *  the new groups/categories but never removes the old ones, so on an existing
 *  DB the pre-v2 groups (planning, atmosphere, experience, style, details) and
 *  their categories linger and would show alongside the new structure — some as
 *  duplicate slugs for categories that moved groups. This idempotent pass
 *  soft-hides any group not in the current SEED plus every category under it,
 *  leaving the admin able to un-hide/audit them. Run once per boot after the
 *  seed. Categories that kept their group (venue, catering, …) are untouched. */
export function retireLegacyTaxonomy(): void {
  const validGroups = SEED.map((g) => g.slug);
  const placeholders = validGroups.map(() => "?").join(",");
  const ts = now();
  const hiddenGroups = db
    .prepare(
      `UPDATE supplier_groups SET hidden = 1, updated_at = ?
        WHERE hidden = 0 AND slug NOT IN (${placeholders})`,
    )
    .run(ts, ...validGroups).changes;
  const hiddenCats = db
    .prepare(
      `UPDATE supplier_categories SET hidden = 1, updated_at = ?
        WHERE hidden = 0 AND group_id IN (SELECT id FROM supplier_groups WHERE hidden = 1)`,
    )
    .run(ts).changes;
  if (hiddenGroups > 0 || hiddenCats > 0) {
    invalidateTaxonomyCache();
    console.log(`[taxonomy] retired ${hiddenGroups} legacy group(s), ${hiddenCats} category(ies)`);
  }
}
