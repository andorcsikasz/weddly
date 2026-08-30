// Wedding Film — guest camera page. Reachable at /photos/:token.
// No auth required. Mobile-first.
//
// Camera strategy:
//   The camera IS the page. On every device we ask for getUserMedia straight
//   away and the shutter takes the shot in one tap — no native "Take Photo /
//   Photo Library" sheet in between, which used to cost a guest two taps and a
//   decision per photo. Uploading an existing picture stays reachable, but as
//   the small bottom-left affordance it deserves rather than the default path.
//   When getUserMedia is refused or absent (WKWebView in-app browsers block it
//   silently) we fall back to <input type="file"> as the shutter, which always
//   works.
//
// States:
//   loading       — registering device / fetching album
//   not_found     — 404 or closed film
//   disabled      — is_upload_enabled = false
//   landing       — first-ever visit; cover photo, one "Open camera" CTA
//   name_capture  — first visit; ask guest's name
//   viewfinder    — live camera or file-picker; shot counter visible
//   developing    — reveal_at is in the future; countdown shown
//   gallery       — reveal_at passed; grid of photos
//   limit_reached — shots_per_guest exhausted

import type { FilmAesthetic, FilmUpload, PhotoAlbumPublic } from "@shared/types";
import { FILM_FILTERS } from "@shared/types";
import { Camera, Check, ImagePlus, RotateCcw, Share2, SwitchCamera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { photoAlbumApi } from "../lib/endpoints";
import { intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

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

function getStoredEmail(token: string): string | null {
  const v = localStorage.getItem(`weddly.film.${token}.email`);
  return v !== null && v !== "" ? v : null;
}

function storeEmail(token: string, email: string): void {
  localStorage.setItem(`weddly.film.${token}.email`, email);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HEIF_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function isHeifFile(file: File): boolean {
  return HEIF_MIME_TYPES.has(file.type.toLowerCase()) || /\.hei[cf]$/i.test(file.name);
}

// ─── device detection ─────────────────────────────────────────────────────────

// True on phones/tablets. Only decides chrome (which affordances make sense),
// never whether we try the live camera — we always do.
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
}

// True when the page is running inside an in-app browser (Instagram, WhatsApp,
// Facebook, TikTok…). Those block getUserMedia, so the live viewfinder will
// fail there and we point the guest at Safari.
function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Instagram|FBAN|FBAV|Twitter|Line\/|Musical\.ly|micromessenger/i.test(ua);
}

// ─── page states ─────────────────────────────────────────────────────────────

type PageState =
  | { kind: "loading" }
  | { kind: "not_found" }
  // Register-device is IP rate-limited, and a whole wedding shares one venue
  // wifi (so one public IP). Telling that guest their link is dead would be a
  // lie they can't recover from — "try again in a moment" is the truth.
  | { kind: "busy" }
  | { kind: "preview_unavailable" }
  | { kind: "disabled" }
  // First-ever visit: one screen, one CTA, before any form. Returning guests
  // (storedName !== null) skip straight past it into name_capture/viewfinder.
  | { kind: "landing"; album: PhotoAlbumPublic }
  | { kind: "name_capture"; album: PhotoAlbumPublic }
  | { kind: "returning_welcome"; album: PhotoAlbumPublic; guestName: string; shotCount: number }
  | { kind: "viewfinder"; album: PhotoAlbumPublic; guestName: string | null; shotCount: number }
  | { kind: "developing"; album: PhotoAlbumPublic }
  | { kind: "gallery"; album: PhotoAlbumPublic; uploads: FilmUpload[] }
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

type TFn = (path: string, vars?: Record<string, string | number>) => string;

// The app locale, not the device's. A Hungarian guest reading a Hungarian page
// on an en-US phone was getting "13 September 2026" mid-sentence.
function formatRevealDate(value: string | number, locale: Locale): string {
  return new Date(value).toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Date-based subtitle shown to guests instead of the couple's internal album
// title (which can leak working names like "Test").
function guestSubtitle(album: PhotoAlbumPublic, t: TFn, locale: Locale): string {
  if (album.weddingDate) {
    return t("photos.guest_subtitle").replace(
      "{{date}}",
      formatRevealDate(album.weddingDate, locale),
    );
  }
  return t("photos.guest_subtitle_plain");
}

// ─── sub-components ──────────────────────────────────────────────────────────

// Every non-camera screen is the same black sheet: one big bold line, one quiet
// line under it, one action. No cards, no step chips, no footnotes.
function FilmSheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col justify-center bg-ink-950 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-16 text-paper-50">
      <div className="mx-auto w-full max-w-sm">{children}</div>
    </div>
  );
}

function SheetKicker({ album }: { album: PhotoAlbumPublic }) {
  const { t, locale } = useT();
  return (
    <p className="mb-8 font-grotesk text-[11px] font-semibold uppercase tracking-[0.22em] text-paper-50/40">
      {album.displayName} · {guestSubtitle(album, t, locale)}
    </p>
  );
}

function SheetTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-grotesk text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-paper-50">
      {children}
    </h1>
  );
}

function SheetBody({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[15px] leading-relaxed text-paper-50/55">{children}</p>;
}

const PRIMARY_BTN =
  "w-full rounded-2xl bg-paper-50 py-4 font-grotesk text-[16px] font-bold text-ink-950 transition-transform active:scale-[0.98] disabled:opacity-40";
const GHOST_BTN =
  "w-full rounded-2xl border border-paper-50/20 py-4 font-grotesk text-[16px] font-semibold text-paper-50/80 transition-colors hover:bg-paper-50/5";

// Slim sticky bar shown when the couple opens the guest screens with ?preview=1,
// so they can tell at a glance they are looking at the guest-facing view.
function PreviewBanner() {
  const { t } = useT();
  return (
    <div
      role="status"
      className="pointer-events-none fixed left-0 right-0 top-0 z-50 flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <span className="rounded-full border border-paper-50/30 bg-umber-700 px-3 py-1.5 text-[11px] font-grotesk font-bold uppercase tracking-[0.1em] text-paper-50 shadow-lg">
        {t("photos.preview_banner")}
      </span>
    </div>
  );
}

// ─── live camera hook ─────────────────────────────────────────────────────────
// Runs on every device. `blocked` covers both a hard refusal and a browser that
// has no getUserMedia at all — the caller falls back to the file picker either
// way, so the two need no distinction.
//
// "live" means the video is PAINTING, not merely that getUserMedia resolved.
// Between those two moments the element still reports videoWidth 0, so a shutter
// tap would have captured a blank frame; the guest would have sent a black
// rectangle and had no idea. A stream that never delivers a frame within
// FIRST_FRAME_TIMEOUT_MS is treated as blocked, which routes the guest to the
// file picker instead of leaving them on a spinner forever.

const FIRST_FRAME_TIMEOUT_MS = 5000;

type CameraStatus = "starting" | "live" | "blocked" | "preview";
type Facing = "environment" | "user";

function useCamera(facing: Facing, enabled = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>(enabled ? "starting" : "preview");

  useEffect(() => {
    if (!enabled) {
      setStatus("preview");
      return;
    }
    const supported =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    if (!supported) {
      setStatus("blocked");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus((s) => (s === "live" ? s : "starting"));

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        // Swap only once the replacement is in hand, so a failed flip leaves
        // the guest looking at the camera they already had.
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play().catch(() => {});
        const onFrame = () => {
          if (!cancelled && video.videoWidth > 0) setStatus("live");
        };
        video.addEventListener("loadedmetadata", onFrame);
        video.addEventListener("canplay", onFrame);
        onFrame();
        timer = setTimeout(() => {
          if (!cancelled && video.videoWidth === 0) setStatus("blocked");
        }, FIRST_FRAME_TIMEOUT_MS);
      })
      .catch(() => {
        if (!cancelled) setStatus((s) => (s === "live" ? s : "blocked"));
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, facing]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  /** Grab the current frame as a JPEG. The aesthetic is deliberately NOT baked
   *  in: it is stored as metadata and re-applied at display time, so painting
   *  it here would apply it twice. `mirror` matches the flipped selfie preview
   *  so the saved shot is what the guest actually framed. */
  const capture = useCallback((mirror: boolean): Promise<File | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return resolve(null);
      // No frame yet — better to do nothing than to send a black rectangle.
      if (video.videoWidth === 0 || video.videoHeight === 0) return resolve(null);
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      if (mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], "shot.jpg", { type: "image/jpeg" }) : null),
        "image/jpeg",
        0.9,
      );
    });
  }, []);

  return { videoRef, canvasRef, status, capture };
}

// ─── upload queue ─────────────────────────────────────────────────────────────
// Capture and upload are deliberately decoupled: a shot is captured instantly
// (a canvas snapshot, no network) and handed to a background queue, so a slow
// venue wifi never blocks the shutter — the whole point of "continuous
// shooting". The queue uploads one item at a time (photo ordering, and the
// backend's own per-device rate bucket, both want that), retries a transient
// failure with backoff, and keeps trying once the browser's `online` event
// fires again for anything that gave up. A genuinely bad file (HEIC, over
// size, the shot cap) fails once and never retries.

const MAX_UPLOAD_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = [1200, 3000, 6000];
// Hold the shutter this long before it starts firing repeatedly.
const BURST_HOLD_MS = 320;
const BURST_INTERVAL_MS = 450;
const QUEUE_DISPLAY_MAX = 4;
const QUEUE_RETAIN_MAX = 20;

interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  status: "queued" | "uploading" | "retrying" | "failed" | "done";
  attempts: number;
  /** A network blip or a full rate bucket is worth retrying; a rejected file
   *  or a full shot cap never will be, no matter how many times it's tried. */
  retryable: boolean;
  errorMessage?: string;
}

// ─── rotating capture prompts (dev-note §4) ──────────────────────────────────
// Content is a fixed curated set, picked and rotated entirely client-side —
// the couple only controls the on/off switch (`album.promptsEnabled`). Kept
// client-side on purpose: it respects the GUEST's own locale via useT, which
// the backend has no way to know for an anonymous visitor.

const PROMPT_KEYS = [
  "photos.prompt_1",
  "photos.prompt_2",
  "photos.prompt_3",
  "photos.prompt_4",
  "photos.prompt_5",
  "photos.prompt_6",
  "photos.prompt_7",
  "photos.prompt_8",
] as const;

const PROMPT_ROTATE_MS = 8000;

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** Cycles through a shuffled pass of every prompt before reshuffling, so nine
 *  guests in a row never see the same one first and no prompt repeats twice
 *  running. Returns null when prompts are off, which callers render nothing for. */
function useRotatingPrompt(enabled: boolean): string | null {
  const { t } = useT();
  const orderRef = useRef<string[]>(shuffled(PROMPT_KEYS));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = i + 1;
        if (next < orderRef.current.length) return next;
        orderRef.current = shuffled(PROMPT_KEYS);
        return 0;
      });
    }, PROMPT_ROTATE_MS);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;
  return t(orderRef.current[index] ?? PROMPT_KEYS[0]);
}

// ─── viewfinder ───────────────────────────────────────────────────────────────

function Viewfinder({
  album,
  guestName,
  shotCount,
  token,
  preview,
  onShotTaken,
  onLimitReached,
}: {
  album: PhotoAlbumPublic;
  guestName: string | null;
  shotCount: number;
  token: string;
  preview: boolean;
  onShotTaken: (newCount: number) => void;
  onLimitReached: () => void;
}) {
  const { t, locale } = useT();
  const mobile = isMobileDevice();
  const inApp = isInAppBrowser();
  const promptText = useRotatingPrompt(album.promptsEnabled && !preview);
  const [facing, setFacing] = useState<Facing>("environment");
  // Host preview must not even request camera permission. It renders the same
  // chrome with a clearly marked, inert viewfinder instead.
  const { videoRef, canvasRef, status, capture } = useCamera(facing, !preview);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The queue's CONTENTS live in a ref, not state — every mutation is
  // synchronous (append, status flip, drop) and `bump()` is the one signal
  // that tells React to re-render off the ref's current values. This sidesteps
  // stale closures in the async upload loop that a plain useState queue would
  // otherwise hit.
  const queueRef = useRef<QueueItem[]>([]);
  const [, setQueueTick] = useState(0);
  const unmountedRef = useRef(false);
  const bump = useCallback(() => {
    if (!unmountedRef.current) setQueueTick((v) => v + 1);
  }, []);
  const processingRef = useRef(false);
  // Set once a successful upload reports the guest is at their cap, so the
  // queue loop and any in-progress burst stop reaching for a device that's
  // about to be swapped out for the limit_reached screen.
  const limitReachedRef = useRef(false);
  // Full-screen thank-you shown once, on the guest's very first-ever shot —
  // it explains when photos surface and offers to invite others. Every shot
  // after that is a quiet auto-dismissing toast instead, so shooting stays
  // continuous: no tap is needed to get back to the viewfinder.
  const [sent, setSent] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [toastCount, setToastCount] = useState<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceId = preview ? "" : getDeviceId(token);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (toastTimer.current) clearTimeout(toastTimer.current);
      for (const item of queueRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  function shareInvite() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: album.displayName, url }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(url)}`, "_blank", "noopener");
    }
  }

  const live = status === "live";
  const blocked = status === "blocked";
  const cssFilter = filterStyle(album.filmAesthetic);
  const max = album.shotsPerGuest ?? 0;
  const pendingCount = queueRef.current.filter(
    (i) => i.status === "queued" || i.status === "uploading" || i.status === "retrying",
  ).length;

  function handleUploadSuccess(newShotCount: number) {
    if (album.shotsPerGuest !== null && newShotCount >= album.shotsPerGuest) {
      limitReachedRef.current = true;
      onLimitReached();
      return;
    }
    onShotTaken(newShotCount);
    if (newShotCount === 1) {
      setSentCount(newShotCount);
      setSent(true);
    } else {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToastCount(newShotCount);
      toastTimer.current = setTimeout(() => setToastCount(null), 1600);
    }
  }

  /** Resolves once the item is settled one way or another: done, waiting out
   *  a retry backoff (re-queued for the next loop pass), or permanently
   *  failed. Never throws — every branch of `photoAlbumApi.upload` rejecting
   *  is handled here. */
  async function uploadOne(item: QueueItem) {
    try {
      const result = await photoAlbumApi.upload(token, item.file, {
        deviceId,
        guestName: guestName ?? undefined,
        filterApplied: album.filmAesthetic,
        preview,
      });
      item.status = "done";
      bump();
      handleUploadSuccess(result.shotCount);
    } catch (err: unknown) {
      const httpStatus =
        typeof (err as { status?: unknown })?.status === "number"
          ? (err as { status: number }).status
          : null;
      const code = (err as { detail?: { code?: string } })?.detail?.code;

      if (code === "shot_limit") {
        item.status = "failed";
        item.retryable = false;
        bump();
        // Nothing else already queued behind this guest's cap can succeed
        // either — fail them now instead of burning a request each to find out.
        for (const other of queueRef.current) {
          if (other.status === "queued") {
            other.status = "failed";
            other.retryable = false;
          }
        }
        limitReachedRef.current = true;
        bump();
        onLimitReached();
        return;
      }
      if (code === "heic_not_supported") {
        item.status = "failed";
        item.retryable = false;
        item.errorMessage = t("photos.error_heic");
        bump();
        return;
      }
      if (httpStatus === 413) {
        item.status = "failed";
        item.retryable = false;
        item.errorMessage = t("photos.error_too_large");
        bump();
        return;
      }
      if (httpStatus === 400) {
        item.status = "failed";
        item.retryable = false;
        item.errorMessage = t("photos.error_bad_type");
        bump();
        return;
      }
      // No status at all means fetch() itself threw — no connectivity. A 429
      // here is the upload rate bucket (distinct from the shot_limit code
      // above), and 5xx is hopefully transient. All three are worth retrying.
      const retryable = httpStatus === null || httpStatus === 429 || httpStatus >= 500;
      item.attempts += 1;
      if (retryable && item.attempts <= MAX_UPLOAD_ATTEMPTS) {
        item.status = "retrying";
        bump();
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BACKOFF_MS[item.attempts - 1] ?? RETRY_BACKOFF_MS.at(-1)),
        );
        if (unmountedRef.current) return;
        // Back on the queue for the loop's next pass. If we're still offline
        // the upload will fail again immediately and re-arm; no busy-loop —
        // the 'online' listener is what wakes a fully exhausted item back up.
        item.status = navigator.onLine ? "queued" : "failed";
        bump();
        return;
      }
      item.status = "failed";
      item.retryable = retryable;
      item.errorMessage = t("photos.error_generic");
      bump();
    }
  }

  async function runQueue() {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      for (;;) {
        if (unmountedRef.current || limitReachedRef.current) return;
        const next = queueRef.current.find((i) => i.status === "queued");
        if (!next) return;
        next.status = "uploading";
        bump();
        await uploadOne(next);
      }
    } finally {
      processingRef.current = false;
    }
  }

  function pruneQueue() {
    if (queueRef.current.length <= QUEUE_RETAIN_MAX) return;
    const dropped = queueRef.current.slice(0, queueRef.current.length - QUEUE_RETAIN_MAX);
    for (const d of dropped) URL.revokeObjectURL(d.previewUrl);
    queueRef.current = queueRef.current.slice(-QUEUE_RETAIN_MAX);
  }

  function enqueueCapture(file: File) {
    if (preview || limitReachedRef.current) return;
    // There is no HEVC/libheif decoder in either runtime. Fail before sending
    // multi-megabyte iPhone originals, while the backend independently sniffs
    // the bytes so renamed/spoofed files receive the same specific guidance.
    if (isHeifFile(file)) {
      setError(t("photos.error_heic"));
      return;
    }
    // Optimistic cap check so a burst doesn't spend requests it already knows
    // will fail; the LAST legitimate upload's own server response is what
    // authoritatively flips the screen via handleUploadSuccess.
    if (max > 0 && shotCount + pendingCount >= max) return;
    setError(null);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    queueRef.current = [
      ...queueRef.current,
      {
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "queued",
        attempts: 0,
        retryable: true,
      },
    ];
    pruneQueue();
    bump();
    void runQueue();
  }

  function retryQueueItem(id: string) {
    const item = queueRef.current.find((i) => i.id === id);
    if (!item || item.status !== "failed" || !item.retryable) return;
    item.status = "queued";
    item.attempts = 0;
    bump();
    void runQueue();
  }

  // Anything that gave up while offline gets one more try the moment the
  // browser tells us connectivity is back — a guest at a venue with patchy
  // wifi shouldn't have to notice and tap retry themselves.
  useEffect(() => {
    function handleOnline() {
      let changed = false;
      for (const item of queueRef.current) {
        if (item.status === "failed" && item.retryable) {
          item.status = "queued";
          item.attempts = 0;
          changed = true;
        }
      }
      if (changed) {
        bump();
        void runQueue();
      }
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  // A shot still queued/uploading/retrying when the guest tries to leave is a
  // shot that never reaches the couple — worth the native "are you sure".
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const hasPending = queueRef.current.some(
        (i) => i.status === "queued" || i.status === "uploading" || i.status === "retrying",
      );
      if (hasPending) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  function openPicker() {
    if (preview) return;
    fileInputRef.current?.click();
  }

  async function captureOnce() {
    if (preview || limitReachedRef.current || !live) return;
    if (max > 0 && shotCount + pendingCount >= max) return;
    const file = await capture(facing === "user");
    if (file) enqueueCapture(file);
  }

  // Tap = one shot. Hold = a burst, firing every BURST_INTERVAL_MS until
  // release. Pointer events drive the hold; the native click that follows a
  // mouse/touch release (and the only event a keyboard Enter/Space produces)
  // is what fires the single-tap capture — `burstEngaged` is the flag that
  // stops that same click from ALSO firing once a hold already has.
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const burstEngagedRef = useRef(false);

  function stopBurst() {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (burstIntervalRef.current) {
      clearInterval(burstIntervalRef.current);
      burstIntervalRef.current = null;
    }
  }

  useEffect(() => stopBurst, []);

  function handleShutterPointerDown() {
    if (preview || !live) return;
    burstEngagedRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      burstEngagedRef.current = true;
      void captureOnce();
      burstIntervalRef.current = setInterval(() => void captureOnce(), BURST_INTERVAL_MS);
    }, BURST_HOLD_MS);
  }

  async function handleShutterClick() {
    if (preview) return;
    stopBurst();
    if (burstEngagedRef.current) {
      burstEngagedRef.current = false;
      return;
    }
    if (live) {
      await captureOnce();
      return;
    }
    // No live camera: the native sheet is the only way to reach the lens.
    openPicker();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) enqueueCapture(file);
    e.target.value = "";
  }

  function handleQueueThumbTap(item: QueueItem) {
    if (item.status !== "failed") return;
    if (item.retryable) retryQueueItem(item.id);
    else if (item.errorMessage) setError(item.errorMessage);
  }

  const sentSub = album.revealAt
    ? t("photos.sent_sub_reveal")
        .replace("{{names}}", album.displayName)
        .replace("{{date}}", formatRevealDate(album.revealAt, locale))
    : t("photos.sent_sub_now").replace("{{names}}", album.displayName);

  const remaining = album.eventEndsAt ? Math.max(0, album.eventEndsAt - Date.now()) : null;

  return (
    // One true black across bar, viewfinder and controls — a bluish ink-950
    // chrome against a black frame reads as two panels stitched together.
    <div className="flex min-h-dvh flex-col bg-black">
      {preview && <PreviewBanner />}

      {/* ── Top bar: who + how many left, nothing else ─────────────── */}
      <div className="flex items-center gap-3 px-5 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <p className="min-w-0 flex-1 truncate font-grotesk text-[15px] font-bold tracking-[-0.01em] text-paper-50">
          {album.displayName}
        </p>
        {remaining !== null && (
          <span className="shrink-0 font-grotesk text-[13px] font-medium tabular-nums text-paper-50/45">
            {formatFilmCountdown(remaining)}
          </span>
        )}
        {max > 0 && (
          <span className="shrink-0 rounded-full bg-paper-50/10 px-2.5 py-1 font-grotesk text-[13px] font-bold tabular-nums text-paper-50">
            {Math.min(shotCount + pendingCount, max)}/{max}
          </span>
        )}
        <button
          type="button"
          onClick={shareInvite}
          disabled={preview}
          aria-label={t("photos.invite_aria")}
          title={t("photos.invite_aria")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-50/10 text-paper-50 transition-colors active:bg-paper-50/20 disabled:opacity-40"
        >
          <Share2 size={16} aria-hidden="true" />
        </button>
      </div>

      {/* ── Viewfinder ─────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden bg-black" style={{ minHeight: "50vh" }}>
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            live ? "opacity-100" : "opacity-0"
          }`}
          style={{
            filter: cssFilter,
            transform: facing === "user" ? "scaleX(-1)" : undefined,
          }}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Starting up — quiet, no copy. */}
        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-paper-50/20 border-t-paper-50/70" />
          </div>
        )}

        {/* Preview is intentionally inert: no camera permission and no file picker. */}
        {preview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera className="h-10 w-10 text-paper-50/45" aria-hidden="true" />
            <span className="font-grotesk text-[22px] font-bold leading-tight text-paper-50">
              {t("photos.preview_camera_heading")}
            </span>
            <span className="max-w-xs text-[14px] leading-relaxed text-paper-50/60">
              {t("photos.preview_camera_sub")}
            </span>
          </div>
        )}

        {/* Camera refused / absent — one bold line and the upload route. */}
        {blocked && (
          <button
            type="button"
            onClick={openPicker}
            className="absolute inset-0 flex w-full flex-col items-center justify-center gap-4 px-8 text-center"
          >
            <Camera className="h-10 w-10 text-paper-50/30" aria-hidden="true" />
            <span className="font-grotesk text-[22px] font-bold leading-tight text-paper-50">
              {t("photos.camera_blocked")}
            </span>
            <span className="text-[14px] text-paper-50/50">
              {inApp && mobile ? t("photos.camera_blocked_inapp") : t("photos.camera_blocked_sub")}
            </span>
          </button>
        )}

        {/* Flash */}
        <div
          className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-100"
          style={{ opacity: flash ? 0.9 : 0 }}
        />

        {/* Error */}
        {error && (
          <div className="absolute left-4 right-4 top-4">
            <p className="rounded-2xl bg-red-950/85 px-4 py-3 text-center text-[14px] font-medium text-red-200 backdrop-blur-sm">
              {error}
            </p>
          </div>
        )}

        {/* Quiet per-shot confirmation after the first — fades on its own so
            shooting stays continuous, no tap needed to get back to the lens. */}
        {toastCount !== null && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3.5 py-1.5 font-grotesk text-[13px] font-semibold text-paper-50 backdrop-blur-sm">
              <Check size={14} aria-hidden="true" />
              {t("photos.sent_toast")} · {toastCount}
            </span>
          </div>
        )}

        {/* Recent shots — proof they landed, and where a stuck one can be
            retried. Uploading/retrying show a spinner or an amber dot; a
            permanently failed one shows why (bad file) or offers a retry
            (network) right on the thumbnail — no separate screen for it. */}
        {queueRef.current.length > 0 && (
          <div className="absolute bottom-4 right-4 flex gap-2">
            {queueRef.current.slice(-QUEUE_DISPLAY_MAX).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleQueueThumbTap(item)}
                disabled={item.status !== "failed"}
                aria-label={
                  item.status === "failed" && item.retryable ? t("photos.queue_retry") : undefined
                }
                className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border-2 border-paper-50/25 shadow-lg disabled:cursor-default"
              >
                <img
                  src={item.previewUrl}
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full object-cover"
                  style={{ filter: cssFilter }}
                />
                {(item.status === "queued" || item.status === "uploading") && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-paper-50/40 border-t-paper-50" />
                  </span>
                )}
                {item.status === "retrying" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                  </span>
                )}
                {item.status === "failed" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                    {item.retryable ? (
                      <RotateCcw size={16} className="text-paper-50" aria-hidden="true" />
                    ) : (
                      <span className="font-grotesk text-[15px] font-bold text-red-300">!</span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Prompt: a playful idea, above the shutter ──────────────── */}
      {promptText && (
        <div className="flex justify-center px-8 pt-4">
          <span className="rounded-full bg-paper-50/10 px-4 py-2 text-center text-[13px] font-medium text-paper-50/75">
            {promptText}
          </span>
        </div>
      )}

      {/* ── Controls: upload · shutter · flip ──────────────────────── */}
      <div className="grid grid-cols-3 items-center px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6">
        <div className="flex justify-start">
          <button
            type="button"
            onClick={openPicker}
            disabled={preview}
            aria-label={t("photos.upload_existing")}
            title={t("photos.upload_existing")}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-50/10 text-paper-50 transition-colors active:bg-paper-50/20 disabled:opacity-40"
          >
            <ImagePlus size={22} aria-hidden="true" />
          </button>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            disabled={preview || status === "starting"}
            onPointerDown={handleShutterPointerDown}
            onPointerUp={stopBurst}
            onPointerCancel={stopBurst}
            onPointerLeave={stopBurst}
            onClick={handleShutterClick}
            aria-label={t("photos.take_photo")}
            className="flex h-[74px] w-[74px] items-center justify-center rounded-full border-4 border-paper-50/35 bg-paper-50 transition-transform active:scale-90 disabled:opacity-50"
          >
            {pendingCount > 0 && (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-300 border-t-ink-950" />
            )}
          </button>
        </div>

        <div className="flex justify-end">
          {live && (
            <button
              type="button"
              onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
              aria-label={t("photos.flip_camera")}
              title={t("photos.flip_camera")}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-50/10 text-paper-50 transition-colors active:bg-paper-50/20 disabled:opacity-40"
            >
              <SwitchCamera size={22} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* ── Sent ───────────────────────────────────────────────────── */}
      {sent && (
        <div className="fixed inset-0 z-50 flex flex-col justify-center bg-ink-950 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-16">
          <div className="mx-auto w-full max-w-sm">
            <span className="mb-8 flex h-12 w-12 items-center justify-center rounded-full bg-sage-500">
              <Check size={26} className="text-paper-50" aria-hidden="true" />
            </span>
            <SheetTitle>{t("photos.sent_heading")}</SheetTitle>
            <SheetBody>{sentSub}</SheetBody>
            <p className="mt-2 font-grotesk text-[13px] font-medium text-paper-50/35">
              {t("photos.sent_count").replace("{{n}}", String(sentCount))}
            </p>
            <div className="mt-10 flex flex-col gap-3">
              <button type="button" onClick={() => setSent(false)} className={PRIMARY_BTN}>
                {t("photos.sent_add_more")}
              </button>
              <button type="button" onClick={shareInvite} className={GHOST_BTN}>
                {t("photos.sent_invite")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input — the upload-from-gallery route. */}
      <input
        ref={fileInputRef}
        type="file"
        disabled={preview}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
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
    <div className="font-grotesk text-[56px] font-bold leading-none tracking-[-0.03em] tabular-nums text-paper-50">
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </div>
  );
}

// ─── gallery component ────────────────────────────────────────────────────────

function Gallery({ uploads, aesthetic }: { uploads: FilmUpload[]; aesthetic: FilmAesthetic }) {
  const { t, locale } = useT();
  return (
    <div className="columns-2 gap-2">
      {uploads.map((u, index) => {
        const contributor =
          u.source === "couple"
            ? t("photos.from_couple")
            : (u.guestName ?? t("media.film_anonymous"));
        const label = t("media.gallery_photo_alt", {
          n: index + 1,
          name: contributor,
          date: new Date(u.uploadedAt).toLocaleDateString(intlLocale(locale)),
        });
        return (
          <div key={u.id} className="relative mb-2 overflow-hidden rounded-2xl break-inside-avoid">
            <img
              src={u.fileUrl}
              alt={label}
              loading="lazy"
              className="w-full object-cover"
              style={{
                filter: filterStyle((u.filterApplied as FilmAesthetic | null) ?? aesthetic),
              }}
            />
            {u.source === "couple" && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-umber-600/90 px-2 py-0.5 font-grotesk text-[10px] font-semibold uppercase tracking-[0.08em] text-paper-50">
                {t("photos.from_couple")}
              </span>
            )}
            {u.guestName && (
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 font-grotesk text-[11px] font-medium text-white backdrop-blur-sm">
                {u.guestName}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function GuestPhotoPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, locale } = useT();
  const [searchParams] = useSearchParams();
  const preview = searchParams.get("preview") === "1";
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [nameSubmitting, setNameSubmitting] = useState(false);
  const [nameFormError, setNameFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ kind: "not_found" });
      return;
    }
    if (preview) {
      photoAlbumApi
        .getPreview(token)
        .then(({ album }) => setState({ kind: "landing", album }))
        .catch(() => setState({ kind: "preview_unavailable" }));
      return;
    }

    const deviceId = getDeviceId(token);
    const storedName = getStoredName(token);
    const storedEmail = getStoredEmail(token);

    photoAlbumApi
      .registerDevice(token, deviceId, storedName, { email: storedEmail })
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
          setState({ kind: "landing", album });
        } else if (shotCount > 0) {
          // Returning guest who already shared at least one shot: warm welcome
          // back before dropping them into the live viewfinder.
          setState({ kind: "returning_welcome", album, guestName: storedName, shotCount });
        } else {
          setState({ kind: "viewfinder", album, guestName: storedName, shotCount });
        }
      })
      .catch((err: { status?: number; detail?: { code?: string } }) => {
        // 429 is either the per-IP register limit (a venue's whole wifi is one
        // IP) or the film's guest cap. Both are "not right now", not "gone".
        if (err?.status === 429) setState({ kind: "busy" });
        else if (err?.status === 403) setState({ kind: "disabled" });
        else setState({ kind: "not_found" });
      });
  }, [preview, token]);

  function handleOpenCamera() {
    if (state.kind !== "landing") return;
    setState({ kind: "name_capture", album: state.album });
  }

  async function handleNameSubmit(name: string, email: string, optIn: boolean) {
    if (state.kind !== "name_capture") return;
    const { album } = state;
    if (preview) {
      setState({ kind: "viewfinder", album, guestName: name, shotCount: 0 });
      return;
    }

    setNameFormError(null);
    if (!EMAIL_RE.test(email)) {
      setNameFormError(t("photos.email_invalid"));
      return;
    }

    // The initial anonymous registration only establishes capacity and film
    // availability. Persist the chosen name + email server-side before opening
    // the camera so attribution, merged sessions, and per-person quota all
    // agree — email is what tells two guests with the same first name apart.
    setNameSubmitting(true);
    try {
      const registered = await photoAlbumApi.registerDevice(token, getDeviceId(token), name, {
        email,
        marketingOptIn: optIn,
      });
      storeName(token, name);
      storeEmail(token, email);
      if (
        registered.album.shotsPerGuest !== null &&
        registered.shotCount >= registered.album.shotsPerGuest
      ) {
        setState({ kind: "limit_reached", album: registered.album });
      } else {
        setState({
          kind: "viewfinder",
          album: registered.album,
          guestName: name,
          shotCount: registered.shotCount,
        });
      }
    } catch (err: unknown) {
      const detail = (err as { detail?: unknown })?.detail;
      const code = (detail as { code?: string } | undefined)?.code;
      if (code === "invalid_email" || code === "email_required") {
        setNameFormError(t("photos.email_invalid"));
        return;
      }
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status?: unknown }).status
          : undefined;
      setState({ kind: status === 403 ? "disabled" : "busy" });
    } finally {
      setNameSubmitting(false);
    }
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
      <div className="flex min-h-dvh items-center justify-center bg-ink-950">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-paper-50/20 border-t-paper-50/70" />
      </div>
    );
  }

  if (state.kind === "busy") {
    return (
      <FilmSheet>
        <SheetTitle>{t("photos.busy")}</SheetTitle>
        <SheetBody>{t("photos.busy_sub")}</SheetBody>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`${PRIMARY_BTN} mt-10`}
        >
          {t("photos.busy_retry")}
        </button>
      </FilmSheet>
    );
  }

  if (state.kind === "preview_unavailable") {
    return (
      <>
        <PreviewBanner />
        <FilmSheet>
          <SheetTitle>{t("photos.preview_unavailable")}</SheetTitle>
          <SheetBody>{t("photos.preview_unavailable_sub")}</SheetBody>
        </FilmSheet>
      </>
    );
  }

  if (state.kind === "landing") {
    return (
      <>
        {preview && <PreviewBanner />}
        <div className="relative flex min-h-dvh flex-col justify-end overflow-hidden bg-ink-950 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-16 text-paper-50">
          {state.album.coverImageUrl && (
            <img
              src={state.album.coverImageUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/75 to-ink-950/25"
          />
          <div className="relative mx-auto w-full max-w-sm">
            <SheetKicker album={state.album} />
            <SheetTitle>{t("photos.landing_heading")}</SheetTitle>
            <SheetBody>{t("photos.landing_body")}</SheetBody>
            <button type="button" onClick={handleOpenCamera} className={`${PRIMARY_BTN} mt-10`}>
              {t("photos.landing_cta")}
            </button>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-center">
              {[
                t("photos.landing_reassure_no_app"),
                t("photos.landing_reassure_no_account"),
                t("photos.landing_reassure_private"),
              ].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-paper-50/15 bg-paper-50/5 px-3 py-1.5 text-[12px] font-medium text-paper-50/60"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (state.kind === "not_found" || state.kind === "disabled") {
    const isClosed = state.kind === "disabled";
    return (
      <FilmSheet>
        <SheetTitle>{isClosed ? t("photos.uploads_disabled") : t("photos.not_found")}</SheetTitle>
        <SheetBody>
          {isClosed ? t("photos.uploads_disabled_sub") : t("photos.not_found_sub")}
        </SheetBody>
      </FilmSheet>
    );
  }

  if (state.kind === "name_capture") {
    const emailLooksValid = EMAIL_RE.test(emailInput.trim());
    const canSubmit = nameInput.trim().length > 0 && emailLooksValid;
    return (
      <>
        {preview && <PreviewBanner />}
        <FilmSheet>
          <SheetKicker album={state.album} />
          <SheetTitle>{t("photos.name_heading")}</SheetTitle>
          <form
            className="mt-8"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = nameInput.trim();
              const trimmedEmail = emailInput.trim();
              if (trimmed && trimmedEmail) handleNameSubmit(trimmed, trimmedEmail, marketingOptIn);
            }}
          >
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t("photos.name_placeholder")}
              aria-label={t("photos.name_placeholder")}
              autoFocus
              disabled={nameSubmitting}
              className="w-full rounded-2xl bg-paper-50/10 px-5 py-4 font-grotesk text-[17px] font-medium text-paper-50 placeholder-paper-50/30 outline-none transition-colors focus:bg-paper-50/15"
            />
            <input
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder={t("photos.email_placeholder")}
              aria-label={t("photos.email_placeholder")}
              disabled={nameSubmitting}
              className="mt-3 w-full rounded-2xl bg-paper-50/10 px-5 py-4 font-grotesk text-[17px] font-medium text-paper-50 placeholder-paper-50/30 outline-none transition-colors focus:bg-paper-50/15"
            />
            <p className="mt-2 text-[13px] leading-relaxed text-paper-50/40">
              {t("photos.email_hint")}
            </p>
            {nameFormError && (
              <p className="mt-2 text-[13px] font-medium text-red-300" role="alert">
                {nameFormError}
              </p>
            )}
            <label className="mt-5 flex items-start gap-3 text-[13px] leading-relaxed text-paper-50/50">
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
                disabled={nameSubmitting}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-paper-50/30 bg-transparent"
              />
              <span>
                {t("photos.marketing_opt_in_label")}{" "}
                <a
                  href="/privacy#guest-camera"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-paper-50/30 underline-offset-2"
                >
                  {t("photos.privacy_link")}
                </a>
              </span>
            </label>
            <button
              type="submit"
              disabled={!canSubmit || nameSubmitting}
              className={`${PRIMARY_BTN} mt-5`}
            >
              {nameSubmitting
                ? t("common.saving")
                : preview
                  ? t("photos.preview_continue")
                  : t("photos.name_continue")}
            </button>
          </form>
        </FilmSheet>
      </>
    );
  }

  if (state.kind === "returning_welcome") {
    const { album, guestName, shotCount } = state;
    const sub =
      shotCount === 1
        ? t("photos.welcome_back_sub_one")
        : t("photos.welcome_back_sub_many").replace("{{n}}", String(shotCount));
    return (
      <>
        {preview && <PreviewBanner />}
        <FilmSheet>
          <SheetKicker album={album} />
          <SheetTitle>{t("photos.welcome_back_heading").replace("{{name}}", guestName)}</SheetTitle>
          <SheetBody>{sub}</SheetBody>
          <button
            type="button"
            onClick={() => setState({ kind: "viewfinder", album, guestName, shotCount })}
            className={`${PRIMARY_BTN} mt-10`}
          >
            {t("photos.welcome_back_cta")}
          </button>
        </FilmSheet>
      </>
    );
  }

  if (state.kind === "developing") {
    return (
      <FilmSheet>
        <SheetKicker album={state.album} />
        <SheetTitle>{t("photos.developing_heading")}</SheetTitle>
        <SheetBody>
          {t("photos.developing_sub")
            .replace("{{names}}", state.album.displayName)
            .replace(
              "{{date}}",
              state.album.revealAt ? formatRevealDate(state.album.revealAt, locale) : "",
            )}
        </SheetBody>
        {state.album.revealAt && (
          <div className="mt-10">
            <Countdown revealsAt={state.album.revealAt} onRevealed={handleRevealed} />
          </div>
        )}
      </FilmSheet>
    );
  }

  if (state.kind === "gallery") {
    const uploads = state.uploads;
    return (
      <div className="min-h-dvh bg-ink-950 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-12">
        <div className="mx-auto w-full max-w-2xl">
          <p className="mb-2 font-grotesk text-[11px] font-semibold uppercase tracking-[0.22em] text-paper-50/40">
            {state.album.displayName}
          </p>
          <h1 className="mb-6 font-grotesk text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-paper-50">
            {t("photos.gallery_count").replace("{{n}}", String(uploads.length))}
          </h1>
          <Gallery uploads={uploads} aesthetic={state.album.filmAesthetic} />
        </div>
      </div>
    );
  }

  if (state.kind === "limit_reached") {
    return (
      <FilmSheet>
        <SheetKicker album={state.album} />
        <span className="mb-8 flex h-12 w-12 items-center justify-center rounded-full bg-sage-500">
          <Check size={26} className="text-paper-50" aria-hidden="true" />
        </span>
        <SheetTitle>{t("photos.limit_heading")}</SheetTitle>
        <SheetBody>
          {t("photos.limit_sub").replace("{{n}}", String(state.album.shotsPerGuest ?? ""))}
        </SheetBody>
      </FilmSheet>
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
      preview={preview}
      onShotTaken={(count) =>
        setState((s) => (s.kind === "viewfinder" ? { ...s, shotCount: count } : s))
      }
      onLimitReached={() => setState({ kind: "limit_reached", album })}
    />
  );
}
