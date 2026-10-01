import { CheckCircle2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { feedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Switch } from "./ui/Switch";

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
  /** In-app route the dialog was opened from (e.g. "/app/media"). Passed
   *  through to the backend so the admin triage list can label which surface
   *  the feedback is about, not just "App". App-source only. */
  context?: string;
  /** Optional sentence shown above the form intro — used by the survey prompt
   *  to set emotional context before the fields. */
  preface?: string;
  /** Reply address to start with, and the "want a reply" box already ticked.
   *  Set when the dialog was opened from a link WE mailed to a known address
   *  (the pause follow-up): the answer then lands attributed instead of as an
   *  anonymous landing-page note, without asking the sender to retype their own
   *  address. Still editable, and still clearable by unticking the box. */
  initialEmail?: string | null;
};

export function FeedbackDialog({
  open,
  onClose,
  source = "landing",
  context,
  preface,
  initialEmail,
}: FeedbackDialogProps) {
  const { t, locale } = useT();
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [wantReply, setWantReply] = useState(Boolean(initialEmail));
  const [email, setEmail] = useState(initialEmail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The dialog stays mounted with `open` toggling, so the initial-state
  // arguments above only ever see the first render. The prefill arrives one
  // tick later (the shell reads it off the query string in its own effect), so
  // adopt it when it shows up.
  useEffect(() => {
    if (!initialEmail) return;
    setEmail(initialEmail);
    setWantReply(true);
  }, [initialEmail]);

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
        context: source === "app" ? context : undefined,
        // Full URL (incl. query string) so admins can reproduce the exact
        // page; the backend also derives device/browser/os from the request.
        url: typeof window !== "undefined" ? window.location.href : undefined,
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

  // The hint reads "1 = not for us, 10 = exactly what we needed" in every
  // locale; the scale wants its two ends under its two ends, so split it there
  // and fall back to the whole sentence if a translation ever drops the shape.
  const hintEnds = t("landing.feedback_rating_hint")
    .split(/,\s*(?=\d+\s*=)/)
    .map((part) => part.replace(/^\d+\s*=\s*/, "").trim());
  const [lowLabel, highLabel] = hintEnds.length === 2 ? hintEnds : [null, null];

  return (
    <Dialog
      open={open}
      title={done ? t("landing.feedback_success_title") : t("landing.feedback_title")}
      titleClassName="text-2xl font-bold tracking-tight"
      role="dialog"
      onClose={resetAndClose}
      closeOnBackdrop={!submitting}
      footer={
        done ? (
          <Button variant="primary" onClick={resetAndClose} className={SOLID_BUTTON}>
            OK
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={resetAndClose} disabled={submitting}>
              {t("landing.feedback_cancel")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="feedback-form"
              disabled={submitting}
              className={SOLID_BUTTON}
            >
              {submitting ? t("landing.feedback_submitting") : t("landing.feedback_submit")}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-start gap-4 py-2">
          <CheckCircle2
            size={40}
            strokeWidth={1.5}
            className="text-ink-900 dark:text-paper-50"
            aria-hidden
          />
          <p className="text-base text-ink-700 dark:text-paper-100">
            {t("landing.feedback_success_body")}
          </p>
        </div>
      ) : (
        <form id="feedback-form" onSubmit={onSubmit} className="space-y-7" noValidate>
          <div className="space-y-1">
            {preface && <p className="text-base text-ink-900 dark:text-paper-50">{preface}</p>}
            <p className="text-sm text-ink-500 dark:text-umber-300">
              {t("landing.feedback_intro")}
            </p>
          </div>

          {/* Segment 1 — free text */}
          <div className="space-y-2">
            <label htmlFor="fb-message" className={SECTION_LABEL}>
              {t("landing.feedback_message_label")}
            </label>
            <textarea
              id="fb-message"
              className={`${FILLED_FIELD} min-h-[7.5rem] resize-y`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("landing.feedback_message_placeholder")}
              maxLength={2000}
            />
          </div>

          {/* Segment 2 — 1–10 rating on a slider. Unanswered is a real state
              (the rating is optional), so the thumb sits mid-track, faded, with
              no number until the visitor touches it. */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor="fb-rating" className={SECTION_LABEL}>
                {t("landing.feedback_rating_label")}
              </label>
              <span
                className="min-w-[2ch] text-right text-3xl font-bold tabular-nums leading-none text-ink-900 dark:text-paper-50"
                aria-hidden
              >
                {rating ?? ""}
              </span>
            </div>
            <div className="relative flex h-8 items-center">
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-paper-200 dark:bg-umber-700" />
              {rating !== null && (
                <div
                  className="absolute left-0 h-1.5 rounded-full bg-ink-900 dark:bg-paper-50"
                  style={{ width: `${((rating - 1) / 9) * 100}%` }}
                />
              )}
              <input
                id="fb-rating"
                type="range"
                min={1}
                max={10}
                step={1}
                value={rating ?? 5}
                aria-valuetext={rating === null ? "" : String(rating)}
                onChange={(e) => setRating(Number(e.target.value))}
                onPointerDown={(e) => {
                  // A click on the thumb at its resting 5 fires no change
                  // event, so an untouched slider would never register it.
                  if (rating === null) setRating(Number(e.currentTarget.value));
                }}
                className={`${RANGE_INPUT} ${rating === null ? "[&::-moz-range-thumb]:opacity-60 [&::-webkit-slider-thumb]:opacity-60" : ""}`}
              />
            </div>
            {lowLabel && highLabel ? (
              <div className="flex justify-between gap-4 text-xs text-ink-500 dark:text-umber-300">
                <span>{lowLabel}</span>
                <span className="text-right">{highLabel}</span>
              </div>
            ) : (
              <p className="text-xs text-ink-500 dark:text-umber-300">
                {t("landing.feedback_rating_hint")}
              </p>
            )}
          </div>

          {/* Reply opt-in. The email field is hidden by default so the form
              reads as "two questions" instead of three — most visitors want
              to drop a thought, not start a thread, and surfacing the email
              up-front was a measurable friction point. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 border-t border-paper-200 pt-5 dark:border-umber-700">
              <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
                {t("landing.feedback_reply_optin")}
              </span>
              <Switch
                checked={wantReply}
                label={t("landing.feedback_reply_optin")}
                onChange={(next) => {
                  setWantReply(next);
                  if (!next) setEmail("");
                }}
              />
            </div>
            {wantReply && (
              <div className="space-y-1.5">
                <label htmlFor="fb-email" className="sr-only">
                  {t("landing.feedback_email_label")}
                </label>
                <input
                  id="fb-email"
                  type="email"
                  className={FILLED_FIELD}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("landing.feedback_email_label")}
                  autoComplete="email"
                  maxLength={200}
                />
                <p className="text-xs text-ink-500 dark:text-umber-300">
                  {t("landing.feedback_email_help")}
                </p>
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

const SECTION_LABEL = "block text-sm font-semibold text-ink-900 dark:text-paper-50";

/** Transparent native range over the drawn track: keeps keyboard + touch
 *  behaviour for free, only the thumb is restyled. */
const RANGE_INPUT =
  "relative w-full cursor-pointer appearance-none bg-transparent focus:outline-none [&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-ink-900 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-soft [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink-900 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-soft [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-110 focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-ink-900/15 dark:[&::-moz-range-thumb]:border-paper-50 dark:[&::-webkit-slider-thumb]:border-paper-50";

/** Borderless grey well, black ring on focus. */
const FILLED_FIELD =
  "block w-full rounded-xl border-0 bg-paper-100 px-4 py-3 text-base text-ink-900 placeholder:text-ink-400 transition-shadow focus:bg-white focus:outline-none focus:ring-2 focus:ring-ink-900 dark:bg-umber-900 dark:text-paper-50 dark:placeholder:text-umber-400 dark:focus:bg-umber-900 dark:focus:ring-paper-50";

/** Monochrome primary: this dialog is black-on-white end to end. */
const SOLID_BUTTON =
  "!border-ink-900 !bg-ink-900 !text-paper-50 hover:!bg-ink-800 dark:!border-paper-50 dark:!bg-paper-50 dark:!text-ink-900 dark:hover:!bg-paper-200";
