import { type FormEvent, useState } from "react";
import { useT } from "../lib/i18n";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

/**
 * Mini exit form shown right before a couple pauses (and schedules deletion of)
 * their workspace. We ask the single highest-signal question (why) so churn
 * has a paper trail without turning the off-ramp into a survey.
 *
 * The `en` field is the canonical string persisted to
 * `couple_pause_requests.reason`, so the admin triage / audit trail reads the
 * same regardless of the UI locale; `labelKey` only drives the localized chip.
 */
const PAUSE_REASONS = [
  {
    id: "wedding_done",
    labelKey: "profile.pause_reason_opt_wedding_done",
    en: "Wedding already happened",
  },
  {
    id: "postponed",
    labelKey: "profile.pause_reason_opt_postponed",
    en: "Wedding postponed or called off",
  },
  {
    id: "missing_features",
    labelKey: "profile.pause_reason_opt_missing_features",
    en: "Missing features",
  },
  {
    id: "too_expensive",
    labelKey: "profile.pause_reason_opt_too_expensive",
    en: "Too expensive",
  },
  {
    id: "taking_break",
    labelKey: "profile.pause_reason_opt_taking_break",
    en: "Just taking a break",
  },
  { id: "other", labelKey: "profile.pause_reason_opt_other", en: "Other" },
] as const;

type PauseReasonDialogProps = {
  open: boolean;
  onCancel: () => void;
  /** Receives the composed reason (canonical EN label + optional note). The
   *  parent then runs the type-the-phrase confirmation + pause request. */
  onSubmit: (reason: string) => void;
};

export function PauseReasonDialog({ open, onCancel, onSubmit }: PauseReasonDialogProps) {
  const { t } = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSelected(null);
    setNote("");
    setError(null);
  }

  function cancel() {
    reset();
    onCancel();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const chosen = PAUSE_REASONS.find((r) => r.id === selected);
    if (!chosen) {
      setError(t("profile.pause_reason_required"));
      return;
    }
    const trimmed = note.trim();
    const reason = trimmed ? `${chosen.en} (${trimmed})` : chosen.en;
    reset();
    onSubmit(reason);
  }

  return (
    <Dialog
      open={open}
      title={t("profile.pause_reason_title")}
      role="dialog"
      onClose={cancel}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="pause-reason-form">
            {t("profile.pause_reason_continue")}
          </Button>
        </>
      }
    >
      <form id="pause-reason-form" onSubmit={submit} className="space-y-5" noValidate>
        <p className="text-sm text-ink-600 dark:text-umber-200">
          {t("profile.pause_reason_intro")}
        </p>

        <div role="radiogroup" aria-label={t("profile.pause_reason_title")} className="space-y-2">
          {PAUSE_REASONS.map((r) => {
            const checked = selected === r.id;
            return (
              <label
                key={r.id}
                className={
                  checked
                    ? "flex cursor-pointer items-center gap-3 rounded-xl border border-ink-700 bg-paper-100 px-4 py-3 text-sm text-ink-800 dark:border-umber-500 dark:bg-umber-700 dark:text-paper-100"
                    : "flex cursor-pointer items-center gap-3 rounded-xl border border-paper-300 bg-white px-4 py-3 text-sm text-ink-700 transition-colors hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
                }
              >
                <input
                  type="radio"
                  name="pause-reason"
                  className="h-4 w-4 accent-blush-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-600"
                  checked={checked}
                  onChange={() => {
                    setSelected(r.id);
                    setError(null);
                  }}
                />
                {t(r.labelKey)}
              </label>
            );
          })}
        </div>

        <div>
          <label htmlFor="pause-note" className="field-label">
            {t("profile.pause_reason_note_label")}
          </label>
          <textarea
            id="pause-note"
            className="input min-h-[5rem] resize-y"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("profile.pause_reason_note_placeholder")}
            maxLength={400}
          />
        </div>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
