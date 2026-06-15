// Weddly Photos — guest photo collection hub.
//
// Three panels:
//   "From guests"    — QR/link-based guest uploads. Empty → create modal → active.
//   "To guests"      — shared reveal gallery. Coming soon.
//   "By photographer"— couple saves photographer gallery link. Live (existing backend).

import type { Couple, MediaLinks, PhotoAlbum } from "@shared/types";
import { Camera, Copy, ExternalLink, Eye, Link2, Pencil, Share2, Users } from "lucide-react";
import { type FormEvent, type SVGProps, useEffect, useRef, useState } from "react";
import { Dialog, useToast } from "../components/ui";
import { coupleApi, photoAlbumApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// --- helpers ----------------------------------------------------------------

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Simplified QR code silhouette used as a placeholder before real generation.
function QrPlaceholder({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className={className} fill="currentColor">
      {/* top-left finder */}
      <rect
        x="4"
        y="4"
        width="24"
        height="24"
        rx="3"
        fillOpacity="0"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      <rect x="11" y="11" width="10" height="10" rx="1.5" />
      {/* top-right finder */}
      <rect
        x="52"
        y="4"
        width="24"
        height="24"
        rx="3"
        fillOpacity="0"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      <rect x="59" y="11" width="10" height="10" rx="1.5" />
      {/* bottom-left finder */}
      <rect
        x="4"
        y="52"
        width="24"
        height="24"
        rx="3"
        fillOpacity="0"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      <rect x="11" y="59" width="10" height="10" rx="1.5" />
      {/* data modules */}
      <rect x="34" y="4" width="6" height="6" rx="1" />
      <rect x="42" y="4" width="6" height="6" rx="1" />
      <rect x="34" y="12" width="6" height="6" rx="1" />
      <rect x="42" y="20" width="6" height="6" rx="1" />
      <rect x="34" y="34" width="6" height="6" rx="1" />
      <rect x="42" y="34" width="6" height="6" rx="1" />
      <rect x="50" y="34" width="6" height="6" rx="1" />
      <rect x="58" y="34" width="6" height="6" rx="1" />
      <rect x="66" y="34" width="6" height="6" rx="1" />
      <rect x="34" y="42" width="6" height="6" rx="1" />
      <rect x="50" y="42" width="6" height="6" rx="1" />
      <rect x="66" y="42" width="6" height="6" rx="1" />
      <rect x="42" y="50" width="6" height="6" rx="1" />
      <rect x="58" y="50" width="6" height="6" rx="1" />
      <rect x="34" y="58" width="6" height="6" rx="1" />
      <rect x="50" y="58" width="6" height="6" rx="1" />
      <rect x="66" y="58" width="6" height="6" rx="1" />
      <rect x="34" y="66" width="6" height="6" rx="1" />
      <rect x="42" y="66" width="6" height="6" rx="1" />
      <rect x="58" y="66" width="6" height="6" rx="1" />
      <rect x="4" y="34" width="6" height="6" rx="1" />
      <rect x="12" y="34" width="6" height="6" rx="1" />
      <rect x="20" y="34" width="6" height="6" rx="1" />
      <rect x="4" y="42" width="6" height="6" rx="1" />
      <rect x="20" y="42" width="6" height="6" rx="1" />
      <rect x="4" y="50" width="6" height="6" rx="1" />
      <rect x="12" y="50" width="6" height="6" rx="1" />
    </svg>
  );
}

// --- sub-components ---------------------------------------------------------

function ComingSoonBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-paper-200 px-2.5 py-0.5 text-xs font-medium text-ink-500 dark:bg-umber-700 dark:text-umber-200">
      {label}
    </span>
  );
}

// Hero card at the top of the page.
function HeroCard({ onCreateClick }: { onCreateClick: () => void }) {
  const { t } = useT();
  return (
    <div className="card mb-5 overflow-hidden border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-lg">
          <h2 className="font-grotesk text-xl font-semibold leading-snug tracking-tight text-ink-900 sm:text-2xl dark:text-paper-50">
            {t("media.hero_title")}
          </h2>
          <p className="mt-1.5 text-sm text-ink-600 dark:text-umber-200">{t("media.hero_sub")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" className="btn-primary btn-sm" onClick={onCreateClick}>
            {t("media.hero_cta_create")}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled>
            {t("media.hero_cta_preview")}
          </button>
        </div>
      </div>
    </div>
  );
}

// "From guests" panel — primary feature card.
function FromGuestsCard({
  album,
  onCreateClick,
}: {
  album: PhotoAlbum | null;
  onCreateClick: () => void;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const uploadUrl = album
    ? `${window.location.origin}/photos/${album.uploadToken}`
    : null;
  const displayLink = uploadUrl ? uploadUrl.replace(/^https?:\/\//, "") : null;

  function handleCopy() {
    if (!uploadUrl) return;
    navigator.clipboard.writeText(uploadUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card flex flex-col gap-5 border-paper-300 bg-white dark:border-umber-700 dark:bg-umber-850">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-600 dark:bg-umber-700 dark:text-umber-200">
          <Users size={20} aria-hidden="true" />
        </div>
        {album && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sage-100 px-2.5 py-0.5 text-xs font-medium text-sage-800 dark:bg-sage-900/40 dark:text-sage-300">
            <span className="h-1.5 w-1.5 rounded-full bg-sage-500" aria-hidden="true" />
            {t("media.from_guests_active_label")}
          </span>
        )}
      </div>

      <div>
        <h3 className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
          {t("media.from_guests_title")}
        </h3>
        <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
          {t("media.from_guests_desc")}
        </p>
      </div>

      {album && displayLink ? (
        <div className="space-y-4">
          {/* QR + link row */}
          <div className="flex items-start gap-4">
            <div className="shrink-0 rounded-xl border border-paper-200 bg-paper-50 p-2 dark:border-umber-700 dark:bg-umber-800">
              <QrPlaceholder className="h-16 w-16 text-ink-800 dark:text-paper-100" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs font-medium text-ink-500 dark:text-umber-300">
                {t("media.from_guests_link_label")}
              </p>
              <p className="truncate rounded-lg border border-paper-200 bg-paper-50 px-3 py-2 font-mono text-xs text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200">
                {displayLink}
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-100"
                onClick={handleCopy}
              >
                <Copy size={12} aria-hidden="true" />
                {copied ? t("media.from_guests_copied") : t("media.from_guests_copy")}
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-2 rounded-lg bg-paper-50 px-3 py-2 dark:bg-umber-800">
            <Camera size={14} className="text-ink-400 dark:text-umber-400" aria-hidden="true" />
            <span className="text-xs text-ink-500 dark:text-umber-300">
              {album.photoCount === 0
                ? t("media.from_guests_photos_zero")
                : t("media.from_guests_photos_count").replace("{{n}}", String(album.photoCount))}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-auto">
          <button type="button" className="btn-primary btn-sm" onClick={onCreateClick}>
            <Link2 size={14} aria-hidden="true" />
            {t("media.from_guests_cta")}
          </button>
        </div>
      )}
    </div>
  );
}

// "To guests" panel — shared gallery reveal. Coming soon.
function ToGuestsCard() {
  const { t } = useT();
  return (
    <div className="card flex flex-col gap-5 border-paper-300 bg-white opacity-80 dark:border-umber-700 dark:bg-umber-850">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-400 dark:bg-umber-700 dark:text-umber-400">
          <Share2 size={20} aria-hidden="true" />
        </div>
        <ComingSoonBadge label={t("media.coming_soon_title")} />
      </div>

      <div>
        <h3 className="font-grotesk text-base font-semibold text-ink-700 dark:text-paper-200">
          {t("media.to_guests_title")}
        </h3>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("media.to_guests_desc")}</p>
      </div>

      <div className="mt-auto">
        <button type="button" className="btn-outline btn-sm" disabled>
          <Eye size={14} aria-hidden="true" />
          {t("media.to_guests_cta")}
        </button>
      </div>
    </div>
  );
}

// "By photographer" panel — link save/edit. Uses existing backend (media_links.photographer).
function PhotographerCard({
  url,
  isEditing,
  isSaving,
  draft,
  linkError,
  cardRef,
  onStartEdit,
  onDraftChange,
  onSave,
  onCancel,
}: {
  url: string | null;
  isEditing: boolean;
  isSaving: boolean;
  draft: string;
  linkError: string | null;
  cardRef: React.RefObject<HTMLDivElement | null>;
  onStartEdit: () => void;
  onDraftChange: (v: string) => void;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <div
      ref={isEditing ? cardRef : undefined}
      className="card flex flex-col gap-5 border-paper-300 bg-white dark:border-umber-700 dark:bg-umber-850"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-600 dark:bg-umber-700 dark:text-umber-200">
        <Camera size={20} aria-hidden="true" />
      </div>

      <div>
        <h3 className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
          {t("media.photographer_title")}
        </h3>
        <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
          {t("media.photographer_desc")}
        </p>
      </div>

      <div className="mt-auto">
        {isEditing ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSave(draft);
            }}
            noValidate
          >
            <input
              type="url"
              className="input text-sm"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder={t("media.collect_placeholder")}
              aria-label={t("media.photographer_title")}
              // biome-ignore lint/a11y/noAutofocus: open-to-paste UX.
              autoFocus
            />
            {linkError && (
              <p className="field-error" role="alert">
                {linkError}
              </p>
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary btn-sm" disabled={isSaving}>
                {isSaving ? t("common.saving") : t("common.save")}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={onCancel}
                disabled={isSaving}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        ) : url ? (
          <div className="flex items-center gap-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline btn-sm inline-flex items-center gap-1.5"
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t("media.photographer_open")}
            </a>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
              onClick={onStartEdit}
            >
              <Pencil size={12} aria-hidden="true" />
              {t("common.edit")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-outline btn-sm inline-flex items-center gap-1.5"
            onClick={onStartEdit}
          >
            <Link2 size={14} aria-hidden="true" />
            {t("media.photographer_cta")}
          </button>
        )}
      </div>
    </div>
  );
}

// Create-album modal — calls the real API on submit.
function CreateAlbumModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (album: PhotoAlbum) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const { album } = await photoAlbumApi.create();
      onCreated(album);
      onClose();
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={t("media.create_modal_title")}
      role="dialog"
      closeOnBackdrop
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={creating}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="create-album-form"
            className="btn-primary btn-sm"
            disabled={creating}
          >
            {creating ? t("media.create_modal_creating") : t("media.create_modal_submit")}
          </button>
        </div>
      }
    >
      <form id="create-album-form" onSubmit={handleSubmit} className="space-y-5">
        <p className="text-sm text-ink-600 dark:text-umber-200">{t("media.create_modal_desc")}</p>

        {/* Settings preview — disabled until backend ships */}
        <div className="space-y-3 rounded-xl border border-paper-200 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-800">
          <SettingRow label="Shots per guest" value="Unlimited" coming />
          <SettingRow label="Guest name required" value="Optional" coming />
          <SettingRow label="Reveal timing" value="Instant" coming />
        </div>

        <p className="text-xs text-ink-400 dark:text-umber-400">
          {t("media.from_guests_coming_note")}
        </p>
      </form>
    </Dialog>
  );
}

function SettingRow({
  label,
  value,
  coming,
}: {
  label: string;
  value: string;
  coming?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-ink-600 dark:text-umber-200">{label}</span>
      <span className="flex items-center gap-1.5 text-sm font-medium text-ink-400 dark:text-umber-400">
        {value}
        {coming && (
          <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] text-ink-400 dark:bg-umber-700">
            soon
          </span>
        )}
      </span>
    </div>
  );
}

// --- page -------------------------------------------------------------------

export default function MediaPage() {
  const { t, locale } = useT();
  const toast = useToast();

  // Photographer gallery link (live — existing backend).
  const [couple, setCouple] = useState<Couple | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const editingCardRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef("");
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // "From guests" album state — backed by real API.
  const [album, setAlbum] = useState<PhotoAlbum | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([coupleApi.current(), photoAlbumApi.current()])
      .then(([coupleRes, albumRes]) => {
        if (!cancelled) {
          setCouple(coupleRes.couple);
          setAlbum(albumRes.album);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const photographerUrl = couple?.media_links?.photographer ?? null;

  function startEdit() {
    setEditing(true);
    setDraft(photographerUrl ?? "");
    setLinkError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setLinkError(null);
  }

  async function savePhotographerLink(rawValue: string) {
    const trimmed = rawValue.trim();
    if (trimmed && !isHttpUrl(trimmed)) {
      setLinkError(t("media.collect_invalid"));
      return;
    }
    if (trimmed === (photographerUrl ?? "")) {
      setEditing(false);
      setLinkError(null);
      return;
    }
    setSaving(true);
    setLinkError(null);
    try {
      const res = await coupleApi.update({ media_links: { photographer: trimmed || null } });
      setCouple(res.couple);
      setEditing(false);
      toast.success(trimmed ? t("media.collect_saved") : t("media.collect_removed"));
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  // Click-outside auto-save for photographer card.
  useEffect(() => {
    if (!editing) return;
    function onPointerDown(e: MouseEvent) {
      const card = editingCardRef.current;
      if (card && !card.contains(e.target as Node)) {
        savePhotographerLink(draftRef.current);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [editing]);

  return (
    <>
      <header className="mb-5">
        <h1 className="font-grotesk">{t("media.title")}</h1>
        <p className="mt-1.5 text-sm text-umber-700 dark:text-umber-300">{t("media.sub")}</p>
      </header>

      <HeroCard onCreateClick={() => setShowCreateModal(true)} />

      {/* Feature cards — three panels in a responsive grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FromGuestsCard
          album={album}
          onCreateClick={() => setShowCreateModal(true)}
        />
        <ToGuestsCard />
        <PhotographerCard
          url={photographerUrl}
          isEditing={editing}
          isSaving={saving}
          draft={draft}
          linkError={linkError}
          cardRef={editingCardRef}
          onStartEdit={startEdit}
          onDraftChange={setDraft}
          onSave={savePhotographerLink}
          onCancel={cancelEdit}
        />
      </div>

      <CreateAlbumModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(newAlbum) => setAlbum(newAlbum)}
      />
    </>
  );
}
