// Vendor self-serve listing editor (P2.D). The single screen a freshly-
// claimed vendor lands on; they edit the public fields couples see. The
// claim flow leaves them logged in here, so the GET hydrates the form from
// the listing they just took over.
//
// Auth: `role === 'vendor'` only. Other roles get bounced to `/app`; anon
// users to `/login`. Backend enforces the same gate on every endpoint.
//
// Editable fields mirror the backend's `VendorListingEditInput`: marketing
// copy (blurb_hu / blurb_en), public contact (email, phone, website),
// location (city, address), pricing (price_band), capacity. Name +
// category are intentionally read-only — admin moderation surfaces those.

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  VendorAvailabilityView,
  VendorListingEditInput,
  VendorListingView,
} from "@shared/listings";
import { Shell } from "../components/Shell";
import { TextField } from "../components/ui/TextField";
import { useToast } from "../components/ui/ToastProvider";
import { useAuth } from "../lib/auth";
import { vendorAvailabilityApi, vendorListingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** Form state mirrors the backend's editable fields with every value coerced
 *  to string for the controlled inputs — empty string maps back to `null`
 *  at PATCH time, matching the server's "trim → null" normalisation. */
interface FormState {
  blurb_hu: string;
  blurb_en: string;
  city: string;
  address: string;
  website: string;
  contact_email: string;
  contact_phone: string;
  price_band: string;
  capacity_min: string;
  capacity_max: string;
}

/** Render an ISO 'YYYY-MM-DD' block date in the vendor's locale. Parsed as
 *  UTC midnight so the displayed day never shifts under a timezone offset. */
function formatBlockedDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function viewToForm(view: VendorListingView): FormState {
  const l = view.listing;
  return {
    blurb_hu: l.blurb_hu ?? "",
    blurb_en: l.blurb_en ?? "",
    city: l.city,
    address: l.address ?? "",
    website: l.website ?? "",
    contact_email: l.contact_email ?? "",
    contact_phone: l.contact_phone ?? "",
    price_band: l.price_band == null ? "" : String(l.price_band),
    capacity_min: l.capacity_min == null ? "" : String(l.capacity_min),
    capacity_max: l.capacity_max == null ? "" : String(l.capacity_max),
  };
}

/** Coerce a controlled-form string back to the wire shape: empty → null,
 *  number columns → Number(). Returns the diff vs. the freshly-loaded view
 *  so the PATCH only carries fields the user actually touched — keeps
 *  audit-log noise low and the network payload tight. */
function formToPatch(form: FormState, baseline: VendorListingView): VendorListingEditInput {
  const patch: VendorListingEditInput = {};
  const baseStr = viewToForm(baseline);
  const setNullable = (key: keyof FormState & keyof VendorListingEditInput): void => {
    if (form[key] === baseStr[key]) return;
    const trimmed = form[key].trim();
    (patch as Record<string, unknown>)[key] = trimmed.length === 0 ? null : trimmed;
  };
  if (form.city !== baseStr.city) patch.city = form.city.trim();
  setNullable("address");
  setNullable("website");
  setNullable("contact_email");
  setNullable("contact_phone");
  setNullable("blurb_hu");
  setNullable("blurb_en");
  if (form.price_band !== baseStr.price_band) {
    const n = Number(form.price_band);
    patch.price_band =
      form.price_band.trim().length === 0 || !Number.isFinite(n)
        ? null
        : (Math.max(1, Math.min(5, Math.round(n))) as 1 | 2 | 3 | 4 | 5);
  }
  if (form.capacity_min !== baseStr.capacity_min) {
    const n = Number(form.capacity_min);
    patch.capacity_min =
      form.capacity_min.trim().length === 0 || !Number.isFinite(n) ? null : Math.round(n);
  }
  if (form.capacity_max !== baseStr.capacity_max) {
    const n = Number(form.capacity_max);
    patch.capacity_max =
      form.capacity_max.trim().length === 0 || !Number.isFinite(n) ? null : Math.round(n);
  }
  return patch;
}

export default function VendorHomePage() {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useT();
  const toast = useToast();
  const navigate = useNavigate();
  useDocumentMeta("vendor_home.page_title", "vendor_home.page_body");

  const [view, setView] = useState<VendorListingView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [heroBusy, setHeroBusy] = useState(false);
  const heroInputRef = useRef<HTMLInputElement | null>(null);

  // Availability: the booked/blocked days. Managed independently of the
  // listing form — each block/unblock hits the server and re-renders from the
  // returned view, so there's no local-vs-server drift to reconcile on save.
  const [availability, setAvailability] = useState<VendorAvailabilityView | null>(null);
  const [newDate, setNewDate] = useState("");
  const [availBusy, setAvailBusy] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    if (user.role !== "vendor") {
      navigate("/app", { replace: true });
    }
  }, [user, authLoading, navigate]);

  const loadView = useCallback(async () => {
    try {
      const [next, avail] = await Promise.all([vendorListingApi.me(), vendorAvailabilityApi.me()]);
      setView(next);
      setForm(viewToForm(next));
      setAvailability(avail);
      setLoadError(null);
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status;
      if (status === 404) {
        setLoadError(t("vendor_home.error_no_account"));
      } else {
        setLoadError(t("vendor_home.error_load"));
      }
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || !user || user.role !== "vendor") return;
    void loadView();
  }, [authLoading, user, loadView]);

  const onChange = (key: keyof FormState) => (e: { target: { value: string } }) => {
    setForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
  };

  const onHeroPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value so the SAME file can be picked again after a
    // failed upload — the change event only fires when the path changes.
    e.target.value = "";
    if (!file || heroBusy) return;
    setHeroBusy(true);
    try {
      const next = await vendorListingApi.uploadHero(file);
      setView(next);
      toast.success(t("vendor_home.hero_upload_success"));
    } catch {
      toast.error(t("vendor_home.hero_upload_failed"));
    } finally {
      setHeroBusy(false);
    }
  };

  const onHeroDelete = async () => {
    if (heroBusy) return;
    setHeroBusy(true);
    try {
      const next = await vendorListingApi.deleteHero();
      setView(next);
      toast.success(t("vendor_home.hero_delete_success"));
    } catch {
      toast.error(t("vendor_home.hero_delete_failed"));
    } finally {
      setHeroBusy(false);
    }
  };

  const onAddBlock = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const date = newDate.trim();
    if (!date || availBusy) return;
    setAvailBusy(true);
    try {
      const next = await vendorAvailabilityApi.block(date);
      setAvailability(next);
      setNewDate("");
      toast.success(t("vendor_home.availability_blocked"));
    } catch {
      toast.error(t("vendor_home.availability_block_failed"));
    } finally {
      setAvailBusy(false);
    }
  };

  const onRemoveBlock = async (date: string) => {
    if (availBusy) return;
    setAvailBusy(true);
    try {
      const next = await vendorAvailabilityApi.unblock(date);
      setAvailability(next);
      toast.success(t("vendor_home.availability_unblocked"));
    } catch {
      toast.error(t("vendor_home.availability_unblock_failed"));
    } finally {
      setAvailBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form || !view || saving) return;
    setSaving(true);
    try {
      const patch = formToPatch(form, view);
      const next = await vendorListingApi.patch(patch);
      setView(next);
      setForm(viewToForm(next));
      toast.success(t("vendor_home.save_success"));
    } catch {
      toast.error(t("vendor_home.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !user || user.role !== "vendor") return null;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <div className="mb-4">
          <h1 className="font-grotesk text-3xl">
            {t("vendor_home.welcome", { name: user.full_name })}
          </h1>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">{t("vendor_home.intro")}</p>
        </div>

        {loadError && (
          <div className="card mb-4" role="alert">
            <p className="text-sm text-blush-700 dark:text-blush-300">{loadError}</p>
          </div>
        )}

        {form && view && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="card">
              <h2 className="text-lg font-semibold">{view.listing.name}</h2>
              <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                {t("vendor_home.name_locked")}
              </p>
            </div>

            <fieldset className="card space-y-3" disabled={saving || heroBusy}>
              <legend className="font-semibold">{t("vendor_home.section_hero")}</legend>
              <p className="text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_home.hero_intro")}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper-100 ring-1 ring-paper-300 dark:bg-umber-800 dark:ring-umber-700">
                  {view.listing.hero_image_url ? (
                    <img
                      src={view.listing.hero_image_url}
                      alt={t("vendor_home.hero_current_alt")}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span
                      className="px-3 text-center text-[11px] text-ink-500 dark:text-umber-300"
                      role="img"
                      aria-label={t("vendor_home.hero_placeholder_alt")}
                    >
                      {t("vendor_home.hero_placeholder_alt")}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={heroInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={onHeroPick}
                  />
                  <button
                    type="button"
                    className="btn-accent"
                    onClick={() => heroInputRef.current?.click()}
                    disabled={heroBusy}
                  >
                    {heroBusy
                      ? t("vendor_home.hero_uploading")
                      : view.listing.hero_image_url
                        ? t("vendor_home.hero_replace")
                        : t("vendor_home.hero_upload")}
                  </button>
                  {view.listing.hero_image_url && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={onHeroDelete}
                      disabled={heroBusy}
                    >
                      {t("vendor_home.hero_delete")}
                    </button>
                  )}
                </div>
              </div>
            </fieldset>

            <fieldset className="card space-y-3" disabled={saving}>
              <legend className="font-semibold">{t("vendor_home.section_marketing")}</legend>
              <label className="block" htmlFor="vendor-blurb-hu">
                <span className="field-label">{t("vendor_home.label_blurb_hu")}</span>
                <textarea
                  id="vendor-blurb-hu"
                  className="input"
                  rows={4}
                  maxLength={2000}
                  value={form.blurb_hu}
                  onChange={onChange("blurb_hu")}
                />
              </label>
              <label className="block" htmlFor="vendor-blurb-en">
                <span className="field-label">{t("vendor_home.label_blurb_en")}</span>
                <textarea
                  id="vendor-blurb-en"
                  className="input"
                  rows={4}
                  maxLength={2000}
                  value={form.blurb_en}
                  onChange={onChange("blurb_en")}
                />
              </label>
              <p className="text-xs text-ink-500 dark:text-umber-300">
                {t("vendor_home.label_blurb_hint")}
              </p>
            </fieldset>

            <fieldset className="card space-y-3" disabled={saving}>
              <legend className="font-semibold">{t("vendor_home.section_contact")}</legend>
              <TextField
                id="vendor-city"
                label={t("vendor_home.label_city")}
                value={form.city}
                onChange={onChange("city")}
                maxLength={80}
                required
              />
              <TextField
                id="vendor-address"
                label={t("vendor_home.label_address")}
                value={form.address}
                onChange={onChange("address")}
                maxLength={240}
              />
              <TextField
                id="vendor-website"
                label={t("vendor_home.label_website")}
                value={form.website}
                onChange={onChange("website")}
                type="url"
                maxLength={240}
              />
              <TextField
                id="vendor-contact-email"
                label={t("vendor_home.label_contact_email")}
                helperText={t("vendor_home.label_contact_email_hint")}
                value={form.contact_email}
                onChange={onChange("contact_email")}
                type="email"
                maxLength={120}
              />
              <TextField
                id="vendor-contact-phone"
                label={t("vendor_home.label_contact_phone")}
                value={form.contact_phone}
                onChange={onChange("contact_phone")}
                type="tel"
                maxLength={40}
              />
            </fieldset>

            <fieldset className="card space-y-3" disabled={saving}>
              <legend className="font-semibold">{t("vendor_home.section_pricing")}</legend>
              <TextField
                id="vendor-price-band"
                label={t("vendor_home.label_price_band")}
                helperText={t("vendor_home.label_price_band_help")}
                value={form.price_band}
                onChange={onChange("price_band")}
                type="number"
                min={1}
                max={5}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  id="vendor-capacity-min"
                  label={t("vendor_home.label_capacity_min")}
                  value={form.capacity_min}
                  onChange={onChange("capacity_min")}
                  type="number"
                  min={0}
                  max={5000}
                />
                <TextField
                  id="vendor-capacity-max"
                  label={t("vendor_home.label_capacity_max")}
                  value={form.capacity_max}
                  onChange={onChange("capacity_max")}
                  type="number"
                  min={0}
                  max={5000}
                />
              </div>
            </fieldset>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Link to="/vendors" className="btn-ghost">
                {t("vendor_home.back_to_directory")}
              </Link>
              <button type="submit" className="btn-accent" disabled={saving}>
                {saving ? t("vendor_home.saving") : t("vendor_home.save")}
              </button>
            </div>
          </form>
        )}

        {availability && (
          <section className="card mt-4 space-y-3">
            <div>
              <h2 className="font-semibold">{t("vendor_home.section_availability")}</h2>
              <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_home.availability_intro")}
              </p>
            </div>

            <form onSubmit={onAddBlock} className="flex flex-wrap items-end gap-2">
              <label className="block" htmlFor="vendor-block-date">
                <span className="field-label">{t("vendor_home.availability_add_label")}</span>
                <input
                  id="vendor-block-date"
                  type="date"
                  className="input"
                  value={newDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setNewDate(e.target.value)}
                  disabled={availBusy}
                />
              </label>
              <button
                type="submit"
                className="btn-accent"
                disabled={availBusy || newDate.trim().length === 0}
              >
                {t("vendor_home.availability_add")}
              </button>
            </form>

            {availability.blocked_dates.length === 0 ? (
              <p className="text-sm italic text-ink-500 dark:text-umber-300">
                {t("vendor_home.availability_empty")}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {availability.blocked_dates.map((d) => (
                  <li
                    key={d}
                    className="inline-flex items-center gap-2 rounded-full bg-paper-100 py-1 pl-3 pr-1 text-sm text-ink-800 ring-1 ring-paper-300 dark:bg-umber-800 dark:text-umber-100 dark:ring-umber-700"
                  >
                    <span>{formatBlockedDate(d, locale)}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveBlock(d)}
                      disabled={availBusy}
                      aria-label={t("vendor_home.availability_remove", { date: d })}
                      title={t("vendor_home.availability_remove", { date: d })}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition hover:bg-paper-300 hover:text-ink-800 disabled:opacity-50 dark:text-umber-300 dark:hover:bg-umber-700"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-ink-500 dark:text-umber-300">
              {availability.next_available
                ? t("vendor_home.availability_next_free", {
                    date: formatBlockedDate(availability.next_available, locale),
                  })
                : t("vendor_home.availability_none_free")}
            </p>
          </section>
        )}
      </div>
    </Shell>
  );
}
