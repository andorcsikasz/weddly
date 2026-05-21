import { CheckCircle2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { feedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

/**
 * Public feedback dialog. Two visible segments — message + 1–10 rating —
 * plus an opt-in checkbox that reveals an email field for visitors who
 * actually want a reply. The earlier monthly-value slider was removed:
 * it surfaced a third numeric input that pushed the form over the
 * "asks too many things" threshold without giving us decision-grade
 * signal, and the EUR/HUF unit ambiguity made the admin column unreadable.
 */
type FeedbackDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Surface the dialog was opened from. The backend persists this so admins
   *  can triage landing-page vs in-product feedback separately. */
  source?: "landing" | "app";
};

export function FeedbackDialog({ open, onClose, source = "landing" }: FeedbackDialogProps) {
  const { t, locale } = useT();
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [wantReply, setWantReply] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function resetAndClose() {
    setMessage("");
    setRating(null);
    setWantReply(false);
    setEmail("");
    setError(null);
    setDone(false);
    onClose();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const msg = message.trim();
    if (!msg && rating === null) {
      setError(t("landing.feedback_empty_error"));
      return;
    }
    setSubmitting(true);
    try {
      await feedbackApi.submit({
        source,
        message: msg || undefined,
        rating: rating ?? undefined,
        from_email: wantReply ? email.trim() || undefined : undefined,
        locale,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={done ? t("landing.feedback_success_title") : t("landing.feedback_title")}
      role="dialog"
      onClose={resetAndClose}
      closeOnBackdrop={!submitting}
      footer={
        done ? (
          <Button variant="primary" onClick={resetAndClose}>
            OK
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={resetAndClose} disabled={submitting}>
              {t("landing.feedback_cancel")}
            </Button>
            <Button variant="primary" type="submit" form="feedback-form" disabled={submitting}>
              {submitting ? t("landing.feedback_submitting") : t("landing.feedback_submit")}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-blush-100 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
            <CheckCircle2 size={26} />
          </span>
          <p className="text-base text-ink-800 dark:text-paper-100">
            {t("landing.feedback_success_body")}
          </p>
        </div>
      ) : (
        <form id="feedback-form" onSubmit={onSubmit} className="space-y-6" noValidate>
          <p className="text-sm text-ink-600 dark:text-umber-200">{t("landing.feedback_intro")}</p>

          {/* Segment 1 — free text */}
          <div>
            <label htmlFor="fb-message" className="field-label">
              {t("landing.feedback_message_label")}
            </label>
            <textarea
              id="fb-message"
              className="input min-h-[7rem] resize-y"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("landing.feedback_message_placeholder")}
              maxLength={2000}
            />
          </div>

          {/* Segment 2 — 1–10 rating. Buttons sit on a single row at all
              breakpoints; we shrink the chip size and gap so the full set
              fits even on a 320 px iPhone SE without wrapping. */}
          <div>
            <p className="field-label">{t("landing.feedback_rating_label")}</p>
            <div
              role="radiogroup"
              aria-label={t("landing.feedback_rating_label")}
              className="mt-1 grid grid-cols-10 gap-1 sm:gap-1.5"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const selected = rating === n;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setRating(selected ? null : n)}
                    className={
                      selected
                        ? "aspect-square w-full rounded-full bg-ink-900 text-xs font-medium text-paper-100 transition-colors sm:text-sm dark:bg-umber-600 dark:text-paper-50"
                        : "aspect-square w-full rounded-full border border-paper-300 bg-white text-xs text-ink-700 transition-colors hover:border-ink-500 hover:bg-paper-100 sm:text-sm dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-700"
                    }
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 flex justify-between text-xs text-ink-500 dark:text-umber-300">
              <span>
                {t("landing.feedback_rating_low")} — {t("landing.feedback_rating_hint")}
              </span>
            </p>
          </div>

          {/* Reply opt-in. The email field is hidden by default so the form
              reads as "two questions" instead of three — most visitors want
              to drop a thought, not start a thread, and surfacing the email
              up-front was a measurable friction point. */}
          <div>
            <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-paper-400 accent-blush-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-600"
                checked={wantReply}
                onChange={(e) => {
                  setWantReply(e.target.checked);
                  if (!e.target.checked) setEmail("");
                }}
              />
              {t("landing.feedback_reply_optin")}
            </label>
            {wantReply && (
              <div className="mt-3">
                <label htmlFor="fb-email" className="field-label">
                  {t("landing.feedback_email_label")}
                </label>
                <input
                  id="fb-email"
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  maxLength={200}
                />
                <p className="field-help">{t("landing.feedback_email_help")}</p>
              </div>
            )}
          </div>

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}
