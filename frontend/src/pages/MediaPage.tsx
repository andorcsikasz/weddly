// Placeholder for the post-wedding photo share. Surfaces the sidebar entry
// today; full content (upload + "send link to every yes RSVP" batch email)
// lands in a follow-up.

import { Camera, CheckCircle2 } from "lucide-react";
import { type FormEvent, type SVGProps, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { feedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

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
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
        <span className="inline-flex shrink-0 items-center rounded-full border border-umber-300 bg-umber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-umber-700 dark:border-umber-600 dark:bg-umber-700/40 dark:text-umber-200">
          {t("media.dev_badge")}
        </span>
        <InfoHint text={t("media.sub")} />
      </header>

      {/* The card sits ~30% down the visual area instead of pinning to the
          top — without this nudge the "Coming soon" copy floats above a
          vast empty viewport on mobile, reading as "this page is broken"
          rather than "this page is intentionally empty until photos
          land". The min-h fills the column on phone heights and shrinks
          out of the way on desktop where the rest of the shell carries
          the layout. */}
      <div className="flex min-h-[40vh] flex-col items-center justify-center sm:block sm:min-h-0">
        <div className="card flex w-full flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blush-50 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
            <Camera size={22} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-grotesk text-xl">{t("media.coming_soon_title")}</h2>
            <p className="mt-1 text-sm text-ink-700 dark:text-paper-100">
              {t("media.coming_soon_body")}
            </p>
          </div>
        </div>

        {/* Where the photos will come from — three dashed source boxes the
            future flow will wire up (guest uploads, photographer drop, a
            catch-all "other"). Outline-only + gray Drive glyph signals they
            are placeholders, not live actions yet. */}
        <div className="mt-4 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { key: "guests", label: t("media.collect_guests") },
            { key: "photographer", label: t("media.collect_photographer") },
            { key: "other", label: t("media.collect_other") },
          ].map((box) => (
            <div
              key={box.key}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 px-4 py-6 text-center dark:border-umber-600"
            >
              <DriveIcon className="h-7 w-7 text-ink-300 dark:text-umber-400" />
              <span className="text-sm font-medium text-ink-600 dark:text-paper-100">
                {box.label}
              </span>
            </div>
          ))}
        </div>

        {/* Inline feedback — we ask couples what they actually want before
            we build it. POST lands in the same admin inbox the landing-page
            dialog uses (source: "app"), so triage stays in one place. */}
        <div className="card mt-4 w-full">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center sm:flex-row sm:text-left">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
                <CheckCircle2 size={22} aria-hidden="true" />
              </span>
              <p className="text-sm text-ink-700 dark:text-paper-100">
                {t("media.feedback_success")}
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3" noValidate>
              <div>
                <h2 className="font-grotesk text-lg">{t("media.feedback_title")}</h2>
                <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
                  {t("media.feedback_intro")}
                </p>
              </div>
              <textarea
                className="input min-h-[2rem] resize-y"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("media.feedback_placeholder")}
                maxLength={2000}
                aria-label={t("media.feedback_title")}
              />
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              <div className="flex justify-end">
                <button type="submit" className="btn-primary btn-sm" disabled={submitting}>
                  {submitting ? t("media.feedback_submitting") : t("media.feedback_submit")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
