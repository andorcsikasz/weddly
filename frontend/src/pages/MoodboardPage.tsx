// Moodboard — three sources, persisted on the couple so both partners see the
// same board across devices (state lives on the couple row, not localStorage):
//   - preset    : a curated Pinterest board, scraped server-side. The default,
//                 so the page is never blank.
//   - pinterest : the couple's own public board link. Same scrape path.
//   - upload    : the couple's own images, uploaded from-device and served from
//                 /uploads. The robust path — no Pinterest dependency.
// For preset/pinterest the backend proxies the board's RSS feed (CORS-blocked
// from the browser); typed error codes drive specific copy for private/missing/
// empty boards. "Replace" swaps between sources; uploads stay on file when the
// couple flips back to the preset, so switching is non-destructive.

import type { MoodboardPin, MoodboardState } from "@shared/types";
import { AlertTriangle, ExternalLink, ImagePlus, Lock, Trash2, UploadCloud } from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { Skeleton, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { moodboardApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// Legacy: the board link used to live here before it moved to the couple row.
// Read once on mount to migrate, then removed.
const LEGACY_URL_KEY = "weddly.moodboard_url";

type ErrorCode = "invalid_url" | "not_found" | "private" | "empty" | "fetch_failed";

const PREVIEW_ERROR_KEY: Record<ErrorCode, string> = {
  invalid_url: "moodboard.invalid_url",
  not_found: "moodboard.error_not_found",
  private: "moodboard.error_private",
  empty: "moodboard.error_empty",
  fetch_failed: "moodboard.error_fetch",
};

// Light client gate — just keeps obvious garbage from round-tripping. The
// backend does the authoritative resolve: it follows pin.it / share links and
// canonicalises, so we accept all three things people paste (full board URL,
// bare host without scheme, and pin.it share link).
function looksLikePinterestLink(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split("/").filter(Boolean).length;
  if (host === "pin.it") return segments >= 1;
  if (/(^|\.)pinterest\.[a-z.]+$/i.test(host)) return segments >= 2;
  return false;
}

/** A lapsed couple's workspace is read-only: saving a board / uploading images
 *  returns 402. That's a billing state, NOT a Pinterest failure — surface it as
 *  such instead of letting it fall through to a misleading "fetch failed". */
function isReadOnlyBlock(err: unknown): boolean {
  return err instanceof ApiError && err.status === 402;
}

function classifyPreviewError(err: unknown): ErrorCode {
  if (err instanceof ApiError) {
    const code = (err.detail as { code?: string } | null | undefined)?.code;
    if (code === "invalid_url") return "invalid_url";
    if (code === "not_found") return "not_found";
    if (code === "private") return "private";
    if (code === "empty") return "empty";
  }
  return "fetch_failed";
}

/** Map an upload failure to a specific i18n key (server validates by magic
 *  bytes + size + count; we surface the matching message). */
function uploadErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const code = (err.detail as { code?: string } | null | undefined)?.code;
    if (code === "file_too_large") return "moodboard.upload_too_large";
    if (code === "unsupported_type") return "moodboard.upload_bad_type";
    if (code === "upload_limit") return "moodboard.upload_limit";
  }
  return "moodboard.upload_error";
}

/** Pinterest brand mark — inlined SVG (no CDN request). Monochrome via
 *  `currentColor`, so it inherits the surrounding blush tint. */
function PinterestMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C24.005 5.367 18.628.001 12.018.001z" />
    </svg>
  );
}

/** Masonry grid of scraped Pinterest pins (preset + pinterest sources). */
function PinGrid({ pins }: { pins: MoodboardPin[] }) {
  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
      {pins.map((pin) => (
        <a
          key={pin.link_url}
          href={pin.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-inside-avoid overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 transition-shadow hover:shadow-md dark:border-umber-700 dark:bg-umber-800"
        >
          <img src={pin.image_url} alt={pin.title ?? ""} loading="lazy" className="block w-full" />
        </a>
      ))}
    </div>
  );
}

function GridSkeleton({ label }: { label: string }) {
  return (
    <div
      className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {[200, 260, 180, 240, 200, 220, 280, 200].map((h, i) => (
        <Skeleton
          key={i}
          variant="block"
          height={h}
          rounded="2xl"
          className="block w-full break-inside-avoid"
        />
      ))}
    </div>
  );
}

export default function MoodboardPage() {
  const { t } = useT();
  const toast = useToast();

  const [state, setState] = useState<MoodboardState | null>(null);
  const [stateLoading, setStateLoading] = useState(true);

  // Pin scrape (preset + pinterest sources).
  const [pins, setPins] = useState<MoodboardPin[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [previewError, setPreviewError] = useState<ErrorCode | null>(null);

  // "Replace" chooser + its Pinterest-link form.
  const [choosing, setChoosing] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<ErrorCode | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Set when a save/upload is refused because the workspace is read-only (402).
  const [readOnly, setReadOnly] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // True once all pin images have been preloaded (or timeout). Prevents the
  // one-by-one pop-in: the skeleton stays visible until the whole grid is ready.
  const [gridReady, setGridReady] = useState(false);

  // Initial state load + one-time migration of the legacy localStorage url.
  useEffect(() => {
    let cancelled = false;
    moodboardApi
      .get()
      .then(async (s) => {
        let next = s;
        const legacy =
          typeof window !== "undefined" ? window.localStorage.getItem(LEGACY_URL_KEY) : null;
        if (s.source === "preset" && legacy && looksLikePinterestLink(legacy)) {
          try {
            next = await moodboardApi.setSource({ source: "pinterest", url: legacy });
          } catch {
            /* migration is best-effort — fall back to the preset */
          }
        }
        if (legacy) {
          try {
            window.localStorage.removeItem(LEGACY_URL_KEY);
          } catch {
            /* */
          }
        }
        if (!cancelled) setState(next);
      })
      .catch(() => {
        /* leave state null → the page shows the load skeleton then nothing */
      })
      .finally(() => {
        if (!cancelled) setStateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The board url to scrape for the current source (none for uploads).
  const boardUrl =
    state?.source === "pinterest"
      ? state.url
      : state?.source === "preset"
        ? state.preset_url
        : null;

  useEffect(() => {
    if (!boardUrl) {
      setPins([]);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPinsLoading(true);
    setPreviewError(null);
    moodboardApi
      .preview(boardUrl)
      .then((res) => {
        if (!cancelled) setPins(res.pins);
      })
      .catch((err) => {
        if (cancelled) return;
        setPins([]);
        setPreviewError(classifyPreviewError(err));
      })
      .finally(() => {
        if (!cancelled) setPinsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardUrl]);

  // When a new board starts loading, immediately invalidate the ready flag so
  // old-board images don't flash through before new ones are preloaded.
  useEffect(() => {
    if (pinsLoading) setGridReady(false);
  }, [pinsLoading]);

  // Preload all pin images before showing the grid — skeleton stays up until
  // every image is decoded (or 5 s safety timeout).
  useEffect(() => {
    setGridReady(false);
    if (pins.length === 0) {
      setGridReady(true);
      return;
    }
    let loaded = 0;
    const imgs: HTMLImageElement[] = [];
    function tick() {
      if (++loaded >= imgs.length) setGridReady(true);
    }
    for (const pin of pins) {
      const img = new Image();
      img.onload = tick;
      img.onerror = tick;
      img.src = pin.image_url;
      imgs.push(img);
    }
    const t = setTimeout(() => setGridReady(true), 5000);
    return () => {
      for (const img of imgs) {
        img.onload = null;
        img.onerror = null;
      }
      clearTimeout(t);
    };
  }, [pins]);

  const openFilePicker = useCallback(() => {
    setUploadError(null);
    fileInputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ""; // allow re-picking the same file
      if (files.length === 0) return;
      setUploadError(null);
      setReadOnly(false);
      setUploading(true);
      moodboardApi
        .uploadImages(files)
        .then((s) => {
          setState(s);
          setChoosing(false);
        })
        .catch((err) => {
          if (isReadOnlyBlock(err)) setReadOnly(true);
          else setUploadError(t(uploadErrorKey(err)));
        })
        .finally(() => setUploading(false));
    },
    [t],
  );

  const saveLink = useCallback(() => {
    const trimmed = linkDraft.trim();
    if (!looksLikePinterestLink(trimmed)) {
      setLinkError("invalid_url");
      return;
    }
    setLinkError(null);
    setReadOnly(false);
    moodboardApi
      .setSource({ source: "pinterest", url: trimmed })
      .then((s) => {
        setState(s);
        setChoosing(false);
        setLinkDraft("");
      })
      .catch((err) => {
        if (isReadOnlyBlock(err)) setReadOnly(true);
        else setLinkError(classifyPreviewError(err));
      });
  }, [linkDraft]);

  const backToPreset = useCallback(() => {
    moodboardApi
      .setSource({ source: "preset" })
      .then(setState)
      .catch(() => toast.error(t("moodboard.error_fetch")));
  }, [t, toast]);

  const deleteImage = useCallback(
    (id: number) => {
      moodboardApi
        .deleteImage(id)
        .then(setState)
        .catch(() => toast.error(t("moodboard.upload_error")));
    },
    [t, toast],
  );

  const source = state?.source ?? "preset";

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handleFiles}
      />

      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-grotesk">{t("moodboard.title")}</h1>
          <InfoHint text={t("moodboard.sub")} />
        </div>

        {state && !choosing && (
          <div className="card ml-auto flex w-full flex-nowrap items-center justify-between gap-2 border-2 border-ink-700 p-2.5 sm:w-auto sm:gap-3 sm:px-5 sm:py-2 dark:border-paper-100">
            <div className="flex min-w-0 items-center gap-2">
              {source === "preset" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-100 px-2.5 py-1 text-xs font-medium text-ink-700 dark:bg-umber-700 dark:text-paper-100">
                  <span className="text-blush-700 dark:text-blush-300">
                    <PinterestMark size={13} />
                  </span>
                  {t("moodboard.preset_badge")}
                </span>
              )}
              {source === "pinterest" && state.url && (
                <a
                  href={state.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1.5 truncate text-sm text-ink-700 underline-offset-4 hover:underline dark:text-paper-100"
                >
                  <ExternalLink size={14} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{t("moodboard.open_in_pinterest")}</span>
                </a>
              )}
              {source === "upload" && (
                <span className="text-sm text-ink-700 dark:text-paper-100">
                  {state.images.length} / 12
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              {source === "upload" && (
                <button
                  type="button"
                  className="btn-ghost btn-sm inline-flex items-center gap-1"
                  onClick={openFilePicker}
                  disabled={uploading || state.images.length >= 12}
                >
                  <ImagePlus size={14} aria-hidden="true" />
                  <span className="hidden sm:inline">{t("moodboard.add_images")}</span>
                </button>
              )}
              {source !== "preset" && (
                <button type="button" className="btn-ghost btn-sm" onClick={backToPreset}>
                  {t("moodboard.back_to_preset")}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setChoosing(true);
                  setLinkDraft(source === "pinterest" ? (state.url ?? "") : "");
                  setLinkError(null);
                  setUploadError(null);
                  setReadOnly(false);
                }}
              >
                {t("moodboard.change")}
              </button>
            </div>
          </div>
        )}
      </header>

      {uploadError && !choosing && (
        <div
          role="alert"
          className="card mb-4 flex items-start gap-3 border-ink-900 bg-white dark:border-paper-100/40 dark:bg-umber-800"
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-900 dark:bg-umber-700 dark:text-paper-100">
            <AlertTriangle size={18} aria-hidden="true" />
          </span>
          <p className="self-center text-sm text-ink-700 dark:text-paper-200">{uploadError}</p>
        </div>
      )}

      {/* ── Replace chooser ─────────────────────────────────────────────── */}
      {choosing ? (
        <div className="card flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <h2 className="font-grotesk text-xl">{t("moodboard.replace_title")}</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setChoosing(false)}>
              {t("common.cancel")}
            </button>
          </div>

          {readOnly && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-blush-200 bg-blush-50 p-4 text-sm dark:border-blush-700/60 dark:bg-blush-950/40"
            >
              <Lock size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-blush-700" />
              <p className="text-blush-900 dark:text-blush-100">
                <span className="font-medium">{t("billing.banner_title")}</span>{" "}
                <span className="text-blush-800 dark:text-blush-200">
                  {t("billing.banner_body")}
                </span>
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Upload your own images */}
            <button
              type="button"
              onClick={openFilePicker}
              disabled={uploading}
              className="group flex flex-col items-start gap-2 rounded-2xl border-2 border-dashed border-paper-300 p-5 text-left transition-colors hover:border-blush-300 hover:bg-blush-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 disabled:opacity-60 dark:border-umber-700 dark:hover:border-blush-400/40 dark:hover:bg-blush-400/5"
            >
              <span className="text-blush-700 dark:text-blush-300">
                <UploadCloud size={28} aria-hidden="true" />
              </span>
              <span className="font-grotesk text-[15px] text-ink-900 dark:text-paper-50">
                {uploading ? t("moodboard.uploading") : t("moodboard.choose_upload")}
              </span>
              <span className="text-xs leading-relaxed text-ink-500 dark:text-umber-300">
                {t("moodboard.upload_help")}
              </span>
            </button>

            {/* Link a Pinterest board */}
            <div className="flex flex-col gap-2 rounded-2xl border border-paper-300 p-5 dark:border-umber-700">
              <span className="text-blush-700 dark:text-blush-300">
                <PinterestMark size={26} />
              </span>
              <span className="font-grotesk text-[15px] text-ink-900 dark:text-paper-50">
                {t("moodboard.choose_pinterest")}
              </span>
              <input
                id="moodboard-url"
                type="url"
                className="input h-10 min-h-0 w-full text-base"
                placeholder={t("moodboard.url_placeholder")}
                value={linkDraft}
                onChange={(e) => {
                  setLinkDraft(e.target.value);
                  if (linkError) setLinkError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveLink();
                }}
                aria-invalid={linkError ? true : undefined}
                aria-describedby={linkError ? "moodboard-url-error" : "moodboard-url-help"}
              />
              {linkError ? (
                <p
                  id="moodboard-url-error"
                  className="text-xs text-blush-700 dark:text-blush-300"
                  role="alert"
                >
                  {t(PREVIEW_ERROR_KEY[linkError])}
                </p>
              ) : (
                <p id="moodboard-url-help" className="text-xs text-ink-500 dark:text-umber-300">
                  {t("moodboard.url_help")}
                </p>
              )}
              <button
                type="button"
                className="btn-primary btn-sm self-start"
                onClick={saveLink}
                disabled={!linkDraft.trim()}
              >
                {t("moodboard.save")}
              </button>
            </div>
          </div>
        </div>
      ) : stateLoading || (boardUrl && pinsLoading) || (pins.length > 0 && !gridReady) ? (
        <GridSkeleton label={t("moodboard.loading")} />
      ) : source === "upload" ? (
        // ── Uploaded images ──────────────────────────────────────────────
        state && state.images.length > 0 ? (
          <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
            {state.images.map((img) => (
              <div
                key={img.id}
                className="group relative block break-inside-avoid overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800"
              >
                <img src={img.image_url} alt="" loading="lazy" className="block w-full" />
                <button
                  type="button"
                  onClick={() => deleteImage(img.id)}
                  aria-label={t("moodboard.delete_image")}
                  title={t("moodboard.delete_image")}
                  className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-ink-700 opacity-0 shadow-sm transition-opacity hover:bg-white hover:text-blush-700 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 group-hover:opacity-100 dark:bg-umber-900/90 dark:text-paper-100"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          // Upload source but nothing uploaded yet (mid-flow) — invite more.
          <button
            type="button"
            onClick={openFilePicker}
            disabled={uploading}
            className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-paper-300 p-10 text-center transition-colors hover:border-blush-300 hover:bg-blush-50/40 dark:border-umber-700"
          >
            <span className="text-blush-700 dark:text-blush-300">
              <UploadCloud size={30} aria-hidden="true" />
            </span>
            <span className="font-grotesk text-[15px] text-ink-900 dark:text-paper-50">
              {uploading ? t("moodboard.uploading") : t("moodboard.add_images")}
            </span>
            <span className="text-xs text-ink-500 dark:text-umber-300">
              {t("moodboard.upload_help")}
            </span>
          </button>
        )
      ) : previewError ? (
        // ── Pin scrape failed (preset/pinterest) ─────────────────────────
        <div
          role="alert"
          className="card flex items-start gap-3 border-ink-900 bg-white dark:border-paper-100/40 dark:bg-umber-800"
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-ink-900 dark:bg-umber-700 dark:text-paper-100">
            <AlertTriangle size={18} aria-hidden="true" />
          </span>
          <div className="text-sm">
            <p className="font-medium text-ink-900 dark:text-paper-50">
              {t("moodboard.error_title")}
            </p>
            <p className="mt-1 text-ink-700 dark:text-paper-200">
              {t(PREVIEW_ERROR_KEY[previewError])}
            </p>
          </div>
        </div>
      ) : pins.length > 0 ? (
        <PinGrid pins={pins} />
      ) : null}
    </>
  );
}
