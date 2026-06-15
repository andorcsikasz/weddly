// Weddly Photos — Wedding Film product hub.
//
// Three panels:
//   "From guests"    — QR/link-based guest uploads. Empty → create modal → active.
//   "To guests"      — shared reveal gallery. Coming soon.
//   "By photographer"— couple saves photographer gallery link. Live (existing backend).

import type {
  Couple,
  FilmAccessCheck,
  FilmAesthetic,
  FilmDevice,
  MediaLinks,
  PhotoAlbum,
} from "@shared/types";
import { FILM_AESTHETICS } from "@shared/types";
import {
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

// Inline SVG — no Google Drive icon in Lucide. Three triangles meeting at the
// centroid form the Drive logo (green = left arm, blue = right arm, yellow = bottom).
function GoogleDriveIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 87.3 78"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

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

// --- QR placeholder (used before the real SVG loads) -----------------------

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

function ComingSoonBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
      {label}
    </span>
  );
}

// Small caps card label shown top-right of a card.
function CardLabel({ text }: { text: string }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-widest text-ink-400 dark:text-umber-500">
      {text}
    </span>
  );
}

// Status chip used in the dark banner row.
function StatusChip({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={`flex items-center gap-1.5 text-xs ${done ? "text-sage-400" : "text-umber-500"}`}
    >
      {done ? (
        <Check size={11} aria-hidden="true" />
      ) : (
        <span className="inline-block h-3 w-3 rounded-full border border-umber-600" />
      )}
      {label}
    </span>
  );
}

// Decorative film-strip column shown on the right side of FilmBanner.
function FilmStripDecor() {
  return (
    <div
      className="hidden lg:flex shrink-0 -mt-1 flex-col gap-1.5 -rotate-2 opacity-20 select-none pointer-events-none"
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-stretch gap-1">
          <div className="flex w-2 flex-col justify-around">
            <div className="h-1.5 rounded-[1px] bg-paper-50" />
            <div className="h-1.5 rounded-[1px] bg-paper-50" />
          </div>
          <div className="h-16 w-24 rounded border border-paper-50 bg-ink-800" />
          <div className="flex w-2 flex-col justify-around">
            <div className="h-1.5 rounded-[1px] bg-paper-50" />
            <div className="h-1.5 rounded-[1px] bg-paper-50" />
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

// Dark cinematic banner — shown always, adapts based on whether a film exists.
function FilmBanner({
  album,
  photographerSaved,
  onCreateClick,
}: {
  album: PhotoAlbum | null;
  photographerSaved: boolean;
  onCreateClick: () => void;
}) {
  const { t } = useT();
  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;

  return (
    <div className="card mb-5 overflow-hidden border-ink-800 bg-ink-900 dark:border-ink-700 dark:bg-ink-900">
      <div className="flex items-start gap-6">
        {/* Left column */}
        <div className="min-w-0 flex-1">
          {/* Icon row + live stat pills */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-umber-800 text-paper-200">
              <Film size={20} aria-hidden="true" />
            </div>
            {album && (
              <div className="ml-auto flex gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-umber-700 px-2.5 py-1 text-xs text-paper-300">
                  <Camera size={11} aria-hidden="true" />
                  {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-umber-700 px-2.5 py-1 text-xs text-paper-300">
                  <Users size={11} aria-hidden="true" />
                  {album.participantCount} {album.participantCount === 1 ? "guest" : "guests"}
                </span>
              </div>
            )}
          </div>

          {/* Headline */}
          <h2 className="font-grotesk text-2xl font-semibold leading-snug !text-paper-50 sm:text-3xl">
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
            />
          </div>

          {/* CTA + no-app hint */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {album && uploadUrl ? (
              <a
                href={uploadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-paper-50 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100"
              >
                <Camera size={14} aria-hidden="true" />
                {t("media.film_cta_view")}
              </a>
            ) : (
              <button
                type="button"
                onClick={onCreateClick}
                className="inline-flex items-center gap-2 rounded-lg bg-paper-50 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100"
              >
                {t("media.film_cta_create")}
              </button>
            )}
            <span className="text-xs text-umber-500">{t("media.film_no_app_hint")}</span>
          </div>
        </div>

        {/* Right: decorative film strip (large screens only) */}
        <FilmStripDecor />
      </div>
    </div>
  );
}

// Film status panel — warm stat pills shown when an album exists.
function FilmStatusPanel({ album }: { album: PhotoAlbum }) {
  const { t } = useT();
  const status = getFilmStatus(album);
  const now = Date.now();

  const stats: Array<{ label: string; value: string; accent?: boolean }> = [
    {
      label: t("media.film_stats_photos"),
      value: String(album.photoCount),
      accent: album.photoCount > 0,
    },
    {
      label: t("media.film_stats_guests"),
      value: `${album.participantCount} / ${album.guestCap}`,
    },
    {
      label: t("media.film_stats_shots"),
      value: album.shotsPerGuest != null ? String(album.shotsPerGuest) : t("media.film_unlimited"),
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
    <div className="card mb-5 border-paper-200 bg-white dark:border-umber-700 dark:bg-umber-850">
      {/* Status badge + countdown */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink-700 dark:text-paper-100">
          <span className={`h-2 w-2 rounded-full ${statusDot}`} aria-hidden="true" />
          {statusLabel}
        </span>
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
              {album.revealAt ? ` — ${formatRevealDate(album.revealAt)}` : ""}
            </span>
          )}
        </span>
      </div>

      {/* Stat pills */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex flex-col gap-0.5 rounded-xl border border-paper-200 bg-paper-50 px-3 py-2.5 dark:border-umber-700 dark:bg-umber-800"
          >
            <span className="text-xs text-ink-400 dark:text-umber-400">{s.label}</span>
            <span
              className={`text-base font-semibold tabular-nums ${
                s.accent ? "text-sage-700 dark:text-sage-400" : "text-ink-800 dark:text-paper-100"
              }`}
            >
              {s.value}
            </span>
          </div>
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

  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;
  const displayLink = uploadUrl ? uploadUrl.replace(/^https?:\/\//, "") : null;

  const needsUpgrade = album !== null && album.paidAt === null && access !== null && !access.free;

  function handleCopy() {
    if (!uploadUrl) return;
    navigator.clipboard.writeText(uploadUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card flex flex-col gap-5 border-paper-300 bg-white dark:border-umber-700 dark:bg-umber-850">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-900 text-paper-50 dark:bg-ink-800 dark:text-paper-100">
          <Users size={20} aria-hidden="true" />
        </div>
        <CardLabel text="FROM GUESTS" />
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
          {/* QR + link */}
          <div className="flex items-start gap-4">
            <a
              href={photoAlbumApi.qrUrl(album.uploadToken)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open printable QR code"
              className="shrink-0 rounded-xl border border-paper-200 bg-paper-50 p-2 hover:border-ink-300 transition-colors dark:border-umber-700 dark:bg-umber-800"
            >
              <QrPlaceholder className="h-16 w-16 text-ink-800 dark:text-paper-100" />
            </a>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs font-medium text-ink-500 dark:text-umber-300">
                {t("media.from_guests_link_label")}
              </p>
              <p className="truncate rounded-lg border border-paper-200 bg-paper-50 px-3 py-2 font-mono text-xs text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200">
                {displayLink}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-100"
                  onClick={handleCopy}
                >
                  <Copy size={12} aria-hidden="true" />
                  {copied ? t("media.from_guests_copied") : t("media.from_guests_copy")}
                </button>
                <a
                  href={photoAlbumApi.qrUrl(album.uploadToken)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-100"
                >
                  <QrCode size={12} aria-hidden="true" />
                  Print QR
                </a>
              </div>
            </div>
          </div>

          {/* Upgrade notice */}
          {needsUpgrade && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-700/40 dark:bg-amber-900/20">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Trial limit: up to {album.guestCap} guests.{" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2 hover:no-underline"
                  onClick={onUpgradeClick}
                >
                  Unlock for €9.90
                </button>{" "}
                to allow up to 200 guests.
              </p>
            </div>
          )}

          {/* Participant list */}
          <ParticipantDashboard albumToken={album.uploadToken} />
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

// "To guests" — reveal/share. Coming soon.
function ToGuestsCard() {
  const { t } = useT();
  return (
    <div className="card flex flex-col gap-5 border-2 border-dashed border-paper-300 bg-white dark:border-umber-700 dark:bg-umber-850">
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
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-paper-100 px-2.5 text-ink-600 dark:bg-umber-700 dark:text-umber-200">
          <Camera size={18} aria-hidden="true" />
          <GoogleDriveIcon size={15} />
        </div>
        <CardLabel text="PHOTOGRAPHER" />
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
            <GoogleDriveIcon size={14} />
            {t("media.photographer_cta")}
          </button>
        )}
      </div>
    </div>
  );
}

// Film settings read-only summary.
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

  const rows: Array<{ label: string; value: string }> = [
    {
      label: t("media.film_settings_name"),
      value: album.title ?? t("media.film_settings_unnamed"),
    },
    {
      label: t("media.film_settings_aesthetic"),
      value: aestheticLabel[album.filmAesthetic] ?? album.filmAesthetic,
    },
    {
      label: t("media.film_settings_shots"),
      value: album.shotsPerGuest != null ? String(album.shotsPerGuest) : t("media.film_unlimited"),
    },
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
    <div className="card mt-4 border-paper-200 bg-white dark:border-umber-700 dark:bg-umber-850">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-grotesk text-sm font-semibold text-ink-800 dark:text-paper-100">
          {t("media.film_settings_title")}
        </h3>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-100"
          onClick={onEditClick}
        >
          <Pencil size={11} aria-hidden="true" />
          {t("common.edit")}
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {rows.map((r) => (
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

// "How it works" — 3 step guide shown below the feature cards.
function HowItWorksSection() {
  const { t } = useT();

  const steps = [
    { n: "1", title: t("media.film_how_1_title"), body: t("media.film_how_1_body") },
    { n: "2", title: t("media.film_how_2_title"), body: t("media.film_how_2_body") },
    { n: "3", title: t("media.film_how_3_title"), body: t("media.film_how_3_body") },
  ];

  return (
    <div className="card mt-6 mb-2 border-paper-200 bg-white dark:border-umber-700 dark:bg-umber-850">
      {/* Centered divider header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
        <h3 className="font-grotesk text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-umber-400">
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

  // Reset fields when modal opens for a different state.
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
      ? "…"
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
                  Free — loyal couple
                </span>
              ) : (
                `Access: ${priceLabel}`
              )}
            </span>
          )}
          <div className="flex gap-2 ml-auto">
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
          <label className="block text-sm font-medium text-ink-700 dark:text-paper-200 mb-1">
            {t("media.film_settings_name")}{" "}
            <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Anna &amp; Bence — Summer 2026"
            className="input text-sm w-full"
          />
        </div>

        <div>
          <p className="text-sm font-medium text-ink-700 dark:text-paper-200 mb-2">
            {t("media.film_settings_aesthetic")}
          </p>
          <div className="flex gap-2 flex-wrap">
            {FILM_AESTHETICS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAesthetic(a)}
                className={`flex flex-col items-center gap-1 rounded-xl p-0.5 border-2 transition-colors ${
                  aesthetic === a
                    ? "border-ink-900 dark:border-paper-100"
                    : "border-transparent hover:border-paper-300"
                }`}
              >
                <div className={`w-12 h-12 rounded-lg ${AESTHETIC_PREVIEW[a]}`} />
                <span className="text-[10px] text-ink-600 dark:text-umber-300">
                  {AESTHETIC_LABELS[a]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-700 dark:text-paper-200 mb-1">
            {t("media.film_settings_shots")}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={500}
              value={shots}
              onChange={(e) => setShots(e.target.value)}
              className="input text-sm w-24"
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
  const editingCardRef = useRef<HTMLDivElement | null>(null);
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
    toast.success("Film activated! Guests can now join — up to 200 participants.");
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

  if (loading) return null;

  return (
    <>
      <header className="mb-5">
        <h1 className="font-grotesk">{t("media.title")}</h1>
        <p className="mt-1.5 text-sm text-umber-700 dark:text-umber-300">{t("media.sub")}</p>
      </header>

      {/* Dark cinematic banner — adapts to empty / active state */}
      <FilmBanner
        album={album}
        photographerSaved={!!photographerUrl}
        onCreateClick={() => setShowFilmModal(true)}
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
          cardRef={editingCardRef}
          onStartEdit={startEdit}
          onDraftChange={setDraft}
          onSave={savePhotographerLink}
          onCancel={cancelEdit}
        />
      </div>

      {/* Film settings summary */}
      {album && <FilmSettingsPanel album={album} onEditClick={() => setShowFilmModal(true)} />}

      {/* How it works */}
      <HowItWorksSection />

      {/* Film creation / edit modal */}
      <FilmModal
        open={showFilmModal}
        album={album}
        onClose={() => setShowFilmModal(false)}
        onSaved={(a) => setAlbum(a)}
      />
    </>
  );
}
