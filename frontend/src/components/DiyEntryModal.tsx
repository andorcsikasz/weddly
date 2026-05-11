// "Csinálom magam" / DIY entry modal. Used to record private supplier
// entries — the couple is handling a category in-house (mum cooking, friend
// DJ-ing) or via an informal arrangement that doesn't belong in the public
// directory. Setting `price_huf` causes the backend to mirror the value into
// a locked budget line; clearing it removes the line.

import type { CoupleSupplier } from "@shared/couple_suppliers";
import type { SupplierCategory } from "@shared/suppliers";
import { SUPPLIER_GROUPS } from "@shared/suppliers";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { coupleSupplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button, Dialog, FieldError, HelperText, TextField, useConfirm, useToast } from "./ui";

type Props = {
  open: boolean;
  onClose: () => void;
  /** When set, the modal opens in edit mode for this entry. */
  editing?: CoupleSupplier | null;
  /** Pre-fills the category when opening fresh. Ignored in edit mode. */
  defaultCategory?: SupplierCategory | null;
  onSaved: (supplier: CoupleSupplier) => void;
  onDeleted?: (id: string) => void;
};

interface FormState {
  name: string;
  category: SupplierCategory | "";
  notes: string;
  /** Stored as the raw string the user typed; coerced to integer Forint on
   *  submit. Empty string means "no price set". */
  price: string;
}

function emptyForm(defaultCategory: SupplierCategory | null | undefined): FormState {
  return {
    name: "",
    category: defaultCategory ?? "",
    notes: "",
    price: "",
  };
}

function fromSupplier(s: CoupleSupplier): FormState {
  return {
    name: s.name,
    category: s.category,
    notes: s.notes ?? "",
    price: s.price_huf !== null ? String(s.price_huf) : "",
  };
}

type ErrorKey = "name" | "category" | "price";

export function DiyEntryModal({
  open,
  onClose,
  editing,
  defaultCategory,
  onSaved,
  onDeleted,
}: Props) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultCategory));
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reset form whenever the modal opens with a different prefill.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(editing ? fromSupplier(editing) : emptyForm(defaultCategory));
  }, [open, editing, defaultCategory]);

  // Focus the first field shortly after mount so keyboard users land on it.
  useEffect(() => {
    if (!open) return;
    const tid = window.setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => window.clearTimeout(tid);
  }, [open]);

  // Flatten the supplier groups into a flat category list. Sub-category
  // labels come from the i18n tree.
  const categoryOptions = useMemo(() => SUPPLIER_GROUPS.flatMap((g) => g.categories), []);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((cur) => ({ ...cur, [key]: value }));
  }

  function validate(): boolean {
    const next: Partial<Record<ErrorKey, string>> = {};
    if (!form.name.trim()) next.name = t("suppliers.submit.err_required");
    if (!form.category) next.category = t("suppliers.submit.err_required");
    if (form.price.trim()) {
      const n = Number(form.price);
      if (!Number.isFinite(n) || n < 0) next.price = t("common.error_generic");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const priceParsed = form.price.trim() ? Math.round(Number(form.price)) : null;
      const body = {
        name: form.name.trim(),
        category: form.category as SupplierCategory,
        notes: form.notes.trim() || null,
        price_huf: priceParsed,
      };
      const res = editing
        ? await coupleSupplierApi.update(editing.id, body)
        : await coupleSupplierApi.create(body);
      onSaved(res.supplier);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("common.error_generic");
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    const ok = await confirm({
      title: t("suppliers.diy_modal_delete_confirm_title"),
      body: t("suppliers.diy_modal_delete_confirm_body"),
      confirmLabel: t("suppliers.diy_modal_delete"),
      cancelLabel: t("suppliers.diy_modal_cancel"),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await coupleSupplierApi.remove(editing.id);
      onDeleted?.(editing.id);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("common.error_generic");
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      role="dialog"
      title={t("suppliers.diy_modal_title")}
      closeOnBackdrop
      footer={
        <>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {t("suppliers.diy_modal_delete")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={saving || deleting}>
            {t("suppliers.diy_modal_cancel")}
          </Button>
          <Button
            type="submit"
            form="diy-entry-form"
            variant="primary"
            disabled={saving || deleting}
          >
            {saving ? t("suppliers.diy_modal_submitting") : t("suppliers.diy_modal_submit")}
          </Button>
        </>
      }
    >
      <form id="diy-entry-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-ink-500">{t("suppliers.diy_modal_intro")}</p>

        <TextField
          id="diy-name"
          ref={firstFieldRef}
          label={t("suppliers.diy_modal_name_label")}
          placeholder={t("suppliers.diy_modal_name_placeholder")}
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          errorText={errors.name}
          required
        />

        <div className="block">
          <label htmlFor="diy-category" className="field-label">
            {t("suppliers.diy_modal_category_label")}
            <span aria-hidden className="ml-0.5 text-blush-700">
              *
            </span>
          </label>
          <select
            id="diy-category"
            className="input"
            value={form.category}
            onChange={(e) => setField("category", e.target.value as SupplierCategory)}
            aria-invalid={errors.category ? true : undefined}
          >
            <option value="" disabled>
              —
            </option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {t(`suppliers.cat.${c}`)}
              </option>
            ))}
          </select>
          {errors.category && <FieldError id="diy-category-error">{errors.category}</FieldError>}
        </div>

        <div className="block">
          <label htmlFor="diy-notes" className="field-label">
            {t("suppliers.diy_modal_notes_label")}
          </label>
          <textarea
            id="diy-notes"
            className="input min-h-[5rem]"
            placeholder={t("suppliers.diy_modal_notes_placeholder")}
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="block">
          <label htmlFor="diy-price" className="field-label">
            {t("suppliers.diy_modal_price_label")}
          </label>
          <input
            id="diy-price"
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            className="input"
            value={form.price}
            onChange={(e) => setField("price", e.target.value)}
            aria-invalid={errors.price ? true : undefined}
          />
          {errors.price ? (
            <FieldError id="diy-price-error">{errors.price}</FieldError>
          ) : (
            <HelperText id="diy-price-help">{t("suppliers.diy_modal_price_help")}</HelperText>
          )}
        </div>

        <p className="rounded-xl bg-paper-100 px-3 py-2 text-xs text-ink-500">
          {t("suppliers.diy_modal_privacy")}
        </p>
      </form>
    </Dialog>
  );
}
