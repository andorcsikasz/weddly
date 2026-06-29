// Wedding Film — guest camera page. Reachable at /photos/:token.
// No auth required. Mobile-first.
//
// Camera strategy:
//   Mobile  → skip getUserMedia entirely; use <input type="file" accept="image/*">
//             WITHOUT the `capture` attribute. iOS shows a native sheet:
//             "Take Photo / Photo Library / Browse" — works in Safari AND
//             WKWebView-based in-app browsers (Instagram, WhatsApp, iMessage).
//   Desktop → getUserMedia live viewfinder; falls back to file-input on denial.
//
// States:
//   loading       — registering device / fetching album
//   not_found     — 404 or closed film
//   disabled      — is_upload_enabled = false
//   name_capture  — first visit; ask guest's name
//   viewfinder    — live camera or file-picker; shot counter visible
//   developing    — reveal_at is in the future; countdown shown
//   gallery       — reveal_at passed; grid of photos
//   limit_reached — shots_per_guest exhausted

import type { FilmAesthetic, PhotoAlbumPublic } from "@shared/types";
import { FILM_FILTERS } from "@shared/types";
import { Camera, CheckCircle, Images, QrCode } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { photoAlbumApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// ─── device / session persistence ────────────────────────────────────────────

function getDeviceId(token: string): string {
  const key = `weddly.film.${token}.device_id`;
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function getStoredName(token: string): string | null {
  const v = localStorage.getItem(`weddly.film.${token}.name`);
  return v !== null && v !== "" ? v : null;
}

function storeName(token: string, name: string): void {
  localStorage.setItem(`weddly.film.${token}.name`, name);
}

// ─── device detection ─────────────────────────────────────────────────────────

// True on phones/tablets. We skip getUserMedia on these because WKWebView
// (the engine behind every iOS in-app browser) silently blocks camera access,
// while a plain <input type="file"> always works.
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
}

// True when the page is running inside an in-app browser (Instagram, WhatsApp,
// Facebook, TikTok…). Even <input type="file"> can misbehave there on iOS, so
// we show a banner suggesting the user open in Safari.
function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Instagram|FBAN|FBAV|Twitter|Line\/|Musical\.ly|micromessenger/i.test(ua);
}

// ─── page states ─────────────────────────────────────────────────────────────

type PageState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "disabled" }
  | { kind: "name_capture"; album: PhotoAlbumPublic }
  | { kind: "viewfinder"; album: PhotoAlbumPublic; guestName: string | null; shotCount: number }
  | { kind: "developing"; album: PhotoAlbumPublic }
  | { kind: "gallery"; album: PhotoAlbumPublic; uploads: unknown[] }
  | { kind: "limit_reached"; album: PhotoAlbumPublic };

// ─── CSS filter helper ────────────────────────────────────────────────────────

function filterStyle(aesthetic: FilmAesthetic): string {
  return FILM_FILTERS[aesthetic] ?? "none";
}

function formatFilmCountdown(ms: number): string {
  if (ms <= 0) return "0m";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── sub-components ──────────────────────────────────────────────────────────

function FilmShell({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div
      className={`min-h-dvh flex flex-col items-center justify-center px-4 py-10 ${
        dark ? "bg-ink-900 text-paper-50" : "bg-paper-50"
      }`}
    >
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function FilmHeading({ album }: { album: PhotoAlbumPublic }) {
  return (
    <div className="text-center mb-6">
      <p className="font-serif text-2xl text-ink-900">{album.displayName}</p>
      {album.title && <p className="mt-0.5 text-sm text-ink-500">{album.title}</p>}
    </div>
  );
}

function ShotCounter({ used, max }: { used: number; max: number }) {
  const current = used + 1;
  return (
    <div className="flex items-center justify-center gap-3">
      <span className="font-grotesk text-base tabular-nums text-paper-400/60">
        {current - 1 > 0 ? current - 1 : ""}
      </span>
      <span className="font-grotesk text-xl font-bold tabular-nums text-paper-50">{current}</span>
      <span className="font-grotesk text-base tabular-nums text-paper-400/60">
        {current < max ? current + 1 : ""}
      </span>
    </div>
  );
}

// Banner shown when the page is loaded inside an in-app browser on iOS.
// <input type="file"> is unreliable in these contexts; Safari always works.
function InAppBrowserBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium mb-1">Open in Safari for best results</p>
      <p className="text-amber-700 text-xs mb-2">
        In-app browsers can block camera access. Tap the share icon and choose "Open in Safari".
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-xs underline text-amber-700"
      >
        Got it
      </button>
    </div>
  );
}

function FilmBar({ album, token }: { album: PhotoAlbumPublic; token: string }) {
  const remaining = album.eventEndsAt ? Math.max(0, album.eventEndsAt - Date.now()) : null;
  const countdown = remaining !== null ? formatFilmCountdown(remaining) : null;

  return (
    <div className="flex items-center gap-3 bg-black/80 px-4 py-3 backdrop-blur-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-paper-50">
          {album.title || album.displayName}
        </p>
        {countdown && <p className="text-[11px] text-paper-400">{countdown} left</p>}
      </div>
      <a
        href={`/photos/${token}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10"
        aria-label="Share QR"
      >
        <QrCode size={14} className="text-paper-300" aria-hidden="true" />
      </a>
    </div>
  );
}

// ─── desktop camera capture hook ─────────────────────────────────────────────
// Only used on non-mobile devices where getUserMedia is reliable.

function useDesktopCamera(aesthetic: FilmAesthetic) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hasStream, setHasStream] = useState<boolean | null>(null);

  useEffect(() => {
    const supported =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    if (!supported) {
      setHasStream(false);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        setHasStream(true);
      })
      .catch(() => setHasStream(false));
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = useCallback((): Promise<File | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return resolve(null);
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.filter = filterStyle(aesthetic);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], "shot.jpg", { type: "image/jpeg" }) : null),
        "image/jpeg",
        0.82,
      );
    });
  }, [aesthetic]);

  return { videoRef, canvasRef, hasStream, capture };
}

// ─── viewfinder component ─────────────────────────────────────────────────────

function Viewfinder({
  album,
  guestName,
  shotCount,
  token,
  onShotTaken,
  onLimitReached,
}: {
  album: PhotoAlbumPublic;
  guestName: string | null;
  shotCount: number;
  token: string;
  onShotTaken: (newCount: number) => void;
  onLimitReached: () => void;
}) {
  const { t } = useT();
  const mobile = isMobileDevice();
  const inApp = isInAppBrowser();
  const { videoRef, canvasRef, hasStream, capture } = useDesktopCamera(album.filmAesthetic);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPhotoUrl, setLastPhotoUrl] = useState<string | null>(null);
  const deviceId = getDeviceId(token);

  async function shoot(file: File) {
    if (uploading) return;
    setError(null);
    setUploading(true);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    const previewUrl = URL.createObjectURL(file);
    try {
      const result = await photoAlbumApi.upload(token, file, {
        deviceId,
        guestName: guestName ?? undefined,
        filterApplied: album.filmAesthetic,
      });
      setLastPhotoUrl(previewUrl);
      if (album.shotsPerGuest !== null && result.shotCount >= album.shotsPerGuest) {
        onLimitReached();
      } else {
        onShotTaken(result.shotCount);
      }
    } catch (err: unknown) {
      const detail = (err as { detail?: unknown })?.detail;
      const code = (detail as { code?: string } | undefined)?.code;
      if (code === "shot_limit") {
        onLimitReached();
        return;
      }
      const status = (err as { status?: number })?.status;
      if (status === 413) setError(t("photos.error_too_large"));
      else if (status === 400) setError(t("photos.error_bad_type"));
      else setError(t("photos.error_generic"));
    } finally {
      setUploading(false);
    }
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  async function handleShutterClick() {
    if (!mobile && hasStream) {
      const file = await capture();
      if (file) void shoot(file);
    } else {
      openPicker();
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void shoot(file);
    e.target.value = "";
  }

  const cssFilter = filterStyle(album.filmAesthetic);
  const max = album.shotsPerGuest ?? 0;

  // Desktop with live viewfinder
  const showLiveViewfinder = !mobile && hasStream === true;
  // Desktop without camera permission
  const showDesktopFallback = !mobile && hasStream === false;

  return (
    <div className="flex min-h-dvh flex-col bg-black">
      <FilmBar album={album} token={token} />

      {/* Viewfinder area — fills available space */}
      <div className="relative flex-1" style={{ minHeight: "50vh" }}>
        {/* ── MOBILE: dark placeholder with last photo ───────────────── */}
        {mobile && (
          <button
            type="button"
            disabled={uploading}
            onClick={openPicker}
            className="absolute inset-0 flex w-full flex-col items-center justify-center disabled:opacity-50"
            aria-label={t("photos.choose_photo")}
          >
            {lastPhotoUrl ? (
              <img
                src={lastPhotoUrl}
                alt=""
                className="h-full w-full object-cover"
                style={{ filter: filterStyle(album.filmAesthetic) }}
                aria-hidden="true"
              />
            ) : (
              <Camera className="h-14 w-14 text-paper-600" aria-hidden="true" />
            )}
          </button>
        )}

        {/* ── DESKTOP: live viewfinder ───────────────────────────────── */}
        {showLiveViewfinder && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: cssFilter }}
          />
        )}

        {/* ── DESKTOP: fallback when getUserMedia denied ─────────────── */}
        {showDesktopFallback && (
          <button
            type="button"
            onClick={openPicker}
            className="absolute inset-0 flex w-full flex-col items-center justify-center gap-3 bg-umber-950 text-paper-400"
          >
            <Camera className="h-12 w-12" aria-hidden="true" />
            <p className="text-sm">{t("photos.choose_photo")}</p>
          </button>
        )}

        {!mobile && <canvas ref={canvasRef} className="hidden" />}

        {/* Flash overlay */}
        <div
          className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-100"
          style={{ opacity: flash ? 0.9 : 0 }}
        />

        {/* In-app browser warning */}
        {mobile && inApp && (
          <div className="absolute left-3 right-3 top-3">
            <InAppBrowserBanner />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="absolute left-4 right-4 top-4">
            <p className="rounded-xl bg-red-900/80 px-3 py-2 text-center text-xs text-red-300 backdrop-blur-sm">
              {error}
            </p>
          </div>
        )}

        {/* Last photo thumbnail — bottom right */}
        {lastPhotoUrl && (
          <div className="absolute bottom-4 right-4 h-12 w-12 overflow-hidden rounded-xl border border-white/20 shadow-lg">
            <img
              src={lastPhotoUrl}
              alt="Last shot"
              className="h-full w-full object-cover"
              style={{ filter: filterStyle(album.filmAesthetic) }}
            />
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex flex-col items-center gap-4 pb-10 pt-6">
        {/* Shot counter */}
        {max > 0 && <ShotCounter used={shotCount} max={max} />}

        {/* Shutter row */}
        <div className="relative flex w-full items-center justify-center">
          {/* Desktop shutter (also shown as the primary tap on mobile) */}
          <button
            type="button"
            disabled={uploading}
            onClick={handleShutterClick}
            aria-label={t("photos.choose_photo")}
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-paper-200/40 bg-white transition-transform active:scale-90 disabled:opacity-50"
          >
            {uploading && (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-300 border-t-ink-900" />
            )}
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        {...(!mobile ? { capture: "environment" as const } : {})}
        className="sr-only"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ─── countdown component ──────────────────────────────────────────────────────

function Countdown({ revealsAt, onRevealed }: { revealsAt: number; onRevealed: () => void }) {
  const [remaining, setRemaining] = useState(Math.max(0, revealsAt - Date.now()));

  useEffect(() => {
    if (remaining <= 0) {
      onRevealed();
      return;
    }
    const id = setInterval(() => {
      const r = Math.max(0, revealsAt - Date.now());
      setRemaining(r);
      if (r <= 0) onRevealed();
    }, 1000);
    return () => clearInterval(id);
  }, [revealsAt, onRevealed, remaining]);

  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);

  return (
    <div className="text-center font-mono text-4xl text-paper-50 tracking-widest">
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </div>
  );
}

// ─── gallery component ────────────────────────────────────────────────────────

interface UploadItem {
  id: number;
  guestName: string | null;
  fileUrl: string;
  filterApplied: FilmAesthetic | null;
}

function Gallery({ uploads, aesthetic }: { uploads: UploadItem[]; aesthetic: FilmAesthetic }) {
  return (
    <div className="columns-2 gap-2">
      {uploads.map((u) => (
        <div key={u.id} className="relative mb-2 overflow-hidden rounded-lg break-inside-avoid">
          <img
            src={u.fileUrl}
            alt=""
            loading="lazy"
            className="w-full object-cover"
            style={{ filter: filterStyle(u.filterApplied ?? aesthetic) }}
          />
          {u.guestName && (
            <span className="absolute bottom-1 left-1 text-[10px] text-white bg-black/50 rounded px-1 py-0.5">
              {u.guestName}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function GuestPhotoPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useT();
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [nameInput, setNameInput] = useState("");

  useEffect(() => {
    if (!token) {
      setState({ kind: "not_found" });
      return;
    }
    const deviceId = getDeviceId(token);
    const storedName = getStoredName(token);

    photoAlbumApi
      .registerDevice(token, deviceId, storedName)
      .then(({ album, shotCount }) => {
        if (!album.isUploadEnabled) {
          setState({ kind: "disabled" });
          return;
        }
        if (album.shotsPerGuest !== null && shotCount >= album.shotsPerGuest) {
          setState({ kind: "limit_reached", album });
          return;
        }
        if (album.eventEndsAt !== null && Date.now() > album.eventEndsAt) {
          setState({ kind: "disabled" });
          return;
        }
        if (album.revealAt !== null && Date.now() < album.revealAt && shotCount > 0) {
          setState({ kind: "developing", album });
          return;
        }
        if (storedName === null) {
          setState({ kind: "name_capture", album });
        } else {
          setState({ kind: "viewfinder", album, guestName: storedName, shotCount });
        }
      })
      .catch((err: { status?: number }) => {
        const detail = (err as { detail?: { code?: string } })?.detail;
        if (detail?.code === "guest_cap_reached") setState({ kind: "not_found" });
        else setState({ kind: "not_found" });
      });
  }, [token]);

  function handleNameSubmit(name: string | null) {
    if (state.kind !== "name_capture") return;
    const { album } = state;
    if (name) storeName(token, name);
    else storeName(token, "");
    setState({ kind: "viewfinder", album, guestName: name, shotCount: 0 });
  }

  function handleRevealed() {
    if (state.kind !== "developing") return;
    const { album } = state;
    photoAlbumApi
      .getPublicPhotos(token)
      .then((res) => {
        if (!res.locked) setState({ kind: "gallery", album, uploads: res.uploads });
      })
      .catch(() => {});
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (state.kind === "loading") {
    return (
      <FilmShell>
        <p className="text-center text-ink-400 text-sm">{t("photos.loading")}</p>
      </FilmShell>
    );
  }

  if (state.kind === "not_found" || state.kind === "disabled") {
    const isClosed = state.kind === "disabled";
    return (
      <FilmShell>
        <div className="text-center">
          <p className="font-serif text-xl text-ink-900 mb-2">
            {isClosed ? t("photos.uploads_disabled") : t("photos.not_found")}
          </p>
          <p className="text-sm text-ink-500">
            {isClosed ? t("photos.uploads_disabled_sub") : t("photos.not_found_sub")}
          </p>
        </div>
      </FilmShell>
    );
  }

  if (state.kind === "name_capture") {
    return (
      <FilmShell dark>
        <div className="mb-8 text-center">
          <p className="font-serif text-3xl text-paper-50">{state.album.displayName}</p>
          {state.album.title && (
            <p className="mt-1.5 text-sm text-paper-500">{state.album.title}</p>
          )}
        </div>
        <div className="rounded-3xl border border-ink-700/70 bg-ink-800 p-6 shadow-xl">
          <h1 className="mb-1.5 font-grotesk text-xl font-semibold text-paper-50">
            {t("photos.name_heading")}
          </h1>
          <p className="mb-5 text-sm text-paper-400">{t("photos.name_sub")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleNameSubmit(nameInput.trim() || null);
            }}
          >
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t("photos.name_placeholder")}
              autoFocus
              className="mb-3 w-full rounded-2xl border border-ink-600 bg-ink-900 px-4 py-3.5 text-base text-paper-50 placeholder-paper-500 transition-colors focus:border-paper-300 focus:outline-none"
            />
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => handleNameSubmit(null)}
                className="flex-1 rounded-2xl border border-ink-600 py-3.5 text-sm font-medium text-paper-300 transition-colors hover:bg-ink-700/60"
              >
                {t("photos.name_skip")}
              </button>
              <button
                type="submit"
                className="flex-1 rounded-2xl bg-paper-50 py-3.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-white"
              >
                {t("photos.name_continue")}
              </button>
            </div>
          </form>
        </div>
      </FilmShell>
    );
  }

  if (state.kind === "developing") {
    return (
      <FilmShell dark>
        <FilmHeading album={state.album} />
        <p className="text-center text-sm text-umber-300 mb-8">Your photos are developing…</p>
        {state.album.revealAt && (
          <Countdown revealsAt={state.album.revealAt} onRevealed={handleRevealed} />
        )}
      </FilmShell>
    );
  }

  if (state.kind === "gallery") {
    const uploads = state.uploads as UploadItem[];
    return (
      <FilmShell>
        <FilmHeading album={state.album} />
        <div className="flex items-center gap-2 mb-4">
          <Images className="w-4 h-4 text-ink-400" />
          <span className="text-sm text-ink-500">{uploads.length} photos</span>
        </div>
        <Gallery uploads={uploads} aesthetic={state.album.filmAesthetic} />
      </FilmShell>
    );
  }

  if (state.kind === "limit_reached") {
    return (
      <FilmShell>
        <FilmHeading album={state.album} />
        <div className="card text-center">
          <CheckCircle className="w-10 h-10 text-sage-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-ink-900 mb-1">{t("photos.limit_heading")}</h1>
          <p className="text-sm text-ink-500">
            {t("photos.limit_sub").replace("{{n}}", String(state.album.shotsPerGuest ?? ""))}
          </p>
        </div>
      </FilmShell>
    );
  }

  // viewfinder
  const { album, guestName, shotCount } = state;
  return (
    <Viewfinder
      album={album}
      guestName={guestName}
      shotCount={shotCount}
      token={token}
      onShotTaken={(count) =>
        setState((s) => (s.kind === "viewfinder" ? { ...s, shotCount: count } : s))
      }
      onLimitReached={() => setState({ kind: "limit_reached", album })}
    />
  );
}
