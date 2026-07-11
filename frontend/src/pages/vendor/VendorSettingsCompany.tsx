// Company tab of the vendor settings hub — everything about the BUSINESS in
// one place: the legal-payee identity collected at signup (editable via
// PATCH /api/vendor/account) and the public bio (listing blurbs, saved via
// the existing listing PATCH). The rest of the public card (photos, pricing,
// capacity) stays on /vendor/listing; a pointer links there.

import { Building2, FileText, Store } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { VendorAccountEditInput } from "@shared/listings";
import { useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { vendorAccountApi, vendorListingApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import type { VendorSettingsContext } from "./VendorSettingsLayout";

type CompanyField = {
  key: keyof VendorAccountEditInput;
  labelKey: string;
  autoComplete?: string;
  maxLength: number;
};

// display_name + company_name are separate (the two public-facing name fields,
// rendered at the top); everything below is the private billing/contact block.
const COMPANY_FIELDS: CompanyField[] = [
  { key: "contact_email", labelKey: "vendor.settings.company_email", maxLength: 120 },
  { key: "contact_phone", labelKey: "vendor.settings.company_phone", maxLength: 40 },
  { key: "vat_number", labelKey: "vendor.settings.company_vat", maxLength: 40 },
  { key: "registry_number", labelKey: "vendor.settings.company_registry", maxLength: 60 },
  { key: "legal_form", labelKey: "vendor.settings.company_legal_form", maxLength: 80 },
  { key: "country", labelKey: "vendor.settings.company_country", maxLength: 2 },
  { key: "postal_code", labelKey: "vendor.settings.company_postal", maxLength: 16 },
  { key: "city", labelKey: "vendor.settings.company_city", maxLength: 80 },
  { key: "address", labelKey: "vendor.settings.company_address", maxLength: 240 },
];

export default function VendorSettingsCompany() {
  const { t } = useT();
  const toast = useToast();
  const { view, setView } = useOutletContext<VendorSettingsContext>();

  // --- Company identity form ---
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  // --- Public bio form ---
  const [blurbHu, setBlurbHu] = useState("");
  const [blurbEn, setBlurbEn] = useState("");
  const [savingBio, setSavingBio] = useState(false);

  // Seed the forms whenever the shared view lands / refreshes.
  useEffect(() => {
    if (!view) return;
    setDisplayName(view.account.display_name);
    setCompanyName(view.account.company_name ?? "");
    const seeded: Record<string, string> = {};
    for (const f of COMPANY_FIELDS) {
      const raw = view.account[f.key as keyof typeof view.account];
      seeded[f.key] = typeof raw === "string" ? raw : "";
    }
    setFields(seeded);
    setBlurbHu(view.listing.blurb_hu ?? "");
    setBlurbEn(view.listing.blurb_en ?? "");
  }, [view]);

  if (!view) {
    return (
      <div
        aria-hidden="true"
        className="mt-8 h-64 animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800"
      />
    );
  }

  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (name.length === 0) {
      setCompanyError(t("vendor.settings.company_name_required"));
      return;
    }
    setSavingCompany(true);
    setCompanyError(null);
    const body: VendorAccountEditInput = {
      display_name: name,
      company_name: companyName.trim() || null,
    };
    for (const f of COMPANY_FIELDS) {
      const raw = (fields[f.key] ?? "").trim();
      body[f.key] = (raw.length === 0 ? null : raw) as never;
    }
    try {
      const res = await vendorAccountApi.update(body);
      if (view) setView({ ...view, account: res.account });
      toast.success(t("vendor.settings.saved"));
    } catch (err) {
      setCompanyError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSavingCompany(false);
    }
  }

  async function saveBio(e: FormEvent) {
    e.preventDefault();
    setSavingBio(true);
    try {
      const res = await vendorListingApi.patch({
        blurb_hu: blurbHu.trim() || null,
        blurb_en: blurbEn.trim() || null,
      });
      setView(res);
      toast.success(t("vendor.settings.saved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSavingBio(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Company identity */}
      <section className="card">
        <h2 className="flex items-center gap-2 font-grotesk text-lg">
          <Building2 size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
          {t("vendor.settings.company_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">
          {t("vendor.settings.company_body")}
        </p>
        <form onSubmit={saveCompany} className="mt-4 space-y-3">
          <div>
            <label htmlFor="vendor-company-name" className="field-label">
              {t("vendor.settings.company_display_name")}
            </label>
            <input
              id="vendor-company-name"
              type="text"
              className="input w-full"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={200}
              disabled={savingCompany}
              required
            />
            <p className="field-help mt-1">{t("vendor.settings.company_display_name_help")}</p>
          </div>
          <div>
            <label htmlFor="vendor-company-legal-name" className="field-label">
              {t("vendor.settings.company_legal_name")}
            </label>
            <input
              id="vendor-company-legal-name"
              type="text"
              className="input w-full"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={120}
              disabled={savingCompany}
            />
            <p className="field-help mt-1">{t("vendor.settings.company_legal_name_help")}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {COMPANY_FIELDS.map((f) => (
              <div key={f.key} className={f.key === "address" ? "sm:col-span-2" : undefined}>
                <label htmlFor={`vendor-company-${f.key}`} className="field-label">
                  {t(f.labelKey)}
                </label>
                <input
                  id={`vendor-company-${f.key}`}
                  type="text"
                  className="input w-full"
                  value={fields[f.key] ?? ""}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  maxLength={f.maxLength}
                  disabled={savingCompany}
                />
              </div>
            ))}
          </div>
          {companyError && <p className="field-error">{companyError}</p>}
          <button type="submit" className="btn-primary" disabled={savingCompany}>
            {savingCompany ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </section>

      {/* Public bio */}
      <section className="card">
        <h2 className="flex items-center gap-2 font-grotesk text-lg">
          <FileText size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
          {t("vendor.settings.bio_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">
          {t("vendor.settings.bio_body")}
        </p>
        <form onSubmit={saveBio} className="mt-4 space-y-3">
          <div>
            <label htmlFor="vendor-bio-hu" className="field-label">
              {t("vendor.settings.bio_hu")}
            </label>
            <textarea
              id="vendor-bio-hu"
              className="input min-h-28 w-full"
              value={blurbHu}
              onChange={(e) => setBlurbHu(e.target.value)}
              maxLength={2000}
              disabled={savingBio}
            />
          </div>
          <div>
            <label htmlFor="vendor-bio-en" className="field-label">
              {t("vendor.settings.bio_en")}
            </label>
            <textarea
              id="vendor-bio-en"
              className="input min-h-28 w-full"
              value={blurbEn}
              onChange={(e) => setBlurbEn(e.target.value)}
              maxLength={2000}
              disabled={savingBio}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={savingBio}>
            {savingBio ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </section>

      {/* Pointer to the full public-card editor */}
      <Link
        to="/vendor/listing"
        className="flex items-center gap-2 rounded-xl border border-paper-300 px-4 py-3 text-sm text-ink-700 transition-colors hover:bg-steel-50 dark:border-umber-700 dark:text-paper-200 dark:hover:bg-steel-600/15"
      >
        <Store size={16} aria-hidden="true" className="text-steel-700 dark:text-steel-300" />
        <span>{t("vendor.settings.company_listing_link")}</span>
      </Link>
    </div>
  );
}
