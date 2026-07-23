// The photo dock: the two optional guest-page photos, and the colour vs
// black-and-white treatment that applies to them.
//
// An empty slot leads with the curated gallery — a couple without their own
// photos yet still gets a page that looks composed in one tap — and keeps
// "upload your own" as the quieter alternative underneath. Uploaded and curated
// images land in the same column and render identically on the guest page.
//
// The treatment used to be a separate control group with its own heading, two
// tiles up in the details accordion. With no photos uploaded it previewed a
// gradient swatch, so it was a control that showed you nothing about your own
// page and sat nowhere near the thing it acted on. It now lives ON the
// thumbnail as a two-segment badge, and only appears once there is a photo for
// it to act on.

import {
  COVER_IMAGE_ACCEPT,
  COVER_IMAGE_MAX_MB,
  CURATED_SITE_PHOTOS,
  curatedPhotoUrl,
  IMAGE_TREATMENTS,
  type ImageTreatmentSlug,
} from "@shared/design";
import { ImagePlus, Images, Loader2, Move, X } from "lucide-react";
import { useState } from "react";
import { useT } from "../../lib/i18n";
import { Button } from "../ui";
import { Dialog } from "../ui/Dialog";
import { CoverPositioner } from "./CoverPositioner";

export function PhotoDock({
  slot1Url,
  slot2Url,
  coverUrl,
  treatment,
  onTreatment,
  onUpload,
  onChoosePreset,
  onRemove,
  onCoverUpload,
  onCoverRemove,
  coverPositionX,
  coverPositionY,
  coverScale,
  onCoverReposition,
  coverBusy,
  busySlot,
  readOnly,
}: {
  slot1Url: string | null | undefined;
  slot2Url: string | null | undefined;
  coverUrl: string | null | undefined;
  treatment: ImageTreatmentSlug;
  onTreatment: (slug: ImageTreatmentSlug) => void;
  onUpload: (slot: 1 | 2, file: File) => void;
  onChoosePreset: (slot: 1 | 2, slug: string) => void;
  onRemove: (slot: 1 | 2) => void;
  onCoverUpload: (file: File) => void;
  onCoverRemove: () => void;
  /** Cover focal point (object-position %, 0..100) + zoom (percent, 100..300). */
  coverPositionX: number;
  coverPositionY: number;
  coverScale: number;
  /** Persist a new focal point + zoom (from the Adjust dialog). */
  onCoverReposition: (x: number, y: number, scale: number) => void;
  coverBusy: boolean;
  busySlot: 1 | 2 | null;
  readOnly: boolean;
}) {
  const { t } = useT();
  const [galleryFor, setGalleryFor] = useState<1 | 2 | null>(null);
  // Adjust dialog: a local draft so dragging/zooming previews live and only the
  // Save button persists (Cancel discards).
  const [adjusting, setAdjusting] = useState(false);
  const [draft, setDraft] = useState({ x: 50, y: 50, scale: 100 });
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

      {/* The cover: the hero image that leads the guest page (the big photo in
          the preview above). It lives elsewhere too (the guest-page editor, with
          a focal-point positioner), but a couple styling their page shouldn't
          have to leave to swap it, so upload / replace / remove sit right here. */}
      <div className="mb-3">
        {coverUrl ? (
          <div className="relative">
            {/* Inner clip layer: the zoom transform scales the image up, so it
                must be clipped here (the corner buttons live OUTSIDE this so they
                aren't cut off). Mirrors the guest-page hero render. */}
            <div className="relative overflow-hidden rounded-xl border border-paper-300 dark:border-umber-700">
              <img
                src={coverUrl}
                alt={t("design.web.cover_label")}
                className="aspect-[21/9] w-full object-cover"
                style={{
                  objectPosition: `${coverPositionX}% ${coverPositionY}%`,
                  transform: `scale(${Math.max(1, coverScale / 100)})`,
                  transformOrigin: `${coverPositionX}% ${coverPositionY}%`,
                  filter,
                }}
              />
              <label
                className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 border-t border-white/20 bg-black/45 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/60 focus-within:ring-2 focus-within:ring-inset focus-within:ring-white/70 ${
                  coverBusy || readOnly ? "cursor-default opacity-60" : "cursor-pointer"
                }`}
              >
                {coverBusy ? (
                  <Loader2 size={13} className="animate-spin" aria-hidden />
                ) : (
                  <ImagePlus size={13} aria-hidden />
                )}
                <span>{t("design.web.cover_replace")}</span>
                <input
                  type="file"
                  accept={COVER_IMAGE_ACCEPT}
                  aria-label={t("design.web.cover_replace_aria")}
                  className="sr-only"
                  disabled={coverBusy || readOnly}
                  onChange={(ev) => {
                    const f = ev.target.files?.[0];
                    if (f) onCoverUpload(f);
                    ev.target.value = "";
                  }}
                />
              </label>
            </div>
            {/* Adjust (drag + zoom). Seeds the draft from the saved values. */}
            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  setDraft({ x: coverPositionX, y: coverPositionY, scale: coverScale });
                  setAdjusting(true);
                }}
                disabled={coverBusy}
                aria-label={t("design.web.cover_adjust")}
                title={t("design.web.cover_adjust")}
                className="absolute -left-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-paper-200 bg-white text-ink-700 shadow-soft transition hover:text-ink-900 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:focus-visible:ring-paper-100"
              >
                <Move size={12} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={onCoverRemove}
              disabled={coverBusy || readOnly}
              aria-label={t("design.web.cover_remove")}
              className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-paper-200 bg-white text-ink-700 shadow-soft transition hover:text-ink-900 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:focus-visible:ring-paper-100"
            >
              {coverBusy ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <X size={12} aria-hidden />
              )}
            </button>
          </div>
        ) : (
          <label
            className={`flex aspect-[21/9] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-paper-400 text-ink-500 transition hover:text-ink-800 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ink-300 dark:border-umber-600 dark:text-umber-200 dark:hover:text-paper-50 dark:focus-within:ring-paper-100 ${
              coverBusy || readOnly ? "cursor-default opacity-60" : "cursor-pointer"
            }`}
          >
            {coverBusy ? (
              <Loader2 size={18} className="animate-spin" aria-hidden />
            ) : (
              <ImagePlus size={18} aria-hidden />
            )}
            <span className="text-[11px] font-medium">{t("design.web.cover_upload_cta")}</span>
            <input
              type="file"
              accept={COVER_IMAGE_ACCEPT}
              aria-label={t("design.web.cover_upload_cta")}
              className="sr-only"
              disabled={coverBusy || readOnly}
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) onCoverUpload(f);
                ev.target.value = "";
              }}
            />
          </label>
        )}
        {/* Spell out what the uploader accepts, so a couple isn't guessing (a
            camera photo is often over the cap). */}
        <p className="mt-1 text-[10px] leading-tight text-ink-400 dark:text-umber-400">
          {t("design.web.cover_constraints", { mb: COVER_IMAGE_MAX_MB })}
        </p>
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
                <div
                  className={`flex aspect-[16/10] w-full flex-col overflow-hidden rounded-xl border border-dashed border-paper-400 dark:border-umber-600 ${
                    busy || readOnly ? "opacity-60" : ""
                  }`}
                >
                  {/* Primary: pick a ready-made design. Whole upper area is the tap
                      target so a couple with no photos yet lands here first. */}
                  <button
                    type="button"
                    onClick={() => setGalleryFor(slot)}
                    disabled={busy || readOnly}
                    className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-500 transition hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-300 disabled:cursor-default dark:text-umber-200 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
                  >
                    {busy ? (
                      <Loader2 size={18} className="animate-spin" aria-hidden />
                    ) : (
                      <Images size={18} aria-hidden />
                    )}
                    <span className="text-[11px] font-medium">
                      {t("design.web.photo_gallery_cta")}
                    </span>
                  </button>
                  {/* Secondary: upload your own, a quiet strip along the bottom. */}
                  <label
                    className={`flex items-center justify-center gap-1.5 border-t border-dashed border-paper-400 py-1.5 text-[11px] text-ink-400 transition focus-within:ring-2 focus-within:ring-inset focus-within:ring-ink-300 hover:text-ink-600 dark:border-umber-600 dark:text-umber-300 dark:focus-within:ring-paper-100 dark:hover:text-paper-100 ${
                      busy || readOnly ? "cursor-default" : "cursor-pointer"
                    }`}
                  >
                    <ImagePlus size={13} aria-hidden />
                    <span>{t("design.web.photo_upload_own")}</span>
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Adjust the cover in-frame: drag to reposition + zoom. Draft-then-Save
          so Cancel discards. */}
      <Dialog
        open={adjusting}
        onClose={() => setAdjusting(false)}
        role="dialog"
        size="lg"
        title={t("design.web.cover_adjust")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjusting(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                onCoverReposition(draft.x, draft.y, draft.scale);
                setAdjusting(false);
              }}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        {coverUrl && (
          <CoverPositioner
            src={coverUrl}
            x={draft.x}
            y={draft.y}
            scale={draft.scale}
            filter={filter}
            onChange={(x, y, scale) => setDraft({ x, y, scale })}
            onCommit={(x, y, scale) => setDraft({ x, y, scale })}
            hint={t("design.web.cover_adjust_hint")}
          />
        )}
      </Dialog>

      <Dialog
        open={galleryFor !== null}
        onClose={() => setGalleryFor(null)}
        role="dialog"
        closeOnBackdrop
        size="lg"
        title={t("design.web.photo_gallery_title")}
      >
        <div className="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3">
          {CURATED_SITE_PHOTOS.map((photo) => {
            const src = curatedPhotoUrl(photo.slug);
            if (!src) return null;
            return (
              <button
                key={photo.slug}
                type="button"
                onClick={() => {
                  if (galleryFor) onChoosePreset(galleryFor, photo.slug);
                  setGalleryFor(null);
                }}
                title={t(photo.nameKey)}
                aria-label={t(photo.nameKey)}
                className="group overflow-hidden rounded-xl border border-paper-300 transition hover:border-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-500 dark:border-umber-700 dark:hover:border-paper-200 dark:focus-visible:ring-paper-100"
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="aspect-[16/10] w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
              </button>
            );
          })}
        </div>
      </Dialog>
    </section>
  );
}
