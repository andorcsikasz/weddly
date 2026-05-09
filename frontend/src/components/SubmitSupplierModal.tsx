import type { SubmitCommunitySupplierInput, PriceBand } from "@shared/community_suppliers";
import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
import { SUPPLIER_GROUPS } from "@shared/suppliers";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button, Dialog, FieldError, HelperText, TextField, useToast } from "./ui";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmitted: (supplier: DirectorySupplier) => void;
};

type FieldKey =
  | "category"
  | "name"
  | "city"
  | "website"
  | "contact_email"
  | "contact_phone"
  | "blurb"
  | "price_band";

type Errors = Partial<Record<FieldKey, string>>;

const PRICE_BANDS: PriceBand[] = [1, 2, 3, 4];

function emptyForm() {
  return {
    category: "" as SupplierCategory | "",
    name: "",
    city: "",
    website: "",
    contact_email: "",
    contact_phone: "",
    blurb: "",
    price_band: null as PriceBand | null,
  };
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function SubmitSupplierModal({ open, onClose, onSubmitted }: Props) {
  const { t } = useT();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptyForm());
      setErrors({});
      setSubmitting(false);
    }
  }, [open]);

  function setField<K extends keyof ReturnType<typeof emptyForm>>(
    key: K,
    value: ReturnType<typeof emptyForm>[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key as FieldKey];
      return next;
    });
  }

  function validate(): Errors {
    const next: Errors = {};
    const required = t("suppliers.submit.err_required");
    const tooLong = t("suppliers.submit.err_too_long");

    if (!form.category) next.category = required;

    const name = form.name.trim();
    if (!name) next.name = required;
    else if (name.length > 120) next.name = tooLong;

    const city = form.city.trim();
    if (!city) next.city = required;
    else if (city.length > 80) next.city = tooLong;

    const website = form.website.trim();
    if (!website) next.website = required;
    else if (!isValidUrl(website)) next.website = t("suppliers.submit.err_invalid_url");

    const email = form.contact_email.trim();
    if (email && !isLikelyEmail(email))
      next.contact_email = t("suppliers.submit.err_invalid_email");

    const blurb = form.blurb.trim();
    if (!blurb) next.blurb = required;
    else if (blurb.length > 500) next.blurb = tooLong;

    if (form.price_band === null) next.price_band = required;

    return next;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    if (!form.category || form.price_band === null) return;

    const payload: SubmitCommunitySupplierInput = {
      category: form.category,
      name: form.name.trim(),
      city: form.city.trim(),
      website: form.website.trim(),
      contact_email: form.contact_email.trim() ? form.contact_email.trim() : null,
      contact_phone: form.contact_phone.trim() ? form.contact_phone.trim() : null,
      blurb: form.blurb.trim(),
      price_band: form.price_band,
    };

    setSubmitting(true);
    try {
      const res = await supplierApi.submitCommunity(payload);
      toast.success(`${t("suppliers.submit.success_title")} ${t("suppliers.submit.success_body")}`);
      onSubmitted(res.supplier);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          toast.error(t("suppliers.submit.err_rate_limited"));
        } else if (err.status >= 400 && err.status < 500) {
          toast.error(err.message);
        } else {
          toast.error(t("common.error_generic"));
        }
      } else {
        toast.error(t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      role="dialog"
      title={t("suppliers.submit.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            {t("suppliers.submit.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="submit-supplier-form"
            loading={submitting}
            loadingLabel={t("suppliers.submit.submitting")}
          >
            {t("suppliers.submit.submit_button")}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-600">{t("suppliers.submit.intro")}</p>
      <form id="submit-supplier-form" onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="submit-supplier-category" className="field-label">
            {t("suppliers.submit.category_label")}
            <span aria-hidden="true" className="ml-0.5 text-blush-700">
              *
            </span>
          </label>
          <select
            id="submit-supplier-category"
            className={["input", errors.category ? "input-invalid" : ""].filter(Boolean).join(" ")}
            value={form.category}
            onChange={(e) => setField("category", e.target.value as SupplierCategory | "")}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={errors.category ? "submit-supplier-category-error" : undefined}
          >
            <option value="" disabled>
              {t("suppliers.submit.category_placeholder")}
            </option>
            {SUPPLIER_GROUPS.map((g) => (
              <optgroup key={g.id} label={t(`suppliers.group.${g.id}`)}>
                {g.categories.map((c) => (
                  <option key={c} value={c}>
                    {t(`suppliers.cat.${c}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.category && (
            <FieldError id="submit-supplier-category-error">{errors.category}</FieldError>
          )}
        </div>

        <TextField
          id="submit-supplier-name"
          label={t("suppliers.submit.name_label")}
          required
          maxLength={120}
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          errorText={errors.name}
        />

        <TextField
          id="submit-supplier-city"
          label={t("suppliers.submit.city_label")}
          required
          maxLength={80}
          value={form.city}
          onChange={(e) => setField("city", e.target.value)}
          errorText={errors.city}
        />

        <TextField
          id="submit-supplier-website"
          label={t("suppliers.submit.website_label")}
          type="url"
          required
          inputMode="url"
          placeholder="https://"
          value={form.website}
          onChange={(e) => setField("website", e.target.value)}
          errorText={errors.website}
        />

        <TextField
          id="submit-supplier-email"
          label={t("suppliers.submit.email_label")}
          type="email"
          inputMode="email"
          value={form.contact_email}
          onChange={(e) => setField("contact_email", e.target.value)}
          errorText={errors.contact_email}
        />

        <TextField
          id="submit-supplier-phone"
          label={`${t("suppliers.submit.phone_label")} ${t("suppliers.submit.phone_optional")}`}
          type="tel"
          inputMode="tel"
          value={form.contact_phone}
          onChange={(e) => setField("contact_phone", e.target.value)}
          errorText={errors.contact_phone}
        />

        <div>
          <label htmlFor="submit-supplier-blurb" className="field-label">
            {t("suppliers.submit.blurb_label")}
            <span aria-hidden="true" className="ml-0.5 text-blush-700">
              *
            </span>
          </label>
          <textarea
            id="submit-supplier-blurb"
            className={["input", errors.blurb ? "input-invalid" : ""].filter(Boolean).join(" ")}
            rows={4}
            maxLength={500}
            value={form.blurb}
            onChange={(e) => setField("blurb", e.target.value)}
            aria-invalid={errors.blurb ? true : undefined}
            aria-describedby={
              errors.blurb ? "submit-supplier-blurb-error" : "submit-supplier-blurb-help"
            }
          />
          {errors.blurb ? (
            <FieldError id="submit-supplier-blurb-error">{errors.blurb}</FieldError>
          ) : (
            <HelperText id="submit-supplier-blurb-help">
              {t("suppliers.submit.blurb_help")}
            </HelperText>
          )}
        </div>

        <div>
          <span className="field-label block">
            {t("suppliers.submit.price_label")}
            <span aria-hidden="true" className="ml-0.5 text-blush-700">
              *
            </span>
          </span>
          <div
            role="radiogroup"
            aria-label={t("suppliers.submit.price_label")}
            className="flex gap-2"
          >
            {PRICE_BANDS.map((band) => {
              const selected = form.price_band === band;
              return (
                <button
                  key={band}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setField("price_band", band)}
                  className={
                    selected
                      ? "min-h-tap flex-1 rounded-xl border border-ink-700 bg-ink-700 px-3 py-2 text-sm font-medium text-paper-100"
                      : "min-h-tap flex-1 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-700 hover:border-ink-300"
                  }
                >
                  {"$".repeat(band)}
                </button>
              );
            })}
          </div>
          {errors.price_band ? (
            <FieldError id="submit-supplier-price-error">{errors.price_band}</FieldError>
          ) : (
            <HelperText id="submit-supplier-price-help">
              {t("suppliers.submit.price_help")}
            </HelperText>
          )}
        </div>
      </form>
    </Dialog>
  );
}
