// Vendor listing "Packages" editor (árajánlat) — the optional price offers that
// sit below the video reel on the vendor listing page. Kept self-contained (own
// busy state + toasts + confirm) so it reads as a natural extension of the
// gallery/reel without bloating VendorListingPage.
//
// Each package is a small card: a vendor-named tier, a structured price range
// with total/per-person mode, an optional description, and an attached PDF. The
// name field offers category-appropriate suggestion chips (a photographer, a
// cake studio and a venue each get relevant starting points). Every mutation
// hits the server immediately and the parent re-renders from the returned view,
// mirroring the videos/gallery flow.

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, Pencil, Plus, Trash2, Upload } from "lucide-react";
import type { Currency } from "@shared/currency";
import {
  type ListingPackage,
  MAX_LISTING_PACKAGES,
  PACKAGE_DESCRIPTION_MAX,
  PACKAGE_NAME_MAX,
  PACKAGE_PDF_MAX_BYTES,
  packageNameSuggestions,
} from "@shared/listing_packages";
import {
  convertedPrice,
  hasStructuredPrice,
  PACKAGE_AMOUNT_MAX,
  type PackagePriceMode,
} from "@shared/listing_pricing";
import type { VendorListingView } from "@shared/listings";
import type { SupplierCategory } from "@shared/suppliers";
import { ApiError } from "../lib/api";
import { vendorListingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { formatPackagePrice } from "../lib/listingPricing";
import { CurrencySelect } from "./CurrencySelect";
import { MoneyInput } from "./MoneyInput";
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
  currency,
  currencyOverride,
  capacityMin,
  capacityMax,
  onChange,
}: {
  packages: ListingPackage[];
  category: SupplierCategory;
  currency: Currency;
  currencyOverride: Currency | null;
  capacityMin: number | null;
  capacityMax: number | null;
  onChange: (view: VendorListingView) => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [currencyBusy, setCurrencyBusy] = useState(false);
  // The card the vendor just added — starts expanded so they can fill it in
  // right away; every other card starts collapsed for a compact list.
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  const suggestions = packageNameSuggestions(category, locale);
  const atCap = packages.length >= MAX_LISTING_PACKAGES;

  const saveCurrency = async (next: Currency | null) => {
    if (currencyBusy) return;
    setCurrencyBusy(true);
    try {
      onChange(await vendorListingApi.patch({ currency: next }));
      toast.success(t("vendor_home.packages_currency_saved"));
    } catch {
      toast.error(t("vendor_home.packages_currency_failed"));
    } finally {
      setCurrencyBusy(false);
    }
  };

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
    <fieldset className="vp-card p-5">
      {/* Title row carries the count, so the footer doesn't need a second line
          of chrome saying the same thing in words. */}
      <div className="flex items-baseline justify-between gap-3">
        <legend className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
          {t("vendor_home.section_packages")}
        </legend>
        <span className="text-xs tabular-nums text-ink-500 dark:text-umber-300">
          {t("vendor_home.packages_count", {
            n: String(packages.length),
            max: String(MAX_LISTING_PACKAGES),
          })}
        </span>
      </div>

      <div className="mb-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper-50 px-3 py-2 dark:bg-umber-800/55">
        <span className="text-sm text-ink-600 dark:text-umber-200">
          {t("vendor_home.packages_currency_label")}
        </span>
        <span className="flex items-center gap-2">
          <CurrencySelect
            value={currency}
            onChange={(next) => void saveCurrency(next)}
            label={t("vendor_home.packages_currency_label")}
            size="compact"
          />
          {currencyOverride !== null && (
            <button
              type="button"
              disabled={currencyBusy}
              onClick={() => void saveCurrency(null)}
              className="vp-btn-quiet text-xs"
            >
              {t("vendor_home.packages_currency_reset")}
            </button>
          )}
        </span>
      </div>

      {packages.length > 0 && (
        <ul className="divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-800 dark:border-umber-800">
          {packages.map((p) => (
            <PackageCard
              key={p.id}
              pkg={p}
              suggestions={suggestions}
              currency={currency}
              capacityMin={capacityMin}
              capacityMax={capacityMax}
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
          className="vp-btn-secondary mt-4 w-full"
        >
          <Plus size={16} aria-hidden />
          {t("vendor_home.packages_add")}
        </button>
      )}
    </fieldset>
  );
}

function PackageCard({
  pkg,
  suggestions,
  currency,
  capacityMin,
  capacityMax,
  onChange,
  defaultOpen = false,
}: {
  pkg: ListingPackage;
  suggestions: string[];
  currency: Currency;
  capacityMin: number | null;
  capacityMax: number | null;
  onChange: (view: VendorListingView) => void;
  defaultOpen?: boolean;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState(pkg.name);
  const [priceMin, setPriceMin] = useState(pkg.price_min?.toString() ?? "");
  const [priceMax, setPriceMax] = useState(pkg.price_max?.toString() ?? "");
  const [priceMode, setPriceMode] = useState<PackagePriceMode>(pkg.price_mode ?? "total");
  const [retireLegacyPrice, setRetireLegacyPrice] = useState(false);
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
    setPriceMin(pkg.price_min?.toString() ?? "");
    setPriceMax(pkg.price_max?.toString() ?? "");
    setPriceMode(pkg.price_mode ?? "total");
    setRetireLegacyPrice(false);
    setDescription(pkg.description ?? "");
  }, [pkg.name, pkg.price_min, pkg.price_max, pkg.price_mode, pkg.description]);

  const minAmount = priceMin === "" ? null : Number(priceMin);
  const maxAmount = priceMax === "" ? null : Number(priceMax);
  const hasAmount = minAmount !== null || maxAmount !== null;
  const persistedMode = hasAmount ? priceMode : null;
  const priceDirty =
    minAmount !== pkg.price_min ||
    maxAmount !== pkg.price_max ||
    persistedMode !== pkg.price_mode ||
    retireLegacyPrice;

  const dirty = name !== pkg.name || priceDirty || description !== (pkg.description ?? "");
  const nameValid = name.trim().length > 0;

  const draftPrice = { price_min: minAmount, price_max: maxAmount, price_mode: persistedMode };
  const priceSummary = hasStructuredPrice(draftPrice)
    ? formatPackagePrice({ min: minAmount, max: maxAmount }, priceMode, currency, locale, t)
    : !retireLegacyPrice
      ? pkg.price_text
      : null;
  const converted = convertedPrice(draftPrice, { min: capacityMin, max: capacityMax });

  const onSave = async () => {
    if (!dirty || !nameValid || busy) return;
    setBusy(true);
    try {
      const view = await vendorListingApi.updatePackage(pkg.id, {
        name: name.trim(),
        ...(priceDirty
          ? {
              price_text: null,
              price_min: minAmount,
              price_max: maxAmount,
              price_mode: persistedMode,
            }
          : {}),
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
    <li>
      {/* Header row. The package name lives HERE and only here: when the card
          is open the same text becomes a borderless input, so the title is
          never printed twice (it used to appear as a heading AND again inside
          a "package name" field two rows below). */}
      <div className="flex w-full items-center gap-2">
        {open || renaming ? (
          <input
            ref={renameRef}
            className="-mx-2 min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2 py-3 font-grotesk text-base font-semibold text-ink-900 transition-colors placeholder:text-ink-400 hover:bg-paper-50 focus:bg-paper-50 focus:outline-none focus:ring-0 dark:text-paper-50 dark:placeholder:text-umber-400 dark:hover:bg-umber-800/60 dark:focus:bg-umber-800/60"
            value={name}
            maxLength={PACKAGE_NAME_MAX}
            disabled={busy}
            aria-label={t("vendor_home.packages_name_label")}
            placeholder={t("vendor_home.packages_name_placeholder")}
            onChange={(e) => setName(e.target.value)}
            onBlur={renaming ? commitRename : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (renaming) commitRename();
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
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls={`pkg-body-${pkg.id}`}
              className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-paper-50 dark:hover:bg-umber-800/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
                  {name.trim() || t("vendor_home.packages_default_name")}
                </span>
                {priceSummary && (
                  <span className="block truncate text-sm text-ink-500 dark:text-umber-300">
                    {priceSummary}
                  </span>
                )}
              </span>
              {pkg.pdf_url && (
                <FileText
                  size={15}
                  aria-hidden
                  className="shrink-0 text-ink-400 dark:text-umber-300"
                />
              )}
              {/* The disclosure cue. Without it the row's only glyph was the
                  pencil beside it, which means RENAME — so price, description
                  and the PDF read as things an existing package simply doesn't
                  have, while a freshly added one (auto-expanded) showed all
                  three. Reported as "the package cannot be edited". */}
              <ChevronDown
                size={16}
                aria-hidden
                className="shrink-0 text-ink-400 dark:text-umber-300"
              />
            </button>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              disabled={busy}
              aria-label={t("vendor_home.packages_rename")}
              title={t("vendor_home.packages_rename")}
              className="vp-btn-quiet shrink-0"
            >
              <Pencil size={15} aria-hidden />
            </button>
          </>
        )}
        {dirty && (
          <span className="shrink-0 rounded-full bg-blush-500/12 px-2.5 py-1 text-[11px] font-semibold text-ink-500 dark:bg-blush-400/20 dark:text-paper-300">
            {t("vendor_home.packages_unsaved")}
          </span>
        )}
        {open && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded={open}
            aria-controls={`pkg-body-${pkg.id}`}
            aria-label={t("a11y.close")}
            className="vp-btn-quiet shrink-0"
          >
            {/* Flipped against the collapsed cue, so the pair reads as one
                control in two states rather than two unrelated chevrons. */}
            <ChevronDown size={16} aria-hidden className="rotate-180" />
          </button>
        )}
      </div>

      {open && (
        <div id={`pkg-body-${pkg.id}`} className="space-y-4 pb-4">
          {/* Suggestion chips sit under the (single) title, where they read as
              "or start from one of these" rather than as a second name field. */}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((sug) => (
                <button key={sug} type="button" onClick={() => setName(sug)} className="vp-chip">
                  {sug}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <span className="vp-label">{t("vendor_home.packages_price_mode_label")}</span>
              <div className="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-paper-100 p-1 dark:bg-umber-800">
                {(["total", "per_person"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={priceMode === mode}
                    disabled={busy}
                    onClick={() => setPriceMode(mode)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      priceMode === mode
                        ? "bg-white text-ink-900 shadow-sm dark:bg-umber-700 dark:text-paper-50"
                        : "text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                    }`}
                  >
                    {t(
                      mode === "total"
                        ? "vendor_home.packages_price_mode_total"
                        : "vendor_home.packages_price_mode_per_person",
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="vp-label">{t("vendor_home.packages_price_min_label")}</span>
                <span className="relative mt-1 block">
                  <MoneyInput
                    className="vp-input pr-14"
                    value={priceMin}
                    locale={locale}
                    maxLength={String(PACKAGE_AMOUNT_MAX).length}
                    disabled={busy}
                    aria-label={t("vendor_home.packages_price_min_label")}
                    onChange={setPriceMin}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-400 dark:text-umber-400">
                    {currency}
                  </span>
                </span>
              </label>
              <label>
                <span className="vp-label">{t("vendor_home.packages_price_max_label")}</span>
                <span className="relative mt-1 block">
                  <MoneyInput
                    className="vp-input pr-14"
                    value={priceMax}
                    locale={locale}
                    maxLength={String(PACKAGE_AMOUNT_MAX).length}
                    disabled={busy}
                    aria-label={t("vendor_home.packages_price_max_label")}
                    onChange={setPriceMax}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-400 dark:text-umber-400">
                    {currency}
                  </span>
                </span>
              </label>
            </div>

            {pkg.price_text && !hasAmount && !retireLegacyPrice && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-paper-200 px-3 py-2 text-sm dark:border-umber-700">
                <span className="text-ink-600 dark:text-umber-200">
                  {t("vendor_home.packages_legacy_price", { price: pkg.price_text })}
                </span>
                <button
                  type="button"
                  className="vp-btn-quiet text-xs"
                  onClick={() => setRetireLegacyPrice(true)}
                >
                  {t("vendor_home.packages_legacy_remove")}
                </button>
              </div>
            )}

            {converted && (
              <p className="text-sm text-ink-500 dark:text-umber-300">
                {t("vendor_home.packages_price_equivalent", {
                  price: formatPackagePrice(converted.range, converted.mode, currency, locale, t),
                })}
              </p>
            )}
            {minAmount !== null && maxAmount !== null && minAmount > maxAmount && (
              <p className="text-sm text-blush-600 dark:text-blush-300">
                {t("vendor_home.packages_price_range_invalid")}
              </p>
            )}
          </div>

          <div>
            <label className="vp-label" htmlFor={`pkg-desc-${pkg.id}`}>
              {t("vendor_home.packages_desc_label")}
            </label>
            <textarea
              id={`pkg-desc-${pkg.id}`}
              className="vp-input"
              rows={3}
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
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:underline dark:text-paper-400"
                >
                  <FileText size={15} aria-hidden />
                  {pkg.pdf_name ?? t("vendor_home.packages_pdf_label")}
                </a>
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={busy}
                  className="vp-btn-quiet text-sm"
                >
                  {t("vendor_home.packages_pdf_replace")}
                </button>
                <button
                  type="button"
                  onClick={() => void onRemovePdf()}
                  disabled={busy}
                  className="vp-btn-quiet text-sm text-blush-600 hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-950/40"
                >
                  {t("vendor_home.packages_pdf_remove")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={busy}
                  className="vp-btn-secondary w-full border-dashed sm:w-auto"
                >
                  <Upload size={15} aria-hidden />
                  {t("vendor_home.packages_pdf_upload")}
                </button>
                {/* The size limit is a constraint, not a label: worth one quiet
                    line so an 11 MB brochure fails in the file picker's head
                    rather than in a toast after the upload. */}
                <span className="text-xs text-ink-400 dark:text-umber-400">
                  {t("vendor_home.packages_pdf_hint")}
                </span>
              </>
            )}
          </div>

          {/* Row actions. Save is the only filled control on the card, so the
              eye lands on it without a colour hunt. */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={busy}
              className="vp-btn-quiet text-sm text-blush-600 hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-950/40"
            >
              <Trash2 size={15} aria-hidden />
              {t("vendor_home.packages_delete")}
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={
                !dirty ||
                !nameValid ||
                busy ||
                (minAmount !== null && maxAmount !== null && minAmount > maxAmount)
              }
              className="vp-btn-primary"
            >
              {t("vendor_home.packages_save")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
