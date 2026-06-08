// Placeholder for the post-wedding photo share. Surfaces the sidebar entry
// today; full content (upload + "send link to every yes RSVP" batch email)
// lands in a follow-up.

import type { Couple, MediaLinks, MediaSource } from "@shared/types";
import { CheckCircle2, ExternalLink, Pencil } from "lucide-react";
import { type FormEvent, type SVGProps, useEffect, useRef, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { useToast } from "../components/ui";
import { coupleApi, feedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** Fixed photo-share slots, in display order: From guests → To guests → By
 *  photographer. The persisted `other` key backs the "To guests" slot (kept as
 *  `other` so no stored value needs migrating). */
const MEDIA_SOURCES: readonly MediaSource[] = ["guests", "other", "photographer"];

const EMPTY_LINKS: MediaLinks = { guests: null, photographer: null, other: null };

/** http(s)-only check, mirroring the backend's parseMediaLink boundary so we
 *  catch typos before the round-trip and show a friendly inline message. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Monochrome Google Drive glyph — lucide ships no brand mark, and the
// placeholder copy already frames the flow around a "Drive link", so the
// dashed source boxes carry the recognisable triangle in a single gray.
function DriveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 87.3 78" fill="currentColor" aria-hidden="true" {...props}>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  );
}

export default function MediaPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Photo-share links live on the couple, so both partners see the same Drive
  // albums. We hold the couple locally and refresh it from the PATCH response
  // after every save instead of re-fetching.
  const [couple, setCouple] = useState<Couple | null>(null);
  const [editing, setEditing] = useState<MediaSource | null>(null);
  const [draft, setDraft] = useState("");
  const [savingSource, setSavingSource] = useState<MediaSource | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Click-outside auto-save: the open card commits its draft the moment you
  // click anywhere off it, the same as hitting Mentés. We keep the live draft
  // in a ref so the document listener (bound once per open) always reads the
  // latest value without re-binding on every keystroke.
  const editingCardRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef("");
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    coupleApi
      .current()
      .then((res) => {
        if (!cancelled) setCouple(res.couple);
      })
      .catch(() => {
        // A failed load just leaves the boxes empty/addable; the save call
        // surfaces any real error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const links: MediaLinks = couple?.media_links ?? EMPTY_LINKS;

  function startEdit(source: MediaSource) {
    setEditing(source);
    setDraft(links[source] ?? "");
    setLinkError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setLinkError(null);
  }

  async function saveLink(source: MediaSource, rawValue: string) {
    const trimmed = rawValue.trim();
    if (trimmed && !isHttpUrl(trimmed)) {
      setLinkError(t("media.collect_invalid"));
      return;
    }
    // Saving the same value is a no-op — just close the editor instead of
    // round-tripping (the backend rejects an empty diff with "No fields to
    // update"). This lets Mentés / click-outside always close cleanly.
    if (trimmed === (links[source] ?? "")) {
      setEditing(null);
      setLinkError(null);
      return;
    }
    setSavingSource(source);
    setLinkError(null);
    try {
      const res = await coupleApi.update({ media_links: { [source]: trimmed || null } });
      setCouple(res.couple);
      setEditing(null);
      toast.success(trimmed ? t("media.collect_saved") : t("media.collect_removed"));
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : t("common.error_generic"));
    } finally {
      setSavingSource(null);
    }
  }

  // Commit the open card when the click lands anywhere outside it. The Mentés /
  // Mégse buttons live inside the card, so they're handled by their own
  // handlers; only off-card clicks trigger this. We re-bind only when the open
  // slot changes; the live draft is read fresh via draftRef.
  useEffect(() => {
    if (!editing) return;
    const source = editing;
    function onPointerDown(e: MouseEvent) {
      const card = editingCardRef.current;
      if (card && !card.contains(e.target as Node)) {
        saveLink(source, draftRef.current);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const msg = message.trim();
    if (!msg) {
      setError(t("media.feedback_empty_error"));
      return;
    }
    setSubmitting(true);
    try {
      await feedbackApi.submit({ source: "app", message: msg, locale });
      setDone(true);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="mb-4 flex items-center gap-2">
        <h1 className="font-grotesk">{t("media.title")}</h1>
        <InfoHint text={t("media.sub")} />
      </header>

      {/* The boxes sit ~30% down the visual area instead of pinning to the
          top — without this nudge the copy floats above a vast empty viewport
          on mobile, reading as "this page is broken" rather than
          "intentionally empty until photos land". The min-h fills the column
          on phone heights and shrinks out of the way on desktop where the
          rest of the shell carries the layout. */}
      <div className="flex min-h-[40vh] flex-col items-center justify-center sm:block sm:min-h-0">
        {/* Where the photos come from — three source boxes the couple fills
            with a Google Drive (or any http(s)) album link. An empty slot is a
            dashed "Add a link" target with a gray Drive glyph; a filled slot
            goes solid, opens the album in a new tab, and offers an inline
            edit. Saved per couple, so both partners share the same albums. */}
        <div className="mt-4 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {MEDIA_SOURCES.map((source) => {
            const url = links[source];
            const isEditing = editing === source;
            const isSaving = savingSource === source;
            const label = t(`media.collect_${source}`);
            return (
              <div
                key={source}
                ref={isEditing ? editingCardRef : undefined}
                className={`flex flex-col items-center gap-2 rounded-2xl px-4 py-6 text-center ${
                  url && !isEditing
                    ? "border-2 border-umber-600 dark:border-umber-400"
                    : "border-2 border-dashed border-ink-200 dark:border-umber-600"
                }`}
              >
                <DriveIcon
                  className={`h-7 w-7 ${
                    url ? "text-umber-600 dark:text-umber-300" : "text-ink-300 dark:text-umber-400"
                  }`}
                />
                <span className="text-sm font-medium text-ink-600 dark:text-paper-100">
                  {label}
                </span>

                {isEditing ? (
                  <form
                    className="mt-1 w-full space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveLink(source, draft);
                    }}
                    noValidate
                  >
                    <input
                      type="url"
                      className="input text-sm"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t("media.collect_placeholder")}
                      aria-label={label}
                      // biome-ignore lint/a11y/noAutofocus: focus the field the
                      // couple just opened so they can paste straight away.
                      autoFocus
                    />
                    {linkError && (
                      <p className="field-error" role="alert">
                        {linkError}
                      </p>
                    )}
                    <div className="flex justify-center gap-2">
                      <button type="submit" className="btn-primary btn-sm" disabled={isSaving}>
                        {isSaving ? t("common.saving") : t("common.save")}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={cancelEdit}
                        disabled={isSaving}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </form>
                ) : url ? (
                  <div className="mt-1 flex flex-col items-center gap-1">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-umber-700 underline-offset-2 hover:underline dark:text-umber-200"
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      {t("media.collect_open")}
                    </a>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
                      onClick={() => startEdit(source)}
                    >
                      <Pencil size={12} aria-hidden="true" />
                      {t("common.edit")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost btn-sm mt-1"
                    onClick={() => startEdit(source)}
                  >
                    {t("media.collect_add")}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Inline feedback — we ask couples what they actually want before
            we build it. POST lands in the same admin inbox the landing-page
            dialog uses (source: "app"), so triage stays in one place. Kept
            deliberately compact (p-4, tight spacing, single-line textarea)
            so it reads as a small footnote under the source boxes, not a
            second hero. */}
        <div className="card mt-4 w-full p-4">
          {done ? (
            <div className="flex items-center gap-2 text-center sm:text-left">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
                <CheckCircle2 size={18} aria-hidden="true" />
              </span>
              <p className="text-sm text-ink-700 dark:text-paper-100">
                {t("media.feedback_success")}
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-2" noValidate>
              <div>
                <h2 className="font-grotesk text-base">{t("media.feedback_title")}</h2>
                <p className="text-xs text-ink-600 dark:text-umber-200">
                  {t("media.feedback_intro")}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <textarea
                  className="input min-h-tap flex-1 resize-y py-1.5 text-sm leading-snug"
                  rows={1}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("media.feedback_placeholder")}
                  maxLength={2000}
                  aria-label={t("media.feedback_title")}
                />
                <button type="submit" className="btn-primary btn-sm shrink-0" disabled={submitting}>
                  {submitting ? t("media.feedback_submitting") : t("media.feedback_submit")}
                </button>
              </div>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </>
  );
}
