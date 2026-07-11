// Planner "Offerings" settings tab: publish price packages (árajánlat) with an
// optional price-list PDF, and manage the availability calendar + free-text
// note. Everything here surfaces on the couple-facing planner detail page. The
// package + PDF flows mirror the vendor listing editor; the calendar reuses the
// shared AvailabilityCalendar in editable mode.

import {
  MAX_LISTING_PACKAGES,
  PACKAGE_DESCRIPTION_MAX,
  PACKAGE_NAME_MAX,
  PACKAGE_PDF_MAX_BYTES,
  PACKAGE_PRICE_MAX,
  type ListingPackage,
} from "@shared/listing_packages";
import type { PlannerAvailabilityView, PlannerProfile } from "@shared/types";
import { FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useConfirm } from "../../components/ui/ConfirmDialogProvider";
import { useToast } from "../../components/ui";
import { AvailabilityCalendar } from "../../components/AvailabilityCalendar";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

interface OutletCtx {
  profile: PlannerProfile | null;
  setProfile: (p: PlannerProfile) => void;
  loadError: boolean;
}

function formatIsoDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** One editable package card: local text state seeded from the package, a save,
 *  a delete, and the PDF attach/replace/remove controls. Every server call
 *  returns the refreshed profile, which the parent pushes into context. */
function PackageCard({
  pkg,
  onProfile,
}: {
  pkg: ListingPackage;
  onProfile: (p: PlannerProfile) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(pkg.name);
  const [price, setPrice] = useState(pkg.price_text ?? "");
  const [description, setDescription] = useState(pkg.description ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const dirty =
    name.trim() !== pkg.name ||
    (price.trim() || null) !== pkg.price_text ||
    (description.trim() || null) !== pkg.description;

  async function save() {
    if (name.trim().length === 0) return;
    setSaving(true);
    try {
      const updated = await plannerApi.updatePackage(pkg.id, {
        name: name.trim(),
        price_text: price.trim() || null,
        description: description.trim() || null,
      });
      onProfile(updated);
      toast.success(t("planner_offerings.package_saved"));
    } catch {
      toast.error(t("planner_offerings.save_error"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t("planner_offerings.package_delete"),
      body: t("planner_offerings.package_delete_confirm"),
      confirmLabel: t("planner_offerings.package_delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      onProfile(await plannerApi.deletePackage(pkg.id));
      toast.success(t("planner_offerings.package_deleted"));
    } catch {
      toast.error(t("planner_offerings.save_error"));
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      toast.error(t("planner_offerings.pdf_invalid"));
      return;
    }
    if (file.size > PACKAGE_PDF_MAX_BYTES) {
      toast.error(t("planner_offerings.pdf_too_large"));
      return;
    }
    setUploading(true);
    try {
      onProfile(await plannerApi.uploadPackagePdf(pkg.id, file));
      toast.success(t("planner_offerings.pdf_uploaded"));
    } catch {
      toast.error(t("planner_offerings.save_error"));
    } finally {
      setUploading(false);
    }
  }

  async function removePdf() {
    try {
      onProfile(await plannerApi.deletePackagePdf(pkg.id));
      toast.success(t("planner_offerings.pdf_removed"));
    } catch {
      toast.error(t("planner_offerings.save_error"));
    }
  }

  return (
    <div className="rounded-2xl border border-paper-300 bg-white p-4 shadow-soft dark:border-umber-700 dark:bg-umber-800 dark:shadow-none">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-umber-600 dark:text-umber-300">
            {t("planner_offerings.package_name_label")}
          </label>
          <input
            type="text"
            className="input w-full"
            value={name}
            maxLength={PACKAGE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-umber-600 dark:text-umber-300">
            {t("planner_offerings.package_price_label")}
          </label>
          <input
            type="text"
            className="input w-full"
            value={price}
            maxLength={PACKAGE_PRICE_MAX}
            placeholder={t("planner_offerings.package_price_placeholder")}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-umber-600 dark:text-umber-300">
            {t("planner_offerings.package_description_label")}
          </label>
          <textarea
            rows={2}
            className="input w-full resize-none"
            value={description}
            maxLength={PACKAGE_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* PDF row */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-paper-200 pt-3 dark:border-umber-700">
        <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={onFile} />
        {pkg.pdf_url ? (
          <>
            <a
              href={pkg.pdf_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-sm text-steel-700 hover:underline dark:text-steel-300"
            >
              <FileText size={15} aria-hidden />
              {pkg.pdf_name ?? t("planner_offerings.package_pdf_label")}
            </a>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-outline btn-sm"
            >
              {uploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                t("planner_offerings.package_pdf_replace")
              )}
            </button>
            <button
              type="button"
              onClick={() => void removePdf()}
              className="text-sm text-blush-600 hover:underline dark:text-blush-300"
            >
              {t("planner_offerings.package_pdf_remove")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-outline btn-sm inline-flex items-center gap-1.5"
          >
            {uploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} aria-hidden />
            )}
            {t("planner_offerings.package_pdf_upload")}
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => void remove()}
          aria-label={t("planner_offerings.package_delete")}
          className="inline-flex items-center gap-1.5 text-sm text-blush-600 hover:underline dark:text-blush-300"
        >
          <Trash2 size={14} aria-hidden />
          {t("planner_offerings.package_delete")}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty || name.trim().length === 0}
          className="btn-primary btn-sm"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : t("common.save")}
        </button>
      </div>
    </div>
  );
}

export default function PlannerSettingsOfferings() {
  const { t, locale } = useT();
  const toast = useToast();
  const { profile, setProfile } = useOutletContext<OutletCtx>();

  const [adding, setAdding] = useState(false);
  const [availability, setAvailability] = useState<PlannerAvailabilityView | null>(null);
  const [availBusy, setAvailBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    plannerApi
      .getAvailability()
      .then(setAvailability)
      .catch(() => setAvailability({ blocked_dates: [], next_available: null }));
  }, []);

  useEffect(() => {
    if (profile) setNote(profile.planner_availability ?? "");
  }, [profile]);

  const packages = profile?.packages ?? [];

  async function addPackage() {
    setAdding(true);
    try {
      setProfile(await plannerApi.addPackage({ name: t("planner_offerings.new_package_default") }));
    } catch {
      toast.error(t("planner_offerings.packages_full"));
    } finally {
      setAdding(false);
    }
  }

  async function toggleDay(date: string, currentlyBlocked: boolean) {
    setAvailBusy(true);
    try {
      const next = currentlyBlocked
        ? await plannerApi.unblockDate(date)
        : await plannerApi.blockDate(date);
      setAvailability(next);
    } catch {
      toast.error(t("planner_offerings.availability_error"));
    } finally {
      setAvailBusy(false);
    }
  }

  async function saveNote() {
    setNoteSaving(true);
    try {
      const updated = await plannerApi.updateProfile({ planner_availability: note.trim() || null });
      setProfile(updated);
      toast.success(t("planner_offerings.note_saved"));
    } catch {
      toast.error(t("planner_offerings.save_error"));
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <div className="mt-8 space-y-10">
      {/* ── Pricing packages ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("planner_offerings.pricing_title")}
        </h2>
        <p className="mt-1 text-sm text-umber-500 dark:text-umber-300">
          {t("planner_offerings.pricing_subtitle")}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {packages.map((p) => (
            <PackageCard key={p.id} pkg={p} onProfile={setProfile} />
          ))}
        </div>

        {packages.length < MAX_LISTING_PACKAGES ? (
          <button
            type="button"
            onClick={() => void addPackage()}
            disabled={adding}
            className="btn-outline mt-4 inline-flex items-center gap-1.5"
          >
            {adding ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={16} aria-hidden />
            )}
            {t("planner_offerings.add_package")}
          </button>
        ) : (
          <p className="mt-4 text-sm italic text-umber-400 dark:text-umber-400">
            {t("planner_offerings.packages_full")}
          </p>
        )}
      </section>

      {/* ── Availability ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("planner_offerings.availability_title")}
        </h2>
        <p className="mt-1 text-sm text-umber-500 dark:text-umber-300">
          {t("planner_offerings.availability_subtitle")}
        </p>

        <div className="mt-4 max-w-sm rounded-2xl border border-paper-300 bg-white p-4 shadow-soft dark:border-umber-700 dark:bg-umber-800 dark:shadow-none">
          <AvailabilityCalendar
            blockedDates={availability?.blocked_dates ?? []}
            editable
            busy={availBusy}
            onToggle={(date, blocked) => void toggleDay(date, blocked)}
          />
          <p className="mt-3 border-t border-paper-200 pt-3 text-xs text-umber-500 dark:border-umber-700 dark:text-umber-300">
            {availability?.next_available
              ? t("planner_offerings.availability_next_free", {
                  date: formatIsoDate(availability.next_available, locale),
                })
              : t("planner_offerings.availability_none_free")}
          </p>
        </div>

        {/* Free-text note */}
        <div className="mt-6 max-w-lg">
          <label className="block text-sm font-medium text-umber-700 dark:text-umber-300">
            {t("planner_offerings.note_title")}
          </label>
          <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
            {t("planner_offerings.note_subtitle")}
          </p>
          <textarea
            rows={2}
            maxLength={200}
            className="input mt-2 w-full resize-none"
            value={note}
            placeholder={t("planner_offerings.note_placeholder")}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void saveNote()}
              disabled={noteSaving || note.trim() === (profile?.planner_availability ?? "")}
              className="btn-primary btn-sm"
            >
              {noteSaving ? <Loader2 size={14} className="animate-spin" /> : t("common.save")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
