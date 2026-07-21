import type { Couple, FilmAccessCheck, FilmAesthetic, FilmDevice, PhotoAlbum } from "@shared/types";
import { FILM_AESTHETICS, FILM_FILTERS, MAX_PHOTOGRAPHER_LINKS } from "@shared/types";
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
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  QrCode,
  Share2,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import React, { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Dialog, useConfirm, useToast } from "../components/ui";
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
  const [copied, setCopied] = useState(false);

  const longMsg = t("media.share_message_long").replace("{{names}}", names).replace("{{url}}", url);
  const smsMsg = t("media.share_message_sms").replace("{{names}}", names).replace("{{url}}", url);
  const emailBody = t("media.share_email_body").replace("{{names}}", names).replace("{{url}}", url);

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(longMsg)}`;
  const smsHref = `sms:?&body=${encodeURIComponent(smsMsg)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(
    t("media.share_email_subject"),
  )}&body=${encodeURIComponent(emailBody)}`;

  function handleCopy() {
    navigator.clipboard.writeText(longMsg).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
}: {
  albumToken: string;
  fallbackCount: number;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [devices, setDevices] = useState<FilmDevice[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    return photoAlbumApi
      .listDevices()
      .then((r) => setDevices(r.devices))
      .catch(() => {});
  }, []);

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

  async function handleRemove(device: FilmDevice) {
    if (removingId) return;
    const name = device.guestName ?? "Anonymous";
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
                className="group flex items-center justify-between gap-2 text-xs text-umber-500"
              >
                <span className="truncate">{d.guestName ?? "Anonymous"}</span>
                <span className="ml-auto shrink-0 tabular-nums text-umber-500">
                  {d.shotCount} shot{d.shotCount !== 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(d)}
                  disabled={removingId !== null}
                  aria-label={t("media.participant_remove_title")}
                  title={t("media.participant_remove_title")}
                  className="shrink-0 rounded-full p-1 text-umber-400 transition-colors hover:bg-paper-100 hover:text-umber-900 disabled:opacity-50"
                >
                  <Trash2 size={12} aria-hidden="true" />
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
          {isPlaceholderTitle(title) && (
            <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-800">
                  {t("media.placeholder_warn_title")}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-amber-700">
                  {t("media.placeholder_warn_body").replace("{{title}}", title.trim())}
                </p>
              </div>
            </div>
          )}
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
                  <img
                    src={DEMO_STRIP[0]}
                    alt=""
                    aria-hidden="true"
                    className="h-8 w-8 rounded-md object-cover"
                    style={{ filter: FILM_FILTERS[a] }}
                  />
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
  const { t } = useT();
  const toast = useToast();
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
  // Collapsible wedding-film card — remembers the couple's choice across reloads.
  const [filmOpen, setFilmOpen] = useState(() => {
    try {
      return localStorage.getItem("weddly.media.filmOpen") !== "0";
    } catch {
      return true;
    }
  });
  function toggleFilm() {
    setFilmOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("weddly.media.filmOpen", next ? "1" : "0");
      } catch {
        // localStorage unavailable (private mode) — collapse still works in-session.
      }
      return next;
    });
  }
  const [linkCopied, setLinkCopied] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState(false);
  const [togglingUpload, setTogglingUpload] = useState(false);
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

  const photographerUrls = couple?.media_links?.photographer ?? [];
  const albumStatus = album ? getFilmStatus(album) : null;
  const uploadUrl = album ? `${window.location.origin}/photos/${album.uploadToken}` : null;
  // #17: prefer the prettier custom slug for display + copy/share; QR stays on the token.
  const guestLinkUrl =
    album && album.slug ? `${window.location.origin}/photos/${album.slug}` : uploadUrl;

  function openSlugEditor() {
    setSlugDraft(album?.slug ?? "");
    setSlugError(null);
    setEditingSlug((v) => !v);
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

      {/* ── Photographer gallery card (top) ───────────────────────── */}
      <div className="overflow-hidden rounded-3xl border border-paper-200 bg-white shadow-soft">
        {/* ── Photographer row ──────────────────────────────────────── */}
        <div ref={photographerRowRef}>
          <p className="px-5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-400">
            {t("media.photographer_title")}
          </p>

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
                    <span className="flex items-center gap-1 text-[12px] text-umber-400">
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
              noValidate
            >
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  className="flex-1 rounded-2xl border border-paper-300 bg-white px-4 py-3 text-sm text-umber-900 placeholder-umber-400 outline-none transition-colors focus:border-umber-900"
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
                  className="shrink-0 rounded-2xl bg-umber-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-umber-800 disabled:opacity-50"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="shrink-0 px-2 text-sm text-umber-400 hover:text-umber-700"
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
                    <span className="truncate text-[13px] text-umber-400">
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

        {/* ── Reveal gallery teaser (coming soon) ───────────────────── */}
        <div className="pointer-events-none flex cursor-default select-none items-center gap-4 border-t border-paper-200 px-5 py-4 opacity-50">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-umber-300 text-umber-400">
            <Share2 size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-[15px] font-medium text-umber-700">
              {t("media.to_guests_title")}
            </span>
            <p className="mt-0.5 text-[13px] leading-snug text-umber-400">
              {t("media.shared_gallery_teaser")}
            </p>
          </div>
          <span className="shrink-0 self-center rounded-full border border-paper-300 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-umber-400">
            {t("media.coming_soon_title")}
          </span>
        </div>
      </div>

      {/* ── Wedding film card (collapsible) ───────────────────────── */}
      <div className="mt-4 overflow-hidden rounded-3xl border border-paper-200 bg-white shadow-soft">
        {album ? (
          <>
            {/* ── Hero ──────────────────────────────────────────────── */}
            <div className="relative h-48 overflow-hidden">
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
                    "linear-gradient(to top, rgba(15,10,7,0.94) 0%, rgba(15,10,7,0.82) 30%, rgba(15,10,7,0.4) 62%, transparent 88%)",
                }}
              />
              <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
                <p className="mb-1.5 font-grotesk text-[11px] font-semibold uppercase tracking-[0.16em] text-paper-200">
                  {t("media.film_title")}
                </p>
                <div className="group flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFilmModal(true)}
                    className="text-left"
                    aria-label={t("media.film_settings_title")}
                  >
                    <h1
                      className="font-serif text-2xl font-medium leading-snug !text-paper-50"
                      style={{ textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}
                    >
                      {couple?.display_name || album.title || t("media.film_settings_unnamed")}
                    </h1>
                  </button>
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
              <button
                type="button"
                onClick={toggleFilm}
                aria-expanded={filmOpen}
                aria-label={filmOpen ? t("media.film_collapse") : t("media.film_expand")}
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/40 text-paper-50 backdrop-blur transition-colors hover:bg-ink-900/60"
              >
                <ChevronRight
                  size={18}
                  aria-hidden="true"
                  className={`transition-transform ${filmOpen ? "rotate-90" : ""}`}
                />
              </button>
            </div>

            {filmOpen && (
              <>
                {/* ── Stats row ─────────────────────────────────────────── */}
                <div className="grid grid-cols-3 border-b border-paper-200">
                  <div className="flex flex-col items-center gap-1 py-5 text-center">
                    <span className="font-grotesk text-[28px] font-bold leading-none tabular-nums text-umber-900">
                      {album.photoCount.toLocaleString()}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-umber-400">
                      {t("media.film_stat_moments")}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 border-x border-paper-200 py-5 text-center">
                    <span className="font-grotesk text-[28px] font-bold leading-none tabular-nums text-umber-900">
                      {filmExpired ? "-" : (countdownStr ?? "--")}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-umber-400">
                      {filmExpired ? t("media.film_stat_closed") : t("media.film_stat_left")}
                    </span>
                    {album.eventEndsAt && !filmExpired && (
                      <span className="mt-0.5 text-[9px] leading-tight text-umber-400">
                        {formatRevealDate(album.eventEndsAt)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowParticipants((v) => !v)}
                    className="flex flex-col items-center gap-1 py-5 text-center transition-colors hover:bg-paper-50"
                  >
                    <span className="font-grotesk text-[28px] font-bold leading-none tabular-nums text-umber-900">
                      {album.participantCount}
                    </span>
                    <span className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-umber-400">
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
                      <a
                        href={`${uploadUrl}?preview=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-1 flex-col items-center gap-2"
                      >
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper-100 text-umber-900 transition-colors group-hover:bg-paper-200">
                          <Camera size={22} aria-hidden="true" />
                        </span>
                        <span className="text-xs font-medium text-umber-700">
                          {t("media.film_guest_view")}
                        </span>
                      </a>
                    </div>
                    {/* Reveal explainer — couple-facing time-capsule card */}
                    <div className="mx-4 mb-2 mt-3 flex items-start gap-3 rounded-2xl border border-paper-200 bg-paper-50 px-4 py-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-100 text-umber-900">
                        <Lock size={14} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-umber-900">
                          {t("media.reveal_explainer_title")}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-umber-500">
                          {album.revealAt
                            ? t("media.reveal_explainer_body").replace(
                                "{{date}}",
                                formatRevealDate(album.revealAt),
                              )
                            : t("media.reveal_explainer_unset")}
                        </p>
                      </div>
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
                  <div className="px-4 pb-4">
                    <button
                      type="button"
                      disabled={coupleUploading}
                      onClick={() => coupleUploadRef.current?.click()}
                      className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-umber-900 py-4 text-base font-semibold text-paper-50 transition-colors hover:bg-umber-800 disabled:opacity-60"
                    >
                      <Upload size={18} aria-hidden="true" />
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

                {/* ── Settings list (Uber-style rows) ───────────────────── */}
                <div className="border-t border-paper-200">
                  <div className="flex items-center justify-between px-5 pb-1 pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-400">
                      {t("media.film_settings_title")}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowFilmModal(true)}
                      aria-label={t("media.film_settings_title")}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-umber-400 transition-colors hover:bg-paper-100 hover:text-umber-700"
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
                        {album.isUploadEnabled
                          ? t("media.early_close")
                          : t("media.early_close_reopen")}
                      </p>
                      {album.isUploadEnabled && (
                        <p className="mt-0.5 text-xs leading-snug text-umber-500">
                          {t("media.early_close_hint")}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={togglingUpload}
                      onClick={() => handleToggleUpload(!album.isUploadEnabled)}
                      className={`shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                        album.isUploadEnabled
                          ? "border border-paper-300 text-umber-700 hover:bg-paper-100"
                          : "bg-umber-900 text-paper-50 hover:bg-umber-800"
                      }`}
                    >
                      {album.isUploadEnabled
                        ? t("media.early_close")
                        : t("media.early_close_reopen")}
                    </button>
                  </div>
                </div>

                {/* ── Guest link ────────────────────────────────────────── */}
                {uploadUrl && guestLinkUrl && (
                  <div className="border-t border-paper-200 px-5 py-4">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-400">
                        {t("media.film_guest_link")}
                      </p>
                      <button
                        type="button"
                        onClick={openSlugEditor}
                        className="flex items-center gap-1 text-[11px] font-medium text-umber-500 transition-colors hover:text-umber-900"
                      >
                        <Pencil size={11} aria-hidden="true" />
                        {t("media.slug_label")}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 rounded-2xl bg-paper-100 py-1.5 pl-4 pr-1.5">
                      <span className="flex-1 truncate font-mono text-sm text-umber-600">
                        {guestLinkUrl.replace(/^https?:\/\//, "")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(guestLinkUrl).catch(() => {});
                          setLinkCopied(true);
                          setTimeout(() => setLinkCopied(false), 2000);
                        }}
                        className="shrink-0 rounded-xl bg-umber-900 px-4 py-2 text-xs font-semibold text-paper-50 transition-colors hover:bg-umber-800"
                      >
                        {linkCopied ? t("media.from_guests_copied") : t("media.film_copy")}
                      </button>
                    </div>
                    {editingSlug && (
                      <form
                        className="mt-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveSlug();
                        }}
                        noValidate
                      >
                        <div className="flex items-center gap-2 rounded-2xl border border-paper-300 bg-white py-1.5 pl-3 pr-1.5">
                          <span className="shrink-0 font-mono text-xs text-umber-400">
                            …/photos/
                          </span>
                          <input
                            type="text"
                            value={slugDraft}
                            onChange={(e) => setSlugDraft(e.target.value)}
                            placeholder={t("media.slug_placeholder")}
                            aria-label={t("media.slug_label")}
                            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-umber-900 placeholder-umber-400 outline-none"
                            // biome-ignore lint/a11y/noAutofocus: open-to-type UX.
                            autoFocus
                          />
                          <button
                            type="submit"
                            disabled={savingSlug}
                            className="shrink-0 rounded-xl bg-umber-900 px-3 py-1.5 text-xs font-semibold text-paper-50 transition-colors hover:bg-umber-800 disabled:opacity-50"
                          >
                            {savingSlug ? t("common.saving") : t("common.save")}
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-umber-400">
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
              <span className="absolute right-3 top-3 z-10 rounded-full border border-paper-50/25 bg-ink-900/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-paper-200 backdrop-blur">
                {t("media.dev_badge")}
              </span>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-umber-700 bg-umber-900">
                  <Film size={22} className="text-umber-400" aria-hidden="true" />
                </div>
                <h1 className="font-grotesk text-2xl font-semibold text-paper-50 sm:text-3xl">
                  {t("media.film_empty_title")}
                </h1>
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
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      <FilmModal
        open={showFilmModal}
        album={album}
        couple={couple}
        onClose={() => setShowFilmModal(false)}
        onSaved={(a) => setAlbum(a)}
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
