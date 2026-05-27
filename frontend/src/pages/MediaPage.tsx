// Placeholder for the post-wedding photo share. Surfaces the sidebar entry
// today; full content (upload + "send link to every yes RSVP" batch email)
// lands in a follow-up.

import { Camera, CheckCircle2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { feedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

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
      <header className="mb-4">
        <h1>{t("media.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("media.sub")}</p>
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
            <h2 className="font-serif text-xl">{t("media.coming_soon_title")}</h2>
            <p className="mt-1 text-sm text-ink-700 dark:text-paper-100">
              {t("media.coming_soon_body")}
            </p>
          </div>
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
                <h2 className="font-serif text-lg">{t("media.feedback_title")}</h2>
                <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
                  {t("media.feedback_intro")}
                </p>
              </div>
              <textarea
                className="input min-h-[6rem] resize-y"
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
