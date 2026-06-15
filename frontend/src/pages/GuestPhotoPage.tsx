// Public guest upload page — reachable via /photos/:token.
// No auth required. Works on mobile (primary surface).
//
// States:
//   loading      — fetching album info
//   not_found    — 404 from backend
//   disabled     — album exists but is_upload_enabled = false
//   name_capture — first visit, ask for guest name
//   ready        — waiting for the guest to pick a photo
//   uploading    — upload in flight
//   success      — last upload succeeded
//   limit_reached— shots_per_guest exhausted

import type { PhotoAlbumPublic } from "@shared/types";
import { Camera, CheckCircle, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { photoAlbumApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// ─── device id ───────────────────────────────────────────────────────────────

function getDeviceId(token: string): string {
  const key = `weddly.photos.${token}.device_id`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function getShotCount(token: string): number {
  const key = `weddly.photos.${token}.shots`;
  return parseInt(localStorage.getItem(key) ?? "0", 10);
}

function incrementShotCount(token: string): number {
  const key = `weddly.photos.${token}.shots`;
  const next = getShotCount(token) + 1;
  localStorage.setItem(key, String(next));
  return next;
}

function getStoredName(token: string): string | null {
  return localStorage.getItem(`weddly.photos.${token}.name`);
}

function storeGuestName(token: string, name: string): void {
  localStorage.setItem(`weddly.photos.${token}.name`, name);
}

// ─── page states ─────────────────────────────────────────────────────────────

type PageState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "disabled" }
  | { kind: "name_capture"; album: PhotoAlbumPublic }
  | { kind: "ready"; album: PhotoAlbumPublic; guestName: string | null; shotsUsed: number }
  | { kind: "uploading"; album: PhotoAlbumPublic; guestName: string | null; shotsUsed: number }
  | { kind: "success"; album: PhotoAlbumPublic; guestName: string | null; shotsUsed: number }
  | { kind: "limit_reached"; album: PhotoAlbumPublic };

// ─── sub-components ──────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function CoupleHeading({ album }: { album: PhotoAlbumPublic }) {
  return (
    <div className="text-center mb-8">
      <p className="font-serif italic text-2xl text-ink-900">{album.displayName}</p>
      {album.title && (
        <p className="mt-1 text-sm text-ink-500">{album.title}</p>
      )}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function GuestPhotoPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load album on mount.
  useEffect(() => {
    if (!token) {
      setState({ kind: "not_found" });
      return;
    }
    photoAlbumApi
      .getPublic(token)
      .then((album) => {
        if (!album.isUploadEnabled) {
          setState({ kind: "disabled" });
          return;
        }
        const shotsUsed = getShotCount(token);
        if (album.shotsPerGuest !== null && shotsUsed >= album.shotsPerGuest) {
          setState({ kind: "limit_reached", album });
          return;
        }
        const stored = getStoredName(token);
        if (stored !== null) {
          setState({ kind: "ready", album, guestName: stored, shotsUsed });
        } else {
          setState({ kind: "name_capture", album });
        }
      })
      .catch(() => {
        setState({ kind: "not_found" });
      });
  }, [token]);

  const handleNameSubmit = useCallback(
    (name: string | null) => {
      if (state.kind !== "name_capture") return;
      const { album } = state;
      const finalName = name?.trim() || null;
      if (finalName) storeGuestName(token, finalName);
      else storeGuestName(token, "");
      setState({ kind: "ready", album, guestName: finalName, shotsUsed: getShotCount(token) });
    },
    [state, token],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (state.kind !== "ready" && state.kind !== "success") return;
      const { album, guestName } = state;
      setError(null);

      if (file.size > 8 * 1024 * 1024) {
        setError(t("photos.error_too_large"));
        return;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setError(t("photos.error_bad_type"));
        return;
      }

      const shotsUsed = getShotCount(token);
      setState({ kind: "uploading", album, guestName, shotsUsed });

      try {
        await photoAlbumApi.upload(token, file, {
          deviceId: getDeviceId(token),
          guestName: guestName ?? undefined,
        });
        const newCount = incrementShotCount(token);
        if (album.shotsPerGuest !== null && newCount >= album.shotsPerGuest) {
          setState({ kind: "limit_reached", album });
        } else {
          setState({ kind: "success", album, guestName, shotsUsed: newCount });
        }
      } catch (err: unknown) {
        const detail = (err as { detail?: unknown })?.detail;
        const code = (detail as { code?: string } | undefined)?.code;
        if (code === "shot_limit") {
          setState({ kind: "limit_reached", album });
          return;
        }
        const statusCode = (err as { status?: number })?.status;
        if (statusCode === 413) {
          setError(t("photos.error_too_large"));
        } else if (statusCode === 400) {
          setError(t("photos.error_bad_type"));
        } else {
          setError(t("photos.error_generic"));
        }
        setState({ kind: "ready", album, guestName, shotsUsed });
      }
    },
    [state, token, t],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  // ── render ────────────────────────────────────────────────────────────────

  if (state.kind === "loading") {
    return (
      <Shell>
        <p className="text-center text-ink-400 text-sm">{t("photos.loading")}</p>
      </Shell>
    );
  }

  if (state.kind === "not_found") {
    return (
      <Shell>
        <div className="text-center">
          <p className="font-serif italic text-xl text-ink-900 mb-2">{t("photos.not_found")}</p>
          <p className="text-sm text-ink-500">{t("photos.not_found_sub")}</p>
        </div>
      </Shell>
    );
  }

  if (state.kind === "disabled") {
    return (
      <Shell>
        <div className="text-center">
          <p className="font-serif italic text-xl text-ink-900 mb-2">
            {t("photos.uploads_disabled")}
          </p>
          <p className="text-sm text-ink-500">{t("photos.uploads_disabled_sub")}</p>
        </div>
      </Shell>
    );
  }

  if (state.kind === "name_capture") {
    return (
      <Shell>
        <CoupleHeading album={state.album} />
        <div className="card">
          <h1 className="text-lg font-semibold text-ink-900 mb-1">{t("photos.name_heading")}</h1>
          <p className="text-sm text-ink-500 mb-4">{t("photos.name_sub")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleNameSubmit(nameInput || null);
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
      </Shell>
    );
  }

  if (state.kind === "limit_reached") {
    return (
      <Shell>
        <CoupleHeading album={state.album} />
        <div className="card text-center">
          <CheckCircle className="w-10 h-10 text-sage-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-ink-900 mb-1">{t("photos.limit_heading")}</h1>
          <p className="text-sm text-ink-500">
            {t("photos.limit_sub").replace(
              "{{n}}",
              String(state.album.shotsPerGuest ?? ""),
            )}
          </p>
        </div>
      </Shell>
    );
  }

  if (state.kind === "success") {
    return (
      <Shell>
        <CoupleHeading album={state.album} />
        <div className="card text-center">
          <CheckCircle className="w-10 h-10 text-sage-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-ink-900 mb-1">
            {t("photos.success_heading")}
          </h1>
          <p className="text-sm text-ink-500 mb-4">{t("photos.success_sub")}</p>
          {state.album.shotsPerGuest !== null && (
            <p className="text-xs text-ink-400 mb-4">
              {t("photos.shot_count")
                .replace("{{used}}", String(state.shotsUsed))
                .replace("{{max}}", String(state.album.shotsPerGuest))}
            </p>
          )}
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => {
              setState({
                kind: "ready",
                album: state.album,
                guestName: state.guestName,
                shotsUsed: state.shotsUsed,
              });
            }}
          >
            {t("photos.success_add_more")}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="sr-only"
          onChange={handleInputChange}
        />
      </Shell>
    );
  }

  // ready | uploading
  const isUploading = state.kind === "uploading";
  const { album, shotsUsed } = state;
  const remaining =
    album.shotsPerGuest !== null ? album.shotsPerGuest - shotsUsed : null;

  return (
    <Shell>
      <CoupleHeading album={album} />
      <div className="card text-center">
        <Camera className="w-10 h-10 text-ink-300 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-ink-900 mb-1">{t("photos.ready_heading")}</h1>
        <p className="text-sm text-ink-500 mb-1">
          {remaining !== null
            ? t("photos.ready_sub_limit").replace("{{n}}", String(remaining))
            : t("photos.ready_sub")}
        </p>
        {album.shotsPerGuest !== null && (
          <p className="text-xs text-ink-400 mb-4">
            {t("photos.shot_count")
              .replace("{{used}}", String(shotsUsed))
              .replace("{{max}}", String(album.shotsPerGuest))}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}
        <button
          type="button"
          disabled={isUploading}
          className="btn-primary w-full flex items-center justify-center gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="w-4 h-4" />
          {isUploading ? t("photos.uploading") : t("photos.choose_photo")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="sr-only"
          onChange={handleInputChange}
        />
      </div>
    </Shell>
  );
}
