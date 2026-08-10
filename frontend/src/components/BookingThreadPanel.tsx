// The couple ↔ vendor conversation, rendered identically on both sides.
//
// One component for two portals on purpose: the thread is the same object seen
// from two ends, and two copies would drift the moment one side gained a
// feature. `side` decides which bubbles are "mine"; everything else is props.
//
// It renders ONE scroll, not two: the booking's system events (a quote sent, a
// date held, an installment paid, a status moved) sit inline among the messages
// in stamp order, because "what actually happened with this booking" was
// previously six panels and a chat that never mentioned each other. System
// events are drawn QUIETER than messages on purpose: they are context, not
// conversation, so they are a centred line rather than a bubble.
//
// The list is driven by `events` when the server sends them, and the events are
// ALREADY SCOPED to this reader (`shared/booking_timeline.ts` declares an
// audience per kind, the projector filters on it). This component therefore
// hides nothing and decides nothing about visibility: whatever arrives is
// whatever this side is allowed to read.
//
// Colour note: bubbles are NEUTRAL, never blush. In the vendor portal blush
// means "you can act on this" and nothing else, and a message someone sent is
// not a control. The only accent in here is the send button, which is a control.

import { type ReactNode, useMemo, useRef, useState } from "react";
import {
  Bot,
  CalendarClock,
  Check,
  CheckCheck,
  CircleCheck,
  CircleX,
  CornerUpLeft,
  Eye,
  FileText,
  ImageIcon,
  Inbox,
  Paperclip,
  Send,
  Timer,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  BookingMessage,
  BookingMessageAttachment,
  MessageSenderKind,
  TemplateVar,
  VendorMessageTemplate,
} from "@shared/booking_messages";
import {
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENTS_MAX,
  MESSAGE_BODY_MAX_LEN,
  applyTemplateVars,
} from "@shared/booking_messages";
import type { BookingTimelineEvent, TimelineEventKind } from "@shared/booking_timeline";
import { timelineCopyKey } from "@shared/booking_timeline";
import { Button, Skeleton, useToast } from "./ui";
import { bookingMessagesApi } from "../lib/endpoints";
import { formatDate, formatMoney, intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

interface Props {
  /** Which sender kind the viewer is. Their own messages sit on the right. */
  side: MessageSenderKind;
  messages: BookingMessage[];
  /** The merged event log for this booking, already audience-scoped by the
   *  server. Left out (or empty) means "messages only", which is what an older
   *  caller and the component's own tests get. */
  events?: BookingTimelineEvent[];
  loading: boolean;
  onSend: (body: string, files: File[]) => Promise<void>;
  /** Vendor-only: canned replies offered above the composer. */
  templates?: VendorMessageTemplate[];
  /** Values substituted into a template's {client_name}-style tokens. */
  templateVars?: Partial<Record<TemplateVar, string>>;
  onManageTemplates?: () => void;
  allowAttachments?: boolean;
  /** Rendered instead of the composer (an upgrade prompt, usually). */
  composerLock?: ReactNode;
}

function formatTs(ts: number, locale: Locale): string {
  // Via `intlLocale` so a locale added later cannot silently fall through to
  // the en-US date format (see the same note in VendorBillingPage).
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One / two / two-highlighted ticks, shown only on the viewer's OWN messages,
 *  a read receipt on an incoming message would be meaningless. */
function StatusTicks({ status }: { status: BookingMessage["status"] }) {
  const { t } = useT();
  const label = t(`thread.status_${status}` as "thread.status_sent");
  if (status === "sent") {
    return <Check className="h-3.5 w-3.5" aria-label={label} />;
  }
  return (
    <CheckCheck
      className={`h-3.5 w-3.5 ${status === "seen" ? "text-sage-600 dark:text-sage-300" : ""}`}
      aria-label={label}
    />
  );
}

function AttachmentChip({ attachment }: { attachment: BookingMessageAttachment }) {
  const { t } = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isImage = attachment.mime === "image/jpeg";
  const Icon = isImage ? ImageIcon : FileText;

  const open = async () => {
    setBusy(true);
    try {
      const blob = await bookingMessagesApi.fetchAttachmentBlob(attachment.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      // Revoke on the next tick: the new tab has already taken a reference, and
      // holding the object URL forever leaks the whole file into memory.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error(t("thread.attachment_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="mt-2 flex w-full items-center gap-2 rounded-xl border border-paper-300 bg-white/70 px-3 py-2 text-left transition hover:bg-white disabled:opacity-60 dark:border-umber-600 dark:bg-umber-800/70 dark:hover:bg-umber-800"
    >
      <Icon className="h-4 w-4 shrink-0 text-ink-600 dark:text-paper-300" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink-800 dark:text-paper-100">
          {attachment.file_name}
        </span>
        <span className="block text-[11px] text-ink-500 dark:text-paper-400">
          {formatSize(attachment.size_bytes)}
        </span>
      </span>
    </button>
  );
}

/** One glyph per event kind. Decoration only, so it is drawn on the surface it
 *  sits on: no tinted plate behind it (the vendor-portal rule), no colour of
 *  its own beyond the quiet ink the line is already set in. */
const EVENT_ICON: Record<Exclude<TimelineEventKind, "message">, LucideIcon> = {
  inquiry_sent: Inbox,
  vendor_opened: Eye,
  vendor_responded: CornerUpLeft,
  booking_confirmed: CircleCheck,
  booking_declined: CircleX,
  booking_cancelled: CircleX,
  booking_expired: Timer,
  quote_sent: FileText,
  quote_viewed: Eye,
  quote_accepted: CircleCheck,
  quote_declined: CircleX,
  quote_withdrawn: Timer,
  hold_placed: CalendarClock,
  hold_released: CalendarClock,
  hold_expired: Timer,
  payment_scheduled: Wallet,
  payment_paid: CircleCheck,
  automation_ran: Bot,
};

/** The sentence for one system event. The key is DERIVED from the kind
 *  (`booking_timeline.event_<kind>`), so a kind added to the projector cannot end up
 *  rendering another kind's copy; the payload only fills the blanks. */
function useEventText(): (event: BookingTimelineEvent) => string {
  const { t, locale } = useT();
  return (event: BookingTimelineEvent) => {
    const p = event.payload;
    // An inquiry with no date is its own sentence rather than one with a hole
    // in it: the couple genuinely had not picked a day.
    if (event.kind === "inquiry_sent" && !p.date)
      return t("booking_timeline.event_inquiry_sent_nodate");
    const name =
      p.value === undefined
        ? ""
        : t(`booking_timeline.automation_${p.value}` as "booking_timeline.automation_inquiry_ack");
    // Through the shared helper, so the panel and the contract can never
    // disagree about what a kind's copy key is called.
    return t(timelineCopyKey(event.kind) as "booking_timeline.event_inquiry_sent", {
      date: p.date ? formatDate(p.date, locale) : "",
      // Whole units of the event's own currency, like every amount in the app.
      amount: p.amount === undefined ? "" : formatMoney(p.amount, p.currency, locale),
      label: p.label ?? "",
      name,
    });
  };
}

/** A system event: a centred, quiet line. Deliberately not a bubble and not a
 *  card, because it is context around the conversation rather than a turn in
 *  it. */
function SystemEvent({ event, locale }: { event: BookingTimelineEvent; locale: Locale }) {
  const text = useEventText()(event);
  const Icon = EVENT_ICON[event.kind as Exclude<TimelineEventKind, "message">] ?? Inbox;
  return (
    <li className="flex justify-center px-1">
      <span className="grid max-w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-1.5 py-0.5 text-[11px] leading-relaxed text-ink-500 dark:text-paper-400">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="min-w-0 break-words text-center">
          {text}{" "}
          <time
            className="whitespace-nowrap tabular-nums opacity-70"
            dateTime={new Date(event.at).toISOString()}
          >
            {formatTs(event.at, locale)}
          </time>
        </span>
      </span>
    </li>
  );
}

export function BookingThreadPanel({
  side,
  messages,
  events,
  loading,
  onSend,
  templates,
  templateVars,
  onManageTemplates,
  allowAttachments = false,
  composerLock,
}: Props) {
  const { t, locale } = useT();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** ONE scroll, in the server's order. A `message` event names a row this
   *  component already holds, so the body lives once; anything else is a quiet
   *  system line. With no events (an older caller, or a send that has only
   *  optimistically appended) the messages carry the list on their own, so the
   *  panel never goes blank while a fresh timeline is in flight. */
  const rows = useMemo(() => {
    const byId = new Map(messages.map((m) => [m.id, m]));
    if (!events || events.length === 0) {
      return messages.map((m) => ({
        message: m,
        event: undefined as BookingTimelineEvent | undefined,
      }));
    }
    const out: { message?: BookingMessage; event?: BookingTimelineEvent }[] = [];
    const rendered = new Set<number>();
    for (const event of events) {
      if (event.kind !== "message") {
        out.push({ event });
        continue;
      }
      const id = event.payload.message_id;
      const message = id === undefined ? undefined : byId.get(id);
      // A message the timeline names but this side has not loaded is skipped
      // rather than drawn as an empty bubble.
      if (!message) continue;
      rendered.add(message.id);
      out.push({ message, event });
    }
    // A message sent since the timeline was fetched (the optimistic append
    // after a successful send) still belongs at the bottom.
    for (const m of messages) if (!rendered.has(m.id)) out.push({ message: m });
    return out;
  }, [events, messages]);

  const pickFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    for (const file of Array.from(picked)) {
      if (next.length >= MESSAGE_ATTACHMENTS_MAX) {
        toast.error(t("thread.too_many_files", { max: MESSAGE_ATTACHMENTS_MAX }));
        break;
      }
      if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) {
        toast.error(t("thread.file_too_large", { name: file.name }));
        continue;
      }
      // The server sniffs the real bytes; this is only so an obviously wrong
      // pick fails before the upload rather than after it.
      const name = file.name.toLowerCase();
      if (!name.endsWith(".pdf") && !name.endsWith(".jpg") && !name.endsWith(".jpeg")) {
        toast.error(t("thread.unsupported_file", { name: file.name }));
        continue;
      }
      next.push(file);
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    const body = draft.trim();
    if (body.length === 0 && files.length === 0) return;
    setSending(true);
    try {
      await onSend(body, files);
      setDraft("");
      setFiles([]);
    } catch {
      toast.error(t("thread.send_failed"));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton variant="line" height="3rem" />
        <Skeleton variant="line" height="3rem" width="70%" />
        <Skeleton variant="line" height="3rem" />
      </div>
    );
  }

  const bubble = (m: BookingMessage, automated: boolean) => {
    const mine = m.sender_kind === side;
    return (
      <li key={`m${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${
            mine
              ? "bg-ink-800 text-paper-50 dark:bg-paper-200 dark:text-ink-900"
              : "bg-paper-100 text-ink-800 dark:bg-umber-700 dark:text-paper-100"
          }`}
        >
          {m.body ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p>
          ) : null}
          {m.attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} />
          ))}
          <span className="mt-1 flex items-center justify-end gap-1 text-[11px] opacity-70">
            {/* A machine wrote this one. Said out loud on both sides: the vendor
                must never be surprised by words attributed to them, and the
                couple gets the disclosure an out-of-office already carries. */}
            {automated ? (
              <span
                className="inline-flex items-center gap-1 uppercase tracking-wide"
                title={t("booking_timeline.automated_hint")}
              >
                <Bot className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                {t("booking_timeline.automated")}
              </span>
            ) : null}
            {formatTs(m.sent_at, locale)}
            {mine ? <StatusTicks status={m.status} /> : null}
          </span>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-paper-400">{t("thread.empty")}</p>
      ) : (
        /* The conversation belongs to the page's reading flow. A nested,
         * fixed-height scroller trapped mouse-wheel and touch gestures at its
         * bottom, hiding every section that followed it. */
        <ul className="space-y-3">
          {rows.map((row) =>
            row.message ? (
              bubble(row.message, row.event?.payload.automated === true)
            ) : row.event ? (
              <SystemEvent key={row.event.id} event={row.event} locale={locale} />
            ) : null,
          )}
        </ul>
      )}

      {composerLock ?? (
        <div className="space-y-2">
          {templates && templates.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setTemplatesOpen((v) => !v)}
                className="text-xs font-medium text-blush-600 underline-offset-2 hover:underline dark:text-blush-300"
              >
                {t("thread.templates")}
              </button>
              {templatesOpen ? (
                <ul className="absolute bottom-full z-10 mb-1 max-h-56 w-72 overflow-y-auto rounded-xl border border-paper-300 bg-white p-1 shadow-soft dark:border-umber-600 dark:bg-umber-800">
                  {templates.map((tpl) => (
                    <li key={tpl.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(applyTemplateVars(tpl.body, templateVars ?? {}));
                          setTemplatesOpen(false);
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-800 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
                      >
                        <span className="block truncate font-medium">{tpl.title}</span>
                        <span className="block truncate text-xs text-ink-500 dark:text-paper-400">
                          {tpl.body}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {files.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {files.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2 rounded-full border border-paper-300 px-3 py-1 text-xs text-ink-700 dark:border-umber-600 dark:text-paper-200"
                >
                  <span className="max-w-[12rem] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                    aria-label={t("thread.remove_file")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-end gap-2">
            {allowAttachments ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"
                  multiple
                  className="hidden"
                  onChange={(e) => pickFiles(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border border-paper-300 p-2 text-ink-600 transition hover:bg-paper-100 dark:border-umber-600 dark:text-paper-300 dark:hover:bg-umber-700"
                  aria-label={t("thread.attach")}
                  title={t("thread.attach_hint")}
                >
                  <Paperclip className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </>
            ) : null}
            <textarea
              aria-label={t("thread.placeholder")}
              rows={2}
              value={draft}
              maxLength={MESSAGE_BODY_MAX_LEN}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("thread.placeholder")}
              className="input min-h-[3rem] flex-1 resize-y leading-relaxed"
            />
            <Button
              variant="primary"
              size="md"
              onClick={submit}
              loading={sending}
              loadingLabel={t("thread.sending")}
              leftIcon={<Send className="h-4 w-4" />}
              disabled={draft.trim().length === 0 && files.length === 0}
            >
              {t("thread.send")}
            </Button>
          </div>

          {onManageTemplates ? (
            <button
              type="button"
              onClick={onManageTemplates}
              className="text-xs text-ink-500 underline-offset-2 hover:underline dark:text-paper-400"
            >
              {t("thread.templates_manage")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
