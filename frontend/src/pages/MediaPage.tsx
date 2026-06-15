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
  Camera,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Film,
  Link2,
  Pencil,
  QrCode,
  Share2,
  Users,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
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
    <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-umber-500 dark:text-umber-400">
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
function FilmStripDecor() {
  return (
    <div
      className="pointer-events-none hidden shrink-0 -rotate-2 select-none flex-col gap-1.5 opacity-40 lg:flex"
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-stretch gap-1">
          <div className="flex w-2 flex-col justify-around">
            <div className="h-1.5 rounded-[1px] bg-paper-100/40" />
            <div className="h-1.5 rounded-[1px] bg-paper-100/40" />
          </div>
          <div className="h-16 w-24 rounded border border-paper-100/20 bg-umber-700" />
          <div className="flex w-2 flex-col justify-around">
            <div className="h-1.5 rounded-[1px] bg-paper-100/40" />
            <div className="h-1.5 rounded-[1px] bg-paper-100/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

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

// Dark cinematic banner — always visible, adapts to whether a film exists.
function FilmBanner({
  album,
  albumStatus,
  photographerSaved,
  onCreateClick,
  onPhotographerChipClick,
}: {
  album: PhotoAlbum | null;
  albumStatus: FilmStatus | null;
  photographerSaved: boolean;
  onCreateClick: () => void;
  onPhotographerChipClick: () => void;
}) {
  const { t } = useT();
  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;

  function handleShare() {
    if (!uploadUrl) return;
    if (navigator.share) {
      navigator.share({ url: uploadUrl }).catch(() => {
        navigator.clipboard.writeText(uploadUrl).catch(() => {});
      });
    } else {
      navigator.clipboard.writeText(uploadUrl).catch(() => {});
    }
  }

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-umber-950 via-umber-900 to-umber-800 p-6 shadow-pop">
      {/* Radial vignette — dark edges, lighter centre */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse at 30% 50%, transparent 30%, rgba(0,0,0,0.45) 100%)",
        }}
      />
      <div className="relative z-10 flex items-start gap-6">
        {/* Left column */}
        <div className="min-w-0 flex-1">
          {/* Icon row + plain stat indicators */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-paper-200">
              <Film size={20} aria-hidden="true" />
            </div>
            {album && (
              <div className="ml-auto flex items-center gap-2.5 text-xs text-paper-400">
                <span className="flex items-center gap-1">
                  <Camera size={10} aria-hidden="true" />
                  {album.photoCount}
                </span>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1">
                  <Users size={10} aria-hidden="true" />
                  {album.participantCount}
                </span>
              </div>
            )}
          </div>

          {/* Headline — max-w prevents orphan words on narrow lines */}
          <h2 className="max-w-sm font-serif text-2xl font-semibold leading-snug tracking-tight !text-paper-100 sm:text-3xl">
            {t("media.film_empty_title")}
          </h2>

          {/* Status chips */}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            <StatusChip
              done={!!album}
              label={album ? t("media.film_title") : t("media.film_status_no_film")}
            />
            <StatusChip
              done={photographerSaved}
              label={
                photographerSaved
                  ? t("media.photographer_title")
                  : t("media.film_status_no_photographer")
              }
              onClick={onPhotographerChipClick}
            />
          </div>

          {/* CTA + no-app hint */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {album && uploadUrl ? (
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex items-center gap-2 rounded-lg bg-paper-50 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100"
              >
                <Share2 size={14} aria-hidden="true" />
                {t("media.film_cta_share")}
              </button>
            ) : (
              <button
                type="button"
                onClick={onCreateClick}
                className="inline-flex items-center gap-2 rounded-lg bg-paper-50 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100"
              >
                {t("media.film_cta_create")}
              </button>
            )}
            <span className="text-xs text-paper-400/70">{t("media.film_no_app_hint")}</span>
          </div>
        </div>

        {/* Right: decorative film strip (large screens only) */}
        <FilmStripDecor />
      </div>
    </div>
  );
}

// Single stat tile, optionally with a utilization progress bar.
function StatTile({
  label,
  value,
  accent,
  progress,
}: {
  label: string;
  value: string;
  accent?: boolean;
  progress?: { value: number; max: number };
}) {
  const pct = progress && progress.max > 0 ? Math.min(1, progress.value / progress.max) : null;
  const barColor =
    pct == null ? "" : pct > 0.9 ? "bg-red-500" : pct > 0.7 ? "bg-amber-400" : "bg-sage-500";

  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-paper-200 bg-paper-50 px-3 py-2.5 dark:border-umber-700 dark:bg-umber-800">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-umber-500 dark:text-umber-400">{label}</span>
      <span
        className={`text-base font-semibold tabular-nums ${
          accent ? "text-sage-700 dark:text-sage-400" : "text-ink-800 dark:text-paper-100"
        }`}
      >
        {value}
      </span>
      {pct !== null && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// Film status panel — stat tiles shown when an album exists.
function FilmStatusPanel({ album }: { album: PhotoAlbum }) {
  const { t } = useT();
  const status = getFilmStatus(album);
  const now = Date.now();

  const totalCapacity = album.shotsPerGuest != null ? album.shotsPerGuest * album.guestCap : null;

  const stats: Array<{
    label: string;
    value: string;
    accent?: boolean;
    progress?: { value: number; max: number };
  }> = [
    {
      label: t("media.film_stats_photos"),
      value: String(album.photoCount),
    },
    {
      label: t("media.film_stats_guests"),
      value: `${album.participantCount} / ${album.guestCap}`,
    },
    {
      label: t("media.film_stats_shots"),
      value:
        totalCapacity != null
          ? `${album.photoCount} / ${totalCapacity}`
          : t("media.film_unlimited"),
      progress: totalCapacity != null ? { value: album.photoCount, max: totalCapacity } : undefined,
    },
    {
      label: t("media.film_stats_upload"),
      value: album.isUploadEnabled ? t("media.film_status_open") : t("media.film_status_closed"),
      accent: album.isUploadEnabled,
    },
  ];

  const statusLabel =
    status === "live"
      ? t("media.film_status_shooting")
      : status === "developing"
        ? t("media.film_status_developing")
        : t("media.film_status_revealed");

  const statusDot =
    status === "live" ? "bg-sage-500" : status === "developing" ? "bg-amber-400" : "bg-paper-400";

  return (
    <div className="card mb-5 border-paper-200 bg-white/80 backdrop-blur-sm dark:border-umber-700 dark:bg-umber-800/80">
      {/* Status heading with pulsing dot when live */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-serif text-sm font-normal italic text-umber-600 dark:text-paper-200">
          <span
            className={`h-2.5 w-2.5 rounded-full ${statusDot} ${status === "live" ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
          {statusLabel}
        </h3>
        <span className="text-xs text-ink-400 dark:text-umber-400">
          {status === "live" && album.eventEndsAt && album.eventEndsAt > now && (
            <Countdown targetMs={album.eventEndsAt} label={t("media.film_ends_in")} />
          )}
          {status === "developing" && album.revealAt && album.revealAt > now && (
            <Countdown targetMs={album.revealAt} label={t("media.film_reveals_in")} />
          )}
          {status === "revealed" && (
            <span className="text-xs text-ink-400 dark:text-umber-400">
              {t("media.film_revealed")}
              {album.revealAt ? ` · ${formatRevealDate(album.revealAt)}` : ""}
            </span>
          )}
        </span>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <StatTile key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}

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
    <div className="card-hover flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-900 text-paper-50 dark:bg-ink-800 dark:text-paper-100">
          <Users size={20} aria-hidden="true" />
        </div>
        <CardLabel text="FROM GUESTS" />
      </div>

      <div>
        <h3 className="font-serif text-base font-semibold text-ink-900 dark:text-paper-50">
          {t("media.from_guests_title")}
        </h3>
        <p className="mt-1 text-sm text-umber-600 dark:text-umber-200">
          {t("media.from_guests_desc")}
        </p>
      </div>

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
        <div className="mt-auto space-y-3">
          <p className="text-sm text-ink-500 dark:text-umber-300">
            {t("media.from_guests_coming_note")}
          </p>
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
  const features = [
    t("media.to_guests_feature_1"),
    t("media.to_guests_feature_2"),
    t("media.to_guests_feature_3"),
  ];
  return (
    <div className="card-hover flex flex-col gap-5 border-2 border-dashed bg-paper-50/60">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-400 dark:bg-umber-700 dark:text-umber-400">
          <Share2 size={20} aria-hidden="true" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <CardLabel text="TO GUESTS" />
          <ComingSoonBadge label={t("media.coming_soon_title")} />
        </div>
      </div>

      <div>
        <h3 className="font-serif text-base font-semibold text-ink-700 dark:text-paper-200">
          {t("media.to_guests_title")}
        </h3>
        <p className="mt-1 text-sm text-umber-500 dark:text-umber-300">{t("media.to_guests_desc")}</p>
        <ul className="mt-3 space-y-1.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-xs text-ink-500 dark:text-umber-400">
              <Check size={11} className="mt-0.5 shrink-0 text-sage-500" aria-hidden="true" />
              {f}
            </li>
          ))}
        </ul>
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
      className="card-hover flex flex-col gap-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-600 dark:bg-umber-700 dark:text-umber-200">
          <Camera size={20} aria-hidden="true" />
        </div>
        <CardLabel text="PHOTOGRAPHER" />
      </div>

      <div>
        <h3 className="font-serif text-base font-semibold text-ink-900 dark:text-paper-50">
          {t("media.photographer_title")}
        </h3>
        <p className="mt-1 text-sm text-umber-600 dark:text-umber-200">
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

  const isUnnamed = !album.title?.trim();
  const nameValue = isUnnamed ? t("media.film_settings_unnamed") : album.title!;

  const identityRows: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: t("media.film_settings_name"), value: nameValue, warn: isUnnamed },
    {
      label: t("media.film_settings_aesthetic"),
      value: aestheticLabel[album.filmAesthetic] ?? album.filmAesthetic,
    },
    {
      label: t("media.film_settings_shots"),
      value: album.shotsPerGuest != null ? String(album.shotsPerGuest) : t("media.film_unlimited"),
    },
  ];

  const statusRows: Array<{ label: string; value: string }> = [
    {
      label: t("media.film_settings_reveal"),
      value: album.revealAt ? formatRevealDate(album.revealAt) : "Not set",
    },
    {
      label: t("media.film_settings_cap"),
      value: String(album.guestCap),
    },
    {
      label: t("media.film_settings_upload"),
      value: album.isUploadEnabled ? t("media.film_status_open") : t("media.film_status_closed"),
    },
  ];

  return (
    <div className="card mt-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-serif text-sm font-semibold text-ink-800 dark:text-paper-100">
          {t("media.film_settings_title")}
        </h3>
        <button type="button" className="btn-outline btn-sm" onClick={onEditClick}>
          <Pencil size={13} aria-hidden="true" />
          {t("common.edit")}
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {identityRows.map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-ink-400 dark:text-umber-400">{r.label}</dt>
            <dd
              className={`mt-0.5 text-sm font-medium ${
                r.warn
                  ? "text-amber-600 underline decoration-dotted underline-offset-2 dark:text-amber-400"
                  : "text-ink-700 dark:text-paper-200"
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="my-3 border-t border-paper-200 dark:border-umber-700" />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {statusRows.map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-ink-400 dark:text-umber-400">{r.label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink-700 dark:text-paper-200">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
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
    <div className="card mb-2 mt-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
        <h3 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-umber-500 dark:text-umber-400">
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
    <div className="card mb-2 mt-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
        <h3 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-umber-500 dark:text-umber-400">
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
    album?.shotsPerGuest != null ? String(album.shotsPerGuest) : "15",
  );

  useEffect(() => {
    if (!open) return;
    setTitle(album?.title ?? "");
    setAesthetic(album?.filmAesthetic ?? "natural");
    setShots(album?.shotsPerGuest != null ? String(album.shotsPerGuest) : "15");
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

      if (isEdit) {
        const { album: updated } = await photoAlbumApi.update({
          title: title.trim() || null,
          filmAesthetic: aesthetic,
          shotsPerGuest: spg,
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
    <div className="max-w-5xl">
      <FilmGrain />
      {/* Page header: status pill when film is active, create button when not */}
      <header className="mb-5 flex items-start justify-between gap-4 border-b border-paper-200 pb-5 dark:border-umber-700">
        <div className="min-w-0">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.15em] text-umber-400 dark:text-umber-500">
            Wedding Film
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif">{t("media.title")}</h1>
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

      {/* Dark cinematic banner */}
      <FilmBanner
        album={album}
        albumStatus={albumStatus}
        photographerSaved={!!photographerUrl}
        onCreateClick={() => setShowFilmModal(true)}
        onPhotographerChipClick={scrollToAndEditPhotographer}
      />

      {/* Live stats panel — only when a film exists */}
      {album && <FilmStatusPanel album={album} />}

      {/* Feature cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
