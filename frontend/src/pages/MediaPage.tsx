import type {
  Couple,
  FilmAccessCheck,
  FilmAesthetic,
  FilmDevice,
  FilmUpload,
  PhotoAlbum,
} from "@shared/types";
import {
  FILM_AESTHETICS,
  FILM_FILTERS,
  FILM_TIER_CAPS,
  MAX_PHOTOGRAPHER_LINKS,
} from "@shared/types";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Film,
  GalleryHorizontalEnd,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  QrCode,
  ScanLine,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import React, { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { Dialog, useConfirm, useToast } from "../components/ui";
import { useModalShell } from "../components/ui/modal_shell";
import { Wordmark } from "../components/Wordmark";
import { coupleApi, photoAlbumApi } from "../lib/endpoints";
import { intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

// --- helpers ----------------------------------------------------------------

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Pull the stable backend `detail.code` off a rejected API error, if present. */
function errDetailCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "detail" in err) {
    const detail = (err as { detail?: unknown }).detail;
    if (detail && typeof detail === "object" && "code" in detail) {
      const code = (detail as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
  }
  return undefined;
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// The app locale, not the device's — an HU couple on an en-US laptop was
// reading "13 Sept 2026" inside Hungarian sentences.
function formatRevealDate(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatPreciseCountdown(ms: number): string {
  if (ms <= 0) return "0m";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const DEMO_STRIP = ["/demo/film-01.jpg", "/demo/film-02.jpg", "/demo/film-03.jpg"] as const;

const AESTHETIC_LABELS: Record<FilmAesthetic, string> = {
  natural: "Natural",
  vintage: "Vintage",
  bw: "B&W",
  cinematic: "Cinematic",
  warm: "Warm",
};

// --- ambient film grain -----------------------------------------------------

function FilmGrain() {
  return (
    <div
      className="film-grain pointer-events-none fixed inset-[-200%] z-50 h-[400%] w-[400%] select-none"
      aria-hidden="true"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C%2Fsvg%3E")`,
        backgroundSize: "160px",
        opacity: 0.022,
        mixBlendMode: "overlay" as React.CSSProperties["mixBlendMode"],
        animation: "analog-grain 0.4s steps(2) infinite",
      }}
    />
  );
}

// --- countdown --------------------------------------------------------------

function Countdown({ targetMs, label }: { targetMs: number; label: string }) {
  const [remaining, setRemaining] = useState(() => targetMs - Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const r = targetMs - Date.now();
      setRemaining(r);
      if (r <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  if (remaining <= 0) return null;
  return (
    <span className="tabular-nums">
      {label} {formatDuration(remaining)}
    </span>
  );
}

// --- placeholder film-name heuristic ----------------------------------------

function isPlaceholderTitle(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return false;
  const flagged = ["test", "teszt", "asdf", "xxx", "x"];
  if (flagged.includes(v)) return true;
  // single short token (no whitespace, length <= 3) reads as throwaway
  if (!/\s/.test(v) && v.length <= 3) return true;
  return false;
}

// --- share sheet ------------------------------------------------------------

function ShareSheet({
  open,
  names,
  url,
  onClose,
}: {
  open: boolean;
  names: string;
  url: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const longMsg = t("media.share_message_long").replace("{{names}}", names).replace("{{url}}", url);
  const smsMsg = t("media.share_message_sms").replace("{{names}}", names).replace("{{url}}", url);
  const emailBody = t("media.share_email_body").replace("{{names}}", names).replace("{{url}}", url);

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(longMsg)}`;
  const smsHref = `sms:?&body=${encodeURIComponent(smsMsg)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(
    t("media.share_email_subject"),
  )}&body=${encodeURIComponent(emailBody)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(longMsg);
      setCopied(true);
      toast.success(t("media.share_copy_msg"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  const channelClass =
    "group flex flex-col items-center gap-2 rounded-2xl border border-paper-200 px-3 py-4 text-center transition-colors hover:bg-paper-50";
  const circleClass =
    "flex h-12 w-12 items-center justify-center rounded-full bg-paper-100 text-umber-900 transition-colors group-hover:bg-paper-200";
  const channelLabel = "text-xs font-medium text-umber-700";

  return (
    <Dialog
      open={open}
      title={t("media.share_sheet_title")}
      role="dialog"
      closeOnBackdrop
      onClose={onClose}
      footer={
        <button type="button" className="btn-ghost btn-sm ml-auto" onClick={onClose}>
          {t("a11y.close")}
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={channelClass}>
          <span className={circleClass}>
            <MessageCircle size={20} aria-hidden="true" />
          </span>
          <span className={channelLabel}>{t("media.share_whatsapp")}</span>
        </a>
        <a href={smsHref} className={channelClass}>
          <span className={circleClass}>
            <MessageSquare size={20} aria-hidden="true" />
          </span>
          <span className={channelLabel}>{t("media.share_sms")}</span>
        </a>
        <a href={mailHref} className={channelClass}>
          <span className={circleClass}>
            <Mail size={20} aria-hidden="true" />
          </span>
          <span className={channelLabel}>{t("media.share_email")}</span>
        </a>
        <button type="button" onClick={handleCopy} className={channelClass}>
          <span className={circleClass}>
            {copied ? (
              <Check size={20} aria-hidden="true" />
            ) : (
              <Copy size={20} aria-hidden="true" />
            )}
          </span>
          <span className={channelLabel}>
            {copied ? t("media.share_copy_msg") : t("media.share_copy_link")}
          </span>
        </button>
      </div>
    </Dialog>
  );
}

// --- participant list (live-polling) ----------------------------------------

function ParticipantDashboard({
  albumToken,
  fallbackCount,
  onCountChange,
}: {
  albumToken: string;
  fallbackCount: number;
  onCountChange: (count: number) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [devices, setDevices] = useState<FilmDevice[]>([]);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    return photoAlbumApi
      .listDevices()
      .then((r) => {
        setDevices(r.devices);
        setLiveCount(r.total);
        onCountChange(r.total);
      })
      .catch(() => {});
  }, [onCountChange]);

  useEffect(() => {
    let active = true;
    function poll() {
      photoAlbumApi
        .listDevices()
        .then((r) => {
          if (active) {
            setDevices(r.devices);
            setLiveCount(r.total);
            onCountChange(r.total);
          }
        })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [albumToken, onCountChange]);

  async function handleRemove(device: FilmDevice) {
    if (removingId) return;
    const name = device.guestName ?? t("media.film_anonymous");
    const ok = await confirm({
      title: t("media.participant_remove_title"),
      body: t("media.participant_remove_body").replace("{{name}}", name),
      confirmLabel: t("media.participant_remove_confirm"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setRemovingId(device.deviceId);
    try {
      await photoAlbumApi.removeDevice(device.deviceId);
      await refresh();
      toast.success(t("media.participant_removed"));
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setRemovingId(null);
    }
  }

  const displayCount = liveCount ?? fallbackCount;

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between py-1 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2 text-xs text-umber-500">
          <Users size={12} aria-hidden="true" />
          {t("media.film_participants_joined").replace("{{n}}", String(displayCount))}
        </span>
        <span className="text-xs text-umber-600">{expanded ? "▲" : "▼"}</span>
      </button>
      <Link
        to="/app/guests"
        className="mt-1 inline-flex text-xs font-medium text-umber-700 underline decoration-umber-300 underline-offset-2 hover:text-umber-900"
      >
        {t("media.film_full_guest_list_link")}
      </Link>
      {expanded && (
        <ul className="mt-1 space-y-1">
          {devices.length > 0 ? (
            devices.map((d) => (
              <li
                key={d.deviceId}
                className="group flex items-center justify-between gap-2 text-xs text-umber-500"
              >
                <span className="min-w-0 truncate">
                  {d.guestName ?? t("media.film_anonymous")}
                  {d.email && (
                    <span className="ml-1.5 text-umber-400" title={d.email}>
                      · {d.email}
                    </span>
                  )}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-umber-500">
                  {t("media.film_shots_short").replace("{{n}}", String(d.shotCount))}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(d)}
                  disabled={removingId !== null}
                  aria-label={`${t("media.participant_remove_title")}: ${d.guestName ?? t("media.film_anonymous")}`}
                  title={`${t("media.participant_remove_title")}: ${d.guestName ?? t("media.film_anonymous")}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-umber-500 transition-colors hover:bg-paper-100 hover:text-umber-900 disabled:opacity-50"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))
          ) : (
            <li className="text-xs text-umber-500">{t("media.film_no_participants")}</li>
          )}
        </ul>
      )}
    </div>
  );
}

// --- the couple's own gallery -----------------------------------------------
//
// The whole point of the film is seeing what came out of it, and until now the
// couple had no way to. The host endpoint bypasses the reveal lock on purpose:
// the time capsule is sealed for guests, never for the two people it is about.

const GALLERY_PREVIEW = 12;

function shotFilter(upload: FilmUpload, fallback: FilmAesthetic): string {
  const applied = upload.filterApplied as FilmAesthetic | null;
  return FILM_FILTERS[applied ?? fallback] ?? "none";
}

function galleryDate(uploadedAt: number, locale: Locale): string {
  return new Date(uploadedAt).toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Lightbox({
  uploads,
  index,
  aesthetic,
  deleting,
  onClose,
  onMove,
  onDelete,
}: {
  uploads: FilmUpload[];
  index: number;
  aesthetic: FilmAesthetic;
  deleting: boolean;
  onClose: () => void;
  onMove: (next: number) => void;
  onDelete: (upload: FilmUpload) => void;
}) {
  const { locale, t } = useT();
  const current = uploads[index];
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalShell(current !== undefined, onClose, dialogRef);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onMove((index + 1) % uploads.length);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onMove((index - 1 + uploads.length) % uploads.length);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, uploads.length, onMove]);

  if (!current) return null;

  const arrow =
    "flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20";
  const contributor =
    current.source === "couple"
      ? t("media.gallery_from_you")
      : (current.guestName ?? t("media.film_anonymous"));
  const photoLabel = t("media.gallery_photo_alt", {
    n: index + 1,
    name: contributor,
    date: galleryDate(current.uploadedAt, locale),
  });

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("media.gallery_dialog_label")}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <span className="flex-1 truncate font-grotesk text-[15px] font-bold text-white">
          {contributor}
        </span>
        <span className="shrink-0 font-grotesk text-[13px] font-medium tabular-nums text-white/45">
          {index + 1}/{uploads.length}
        </span>
        <a
          href={current.fileUrl}
          download
          aria-label={t("media.gallery_download")}
          title={t("media.gallery_download")}
          className={arrow}
        >
          <Download size={18} aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={() => onDelete(current)}
          disabled={deleting}
          aria-label={t("media.photo_delete")}
          title={t("media.photo_delete")}
          className={`${arrow} disabled:opacity-50`}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("a11y.close")}
          title={t("a11y.close")}
          className={arrow}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <img
          src={current.fileUrl}
          alt={photoLabel}
          className="max-h-full max-w-full rounded-2xl object-contain"
          style={{ filter: shotFilter(current, aesthetic) }}
        />
        {uploads.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => onMove((index - 1 + uploads.length) % uploads.length)}
              aria-label={t("media.gallery_prev")}
              className={`${arrow} absolute left-3 top-1/2 -translate-y-1/2`}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onMove((index + 1) % uploads.length)}
              aria-label={t("media.gallery_next")}
              className={`${arrow} absolute right-3 top-1/2 -translate-y-1/2`}
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function FilmGallery({
  uploads,
  aesthetic,
  loading,
  onDeletePhoto,
}: {
  uploads: FilmUpload[];
  aesthetic: FilmAesthetic;
  loading: boolean;
  onDeletePhoto: (photoId: number) => Promise<void>;
}) {
  const { locale, t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [showAll, setShowAll] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const galleryId = useId();

  const visible = showAll ? uploads : uploads.slice(0, GALLERY_PREVIEW);

  async function handleDeletePhoto(upload: FilmUpload) {
    if (deletingId !== null) return;
    const ok = await confirm({
      title: t("media.photo_delete_title"),
      body: t("media.photo_delete_body"),
      confirmLabel: t("media.photo_delete_confirm"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setDeletingId(upload.id);
    try {
      await onDeletePhoto(upload.id);
      toast.success(t("media.photo_deleted"));
      // `uploads` here is still the pre-deletion array (this closure predates
      // the parent's re-render), so its length minus one is the count after —
      // used to keep the lightbox index in bounds instead of pointing past
      // the end of the array the next render hands back.
      setOpenIndex((current) => {
        if (current === null) return current;
        const remaining = uploads.length - 1;
        if (remaining <= 0) return null;
        return current >= remaining ? remaining - 1 : current;
      });
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="border-t border-paper-200 px-4 pb-4 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-600">
          {t("media.gallery_title")}
        </h3>
        {uploads.length > 0 && (
          <span className="font-grotesk text-[13px] font-bold tabular-nums text-umber-900">
            {uploads.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-paper-100" />
          ))}
        </div>
      ) : uploads.length === 0 ? (
        <p className="px-1 py-3 text-[15px] font-medium text-umber-600">
          {t("media.gallery_empty")}
        </p>
      ) : (
        <>
          <ul id={galleryId} className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {visible.map((u, i) => {
              const contributor =
                u.source === "couple"
                  ? t("media.gallery_from_you")
                  : (u.guestName ?? t("media.film_anonymous"));
              const uploaded = galleryDate(u.uploadedAt, locale);
              const photoLabel = t("media.gallery_photo_alt", {
                n: i + 1,
                name: contributor,
                date: uploaded,
              });
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(i)}
                    aria-label={photoLabel}
                    className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-umber-700 focus-visible:ring-offset-2"
                  >
                    <img
                      src={u.fileUrl}
                      alt={photoLabel}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 group-focus-visible:scale-105"
                      style={{ filter: shotFilter(u, aesthetic) }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-2 pb-2 pt-7 text-left opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
                    >
                      <span className="block truncate font-grotesk text-[11px] font-semibold text-white">
                        {contributor}
                      </span>
                      <span className="block truncate font-grotesk text-[10px] text-white/80">
                        {uploaded}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {uploads.length > GALLERY_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll((currentValue) => !currentValue)}
              aria-expanded={showAll}
              aria-controls={galleryId}
              className="mt-2 w-full rounded-2xl border border-paper-300 py-3 font-grotesk text-[14px] font-semibold text-umber-700 transition-colors hover:bg-paper-50"
            >
              {showAll
                ? t("media.gallery_show_less")
                : t("media.gallery_show_all").replace("{{n}}", String(uploads.length))}
            </button>
          )}
        </>
      )}

      {/* The full film, not the preview slice — `visible` is a prefix of
          `uploads`, so the tapped index carries over and the arrows can walk
          past the twelfth thumbnail instead of dead-ending there. */}
      {openIndex !== null && (
        <Lightbox
          uploads={uploads}
          index={openIndex}
          aesthetic={aesthetic}
          deleting={deletingId !== null}
          onClose={() => setOpenIndex(null)}
          onMove={setOpenIndex}
          onDelete={handleDeletePhoto}
        />
      )}
    </div>
  );
}

// --- film modal (create / edit) ---------------------------------------------

function FilmModal({
  open,
  album,
  couple,
  onClose,
  onSaved,
}: {
  open: boolean;
  album: PhotoAlbum | null;
  couple: Couple | null;
  onClose: () => void;
  onSaved: (album: PhotoAlbum) => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [access, setAccess] = useState<FilmAccessCheck | null>(null);

  const isEdit = album !== null;

  const [title, setTitle] = useState(album?.title ?? "");
  const [aesthetic, setAesthetic] = useState<FilmAesthetic>(album?.filmAesthetic ?? "natural");
  const [shots, setShots] = useState<string>(
    album?.shotsPerGuest != null ? String(album.shotsPerGuest) : "24",
  );
  const [eventEndsAt, setEventEndsAt] = useState<string>(
    album?.eventEndsAt ? toDatetimeLocal(album.eventEndsAt) : "",
  );
  const [revealAt, setRevealAt] = useState<string>(
    album?.revealAt ? toDatetimeLocal(album.revealAt) : "",
  );

  useEffect(() => {
    if (!open) return;
    setTitle(album?.title ?? "");
    setAesthetic(album?.filmAesthetic ?? "natural");
    setShots(album?.shotsPerGuest != null ? String(album.shotsPerGuest) : "24");
    setRevealAt(album?.revealAt ? toDatetimeLocal(album.revealAt) : "");
    if (!isEdit) {
      const b = couple?.bride_name?.trim();
      const g = couple?.groom_name?.trim();
      if (b || g) setTitle(`${b ?? ""} & ${g ?? ""} Wedding`.trim());
      const wd = couple?.wedding_date ? new Date(couple.wedding_date).getTime() : null;
      // wedding_date midnight + 1 day - 3 h = 21:00 on the day after the wedding
      setEventEndsAt(wd ? toDatetimeLocal(wd + 45 * 60 * 60 * 1000) : "");
    } else {
      setEventEndsAt(album?.eventEndsAt ? toDatetimeLocal(album.eventEndsAt) : "");
    }
    if (!isEdit) {
      photoAlbumApi
        .filmAccess()
        .then((r) => setAccess(r.access))
        .catch(() => setAccess({ free: false, reason: null, priceEurCents: 790 }));
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const shotsNum = parseInt(shots, 10);
      const spg = Number.isFinite(shotsNum) && shotsNum > 0 ? shotsNum : null;
      const endsMs = eventEndsAt ? new Date(eventEndsAt).getTime() : null;
      const revealMs = revealAt ? new Date(revealAt).getTime() : null;

      if (isEdit) {
        const { album: updated } = await photoAlbumApi.update({
          title: title.trim() || null,
          filmAesthetic: aesthetic,
          shotsPerGuest: spg,
          ...(endsMs !== null ? { eventEndsAt: endsMs } : {}),
          ...(revealMs !== null ? { revealAt: revealMs } : {}),
        });
        await onSaved(updated);
      } else {
        const { album: created } = await photoAlbumApi.create({
          title: title.trim() || undefined,
          filmAesthetic: aesthetic,
          shotsPerGuest: spg,
          ...(endsMs !== null ? { eventEndsAt: endsMs } : {}),
          ...(revealMs !== null ? { revealAt: revealMs } : {}),
        });
        await onSaved(created);
      }
      onClose();
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  const includedGuestCap = access?.free ? FILM_TIER_CAPS.paid : FILM_TIER_CAPS.free;
  const upgradePrice = `€${((access?.priceEurCents ?? 790) / 100).toFixed(2)}`;

  return (
    <Dialog
      open={open}
      title={isEdit ? t("media.film_settings_title") : t("media.create_modal_title")}
      role="dialog"
      closeOnBackdrop
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          {!isEdit && (
            <span className="flex items-center gap-1 font-grotesk text-[13px] font-semibold text-sage-700">
              <Check size={13} aria-hidden="true" />
              {includedGuestCap} {t("media.film_stat_people")} · {t("media.film_price_free")}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="film-modal-form"
              className="btn-primary btn-sm"
              disabled={saving}
            >
              {saving
                ? t("media.create_modal_creating")
                : isEdit
                  ? t("common.save")
                  : t("media.create_modal_submit")}
            </button>
          </div>
        </div>
      }
    >
      {/* Uber-shaped: the name field explains itself through its placeholder, the
          looks are their own preview, and every field label is one word. The one
          sentence that survived is the placeholder-title warning, because
          "guests see this" is genuinely surprising. */}
      <form id="film-modal-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder={t("media.film_settings_name_placeholder")}
            aria-label={t("media.film_settings_name")}
            className="input w-full rounded-2xl px-4 py-3.5 font-grotesk font-medium"
          />
          {isPlaceholderTitle(title) && (
            <div className="mt-2 flex items-start gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-2.5 dark:bg-amber-400/10">
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <p className="text-xs leading-snug text-amber-800 dark:text-amber-200">
                {t("media.placeholder_warn_body").replace("{{title}}", title.trim())}
              </p>
            </div>
          )}
        </div>

        {/* The visible names make each look recognisable without hover. */}
        <div className="flex flex-wrap gap-2">
          {FILM_AESTHETICS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAesthetic(a)}
              title={AESTHETIC_LABELS[a]}
              aria-label={AESTHETIC_LABELS[a]}
              aria-pressed={aesthetic === a}
              className={`flex min-w-14 flex-col items-center gap-1 overflow-hidden rounded-2xl p-1 transition-all ${
                aesthetic === a
                  ? "ring-2 ring-umber-900 ring-offset-2 dark:ring-paper-100 dark:ring-offset-umber-900"
                  : "opacity-70 hover:opacity-100"
              }`}
            >
              <img
                src={DEMO_STRIP[0]}
                alt=""
                aria-hidden="true"
                className="h-12 w-12 object-cover"
                style={{ filter: FILM_FILTERS[a] }}
              />
              <span className="max-w-16 truncate text-[10px] font-medium text-umber-700 dark:text-paper-200">
                {AESTHETIC_LABELS[a]}
              </span>
            </button>
          ))}
        </div>

        {/* One upload-rules group, same shape as the page behind it. `.input` carries
            the dark-theme colours AND `color-scheme: dark`, without which the
            native datetime picker glyph renders black on the dark sheet. */}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-umber-600 dark:text-paper-300">
            {t("media.film_settings_upload")}
          </legend>
          <div className="divide-y divide-paper-200 overflow-hidden rounded-2xl border border-paper-200 dark:divide-umber-700 dark:border-umber-700">
            <label className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-sm font-medium text-umber-900 dark:text-paper-100">
                {t("media.film_settings_shots")}
              </span>
              <input
                type="number"
                min={1}
                max={500}
                value={shots}
                onChange={(e) => setShots(e.target.value)}
                className="input w-20 rounded-xl px-3 text-right font-grotesk text-sm font-semibold tabular-nums"
              />
              <span className="text-xs text-umber-600 dark:text-paper-300">
                / {t("media.film_per_person")}
              </span>
            </label>
            <div className="flex items-start gap-3 px-4 py-3">
              <span className="flex-1 text-sm font-medium text-umber-900 dark:text-paper-100">
                {t("media.film_settings_cap")}
              </span>
              <span className="text-right">
                <span className="block font-grotesk text-sm font-semibold text-umber-700 dark:text-paper-200">
                  {album?.guestCap ?? includedGuestCap} {t("media.film_stat_people")}
                </span>
                {!isEdit && !access?.free && (
                  <span className="block text-[11px] text-umber-600 dark:text-paper-300">
                    {t("media.film_upgrade_cta")} · {upgradePrice}
                  </span>
                )}
              </span>
            </div>
            <label className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-sm font-medium text-umber-900 dark:text-paper-100">
                {t("media.film_settings_ends")}
              </span>
              <input
                type="datetime-local"
                value={eventEndsAt}
                onChange={(e) => setEventEndsAt(e.target.value)}
                className="input w-auto min-w-0 shrink rounded-xl px-3 text-right text-sm"
              />
            </label>
            <label className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-sm font-medium text-umber-900 dark:text-paper-100">
                {t("media.film_settings_reveal")}
              </span>
              <input
                type="datetime-local"
                value={revealAt}
                onChange={(e) => setRevealAt(e.target.value)}
                className="input w-auto min-w-0 shrink rounded-xl px-3 text-right text-sm"
              />
            </label>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

// --- Weddly guest-camera hero -----------------------------------------------

function CameraPreview({
  src,
  filmName,
  shotsLabel,
  filter,
  className,
}: {
  src: string;
  filmName: string;
  shotsLabel: string;
  filter: string;
  className: string;
}) {
  return (
    <div
      className={`absolute rounded-[2rem] border border-paper-50/15 bg-umber-950 p-[5px] shadow-[0_28px_70px_rgba(0,0,0,0.55)] ${className}`}
    >
      <div className="relative aspect-[9/17] overflow-hidden rounded-[1.65rem] bg-umber-800">
        <img src={src} alt="" className="h-full w-full object-cover" style={{ filter }} />

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/25 to-transparent px-3 pb-10 pt-3 text-center">
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-black/70" />
          <p className="truncate text-[8px] font-semibold tracking-wide text-white/95 sm:text-[9px]">
            {filmName}
          </p>
        </div>

        <div className="absolute right-2 top-1/4 flex flex-col gap-1.5">
          {[Camera, Sparkles, GalleryHorizontalEnd].map((Icon, index) => (
            <span
              key={index}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/90 backdrop-blur-sm sm:h-6 sm:w-6"
            >
              <Icon size={9} strokeWidth={1.8} aria-hidden="true" />
            </span>
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-14">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <span className="pb-1 text-left font-grotesk text-[7px] font-semibold uppercase leading-tight tracking-[0.12em] text-white/80 sm:text-[8px]">
              {shotsLabel}
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white bg-white/20 shadow-lg sm:h-12 sm:w-12">
              <span className="h-7 w-7 rounded-full bg-white sm:h-9 sm:w-9" />
            </span>
            <span className="ml-auto h-7 w-7 overflow-hidden rounded-md border border-white/20 sm:h-8 sm:w-8">
              <img src={src} alt="" className="h-full w-full object-cover" style={{ filter }} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CameraHero({
  album,
  coupleName,
  coverPhoto,
  onCreate,
  onShare,
}: {
  album: PhotoAlbum | null;
  coupleName: string | null;
  coverPhoto: string;
  onCreate: () => void;
  onShare: () => void;
}) {
  const { t } = useT();
  const hasFilm = album !== null;
  const filmName = album?.title || coupleName || t("media.film_settings_unnamed");

  return (
    <section className="relative order-1 isolate overflow-hidden rounded-[2rem] bg-umber-950 text-paper-50 shadow-soft">
      <div
        aria-hidden="true"
        className="absolute -right-20 -top-32 h-80 w-80 rounded-full bg-blush-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-paper-300/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(to bottom, black, transparent 76%)",
        }}
      />

      <div className="relative grid items-center gap-5 px-6 pb-5 pt-9 sm:px-10 sm:pb-8 sm:pt-11 lg:px-12 xl:min-h-[38rem] xl:grid-cols-[minmax(0,0.95fr)_minmax(25rem,1.05fr)] xl:gap-6 xl:px-16 xl:py-12">
        <div className="relative z-10 max-w-2xl">
          <div className="mb-6 flex items-center gap-3 text-paper-200">
            <Wordmark size="sm" className="text-paper-50" />
            <span className="h-4 w-px bg-paper-50/20" aria-hidden="true" />
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em]">
              <Camera size={13} strokeWidth={1.7} aria-hidden="true" />
              {t("media.film_title")}
            </span>
          </div>

          {hasFilm ? (
            <>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sage-400/30 bg-sage-500/15 px-3 py-1.5 text-xs font-semibold text-sage-200">
                <span className="h-1.5 w-1.5 rounded-full bg-sage-300" aria-hidden="true" />
                {t("media.film_header_active").replace("{count}", String(album.photoCount))}
              </div>
              <h1 className="max-w-[13ch] font-serif text-5xl font-semibold leading-[0.94] tracking-[-0.035em] !text-paper-50 sm:text-6xl xl:text-7xl">
                {filmName}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-paper-200 sm:text-lg">
                {t("media.film_sub")}
              </p>
            </>
          ) : (
            <>
              <h1 className="max-w-[14ch] font-serif text-[3.15rem] font-semibold leading-[0.9] tracking-[-0.045em] !text-paper-50 sm:text-6xl lg:text-[4rem] xl:text-[4.4rem]">
                {t("media.hero_title")}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-paper-200 sm:text-lg">
                {t("media.hero_sub")}
              </p>
            </>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {hasFilm ? (
              <>
                <button
                  type="button"
                  onClick={onShare}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blush-500 px-6 py-3.5 font-grotesk text-sm font-semibold text-white transition hover:bg-blush-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-50 focus-visible:ring-offset-2 focus-visible:ring-offset-umber-950"
                >
                  <Share2 size={17} aria-hidden="true" />
                  {t("media.film_cta_share")}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onCreate}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blush-500 px-7 py-3.5 font-grotesk text-sm font-semibold text-white transition hover:bg-blush-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-50 focus-visible:ring-offset-2 focus-visible:ring-offset-umber-950"
              >
                {t("media.film_cta_create")}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="mt-7 flex flex-wrap gap-2 text-xs font-medium text-paper-200">
            <span className="flex items-center gap-1.5 rounded-full border border-paper-50/10 bg-paper-50/[0.06] px-3 py-1.5">
              <ScanLine size={14} aria-hidden="true" />
              {t("media.film_no_app_hint")}
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-paper-50/10 bg-paper-50/[0.06] px-3 py-1.5">
              <Lock size={13} aria-hidden="true" />
              {t("media.film_privacy_notice")}
            </span>
          </div>
        </div>

        <div
          className="relative mx-auto h-[22rem] w-full max-w-[35rem] sm:h-[30rem] lg:h-[32rem]"
          aria-hidden="true"
        >
          <div className="absolute left-[6%] top-[6%] h-[82%] w-[88%] rounded-[50%] bg-blush-500/15 blur-3xl" />

          <CameraPreview
            src={DEMO_STRIP[2]}
            filmName={filmName}
            shotsLabel={t("media.film_shots_short").replace("{{n}}", "12")}
            filter={FILM_FILTERS.warm}
            className="left-[2%] top-[15%] z-10 w-[39%] -rotate-[7deg] opacity-90"
          />
          <CameraPreview
            src={coverPhoto}
            filmName={filmName}
            shotsLabel={t("media.film_shots_short").replace(
              "{{n}}",
              String(album?.photoCount ?? 24),
            )}
            filter={FILM_FILTERS[album?.filmAesthetic ?? "vintage"]}
            className="left-1/2 top-[2%] z-20 w-[43%] -translate-x-1/2"
          />
          <CameraPreview
            src={DEMO_STRIP[1]}
            filmName={filmName}
            shotsLabel={t("media.film_shots_short").replace("{{n}}", "18")}
            filter={FILM_FILTERS.natural}
            className="right-[1%] top-[12%] z-10 w-[39%] rotate-[7deg] opacity-90"
          />

          <div className="absolute bottom-1 left-0 z-30 -rotate-6 rounded-2xl border border-paper-200 bg-paper-50 p-2.5 text-center text-umber-950 shadow-2xl sm:bottom-3 sm:left-[2%] sm:p-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-umber-950 sm:h-[4.5rem] sm:w-[4.5rem]">
              <QrCode className="h-11 w-11 sm:h-14 sm:w-14" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-grotesk text-[7px] font-bold uppercase tracking-[0.18em] sm:text-[8px]">
              {t("media.film_how_2_title")}
            </p>
          </div>
        </div>
      </div>

      {!hasFilm && (
        <div className="relative grid border-t border-paper-50/10 bg-paper-50/[0.03] sm:grid-cols-3 sm:divide-x sm:divide-paper-50/10">
          {[
            {
              n: "01",
              icon: QrCode,
              title: t("media.film_how_1_title"),
              body: t("media.film_how_1_body"),
            },
            {
              n: "02",
              icon: Camera,
              title: t("media.film_how_2_title"),
              body: t("media.film_how_2_body"),
            },
            {
              n: "03",
              icon: GalleryHorizontalEnd,
              title: t("media.film_how_3_title"),
              body: t("media.film_how_3_body"),
            },
          ].map((step) => (
            <div
              key={step.n}
              className="grid grid-cols-[2.75rem_1fr] gap-3 border-t border-paper-50/10 px-6 py-5 first:border-t-0 sm:block sm:border-t-0 sm:px-7 sm:py-6"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-paper-50/10 bg-paper-50/[0.07] text-blush-300">
                <step.icon size={17} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <div className="sm:mt-4">
                <span className="font-grotesk text-[9px] font-semibold tracking-[0.2em] text-blush-300">
                  {step.n}
                </span>
                <h2 className="font-grotesk text-sm font-semibold text-paper-50">{step.title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-paper-300">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --- page -------------------------------------------------------------------

export default function MediaPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const location = useLocation();

  const [couple, setCouple] = useState<Couple | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const photographerRowRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef("");
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const [album, setAlbum] = useState<PhotoAlbum | null>(null);
  const [filmAccess, setFilmAccess] = useState<FilmAccessCheck | null>(null);
  const [showFilmModal, setShowFilmModal] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState(false);
  const [rotatingGuestLink, setRotatingGuestLink] = useState(false);
  const [emailingGuests, setEmailingGuests] = useState(false);
  const [togglingUpload, setTogglingUpload] = useState(false);
  const [reopenRequested, setReopenRequested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [coupleUploading, setCoupleUploading] = useState(false);
  const [coupleUploadProgress, setCoupleUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const coupleUploadRef = useRef<HTMLInputElement | null>(null);
  // The couple's own view of the film. The host endpoint bypasses the reveal
  // lock deliberately — the time capsule is sealed for guests, not for them.
  const [uploads, setUploads] = useState<FilmUpload[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);

  const handleParticipantCountChange = useCallback((participantCount: number) => {
    setAlbum((current) =>
      current && current.participantCount !== participantCount
        ? { ...current, participantCount }
        : current,
    );
  }, []);

  // Cross-module links land on the participant panel after the album-backed
  // section has rendered (it is not present during the initial loading pass).
  useEffect(() => {
    if (location.hash !== "#film-participants" || !album) return;
    if (!showParticipants) {
      setShowParticipants(true);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById("film-participants");
      panel?.scrollIntoView({ block: "start" });
      panel?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash, album, showParticipants]);

  const refreshUploads = useCallback(() => {
    return photoAlbumApi
      .listPhotos()
      .then((r) => setUploads(r.uploads))
      .catch(() => {})
      .finally(() => setUploadsLoading(false));
  }, []);

  const handleDeletePhoto = useCallback(async (photoId: number) => {
    await photoAlbumApi.deletePhoto(photoId);
    setUploads((prev) => prev.filter((u) => u.id !== photoId));
    photoAlbumApi
      .current()
      .then((r) => setAlbum(r.album))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([coupleApi.current(), photoAlbumApi.current(), photoAlbumApi.filmAccess()])
      .then(([coupleRes, albumRes, accessRes]) => {
        if (cancelled) return;
        setCouple(coupleRes.couple);
        setAlbum(albumRes.album);
        setFilmAccess(accessRes.access);
        setLoading(false);
        if (albumRes.album) {
          setUploadsLoading(true);
          void refreshUploads();
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshUploads]);

  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    if (qs.get("film") !== "activated") return;
    toast.success(t("media.film_activated"));
    photoAlbumApi
      .current()
      .then((r) => setAlbum(r.album))
      .catch(() => {});
    window.history.replaceState(null, "", location.pathname);
  }, []);

  async function handleUpgradeFilm() {
    if (filmAccess?.checkoutEnabled === false) return;
    try {
      const { url } = await photoAlbumApi.filmCheckout();
      window.location.href = url;
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  async function handleCoupleUpload(files: FileList) {
    if (files.length === 0) return;
    const list = Array.from(files);
    setCoupleUploading(true);
    setCoupleUploadProgress({ done: 0, total: list.length });
    let done = 0;
    for (const file of list) {
      try {
        await photoAlbumApi.uploadAsCouple(file);
      } catch {
        // skip failed files, continue with the rest
      }
      done++;
      setCoupleUploadProgress({ done, total: list.length });
    }
    setCoupleUploading(false);
    setCoupleUploadProgress(null);
    photoAlbumApi
      .current()
      .then((r) => setAlbum(r.album))
      .catch(() => {});
    void refreshUploads();
  }

  const photographerUrls = couple?.media_links?.photographer ?? [];
  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;
  // #17: prefer the prettier custom slug for display + copy/share; QR stays on the token.
  const guestLinkUrl =
    album && album.slug ? `${window.location.origin}/photos/${album.slug}` : uploadUrl;

  function openSlugEditor() {
    setSlugDraft(album?.slug ?? "");
    setSlugError(null);
    setEditingSlug((v) => !v);
  }

  function closeSlugEditor() {
    setEditingSlug(false);
    setSlugError(null);
  }

  async function saveSlug() {
    const value = slugDraft.trim();
    setSavingSlug(true);
    setSlugError(null);
    try {
      const { album: updated } = await photoAlbumApi.update({ slug: value || null });
      setAlbum(updated);
      setEditingSlug(false);
      toast.success(value ? t("media.slug_saved") : t("media.slug_cleared"));
    } catch (err) {
      const code = errDetailCode(err);
      if (code === "slug_taken") setSlugError(t("media.slug_taken"));
      else if (code === "slug_invalid") setSlugError(t("media.slug_invalid"));
      else setSlugError(t("common.error_generic"));
    } finally {
      setSavingSlug(false);
    }
  }

  async function rotateGuestLink() {
    if (rotatingGuestLink) return;
    const ok = await confirm({
      title: t("media.film_rotate_link"),
      body: t("media.film_rotate_link_body"),
      confirmLabel: t("media.film_rotate_link_confirm"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setRotatingGuestLink(true);
    try {
      const { album: updated } = await photoAlbumApi.rotateGuestLink("ROTATE_GUEST_LINK");
      setAlbum(updated);
      closeSlugEditor();
      toast.success(t("media.film_rotate_link_done"));
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setRotatingGuestLink(false);
    }
  }

  async function emailGuestsPhotos() {
    if (emailingGuests) return;
    const ok = await confirm({
      title: t("media.film_email_guests"),
      body: t("media.film_email_guests_body"),
      confirmLabel: t("media.film_email_guests_confirm"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setEmailingGuests(true);
    try {
      const { sent } = await photoAlbumApi.emailGuestsPhotos();
      toast.success(
        sent > 0
          ? t("media.film_email_guests_done").replace("{{n}}", String(sent))
          : t("media.film_email_guests_none"),
      );
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setEmailingGuests(false);
    }
  }
  const totalCapacity =
    album !== null && album.shotsPerGuest != null ? album.shotsPerGuest * album.guestCap : null;
  const nearGuestLimit = album !== null && album.participantCount >= album.guestCap - 2;
  const nearPhotoLimit =
    totalCapacity !== null && album !== null && album.photoCount >= Math.floor(totalCapacity * 0.8);
  const needsUpgrade =
    album !== null &&
    album.paidAt === null &&
    filmAccess !== null &&
    !filmAccess.free &&
    (nearGuestLimit || nearPhotoLimit);
  const filmUpgradePrice = `€${((filmAccess?.priceEurCents ?? 790) / 100).toFixed(2)}`;

  // Open the "add a link" input (blank draft — each save appends a new gallery
  // link up to MAX_PHOTOGRAPHER_LINKS).
  function startEdit() {
    setEditing(true);
    setDraft("");
    setLinkError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setLinkError(null);
  }

  /** Persist the given photographer-link array and reflect the canonical
   *  (server-normalised) result back into state. */
  async function savePhotographer(next: string[], successKey: string) {
    setSaving(true);
    setLinkError(null);
    try {
      const res = await coupleApi.update({ media_links: { photographer: next } });
      setCouple(res.couple);
      setEditing(false);
      toast.success(t(successKey));
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  // Append a pasted link to the gallery. Empty just closes the input; a
  // non-http value shows the inline error; at the cap the input is hidden so
  // this can't overflow.
  async function addPhotographerLink(rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setEditing(false);
      setLinkError(null);
      return;
    }
    if (!isHttpUrl(trimmed)) {
      setLinkError(t("media.collect_invalid"));
      return;
    }
    if (photographerUrls.length >= MAX_PHOTOGRAPHER_LINKS) {
      setEditing(false);
      return;
    }
    await savePhotographer([...photographerUrls, trimmed], "media.collect_saved");
  }

  async function removePhotographerLink(url: string) {
    await savePhotographer(
      photographerUrls.filter((u) => u !== url),
      "media.collect_removed",
    );
  }

  useEffect(() => {
    if (!editing) return;
    function onPointerDown(e: MouseEvent) {
      const row = photographerRowRef.current;
      if (row && !row.contains(e.target as Node)) {
        addPhotographerLink(draftRef.current);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [editing]);

  async function handleToggleUpload(next: boolean) {
    if (!next) {
      const ok = await confirm({
        title: t("media.early_close"),
        body: t("media.early_close_hint"),
        confirmLabel: t("media.early_close"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!ok) return;
    }
    setTogglingUpload(true);
    try {
      const { album: updated } = await photoAlbumApi.update({ isUploadEnabled: next });
      setAlbum(updated);
      toast.success(next ? t("media.early_close_reopen") : t("media.early_close"));
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setTogglingUpload(false);
    }
  }

  async function handleFilmSaved(updated: PhotoAlbum) {
    setAlbum(updated);
    if (!reopenRequested) return;

    // An expired film needs both a future deadline and the upload switch. Do
    // these as one user action so "Újranyitás" cannot leave a still-closed
    // film after the settings modal was saved.
    if (updated.eventEndsAt === null || updated.eventEndsAt <= Date.now()) {
      throw new Error("A future upload deadline is required to reopen the film");
    }
    if (!updated.isUploadEnabled) {
      const { album: reopened } = await photoAlbumApi.update({ isUploadEnabled: true });
      setAlbum(reopened);
    }
    setReopenRequested(false);
    toast.success(t("media.early_close_reopen"));
  }

  if (loading) return null;

  // Hero art is decorative (aria-hidden), so it always uses a preset template
  // frame, never the couple's own shots, which can be dim or unflattering.
  const coverPhoto = DEMO_STRIP[0];
  const filmExpired = album?.eventEndsAt != null && Date.now() >= album.eventEndsAt;
  const uploadsOpen = album?.isUploadEnabled === true && !filmExpired;

  // iOS-style settings rows
  type SettingsRow = {
    icon: React.ReactNode;
    label: string;
    value: string;
    editable?: boolean;
    dividerAfter?: boolean;
  };
  const settingsRows: SettingsRow[] = album
    ? [
        {
          icon: <CalendarDays size={15} aria-hidden="true" />,
          label: t("media.film_settings_ends"),
          value: album.eventEndsAt
            ? formatRevealDate(album.eventEndsAt, locale)
            : t("media.film_not_set"),
        },
        {
          icon: <Clock3 size={15} aria-hidden="true" />,
          label: t("media.film_settings_reveal"),
          value: album.revealAt
            ? formatRevealDate(album.revealAt, locale)
            : t("media.film_settings_reveal_default"),
          dividerAfter: true,
        },
        {
          icon: <Users size={15} aria-hidden="true" />,
          label: t("media.film_settings_cap"),
          value: `${album.guestCap} ${t("media.film_per_person")}`,
          editable: false,
        },
        {
          icon: <GalleryHorizontalEnd size={15} aria-hidden="true" />,
          label: t("media.film_settings_shots"),
          value:
            album.shotsPerGuest != null
              ? `${album.shotsPerGuest} / ${t("media.film_per_person")}`
              : t("media.film_unlimited"),
        },
        {
          icon: <Film size={15} aria-hidden="true" />,
          label: t("media.film_settings_aesthetic"),
          value: AESTHETIC_LABELS[album.filmAesthetic] ?? album.filmAesthetic,
        },
      ]
    : [];

  const countdownStr = album?.eventEndsAt
    ? formatPreciseCountdown(Math.max(0, album.eventEndsAt - Date.now()))
    : null;

  return (
    <div className="flex flex-col">
      <FilmGrain />

      <CameraHero
        album={album}
        coupleName={couple?.display_name ?? null}
        coverPhoto={coverPhoto}
        onCreate={() => setShowFilmModal(true)}
        onShare={() => setShowShare(true)}
      />

      {/* ── Photographer gallery card (top) ───────────────────────── */}
      <div className="order-3 mt-4 overflow-hidden rounded-3xl border border-paper-200 bg-white shadow-soft">
        {/* ── Photographer row ──────────────────────────────────────── */}
        <div ref={photographerRowRef}>
          <h2 className="px-5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-600">
            {t("media.photographer_title")}
          </h2>

          {/* Saved gallery links (up to MAX_PHOTOGRAPHER_LINKS). Each is a
              settings-style row: hostname as the confident title, the full URL
              muted beneath, open + remove as quiet round icon buttons. */}
          {photographerUrls.length > 0 && (
            <ul>
              {photographerUrls.map((url) => (
                <li key={url} className="flex items-center gap-4 px-5 py-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-umber-900 text-umber-900">
                    <Camera size={18} aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium text-umber-900">
                      {url.replace(/^https?:\/\//, "").split("/")[0]}
                    </span>
                    <span className="flex items-center gap-1 text-[12px] text-umber-600">
                      <Link2 size={11} aria-hidden="true" className="shrink-0" />
                      <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
                    </span>
                  </span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("media.photographer_open")}
                    title={t("media.photographer_open")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-umber-500 transition-colors hover:bg-paper-100 hover:text-umber-900"
                  >
                    <ExternalLink size={15} aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    onClick={() => removePhotographerLink(url)}
                    disabled={saving}
                    aria-label={t("media.collect_delete")}
                    title={t("media.collect_delete")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-umber-400 transition-colors hover:bg-paper-100 hover:text-red-500 disabled:opacity-50"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add-a-link input — solid dark Save for a confident primary. */}
          {editing && (
            <form
              className="px-5 pb-4 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                addPhotographerLink(draft);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              noValidate
            >
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  className="flex-1 rounded-2xl border border-paper-300 bg-white px-4 py-3 text-sm text-umber-900 placeholder-umber-400 outline-none transition-colors focus:border-umber-900"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    const value = draft.trim();
                    if (value && !isHttpUrl(value)) setLinkError(t("media.collect_invalid"));
                  }}
                  placeholder={t("media.collect_placeholder")}
                  aria-label={t("media.photographer_title")}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="shrink-0 rounded-2xl bg-umber-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-umber-800 disabled:opacity-50"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="shrink-0 px-2 text-sm text-umber-600 hover:text-umber-900"
                >
                  {t("common.cancel")}
                </button>
              </div>
              {linkError && (
                <p className="mt-1.5 text-xs text-red-400" role="alert">
                  {linkError}
                </p>
              )}
              <p className="mt-1.5 text-xs leading-snug text-umber-600">
                {t("media.gallery_link_note")}
              </p>
            </form>
          )}

          {/* One confident, full-width tap target. Empty state carries a solid
              icon chip + service examples as the subtitle; once a link exists it
              becomes a quiet dashed "add another" row. Hidden at the cap and
              while the input is open. */}
          {!editing && photographerUrls.length < MAX_PHOTOGRAPHER_LINKS && (
            <button
              type="button"
              onClick={startEdit}
              className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-paper-50"
            >
              {photographerUrls.length === 0 ? (
                <>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-umber-900 text-white transition-transform group-hover:scale-105">
                    <Camera size={18} aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-semibold text-umber-900">
                      {t("media.photographer_cta")}
                    </span>
                    <span className="truncate text-[13px] text-umber-600">
                      {t("media.photographer_services")}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-dashed border-umber-300 text-umber-500 transition-colors group-hover:border-umber-900 group-hover:text-umber-900">
                    <Plus size={18} aria-hidden="true" />
                  </span>
                  <span className="flex-1 text-[15px] font-medium text-umber-700 transition-colors group-hover:text-umber-900">
                    {t("media.photographer_add_another")}
                  </span>
                </>
              )}
              <ChevronRight
                size={18}
                aria-hidden="true"
                className="shrink-0 text-umber-300 transition-all group-hover:translate-x-0.5 group-hover:text-umber-500"
              />
            </button>
          )}
        </div>
      </div>

      {/* ── Wedding film dashboard ────────────────────────────────── */}
      <div
        className={`order-2 mt-4 overflow-hidden rounded-3xl border border-paper-200 bg-white shadow-soft ${album ? "" : "hidden"}`}
      >
        {album ? (
          <>
            <>
              {/* ── Stats row ─────────────────────────────────────────── */}
              <div className="grid grid-cols-3 border-b border-paper-200">
                <div className="flex flex-col items-center gap-1 py-5 text-center">
                  <span className="font-grotesk text-[28px] font-bold leading-none tabular-nums text-umber-900">
                    {album.photoCount.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-umber-600">
                    {t("media.film_stat_moments")}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1 border-x border-paper-200 py-5 text-center">
                  <span
                    className="flex min-h-7 items-center font-grotesk text-[28px] font-bold leading-none tabular-nums text-umber-900"
                    aria-label={filmExpired ? t("media.film_stat_closed") : undefined}
                  >
                    {filmExpired ? <Lock size={24} aria-hidden="true" /> : (countdownStr ?? "--")}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-umber-600">
                    {filmExpired ? t("media.film_stat_closed") : t("media.film_stat_left")}
                  </span>
                  {album.eventEndsAt && (
                    // Show the close date even once the window has closed, so
                    // the "Closed" stat's bare "-" has context (closed as of
                    // this date) instead of reading as a stat yet to populate.
                    <span className="mt-0.5 text-[11px] font-medium leading-tight text-umber-600">
                      {formatRevealDate(album.eventEndsAt, locale)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowParticipants((v) => !v)}
                  aria-expanded={showParticipants}
                  aria-controls="film-participants"
                  className="flex flex-col items-center gap-1 py-5 text-center transition-colors hover:bg-paper-50"
                >
                  <span className="font-grotesk text-[28px] font-bold leading-none tabular-nums text-umber-900">
                    {album.participantCount}
                  </span>
                  <span className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-umber-600">
                    {t("media.film_stat_people")}
                    <ChevronRight
                      size={11}
                      aria-hidden="true"
                      className={`transition-transform ${showParticipants ? "rotate-90" : ""}`}
                    />
                  </span>
                </button>
              </div>
              {/* Inline participants list — expands when People is tapped */}
              {showParticipants && album && (
                <div
                  id="film-participants"
                  tabIndex={-1}
                  className="scroll-mt-24 border-b border-paper-200 px-4 py-3"
                >
                  <ParticipantDashboard
                    albumToken={album.uploadToken}
                    fallbackCount={album.participantCount}
                    onCountChange={handleParticipantCountChange}
                  />
                </div>
              )}

              {/* ── The film itself — sits right under the count it explains ── */}
              <FilmGallery
                uploads={uploads}
                aesthetic={album.filmAesthetic}
                loading={uploadsLoading}
                onDeletePhoto={handleDeletePhoto}
              />

              {/* ── Action toolbar ────────────────────────────────────── */}
              {uploadUrl && (
                <>
                  <div className="flex items-start justify-around gap-2 border-b border-paper-200 px-4 py-5">
                    <a
                      href={photoAlbumApi.qrUrl(album.uploadToken)}
                      download="guest-qr.png"
                      className="group flex flex-1 flex-col items-center gap-2"
                    >
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper-100 text-umber-900 transition-colors group-hover:bg-paper-200">
                        <QrCode size={22} aria-hidden="true" />
                      </span>
                      <span className="text-xs font-medium text-umber-700">
                        {t("media.film_save_qr")}
                      </span>
                    </a>
                    <button
                      type="button"
                      onClick={() => setShowShare(true)}
                      className="group flex flex-1 flex-col items-center gap-2"
                    >
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper-100 text-umber-900 transition-colors group-hover:bg-paper-200">
                        <Share2 size={22} aria-hidden="true" />
                      </span>
                      <span className="text-xs font-medium text-umber-700">
                        {t("media.film_share_btn")}
                      </span>
                    </button>
                    {/* Only once revealed — a link to a locked gallery would
                        greet the guest with "come back later" instead of
                        their own photos. */}
                    {(album.revealAt === null || Date.now() >= album.revealAt) &&
                      uploads.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void emailGuestsPhotos()}
                          disabled={emailingGuests}
                          className="group flex flex-1 flex-col items-center gap-2 disabled:opacity-50"
                        >
                          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper-100 text-umber-900 transition-colors group-hover:bg-paper-200">
                            <Mail size={22} aria-hidden="true" />
                          </span>
                          <span className="text-xs font-medium text-umber-700">
                            {t("media.film_email_guests")}
                          </span>
                        </button>
                      )}
                  </div>
                  {/* Reveal explainer — the one paragraph worth keeping, since
                        "guests can't see any of this yet" is genuinely
                        surprising. Retires once the reveal has passed. */}
                  {(album.revealAt === null || Date.now() < album.revealAt) && (
                    <div className="mx-4 mb-2 mt-3 flex items-start gap-3 rounded-2xl border border-paper-200 bg-paper-50 px-4 py-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-100 text-umber-900">
                        <Lock size={14} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-umber-900">
                          {t("media.reveal_explainer_title")}
                        </h3>
                        <p className="mt-0.5 text-xs leading-relaxed text-umber-500">
                          {album.revealAt
                            ? t("media.reveal_explainer_body").replace(
                                "{{date}}",
                                formatRevealDate(album.revealAt, locale),
                              )
                            : t("media.reveal_explainer_unset")}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Expired alert ─────────────────────────────────────── */}
              {filmExpired && (
                <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                      <Lock size={13} className="text-amber-600" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-amber-800">
                        {t("media.film_expired_alert")}
                      </p>
                      <p className="mt-0.5 text-xs text-amber-700">
                        {t("media.film_expired_body")}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setShowFilmModal(true)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                        >
                          <CalendarDays size={11} aria-hidden="true" />
                          {t("media.film_expired_action")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Couple upload ─────────────────────────────────────── */}
              {uploadUrl && (
                <div className="px-4 pb-4">
                  <button
                    type="button"
                    disabled={coupleUploading}
                    onClick={() => coupleUploadRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-umber-900 py-4 text-base font-semibold text-paper-50 transition-colors hover:bg-umber-800 disabled:opacity-60"
                  >
                    <Upload size={18} aria-hidden="true" />
                    {coupleUploadProgress
                      ? t("media.film_uploading")
                          .replace("{{done}}", String(coupleUploadProgress.done))
                          .replace("{{total}}", String(coupleUploadProgress.total))
                      : t("media.film_add_own_photos")}
                  </button>
                  <input
                    ref={coupleUploadRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void handleCoupleUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}

              {/* ── Upgrade notice ────────────────────────────────────── */}
              {needsUpgrade && (
                <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3">
                  <AlertTriangle size={16} className="shrink-0 text-amber-600" aria-hidden />
                  <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-amber-800">
                    {t("media.film_upgrade_body").replace("{{cap}}", String(album.guestCap))}
                  </p>
                  <button
                    type="button"
                    onClick={handleUpgradeFilm}
                    disabled={filmAccess?.checkoutEnabled === false}
                    className="shrink-0 rounded-xl bg-amber-800 px-3.5 py-2 font-grotesk text-[13px] font-semibold text-white transition-colors hover:bg-amber-900"
                  >
                    {filmAccess?.checkoutEnabled === false
                      ? t("media.film_upgrade_unavailable")
                      : `${t("media.film_upgrade_cta")} · ${filmUpgradePrice}`}
                  </button>
                </div>
              )}

              {/* ── Settings list (Uber-style rows) ───────────────────── */}
              <div className="border-t border-paper-200">
                <div className="flex items-center justify-between px-5 pb-1 pt-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-600">
                    {t("media.film_settings_title")}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowFilmModal(true)}
                    aria-label={t("media.film_settings_title")}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-umber-600 transition-colors hover:bg-paper-100 hover:text-umber-900"
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                </div>
                <div className="divide-y divide-paper-200 border-t border-paper-200">
                  {settingsRows.map((row) => {
                    const editable = row.editable !== false;
                    const inner = (
                      <>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-umber-900 text-umber-900">
                          {row.icon}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-medium text-umber-900">
                          {row.label}
                        </span>
                        <span className="shrink truncate text-right text-sm text-umber-500">
                          {row.value}
                        </span>
                      </>
                    );
                    return editable ? (
                      <button
                        key={row.label}
                        type="button"
                        onClick={() => setShowFilmModal(true)}
                        className="group flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-paper-50"
                      >
                        {inner}
                      </button>
                    ) : (
                      <div
                        key={row.label}
                        className="flex cursor-default items-center gap-3 px-5 py-3.5"
                      >
                        {inner}
                      </div>
                    );
                  })}
                </div>
                {/* Early-close upload toggle */}
                <div className="flex items-start justify-between gap-3 border-t border-paper-200 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-umber-900">
                      {uploadsOpen ? t("media.early_close") : t("media.early_close_reopen")}
                    </p>
                    {uploadsOpen && (
                      <p className="mt-0.5 text-xs leading-snug text-umber-500">
                        {t("media.early_close_hint")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={togglingUpload}
                    onClick={() => {
                      if (uploadsOpen) {
                        void handleToggleUpload(false);
                      } else if (filmExpired) {
                        setReopenRequested(true);
                        setShowFilmModal(true);
                      } else {
                        void handleToggleUpload(true);
                      }
                    }}
                    className={`shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                      uploadsOpen
                        ? "border border-paper-300 text-umber-700 hover:bg-paper-100"
                        : "bg-umber-900 text-paper-50 hover:bg-umber-800"
                    }`}
                  >
                    {uploadsOpen ? t("media.early_close") : t("media.early_close_reopen")}
                  </button>
                </div>
              </div>

              {/* ── Guest link ────────────────────────────────────────── */}
              {uploadUrl && guestLinkUrl && (
                <div className="border-t border-paper-200 px-5 py-4">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-600">
                      {t("media.film_guest_link")}
                    </h3>
                    <button
                      type="button"
                      onClick={openSlugEditor}
                      disabled={rotatingGuestLink}
                      className="flex items-center gap-1 text-[11px] font-medium text-umber-500 transition-colors hover:text-umber-900 disabled:opacity-50"
                    >
                      <Pencil size={11} aria-hidden="true" />
                      {t("media.slug_label")}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl bg-paper-100 py-1.5 pl-4 pr-1.5">
                    <span className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-umber-600 sm:truncate sm:text-sm">
                      {guestLinkUrl.replace(/^https?:\/\//, "")}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(guestLinkUrl);
                          setLinkCopied(true);
                          toast.success(t("media.from_guests_copied"));
                          setTimeout(() => setLinkCopied(false), 2000);
                        } catch {
                          toast.error(t("common.error_generic"));
                        }
                      }}
                      className="min-h-11 shrink-0 rounded-xl bg-umber-900 px-4 py-2 text-xs font-semibold text-paper-50 transition-colors hover:bg-umber-800"
                    >
                      {linkCopied ? t("media.from_guests_copied") : t("media.film_copy")}
                    </button>
                  </div>
                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void rotateGuestLink()}
                      disabled={rotatingGuestLink}
                      className="min-h-11 rounded-xl px-3 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                    >
                      {rotatingGuestLink ? t("common.saving") : t("media.film_rotate_link")}
                    </button>
                  </div>
                  {editingSlug && (
                    <form
                      className="mt-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveSlug();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          closeSlugEditor();
                        }
                      }}
                      noValidate
                    >
                      <div className="flex items-center gap-2 rounded-2xl border border-paper-300 bg-white py-1.5 pl-3 pr-1.5">
                        <span className="shrink-0 font-mono text-xs text-umber-600">…/photos/</span>
                        <input
                          type="text"
                          value={slugDraft}
                          onChange={(e) => setSlugDraft(e.target.value)}
                          placeholder={t("media.slug_placeholder")}
                          aria-label={t("media.slug_label")}
                          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-umber-900 placeholder-umber-400 outline-none"
                          autoFocus
                        />
                        <button
                          type="submit"
                          disabled={savingSlug}
                          className="shrink-0 rounded-xl bg-umber-900 px-3 py-1.5 text-xs font-semibold text-paper-50 transition-colors hover:bg-umber-800 disabled:opacity-50"
                        >
                          {savingSlug ? t("common.saving") : t("common.save")}
                        </button>
                        <button
                          type="button"
                          onClick={closeSlugEditor}
                          disabled={savingSlug}
                          className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-umber-700 transition-colors hover:bg-paper-100 disabled:opacity-50"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-umber-600">
                        {t("media.slug_hint")}
                      </p>
                      {slugError && (
                        <p className="mt-1 text-xs text-red-400" role="alert">
                          {slugError}
                        </p>
                      )}
                    </form>
                  )}
                </div>
              )}
            </>
          </>
        ) : (
          /* ── Empty state ────────────────────────────────────────── */
          <>
            <div className="relative h-52 overflow-hidden">
              <img
                src={DEMO_STRIP[0]}
                alt=""
                className="h-full w-full object-cover opacity-25"
                aria-hidden="true"
                style={{ filter: "blur(2px)" }}
              />
              <div className="absolute inset-0" style={{ background: "rgba(15,10,7,0.5)" }} />
              <span className="absolute right-3 top-3 z-10 rounded-full border border-paper-50/25 bg-ink-900/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-paper-200 backdrop-blur">
                {t("media.dev_badge")}
              </span>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-umber-700 bg-umber-900">
                  <Film size={22} className="text-umber-400" aria-hidden="true" />
                </div>
                <h2 className="font-grotesk text-2xl font-semibold text-paper-50 sm:text-3xl">
                  {t("media.film_empty_title")}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowFilmModal(true)}
                  className="rounded-xl bg-paper-50 px-6 py-3 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100"
                >
                  {t("media.film_cta_create")}
                </button>
              </div>
            </div>

            {/* How it works — 3 columns */}
            <div className="grid grid-cols-3 divide-x divide-paper-200 border-t border-paper-200">
              {[
                { n: "1", title: t("media.film_how_1_title"), body: t("media.film_how_1_body") },
                { n: "2", title: t("media.film_how_2_title"), body: t("media.film_how_2_body") },
                { n: "3", title: t("media.film_how_3_title"), body: t("media.film_how_3_body") },
              ].map((s) => (
                <div key={s.n} className="px-4 py-3">
                  <span className="font-grotesk text-xs font-bold text-umber-600">{s.n}</span>
                  <p className="mt-1.5 text-xs font-semibold text-umber-700">{s.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-umber-500">{s.body}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      <FilmModal
        open={showFilmModal}
        album={album}
        couple={couple}
        onClose={() => {
          setShowFilmModal(false);
          setReopenRequested(false);
        }}
        onSaved={handleFilmSaved}
      />
      {album && guestLinkUrl && (
        <ShareSheet
          open={showShare}
          names={couple?.display_name ?? ""}
          url={guestLinkUrl}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
