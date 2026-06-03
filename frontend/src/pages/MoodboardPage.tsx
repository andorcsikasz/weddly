// Moodboard — renders pins from a public Pinterest board the couple links.
// The backend proxies the board's RSS feed (browsers can't reach Pinterest
// directly because of CORS, and the official widget script is unreliable),
// so this page is a pure render-the-list-of-{image_url, link_url} grid.
// Typed error codes from the proxy drive specific copy for private/missing/
// empty boards rather than a blank failure state.

import type { MoodboardPin } from "@shared/types";
import { AlertTriangle, ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { Skeleton } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { coupleApi, moodboardApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const STORAGE_KEY = "weddly.moodboard_url";

// Personal default — only auto-applies for the owner's real workspace.
// Computed at render time (never written to localStorage) so it doesn't
// bleed into the demo couple when switching workspaces in the same browser.
const PERSONAL_OWNER_EMAIL = "andor.csikasz@gmail.com";
const PERSONAL_DEFAULT_URL = "https://hu.pinterest.com/andorcsikasz/when-i-get-married/";

// Demo workspace default — every ephemeral Shrek & Fiona couple lands on
// /app/moodboard with this Pinterest board prefilled, so the page reads as
// populated. Mirrors the owner pattern above: applied at render time, never
// written to localStorage (which is browser-wide and would leak the URL into
// a subsequent real workspace on the same machine).
const DEMO_DEFAULT_URL = "https://hu.pinterest.com/weddlyxyz/when-i-get-married/";

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

/** Pinterest brand mark — inlined as SVG (no CDN/third-party request, same
 *  privacy stance as the rest of the app). Monochrome via `currentColor`, so it
 *  inherits the surrounding blush tint of its container. */
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

export default function MoodboardPage() {
  const { t } = useT();
  const { user } = useAuth();
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

  // Auto-prefill a Pinterest board when the workspace lands on /app/moodboard
  // with nothing saved yet. Two cases:
  //   - Demo couple → the wēddly board ("when I get married"), so the visitor
  //     sees a populated grid the first time they open the moodboard.
  //   - Owner's real workspace → the personal board (kept for parity with the
  //     pre-demo behaviour).
  // Neither writes to localStorage: that key is browser-wide and persisting
  // would leak the URL into the other kind of workspace on the same device.
  useEffect(() => {
    if (url) return;
    if (!user) return;
    let cancelled = false;
    coupleApi
      .current()
      .then((res) => {
        if (cancelled || !res.couple) return;
        if (res.couple.is_demo) {
          setUrl(DEMO_DEFAULT_URL);
          setDraft(DEMO_DEFAULT_URL);
          setEditing(false);
          return;
        }
        if (user.email === PERSONAL_OWNER_EMAIL) {
          setUrl(PERSONAL_DEFAULT_URL);
          setDraft(PERSONAL_DEFAULT_URL);
          setEditing(false);
        }
      })
      .catch(() => {
        /* non-critical — the empty form is the safe fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [user, url]);

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
    <>
      <header className="mb-6 flex items-center gap-2">
        <h1 className="font-grotesk">{t("moodboard.title")}</h1>
        <InfoHint text={t("moodboard.sub")} />
      </header>

      {showForm ? (
        <div className="card flex flex-col gap-4">
          {!url ? (
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blush-50 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
                <PinterestMark size={22} />
              </span>
              <div>
                <h2 className="font-grotesk text-xl">{t("moodboard.empty_title")}</h2>
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
          {/* Source-pin card — slimmed on mobile (`p-3` + `flex-nowrap` so
           *  the Pinterest link + Csere / Eltávolítás buttons share one
           *  row instead of stacking with the desktop `p-6`). The card
           *  utility class still wins on tablet+ via the `sm:` overrides.
           *  Vertical padding is halved on desktop (`sm:py-3` vs the card's
           *  `p-6`) so the bar stays short — it only holds one row. */}
          <div className="card mb-4 flex flex-nowrap items-center justify-between gap-2 p-3 sm:gap-3 sm:px-6 sm:py-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 truncate text-sm text-ink-700 underline-offset-4 hover:underline dark:text-paper-100"
            >
              <ExternalLink size={14} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{t("moodboard.open_in_pinterest")}</span>
            </a>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
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
                aria-label={t("moodboard.clear")}
                title={t("moodboard.clear")}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span className="hidden sm:inline">{t("moodboard.clear")}</span>
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
    </>
  );
}
