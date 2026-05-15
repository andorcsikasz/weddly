// Moodboard — renders pins from a public Pinterest board the couple links.
// The backend proxies the board's RSS feed (browsers can't reach Pinterest
// directly because of CORS, and the official widget script is unreliable),
// so this page is a pure render-the-list-of-{image_url, link_url} grid.
// Typed error codes from the proxy drive specific copy for private/missing/
// empty boards rather than a blank failure state.

import type { MoodboardPin } from "@shared/types";
import { AlertTriangle, ExternalLink, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Skeleton } from "../components/ui";
import { ApiError } from "../lib/api";
import { moodboardApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const STORAGE_KEY = "weddly.moodboard_url";

type ErrorCode = "invalid_url" | "not_found" | "private" | "empty" | "fetch_failed";

const ERROR_KEY: Record<ErrorCode, string> = {
  invalid_url: "moodboard.invalid_url",
  not_found: "moodboard.error_not_found",
  private: "moodboard.error_private",
  empty: "moodboard.error_empty",
  fetch_failed: "moodboard.error_fetch",
};

function isPinterestBoardUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)pinterest\.[a-z.]+$/i.test(u.hostname)) return false;
    return u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function classifyError(err: unknown): ErrorCode {
  if (err instanceof ApiError) {
    const detail = err.detail as { code?: string } | null | undefined;
    const code = detail?.code;
    if (code === "invalid_url") return "invalid_url";
    if (code === "not_found") return "not_found";
    if (code === "private") return "private";
    if (code === "empty") return "empty";
  }
  // Network/timeout/5xx/anything else — Pinterest hiccup or our proxy.
  return "fetch_failed";
}

export default function MoodboardPage() {
  const { t } = useT();
  const [url, setUrl] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  });
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(!url);
  const [pins, setPins] = useState<MoodboardPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<ErrorCode | null>(null);
  const [previewError, setPreviewError] = useState<ErrorCode | null>(null);

  useEffect(() => {
    if (!url || editing) return;
    let cancelled = false;
    setLoading(true);
    setPreviewError(null);
    moodboardApi
      .preview(url)
      .then((res) => {
        if (cancelled) return;
        setPins(res.pins);
      })
      .catch((err) => {
        if (cancelled) return;
        setPins([]);
        setPreviewError(classifyError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, editing]);

  function commit() {
    const trimmed = draft.trim();
    if (!isPinterestBoardUrl(trimmed)) {
      setFormError("invalid_url");
      return;
    }
    setFormError(null);
    setUrl(trimmed);
    try {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      /* localStorage blocked — fine, the page still works for this session */
    }
    setEditing(false);
  }

  function clear() {
    setUrl("");
    setDraft("");
    setPins([]);
    setPreviewError(null);
    setFormError(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* */
    }
    setEditing(true);
  }

  const showForm = editing || !url;

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("moodboard.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("moodboard.sub")}</p>
      </header>

      {showForm ? (
        <div className="card flex flex-col gap-4">
          {!url ? (
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blush-50 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
                <Sparkles size={22} aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-serif text-xl">{t("moodboard.empty_title")}</h2>
                <p className="mt-1 text-sm text-ink-700 dark:text-paper-100">
                  {t("moodboard.empty_body")}
                </p>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium text-ink-800 dark:text-paper-100"
              htmlFor="moodboard-url"
            >
              {t("moodboard.url_label")}
            </label>
            <input
              id="moodboard-url"
              type="url"
              className="input h-10 min-h-0 w-full text-base"
              placeholder={t("moodboard.url_placeholder")}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (formError) setFormError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError ? "moodboard-url-error" : "moodboard-url-help"}
            />
            {formError ? (
              <p
                id="moodboard-url-error"
                className="text-xs text-blush-700 dark:text-blush-300"
                role="alert"
              >
                {t(ERROR_KEY[formError])}
              </p>
            ) : (
              <p id="moodboard-url-help" className="text-xs text-ink-500 dark:text-umber-300">
                {t("moodboard.url_help")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={commit}>
              {t("moodboard.save")}
            </button>
            {url ? (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setDraft(url);
                  setFormError(null);
                  setEditing(false);
                }}
              >
                {t("common.cancel")}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-ink-700 underline-offset-4 hover:underline dark:text-paper-100"
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t("moodboard.open_in_pinterest")}
            </a>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setDraft(url);
                  setEditing(true);
                }}
              >
                {t("moodboard.change")}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm inline-flex items-center gap-1"
                onClick={clear}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t("moodboard.clear")}
              </button>
            </div>
          </div>

          {loading ? (
            <div
              className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3"
              role="status"
              aria-live="polite"
              aria-label={t("moodboard.loading")}
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
          ) : previewError ? (
            <div
              role="alert"
              className="card flex items-start gap-3 border-blush-300 bg-blush-50 dark:border-blush-400/40 dark:bg-blush-500/15"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blush-100 text-blush-700 dark:bg-blush-400/20 dark:text-blush-200">
                <AlertTriangle size={18} aria-hidden="true" />
              </span>
              <div className="text-sm">
                <p className="font-medium text-blush-900 dark:text-blush-100">
                  {t("moodboard.error_title")}
                </p>
                <p className="mt-1 text-blush-800 dark:text-blush-100">
                  {t(ERROR_KEY[previewError])}
                </p>
              </div>
            </div>
          ) : pins.length > 0 ? (
            <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
              {pins.map((pin) => (
                <a
                  key={pin.link_url}
                  href={pin.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-inside-avoid overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 transition-shadow hover:shadow-md dark:border-umber-700 dark:bg-umber-800"
                >
                  <img
                    src={pin.image_url}
                    alt={pin.title ?? ""}
                    loading="lazy"
                    className="block w-full"
                  />
                </a>
              ))}
            </div>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
