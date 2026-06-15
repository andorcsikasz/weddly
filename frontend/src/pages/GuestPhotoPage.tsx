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
import { Camera, CheckCircle, Images } from "lucide-react";
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
      <p className="font-serif italic text-2xl text-ink-900">{album.displayName}</p>
      {album.title && <p className="mt-0.5 text-sm text-ink-500">{album.title}</p>}
    </div>
  );
}

function ShotCounter({ used, max }: { used: number; max: number }) {
  const remaining = max - used;
  return (
    <div className="flex items-center justify-center gap-1 mb-4">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`block h-1.5 w-4 rounded-full transition-colors ${
            i < used ? "bg-ink-300" : "bg-ink-800"
          }`}
        />
      ))}
      <span className="ml-2 text-xs text-ink-500">{remaining} left</span>
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
  const deviceId = getDeviceId(token);

  async function shoot(file: File) {
    if (uploading) return;
    setError(null);
    setUploading(true);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    try {
      const result = await photoAlbumApi.upload(token, file, {
        deviceId,
        guestName: guestName ?? undefined,
        filterApplied: album.filmAesthetic,
      });
      if (album.shotsPerGuest !== null && result.shotCount >= album.shotsPerGuest) {
        onLimitReached();
      } else {
        onShotTaken(result.shotCount);
      }
    } catch (err: unknown) {
      const detail = (err as { detail?: unknown })?.detail;
      const code = (detail as { code?: string } | undefined)?.code;
      if (code === "shot_limit") { onLimitReached(); return; }
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
    <div>
      {/* In-app browser warning — mobile only */}
      {mobile && inApp && <InAppBrowserBanner />}

      <div
        className="relative w-full bg-ink-900 rounded-2xl overflow-hidden"
        style={{ aspectRatio: "3/4" }}
      >
        {/* ── MOBILE: tap-to-pick UI (no getUserMedia) ─────────────────────── */}
        {mobile && (
          <button
            type="button"
            disabled={uploading}
            onClick={openPicker}
            className="absolute inset-0 w-full flex flex-col items-center justify-center gap-4 text-paper-300 disabled:opacity-50"
            aria-label={t("photos.choose_photo")}
          >
            <Camera className="w-14 h-14 text-paper-300" />
            <span className="text-sm text-paper-400">{t("photos.choose_photo")}</span>
          </button>
        )}

        {/* ── DESKTOP: live viewfinder ─────────────────────────────────────── */}
        {showLiveViewfinder && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: cssFilter }}
          />
        )}

        {/* ── DESKTOP: fallback when getUserMedia denied ────────────────────── */}
        {showDesktopFallback && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-ink-800 text-paper-300 cursor-pointer"
            onClick={openPicker}
          >
            <Camera className="w-12 h-12 mb-3 text-paper-400" />
            <p className="text-sm">{t("photos.choose_photo")}</p>
          </div>
        )}

        {/* Hidden canvas for desktop filter-baked capture */}
        {!mobile && <canvas ref={canvasRef} className="hidden" />}

        {/* Flash overlay */}
        <div
          className="absolute inset-0 bg-white pointer-events-none transition-opacity duration-100"
          style={{ opacity: flash ? 0.9 : 0 }}
        />

        {/* Shot counter overlay — top */}
        {max > 0 && (
          <div className="absolute top-3 left-0 right-0 flex justify-center px-4">
            <div className="bg-black/50 rounded-full px-3 py-1 backdrop-blur-sm">
              <ShotCounter used={shotCount} max={max} />
            </div>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute top-14 left-4 right-4">
            <p className="text-xs text-red-300 bg-red-900/80 rounded-lg px-3 py-2 text-center backdrop-blur-sm">
              {error}
            </p>
          </div>
        )}

        {/* Shutter button — shown on desktop only; mobile uses the whole-area tap */}
        {!mobile && (
          <div className="absolute bottom-5 left-0 right-0 flex justify-center">
            <button
              type="button"
              disabled={uploading}
              onClick={handleShutterClick}
              aria-label={t("photos.choose_photo")}
              className={`w-16 h-16 rounded-full border-4 border-white bg-white/20 backdrop-blur-sm transition-transform active:scale-90 ${
                uploading ? "opacity-50" : ""
              }`}
            >
              <span className="block w-10 h-10 mx-auto rounded-full bg-white" />
            </button>
          </div>
        )}
      </div>

      {/* Mobile: large CTA button below the card (easier to tap than a shutter overlay) */}
      {mobile && (
        <button
          type="button"
          disabled={uploading}
          onClick={openPicker}
          className={`mt-4 w-full rounded-2xl bg-ink-900 py-4 text-base font-semibold text-paper-50 transition-opacity active:opacity-70 ${
            uploading ? "opacity-50" : ""
          }`}
        >
          {uploading ? "Uploading…" : t("photos.choose_photo")}
        </button>
      )}

      {/*
        File input — NO `capture` attribute on mobile.
        Without `capture`, iOS Safari shows its native action sheet:
          "Take Photo or Video" / "Photo Library" / "Browse"
        This works in Safari AND most WKWebView-based in-app browsers.
        Desktop keeps `capture="environment"` to skip the OS file picker.
      */}
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
    if (remaining <= 0) { onRevealed(); return; }
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
    if (!token) { setState({ kind: "not_found" }); return; }
    const deviceId = getDeviceId(token);
    const storedName = getStoredName(token);

    photoAlbumApi
      .registerDevice(token, deviceId, storedName)
      .then(({ album, shotCount }) => {
        if (!album.isUploadEnabled) { setState({ kind: "disabled" }); return; }
        if (album.shotsPerGuest !== null && shotCount >= album.shotsPerGuest) {
          setState({ kind: "limit_reached", album }); return;
        }
        if (album.eventEndsAt !== null && Date.now() > album.eventEndsAt) {
          setState({ kind: "disabled" }); return;
        }
        if (album.revealAt !== null && Date.now() < album.revealAt && shotCount > 0) {
          setState({ kind: "developing", album }); return;
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
          <p className="font-serif italic text-xl text-ink-900 mb-2">
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
      <FilmShell>
        <FilmHeading album={state.album} />
        <div className="card">
          <h1 className="text-lg font-semibold text-ink-900 mb-1">{t("photos.name_heading")}</h1>
          <p className="text-sm text-ink-500 mb-4">{t("photos.name_sub")}</p>
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
              className="w-full border border-paper-300 rounded-xl px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-blush-500 mb-3"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleNameSubmit(null)}
                className="btn-ghost flex-1 text-sm"
              >
                {t("photos.name_skip")}
              </button>
              <button type="submit" className="btn-primary flex-1 text-sm">
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
    <FilmShell>
      <div className="flex items-center justify-between mb-4">
        <p className="font-serif italic text-lg text-ink-900">{album.displayName}</p>
        {album.filmAesthetic !== "natural" && (
          <span className="text-xs text-ink-400 capitalize bg-paper-100 rounded-full px-2 py-0.5">
            {album.filmAesthetic}
          </span>
        )}
      </div>

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

      {guestName && (
        <p className="text-center text-xs text-ink-400 mt-3">Shooting as {guestName}</p>
      )}
    </FilmShell>
  );
}
