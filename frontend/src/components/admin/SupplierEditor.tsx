// Admin edit surface for a community-submitted listing: the listing's own data
// (SupplierEditForm) and its pictures (SupplierPhotoManager).
//
// Why this exists: the couple-facing "recommend a supplier" modal collects nine
// fields, and the auto-enricher can only find what a website publishes. A
// business with no website — or one an admin has researched by hand — had
// nowhere for those facts to land, so a listing arrived thin and stayed thin.
// Everything here writes through `PATCH /api/admin/suppliers/:id`, which
// re-mirrors the row into `listings`, so the public card and this form can
// never tell two stories.

import type {
  AdminListingPhoto,
  AdminSupplierEditInput,
  CommunitySupplierAdminView,
  PriceBand,
} from "@shared/community_suppliers";
import {
  SPOKEN_LANGUAGE_OPTIONS,
  SUPPLIER_GROUPS,
  type SupplierCategory,
  VENUE_STYLES,
  type VenueStyle,
  languageLabel,
} from "@shared/suppliers";
import { ImageOff, Plus, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../../lib/api";
import { adminSupplierApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useToast } from "../ui";

/** Every field the form owns, as strings — an <input> has no other state. The
 *  empty string is the "blank" both a never-set NULL and a cleared field share;
 *  `diff()` below is what turns it back into the null the API means by it. */
interface Draft {
  category: string;
  name: string;
  city: string;
  address: string;
  website: string;
  contact_email: string;
  contact_phone: string;
  blurb: string;
  price_band: string;
  lat: string;
  lng: string;
  capacity_min: string;
  capacity_max: string;
  venue_style: string;
  spoken_languages: string[];
}

function numToField(v: number | null): string {
  return v == null ? "" : String(v);
}

function toDraft(s: CommunitySupplierAdminView): Draft {
  return {
    category: s.category,
    name: s.name,
    city: s.city,
    address: s.address ?? "",
    website: s.website ?? "",
    contact_email: s.contact_email ?? "",
    contact_phone: s.contact_phone ?? "",
    blurb: s.blurb ?? "",
    price_band: numToField(s.price_band),
    lat: numToField(s.lat),
    lng: numToField(s.lng),
    capacity_min: numToField(s.capacity_min),
    capacity_max: numToField(s.capacity_max),
    venue_style: s.venue_style ?? "",
    spoken_languages: s.spoken_languages ?? [],
  };
}

/** Build the PATCH body from what actually changed. The endpoint is partial by
 *  contract (absent = leave alone), so sending the whole draft would make every
 *  save a full overwrite — and would clobber a column another admin edited in
 *  the seconds this card sat open. */
function diff(before: Draft, after: Draft): AdminSupplierEditInput {
  const patch: AdminSupplierEditInput = {};
  const text = (k: "address" | "website" | "contact_email" | "contact_phone" | "blurb") => {
    if (before[k] === after[k]) return;
    patch[k] = after[k].trim() === "" ? null : after[k].trim();
  };
  const num = (k: "lat" | "lng" | "capacity_min" | "capacity_max") => {
    if (before[k] === after[k]) return;
    patch[k] = after[k].trim() === "" ? null : Number(after[k]);
  };

  if (before.category !== after.category) patch.category = after.category as SupplierCategory;
  if (before.name !== after.name) patch.name = after.name.trim();
  if (before.city !== after.city) patch.city = after.city.trim();
  text("address");
  text("website");
  text("contact_email");
  text("contact_phone");
  text("blurb");
  num("lat");
  num("lng");
  num("capacity_min");
  num("capacity_max");
  if (before.price_band !== after.price_band) {
    patch.price_band = after.price_band === "" ? null : (Number(after.price_band) as PriceBand);
  }
  if (before.venue_style !== after.venue_style) {
    patch.venue_style = after.venue_style === "" ? null : (after.venue_style as VenueStyle);
  }
  if (before.spoken_languages.join(",") !== after.spoken_languages.join(",")) {
    patch.spoken_languages = after.spoken_languages;
  }
  return patch;
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {children}
      {help ? (
        <span className="text-[11px] text-neutral-500 dark:text-umber-300">{help}</span>
      ) : null}
    </label>
  );
}

export function SupplierEditForm({
  supplier,
  onSaved,
  onCancel,
}: {
  supplier: CommunitySupplierAdminView;
  onSaved: (next: CommunitySupplierAdminView) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const initial = useMemo(() => toDraft(supplier), [supplier]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const categories = useMemo(() => SUPPLIER_GROUPS.flatMap((g) => g.categories), []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const patch = diff(initial, draft);
    if (Object.keys(patch).length === 0) {
      toast.success(t("admin.suppliers_edit_no_changes"));
      onCancel();
      return;
    }
    setSaving(true);
    try {
      const r = await adminSupplierApi.edit(supplier.id, patch);
      onSaved(r.supplier);
      toast.success(t("admin.suppliers_edit_success"));
      onCancel();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="admin-card flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("admin.suppliers_card_field_category")}>
          <select
            className="input"
            value={draft.category}
            onChange={(e) => set("category", e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {t(`suppliers.cat.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("admin.directory_col_name")}>
          <input
            className="input"
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field
          label={t("admin.suppliers_card_field_city")}
          help={t("admin.suppliers_edit_city_help")}
        >
          <input
            className="input"
            maxLength={80}
            value={draft.city}
            onChange={(e) => set("city", e.target.value)}
          />
        </Field>
        <Field label={t("admin.suppliers_card_field_address")}>
          <input
            className="input"
            maxLength={200}
            value={draft.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <Field label={t("admin.suppliers_card_field_website")}>
          <input
            className="input"
            type="url"
            maxLength={300}
            placeholder="https://…"
            value={draft.website}
            onChange={(e) => set("website", e.target.value)}
          />
        </Field>
        <Field label={t("admin.suppliers_card_field_contact_email")}>
          <input
            className="input"
            type="email"
            maxLength={200}
            value={draft.contact_email}
            onChange={(e) => set("contact_email", e.target.value)}
          />
        </Field>
        <Field label={t("admin.suppliers_card_field_contact_phone")}>
          <input
            className="input"
            maxLength={30}
            value={draft.contact_phone}
            onChange={(e) => set("contact_phone", e.target.value)}
          />
        </Field>
        <Field label={t("admin.suppliers_card_field_price_band")}>
          <select
            className="input"
            value={draft.price_band}
            onChange={(e) => set("price_band", e.target.value)}
          >
            <option value="">{t("admin.suppliers_edit_field_price_band_none")}</option>
            {[1, 2, 3, 4, 5].map((b) => (
              <option key={b} value={b}>
                {"$".repeat(b)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("admin.suppliers_edit_field_venue_style")}>
          <select
            className="input"
            value={draft.venue_style}
            onChange={(e) => set("venue_style", e.target.value)}
          >
            <option value="">{t("admin.suppliers_edit_field_venue_style_none")}</option>
            {VENUE_STYLES.map((v) => (
              <option key={v} value={v}>
                {t(`suppliers.venue_style.${v}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("admin.suppliers_edit_field_capacity_min")}>
          <input
            className="input"
            type="number"
            min={0}
            value={draft.capacity_min}
            onChange={(e) => set("capacity_min", e.target.value)}
          />
        </Field>
        <Field label={t("admin.suppliers_edit_field_capacity_max")}>
          <input
            className="input"
            type="number"
            min={0}
            value={draft.capacity_max}
            onChange={(e) => set("capacity_max", e.target.value)}
          />
        </Field>
        <Field
          label={t("admin.suppliers_edit_field_lat")}
          help={t("admin.suppliers_edit_coords_help")}
        >
          <input
            className="input"
            inputMode="decimal"
            placeholder="43.28994"
            value={draft.lat}
            onChange={(e) => set("lat", e.target.value)}
          />
        </Field>
        <Field label={t("admin.suppliers_edit_field_lng")}>
          <input
            className="input"
            inputMode="decimal"
            placeholder="11.27664"
            value={draft.lng}
            onChange={(e) => set("lng", e.target.value)}
          />
        </Field>
      </div>

      <Field label={t("admin.suppliers_card_field_blurb")}>
        <textarea
          className="input min-h-[110px] resize-y"
          maxLength={2000}
          value={draft.blurb}
          onChange={(e) => set("blurb", e.target.value)}
        />
      </Field>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="eyebrow p-0">{t("admin.suppliers_edit_field_languages")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {SPOKEN_LANGUAGE_OPTIONS.map((opt) => {
            const on = draft.spoken_languages.includes(opt.code);
            return (
              <button
                key={opt.code}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set(
                    "spoken_languages",
                    on
                      ? draft.spoken_languages.filter((c) => c !== opt.code)
                      : [...draft.spoken_languages, opt.code],
                  )
                }
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  on
                    ? "bg-neutral-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                    : "bg-paper-100 text-neutral-700 ring-1 ring-ink-100 hover:bg-paper-200 dark:bg-umber-800 dark:text-paper-100 dark:ring-umber-700"
                }`}
              >
                {languageLabel(opt.code, locale)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2 border-t border-paper-200 pt-2 dark:border-umber-700">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          {t("admin.suppliers_edit_cancel")}
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving ? t("admin.suppliers_edit_saving") : t("admin.suppliers_edit_save")}
        </button>
      </div>
    </form>
  );
}

/** Hero + gallery of one listing. `listingId` is the LISTING id (`c<N>` for a
 *  community row), not the community row id — the photos live on the mirrored
 *  listing, which is what the public card actually reads. */
export function SupplierPhotoManager({ listingId }: { listingId: string }) {
  const { t } = useT();
  const toast = useToast();
  const [photos, setPhotos] = useState<AdminListingPhoto[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    adminSupplierApi
      .listPhotos(listingId)
      .then((r) => {
        if (alive) setPhotos(r.photos);
      })
      // A listing that has no mirrored row yet (or any read failure) shows the
      // empty state rather than an error banner — the moderator's next action
      // is the same either way: paste a URL.
      .catch(() => {
        if (alive) setPhotos([]);
      });
    return () => {
      alive = false;
    };
  }, [listingId]);

  const add = useCallback(
    async (role?: "hero" | "gallery") => {
      const value = url.trim();
      if (!value) return;
      setBusy(true);
      try {
        const r = await adminSupplierApi.addPhoto(listingId, value, role);
        setPhotos(r.photos);
        setUrl("");
        toast.success(t("admin.suppliers_photos_added"));
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      } finally {
        setBusy(false);
      }
    },
    [listingId, url, toast, t],
  );

  async function remove(photoId: number | "hero") {
    setBusy(true);
    try {
      const r = await adminSupplierApi.removePhoto(listingId, photoId);
      setPhotos(r.photos);
      toast.success(t("admin.suppliers_photos_removed"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  /** Promote a gallery thumbnail to the card image. The server re-downloads
   *  from our own URL, which keeps one code path for "where does a hero come
   *  from" instead of a second one that copies storage keys around. */
  async function promote(photo: AdminListingPhoto) {
    setBusy(true);
    try {
      const absolute = new URL(photo.url, window.location.origin).toString();
      const r = await adminSupplierApi.addPhoto(listingId, absolute, "hero");
      setPhotos(r.photos);
      toast.success(t("admin.suppliers_photos_added"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card flex flex-col gap-3">
      <h3 className="eyebrow m-0">{t("admin.suppliers_photos_section")}</h3>

      {photos === null ? null : photos.length === 0 ? (
        <p className="m-0 flex items-center gap-2 text-xs text-neutral-500 dark:text-umber-300">
          <ImageOff size={14} aria-hidden />
          {t("admin.suppliers_photos_empty")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {photos.map((p) => (
            <li
              key={p.id ?? "hero"}
              className="group relative h-24 w-32 overflow-hidden rounded-lg bg-paper-100 ring-1 ring-ink-100 dark:bg-umber-800 dark:ring-umber-700"
            >
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              <span className="absolute left-1 top-1 rounded-full bg-neutral-900/80 px-2 py-0.5 text-[10px] font-medium text-paper-50">
                {p.role === "hero"
                  ? t("admin.suppliers_photos_hero")
                  : t("admin.suppliers_photos_gallery")}
              </span>
              <span className="absolute right-1 top-1 flex gap-1">
                {p.role === "gallery" ? (
                  <button
                    type="button"
                    className="rounded-full bg-neutral-900/80 p-1 text-paper-50"
                    onClick={() => promote(p)}
                    disabled={busy}
                    aria-label={t("admin.suppliers_photos_make_hero")}
                    title={t("admin.suppliers_photos_make_hero")}
                  >
                    <Star size={12} aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-full bg-neutral-900/80 p-1 text-paper-50"
                  onClick={() => remove(p.id ?? "hero")}
                  disabled={busy}
                  aria-label={t("admin.suppliers_photos_remove_aria")}
                  title={t("admin.suppliers_photos_remove_aria")}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1"
          type="url"
          value={url}
          placeholder={t("admin.suppliers_photos_add_placeholder")}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          aria-label={t("admin.suppliers_photos_add")}
        />
        <button
          type="button"
          className="btn-outline btn-sm"
          onClick={() => void add()}
          disabled={busy || url.trim() === ""}
        >
          <Plus size={14} aria-hidden />
          {busy ? t("admin.suppliers_photos_adding") : t("admin.suppliers_photos_add")}
        </button>
      </div>
      <p className="m-0 text-[11px] text-neutral-500 dark:text-umber-300">
        {t("admin.suppliers_photos_add_help")}
      </p>
    </section>
  );
}
