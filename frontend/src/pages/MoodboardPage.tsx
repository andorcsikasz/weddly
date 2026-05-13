// Moodboard — embeds a Pinterest board the couple links. The widget script
// (assets.pinterest.com/js/pinit.js) replaces a marker <a data-pin-do=...>
// with an iframe full of pins, so no backend or API key is needed; the URL
// itself is the entire persisted state and lives in localStorage.

import { ExternalLink, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useToast } from "../components/ui";
import { useT } from "../lib/i18n";

const STORAGE_KEY = "weddly.moodboard_url";
const PIN_SCRIPT_SRC = "https://assets.pinterest.com/js/pinit.js";

declare global {
  interface Window {
    PinUtils?: { build: (root?: HTMLElement) => void };
  }
}

function isPinterestBoardUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)pinterest\.[a-z.]+$/i.test(u.hostname)) return false;
    // Board URLs look like /<username>/<board>/ — require at least two segments
    // so a bare profile link doesn't silently embed an empty widget.
    return u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function loadPinterestWidgetScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.PinUtils) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${PIN_SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      // pinit.js evaluates on load — poll briefly in case the previous mount
      // injected it but it hasn't finished parsing yet.
      let tries = 0;
      const id = window.setInterval(() => {
        tries += 1;
        if (window.PinUtils) {
          window.clearInterval(id);
          resolve();
        } else if (tries > 40) {
          window.clearInterval(id);
          reject(new Error("pinit.js never initialised"));
        }
      }, 50);
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PIN_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("pinit.js failed to load"));
    document.body.appendChild(s);
  });
}

export default function MoodboardPage() {
  const { t } = useT();
  const toast = useToast();
  const [url, setUrl] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  });
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(!url);
  const embedRoot = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!url || editing) return;
    const node = embedRoot.current;
    if (!node) return;
    // Replace any previous widget output so a URL change re-renders cleanly.
    node.innerHTML = "";
    const a = document.createElement("a");
    a.setAttribute("data-pin-do", "embedBoard");
    a.setAttribute("data-pin-board-width", "740");
    a.setAttribute("data-pin-scale-height", "320");
    a.setAttribute("data-pin-scale-width", "115");
    a.setAttribute("href", url);
    node.appendChild(a);
    loadPinterestWidgetScript()
      .then(() => window.PinUtils?.build(node))
      .catch(() => toast.error(t("common.error_generic")));
  }, [url, editing, t, toast]);

  function commit() {
    const trimmed = draft.trim();
    if (!isPinterestBoardUrl(trimmed)) {
      toast.error(t("moodboard.invalid_url"));
      return;
    }
    setUrl(trimmed);
    try {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      /* localStorage blocked — fine, the embed still works for this session */
    }
    setEditing(false);
  }

  function clear() {
    setUrl("");
    setDraft("");
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
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
            />
            <p className="text-xs text-ink-500 dark:text-umber-300">{t("moodboard.url_help")}</p>
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
          <div ref={embedRoot} className="overflow-hidden rounded-2xl" />
        </>
      )}
    </AppShell>
  );
}
