// "Channel over to vendor" modal for the admin user directory. Collects the
// two things a fresh vendor listing needs that we can't infer from a couple
// account — the business/display name (prefilled from the person's full name)
// and the supplier category — then hands them to AdminUsersPage which calls
// /api/admin/users/:id/convert-to-vendor. Everything else (address, phone,
// description) the vendor completes in their own onboarding wizard afterwards.

import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";
import { Dialog } from "./ui";

interface Props {
  open: boolean;
  /** Email of the account being converted — surfaced in the title so the admin
   *  can confirm they're acting on the right row. */
  targetEmail: string;
  /** Prefill for the business-name field (the person's full name). */
  defaultBusinessName: string;
  /** Disable submit + show "converting" copy while the request is in flight. */
  pending: boolean;
  onClose: () => void;
  /** Wired to `adminUserApi.convertToVendor(...)` by the caller, which manages
   *  toasts + refetch and closes the dialog on success. */
  onConfirm: (body: {
    business_name: string;
    category: SupplierCategory;
    custom_category?: string;
  }) => void;
}

export function ConvertToVendorDialog({
  open,
  targetEmail,
  defaultBusinessName,
  pending,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useT();
  const [businessName, setBusinessName] = useState(defaultBusinessName);
  const [category, setCategory] = useState<SupplierCategory | "">("");
  const [customCategory, setCustomCategory] = useState("");

  // Reset every time the dialog opens on a fresh target so it never inherits
  // the previous conversion's typing.
  useEffect(() => {
    if (open) {
      setBusinessName(defaultBusinessName);
      setCategory("");
      setCustomCategory("");
    }
  }, [open, defaultBusinessName]);

  const needsCustom = category === "other";
  const valid =
    businessName.trim().length > 0 &&
    category !== "" &&
    (!needsCustom || customCategory.trim().length > 0);

  return (
    <Dialog
      open={open}
      title={`${t("admin.convert_vendor_title")}: ${targetEmail}`}
      onClose={onClose}
      role="dialog"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={pending || !valid}
            onClick={() =>
              valid &&
              onConfirm({
                business_name: businessName.trim(),
                category: category as SupplierCategory,
                custom_category: needsCustom ? customCategory.trim() : undefined,
              })
            }
          >
            {pending ? t("admin.convert_vendor_pending") : t("admin.convert_vendor_confirm")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-ink-500 dark:text-umber-300">{t("admin.convert_vendor_help")}</p>
        <div>
          <label className="field-label" htmlFor="cv-name">
            {t("admin.convert_vendor_business_name")}
          </label>
          <input
            id="cv-name"
            type="text"
            className="input"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            maxLength={120}
            disabled={pending}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="cv-category">
            {t("admin.convert_vendor_category")}
          </label>
          <select
            id="cv-category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as SupplierCategory | "")}
            disabled={pending}
          >
            <option value="" disabled>
              {t("vendor_register.category_placeholder")}
            </option>
            {SUPPLIER_GROUPS.map((g) => (
              <optgroup key={g.id} label={t(`suppliers.group.${g.id}`)}>
                {g.categories.map((c) => (
                  <option key={c} value={c}>
                    {c === "other"
                      ? t("vendor_register.category_other_option")
                      : t(`suppliers.cat.${c}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {needsCustom && (
          <div>
            <label className="field-label" htmlFor="cv-custom-category">
              {t("vendor_register.custom_category_label")}
            </label>
            <input
              id="cv-custom-category"
              type="text"
              className="input"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              maxLength={60}
              placeholder={t("vendor_register.custom_category_placeholder")}
              disabled={pending}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
