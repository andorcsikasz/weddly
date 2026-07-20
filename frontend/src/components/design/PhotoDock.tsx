// The photo dock: the two optional guest-page photos, and the colour vs
// black-and-white treatment that applies to them.
//
// The treatment used to be a separate control group with its own heading, two
// tiles up in the details accordion. With no photos uploaded it previewed a
// gradient swatch, so it was a control that showed you nothing about your own
// page and sat nowhere near the thing it acted on. It now lives ON the
// thumbnail as a two-segment badge, and only appears once there is a photo for
// it to act on.

import { IMAGE_TREATMENTS, type ImageTreatmentSlug } from "@shared/design";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useT } from "../../lib/i18n";

export function PhotoDock({
  slot1Url,
  slot2Url,
  coverUrl,
  treatment,
  onTreatment,
  onUpload,
  onRemove,
  busySlot,
  readOnly,
}: {
  slot1Url: string | null | undefined;
  slot2Url: string | null | undefined;
  coverUrl: string | null | undefined;
  treatment: ImageTreatmentSlug;
  onTreatment: (slug: ImageTreatmentSlug) => void;
  onUpload: (slot: 1 | 2, file: File) => void;
  onRemove: (slot: 1 | 2) => void;
  busySlot: 1 | 2 | null;
  readOnly: boolean;
}) {
  const { t } = useT();
  const filter = treatment === "grayscale" ? "grayscale(1)" : "none";
  // The treatment only exists once it has something to act on. A cover photo
  // counts: it is the biggest image on the guest page.
  const hasAnyPhoto = Boolean(coverUrl || slot1Url || slot2Url);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="eyebrow">{t("design.section.photos")}</p>
        {hasAnyPhoto && (
          <div
            className="flex items-center gap-0.5 rounded-full border border-paper-300 p-0.5 dark:border-umber-700"
            role="group"
            aria-label={t("design.web.image_treatment_label")}
          >
            {IMAGE_TREATMENTS.map((it) => {
              const active = treatment === it.slug;
              return (
                <button
                  key={it.slug}
                  type="button"
                  onClick={() => onTreatment(it.slug)}
                  aria-pressed={active}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:focus-visible:ring-paper-100 ${
                    active
                      ? "bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                      : "text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                  }`}
                >
                  {t(it.nameKey)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {([1, 2] as const).map((slot) => {
          const url = slot === 1 ? slot1Url : slot2Url;
          const busy = busySlot === slot;
          return (
            <div key={slot} className="relative">
              {url ? (
                <>
                  <img
                    src={url}
                    alt={t("design.web.photo_slot", { n: slot })}
                    className="aspect-[16/10] w-full rounded-xl border border-paper-300 object-cover dark:border-umber-700"
                    style={{ filter }}
                  />
                  <button
                    type="button"
                    onClick={() => onRemove(slot)}
                    disabled={busy || readOnly}
                    aria-label={t("design.web.photo_remove")}
                    className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-paper-200 bg-white text-ink-700 shadow-soft transition hover:text-ink-900 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:focus-visible:ring-paper-100"
                  >
                    {busy ? (
                      <Loader2 size={12} className="animate-spin" aria-hidden />
                    ) : (
                      <X size={12} aria-hidden />
                    )}
                  </button>
                </>
              ) : (
                <label
                  className={`flex aspect-[16/10] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-paper-400 text-ink-400 transition focus-within:ring-2 focus-within:ring-ink-300 hover:border-ink-400 hover:text-ink-600 dark:border-umber-600 dark:text-umber-300 dark:focus-within:ring-paper-100 dark:hover:text-umber-100 ${
                    busy || readOnly ? "cursor-default opacity-60" : "cursor-pointer"
                  }`}
                >
                  {busy ? (
                    <Loader2 size={18} className="animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus size={18} aria-hidden />
                  )}
                  <span className="text-[11px] font-medium">
                    {t("design.web.photo_slot", { n: slot })}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={busy || readOnly}
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      if (f) onUpload(slot, f);
                      ev.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
