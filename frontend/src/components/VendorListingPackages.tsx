// Vendor listing "Packages" editor (árajánlat) — the optional price offers that
// sit below the video reel on the vendor listing page. Kept self-contained (own
// busy state + toasts + confirm) so it reads as a natural extension of the
// gallery/reel without bloating VendorListingPage.
//
// Each package is a small card: a vendor-named tier, an optional free-text
// price, an optional description, and an optional attached PDF price list. The
// name field offers category-appropriate suggestion chips (a photographer, a
// cake studio and a venue each get relevant starting points). Every mutation
// hits the server immediately and the parent re-renders from the returned view,
// mirroring the videos/gallery flow.

import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, Pencil, Plus, Trash2, Upload } from "lucide-react";
import {
  type ListingPackage,
  MAX_LISTING_PACKAGES,
  PACKAGE_DESCRIPTION_MAX,
  PACKAGE_NAME_MAX,
  PACKAGE_PDF_MAX_BYTES,
  PACKAGE_PRICE_MAX,
  packageNameSuggestions,
} from "@shared/listing_packages";
import type { VendorListingView } from "@shared/listings";
import type { SupplierCategory } from "@shared/suppliers";
import { ApiError } from "../lib/api";
import { vendorListingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useConfirm } from "./ui";
import { useToast } from "./ui/ToastProvider";

/** Read the server error `code` off an ApiError's detail, if any. */
function errCode(err: unknown): string | undefined {
  if (err instanceof ApiError) return (err.detail as { code?: string } | null)?.code;
  return (err as { detail?: { code?: string } } | undefined)?.detail?.code;
}

export function VendorListingPackages({
  packages,
  category,
  onChange,
}: {
  packages: ListingPackage[];
  category: SupplierCategory;
  onChange: (view: VendorListingView) => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  // The card the vendor just added — starts expanded so they can fill it in
  // right away; every other card starts collapsed for a compact list.
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  const suggestions = packageNameSuggestions(category, locale);
  const atCap = packages.length >= MAX_LISTING_PACKAGES;

  const onAdd = async () => {
    if (atCap || adding) return;
    setAdding(true);
    try {
      const name = suggestions[0] ?? t("vendor_home.packages_default_name");
      const prevIds = new Set(packages.map((p) => p.id));
      const view = await vendorListingApi.addPackage({ name });
      const added = view.packages?.find((p) => !prevIds.has(p.id));
      onChange(view);
      if (added) setJustAddedId(added.id);
      toast.success(t("vendor_home.packages_add_success"));
    } catch (err) {
      toast.error(
        errCode(err) === "packages_full"
          ? t("vendor_home.packages_full", { max: String(MAX_LISTING_PACKAGES) })
          : t("vendor_home.packages_add_failed"),
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <fieldset className="card space-y-3 p-4">
      <legend className="font-semibold">{t("vendor_home.section_packages")}</legend>

      {packages.length > 0 && (
        <ul className="space-y-3">
          {packages.map((p) => (
            <PackageCard
              key={p.id}
              pkg={p}
              suggestions={suggestions}
              onChange={onChange}
              defaultOpen={p.id === justAddedId}
            />
          ))}
        </ul>
      )}

      {!atCap && (
        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={adding}
          className="btn inline-flex items-center gap-1.5 bg-steel-600 text-white hover:bg-steel-700 disabled:opacity-50"
        >
          <Plus size={16} aria-hidden />
          {t("vendor_home.packages_add")}
        </button>
      )}

      <p className="text-xs text-ink-500 dark:text-umber-300">
        {t("vendor_home.packages_count", {
          n: String(packages.length),
          max: String(MAX_LISTING_PACKAGES),
        })}
      </p>
    </fieldset>
  );
}

function PackageCard({
  pkg,
  suggestions,
  onChange,
  defaultOpen = false,
}: {
  pkg: ListingPackage;
  suggestions: string[];
  onChange: (view: VendorListingView) => void;
  defaultOpen?: boolean;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState(pkg.name);
  const [priceText, setPriceText] = useState(pkg.price_text ?? "");
  const [description, setDescription] = useState(pkg.description ?? "");
  const [busy, setBusy] = useState(false);
  // Renaming from the collapsed header. A rename is the one edit a vendor makes
  // without wanting to see the rest of the card, and it used to cost an expand
  // plus a scroll to a "CSOMAG NEVE" field.
  const [renaming, setRenaming] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);

  // Resync drafts when the persisted values change (after a save, or an
  // unrelated view refresh). Value-based deps so a re-render that doesn't touch
  // THIS package's fields never clobbers an in-progress edit on another card.
  useEffect(() => {
    setName(pkg.name);
    setPriceText(pkg.price_text ?? "");
    setDescription(pkg.description ?? "");
  }, [pkg.name, pkg.price_text, pkg.description]);

  const dirty =
    name !== pkg.name ||
    priceText !== (pkg.price_text ?? "") ||
    description !== (pkg.description ?? "");
  const nameValid = name.trim().length > 0;

  // Enter in a single-line field must NOT submit the outer listing <form>.
  const noEnterSubmit = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
  };

  const onSave = async () => {
    if (!dirty || !nameValid || busy) return;
    setBusy(true);
    try {
      const view = await vendorListingApi.updatePackage(pkg.id, {
        name: name.trim(),
        price_text: priceText.trim() || null,
        description: description.trim() || null,
      });
      onChange(view);
      toast.success(t("vendor_home.packages_saved"));
    } catch {
      toast.error(t("vendor_home.packages_save_failed"));
    } finally {
      setBusy(false);
    }
  };

  // Focus + select on entering rename mode: the vendor is renaming, so the old
  // name should be replaceable with one keystroke.
  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  /** Leaving the inline field commits, unless the name is unchanged or was
   *  emptied — an empty package name is what the editor's own validation
   *  refuses, so it reverts rather than saving a nameless card. */
  const commitRename = () => {
    setRenaming(false);
    if (!name.trim()) {
      setName(pkg.name);
      return;
    }
    if (name.trim() === pkg.name) return;
    void onSave();
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: t("vendor_home.packages_delete_confirm_title"),
      body: t("vendor_home.packages_delete_confirm_body", { name: pkg.name }),
      confirmLabel: t("vendor_home.packages_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const view = await vendorListingApi.deletePackage(pkg.id);
      onChange(view);
      toast.success(t("vendor_home.packages_delete_success"));
    } catch {
      toast.error(t("vendor_home.packages_delete_failed"));
    } finally {
      setBusy(false);
    }
  };

  const onPickPdf = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a failure
    if (!file) return;
    if (file.size > PACKAGE_PDF_MAX_BYTES) {
      toast.error(t("vendor_home.packages_pdf_too_large", { max: "8" }));
      return;
    }
    setBusy(true);
    try {
      const view = await vendorListingApi.uploadPackagePdf(pkg.id, file);
      onChange(view);
      toast.success(t("vendor_home.packages_pdf_upload_success"));
    } catch (err) {
      const code = errCode(err);
      toast.error(
        code === "file_too_large"
          ? t("vendor_home.packages_pdf_too_large", { max: "8" })
          : code === "unsupported_type"
            ? t("vendor_home.packages_pdf_invalid")
            : t("vendor_home.packages_pdf_upload_failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const onRemovePdf = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const view = await vendorListingApi.deletePackagePdf(pkg.id);
      onChange(view);
      toast.success(t("vendor_home.packages_pdf_removed"));
    } catch {
      toast.error(t("vendor_home.packages_pdf_upload_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="overflow-hidden rounded-lg border border-paper-300 dark:border-umber-700">
      {/* Collapsible header — name + price summary, click to expand/collapse.
          A row, not one big button: the title doubles as an inline rename field
          and an <input> can't live inside a <button>. */}
      <div className="flex w-full items-center gap-2.5 px-3 py-2.5">
        {renaming ? (
          <input
            ref={renameRef}
            className="input min-w-0 flex-1 !py-1 text-sm font-medium"
            value={name}
            maxLength={PACKAGE_NAME_MAX}
            disabled={busy}
            aria-label={t("vendor_home.packages_name_label")}
            placeholder={t("vendor_home.packages_name_placeholder")}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setName(pkg.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={`pkg-body-${pkg.id}`}
              className="-my-2.5 -ml-3 flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-3 text-left transition-colors hover:bg-paper-50 dark:hover:bg-umber-800/50"
            >
              <ChevronDown
                size={16}
                aria-hidden
                className={`shrink-0 text-ink-400 transition-transform dark:text-umber-300 ${open ? "" : "-rotate-90"}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-800 dark:text-paper-100">
                  {name.trim() || t("vendor_home.packages_default_name")}
                </span>
                {priceText.trim() && (
                  <span className="block truncate text-xs text-ink-500 dark:text-umber-300">
                    {priceText.trim()}
                  </span>
                )}
              </span>
            </button>
            {/* Muted rather than hover-only: on a touch screen there is no
                hover, and an affordance nobody can see is the bug we're fixing. */}
            <button
              type="button"
              onClick={() => setRenaming(true)}
              disabled={busy}
              aria-label={t("vendor_home.packages_rename")}
              title={t("vendor_home.packages_rename")}
              className="shrink-0 rounded-md p-1.5 text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink-700 dark:text-umber-400 dark:hover:bg-umber-700 dark:hover:text-paper-100"
            >
              <Pencil size={14} aria-hidden />
            </button>
          </>
        )}
        {pkg.pdf_url && (
          <FileText size={14} aria-hidden className="shrink-0 text-ink-400 dark:text-umber-300" />
        )}
        {dirty && (
          <span className="shrink-0 rounded-full bg-steel-100 px-2 py-0.5 text-[11px] font-medium text-steel-700 dark:bg-steel-400/15 dark:text-steel-300">
            {t("vendor_home.packages_unsaved")}
          </span>
        )}
      </div>

      {open && (
        <div
          id={`pkg-body-${pkg.id}`}
          className="space-y-2.5 border-t border-paper-200 p-3 dark:border-umber-800"
        >
          {/* Name + category-aware suggestion chips */}
          <div>
            <label className="field-label" htmlFor={`pkg-name-${pkg.id}`}>
              {t("vendor_home.packages_name_label")}
            </label>
            <input
              id={`pkg-name-${pkg.id}`}
              className="input"
              value={name}
              maxLength={PACKAGE_NAME_MAX}
              disabled={busy}
              placeholder={t("vendor_home.packages_name_placeholder")}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={noEnterSubmit}
            />
            {suggestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-500 dark:text-umber-300">
                  {t("vendor_home.packages_suggestions_label")}
                </span>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setName(s)}
                    className="rounded-full border border-paper-300 bg-paper-50 px-2.5 py-0.5 text-xs text-ink-700 transition hover:border-steel-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Optional free-text price */}
          <div>
            <label className="field-label" htmlFor={`pkg-price-${pkg.id}`}>
              {t("vendor_home.packages_price_label")}
            </label>
            <input
              id={`pkg-price-${pkg.id}`}
              className="input"
              value={priceText}
              maxLength={PACKAGE_PRICE_MAX}
              disabled={busy}
              placeholder={t("vendor_home.packages_price_placeholder")}
              onChange={(e) => setPriceText(e.target.value)}
              onKeyDown={noEnterSubmit}
            />
          </div>

          {/* Optional description */}
          <div>
            <label className="field-label" htmlFor={`pkg-desc-${pkg.id}`}>
              {t("vendor_home.packages_desc_label")}
            </label>
            <textarea
              id={`pkg-desc-${pkg.id}`}
              className="input"
              rows={2}
              maxLength={PACKAGE_DESCRIPTION_MAX}
              value={description}
              disabled={busy}
              placeholder={t("vendor_home.packages_desc_placeholder")}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Optional PDF price list */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => void onPickPdf(e)}
            />
            {pkg.pdf_url ? (
              <>
                <a
                  href={pkg.pdf_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-sm text-steel-700 hover:underline dark:text-steel-300"
                >
                  <FileText size={15} aria-hidden />
                  {pkg.pdf_name ?? t("vendor_home.packages_pdf_label")}
                </a>
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={busy}
                  className="btn-ghost px-2 py-1 text-xs disabled:opacity-50"
                >
                  {t("vendor_home.packages_pdf_replace")}
                </button>
                <button
                  type="button"
                  onClick={() => void onRemovePdf()}
                  disabled={busy}
                  className="btn-ghost px-2 py-1 text-xs text-blush-600 disabled:opacity-50 dark:text-blush-300"
                >
                  {t("vendor_home.packages_pdf_remove")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-paper-400 px-3 py-1.5 text-sm text-ink-600 transition hover:border-steel-400 disabled:opacity-50 dark:border-umber-600 dark:text-umber-200"
              >
                <Upload size={15} aria-hidden />
                {t("vendor_home.packages_pdf_upload")}
              </button>
            )}
            <span className="text-xs text-ink-400 dark:text-umber-400">
              {t("vendor_home.packages_pdf_hint")}
            </span>
          </div>

          {/* Row actions */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={busy}
              className="inline-flex items-center gap-1 text-sm text-blush-600 transition hover:text-blush-700 disabled:opacity-50 dark:text-blush-300"
            >
              <Trash2 size={15} aria-hidden />
              {t("vendor_home.packages_delete")}
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={!dirty || !nameValid || busy}
              className="btn bg-steel-600 px-3 py-1.5 text-sm text-white hover:bg-steel-700 disabled:opacity-50"
            >
              {t("vendor_home.packages_save")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
