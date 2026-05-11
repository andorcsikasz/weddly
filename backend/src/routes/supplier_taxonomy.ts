// Supplier taxonomy: one public read, four admin write endpoints.
//
// The public route is unauthenticated so the directory page + supplier-submit
// modal can render the dropdowns. Every mutation is gated by requireAdmin().

import type {
  CreateSupplierCategoryInput,
  CreateSupplierGroupInput,
  UpdateSupplierCategoryInput,
  UpdateSupplierGroupInput,
} from "@shared/supplier_taxonomy";
import {
  buildTaxonomy,
  categoriesInGroup,
  createCategory,
  createGroup,
  deleteCategory,
  deleteGroup,
  getCategoryById,
  getGroupById,
  suppliersInCategory,
  toCategory,
  toGroup,
  updateCategory,
  updateGroup,
} from "../domain/supplier_taxonomy";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

/** URL-safe slug: lower-case letters, digits, underscores. */
const SLUG_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

function parseSlug(raw: unknown, field = "slug"): string {
  if (typeof raw !== "string") throw new HttpError(400, `${field} is required`);
  const trimmed = raw.trim().toLowerCase();
  if (!SLUG_RE.test(trimmed)) {
    throw new HttpError(
      400,
      `${field} must be lowercase letters / digits / underscores (got ${JSON.stringify(raw)})`,
    );
  }
  return trimmed;
}

function parseLabel(raw: unknown, field: string): string {
  if (typeof raw !== "string") throw new HttpError(400, `${field} is required`);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    throw new HttpError(400, `${field} must be 1–120 characters`);
  }
  return trimmed;
}

function parseOptInt(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new HttpError(400, `${field} must be an integer`);
  }
  return n;
}

// ─── Public read ─────────────────────────────────────────────────────────────

function handleGetTaxonomy(_ctx: Ctx): Response {
  return json(buildTaxonomy());
}

// ─── Admin: groups ───────────────────────────────────────────────────────────

async function handleCreateGroup(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<Partial<CreateSupplierGroupInput>>(ctx.req);
  const slug = parseSlug(body.slug);
  const label_hu = parseLabel(body.label_hu, "label_hu");
  const label_en = parseLabel(body.label_en, "label_en");
  const sort_order = parseOptInt(body.sort_order, "sort_order");

  try {
    const row = createGroup({ slug, label_hu, label_en, sort_order });
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "admin.supplier_group_create",
      target_kind: "supplier_group",
      target_id: row.id,
      after: { slug, label_hu, label_en },
    });
    return json({ group: toGroup(row) }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
      throw new HttpError(409, `Slug already exists: ${slug}`);
    }
    throw e;
  }
}

async function handleUpdateGroup(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const before = getGroupById(id);
  if (!before) throw new HttpError(404, "Group not found");

  const body = await readJson<Partial<UpdateSupplierGroupInput>>(ctx.req);
  const patch: UpdateSupplierGroupInput = {};
  if (body.slug !== undefined) patch.slug = parseSlug(body.slug);
  if (body.label_hu !== undefined) patch.label_hu = parseLabel(body.label_hu, "label_hu");
  if (body.label_en !== undefined) patch.label_en = parseLabel(body.label_en, "label_en");
  const sortOrder = parseOptInt(body.sort_order, "sort_order");
  if (sortOrder !== undefined) patch.sort_order = sortOrder;

  try {
    const row = updateGroup(id, patch);
    if (!row) throw new HttpError(404, "Group not found");
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "admin.supplier_group_update",
      target_kind: "supplier_group",
      target_id: id,
      before: { slug: before.slug, label_hu: before.label_hu, label_en: before.label_en },
      after: patch,
    });
    return json({ group: toGroup(row) });
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
      throw new HttpError(409, "Slug already exists");
    }
    throw e;
  }
}

function handleDeleteGroup(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const before = getGroupById(id);
  if (!before) throw new HttpError(404, "Group not found");

  // Prevent FK orphans — admin must move/delete categories first.
  const count = categoriesInGroup(id);
  if (count > 0) {
    throw new HttpError(
      409,
      `Group still has ${count} categor${count === 1 ? "y" : "ies"} — move or delete them first.`,
    );
  }

  deleteGroup(id);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.supplier_group_delete",
    target_kind: "supplier_group",
    target_id: id,
    before,
  });
  return json({ ok: true });
}

// ─── Admin: categories ───────────────────────────────────────────────────────

async function handleCreateCategory(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<Partial<CreateSupplierCategoryInput>>(ctx.req);
  const group_id = parseOptInt(body.group_id, "group_id");
  if (group_id === undefined) throw new HttpError(400, "group_id is required");
  if (!getGroupById(group_id)) throw new HttpError(404, "Group not found");
  const slug = parseSlug(body.slug);
  const label_hu = parseLabel(body.label_hu, "label_hu");
  const label_en = parseLabel(body.label_en, "label_en");
  const budget_category =
    typeof body.budget_category === "string" && body.budget_category.trim()
      ? body.budget_category.trim()
      : "other";
  const sort_order = parseOptInt(body.sort_order, "sort_order");

  try {
    const row = createCategory({
      group_id,
      slug,
      label_hu,
      label_en,
      budget_category,
      sort_order,
    });
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "admin.supplier_category_create",
      target_kind: "supplier_category",
      target_id: row.id,
      after: { slug, label_hu, label_en, group_id, budget_category },
    });
    return json({ category: toCategory(row) }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
      throw new HttpError(409, `Slug already exists: ${slug}`);
    }
    throw e;
  }
}

async function handleUpdateCategory(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const before = getCategoryById(id);
  if (!before) throw new HttpError(404, "Category not found");

  const body = await readJson<Partial<UpdateSupplierCategoryInput>>(ctx.req);
  const patch: UpdateSupplierCategoryInput = {};
  if (body.group_id !== undefined) {
    const gid = parseOptInt(body.group_id, "group_id");
    if (gid !== undefined) {
      if (!getGroupById(gid)) throw new HttpError(404, "Group not found");
      patch.group_id = gid;
    }
  }
  if (body.slug !== undefined) patch.slug = parseSlug(body.slug);
  if (body.label_hu !== undefined) patch.label_hu = parseLabel(body.label_hu, "label_hu");
  if (body.label_en !== undefined) patch.label_en = parseLabel(body.label_en, "label_en");
  if (body.budget_category !== undefined) {
    const bc = typeof body.budget_category === "string" ? body.budget_category.trim() : "";
    if (bc.length === 0) throw new HttpError(400, "budget_category cannot be empty");
    patch.budget_category = bc;
  }
  const sortOrder = parseOptInt(body.sort_order, "sort_order");
  if (sortOrder !== undefined) patch.sort_order = sortOrder;

  try {
    const row = updateCategory(id, patch);
    if (!row) throw new HttpError(404, "Category not found");
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "admin.supplier_category_update",
      target_kind: "supplier_category",
      target_id: id,
      before: { slug: before.slug, label_hu: before.label_hu, label_en: before.label_en },
      after: patch,
    });
    return json({ category: toCategory(row) });
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
      throw new HttpError(409, "Slug already exists");
    }
    throw e;
  }
}

function handleDeleteCategory(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  const before = getCategoryById(id);
  if (!before) throw new HttpError(404, "Category not found");

  const count = suppliersInCategory(before.slug);
  if (count > 0) {
    throw new HttpError(
      409,
      `Category still references ${count} community supplier${count === 1 ? "" : "s"} — reassign or hide them first.`,
    );
  }

  deleteCategory(id);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.supplier_category_delete",
    target_kind: "supplier_category",
    target_id: id,
    before,
  });
  return json({ ok: true });
}

export function registerSupplierTaxonomyRoutes(router: Router) {
  router.get("/api/supplier-categories", handleGetTaxonomy);
  router.post("/api/admin/supplier-groups", handleCreateGroup, true);
  router.patch("/api/admin/supplier-groups/:id", handleUpdateGroup, true);
  router.delete("/api/admin/supplier-groups/:id", handleDeleteGroup, true);
  router.post("/api/admin/supplier-categories", handleCreateCategory, true);
  router.patch("/api/admin/supplier-categories/:id", handleUpdateCategory, true);
  router.delete("/api/admin/supplier-categories/:id", handleDeleteCategory, true);
}
