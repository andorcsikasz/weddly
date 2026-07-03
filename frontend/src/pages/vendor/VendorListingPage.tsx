// Vendor listing + availability + hero editor, rendered INSIDE VendorShell.
// Lifted from the legacy standalone pages/VendorHomePage.tsx: the full-page
// <Shell> chrome and the standalone role-redirect are dropped here because the
// shell layout (VendorShellLayout) and RequireVendorAuth own those concerns.
// Everything else is preserved: listing-field PATCH, hero upload/delete,
// availability block/unblock, and the founding/trial/lapsed billing banner.
//
// Editable fields mirror the backend's `VendorListingEditInput`: marketing
// copy (blurb_hu / blurb_en), public contact (email, phone, website),
// location (city, address), pricing (price_band), capacity. Name + category
// are intentionally read-only — admin moderation surfaces those.
//
// Endpoints (unchanged): vendorListingApi.me/patch/uploadHero/deleteHero,
// vendorAvailabilityApi.me/block/unblock.

import {
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import {
  priceBandLockedUntil,
  type VendorAvailabilityView,
  type VendorListingEditInput,
  type VendorListingView,
} from "@shared/listings";
import type { VendorBilling } from "@shared/vendor_billing";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { TextField } from "../../components/ui/TextField";
import { useToast } from "../../components/ui/ToastProvider";
import { vendorAvailabilityApi, vendorListingApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";
import { Skeleton, SkeletonText } from "../../components/ui";
import VendorListingPreview from "./VendorListingPreview";

/** Visual price-band scale shown in the editor. Each level maps to the same
 *  "1".."5" string the backend stores; the labels/descriptions are i18n keys. */
const PRICE_LEVELS = [1, 2, 3, 4, 5] as const;

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

/** Founding / trial / lapsed billing banner. Entitled-founding + entitled-trial
 *  are reassuring (free until {date}); a lapsed vendor gets the warning tone
 *  (listing hidden, data preserved). A paying subscriber sees nothing. */
function BillingBanner({
  billing,
  locale,
  t,
}: {
  billing: VendorBilling;
  locale: string;
  t: (path: string, vars?: Record<string, string | number>) => string;
}) {
  const fmtDate = (ms: number | null): string =>
    ms == null
      ? ""
      : new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(new Date(ms));

  let warn = false;
  let text: string;
  if (!billing.entitled) {
    warn = true;
    text = t("vendor_home.billing_lapsed");
  } else if (billing.reason === "founding") {
    text = t("vendor_home.billing_founding", { date: fmtDate(billing.founding_until) });
  } else if (billing.reason === "trialing") {
    text = t("vendor_home.billing_trial", { date: fmtDate(billing.trial_ends_at) });
  } else {
    return null; // subscribed / active → no banner
  }

  const cls = warn
    ? "border-blush-300 bg-blush-50 text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/10 dark:text-blush-200"
    : "border-steel-200 bg-steel-50 text-ink-700 dark:border-steel-600/40 dark:bg-steel-600/15 dark:text-steel-100";
  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${cls}`} role="status">
      {text}
    </div>
  );
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

/** Client-side guard mirrored from the autosave/save gate: a saveable form
 *  needs a non-empty city and, when BOTH capacity bounds are set, min ≤ max. */
function isFormSaveable(form: FormState): boolean {
  if (form.city.trim().length === 0) return false;
  const min = form.capacity_min.trim();
  const max = form.capacity_max.trim();
  if (min.length > 0 && max.length > 0 && Number(min) > Number(max)) return false;
  return true;
}

const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Geometry + validity for the capacity visual track. Scales the filled band
 *  against a soft reference so the segment reads proportionally; flags an
 *  invalid range when both bounds are set and min exceeds max. */
function capacityTrack(form: FormState): { left: number; right: number; invalid: boolean } {
  const minStr = form.capacity_min.trim();
  const maxStr = form.capacity_max.trim();
  const min = Number(minStr);
  const max = Number(maxStr);
  const hasMin = minStr.length > 0 && Number.isFinite(min);
  const hasMax = maxStr.length > 0 && Number.isFinite(max);
  const invalid = hasMin && hasMax && min > max;
  const ref = Math.max(hasMax ? max : 0, hasMin ? min : 0, 200);
  const left = hasMin ? Math.min(100, Math.max(0, (min / ref) * 100)) : 0;
  const right = hasMax ? Math.min(100, Math.max(0, (max / ref) * 100)) : 100;
  return { left, right: Math.max(left, right), invalid };
}

export default function VendorListingPage() {
  const { t, locale } = useT();
  useDocumentTitle(t("vendor_home.page_title"));
  const toast = useToast();

  const [view, setView] = useState<VendorListingView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [heroBusy, setHeroBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const heroInputRef = useRef<HTMLInputElement | null>(null);
  // Always-current form snapshot so an autosave can tell whether the vendor
  // kept typing during its round trip (reference changes on every keystroke).
  const formRef = useRef<FormState | null>(form);

  // Availability: the booked/blocked days. Managed independently of the
  // listing form — each block/unblock hits the server and re-renders from the
  // returned view, so there's no local-vs-server drift to reconcile on save.
  const [availability, setAvailability] = useState<VendorAvailabilityView | null>(null);
  const [newDate, setNewDate] = useState("");
  const [availBusy, setAvailBusy] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);

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
    void loadView();
  }, [loadView]);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const onChange = (key: keyof FormState) => (e: { target: { value: string } }) => {
    setForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
  };

  const uploadHeroFile = async (file: File) => {
    if (heroBusy) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("vendor_home.hero_upload_failed"));
      return;
    }
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

  const onHeroPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value so the SAME file can be picked again after a
    // failed upload - the change event only fires when the path changes.
    e.target.value = "";
    if (!file) return;
    void uploadHeroFile(file);
  };

  const onHeroDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadHeroFile(file);
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

  const onToggleVisibility = async () => {
    if (!view || visibilityBusy) return;
    setVisibilityBusy(true);
    try {
      const next = await vendorListingApi.setVisibility(view.listing.status !== "active");
      setView(next);
      toast.success(
        next.listing.status === "active"
          ? t("vendor_home.visibility_published")
          : t("vendor_home.visibility_paused_toast"),
      );
    } catch {
      toast.error(t("vendor_home.visibility_failed"));
    } finally {
      setVisibilityBusy(false);
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

  // Dirty = the form diverges from the last-loaded view. Saveable = passes the
  // client guard. Autosave fires only when BOTH hold; the explicit Save button
  // shares the same routine as a manual fallback.
  const dirty = form && view ? Object.keys(formToPatch(form, view)).length > 0 : false;
  const saveable = form ? isFormSaveable(form) : false;

  const runSave = useCallback(
    async (mode: "auto" | "manual") => {
      if (!form || !view || saving) return;
      if (!isFormSaveable(form)) return;
      if (Object.keys(formToPatch(form, view)).length === 0) return;
      setSaving(true);
      try {
        const patch = formToPatch(form, view);
        const next = await vendorListingApi.patch(patch);
        setView(next);
        if (mode === "manual") {
          setForm(viewToForm(next));
          toast.success(t("vendor_home.save_success"));
        } else if (formRef.current === form) {
          // No keystrokes landed during the round trip, so it's safe to
          // normalise the visible fields to the server's trimmed values.
          // This also prevents a trailing-whitespace autosave loop. If the
          // vendor kept typing, leave their live text untouched.
          setForm(viewToForm(next));
        }
      } catch {
        toast.error(t("vendor_home.save_failed"));
      } finally {
        setSaving(false);
      }
    },
    [form, view, saving, t, toast],
  );

  // Debounced autosave: ~1s after the last edit, persist a valid dirty form.
  // Each keystroke clears the prior timer, so the PATCH only lands once the
  // vendor pauses typing.
  useEffect(() => {
    if (!dirty || !saveable || saving) return;
    const id = setTimeout(() => {
      void runSave("auto");
    }, 1000);
    return () => clearTimeout(id);
  }, [dirty, saveable, saving, runSave]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void runSave("manual");
  };

  const setPriceBand = (level: number) => {
    setForm((prev) =>
      prev ? { ...prev, price_band: prev.price_band === String(level) ? "" : String(level) } : prev,
    );
  };

  // Autosave status pill shown near the top of the form.
  const autosaveStatus: "saving" | "unsaved" | "saved" = saving
    ? "saving"
    : dirty
      ? "unsaved"
      : "saved";

  const supportEmailRaw = t("about.paragraph_contact_email");
  const supportEmail = looksLikeEmail(supportEmailRaw)
    ? supportEmailRaw.trim()
    : "hello@tryweddly.com";

  const track = form ? capacityTrack(form) : null;

  // Anti-fraud pricing cooldown, mirrored from the server rule
  // (shared/listings.ts): while locked the band buttons are disabled and the
  // unlock date replaces the help line, so the vendor never hits the 409.
  const priceLockedUntil = view ? priceBandLockedUntil(view.listing.price_band_changed_at) : null;
  const priceLocked = priceLockedUntil !== null && priceLockedUntil > Date.now();
  const priceUnlockDate = priceLocked
    ? new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(priceLockedUntil))
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header row doubles as the autosave status line: the indicator sits on
          the right instead of occupying its own row inside the form. */}
      <div className="mb-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-grotesk text-2xl">{t("vendor_home.page_title")}</h1>
          <p className="mt-0.5 text-sm text-ink-600 dark:text-umber-200">
            {t("vendor_home.page_body")}
          </p>
        </div>
        {form && view && (
          <div className="shrink-0 pb-0.5" aria-live="polite">
            {autosaveStatus === "saving" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-500 dark:text-umber-300">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-steel-500 dark:bg-steel-300"
                />
                {t("vendor_home.autosave_saving")}
              </span>
            )}
            {autosaveStatus === "saved" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-sage-700 dark:text-sage-300">
                <Check aria-hidden="true" size={14} strokeWidth={2.4} />
                {t("vendor_home.autosave_saved")}
              </span>
            )}
            {autosaveStatus === "unsaved" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-600 dark:text-umber-300">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-steel-400 dark:bg-steel-400"
                />
                {t("vendor_home.autosave_unsaved")}
              </span>
            )}
          </div>
        )}
      </div>

      {loadError && (
        <div className="card mb-4" role="alert">
          <p className="text-sm text-blush-700 dark:text-blush-300">{loadError}</p>
        </div>
      )}

      {/* Skeleton while the listing + availability fetch is in flight, so the
          space under the header never renders as a blank flash. */}
      {!view && !loadError && (
        <div
          className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"
          aria-busy="true"
        >
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card space-y-3">
                <Skeleton variant="line" width="30%" height={14} />
                <SkeletonText lines={3} />
              </div>
            ))}
          </div>
          <div className="hidden lg:block">
            <Skeleton height={280} rounded="2xl" />
          </div>
        </div>
      )}

      {view?.billing && <BillingBanner billing={view.billing} locale={locale} t={t} />}

      {form && view && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          {/* Live couple's-eye preview: stacked above the form on small
              screens, sticky right column from lg up. */}
          <aside className="order-1 space-y-2 lg:sticky lg:top-6 lg:order-2">
            <h2 className="text-sm font-semibold text-ink-700 dark:text-umber-100">
              {t("vendor_home.preview_panel_title")}
            </h2>
            <VendorListingPreview
              name={view.listing.name}
              heroUrl={view.listing.hero_image_url ?? null}
              city={form.city}
              priceBand={form.price_band}
              capacityMin={form.capacity_min}
              capacityMax={form.capacity_max}
              blurb={
                locale === "hu" ? form.blurb_hu || form.blurb_en : form.blurb_en || form.blurb_hu
              }
            />
          </aside>

          <form onSubmit={onSubmit} className="order-2 space-y-3 lg:order-1">
            {/* Autosave status: live region near the top of the editor. */}
            <div className="flex items-center justify-end" aria-live="polite">
              {autosaveStatus === "saving" && (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-500 dark:text-umber-300">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-steel-500 dark:bg-steel-300"
                  />
                  {t("vendor_home.autosave_saving")}
                </span>
              )}
              {autosaveStatus === "saved" && (
                <span className="inline-flex items-center gap-1.5 text-xs text-sage-700 dark:text-sage-300">
                  <Check aria-hidden="true" size={14} strokeWidth={2.4} />
                  {t("vendor_home.autosave_saved")}
                </span>
              )}
              {autosaveStatus === "unsaved" && (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-600 dark:text-umber-300">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-steel-400 dark:bg-steel-400"
                  />
                  {t("vendor_home.autosave_unsaved")}
                </span>
              )}
            </div>

            {/* Brand lock info card: the listing name is admin-moderated. */}
            <div className="card flex items-start gap-3">
              <Lock
                aria-hidden="true"
                size={20}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-steel-700 dark:text-steel-300"
              />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-100">
                  {view.listing.name}
                </h2>
                <p className="mt-1 text-sm font-medium text-ink-700 dark:text-umber-100">
                  {t("vendor_home.brand_locked_card_title")}
                </p>
                <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
                  {t("vendor_home.brand_locked_card_body")}
                </p>
                <a
                  href={`mailto:${supportEmail}`}
                  className="mt-2 inline-flex text-sm font-medium text-steel-600 underline decoration-steel-200 underline-offset-2 hover:text-steel-700 dark:text-steel-300 dark:hover:text-steel-200"
                >
                  {t("vendor_home.brand_locked_contact_cta")}
                </a>
              </div>
            </div>

            <fieldset className="card space-y-3" disabled={saving || heroBusy}>
              <legend className="font-semibold">{t("vendor_home.section_hero")}</legend>
              <p className="text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_home.hero_intro")}
              </p>
              <input
                ref={heroInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onHeroPick}
              />
              <div
                role="button"
                tabIndex={0}
                aria-label={
                  view.listing.hero_image_url
                    ? t("vendor_home.hero_replace")
                    : t("vendor_home.hero_upload")
                }
                onClick={() => heroInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    heroInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onHeroDrop}
                className={`relative flex min-h-[11rem] cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-center transition ${
                  dragOver
                    ? "border-steel-400 bg-steel-50 dark:border-steel-500 dark:bg-steel-600/15"
                    : "border-paper-300 bg-paper-50 hover:border-steel-400 dark:border-umber-700 dark:bg-umber-900 dark:hover:border-steel-500"
                }`}
              >
                {view.listing.hero_image_url ? (
                  <>
                    <img
                      src={view.listing.hero_image_url}
                      alt={t("vendor_home.hero_current_alt")}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <span className="relative z-10 rounded-lg bg-ink-900/55 px-3 py-1.5 text-xs font-medium text-paper-50">
                      {heroBusy
                        ? t("vendor_home.hero_uploading")
                        : t("vendor_home.hero_dropzone_replace")}
                    </span>
                  </>
                ) : (
                  <div className="px-4 py-8">
                    <p className="text-sm font-medium text-ink-700 dark:text-umber-100">
                      {heroBusy
                        ? t("vendor_home.hero_uploading")
                        : t("vendor_home.hero_dropzone_cta")}
                    </p>
                    <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                      {t("vendor_home.hero_dropzone_hint")}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn bg-steel-600 text-white hover:bg-steel-700"
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
              <AddressAutocomplete
                id="vendor-address"
                label={t("vendor_home.label_address")}
                value={form.address}
                onChange={(v) => setForm((prev) => (prev ? { ...prev, address: v } : prev))}
                onPick={(s) => {
                  if (s.city) {
                    setForm((prev) => (prev ? { ...prev, city: s.city ?? prev.city } : prev));
                  }
                }}
                maxLength={240}
                disabled={saving}
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

              <div>
                <span className="field-label">{t("vendor_home.label_price_band")}</span>
                {priceLocked && priceUnlockDate && (
                  <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs text-ink-600 dark:text-umber-200">
                    <Lock size={12} aria-hidden="true" />
                    {t("vendor_home.price_band_locked_until", { date: priceUnlockDate })}
                  </p>
                )}
                <div
                  role="group"
                  aria-label={t("vendor_home.label_price_band")}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-5"
                >
                  {PRICE_LEVELS.map((lvl) => {
                    const active = form.price_band === String(lvl);
                    return (
                      <button
                        key={lvl}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPriceBand(lvl)}
                        disabled={priceLocked}
                        className={`flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          active
                            ? "border-steel-600 bg-steel-600 text-white"
                            : "border-steel-200 bg-paper-50 text-ink-600 hover:border-steel-400 dark:border-steel-700 dark:bg-umber-900 dark:text-umber-200 dark:hover:border-steel-500"
                        }`}
                      >
                        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                          {PRICE_LEVELS.map((g) => (
                            <span
                              key={g}
                              className={
                                g <= lvl
                                  ? active
                                    ? "text-xs font-semibold text-white"
                                    : "text-xs font-semibold text-steel-600 dark:text-steel-300"
                                  : active
                                    ? "text-xs font-semibold text-white/40"
                                    : "text-xs font-semibold text-paper-300 dark:text-umber-700"
                              }
                            >
                              €
                            </span>
                          ))}
                        </span>
                        <span
                          className={`text-sm font-medium ${
                            active ? "text-white" : "text-ink-800 dark:text-paper-100"
                          }`}
                        >
                          {t(`vendor_home.price_band_level_${lvl}_name`)}
                        </span>
                        <span
                          className={`text-[11px] leading-snug ${
                            active ? "text-white/80" : "text-ink-500 dark:text-umber-300"
                          }`}
                        >
                          {t(`vendor_home.price_band_level_${lvl}_desc`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="field-label">{t("vendor_home.capacity_range_label")}</span>
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    id="vendor-capacity-min"
                    label={t("vendor_home.capacity_min_label")}
                    value={form.capacity_min}
                    onChange={onChange("capacity_min")}
                    type="number"
                    min={0}
                    max={5000}
                  />
                  <TextField
                    id="vendor-capacity-max"
                    label={t("vendor_home.capacity_max_label")}
                    value={form.capacity_max}
                    onChange={onChange("capacity_max")}
                    type="number"
                    min={0}
                    max={5000}
                  />
                </div>
                {track && (
                  <div
                    className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-paper-100 dark:bg-umber-800"
                    aria-hidden="true"
                  >
                    <div
                      className={`h-full rounded-full ${
                        track.invalid
                          ? "bg-blush-400 dark:bg-blush-400"
                          : "bg-steel-400 dark:bg-steel-500"
                      }`}
                      style={{
                        marginLeft: `${track.left}%`,
                        width: `${Math.max(0, track.right - track.left)}%`,
                      }}
                    />
                  </div>
                )}
                {track?.invalid && (
                  <p className="mt-1 text-xs text-blush-600 dark:text-blush-300">
                    {t("vendor_home.capacity_invalid")}
                  </p>
                )}
              </div>
            </fieldset>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Link to="/vendors" className="btn-ghost">
                {t("vendor_home.back_to_directory")}
              </Link>
              <button
                type="submit"
                className="btn bg-steel-600 text-white hover:bg-steel-700"
                disabled={saving}
              >
                {saving ? t("vendor_home.saving") : t("vendor_home.save")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Visibility: self-serve pause for fully-booked seasons. Moderation
          states are read-only here; the admin pipeline owns those. */}
      {view && (
        <section className="card mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">{t("vendor_home.visibility_title")}</h2>
              <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_home.visibility_body")}
              </p>
            </div>
            <span
              className={
                view.listing.status === "active"
                  ? "inline-flex items-center rounded-full bg-sage-100 px-2.5 py-0.5 text-xs font-medium text-sage-700 dark:bg-sage-500/20 dark:text-sage-200"
                  : "inline-flex items-center rounded-full bg-paper-200 px-2.5 py-0.5 text-xs font-medium text-ink-600 dark:bg-umber-700 dark:text-paper-300"
              }
            >
              {view.listing.status === "active"
                ? t("vendor_home.visibility_live")
                : view.listing.status === "hidden"
                  ? t("vendor_home.visibility_paused")
                  : t("vendor_home.visibility_moderated")}
            </span>
          </div>
          {view.listing.status === "active" || view.listing.status === "hidden" ? (
            <button
              type="button"
              onClick={onToggleVisibility}
              disabled={visibilityBusy}
              className={
                view.listing.status === "active"
                  ? "btn btn-outline"
                  : "btn bg-steel-600 text-white hover:bg-steel-700"
              }
            >
              {visibilityBusy
                ? t("vendor_home.saving")
                : view.listing.status === "active"
                  ? t("vendor_home.visibility_pause_cta")
                  : t("vendor_home.visibility_publish_cta")}
            </button>
          ) : (
            <p className="text-sm text-ink-500 dark:text-umber-300">
              {t("vendor_home.visibility_moderated_note")}
            </p>
          )}
        </section>
      )}

      {availability && (
        <section className="card mt-3 space-y-3">
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
              className="btn bg-steel-600 text-white hover:bg-steel-700"
              disabled={availBusy || newDate.trim().length === 0}
            >
              {t("vendor_home.availability_add")}
            </button>
          </form>

          {availability.blocked_dates.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-umber-300">
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
                    aria-label={t("vendor_home.availability_remove", {
                      date: formatBlockedDate(d, locale),
                    })}
                    title={t("vendor_home.availability_remove", {
                      date: formatBlockedDate(d, locale),
                    })}
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
  );
}
