// Manage a vendor's canned replies. Lives in a dialog rather than under
// Settings because the moment you want one is the moment you are staring at a
// client's message with nothing to say for the fourth time that week.
//
// Placeholders are inserted as locale-independent tokens ({client_name}) with
// localised BUTTON labels, a template is stored text, so a Hungarian-looking
// token would stop substituting the day the vendor flips the interface.

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { VendorMessageTemplate } from "@shared/booking_messages";
import { TEMPLATE_VARS, TEMPLATE_TITLE_MAX_LEN } from "@shared/booking_messages";
import { Button, Dialog, TextField, useConfirm, useToast } from "./ui";
import { bookingMessagesApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

interface Props {
  templates: VendorMessageTemplate[];
  onChange: (next: VendorMessageTemplate[]) => void;
  onClose: () => void;
}

export function MessageTemplatesDialog({ templates, onChange, onClose }: Props) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setBody("");
    setEditingId(null);
  };

  const save = async () => {
    if (title.trim().length === 0 || body.trim().length === 0) return;
    setSaving(true);
    try {
      if (editingId === null) {
        const { template } = await bookingMessagesApi.createTemplate(title.trim(), body.trim());
        onChange([template, ...templates]);
      } else {
        const { template } = await bookingMessagesApi.updateTemplate(
          editingId,
          title.trim(),
          body.trim(),
        );
        onChange(templates.map((tpl) => (tpl.id === template.id ? template : tpl)));
      }
      reset();
      toast.success(t("thread.template_saved"));
    } catch {
      toast.error(t("thread.template_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (template: VendorMessageTemplate) => {
    const ok = await confirm({
      title: t("thread.template_delete_title"),
      body: template.title,
      confirmLabel: t("thread.template_delete_confirm"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await bookingMessagesApi.deleteTemplate(template.id);
      onChange(templates.filter((tpl) => tpl.id !== template.id));
      if (editingId === template.id) reset();
    } catch {
      toast.error(t("thread.template_save_failed"));
    }
  };

  return (
    <Dialog open onClose={onClose} title={t("thread.templates_manage")}>
      <div className="space-y-5">
        <ul className="divide-y divide-paper-300 dark:divide-umber-700">
          {templates.length === 0 ? (
            <li className="py-3 text-sm text-ink-500 dark:text-paper-400">
              {t("thread.templates_empty")}
            </li>
          ) : (
            templates.map((tpl) => (
              <li key={tpl.id} className="flex items-start gap-3 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(tpl.id);
                    setTitle(tpl.title);
                    setBody(tpl.body);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                    {tpl.title}
                  </span>
                  <span className="block truncate text-xs text-ink-500 dark:text-paper-400">
                    {tpl.body}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(tpl)}
                  aria-label={t("thread.template_delete_confirm")}
                  className="rounded-lg p-1.5 text-ink-500 transition hover:bg-paper-100 dark:text-paper-400 dark:hover:bg-umber-700"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="space-y-3">
          <TextField
            id="tpl-title"
            label={t("thread.template_title")}
            value={title}
            maxLength={TEMPLATE_TITLE_MAX_LEN}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div>
            <label className="field-label" htmlFor="tpl-body">
              {t("thread.template_body")}
            </label>
            <textarea
              id="tpl-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="input min-h-[6rem] resize-y leading-relaxed"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-500 dark:text-paper-400">
              {t("thread.template_vars")}
            </span>
            {TEMPLATE_VARS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setBody((prev) => `${prev}{${v}}`)}
                className="rounded-full border border-paper-300 px-2.5 py-1 text-xs text-ink-700 transition hover:bg-paper-100 dark:border-umber-600 dark:text-paper-200 dark:hover:bg-umber-700"
              >
                {t(`thread.var_${v}` as "thread.var_client_name")}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={save}
              loading={saving}
              leftIcon={editingId === null ? <Plus className="h-4 w-4" /> : undefined}
              disabled={title.trim().length === 0 || body.trim().length === 0}
            >
              {editingId === null ? t("thread.template_add") : t("thread.template_update")}
            </Button>
            {editingId !== null ? (
              <Button variant="ghost" onClick={reset}>
                {t("thread.template_cancel")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
