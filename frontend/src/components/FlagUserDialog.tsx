// Flag modal for the admin user directory. Replaces the generic
// `useEntryPrompt` flow with a templated picker so the moderator can
// reach the right wording in one click — the textarea stays editable
// for cases the templates don't cover. Submitting forwards the final
// (edited) reason to AdminUsersPage which calls /api/admin/users/:id/flag.

import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";
import { Dialog } from "./ui";

/** Each template carries a short pill label + the full body it drops
 *  into the textarea. The first template is the "blank" option (admin
 *  types everything from scratch) so picking nothing is a real choice. */
interface FlagTemplate {
  key: string;
  labelKey: string;
  bodyKey: string;
}

const TEMPLATES: FlagTemplate[] = [
  // Most common moderator reasons, ordered by frequency at our scale.
  // Each `bodyKey` resolves to a HU sentence that the recipient sees
  // verbatim in the email — the admin can still edit the textarea before
  // sending.
  { key: "spam", labelKey: "admin.flag_tpl_spam_label", bodyKey: "admin.flag_tpl_spam_body" },
  { key: "fake", labelKey: "admin.flag_tpl_fake_label", bodyKey: "admin.flag_tpl_fake_body" },
  {
    key: "duplicate",
    labelKey: "admin.flag_tpl_duplicate_label",
    bodyKey: "admin.flag_tpl_duplicate_body",
  },
  {
    key: "vendor_abuse",
    labelKey: "admin.flag_tpl_vendor_abuse_label",
    bodyKey: "admin.flag_tpl_vendor_abuse_body",
  },
  {
    key: "offensive",
    labelKey: "admin.flag_tpl_offensive_label",
    bodyKey: "admin.flag_tpl_offensive_body",
  },
  {
    key: "reported",
    labelKey: "admin.flag_tpl_reported_label",
    bodyKey: "admin.flag_tpl_reported_body",
  },
];

interface Props {
  open: boolean;
  /** Email of the user being flagged — surfaced in the dialog title so
   *  the admin can confirm they're acting on the right row. */
  targetEmail: string;
  /** Disable submit + show "sending" copy while the request is in flight. */
  pending: boolean;
  onClose: () => void;
  /** Caller wires this to `adminUserApi.flag(userId, reason)` then closes
   *  the dialog on success. The dialog doesn't dispatch the API call
   *  itself so the caller can manage toasts + list-state in one place. */
  onConfirm: (reason: string) => void;
}

export function FlagUserDialog({ open, targetEmail, pending, onClose, onConfirm }: Props) {
  const { t } = useT();
  const [draft, setDraft] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Reset every time the dialog opens — opening on a new user shouldn't
  // inherit the previous one's typing. Stays untouched between renders
  // while open so a user click → typing → re-render doesn't blow away the
  // edit.
  useEffect(() => {
    if (open) {
      setDraft("");
      setSelectedKey(null);
    }
  }, [open]);

  function pickTemplate(tpl: FlagTemplate) {
    setSelectedKey(tpl.key);
    setDraft(t(tpl.bodyKey));
  }

  const trimmed = draft.trim();
  const tooShort = trimmed.length < 4;

  return (
    <Dialog
      open={open}
      title={`${t("admin.flag_user_title")} — ${targetEmail}`}
      onClose={onClose}
      role="dialog"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={pending || tooShort}
            onClick={() => onConfirm(trimmed)}
          >
            {pending ? t("admin.flag_user_sending") : t("admin.flag_user_send")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-ink-500 dark:text-umber-300">
          {t("admin.flag_user_templates_help")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((tpl) => {
            const active = selectedKey === tpl.key;
            return (
              <button
                key={tpl.key}
                type="button"
                onClick={() => pickTemplate(tpl)}
                aria-pressed={active}
                disabled={pending}
                className={
                  active
                    ? "rounded-full border border-violet-700 bg-violet-700 px-3 py-1 text-xs font-medium text-paper-100"
                    : "rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700 hover:border-violet-300 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-200"
                }
              >
                {t(tpl.labelKey)}
              </button>
            );
          })}
        </div>
        <label className="field-label" htmlFor="flag-reason">
          {t("admin.flag_user_label")}
        </label>
        <textarea
          id="flag-reason"
          className="input min-h-[120px] resize-y"
          placeholder={t("admin.flag_user_placeholder")}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // Once the admin edits, drop the template highlight so it's
            // clear they've gone off-script.
            if (selectedKey !== null) setSelectedKey(null);
          }}
          maxLength={2000}
          disabled={pending}
          aria-invalid={tooShort && draft.length > 0}
        />
        <p className="text-xs text-ink-500 dark:text-umber-300">
          {t("admin.flag_user_help")}
        </p>
        {tooShort && draft.length > 0 ? (
          <p className="text-xs text-blush-700 dark:text-blush-300">
            {t("admin.flag_user_too_short")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
