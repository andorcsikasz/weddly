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
  Download,
  ExternalLink,
  Film,
  GalleryHorizontalEnd,
  Link2,
  Lock,
  Pencil,
  QrCode,
  Share2,
  Upload,
  Users,
} from "lucide-react";
import React, { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ComingSoon } from "../components/ComingSoon";
import { Dialog, useToast } from "../components/ui";
import { useAuth } from "../lib/auth";
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

function daysUntil(ms: number): number {
  return Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
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

const DEMO_STRIP = ["/demo/film-hero.png", "/demo/film-02.jpg", "/demo/film-03.jpg"];

const AESTHETIC_LABELS: Record<FilmAesthetic, string> = {
  natural: "Natural",
  vintage: "Vintage",
  bw: "B&W",
  cinematic: "Cinematic",
  warm: "Warm",
};

const AESTHETIC_PREVIEW: Record<FilmAesthetic, string> = {
  natural: "bg-gradient-to-br from-sky-100 to-blue-200",
  vintage: "bg-gradient-to-br from-amber-100 to-orange-200",
  bw: "bg-gradient-to-br from-gray-200 to-gray-400",
  cinematic: "bg-gradient-to-br from-slate-300 to-indigo-200",
  warm: "bg-gradient-to-br from-orange-100 to-yellow-200",
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

// --- QR modal ---------------------------------------------------------------

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

// --- participant list (live-polling) ----------------------------------------

function ParticipantDashboard({
  albumToken,
  fallbackCount,
}: {
  albumToken: string;
  fallbackCount: number;
}) {
  const { t } = useT();
  const [devices, setDevices] = useState<FilmDevice[]>([]);
  const [expanded, setExpanded] = useState(true);

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

  const displayCount = devices.length > 0 ? devices.length : fallbackCount;

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between py-1 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2 text-xs text-umber-500">
          <Users size={12} aria-hidden="true" />
          {displayCount} joined
        </span>
        <span className="text-xs text-umber-400">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <ul className="mt-1 space-y-1">
          {devices.length > 0 ? (
            devices.map((d) => (
              <li
                key={d.deviceId}
                className="flex items-center justify-between text-xs text-umber-500"
              >
                <span className="truncate">{d.guestName ?? "Anonymous"}</span>
                <span className="ml-2 shrink-0 tabular-nums text-umber-500">
                  {d.shotCount} shot{d.shotCount !== 1 ? "s" : ""}
                </span>
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
      <form id="film-modal-form" onSubmit={handleSubmit} className="space-y-3">
        {/* Film neve */}
        <div>
          <label className="mb-0.5 flex items-baseline gap-1.5 text-xs font-medium text-ink-700 dark:text-paper-200">
            {t("media.film_settings_name")}
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

        {/* Megjelenés + Fotókorlát on one row */}
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-xs font-medium text-ink-700 dark:text-paper-200">
              {t("media.film_settings_aesthetic")}
            </p>
            <div className="flex gap-1.5">
              {FILM_AESTHETICS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAesthetic(a)}
                  title={AESTHETIC_LABELS[a]}
                  className={`flex flex-col items-center gap-0.5 rounded-lg border-2 p-0.5 transition-colors ${
                    aesthetic === a
                      ? "border-ink-900 dark:border-paper-100"
                      : "border-transparent hover:border-paper-300 dark:hover:border-umber-600"
                  }`}
                >
                  <div className={`h-8 w-8 rounded-md ${AESTHETIC_PREVIEW[a]}`} />
                  <span className="text-[9px] leading-tight text-ink-500 dark:text-umber-300">
                    {AESTHETIC_LABELS[a]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="shrink-0">
            <label className="mb-1.5 block text-xs font-medium text-ink-700 dark:text-paper-200">
              {t("media.film_settings_shots")}
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={500}
                value={shots}
                onChange={(e) => setShots(e.target.value)}
                className="input w-16 text-center text-sm"
              />
              <span className="text-xs text-ink-400">/ person</span>
            </div>
          </div>
        </div>

        {/* Date fields side by side */}
        {isEdit && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-0.5 flex items-baseline gap-1 text-xs font-medium text-ink-700 dark:text-paper-200">
                {t("media.film_settings_ends")}
                <span className="font-normal text-ink-400">(opt)</span>
              </label>
              <input
                type="datetime-local"
                value={eventEndsAt}
                onChange={(e) => setEventEndsAt(e.target.value)}
                className="input w-full text-xs"
              />
              <p className="mt-0.5 text-[10px] leading-snug text-ink-400">
                {t("media.film_settings_ends_hint")}
              </p>
            </div>
            <div>
              <label className="mb-0.5 flex items-baseline gap-1 text-xs font-medium text-ink-700 dark:text-paper-200">
                {t("media.film_settings_reveal")}
                <span className="font-normal text-ink-400">(opt)</span>
              </label>
              <input
                type="datetime-local"
                value={revealAt}
                onChange={(e) => setRevealAt(e.target.value)}
                className="input w-full text-xs"
              />
              <p className="mt-0.5 text-[10px] leading-snug text-ink-400">
                {t("media.film_settings_reveal_hint")}
              </p>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

// --- page -------------------------------------------------------------------

export default function MediaPage() {
  const { user } = useAuth();
  const { t } = useT();
  const toast = useToast();

  if (!user?.is_admin) return <ComingSoon />;
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
  const [showQr, setShowQr] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [coupleUploading, setCoupleUploading] = useState(false);
  const [coupleUploadProgress, setCoupleUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const coupleUploadRef = useRef<HTMLInputElement | null>(null);

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
  }

  const photographerUrl = couple?.media_links?.photographer ?? null;
  const albumStatus = album ? getFilmStatus(album) : null;
  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;
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

  useEffect(() => {
    if (!editing) return;
    function onPointerDown(e: MouseEvent) {
      const row = photographerRowRef.current;
      if (row && !row.contains(e.target as Node)) {
        savePhotographerLink(draftRef.current);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [editing]);

  function handleShare() {
    if (!uploadUrl) return;
    if (navigator.share) {
      navigator.share({ url: uploadUrl }).catch(() => {
        navigator.clipboard.writeText(uploadUrl).catch(() => {});
      });
    } else {
      navigator.clipboard.writeText(uploadUrl).catch(() => {});
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  if (loading) return null;

  // Cover photo for hero
  const coverPhoto = album?.coverImageUrl ?? DEMO_STRIP[0];
  const daysLeft = album?.eventEndsAt ? daysUntil(album.eventEndsAt) : null;
  const filmExpired = album?.eventEndsAt != null && Date.now() >= album.eventEndsAt;

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
          value: album.eventEndsAt ? formatRevealDate(album.eventEndsAt) : "Not set",
        },
        {
          icon: <Clock3 size={15} aria-hidden="true" />,
          label: t("media.film_settings_reveal"),
          value: album.revealAt
            ? formatRevealDate(album.revealAt)
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
    <div>
      <FilmGrain />

      {/* ── Card ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-paper-200 bg-paper-50">
        {album ? (
          <>
            {/* ── Hero ──────────────────────────────────────────────── */}
            <div className="relative h-36 overflow-hidden">
              <img
                src={coverPhoto}
                alt=""
                className="h-full w-full object-cover object-center"
                aria-hidden="true"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to top, rgba(15,10,7,0.82) 0%, rgba(15,10,7,0.7) 30%, rgba(15,10,7,0.3) 60%, transparent 80%)",
                }}
              />
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
                <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/60">
                  {t("media.film_title")}
                </p>
                <div className="group flex items-center gap-2">
                  <h1
                    className="font-serif text-xl italic leading-snug text-white"
                    style={{ textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}
                  >
                    {couple?.display_name || album.title || t("media.film_settings_unnamed")}
                  </h1>
                  <button
                    type="button"
                    onClick={() => setShowFilmModal(true)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-umber-400 hover:text-paper-200"
                    aria-label={t("media.film_settings_title")}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {/* ── Stats row ─────────────────────────────────────────── */}
            <div className="grid grid-cols-3 divide-x divide-paper-200 border-b border-paper-200">
              <div className="flex flex-col items-center gap-0.5 py-2 text-center">
                <Camera size={12} className="text-umber-400" aria-hidden="true" />
                <span className="font-grotesk text-lg font-semibold tabular-nums text-umber-900">
                  {album.photoCount.toLocaleString()}
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  {t("media.film_stat_moments")}
                </span>
              </div>
              <div className="flex flex-col items-center gap-0.5 py-2 text-center">
                <Clock3 size={12} className="text-umber-400" aria-hidden="true" />
                <span className="font-grotesk text-lg font-semibold tabular-nums text-umber-900">
                  {filmExpired ? "—" : (countdownStr ?? "--")}
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  {filmExpired ? t("media.film_stat_closed") : t("media.film_stat_left")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowParticipants((v) => !v)}
                className="flex flex-col items-center gap-0.5 py-2 text-center transition-colors hover:bg-paper-100"
              >
                <Users size={12} className="text-umber-400" aria-hidden="true" />
                <span className="font-grotesk text-lg font-semibold tabular-nums text-umber-900">
                  {album.participantCount}
                </span>
                <span className="flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  {t("media.film_stat_people")}
                  <ChevronRight
                    size={9}
                    aria-hidden="true"
                    className={`transition-transform ${showParticipants ? "rotate-90" : ""}`}
                  />
                </span>
              </button>
            </div>
            {/* Inline participants list — expands when People is tapped */}
            {showParticipants && album && (
              <div className="border-b border-paper-200 px-4 py-3">
                <ParticipantDashboard
                  albumToken={album.uploadToken}
                  fallbackCount={album.participantCount}
                />
              </div>
            )}

            {/* ── Action toolbar ────────────────────────────────────── */}
            {uploadUrl && (
              <>
                <div className="grid grid-cols-3 divide-x divide-paper-200 border-b border-paper-200">
                  <a
                    href={photoAlbumApi.qrUrl(album.uploadToken)}
                    download="guest-qr.png"
                    className="flex flex-col items-center gap-1 py-2.5 text-umber-700 transition-colors hover:bg-paper-100"
                  >
                    <QrCode size={16} aria-hidden="true" />
                    <span className="text-[10px] font-medium">{t("media.film_save_qr")}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowQr(true)}
                    className="flex flex-col items-center gap-1 py-2.5 text-umber-700 transition-colors hover:bg-paper-100"
                  >
                    <Share2 size={16} aria-hidden="true" />
                    <span className="text-[10px] font-medium">{t("media.film_share_btn")}</span>
                  </button>
                  <a
                    href={uploadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1 py-2.5 text-umber-700 transition-colors hover:bg-paper-100"
                  >
                    <Camera size={16} aria-hidden="true" />
                    <span className="text-[10px] font-medium">{t("media.film_guest_view")}</span>
                  </a>
                </div>
                {/* Privacy notice — slim inline */}
                <div className="flex items-center gap-1.5 px-4 py-1.5">
                  <Lock size={10} className="shrink-0 text-umber-400" aria-hidden="true" />
                  <span className="text-[11px] italic text-umber-400">
                    {t("media.film_privacy_notice")}
                  </span>
                </div>
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
                    <p className="mt-0.5 text-xs text-amber-700">{t("media.film_expired_body")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setShowFilmModal(true)}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                      >
                        <CalendarDays size={11} aria-hidden="true" />
                        {t("media.film_expired_action")}
                      </button>
                      <button
                        type="button"
                        onClick={() => coupleUploadRef.current?.click()}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                      >
                        <Upload size={11} aria-hidden="true" />
                        {t("media.film_add_own_photos")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Couple upload ─────────────────────────────────────── */}
            {uploadUrl && (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  disabled={coupleUploading}
                  onClick={() => coupleUploadRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-umber-900 py-2 text-sm font-medium text-paper-100 transition-colors hover:bg-umber-800 disabled:opacity-60"
                >
                  <Upload size={15} aria-hidden="true" />
                  {coupleUploadProgress
                    ? `Uploading ${coupleUploadProgress.done}/${coupleUploadProgress.total}...`
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
              <div className="mx-4 mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-start gap-2.5 text-xs text-amber-700">
                  <AlertTriangle
                    size={13}
                    className="mt-0.5 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                  <span>
                    Trial: up to {album.guestCap} guests.{" "}
                    <button
                      type="button"
                      className="font-semibold text-amber-800 underline underline-offset-2 hover:no-underline"
                      onClick={handleUpgradeFilm}
                    >
                      Unlock for €9.90
                    </button>{" "}
                    to allow up to 200 guests.
                  </span>
                </p>
              </div>
            )}

            {/* ── Settings grid (3 columns) ─────────────────────────── */}
            <div className="border-t border-paper-200">
              <p className="px-4 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                {t("media.film_settings_title")}
              </p>
              <div className="grid grid-cols-3">
                {settingsRows.map((row) => {
                  const editable = row.editable !== false;
                  const shared =
                    "group flex flex-col px-3 py-2 text-left border-r border-t border-paper-200 last:border-r-0 [&:nth-child(3n)]:border-r-0";
                  const inner = (
                    <>
                      <div className="mb-0.5 flex w-full items-center gap-1">
                        <span className="shrink-0 text-umber-400">{row.icon}</span>
                        <span className="truncate text-[9px] font-semibold uppercase tracking-[0.18em] text-umber-400">
                          {row.label}
                        </span>
                        {editable && (
                          <Pencil
                            size={7}
                            aria-hidden="true"
                            className="ml-auto shrink-0 text-umber-300 opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        )}
                      </div>
                      <span
                        className={`w-full truncate text-xs font-medium ${editable ? "text-umber-800" : "text-umber-400"}`}
                      >
                        {row.value}
                      </span>
                    </>
                  );
                  return editable ? (
                    <button
                      key={row.label}
                      type="button"
                      onClick={() => setShowFilmModal(true)}
                      className={`${shared} transition-colors hover:bg-paper-100`}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div key={row.label} className={`${shared} cursor-default bg-paper-100/50`}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Guest link ────────────────────────────────────────── */}
            {uploadUrl && (
              <div className="border-t border-paper-200 px-5 py-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  {t("media.film_guest_link")}
                </p>
                <div className="flex items-center gap-2 rounded-xl border border-paper-200 bg-paper-100 px-3 py-2">
                  <span className="flex-1 truncate font-mono text-xs text-umber-500">
                    {uploadUrl.replace(/^https?:\/\//, "")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(uploadUrl).catch(() => {});
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}
                    className="shrink-0 rounded-lg bg-umber-900 px-2.5 py-1 text-[11px] font-semibold text-paper-100 transition-colors hover:bg-umber-800"
                  >
                    {linkCopied ? t("media.from_guests_copied") : t("media.film_copy")}
                  </button>
                </div>
              </div>
            )}
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-umber-700 bg-umber-900">
                  <Film size={22} className="text-umber-400" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="font-grotesk text-2xl font-semibold text-paper-50 sm:text-3xl">
                    {t("media.film_empty_title")}
                  </h1>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-paper-400">
                    {t("media.film_no_app_hint")}
                  </p>
                </div>
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
                  <span className="font-grotesk text-xs font-bold text-umber-400">{s.n}</span>
                  <p className="mt-1.5 text-xs font-semibold text-umber-700">{s.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-umber-500">{s.body}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Photographer row (always visible) ─────────────────────── */}
        <div ref={photographerRowRef} className="border-t-2 border-dashed border-paper-300 mt-2">
          <p className="px-5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-400">
            {t("media.photographer_title")}
          </p>
          {editing ? (
            <form
              className="px-5 pb-3 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                savePhotographerLink(draft);
              }}
              noValidate
            >
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  className="flex-1 rounded-xl border border-paper-300 bg-white px-3 py-2.5 text-sm text-umber-900 placeholder-umber-400 outline-none focus:border-umber-500"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("media.collect_placeholder")}
                  aria-label={t("media.photographer_title")}
                  // biome-ignore lint/a11y/noAutofocus: open-to-paste UX.
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-paper-50 px-4 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100 disabled:opacity-50"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="px-2 text-sm text-umber-400 hover:text-umber-700"
                >
                  {t("common.cancel")}
                </button>
              </div>
              {linkError && (
                <p className="mt-1.5 text-xs text-red-400" role="alert">
                  {linkError}
                </p>
              )}
            </form>
          ) : (
            <div className="flex items-center gap-3.5 px-5 pb-3 pt-2">
              <Camera size={15} className="shrink-0 text-umber-400" aria-hidden="true" />
              {photographerUrl ? (
                <>
                  <span className="flex-1 truncate text-sm text-umber-700">
                    {photographerUrl.replace(/^https?:\/\//, "").split("/")[0]}
                  </span>
                  <a
                    href={photographerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-medium text-umber-500 transition-colors hover:text-umber-900"
                  >
                    <ExternalLink size={12} aria-hidden="true" />
                    {t("media.photographer_open")}
                  </a>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="text-xs text-umber-400 transition-colors hover:text-umber-700"
                  >
                    <Pencil size={12} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-umber-500">
                    {t("media.photographer_cta")}
                  </span>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="flex items-center gap-1 text-xs font-medium text-umber-500 transition-colors hover:text-umber-900"
                  >
                    <Link2 size={12} aria-hidden="true" />
                    {t("media.collect_add")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Reveal gallery teaser (coming soon) ───────────────────── */}
        <div className="flex cursor-default items-center gap-3.5 border-t border-paper-200 px-5 py-3 opacity-40 select-none pointer-events-none">
          <Share2 size={15} className="shrink-0 text-umber-400" aria-hidden="true" />
          <span className="flex-1 text-sm text-umber-500">{t("media.to_guests_title")}</span>
          <span className="rounded-full border border-paper-300 px-2.5 py-0.5 text-[10px] font-medium text-umber-500">
            {t("media.coming_soon_title")}
          </span>
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      <FilmModal
        open={showFilmModal}
        album={album}
        couple={couple}
        onClose={() => setShowFilmModal(false)}
        onSaved={(a) => setAlbum(a)}
      />
      {album && uploadUrl && (
        <QrModal
          open={showQr}
          uploadToken={album.uploadToken}
          uploadUrl={uploadUrl}
          onClose={() => setShowQr(false)}
        />
      )}
    </div>
  );
}
