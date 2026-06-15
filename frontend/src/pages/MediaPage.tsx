// Weddly Photos — Wedding Film product hub.
//
// Three panels:
//   "From guests"    — QR/link-based guest uploads. Empty -> create modal -> active.
//   "To guests"      — shared reveal gallery. Coming soon.
//   "By photographer"— couple saves photographer gallery link. Live (existing backend).

import type { Couple, FilmAccessCheck, FilmAesthetic, FilmDevice, PhotoAlbum } from "@shared/types";
import { FILM_AESTHETICS } from "@shared/types";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  Film,
  GalleryHorizontalEnd,
  Link2,
  Pencil,
  QrCode,
  Share2,
  Users,
} from "lucide-react";
import React, { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
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

// --- film status ------------------------------------------------------------

type FilmStatus = "live" | "developing" | "revealed";

function getFilmStatus(album: PhotoAlbum): FilmStatus {
  const ts = Date.now();
  const eventEnded = album.eventEndsAt !== null && ts >= album.eventEndsAt;
  const uploading = album.isUploadEnabled && !eventEnded;
  if (uploading) return "live";
  if (album.revealAt !== null && ts < album.revealAt) return "developing";
  return "revealed";
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

function formatRevealDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
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

function daysUntil(ms: number): number {
  return Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
}

// Demo wedding photos served from /public/demo/ — shown as gallery strip placeholders.
const DEMO_STRIP = ["/demo/film-01.jpg", "/demo/film-02.jpg", "/demo/film-03.jpg"];

// --- QR placeholder (used before real SVG loads) ---------------------------

function QrPlaceholder({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className={className} fill="currentColor">
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

// Ambient film-grain overlay — fixed, scoped to this page via mount/unmount.
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

function ComingSoonBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
      {label}
    </span>
  );
}

function CardLabel({ text }: { text: string }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
      {text}
    </span>
  );
}

// Status chip in the dark banner. When not done and onClick is provided,
// renders as a button so users can jump directly to the relevant card.
function StatusChip({
  done,
  label,
  onClick,
}: {
  done: boolean;
  label: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      {done ? (
        <Check size={11} aria-hidden="true" />
      ) : (
        <AlertTriangle size={11} aria-hidden="true" />
      )}
      {label}
    </>
  );
  const base = `flex items-center gap-1.5 text-xs ${done ? "text-sage-400" : "text-paper-400"}`;
  if (onClick && !done) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} underline-offset-2 hover:underline`}
      >
        {inner}
      </button>
    );
  }
  return <span className={base}>{inner}</span>;
}

// Decorative film-strip column on the right side of FilmBanner.
// Countdown: live timer that ticks every second.
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
    <span className="text-xs tabular-nums text-ink-500 dark:text-umber-300">
      {label} {formatDuration(remaining)}
    </span>
  );
}

// QR code modal: shows the real QR image and a copy-link button.
function QrModal({
  open,
  uploadToken,
  uploadUrl,
  onClose,
}: {
  open: boolean;
  uploadToken: string;
  uploadUrl: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(uploadUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      title={t("media.film_qr_title")}
      role="dialog"
      closeOnBackdrop
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary btn-sm" onClick={handleCopy}>
            <Copy size={14} aria-hidden="true" />
            {copied ? t("media.from_guests_copied") : t("media.from_guests_copy")}
          </button>
          <a
            href={photoAlbumApi.qrUrl(uploadToken)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline btn-sm inline-flex items-center gap-1.5"
          >
            <QrCode size={14} aria-hidden="true" />
            Print QR
          </a>
          <button type="button" className="btn-ghost btn-sm ml-auto" onClick={onClose}>
            {t("a11y.close")}
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <img
          src={photoAlbumApi.qrUrl(uploadToken)}
          alt="Guest camera QR code"
          className="h-48 w-48 rounded-xl border border-paper-200 dark:border-umber-700"
        />
        <p className="w-full truncate rounded-lg border border-paper-200 bg-paper-50 px-3 py-2 text-center font-mono text-xs text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200">
          {uploadUrl.replace(/^https?:\/\//, "")}
        </p>
      </div>
    </Dialog>
  );
}

// Horizontal photo-strip gallery — shows demo photos with real "+N" overflow count.
function GalleryStrip({ album }: { album: PhotoAlbum }) {
  const extra = Math.max(0, album.photoCount - DEMO_STRIP.length);
  return (
    <div className="mb-3 overflow-hidden rounded-2xl bg-umber-950 px-4 pb-4 pt-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="font-grotesk text-sm font-semibold text-paper-200">
          {album.title || "Wedding Film"}
        </span>
        {album.eventEndsAt && (
          <span className="text-xs text-paper-500">
            {new Date(album.eventEndsAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {DEMO_STRIP.map((src, i) => {
          const isLast = i === DEMO_STRIP.length - 1 && extra > 0;
          return (
            <div
              key={src}
              className="relative h-28 w-[4.5rem] flex-shrink-0 overflow-hidden rounded-2xl"
            >
              <img src={src} alt="" className="h-full w-full object-cover" aria-hidden="true" />
              {isLast && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                  <span className="font-grotesk text-sm font-semibold text-white">+{extra}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Film banner — large heading, cover thumbnail, stats, action buttons.
function FilmBanner({
  album,
  onCreateClick,
  onEditClick,
}: {
  album: PhotoAlbum | null;
  onCreateClick: () => void;
  onEditClick: () => void;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;
  const cameraUrl = uploadUrl;

  const daysLeft = album?.eventEndsAt ? daysUntil(album.eventEndsAt) : null;

  function handleShare() {
    if (!uploadUrl) return;
    if (navigator.share) {
      navigator.share({ url: uploadUrl }).catch(() => {
        navigator.clipboard.writeText(uploadUrl).catch(() => {});
      });
    } else {
      navigator.clipboard.writeText(uploadUrl).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Cover thumbnail: album's own cover → fallback to demo photo
  const coverThumb = album?.coverImageUrl ?? DEMO_STRIP[0];

  return (
    <div className="mb-3 overflow-hidden rounded-2xl bg-umber-950 p-5">
      <div className="flex items-start gap-4">
        {/* Left: title + stats + buttons */}
        <div className="min-w-0 flex-1">
          <h2 className="font-grotesk text-2xl font-semibold leading-tight text-paper-50 sm:text-3xl">
            {album?.title || t("media.film_empty_title")}
          </h2>

          {album ? (
            <>
              {/* Stats — 3 lines with icons */}
              <div className="mt-3 flex flex-col gap-1.5">
                {daysLeft !== null && (
                  <span className="flex items-center gap-2 text-sm text-paper-300">
                    <Clock3 size={13} className="shrink-0" aria-hidden="true" />
                    {daysLeft === 0 ? t("media.film_status_live") : `${daysLeft} days left`}
                  </span>
                )}
                <span className="flex items-center gap-2 text-sm text-paper-300">
                  <Users size={13} className="shrink-0" aria-hidden="true" />
                  {album.participantCount} {t("media.film_stats_guests").toLowerCase()}
                </span>
                <span className="flex items-center gap-2 text-sm text-paper-300">
                  <GalleryHorizontalEnd size={13} className="shrink-0" aria-hidden="true" />
                  {album.photoCount} {t("media.film_stats_photos").toLowerCase()}
                </span>
              </div>

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex items-center gap-1.5 rounded-full border border-umber-700 bg-umber-800 px-4 py-2 text-sm font-medium text-paper-200 transition-colors hover:bg-umber-700"
                >
                  <QrCode size={13} aria-hidden="true" />
                  {copied ? t("media.from_guests_copied") : t("media.film_cta_share")}
                </button>
                {cameraUrl && (
                  <a
                    href={cameraUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-paper-50 px-5 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100"
                  >
                    <Camera size={13} aria-hidden="true" />
                    {t("media.film_stats_camera")}
                  </a>
                )}
              </div>
            </>
          ) : (
            /* No film yet */
            <div className="mt-4">
              <p className="mb-3 text-sm text-paper-400">{t("media.film_no_app_hint")}</p>
              <button
                type="button"
                onClick={onCreateClick}
                className="inline-flex items-center gap-2 rounded-full bg-paper-50 px-5 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100"
              >
                {t("media.film_cta_create")}
              </button>
            </div>
          )}
        </div>

        {/* Right: cover photo thumbnail */}
        <div className="relative shrink-0">
          <img
            src={coverThumb}
            alt=""
            className="h-20 w-20 rounded-2xl object-cover sm:h-24 sm:w-24"
            aria-hidden="true"
          />
          {album && (
            <button
              type="button"
              onClick={onEditClick}
              aria-label="Edit film settings"
              className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-umber-800 text-paper-300 ring-2 ring-umber-950 transition-colors hover:bg-umber-700"
            >
              <Pencil size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Single stat tile, optionally with a utilization progress bar.

// Live-polling participant list (collapsed by default).
function ParticipantDashboard({ albumToken }: { albumToken: string }) {
  const [devices, setDevices] = useState<FilmDevice[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    function poll() {
      photoAlbumApi
        .listDevices()
        .then((r) => {
          if (active) setDevices(r.devices);
        })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [albumToken]);

  if (devices.length === 0) return null;

  return (
    <div className="rounded-lg border border-paper-200 bg-paper-50 dark:border-umber-700 dark:bg-umber-800">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-600 dark:text-umber-200">
          <Users size={12} aria-hidden="true" />
          {devices.length} participant{devices.length !== 1 ? "s" : ""}
        </span>
        <span className="text-xs text-ink-400 dark:text-umber-400">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <ul className="border-t border-paper-200 dark:border-umber-700">
          {devices.map((d) => (
            <li
              key={d.deviceId}
              className="flex items-center justify-between px-3 py-1.5 text-xs text-ink-600 dark:text-umber-200 odd:bg-paper-50 dark:odd:bg-umber-800"
            >
              <span className="truncate">{d.guestName ?? "Anonymous"}</span>
              <span className="ml-2 shrink-0 tabular-nums text-ink-400">
                {d.shotCount} shot{d.shotCount !== 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// "From guests" panel — primary feature card.
function FromGuestsCard({
  album,
  access,
  onCreateClick,
  onUpgradeClick,
}: {
  album: PhotoAlbum | null;
  access: FilmAccessCheck | null;
  onCreateClick: () => void;
  onUpgradeClick: () => void;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;
  const needsUpgrade = album !== null && album.paidAt === null && access !== null && !access.free;

  function handleCopy() {
    if (!uploadUrl) return;
    navigator.clipboard.writeText(uploadUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card-hover flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-900 text-paper-50 dark:bg-ink-800 dark:text-paper-100">
          <Users size={20} aria-hidden="true" />
        </div>
        <CardLabel text="FROM GUESTS" />
      </div>

      <h3 className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
        {t("media.from_guests_title")}
      </h3>

      {album && uploadUrl ? (
        <div className="space-y-4">
          {/* Copy link + View QR buttons — replaces the inline QR block */}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={handleCopy}>
              <Copy size={14} aria-hidden="true" />
              {copied ? t("media.from_guests_copied") : t("media.from_guests_copy")}
            </button>
            <button
              type="button"
              className="btn-outline btn-sm inline-flex items-center gap-1.5"
              onClick={() => setQrOpen(true)}
            >
              <QrCode size={14} aria-hidden="true" />
              {t("media.film_qr_title")}
            </button>
          </div>

          {/* Upgrade notice with warning icon and improved contrast */}
          {needsUpgrade && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-700/40 dark:bg-amber-900/20">
              <p className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle
                  size={13}
                  className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span>
                  Trial limit: up to {album.guestCap} guests.{" "}
                  <button
                    type="button"
                    className="font-semibold text-amber-700 underline underline-offset-2 hover:no-underline dark:text-amber-300"
                    onClick={onUpgradeClick}
                  >
                    Unlock for €9.90
                  </button>{" "}
                  to allow up to 200 guests.
                </span>
              </p>
            </div>
          )}

          {/* Separator before participant list */}
          <hr className="border-paper-200 dark:border-umber-700" />

          {/* Live participant list */}
          <ParticipantDashboard albumToken={album.uploadToken} />

          {/* QR modal */}
          <QrModal
            open={qrOpen}
            uploadToken={album.uploadToken}
            uploadUrl={uploadUrl}
            onClose={() => setQrOpen(false)}
          />
        </div>
      ) : (
        <div className="mt-auto">
          <button type="button" className="btn-primary btn-sm" onClick={onCreateClick}>
            <Link2 size={14} aria-hidden="true" />
            {t("media.film_cta_create")}
          </button>
        </div>
      )}
    </div>
  );
}

// "To guests" — reveal/share. Coming soon. Shows a feature preview list to
// fill the card and communicate upcoming value.
function ToGuestsCard() {
  const { t } = useT();
  return (
    <div className="card-hover flex flex-col gap-3 border-2 border-dashed bg-paper-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-400 dark:bg-umber-700 dark:text-umber-400">
          <Share2 size={20} aria-hidden="true" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <CardLabel text="TO GUESTS" />
          <ComingSoonBadge label={t("media.coming_soon_title")} />
        </div>
      </div>

      <h3 className="font-grotesk text-base font-semibold text-ink-700 dark:text-paper-200">
        {t("media.to_guests_title")}
      </h3>

      <div className="mt-auto">
        <button type="button" className="btn-outline btn-sm" disabled>
          <Eye size={14} aria-hidden="true" />
          {t("media.to_guests_cta")}
        </button>
      </div>
    </div>
  );
}

// "By photographer" panel — link save/edit. Uses existing backend.
// cardRef is always attached so it serves both as a scroll target (when the
// photographer status chip is clicked) and a click-outside boundary.
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
      ref={cardRef}
      className="card-hover flex flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-600 dark:bg-umber-700 dark:text-umber-200">
          <Camera size={20} aria-hidden="true" />
        </div>
        <CardLabel text="PHOTOGRAPHER" />
      </div>

      <h3 className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
        {t("media.photographer_title")}
      </h3>

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

// Film settings read-only summary. Identity rows (name/look/shots) are
// separated from status rows (reveal/cap/upload) by a divider.
function FilmSettingsPanel({
  album,
  onEditClick,
}: {
  album: PhotoAlbum;
  onEditClick: () => void;
}) {
  const { t } = useT();

  const aestheticLabel: Record<string, string> = {
    natural: "Natural",
    vintage: "Vintage",
    bw: "B&W",
    cinematic: "Cinematic",
    warm: "Warm",
  };

  type SettingsRow = {
    icon: React.ReactNode;
    label: string;
    value: string;
    dividerAfter?: boolean;
  };

  const rows: SettingsRow[] = [
    {
      icon: <CalendarDays size={15} aria-hidden="true" />,
      label: t("media.film_settings_ends"),
      value: album.eventEndsAt ? formatRevealDate(album.eventEndsAt) : "Not set",
    },
    {
      icon: <Clock3 size={15} aria-hidden="true" />,
      label: t("media.film_settings_reveal"),
      value: album.revealAt ? formatRevealDate(album.revealAt) : t("media.film_settings_reveal_default"),
      dividerAfter: true,
    },
    {
      icon: <Users size={15} aria-hidden="true" />,
      label: t("media.film_settings_cap"),
      value: `${album.guestCap} people`,
    },
    {
      icon: <GalleryHorizontalEnd size={15} aria-hidden="true" />,
      label: t("media.film_settings_shots"),
      value: album.shotsPerGuest != null ? String(album.shotsPerGuest) : t("media.film_unlimited"),
    },
    {
      icon: <Film size={15} aria-hidden="true" />,
      label: t("media.film_settings_aesthetic"),
      value: aestheticLabel[album.filmAesthetic] ?? album.filmAesthetic,
    },
  ];

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-umber-900">
      {rows.map((row, i) => (
        <React.Fragment key={row.label}>
          <button
            type="button"
            onClick={onEditClick}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-umber-800"
          >
            <span className="shrink-0 text-umber-400">{row.icon}</span>
            <span className="flex-1 text-sm text-paper-200">{row.label}</span>
            <span className="mr-1 text-sm text-umber-400">{row.value}</span>
            <ChevronRight size={14} className="shrink-0 text-umber-600" aria-hidden="true" />
          </button>
          {row.dividerAfter && i < rows.length - 1 && (
            <div className="mx-4 border-t border-dashed border-umber-700" />
          )}
          {!row.dividerAfter && i < rows.length - 1 && (
            <div className="mx-4 border-t border-umber-800" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// "How it works" — shown only before a film is created.
function HowItWorksSection() {
  const { t } = useT();
  const steps = [
    { n: "1", title: t("media.film_how_1_title"), body: t("media.film_how_1_body") },
    { n: "2", title: t("media.film_how_2_title"), body: t("media.film_how_2_body") },
    { n: "3", title: t("media.film_how_3_title"), body: t("media.film_how_3_body") },
  ];
  return (
    <div className="card mb-2 mt-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
          {t("media.film_how_title")}
        </h3>
        <div className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-paper-50 dark:bg-paper-50 dark:text-ink-900">
              {s.n}
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-800 dark:text-paper-100">{s.title}</p>
              <p className="mt-0.5 text-sm text-ink-500 dark:text-umber-300">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// "What's next" checklist — replaces How It Works after a film is created.
function NextStepsSection({
  photographerSaved,
  onPhotographerClick,
}: {
  photographerSaved: boolean;
  onPhotographerClick: () => void;
}) {
  const { t } = useT();
  const steps = [
    {
      done: photographerSaved,
      label: t("media.photographer_cta"),
      action: photographerSaved ? null : onPhotographerClick,
    },
    { done: false, label: t("media.to_guests_cta"), action: null },
  ];
  return (
    <div className="card mb-2 mt-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
          {t("media.film_next_steps_title")}
        </h3>
        <div className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
      </div>
      <ul className="space-y-2.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                s.done
                  ? "border-sage-400 bg-sage-50 text-sage-600 dark:border-sage-600 dark:bg-sage-900/20 dark:text-sage-400"
                  : "border-paper-300 dark:border-umber-600"
              }`}
            >
              {s.done && <Check size={10} aria-hidden="true" />}
            </span>
            {s.action ? (
              <button
                type="button"
                onClick={s.action}
                className="text-sm text-ink-700 underline-offset-2 hover:underline dark:text-paper-200"
              >
                {s.label}
              </button>
            ) : (
              <span
                className={`text-sm ${
                  s.done
                    ? "text-ink-400 line-through dark:text-umber-500"
                    : "text-ink-500 dark:text-umber-400"
                }`}
              >
                {s.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Aesthetic filter labels shown in the picker.
const AESTHETIC_LABELS: Record<FilmAesthetic, string> = {
  natural: "Natural",
  vintage: "Vintage",
  bw: "B&W",
  cinematic: "Cinematic",
  warm: "Warm",
};

// Sample gradient to preview each aesthetic in the picker.
const AESTHETIC_PREVIEW: Record<FilmAesthetic, string> = {
  natural: "bg-gradient-to-br from-sky-100 to-blue-200",
  vintage: "bg-gradient-to-br from-amber-100 to-orange-200",
  bw: "bg-gradient-to-br from-gray-200 to-gray-400",
  cinematic: "bg-gradient-to-br from-slate-300 to-indigo-200",
  warm: "bg-gradient-to-br from-orange-100 to-yellow-200",
};

// Wedding Film creation / edit modal.
function FilmModal({
  open,
  album,
  onClose,
  onSaved,
}: {
  open: boolean;
  album: PhotoAlbum | null;
  onClose: () => void;
  onSaved: (album: PhotoAlbum) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [access, setAccess] = useState<FilmAccessCheck | null>(null);

  const isEdit = album !== null;

  const [title, setTitle] = useState(album?.title ?? "");
  const [aesthetic, setAesthetic] = useState<FilmAesthetic>(album?.filmAesthetic ?? "natural");
  const [shots, setShots] = useState<string>(
    album?.shotsPerGuest != null ? String(album.shotsPerGuest) : "16",
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
    setShots(album?.shotsPerGuest != null ? String(album.shotsPerGuest) : "16");
    setEventEndsAt(album?.eventEndsAt ? toDatetimeLocal(album.eventEndsAt) : "");
    setRevealAt(album?.revealAt ? toDatetimeLocal(album.revealAt) : "");
    if (!isEdit) {
      photoAlbumApi
        .filmAccess()
        .then((r) => setAccess(r.access))
        .catch(() => setAccess({ free: false, reason: null, priceEurCents: 990 }));
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
        onSaved(updated);
      } else {
        const { album: created } = await photoAlbumApi.create({
          title: title.trim() || undefined,
          filmAesthetic: aesthetic,
          shotsPerGuest: spg,
        });
        onSaved(created);
      }
      onClose();
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  const priceLabel =
    access === null
      ? "..."
      : access.free
        ? "Free"
        : `€${((access.priceEurCents ?? 990) / 100).toFixed(2)}`;

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
            <span className="text-xs text-ink-400">
              {access?.free ? (
                <span className="flex items-center gap-1 text-sage-700">
                  <Check size={12} />
                  Free · loyal couple
                </span>
              ) : (
                `Access: ${priceLabel}`
              )}
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
      <form id="film-modal-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-700 dark:text-paper-200">
            {t("media.film_settings_name")}{" "}
            <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Anna & Bence, Summer 2026"
            className="input w-full text-sm"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink-700 dark:text-paper-200">
            {t("media.film_settings_aesthetic")}
          </p>
          <div className="flex flex-wrap gap-2">
            {FILM_AESTHETICS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAesthetic(a)}
                className={`flex flex-col items-center gap-1 rounded-xl border-2 p-0.5 transition-colors ${
                  aesthetic === a
                    ? "border-ink-900 dark:border-paper-100"
                    : "border-transparent hover:border-paper-300"
                }`}
              >
                <div className={`h-12 w-12 rounded-lg ${AESTHETIC_PREVIEW[a]}`} />
                <span className="text-[10px] text-ink-600 dark:text-umber-300">
                  {AESTHETIC_LABELS[a]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink-700 dark:text-paper-200">
            {t("media.film_settings_shots")}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={500}
              value={shots}
              onChange={(e) => setShots(e.target.value)}
              className="input w-24 text-sm"
            />
            <span className="text-sm text-ink-500">photos per person</span>
          </div>
        </div>

        {isEdit && (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700 dark:text-paper-200">
                {t("media.film_settings_ends")}
                <span className="ml-1 font-normal text-ink-400">(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={eventEndsAt}
                onChange={(e) => setEventEndsAt(e.target.value)}
                className="input w-full text-sm"
              />
              <p className="mt-1 text-xs text-ink-400">{t("media.film_settings_ends_hint")}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700 dark:text-paper-200">
                {t("media.film_settings_reveal")}
                <span className="ml-1 font-normal text-ink-400">(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={revealAt}
                onChange={(e) => setRevealAt(e.target.value)}
                className="input w-full text-sm"
              />
              <p className="mt-1 text-xs text-ink-400">{t("media.film_settings_reveal_hint")}</p>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}

// --- page -------------------------------------------------------------------

export default function MediaPage() {
  const { t } = useT();
  const toast = useToast();
  const location = useLocation();

  // Photographer gallery link (live — existing backend).
  const [couple, setCouple] = useState<Couple | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const photographerCardRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef("");
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Film state.
  const [album, setAlbum] = useState<PhotoAlbum | null>(null);
  const [filmAccess, setFilmAccess] = useState<FilmAccessCheck | null>(null);
  const [showFilmModal, setShowFilmModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([coupleApi.current(), photoAlbumApi.current(), photoAlbumApi.filmAccess()])
      .then(([coupleRes, albumRes, accessRes]) => {
        if (!cancelled) {
          setCouple(coupleRes.couple);
          setAlbum(albumRes.album);
          setFilmAccess(accessRes.access);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // After Stripe redirects back with ?film=activated, show toast + refresh album.
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    if (qs.get("film") !== "activated") return;
    toast.success("Film activated! Guests can now join, up to 200 participants.");
    photoAlbumApi
      .current()
      .then((r) => setAlbum(r.album))
      .catch(() => {});
    window.history.replaceState(null, "", location.pathname);
  }, []);

  async function handleUpgradeFilm() {
    try {
      const { url } = await photoAlbumApi.filmCheckout();
      window.location.href = url;
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  const photographerUrl = couple?.media_links?.photographer ?? null;
  const albumStatus = album ? getFilmStatus(album) : null;

  function startEdit() {
    setEditing(true);
    setDraft(photographerUrl ?? "");
    setLinkError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setLinkError(null);
  }

  function scrollToAndEditPhotographer() {
    photographerCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    startEdit();
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

  // Click-outside auto-save for the photographer card.
  useEffect(() => {
    if (!editing) return;
    function onPointerDown(e: MouseEvent) {
      const card = photographerCardRef.current;
      if (card && !card.contains(e.target as Node)) {
        savePhotographerLink(draftRef.current);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [editing]);

  if (loading) return null;

  return (
    <div>
      <FilmGrain />
      {/* Page header: status pill when film is active, create button when not */}
      <header className="mb-4 flex items-start justify-between gap-4 border-b border-paper-200 pb-4 dark:border-umber-700">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-400 dark:text-umber-500">
            Wedding Film
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-grotesk">{t("media.title")}</h1>
            {album &&
              albumStatus &&
              (() => {
                const dotCls =
                  albumStatus === "live"
                    ? "bg-sage-500 animate-pulse"
                    : albumStatus === "developing"
                      ? "bg-amber-400"
                      : "bg-paper-400";
                const pillCls =
                  albumStatus === "live"
                    ? "bg-sage-50 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300"
                    : "bg-paper-100 text-ink-500 dark:bg-umber-800 dark:text-umber-300";
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${pillCls}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} aria-hidden="true" />
                    {t("media.film_title")}
                  </span>
                );
              })()}
          </div>
          <p className="mt-1.5 text-sm italic text-umber-500 dark:text-umber-300">
            {album ? t("media.film_header_active", { count: album.photoCount }) : t("media.sub")}
          </p>
        </div>
        {!album && (
          <button
            type="button"
            className="btn-outline btn-sm shrink-0"
            onClick={() => setShowFilmModal(true)}
          >
            {t("media.film_cta_create")}
          </button>
        )}
      </header>

      {/* Film banner + gallery strip */}
      <FilmBanner
        album={album}
        onCreateClick={() => setShowFilmModal(true)}
        onEditClick={() => setShowFilmModal(true)}
      />
      {album && <GalleryStrip album={album} />}

      {/* Feature cards grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FromGuestsCard
          album={album}
          access={filmAccess}
          onCreateClick={() => setShowFilmModal(true)}
          onUpgradeClick={handleUpgradeFilm}
        />
        <ToGuestsCard />
        <PhotographerCard
          url={photographerUrl}
          isEditing={editing}
          isSaving={saving}
          draft={draft}
          linkError={linkError}
          cardRef={photographerCardRef}
          onStartEdit={startEdit}
          onDraftChange={setDraft}
          onSave={savePhotographerLink}
          onCancel={cancelEdit}
        />
      </div>

      {/* Film settings summary */}
      {album && <FilmSettingsPanel album={album} onEditClick={() => setShowFilmModal(true)} />}

      {/* How it works (no film) or What's next (film active) */}
      {album ? (
        <NextStepsSection
          photographerSaved={!!photographerUrl}
          onPhotographerClick={scrollToAndEditPhotographer}
        />
      ) : (
        <HowItWorksSection />
      )}

      {/* Film creation / edit modal */}
      <FilmModal
        open={showFilmModal}
        album={album}
        onClose={() => setShowFilmModal(false)}
        onSaved={(a) => setAlbum(a)}
      />
    </div>
  );
}
