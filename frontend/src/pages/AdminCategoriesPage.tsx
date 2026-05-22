import type {
  AdminSupplierCategory,
  AdminSupplierGroup,
  SupplierTaxonomyGroup,
} from "@shared/supplier_taxonomy";
import { Eye, EyeOff, LayoutList, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import { Button, Dialog, Skeleton, TextField, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminSupplierTaxonomyApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type EditTarget =
  | { kind: "new-group" }
  | { kind: "edit-group"; group: AdminSupplierGroup }
  | { kind: "new-category"; groupId: number }
  | { kind: "edit-category"; category: AdminSupplierCategory };

export default function AdminCategoriesPage() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [groups, setGroups] = useState<SupplierTaxonomyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Admin endpoint includes hidden rows so the editor can render the
      // hide/unhide toggle alongside the rest. The public consumer keeps
      // hitting `/api/supplier-categories` and never sees hidden entries.
      const r = await adminSupplierTaxonomyApi.list();
      setGroups(r.groups);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  async function onToggleHideGroup(g: AdminSupplierGroup) {
    const nextHidden = !g.hidden;
    try {
      await adminSupplierTaxonomyApi.updateGroup(g.id, { hidden: nextHidden });
      toast.success(
        nextHidden ? t("admin.taxonomy_hide_success") : t("admin.taxonomy_unhide_success"),
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onToggleHideCategory(c: AdminSupplierCategory) {
    const nextHidden = !c.hidden;
    try {
      await adminSupplierTaxonomyApi.updateCategory(c.id, { hidden: nextHidden });
      toast.success(
        nextHidden ? t("admin.taxonomy_hide_success") : t("admin.taxonomy_unhide_success"),
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onDeleteGroup(g: AdminSupplierGroup) {
    const ok = await confirm({
      title: t("admin.taxonomy_delete_group_confirm_title"),
      body: `${g.label_hu} / ${g.label_en} — ${t("admin.taxonomy_delete_group_confirm_body")}`,
      confirmLabel: t("admin.taxonomy_delete"),
      cancelLabel: t("admin.taxonomy_cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminSupplierTaxonomyApi.removeGroup(g.id);
      toast.success(t("admin.taxonomy_delete"));
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("admin.taxonomy_delete_group_blocked"));
      } else {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      }
    }
  }

  async function onDeleteCategory(c: AdminSupplierCategory) {
    const ok = await confirm({
      title: t("admin.taxonomy_delete_category_confirm_title"),
      body: `${c.label_hu} / ${c.label_en} — ${t("admin.taxonomy_delete_category_confirm_body")}`,
      confirmLabel: t("admin.taxonomy_delete"),
      cancelLabel: t("admin.taxonomy_cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminSupplierTaxonomyApi.removeCategory(c.id);
      toast.success(t("admin.taxonomy_delete"));
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("admin.taxonomy_delete_category_blocked"));
      } else {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      }
    }
  }

  return (
    <>
      <AdminPageHeader
        title={t("admin.taxonomy_title")}
        subtitle={t("admin.taxonomy_sub")}
        actions={
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => setEditing({ kind: "new-group" })}
          >
            <Plus size={14} />
            <span>{t("admin.taxonomy_add_group")}</span>
          </button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, gi) => (
            <section key={gi} className="admin-card p-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-200 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <Skeleton width={220} height={16} />
                  <Skeleton width={90} height={12} />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Skeleton width={120} height={28} rounded="md" />
                  <Skeleton width={28} height={28} rounded="md" />
                  <Skeleton width={28} height={28} rounded="md" />
                </div>
              </div>
              <ul className="divide-y divide-paper-200 dark:divide-umber-700">
                {Array.from({ length: 2 }).map((_, ci) => (
                  <li
                    key={ci}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="flex flex-col gap-1.5">
                      <Skeleton width={260} height={14} />
                      <Skeleton width={140} height={12} />
                    </div>
                    <div className="flex gap-1">
                      <Skeleton width={28} height={28} rounded="md" />
                      <Skeleton width={28} height={28} rounded="md" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <AdminEmptyState
          icon={<LayoutList size={28} />}
          title={t("admin.taxonomy_empty_title")}
          description={t("admin.taxonomy_empty")}
          action={
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => setEditing({ kind: "new-group" })}
            >
              <Plus size={14} />
              <span>{t("admin.taxonomy_add_group")}</span>
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section
              key={g.id}
              className={`admin-card p-0 overflow-hidden ${g.hidden ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-200 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-4 py-3">
                <div className="flex flex-col gap-1">
                  <div className="font-medium text-ink-900 dark:text-paper-50">
                    {g.label_hu}
                    <span className="mx-2 text-ink-300 dark:text-umber-300">·</span>
                    <span className="text-ink-500 dark:text-umber-300">{g.label_en}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone="muted">{g.slug}</Pill>
                    <Pill tone="paper">
                      {t("admin.taxonomy_category_count", { n: g.categories.length })}
                    </Pill>
                    {g.hidden && <Pill tone="violet">{t("admin.taxonomy_hidden_badge")}</Pill>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditing({ kind: "new-category", groupId: g.id })}
                  >
                    <Plus size={14} /> {t("admin.taxonomy_add_category")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditing({ kind: "edit-group", group: g })}
                    aria-label={t("admin.taxonomy_edit")}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => onToggleHideGroup(g)}
                  >
                    {g.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    <span>{g.hidden ? t("admin.taxonomy_unhide") : t("admin.taxonomy_hide")}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-alert btn-sm"
                    onClick={() => onDeleteGroup(g)}
                  >
                    <Trash2 size={14} />
                    <span>{t("admin.taxonomy_delete")}</span>
                  </button>
                </div>
              </div>
              {g.categories.length === 0 ? (
                <div className="px-4 py-3 text-sm text-ink-500 dark:text-umber-300">
                  {t("admin.taxonomy_group_empty")}
                </div>
              ) : (
                <ul className="divide-y divide-paper-200 dark:divide-umber-700">
                  {g.categories.map((c) => (
                    <li
                      key={c.id}
                      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors duration-150 hover:bg-paper-100/60 dark:hover:bg-umber-800/60 ${
                        c.hidden ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="text-ink-900 dark:text-paper-50">
                          {c.label_hu}
                          <span className="mx-2 text-ink-300 dark:text-umber-300">·</span>
                          <span className="text-ink-500 dark:text-umber-300">{c.label_en}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Pill tone="muted">{c.slug}</Pill>
                          <Pill tone="violet">{c.budget_category}</Pill>
                          {c.hidden && (
                            <Pill tone="violet">{t("admin.taxonomy_hidden_badge")}</Pill>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setEditing({ kind: "edit-category", category: c })}
                          aria-label={t("admin.taxonomy_edit")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => onToggleHideCategory(c)}
                        >
                          {c.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                          <span>
                            {c.hidden ? t("admin.taxonomy_unhide") : t("admin.taxonomy_hide")}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="btn-alert btn-sm"
                          onClick={() => onDeleteCategory(c)}
                        >
                          <Trash2 size={14} />
                          <span>{t("admin.taxonomy_delete")}</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {editing && (
        <EditorDialog target={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </>
  );
}

function EditorDialog({
  target,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const isGroup = target.kind === "new-group" || target.kind === "edit-group";

  const [slug, setSlug] = useState(() =>
    target.kind === "edit-group"
      ? target.group.slug
      : target.kind === "edit-category"
        ? target.category.slug
        : "",
  );
  const [labelHu, setLabelHu] = useState(() =>
    target.kind === "edit-group"
      ? target.group.label_hu
      : target.kind === "edit-category"
        ? target.category.label_hu
        : "",
  );
  const [labelEn, setLabelEn] = useState(() =>
    target.kind === "edit-group"
      ? target.group.label_en
      : target.kind === "edit-category"
        ? target.category.label_en
        : "",
  );
  const [budget, setBudget] = useState(() =>
    target.kind === "edit-category" ? target.category.budget_category : "other",
  );
  const [submitting, setSubmitting] = useState(false);

  const title =
    target.kind === "new-group"
      ? t("admin.taxonomy_new_group_title")
      : target.kind === "edit-group"
        ? t("admin.taxonomy_edit_group_title")
        : target.kind === "new-category"
          ? t("admin.taxonomy_new_category_title")
          : t("admin.taxonomy_edit_category_title");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (target.kind === "new-group") {
        await adminSupplierTaxonomyApi.createGroup({
          slug: slug.trim().toLowerCase(),
          label_hu: labelHu.trim(),
          label_en: labelEn.trim(),
        });
      } else if (target.kind === "edit-group") {
        await adminSupplierTaxonomyApi.updateGroup(target.group.id, {
          slug: slug.trim().toLowerCase(),
          label_hu: labelHu.trim(),
          label_en: labelEn.trim(),
        });
      } else if (target.kind === "new-category") {
        await adminSupplierTaxonomyApi.createCategory({
          group_id: target.groupId,
          slug: slug.trim().toLowerCase(),
          label_hu: labelHu.trim(),
          label_en: labelEn.trim(),
          budget_category: budget.trim() || "other",
        });
      } else {
        await adminSupplierTaxonomyApi.updateCategory(target.category.id, {
          slug: slug.trim().toLowerCase(),
          label_hu: labelHu.trim(),
          label_en: labelEn.trim(),
          budget_category: budget.trim() || "other",
        });
      }
      toast.success(t("admin.taxonomy_save"));
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={title}
      role="dialog"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose}>
            {t("admin.taxonomy_cancel")}
          </Button>
          <Button variant="primary" type="submit" form="taxonomy-editor-form" disabled={submitting}>
            {submitting ? t("admin.taxonomy_saving") : t("admin.taxonomy_save")}
          </Button>
        </>
      }
    >
      <form id="taxonomy-editor-form" onSubmit={submit} className="grid gap-3">
        <TextField
          id="taxonomy-slug"
          label={isGroup ? t("admin.taxonomy_group_slug") : t("admin.taxonomy_category_slug")}
          helperText={t("admin.taxonomy_slug_help")}
          placeholder="venue_stay"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          autoFocus
        />
        <TextField
          id="taxonomy-label-hu"
          label={
            isGroup ? t("admin.taxonomy_group_label_hu") : t("admin.taxonomy_category_label_hu")
          }
          value={labelHu}
          onChange={(e) => setLabelHu(e.target.value)}
        />
        <TextField
          id="taxonomy-label-en"
          label={
            isGroup ? t("admin.taxonomy_group_label_en") : t("admin.taxonomy_category_label_en")
          }
          value={labelEn}
          onChange={(e) => setLabelEn(e.target.value)}
        />
        {!isGroup && (
          <TextField
            id="taxonomy-budget"
            label={t("admin.taxonomy_category_budget")}
            helperText={t("admin.taxonomy_category_budget_help")}
            placeholder="other"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        )}
      </form>
    </Dialog>
  );
}
