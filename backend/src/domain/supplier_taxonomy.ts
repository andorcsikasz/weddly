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

export function buildTaxonomy(): SupplierTaxonomy {
  const groups = listGroups();
  const categories = listCategories();
  const byGroup = new Map<number, AdminSupplierCategory[]>();
  for (const c of categories) {
    const arr = byGroup.get(c.group_id) ?? [];
    arr.push(toCategory(c));
    byGroup.set(c.group_id, arr);
  }
  return {
    groups: groups.map((g) => ({
      ...toGroup(g),
      categories: byGroup.get(g.id) ?? [],
    })),
  };
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
  return row;
}

interface UpdateGroupInput {
  slug?: string;
  label_hu?: string;
  label_en?: string;
  sort_order?: number;
}

export function updateGroup(id: number, patch: UpdateGroupInput): SupplierGroupRow | null {
  const cur = getGroupById(id);
  if (!cur) return null;
  const ts = now();
  db.prepare(
    `UPDATE supplier_groups
        SET slug = ?, label_hu = ?, label_en = ?, sort_order = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    patch.slug ?? cur.slug,
    patch.label_hu ?? cur.label_hu,
    patch.label_en ?? cur.label_en,
    patch.sort_order ?? cur.sort_order,
    ts,
    id,
  );
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
  return row;
}

interface UpdateCategoryInput {
  group_id?: number;
  slug?: string;
  label_hu?: string;
  label_en?: string;
  budget_category?: string;
  sort_order?: number;
}

export function updateCategory(id: number, patch: UpdateCategoryInput): SupplierCategoryRow | null {
  const cur = getCategoryById(id);
  if (!cur) return null;
  const ts = now();
  db.prepare(
    `UPDATE supplier_categories
        SET group_id = ?, slug = ?, label_hu = ?, label_en = ?,
            budget_category = ?, sort_order = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    patch.group_id ?? cur.group_id,
    patch.slug ?? cur.slug,
    patch.label_hu ?? cur.label_hu,
    patch.label_en ?? cur.label_en,
    patch.budget_category ?? cur.budget_category,
    patch.sort_order ?? cur.sort_order,
    ts,
    id,
  );
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
    slug: "venue_stay",
    label_hu: "Helyszín & szállás",
    label_en: "Venue & stay",
    categories: [
      { slug: "venue", label_hu: "Esküvői helyszín", label_en: "Wedding venue", budget: "venue" },
      {
        slug: "accommodation",
        label_hu: "Szállás",
        label_en: "Accommodation",
        budget: "other",
      },
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
        label_en: "Cake & dessert",
        budget: "cake_dessert",
      },
      { slug: "bar_drinks", label_hu: "Bár & italok", label_en: "Bar & drinks", budget: "drinks" },
    ],
  },
  {
    slug: "atmosphere",
    label_hu: "Hangulat",
    label_en: "Atmosphere",
    categories: [
      {
        slug: "decor_floral",
        label_hu: "Dekoráció & virág",
        label_en: "Decor & floral",
        budget: "decor_floral",
      },
      { slug: "lighting", label_hu: "Világítás", label_en: "Lighting", budget: "decor_floral" },
    ],
  },
  {
    slug: "experience",
    label_hu: "Élmény",
    label_en: "Experience",
    categories: [
      { slug: "music_dj", label_hu: "Zene & DJ", label_en: "Music & DJ", budget: "music_dj" },
      {
        slug: "sound_tech",
        label_hu: "Hangtechnika",
        label_en: "Sound & AV tech",
        budget: "music_dj",
      },
      {
        slug: "photo_video",
        label_hu: "Fotó & videó",
        label_en: "Photo & video",
        budget: "photo_video",
      },
      {
        slug: "entertainment",
        label_hu: "Animáció & program",
        label_en: "Entertainment",
        budget: "music_dj",
      },
    ],
  },
  {
    slug: "style",
    label_hu: "Stílus",
    label_en: "Style",
    categories: [
      { slug: "attire", label_hu: "Ruha", label_en: "Attire", budget: "attire" },
      {
        slug: "hair_makeup",
        label_hu: "Smink & haj",
        label_en: "Hair & makeup",
        budget: "hair_makeup",
      },
      { slug: "nails", label_hu: "Köröm", label_en: "Nails", budget: "hair_makeup" },
      { slug: "rings", label_hu: "Jegygyűrű", label_en: "Wedding rings", budget: "rings" },
    ],
  },
  {
    slug: "details",
    label_hu: "Részletek",
    label_en: "Details",
    categories: [
      {
        slug: "stationery",
        label_hu: "Papír & nyomtatvány",
        label_en: "Stationery",
        budget: "stationery",
      },
      {
        slug: "wedding_website",
        label_hu: "Esküvői weboldal",
        label_en: "Wedding website",
        budget: "stationery",
      },
      { slug: "transport", label_hu: "Transzfer", label_en: "Transport", budget: "transport" },
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
    const existingSlugs = new Set(existingCats.map((c) => c.slug));
    let catOrder = existingCats.reduce((m, c) => Math.max(m, c.sort_order), 0) + 10;
    for (const c of g.categories) {
      if (existingSlugs.has(c.slug)) continue;
      db.prepare(
        `INSERT INTO supplier_categories
           (group_id, slug, label_hu, label_en, budget_category, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(groupId, c.slug, c.label_hu, c.label_en, c.budget, catOrder, ts, ts);
      catOrder += 10;
    }
  }
}
