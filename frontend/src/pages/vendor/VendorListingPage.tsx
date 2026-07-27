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
import { intlLocale } from "../../lib/format";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Hourglass,
  Lock,
  MoveVertical,
  Plus,
  Share2,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { InfoHint } from "../../components/InfoHint";
import { VendorShareDialog } from "../../components/VendorShareDialog";
import {
  blockedHoursLabel,
  type ListingPhoto,
  MAX_LISTING_PHOTOS,
  listingNameLockedUntil,
  priceBandLockedUntil,
  type VendorAvailabilityView,
  type VendorListingEditInput,
  type VendorListingView,
} from "@shared/listings";
import {
  capacityKindFor,
  languageLabel,
  SPOKEN_LANGUAGE_OPTIONS,
  speaksLanguages,
} from "@shared/suppliers";
import type { VendorBilling } from "@shared/vendor_billing";
import { listingChecklistFor } from "@shared/vendor_clients";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { SetupProgressPanel } from "../../components/VendorSetupProgress";
import { TranslateButton } from "../../components/TranslateButton";
import { VendorListingPackages } from "../../components/VendorListingPackages";
import { VendorListingVideos } from "../../components/VendorListingVideos";
import { DateField } from "../../components/ui/DateField";
import { Switch } from "../../components/ui/Switch";
import { TextField } from "../../components/ui/TextField";
import { useToast } from "../../components/ui/ToastProvider";
import { vendorAvailabilityApi, vendorListingApi } from "../../lib/endpoints";
import { type Locale, useT } from "../../lib/i18n";
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
  /** Public brand name. Editable, but only once a week — see the cooldown
   *  note in the editor and LISTING_NAME_COOLDOWN_DAYS on the server. */
  name: string;
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
  /** ISO 639-1 codes a verbal vendor (celebrant / MC) works in. Non-string
   *  field, handled on its own path in formToPatch (like hide_contact_public). */
  spoken_languages: string[];
  /** Hide the address + email tail from anonymous visitors on the public page.
   *  A non-string field — handled on its own path in formToPatch. */
  hide_contact_public: boolean;
}

/** The string-valued FormState keys — everything the `onChange`/`setNullable`
 *  string helpers touch. Excludes the lone boolean (`hide_contact_public`),
 *  which has its own handler and diff. */
type StringFormKey = {
  [K in keyof FormState]: FormState[K] extends string ? K : never;
}[keyof FormState];

/** Render an ISO 'YYYY-MM-DD' block date in the vendor's locale. Parsed as
 *  UTC midnight so the displayed day never shifts under a timezone offset. */
function formatBlockedDate(iso: string, locale: Locale): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
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
  locale: Locale;
  t: (path: string, vars?: Record<string, string | number>) => string;
}) {
  const fmtDate = (ms: number | null): string =>
    ms == null
      ? ""
      : new Intl.DateTimeFormat(intlLocale(locale), {
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
  } else if (billing.reason === "lead_window") {
    text = t("vendor_home.billing_lead_window", {
      used: String(billing.lead_credits_used),
      total: String(billing.lead_credits_total),
    });
  } else {
    return null; // subscribed / active → no banner
  }

  const cls = warn
    ? "border-blush-300 bg-blush-50 text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/10 dark:text-blush-200"
    : "border-steel-200 bg-steel-50 text-ink-700 dark:border-steel-600/40 dark:bg-steel-600/15 dark:text-steel-100";
  return (
    <div
      className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2 text-sm ${cls}`}
      role="status"
    >
      <span>{text}</span>
      <Link to="/vendor/billing" className="font-medium underline underline-offset-2">
        {warn ? t("vendor_home.billing_lapsed_cta") : t("vendor.settings.tab_billing")}
      </Link>
    </div>
  );
}

function viewToForm(view: VendorListingView): FormState {
  const l = view.listing;
  return {
    name: l.name,
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
    spoken_languages: l.spoken_languages ?? [],
    hide_contact_public: l.hide_contact_public,
  };
}

/** Coerce a controlled-form string back to the wire shape: empty → null,
 *  number columns → Number(). Returns the diff vs. the freshly-loaded view
 *  so the PATCH only carries fields the user actually touched — keeps
 *  audit-log noise low and the network payload tight. */
function formToPatch(form: FormState, baseline: VendorListingView): VendorListingEditInput {
  const patch: VendorListingEditInput = {};
  const baseStr = viewToForm(baseline);
  const setNullable = (key: StringFormKey & keyof VendorListingEditInput): void => {
    if (form[key] === baseStr[key]) return;
    const trimmed = form[key].trim();
    (patch as Record<string, unknown>)[key] = trimmed.length === 0 ? null : trimmed;
  };
  // Name and city are both NOT NULL, so they diff as plain strings rather than
  // through setNullable (which would send `null` for a blanked field). An empty
  // name is simply not sent — the server would 400 and the vendor would lose
  // the rest of the save with it.
  if (form.name !== baseStr.name && form.name.trim().length > 0) patch.name = form.name.trim();
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
  if (form.hide_contact_public !== baseStr.hide_contact_public) {
    patch.hide_contact_public = form.hide_contact_public;
  }
  const baseLangs = baseline.listing.spoken_languages ?? [];
  if (form.spoken_languages.join(",") !== baseLangs.join(",")) {
    patch.spoken_languages = form.spoken_languages;
  }
  return patch;
}

/** Client-side guard mirrored from the autosave/save gate: a saveable form
 *  needs a non-empty city and, when BOTH capacity bounds are set, min ≤ max.
 *
 *  The capacity check is skipped when the category doesn't show the fields.
 *  Legacy values survive in the DB behind the hidden section, and a stale
 *  min > max there would otherwise wedge autosave on a pair of inputs the
 *  vendor can't see, let alone fix. */
function isFormSaveable(form: FormState, capacityShown: boolean): boolean {
  if (form.city.trim().length === 0) return false;
  if (!capacityShown) return true;
  const min = form.capacity_min.trim();
  const max = form.capacity_max.trim();
  if (min.length > 0 && max.length > 0 && Number(min) > Number(max)) return false;
  return true;
}

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
  // Local object-URL of a just-picked cover, shown INSTANTLY in the couple's-eye
  // preview (and the dropzone) while the upload round-trips. Cleared + revoked
  // on success (the server URL takes over) or failure (reverts to the saved
  // hero). Null the rest of the time.
  const [heroPreview, setHeroPreview] = useState<string | null>(null);
  // Which description language the editor is showing. Starts on the language
  // the vendor runs the app in — a vendor on the English interface writing into
  // a Hungarian box would be the same mistake in the other direction — and
  // falls back to HU for any locale that has no blurb column of its own.
  const [blurbLang, setBlurbLang] = useState<"hu" | "en">(locale === "en" ? "en" : "hu");
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const heroInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  // Always-current form snapshot so an autosave can tell whether the vendor
  // kept typing during its round trip (reference changes on every keystroke).
  const formRef = useRef<FormState | null>(form);

  // Deep links from the setup checklist arrive as `/vendor/listing#vendor-
  // section-gallery`. The browser can't honour that on a client-side
  // navigation, because the target section doesn't exist until the listing
  // fetch resolves — so scroll once `view` lands. Runs on every hash change so
  // clicking a second checklist row from this same page also moves.
  const { hash } = useLocation();
  useEffect(() => {
    if (!view || !hash) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [view, hash]);

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

  const onChange = (key: StringFormKey) => (e: { target: { value: string } }) => {
    setForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
  };

  const uploadHeroFile = async (file: File) => {
    if (heroBusy) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("vendor_home.hero_upload_failed"));
      return;
    }
    // Show the picked file the instant it's chosen, before the upload finishes,
    // so the preview reacts immediately. Revoked in `finally` either way.
    const localUrl = URL.createObjectURL(file);
    setHeroPreview(localUrl);
    setHeroBusy(true);
    try {
      const next = await vendorListingApi.uploadHero(file);
      setView(next);
      toast.success(t("vendor_home.hero_upload_success"));
    } catch {
      toast.error(t("vendor_home.hero_upload_failed"));
    } finally {
      setHeroBusy(false);
      // Success → the server URL on `view` takes over; failure → fall back to
      // the previous saved hero. Either way stop referencing the blob and free it.
      setHeroPreview(null);
      URL.revokeObjectURL(localUrl);
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

  // Gallery uploads run sequentially so a multi-select lands in pick order and
  // the server cap (409 gallery_full) stops the batch cleanly.
  const onGalleryPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    if (files.length === 0 || galleryBusy) return;
    setGalleryBusy(true);
    try {
      for (const file of files) {
        const next = await vendorListingApi.uploadPhoto(file);
        setView(next);
      }
      toast.success(t("vendor_home.gallery_upload_success"));
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status;
      toast.error(
        status === 409
          ? t("vendor_home.gallery_full", { max: String(MAX_LISTING_PHOTOS) })
          : t("vendor_home.gallery_upload_failed"),
      );
    } finally {
      setGalleryBusy(false);
    }
  };

  const onGalleryDelete = async (photoId: number) => {
    if (galleryBusy) return;
    setGalleryBusy(true);
    try {
      const next = await vendorListingApi.deletePhoto(photoId);
      setView(next);
      toast.success(t("vendor_home.gallery_delete_success"));
    } catch {
      toast.error(t("vendor_home.gallery_delete_failed"));
    } finally {
      setGalleryBusy(false);
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

  // Does a guest count mean anything for this vendor's category, and if so,
  // is it a room's capacity or a service's throughput? Null hides the whole
  // capacity block: a photographer has no guest capacity, and asking for one
  // was both noise on the form and a checklist step they could never finish.
  // Category is admin-curated and not editable here, so this is stable for the
  // lifetime of the page.
  const capacityKind = capacityKindFor(view?.listing.category);
  // Verbal vendors (celebrant / MC) advertise the languages they can confidently
  // run a wedding in — the deciding question for those categories, hidden for
  // everyone else.
  const speaksLang = speaksLanguages(view?.listing.category);

  // Dirty = the form diverges from the last-loaded view. Saveable = passes the
  // client guard. Autosave fires only when BOTH hold; the explicit Save button
  // shares the same routine as a manual fallback.
  const dirty = form && view ? Object.keys(formToPatch(form, view)).length > 0 : false;
  const saveable = form ? isFormSaveable(form, capacityKind != null) : false;

  const runSave = useCallback(
    async (mode: "auto" | "manual") => {
      if (!form || !view || saving) return;
      if (!isFormSaveable(form, capacityKind != null)) return;
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
    [form, view, saving, capacityKind, t, toast],
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

  const track = form && capacityKind ? capacityTrack(form) : null;

  // The cover to render right now: the optimistic just-picked file if one is in
  // flight, otherwise the saved hero. Shared by the couple's-eye preview and the
  // editor's own dropzone so both react the moment a cover is chosen.
  const effectiveHeroUrl = heroPreview ?? view?.listing.hero_image_url ?? null;

  // Anti-fraud pricing cooldown, mirrored from the server rule
  // (shared/listings.ts): while locked the band buttons are disabled and the
  // unlock date replaces the help line, so the vendor never hits the 409.
  // Same mirrored-cooldown treatment for the brand name (7 days, see
  // shared/listings.ts): while locked the input is disabled and the note
  // carries the exact unlock date, so the vendor never hits the 409.
  const nameLockedUntil = view ? listingNameLockedUntil(view.listing.name_changed_at) : null;
  const nameLocked = nameLockedUntil !== null && nameLockedUntil > Date.now();
  const nameUnlockDate = nameLocked
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(nameLockedUntil))
    : null;
  const priceLockedUntil = view ? priceBandLockedUntil(view.listing.price_band_changed_at) : null;
  const priceLocked = priceLockedUntil !== null && priceLockedUntil > Date.now();
  const priceUnlockDate = priceLocked
    ? new Intl.DateTimeFormat(intlLocale(locale), {
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
            {/* The saved confirmation used to be a bare 14px check + 12px grey
                text, which was genuinely easy to miss on a page that autosaves
                silently. It's now a tinted pill, and the check pops in (the
                shared .check-pop keyframe, which no-ops under
                prefers-reduced-motion) so the eye catches the state CHANGE
                rather than having to notice a static glyph. */}
            {autosaveStatus === "saved" && (
              <span className="inline-flex animate-fade-in items-center gap-1.5 rounded-full bg-sage-50 px-2.5 py-1 text-xs font-medium text-sage-700 dark:bg-sage-400/15 dark:text-sage-300">
                <Check aria-hidden="true" size={14} strokeWidth={2.6} className="check-pop" />
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
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          {/* Live couple's-eye preview: stacked above the form on small
              screens, sticky right column from lg up. The "live" marker is a
              broadcast-style badge in the top-right corner of the card (red
              dot + label) instead of a heading row above it. */}
          <aside className="relative order-1 lg:sticky lg:top-6 lg:order-2">
            <h2 className="sr-only">{t("vendor_home.preview_panel_title")}</h2>
            <span className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full bg-ink-900/75 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"
              />
              {t("vendor_home.visibility_live")}
            </span>
            {/* The preview card IS the link to the live public page. It points
                at the PUBLIC `/vendors/:id` route (not the couple-app-internal
                `/app/suppliers/:id`, which is behind RequireCoupleAuth and just
                bounces a vendor back to /vendor). Opens in a new tab so the
                vendor's in-progress, unsaved editor edits are never blown away. */}
            <Link
              to={`/vendors/${view.listing.id}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("vendor_home.preview_open")}
              className="block rounded-2xl transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-steel-400"
            >
              <VendorListingPreview
                name={view.listing.name}
                heroUrl={effectiveHeroUrl}
                city={form.city}
                priceBand={form.price_band}
                capacityMin={capacityKind ? form.capacity_min : ""}
                capacityMax={capacityKind ? form.capacity_max : ""}
                blurb={
                  locale === "hu" ? form.blurb_hu || form.blurb_en : form.blurb_en || form.blurb_hu
                }
              />
            </Link>
            <Link
              to={`/vendors/${view.listing.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-steel-600 transition-colors hover:text-steel-700 dark:text-steel-300 dark:hover:text-steel-200"
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t("vendor_home.preview_open")}
            </Link>
            {/* Right under the card it shares: the preview answers "what does
                my page look like", this answers "send it to someone". */}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="ml-4 mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-steel-600 transition-colors hover:text-steel-700 dark:text-steel-300 dark:hover:text-steel-200"
            >
              <Share2 size={14} aria-hidden="true" />
              {t("vendor.share.action")}
            </button>
            <VendorShareDialog
              open={shareOpen}
              onClose={() => setShareOpen(false)}
              listingId={view.listing.id}
              listingName={view.listing.name}
            />

            {/* Second surface for the setup progress (the dashboard alert is the
                first). It sits in the sticky column so the vendor can see how
                far along they are while scrolling the long form, and each row
                jumps to its own section. Hidden once the listing is complete —
                a 100% checklist is just noise. */}
            <SetupProgressPanel
              steps={listingChecklistFor({
                category: view.listing.category,
                hero_image_url: effectiveHeroUrl || null,
                blurb_hu: form.blurb_hu || null,
                blurb_en: form.blurb_en || null,
                city: form.city || null,
                contact_email: form.contact_email || null,
                contact_phone: form.contact_phone || null,
                price_band: form.price_band === "" ? null : Number(form.price_band),
                capacity_min: form.capacity_min === "" ? null : Number(form.capacity_min),
                capacity_max: form.capacity_max === "" ? null : Number(form.capacity_max),
                photo_count: view.photos?.length ?? 0,
                package_count: view.packages?.length ?? 0,
              })}
            />
          </aside>

          <form onSubmit={onSubmit} className="order-2 space-y-2.5 lg:order-1">
            {/* Brand name. It used to be frozen at moderation with a mailto to
                support, which made every typo a ticket. The vendor owns it now;
                the once-a-week cooldown is what keeps the catalogue stable, and
                while it's running the field is disabled with the exact unlock
                date rather than letting the vendor type into a 409. */}
            <fieldset className="card space-y-1.5 p-4" disabled={saving || heroBusy}>
              <legend className="font-semibold">{t("vendor_home.label_name")}</legend>
              {nameLocked && nameUnlockDate ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-ink-600 dark:text-umber-200">
                  <Lock size={12} aria-hidden="true" />
                  {t("vendor_home.name_locked_until", { date: nameUnlockDate })}
                </p>
              ) : (
                <p className="text-xs text-ink-600 dark:text-umber-200">
                  {t("vendor_home.label_name_help")}
                </p>
              )}
              <input
                className="input"
                value={form.name}
                onChange={onChange("name")}
                disabled={nameLocked}
                maxLength={120}
                aria-label={t("vendor_home.label_name")}
              />
            </fieldset>

            <fieldset
              className="card space-y-2.5 p-4"
              disabled={saving || heroBusy}
              id="vendor-section-cover"
            >
              <legend className="font-semibold">{t("vendor_home.section_hero")}</legend>
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
                className={`relative flex aspect-[3/2] cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-center transition ${
                  dragOver
                    ? "border-steel-400 bg-steel-50 dark:border-steel-500 dark:bg-steel-600/15"
                    : "border-paper-300 bg-paper-50 hover:border-steel-400 dark:border-umber-600 dark:bg-umber-900 dark:hover:border-steel-500"
                }`}
              >
                {effectiveHeroUrl ? (
                  <>
                    <img
                      src={effectiveHeroUrl}
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
                  <div className="px-4 py-4">
                    <p className="text-sm font-medium text-ink-700 dark:text-umber-100">
                      {heroBusy
                        ? t("vendor_home.hero_uploading")
                        : t("vendor_home.hero_dropzone_cta")}
                    </p>
                    <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                      {t("vendor_home.hero_dropzone_hint")}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500 dark:text-umber-300">
                      {t("vendor_home.hero_size_hint")}
                    </p>
                  </div>
                )}
              </div>
              {/* The dropzone itself is the upload control; the zone is cut to
                  the exact 3:2 crop of the catalogue card. Only the destructive
                  action needs its own button. */}
              {view.listing.hero_image_url ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-ink-500 dark:text-umber-300">
                    {t("vendor_home.hero_size_hint")}
                  </p>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={onHeroDelete}
                    disabled={heroBusy}
                  >
                    {t("vendor_home.hero_delete")}
                  </button>
                </div>
              ) : null}
            </fieldset>

            {/* Portfolio gallery — up to MAX_LISTING_PHOTOS beyond the hero;
                shows on the public detail page's thumbnail strip. */}
            <fieldset
              className="card space-y-2.5 p-4"
              disabled={saving || galleryBusy}
              id="vendor-section-gallery"
            >
              {/* The thumbnails and the "add photo" tile say what this is; the
                  sentence explaining where the photos surface is one (i) away
                  for the first visit and out of the way on every later one. */}
              <legend className="flex items-center gap-1.5 font-semibold">
                {t("vendor_home.section_gallery")}
                <InfoHint text={t("vendor_home.gallery_intro")} />
              </legend>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => void onGalleryPick(e)}
              />
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {(view.photos ?? []).map((p) => (
                  <GalleryTile
                    key={p.id}
                    photo={p}
                    busy={galleryBusy}
                    onDelete={() => void onGalleryDelete(p.id)}
                    onCommit={(y) => {
                      void vendorListingApi
                        .updatePhotoPosition(p.id, y)
                        .then(setView)
                        .catch(() => undefined);
                    }}
                  />
                ))}
                {(view.photos?.length ?? 0) < MAX_LISTING_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={galleryBusy}
                    className="flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-paper-300 text-ink-500 transition hover:border-steel-400 hover:text-steel-600 dark:border-umber-700 dark:text-umber-300 dark:hover:border-steel-500"
                  >
                    <Plus size={18} aria-hidden="true" />
                    <span className="text-xs font-medium">
                      {galleryBusy ? t("vendor_home.hero_uploading") : t("vendor_home.gallery_add")}
                    </span>
                  </button>
                )}
              </div>
              <p className="text-xs text-ink-500 dark:text-umber-300">
                {t("vendor_home.gallery_count", {
                  n: String(view.photos?.length ?? 0),
                  max: String(MAX_LISTING_PHOTOS),
                })}
              </p>
            </fieldset>

            {/* Video reel — reference videos beside the gallery. Self-contained
                (own busy state + toasts); hits the server per action like the
                gallery, so it lives outside the autosave form flow. */}
            <VendorListingVideos videos={view.videos ?? []} onChange={setView} />

            {/* Price offers / packages (árajánlat) — self-contained, per-action
                server writes like the reel; category drives the name suggestions. */}
            <div id="vendor-section-packages">
              <VendorListingPackages
                packages={view.packages ?? []}
                category={view.listing.category}
                onChange={setView}
              />
            </div>

            <fieldset
              className="card space-y-2.5 p-4"
              disabled={saving}
              id="vendor-section-description"
            >
              <legend className="font-semibold">{t("vendor_home.section_marketing")}</legend>
              {/* One language at a time. Both textareas stacked meant a vendor
                  scrolled past a field they weren't writing in, twice, on every
                  visit. Same pill toggle as the interface language in Settings;
                  the dot marks a language that already has copy, which is the
                  thing you lose by hiding the other one. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="radiogroup"
                  aria-label={t("vendor_home.blurb_lang_aria")}
                  className="inline-flex overflow-hidden rounded-full border border-ink-200 dark:border-umber-700"
                >
                  {(["hu", "en"] as const).map((l) => {
                    const active = l === blurbLang;
                    const filled = (l === "hu" ? form.blurb_hu : form.blurb_en).trim().length > 0;
                    return (
                      <button
                        key={l}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setBlurbLang(l)}
                        className={`inline-flex min-w-[84px] items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? "bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                            : "bg-paper-50 text-ink-600 hover:bg-paper-100 dark:bg-ink-800 dark:text-umber-200 dark:hover:bg-umber-700"
                        }`}
                      >
                        {t(`profile.account_locale_${l}`)}
                        {filled && (
                          <>
                            <span
                              aria-hidden="true"
                              className={`h-1.5 w-1.5 rounded-full ${
                                active ? "bg-paper-50/70 dark:bg-ink-900/60" : "bg-sage-500"
                              }`}
                            />
                            <span className="sr-only">{t("vendor_home.blurb_lang_filled")}</span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
                {blurbLang === "hu" ? (
                  <TranslateButton
                    source="EN"
                    target="HU"
                    sourceText={form.blurb_en}
                    hasExisting={form.blurb_hu.trim().length > 0}
                    disabled={saving}
                    onTranslated={(text) =>
                      setForm((prev) => (prev ? { ...prev, blurb_hu: text } : prev))
                    }
                  />
                ) : (
                  <TranslateButton
                    source="HU"
                    target="EN"
                    sourceText={form.blurb_hu}
                    hasExisting={form.blurb_en.trim().length > 0}
                    disabled={saving}
                    onTranslated={(text) =>
                      setForm((prev) => (prev ? { ...prev, blurb_en: text } : prev))
                    }
                  />
                )}
              </div>
              {blurbLang === "hu" ? (
                <textarea
                  id="vendor-blurb-hu"
                  aria-label={t("vendor_home.label_blurb_hu")}
                  className="input"
                  rows={4}
                  maxLength={2000}
                  value={form.blurb_hu}
                  onChange={onChange("blurb_hu")}
                />
              ) : (
                <textarea
                  id="vendor-blurb-en"
                  aria-label={t("vendor_home.label_blurb_en")}
                  className="input"
                  rows={4}
                  maxLength={2000}
                  value={form.blurb_en}
                  onChange={onChange("blurb_en")}
                />
              )}
            </fieldset>

            <fieldset
              className="card space-y-2.5 p-4"
              disabled={saving}
              id="vendor-section-contact"
            >
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
              <div className="flex items-start justify-between gap-3 rounded-lg border border-paper-200 px-3 py-2.5 dark:border-umber-700">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900 dark:text-paper-100">
                    {t("vendor_home.label_hide_contact")}
                    {/* The three-line version (which addresses get masked, what
                        a signed-in couple sees, why the phone stays hidden)
                        lives in the tooltip. The line below is what a vendor
                        needs to decide the toggle. */}
                    <InfoHint text={t("vendor_home.label_hide_contact_hint")} />
                  </p>
                  <p
                    id="vendor-hide-contact-hint"
                    className="mt-0.5 text-xs text-ink-500 dark:text-umber-300"
                  >
                    {t("vendor_home.label_hide_contact_hint_short")}
                  </p>
                </div>
                <Switch
                  checked={form.hide_contact_public}
                  onChange={(next) =>
                    setForm((prev) => (prev ? { ...prev, hide_contact_public: next } : prev))
                  }
                  disabled={saving}
                  label={t("vendor_home.label_hide_contact")}
                  describedBy="vendor-hide-contact-hint"
                />
              </div>
            </fieldset>

            <fieldset
              className="card space-y-2.5 p-4"
              disabled={saving}
              id="vendor-section-pricing"
            >
              <legend className="font-semibold">
                {capacityKind
                  ? t("vendor_home.section_pricing")
                  : t("vendor_home.section_pricing_only")}
              </legend>

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
                        // The glyph row IS the label — five € read as a price
                        // band faster than "Ultra-luxus / A piac csúcsa" does.
                        // The words survive as the accessible name + the hover
                        // title, so nothing is lost to a screen reader.
                        aria-label={t(`vendor_home.price_band_level_${lvl}_name`)}
                        title={t(`vendor_home.price_band_level_${lvl}_name`)}
                        onClick={() => setPriceBand(lvl)}
                        disabled={priceLocked}
                        className={`flex items-center justify-center rounded-xl border px-2.5 py-3 transition disabled:cursor-not-allowed disabled:opacity-60 ${
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
                                    ? "text-sm font-semibold text-white"
                                    : "text-sm font-semibold text-steel-600 dark:text-steel-300"
                                  : active
                                    ? "text-sm font-semibold text-white/40"
                                    : "text-sm font-semibold text-paper-300 dark:text-umber-700"
                              }
                            >
                              €
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Capacity, only where a guest count exists. A venue reports the
                  room it can seat; a caterer or a rental stock reports what it
                  can serve, which is a different promise and gets its own
                  label. Everyone else never sees this block. */}
              {capacityKind && (
                <div id="vendor-section-capacity">
                  <span className="field-label">
                    {capacityKind === "seating"
                      ? t("vendor_home.capacity_seating_label")
                      : t("vendor_home.capacity_service_label")}
                  </span>
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
              )}

              {speaksLang && (
                <div id="vendor-section-languages">
                  <span className="field-label">{t("vendor_home.languages_label")}</span>
                  <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">
                    {t("vendor_home.languages_hint")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SPOKEN_LANGUAGE_OPTIONS.map((opt) => {
                      const on = form.spoken_languages.includes(opt.code);
                      return (
                        <button
                          key={opt.code}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    spoken_languages: on
                                      ? prev.spoken_languages.filter((c) => c !== opt.code)
                                      : [...prev.spoken_languages, opt.code],
                                  }
                                : prev,
                            )
                          }
                          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                            on
                              ? "border-steel-500 bg-steel-50 text-steel-800 dark:border-steel-400 dark:bg-steel-400/15 dark:text-steel-200"
                              : "border-paper-300 text-ink-600 hover:border-ink-400 dark:border-umber-700 dark:text-umber-200 dark:hover:border-umber-500"
                          }`}
                        >
                          {languageLabel(
                            opt.code,
                            locale === "hu" ? "hu" : locale === "es" ? "es" : "en",
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </fieldset>

            {/* Actions grouped right, not pinned to both edges. This row is the
                only unframed thing in a stack of cards, and justify-between put
                ~400px of nothing between a ghost link and the save button on a
                desktop-width form — which reads as a rendering fault between
                the price card and the one below it, not as a toolbar. */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
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
        <section className="card mt-2.5 space-y-2.5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="min-w-0 font-semibold">{t("vendor_home.visibility_title")}</h2>
            {view.listing.status === "active" ? (
              // Broadcast-style LIVE pill: red pulsing dot + uppercase label.
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-900/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white dark:bg-white/10 dark:text-paper-100">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"
                />
                {t("vendor_home.visibility_live")}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-paper-200 px-2.5 py-0.5 text-xs font-medium text-ink-600 dark:bg-umber-700 dark:text-paper-300">
                {view.listing.status === "hidden"
                  ? t("vendor_home.visibility_paused")
                  : t("vendor_home.visibility_moderated")}
              </span>
            )}
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

      {/* Freemium: the availability calendar is PRO. A FREE vendor sees the
          locked state with the upgrade path instead of a form whose writes
          would 402. */}
      {availability && view?.billing && !view.billing.entitled && (
        <section className="card mt-2.5 flex flex-col gap-3 p-4">
          <div className="flex items-start gap-2.5">
            <Lock
              size={18}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-ink-400 dark:text-paper-500"
            />
            <div>
              <h2 className="font-semibold">{t("vendor_home.section_availability")}</h2>
              <p className="mt-0.5 text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_home.availability_locked")}
              </p>
            </div>
          </div>
          <Link
            to="/vendor/billing"
            className="btn w-fit bg-steel-600 text-white hover:bg-steel-700"
          >
            {t("vendor.upgrade.cta")}
          </Link>
        </section>
      )}

      {availability && (!view?.billing || view.billing.entitled) && (
        <section className="card mt-2.5 space-y-2.5 p-4">
          {/* This section only does whole-day blocks; hour-level edits, the
              month grid and the task board all live on /vendor/calendar, which
              until now this page never mentioned. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t("vendor_home.section_availability")}</h2>
            <Link
              to="/vendor/calendar"
              className="inline-flex items-center gap-1 text-sm font-medium text-steel-600 transition-colors hover:text-steel-700 dark:text-steel-300 dark:hover:text-steel-200"
            >
              <span>{t("vendor_home.availability_open_calendar")}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          <form onSubmit={onAddBlock} className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <DateField
                id="vendor-block-date"
                label={t("vendor_home.availability_add_label")}
                value={newDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={setNewDate}
                locale={locale}
                disabled={availBusy}
                clearable
              />
            </div>
            <button
              type="submit"
              className="btn bg-steel-600 text-white hover:bg-steel-700"
              disabled={availBusy || newDate.trim().length === 0}
            >
              {t("vendor_home.availability_add")}
            </button>
          </form>

          {availability.blocked_days.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-umber-300">
              {t("vendor_home.availability_empty")}
            </p>
          ) : (
            /* Chips carry the hour detail, not just the date: the × removes the
               WHOLE day's block, so a chip that looked identical for a
               14:00-18:00 block and a full one made that destructive without
               warning. Hour-level edits stay on /vendor/calendar. */
            <ul className="flex flex-wrap gap-2">
              {availability.blocked_days.map((bd) => {
                const hours = blockedHoursLabel(bd.hours);
                const label = hours
                  ? `${formatBlockedDate(bd.date, locale)} · ${hours}`
                  : formatBlockedDate(bd.date, locale);
                return (
                  <li
                    key={bd.date}
                    className="inline-flex items-center gap-2 rounded-full bg-paper-100 py-1 pl-3 pr-1 text-sm text-ink-800 ring-1 ring-paper-300 dark:bg-umber-800 dark:text-umber-100 dark:ring-umber-700"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {hours ? (
                        <Hourglass
                          size={12}
                          aria-hidden="true"
                          className="shrink-0 text-ink-500 dark:text-umber-300"
                        />
                      ) : (
                        <Lock
                          size={12}
                          aria-hidden="true"
                          className="shrink-0 text-ink-500 dark:text-umber-300"
                        />
                      )}
                      <span className="tabular-nums">{label}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveBlock(bd.date)}
                      disabled={availBusy}
                      aria-label={t("vendor_home.availability_remove", { date: label })}
                      title={t("vendor_home.availability_remove", { date: label })}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition hover:bg-paper-300 hover:text-ink-800 disabled:opacity-50 dark:text-umber-300 dark:hover:bg-umber-700"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
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

/** One gallery tile: the photo, a delete affordance, and drag-to-reframe.
 *  The slot crops to 3/2, so a portrait shot arrives with its subject sliced
 *  off; dragging the photo up or down inside the slot picks which band
 *  survives, exactly like the couples' cover positioner. Vertical only —
 *  `object-cover` on a wide slot has no horizontal slack to give.
 *
 *  `pos` is local so the crop tracks the finger at 60fps without a round trip;
 *  release commits once and the parent swaps in the server's copy. Dragging
 *  DOWN reveals the top of the photo (object-position-y falls), which is the
 *  "I'm moving the picture, not the window" feel. */
function GalleryTile({
  photo,
  busy,
  onDelete,
  onCommit,
}: {
  photo: ListingPhoto;
  busy: boolean;
  onDelete: () => void;
  onCommit: (positionY: number) => void;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sy: number; py: number } | null>(null);
  const [pos, setPos] = useState(photo.position_y);
  const [dragging, setDragging] = useState(false);

  // Re-sync when the server's value lands (or the row is replaced by a
  // sibling's refresh); skipped mid-drag so an in-flight save can't yank the
  // photo out from under the finger.
  useEffect(() => {
    if (!drag.current) setPos(photo.position_y);
  }, [photo.position_y]);

  function nextFrom(clientY: number): number | null {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d) return null;
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) return null;
    const dyPct = ((clientY - d.sy) / rect.height) * 100;
    return Math.max(0, Math.min(100, Math.round(d.py - dyPct)));
  }

  return (
    <div
      ref={ref}
      className={`group relative aspect-[3/2] touch-none select-none overflow-hidden rounded-lg bg-paper-100 dark:bg-umber-800 ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onPointerDown={(e) => {
        // The delete button sits inside this box; let its own click through.
        if ((e.target as HTMLElement).closest("button")) return;
        ref.current?.setPointerCapture(e.pointerId);
        drag.current = { sy: e.clientY, py: pos };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const n = nextFrom(e.clientY);
        if (n !== null) setPos(n);
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        const n = nextFrom(e.clientY);
        const before = drag.current.py;
        ref.current?.releasePointerCapture(e.pointerId);
        drag.current = null;
        setDragging(false);
        if (n === null) return;
        setPos(n);
        // A plain click (or a drag that landed where it started) is not an
        // edit — don't spend a request on it.
        if (n !== before) onCommit(n);
      }}
    >
      <img
        src={photo.url}
        alt=""
        loading="lazy"
        draggable={false}
        className="pointer-events-none h-full w-full object-cover"
        style={{ objectPosition: `50% ${pos}%` }}
      />
      {/* Reframe hint — hover/focus only, so a settled gallery stays clean. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/55 to-transparent px-1 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        <MoveVertical size={11} aria-hidden="true" />
        {t("vendor_home.gallery_position_hint")}
      </span>
      <button
        type="button"
        aria-label={t("vendor_home.gallery_delete")}
        onClick={onDelete}
        disabled={busy}
        className="absolute right-1 top-1 rounded-full bg-ink-900/60 p-1 text-white opacity-0 transition-opacity hover:bg-ink-900/85 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
