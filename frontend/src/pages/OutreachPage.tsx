// Supplier Outreach Inbox (P2.E v1). One-screen workspace for the
// couple to send a localised cold-outreach mail to up to 5 shortlisted
// vendors per campaign, then browse the sent history.
//
// v1 scope:
//   - left pane: campaigns list (newest first), counted by message_count
//   - right pane: campaign detail — messages list + status badges, plus
//     a banner explaining v1 replies arrive in the user's own email
//   - new-campaign modal: subject + body + supplier-id picker (free-text
//     id input for v1; v1.5 wires the "Add to outreach" button on the
//     /app/suppliers cards so the input pre-fills)
//
// Deferred to v1.5: in-app reply thread (needs the Resend inbound
// webhook + `reply.weddly.xyz` MX), Add-to-outreach picker from the
// suppliers page, supplier-name autocomplete in the modal.

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Send, Plus } from "lucide-react";
import {
  type CreateOutreachCampaignInput,
  OUTREACH_BODY_MAX_LEN,
  OUTREACH_SUBJECT_MAX_LEN,
  OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP,
  type OutreachCampaign,
  type OutreachCampaignDetail,
} from "@shared/outreach";
import { Shell } from "../components/Shell";
import { Dialog } from "../components/ui/Dialog";
import { useToast } from "../components/ui/ToastProvider";
import { ApiError } from "../lib/api";
import { outreachApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function OutreachPage() {
  const { t, locale } = useT();
  const toast = useToast();
  useDocumentMeta("outreach.page_title", "outreach.page_body");

  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<OutreachCampaignDetail | null>(null);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshList = useCallback(async () => {
    try {
      const data = await outreachApi.list();
      setCampaigns(data.campaigns);
      if (data.campaigns.length > 0 && selectedId == null) {
        setSelectedId(data.campaigns[0]!.id);
      }
    } catch {
      toast.error(t("outreach.error_load"));
    } finally {
      setLoading(false);
    }
  }, [selectedId, toast, t]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    void outreachApi
      .detail(selectedId)
      .then(setDetail)
      .catch(() => toast.error(t("outreach.error_detail")));
  }, [selectedId, toast, t]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  return (
    <Shell>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 xl:px-10">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl">{t("outreach.heading")}</h1>
            <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
              {t("outreach.subheading")}
            </p>
          </div>
          <button type="button" className="btn-accent" onClick={() => setComposing(true)}>
            <Plus size={16} aria-hidden /> {t("outreach.new_campaign")}
          </button>
        </div>

        <div className="card mb-4 bg-blush-50/60 ring-1 ring-blush-200 dark:bg-blush-400/10 dark:ring-blush-400/40">
          <div className="flex items-start gap-3">
            <Mail size={16} className="mt-1 shrink-0 text-blush-700 dark:text-blush-300" />
            <p className="text-sm text-ink-700 dark:text-paper-100">{t("outreach.reply_note")}</p>
          </div>
        </div>

        {loading ? (
          <div className="card text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</div>
        ) : campaigns.length === 0 ? (
          <div className="card text-center">
            <h2 className="text-lg font-semibold">{t("outreach.empty_title")}</h2>
            <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
              {t("outreach.empty_body")}
            </p>
            <button
              type="button"
              className="btn-accent mt-4 inline-flex items-center gap-1"
              onClick={() => setComposing(true)}
            >
              <Plus size={16} aria-hidden /> {t("outreach.new_campaign")}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <aside className="space-y-2">
              {campaigns.map((c) => {
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`block w-full rounded-2xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-blush-400 bg-blush-50/70 dark:border-blush-400/60 dark:bg-blush-400/15"
                        : "border-paper-300 bg-white hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
                    }`}
                  >
                    <p className="truncate font-serif text-sm font-semibold">{c.subject}</p>
                    <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                      {t("outreach.recipient_count", { n: c.message_count })} ·{" "}
                      {dateFmt.format(c.created_at)}
                    </p>
                  </button>
                );
              })}
            </aside>
            <section className="card">
              {detail ? (
                <div className="space-y-4">
                  <header>
                    <p className="text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                      {dateFmt.format(detail.created_at)}
                    </p>
                    <h2 className="mt-1 font-serif text-2xl">{detail.subject}</h2>
                  </header>
                  <div className="rounded-xl bg-paper-50 p-4 text-sm leading-relaxed text-ink-700 dark:bg-umber-800/60 dark:text-paper-100">
                    {detail.body_template.split(/\n+/).map((para, idx) => (
                      // Body paragraphs are static text rendered from a frozen
                      // template — index keys are appropriate here because the
                      // list never reorders.
                      <p key={`${detail.id}-p-${idx}`} className="mb-2 last:mb-0">
                        {para}
                      </p>
                    ))}
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                      {t("outreach.recipients_header")}
                    </h3>
                    <ul className="space-y-2">
                      {detail.messages.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-paper-200 px-3 py-2 dark:border-umber-700"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{m.supplier_name}</p>
                            <p className="truncate text-xs text-ink-500 dark:text-umber-300">
                              {m.supplier_email}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                              m.status === "sent"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
                                : m.status === "bounced"
                                  ? "bg-blush-100 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300"
                                  : "bg-paper-200 text-ink-600 dark:bg-umber-700 dark:text-paper-200"
                            }`}
                          >
                            {t(`outreach.status_${m.status}`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-500 dark:text-umber-300">
                  {t("outreach.detail_loading")}
                </p>
              )}
            </section>
          </div>
        )}
      </div>

      {composing && (
        <ComposeDialog
          onClose={() => setComposing(false)}
          onSent={async (created) => {
            setComposing(false);
            await refreshList();
            setSelectedId(created.id);
            toast.success(t("outreach.send_success", { n: created.message_count }));
          }}
        />
      )}
    </Shell>
  );
}

function ComposeDialog({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (created: OutreachCampaignDetail) => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [supplierIdsText, setSupplierIdsText] = useState("");
  const [sending, setSending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const supplier_ids = supplierIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (supplier_ids.length === 0) {
      toast.error(t("outreach.err_no_suppliers"));
      return;
    }
    if (supplier_ids.length > OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP) {
      toast.error(
        t("outreach.err_too_many_suppliers", { max: OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP }),
      );
      return;
    }
    const payload: CreateOutreachCampaignInput = {
      subject: subject.trim(),
      body_template: body.trim(),
      supplier_ids,
    };
    setSending(true);
    try {
      const created = await outreachApi.create(payload);
      await onSent(created);
    } catch (err) {
      const code = err instanceof ApiError ? (err.detail as { code?: string })?.code : undefined;
      const message =
        code === "campaign_rate_limited"
          ? t("outreach.err_rate_limited")
          : code === "supplier_cap_exceeded"
            ? t("outreach.err_too_many_suppliers", { max: OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP })
            : code === "supplier_not_found"
              ? t("outreach.err_supplier_not_found")
              : code === "supplier_no_email"
                ? t("outreach.err_supplier_no_email")
                : t("outreach.err_generic");
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("outreach.compose_title")}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={sending}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="outreach-compose-form"
            className="btn-accent"
            disabled={sending}
          >
            <Send size={16} aria-hidden />
            {sending ? t("outreach.sending") : t("outreach.send")}
          </button>
        </>
      }
    >
      <form id="outreach-compose-form" onSubmit={onSubmit} className="space-y-3">
        <label className="block" htmlFor="outreach-subject">
          <span className="field-label">{t("outreach.label_subject")}</span>
          <input
            id="outreach-subject"
            className="input"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={OUTREACH_SUBJECT_MAX_LEN}
            required
          />
        </label>
        <label className="block" htmlFor="outreach-body">
          <span className="field-label">{t("outreach.label_body")}</span>
          <textarea
            id="outreach-body"
            className="input min-h-[8rem]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={OUTREACH_BODY_MAX_LEN}
            required
          />
        </label>
        <label className="block" htmlFor="outreach-suppliers">
          <span className="field-label">{t("outreach.label_supplier_ids")}</span>
          <input
            id="outreach-suppliers"
            className="input"
            type="text"
            value={supplierIdsText}
            onChange={(e) => setSupplierIdsText(e.target.value)}
            placeholder={t("outreach.label_supplier_ids_placeholder")}
            required
          />
          <p className="field-help">
            {t("outreach.label_supplier_ids_help", { max: OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP })}
          </p>
        </label>
      </form>
    </Dialog>
  );
}
