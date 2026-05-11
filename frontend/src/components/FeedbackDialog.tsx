import { CheckCircle2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { feedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

/**
 * Public feedback dialog. Three independent segments — message, 1–10
 * rating, monthly-value slider (0–15 000 Ft) — plus an optional reply
 * email. Submitting POSTs to /api/feedback, which forwards to the team
 * inbox. All fields are optional; the backend rejects only an empty
 * payload (no message + no rating + no monthly value).
 */
type FeedbackDialogProps = {
  open: boolean;
  onClose: () => void;
};

const MONTHLY_MAX = 15000;
const MONTHLY_STEP = 500;

export function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
  const { t, locale } = useT();
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function resetAndClose() {
    setMessage("");
    setRating(null);
    setMonthly(null);
    setEmail("");
    setError(null);
    setDone(false);
    onClose();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const msg = message.trim();
    if (!msg && rating === null && monthly === null) {
      setError(t("landing.feedback_empty_error"));
      return;
    }
    setSubmitting(true);
    try {
      await feedbackApi.submit({
        message: msg || undefined,
        rating: rating ?? undefined,
        monthly_value_ft: monthly ?? undefined,
        from_email: email.trim() || undefined,
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
            {t("common.cancel").replace(/.*/, "OK")}
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
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-blush-100 text-blush-700">
            <CheckCircle2 size={26} />
          </span>
          <p className="text-base text-ink-800">{t("landing.feedback_success_body")}</p>
        </div>
      ) : (
        <form id="feedback-form" onSubmit={onSubmit} className="space-y-6" noValidate>
          <p className="text-sm text-ink-600">{t("landing.feedback_intro")}</p>

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

          {/* Segment 2 — 1–10 rating */}
          <div>
            <p className="field-label">{t("landing.feedback_rating_label")}</p>
            <div
              role="radiogroup"
              aria-label={t("landing.feedback_rating_label")}
              className="mt-1 flex flex-wrap gap-1.5"
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
                        ? "h-9 w-9 rounded-full bg-ink-900 text-sm font-medium text-paper-100 transition-colors"
                        : "h-9 w-9 rounded-full border border-paper-300 bg-white text-sm text-ink-700 transition-colors hover:border-ink-500 hover:bg-paper-100"
                    }
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 flex justify-between text-xs text-ink-500">
              <span>
                {t("landing.feedback_rating_low")} — {t("landing.feedback_rating_hint")}
              </span>
            </p>
          </div>

          {/* Segment 3 — monthly value slider */}
          <div>
            <p className="field-label">{t("landing.feedback_monthly_label")}</p>
            <div className="mt-1">
              <input
                type="range"
                min={0}
                max={MONTHLY_MAX}
                step={MONTHLY_STEP}
                value={monthly ?? 0}
                onChange={(e) => setMonthly(Number(e.target.value))}
                className="range-fill w-full"
                style={{
                  background: `linear-gradient(to right, var(--color-mode-accent) 0%, var(--color-mode-accent) ${
                    ((monthly ?? 0) / MONTHLY_MAX) * 100
                  }%, var(--color-paper-200, #efe9d9) ${
                    ((monthly ?? 0) / MONTHLY_MAX) * 100
                  }%, var(--color-paper-200, #efe9d9) 100%)`,
                }}
                aria-label={t("landing.feedback_monthly_label")}
              />
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-ink-500">
                  {monthly === null || monthly === 0
                    ? t("landing.feedback_monthly_zero")
                    : `${monthly.toLocaleString(locale === "hu" ? "hu" : "en")} Ft`}
                </span>
                <span className="text-xs text-ink-500">{t("landing.feedback_monthly_hint")}</span>
              </div>
            </div>
          </div>

          {/* Optional reply email */}
          <div>
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
