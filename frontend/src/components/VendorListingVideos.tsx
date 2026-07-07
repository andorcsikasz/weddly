// Vendor listing "Videos" editor — the reference-video reel that sits directly
// below the photo Gallery on the vendor listing page. Kept a self-contained
// component (its own busy state + toasts + live URL validation) so it reads as
// a natural extension of the gallery without bloating VendorListingPage.
//
// Videos are pasted YouTube links, not file uploads: every mutation hits the
// server immediately (like the gallery + availability actions) and the parent
// re-renders from the returned view. Reordering is optimistic — the local list
// reshuffles on drop / arrow-key move, then persists; a failure reverts.
//
// Accessibility: drag-and-drop for pointer users PLUS up/down arrow buttons for
// keyboard users (native HTML5 DnD isn't keyboard-operable), labelled controls,
// and an inline validated URL field.

import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Play, Plus, X } from "lucide-react";
import type { VendorListingView } from "@shared/listings";
import {
  type ListingVideo,
  MAX_LISTING_VIDEOS,
  parseVideoUrl,
  videoThumbnailUrl,
} from "@shared/listing_videos";
import { vendorListingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useToast } from "./ui/ToastProvider";

/** Compare two reels by id-order so a props sync doesn't clobber an in-flight
 *  optimistic reorder with an identical list. */
function sameOrder(a: ListingVideo[], b: ListingVideo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v.id === b[i]?.id);
}

export function VendorListingVideos({
  videos,
  onChange,
}: {
  videos: ListingVideo[];
  onChange: (view: VendorListingView) => void;
}) {
  const { t } = useT();
  const toast = useToast();

  // Local mirror of the reel so drag / arrow moves reshuffle instantly; synced
  // from props whenever the server order actually changes.
  const [items, setItems] = useState<ListingVideo[]>(videos);
  const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Add / edit URL field state. `editingId === null` => the add field; a number
  // => that card is in inline-edit mode.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const addInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setItems((prev) => (sameOrder(prev, videos) ? prev : videos));
  }, [videos]);

  const atCap = items.length >= MAX_LISTING_VIDEOS;
  const draftValid = parseVideoUrl(draft) !== null;
  const draftShowsError = draft.trim().length > 0 && !draftValid;

  const persistOrder = async (next: ListingVideo[]) => {
    const before = items;
    setItems(next); // optimistic
    setBusy(true);
    try {
      const view = await vendorListingApi.reorderVideos(next.map((v) => v.id));
      onChange(view);
    } catch {
      setItems(before); // revert
      toast.error(t("vendor_home.videos_reorder_failed"));
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    void persistOrder(next);
  };

  const onDrop = (targetIndex: number) => {
    setOverIndex(null);
    const from = dragIndex;
    setDragIndex(null);
    if (from === null || from === targetIndex) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    void persistOrder(next);
  };

  const onAdd = async () => {
    const url = draft.trim();
    if (!url || !draftValid || busy || atCap) return;
    setBusy(true);
    try {
      const view = await vendorListingApi.addVideo(url);
      onChange(view);
      setDraft("");
      toast.success(t("vendor_home.videos_add_success"));
    } catch (err) {
      const code = (err as { detail?: { code?: string } } | undefined)?.detail?.code;
      toast.error(
        code === "videos_full"
          ? t("vendor_home.videos_full", { max: String(MAX_LISTING_VIDEOS) })
          : t("vendor_home.videos_add_failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = async (videoId: number) => {
    const url = draft.trim();
    if (!url || !draftValid || busy) return;
    setBusy(true);
    try {
      const view = await vendorListingApi.updateVideo(videoId, url);
      onChange(view);
      setEditingId(null);
      setDraft("");
      toast.success(t("vendor_home.videos_update_success"));
    } catch {
      toast.error(t("vendor_home.videos_update_failed"));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (videoId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const view = await vendorListingApi.deleteVideo(videoId);
      onChange(view);
      if (editingId === videoId) {
        setEditingId(null);
        setDraft("");
      }
      toast.success(t("vendor_home.videos_delete_success"));
    } catch {
      toast.error(t("vendor_home.videos_delete_failed"));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (v: ListingVideo) => {
    setEditingId(v.id);
    setDraft(v.url);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  // Enter in a URL field must NOT submit the outer listing <form>.
  const onFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>, submit: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <fieldset className="card space-y-2.5 p-4" disabled={busy}>
      <legend className="font-semibold">{t("vendor_home.section_videos")}</legend>
      <p className="text-sm text-ink-600 dark:text-umber-200">{t("vendor_home.videos_intro")}</p>

      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {items.map((v, i) => {
            const isEditing = editingId === v.id;
            return (
              <li
                key={v.id}
                draggable={!isEditing}
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={() => onDrop(i)}
                className={`group relative rounded-lg ${
                  overIndex === i && dragIndex !== null && dragIndex !== i
                    ? "ring-2 ring-steel-400"
                    : ""
                } ${dragIndex === i ? "opacity-50" : ""}`}
              >
                <div className="relative aspect-video overflow-hidden rounded-lg bg-ink-900">
                  <img
                    src={videoThumbnailUrl(v)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-ink-900">
                      <Play size={16} className="ml-0.5 fill-current" aria-hidden />
                    </span>
                  </span>
                  {/* Drag handle (pointer reorder). Keyboard users get the
                      up/down buttons below instead. */}
                  <span
                    aria-hidden
                    className="absolute left-1 top-1 cursor-grab rounded-md bg-ink-900/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    title={t("vendor_home.videos_drag")}
                  >
                    <GripVertical size={14} />
                  </span>
                  <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label={t("vendor_home.videos_edit")}
                      onClick={() => startEdit(v)}
                      className="rounded-full bg-ink-900/60 p-1 text-white hover:bg-ink-900/85 focus-visible:opacity-100"
                    >
                      <Pencil size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={t("vendor_home.videos_delete")}
                      onClick={() => void onRemove(v.id)}
                      className="rounded-full bg-ink-900/60 p-1 text-white hover:bg-ink-900/85 focus-visible:opacity-100"
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </div>
                </div>

                {/* Keyboard reorder controls. */}
                <div className="mt-1 flex items-center justify-center gap-1">
                  <button
                    type="button"
                    aria-label={t("vendor_home.videos_move_up")}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-500 transition hover:bg-paper-200 hover:text-ink-800 disabled:opacity-30 dark:text-umber-300 dark:hover:bg-umber-700"
                  >
                    <ChevronUp size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t("vendor_home.videos_move_down")}
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-500 transition hover:bg-paper-200 hover:text-ink-800 disabled:opacity-30 dark:text-umber-300 dark:hover:bg-umber-700"
                  >
                    <ChevronDown size={15} aria-hidden />
                  </button>
                </div>

                {isEditing && (
                  <div className="mt-1.5 space-y-1.5">
                    <input
                      type="url"
                      className="input"
                      value={draft}
                      autoFocus
                      aria-label={t("vendor_home.videos_url_label")}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => onFieldKeyDown(e, () => void onSaveEdit(v.id))}
                    />
                    {draftShowsError && (
                      <p className="text-xs text-blush-600 dark:text-blush-300">
                        {t("vendor_home.videos_url_invalid")}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void onSaveEdit(v.id)}
                        disabled={!draftValid}
                        className="btn bg-steel-600 px-3 py-1 text-xs text-white hover:bg-steel-700 disabled:opacity-50"
                      >
                        {t("vendor_home.videos_edit_save")}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="btn-ghost px-3 py-1 text-xs"
                      >
                        {t("vendor_home.videos_edit_cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add row — hidden at the cap. Doubles as the empty-state CTA. */}
      {!atCap && editingId === null && (
        <div className="space-y-1.5">
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("vendor_home.videos_hint")}</p>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <input
                ref={addInputRef}
                type="url"
                className="input"
                value={draft}
                placeholder={t("vendor_home.videos_url_placeholder")}
                aria-label={t("vendor_home.videos_url_label")}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => onFieldKeyDown(e, () => void onAdd())}
              />
              {draftShowsError && (
                <p className="mt-1 text-xs text-blush-600 dark:text-blush-300">
                  {t("vendor_home.videos_url_invalid")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={!draftValid}
              className="btn inline-flex shrink-0 items-center gap-1.5 bg-steel-600 text-white hover:bg-steel-700 disabled:opacity-50"
            >
              <Plus size={16} aria-hidden />
              {t("vendor_home.videos_add")}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-500 dark:text-umber-300">
        {t("vendor_home.videos_count", {
          n: String(items.length),
          max: String(MAX_LISTING_VIDEOS),
        })}
      </p>
    </fieldset>
  );
}
