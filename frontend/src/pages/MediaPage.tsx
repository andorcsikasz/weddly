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

const DEMO_STRIP = ["/demo/film-01.jpg", "/demo/film-02.jpg", "/demo/film-03.jpg"];

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
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2 text-xs text-paper-400">
          <Users size={12} aria-hidden="true" />
          {devices.length} joined
        </span>
        <span className="text-xs text-umber-400">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <ul className="mt-1 space-y-1">
          {devices.map((d) => (
            <li
              key={d.deviceId}
              className="flex items-center justify-between text-xs text-paper-400"
            >
              <span className="truncate">{d.guestName ?? "Anonymous"}</span>
              <span className="ml-2 shrink-0 tabular-nums text-paper-400">
                {d.shotCount} shot{d.shotCount !== 1 ? "s" : ""}
              </span>
            </li>
          ))}
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
    photoAlbumApi.current().then((r) => setAlbum(r.album)).catch(() => {});
  }

  const photographerUrl = couple?.media_links?.photographer ?? null;
  const albumStatus = album ? getFilmStatus(album) : null;
  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;
  const totalCapacity =
    album !== null && album.shotsPerGuest != null
      ? album.shotsPerGuest * album.guestCap
      : null;
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

  // iOS-style settings rows
  type SettingsRow = {
    icon: React.ReactNode;
    label: string;
    value: string;
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
          value: `${album.guestCap} people`,
        },
        {
          icon: <GalleryHorizontalEnd size={15} aria-hidden="true" />,
          label: t("media.film_settings_shots"),
          value:
            album.shotsPerGuest != null ? String(album.shotsPerGuest) : t("media.film_unlimited"),
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

      {/* ── Dark canvas ───────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-umber-950">

        {album ? (
          <>
            {/* ── Hero ──────────────────────────────────────────────── */}
            <div className="relative h-52 overflow-hidden">
              <img
                src={coverPhoto}
                alt=""
                className="h-full w-full object-cover"
                aria-hidden="true"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to top, rgba(15,10,7,1) 0%, rgba(15,10,7,0.92) 35%, rgba(15,10,7,0.6) 60%, transparent 80%)",
                }}
              />
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
                <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  Wedding Film
                </p>
                <h1
                  className="font-serif text-2xl italic leading-snug text-paper-50"
                  style={{ textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}
                >
                  {album.title || t("media.film_empty_title")}
                </h1>
              </div>
            </div>

            {/* ── Stats row ─────────────────────────────────────────── */}
            <div className="grid grid-cols-3 divide-x divide-umber-800 border-b border-umber-800">
              <div className="flex flex-col items-center py-3 text-center">
                <span className="font-grotesk text-2xl font-semibold tabular-nums text-paper-50">
                  {album.photoCount.toLocaleString()}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  Moments
                </span>
              </div>
              <div className="flex flex-col items-center py-3 text-center">
                <span className="font-grotesk text-2xl font-semibold tabular-nums text-paper-50">
                  {countdownStr ?? "--"}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  Left
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowParticipants((v) => !v)}
                className="flex flex-col items-center py-3 text-center transition-colors hover:bg-umber-900"
              >
                <span className="font-grotesk text-2xl font-semibold tabular-nums text-paper-50">
                  {album.participantCount}
                </span>
                <span className="mt-0.5 flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  People
                  <ChevronRight size={10} aria-hidden="true" className={`transition-transform ${showParticipants ? "rotate-90" : ""}`} />
                </span>
              </button>
            </div>
            {/* Inline participants list — expands when People is tapped */}
            {showParticipants && album && (
              <div className="border-b border-umber-800 px-4 py-3">
                <ParticipantDashboard albumToken={album.uploadToken} />
              </div>
            )}

            {/* ── Action buttons ────────────────────────────────────── */}
            {uploadUrl && (
              <div className="flex gap-2 px-4 py-3">
                <a
                  href={photoAlbumApi.qrUrl(album.uploadToken)}
                  download="guest-qr.png"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-umber-700 bg-umber-900 py-2.5 text-sm font-medium text-paper-200 transition-colors hover:bg-umber-800"
                >
                  <Download size={14} aria-hidden="true" />
                  Export
                </a>
                <button
                  type="button"
                  onClick={() => setShowQr(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-umber-700 bg-umber-900 py-2.5 text-sm font-medium text-paper-200 transition-colors hover:bg-umber-800"
                >
                  <QrCode size={14} aria-hidden="true" />
                  Invite
                </button>
                <a
                  href={uploadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-paper-50 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-100"
                >
                  <Camera size={14} aria-hidden="true" />
                  Camera
                </a>
              </div>
            )}

            {/* ── Privacy notice ────────────────────────────────────── */}
            {uploadUrl && (
              <div className="mx-4 mb-2 flex items-center gap-2.5 rounded-xl border border-umber-800 bg-umber-900/60 px-4 py-2">
                <Lock size={13} className="shrink-0 text-umber-400" aria-hidden="true" />
                <span className="text-xs text-paper-400">Only the host can see everyone's photos until reveal</span>
              </div>
            )}

            {/* ── Couple upload ─────────────────────────────────────── */}
            {uploadUrl && (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  disabled={coupleUploading}
                  onClick={() => coupleUploadRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-umber-700 bg-umber-900 py-2.5 text-sm font-medium text-paper-200 transition-colors hover:bg-umber-800 disabled:opacity-60"
                >
                  <Upload size={15} aria-hidden="true" />
                  {coupleUploadProgress
                    ? `Uploading ${coupleUploadProgress.done}/${coupleUploadProgress.total}...`
                    : "Add your own photos"}
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
              <div className="mx-4 mb-4 rounded-xl border border-amber-800/50 bg-amber-950/40 px-4 py-3">
                <p className="flex items-start gap-2.5 text-xs text-amber-300">
                  <AlertTriangle
                    size={13}
                    className="mt-0.5 shrink-0 text-amber-500"
                    aria-hidden="true"
                  />
                  <span>
                    Trial: up to {album.guestCap} guests.{" "}
                    <button
                      type="button"
                      className="font-semibold text-amber-200 underline underline-offset-2 hover:no-underline"
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
            <div className="border-t border-umber-800">
              <p className="px-4 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-[0.28em] text-umber-500">
                {t("media.film_settings_title")}
              </p>
              <div className="grid grid-cols-3">
                {settingsRows.map((row) => (
                  <button
                    key={row.label}
                    type="button"
                    onClick={() => setShowFilmModal(true)}
                    className="flex flex-col px-4 py-2.5 text-left transition-colors hover:bg-umber-900 border-r border-t border-umber-800 last:border-r-0 [&:nth-child(3n)]:border-r-0"
                  >
                    <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-umber-500 truncate w-full">
                      {row.label}
                    </span>
                    <span className="mt-0.5 text-sm text-paper-300 truncate w-full">
                      {row.value}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Guest link ────────────────────────────────────────── */}
            {uploadUrl && (
              <div className="border-t border-umber-800 px-5 py-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-400">
                  Guest link
                </p>
                <div className="flex items-center gap-2 rounded-xl border border-umber-800 bg-umber-900 px-3 py-2.5">
                  <span className="flex-1 truncate font-mono text-xs text-paper-400">
                    {uploadUrl.replace(/^https?:\/\//, "")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(uploadUrl).catch(() => {});
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}
                    className="shrink-0 text-xs font-medium text-paper-400 transition-colors hover:text-paper-200"
                  >
                    {linkCopied ? "Copied!" : "Copy"}
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
              <div
                className="absolute inset-0"
                style={{ background: "rgba(15,10,7,0.5)" }}
              />
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
            <div className="grid grid-cols-3 divide-x divide-umber-800 border-t border-umber-800">
              {[
                { n: "1", title: t("media.film_how_1_title"), body: t("media.film_how_1_body") },
                { n: "2", title: t("media.film_how_2_title"), body: t("media.film_how_2_body") },
                { n: "3", title: t("media.film_how_3_title"), body: t("media.film_how_3_body") },
              ].map((s) => (
                <div key={s.n} className="px-4 py-3">
                  <span className="font-grotesk text-xs font-bold text-umber-400">{s.n}</span>
                  <p className="mt-1.5 text-xs font-semibold text-paper-300">{s.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-paper-400">{s.body}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Photographer row (always visible) ─────────────────────── */}
        <div
          ref={photographerRowRef}
          className="border-t-2 border-dashed border-umber-600 mt-2"
        >
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
                  className="flex-1 rounded-xl border border-umber-700 bg-umber-900 px-3 py-2.5 text-sm text-paper-200 placeholder-umber-600 outline-none focus:border-umber-500"
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
                  className="px-2 text-sm text-umber-400 hover:text-paper-200"
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
                  <span className="flex-1 truncate text-sm text-paper-300">
                    {photographerUrl.replace(/^https?:\/\//, "").split("/")[0]}
                  </span>
                  <a
                    href={photographerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-medium text-paper-400 transition-colors hover:text-paper-100"
                  >
                    <ExternalLink size={12} aria-hidden="true" />
                    {t("media.photographer_open")}
                  </a>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="text-xs text-umber-400 transition-colors hover:text-paper-200"
                  >
                    <Pencil size={12} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-umber-400">{t("media.photographer_cta")}</span>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="flex items-center gap-1 text-xs font-medium text-paper-400 transition-colors hover:text-paper-100"
                  >
                    <Link2 size={12} aria-hidden="true" />
                    Add link
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Reveal gallery teaser (coming soon) ───────────────────── */}
        <div className="flex items-center gap-3.5 border-t border-umber-800 px-5 py-3 opacity-50">
          <Share2 size={15} className="shrink-0 text-paper-500" aria-hidden="true" />
          <span className="flex-1 text-sm text-paper-500">{t("media.to_guests_title")}</span>
          <span className="rounded-full border border-umber-600 px-2.5 py-0.5 text-[10px] font-medium text-paper-500">
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
