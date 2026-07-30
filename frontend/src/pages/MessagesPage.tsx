// /app/messages: everything the couple and a vendor say to each other.
//
// The conversations half is the surface the outreach email has been promising
// since v1 ("it is in their Weddly inbox"): until then a couple could send an
// inquiry and watch a frozen "Sent" chip forever, because a vendor's reply left
// the product as ordinary email. The thread is the same object the vendor sees
// on their client card, rendered by the same component.
//
// The outreach half (what the couple SENT, by campaign) used to be its own rail
// row at /app/outreach. Two rows meant the couple had to know which of two
// inboxes a given vendor conversation lived in, and the outreach row was
// additionally earned at three sent messages, so the rail changed shape under
// them. Both are now tabs here, `?tab=outreach` deep-links the second one, and
// /app/outreach redirects to it.
//
// Three states, one screen: the thread list, one thread with a back link, or
// the outreach history. A two-pane layout would buy nothing, most couples have
// a handful of vendors, and the phone is where this gets read.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";
import type { BookingMessage, CoupleVendorThreadPreview } from "@shared/booking_messages";
import { BookingThreadPanel } from "../components/BookingThreadPanel";
import { OutreachInbox } from "../components/OutreachInbox";
import { Skeleton } from "../components/ui";
import { bookingMessagesApi } from "../lib/endpoints";
import { formatDateMs } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const TABS = [
  { key: "threads", labelKey: "messages.tab_threads", icon: MessageCircle },
  { key: "outreach", labelKey: "messages.tab_outreach", icon: Send },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function ThreadList() {
  const { t, locale } = useT();
  const [threads, setThreads] = useState<CoupleVendorThreadPreview[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    bookingMessagesApi
      .coupleThreads()
      .then(({ threads: list }) => !cancelled && setThreads(list))
      .catch(() => !cancelled && setThreads([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (threads === null) {
    return (
      <div className="space-y-2">
        <Skeleton variant="line" height="4rem" />
        <Skeleton variant="line" height="4rem" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("messages.empty_body")}</p>
        <Link
          to="/app/vendors"
          className="mt-3 inline-block text-sm font-medium text-blush-600 underline-offset-2 hover:underline dark:text-blush-300"
        >
          {t("messages.empty_cta")}
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {threads.map((thread) => (
        <li key={thread.booking_id}>
          <Link
            to={`/app/messages/${thread.booking_id}`}
            className="flex items-center gap-3 rounded-2xl border border-paper-300 bg-white p-4 transition hover:bg-paper-50 dark:border-umber-600 dark:bg-umber-800 dark:hover:bg-umber-700"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-ink-900 dark:text-paper-50">
                  {thread.vendor_name}
                </span>
                {thread.unread_count > 0 ? (
                  <span className="rounded-full bg-blush-500 px-2 py-0.5 text-xs font-semibold text-white">
                    {thread.unread_count}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-sm text-ink-600 dark:text-paper-300">
                {thread.last_sender_kind === "couple" ? `${t("messages.you")}: ` : ""}
                {thread.last_body}
              </span>
            </span>
            <span className="shrink-0 text-xs text-ink-500 dark:text-paper-400">
              {formatDateMs(thread.last_at, locale)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ThreadView({ bookingId }: { bookingId: number }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<BookingMessage[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    bookingMessagesApi
      .coupleThread(bookingId)
      .then(({ thread }) => {
        if (cancelled) return;
        setMessages(thread.messages);
        setName(thread.counterparty_name);
        setLoading(false);
        // Opening the thread IS reading it on this side: there is no list-then-
        // open step once you are here.
        if (thread.messages.some((m) => m.sender_kind === "vendor" && m.seen_at === null)) {
          void bookingMessagesApi.coupleMarkSeen(bookingId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          navigate("/app/messages", { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId, navigate]);

  const send = useCallback(
    async (body: string) => {
      const { message } = await bookingMessagesApi.coupleSend(bookingId, body);
      setMessages((prev) => [...prev, message]);
    },
    [bookingId],
  );

  return (
    <div className="space-y-4">
      <Link
        to="/app/messages"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 dark:text-paper-300 dark:hover:text-paper-50"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("messages.back")}
      </Link>
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-50">{name}</h2>
        <BookingThreadPanel side="couple" messages={messages} loading={loading} onSend={send} />
      </section>
    </div>
  );
}

export default function MessagesPage() {
  const { t } = useT();
  const { bookingId } = useParams<{ bookingId: string }>();
  const [params, setParams] = useSearchParams();
  useDocumentMeta("seo.messages_title", "seo.messages_description");
  const parsed = Number(bookingId);
  const openThread = bookingId != null && Number.isFinite(parsed);
  const tab: TabKey = params.get("tab") === "outreach" ? "outreach" : "threads";

  return (
    <div className="animate-fade-in">
      <header className="mb-4">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          {t("messages.page_title")}
        </h1>
        <p className="mt-0.5 text-sm text-ink-600 dark:text-umber-200">{t("messages.page_body")}</p>
      </header>
      {/* One thread is a detail view, not a third tab: it has its own back link
          and the tab row above it would offer to leave a conversation the couple
          just opened. Same tab visual language as /app/planning. */}
      {openThread ? (
        <ThreadView bookingId={parsed} />
      ) : (
        <>
          <nav
            role="tablist"
            aria-label={t("messages.tabs_aria")}
            className="mb-4 inline-flex gap-1 rounded-2xl border border-ink-900 bg-paper-100/50 p-1 dark:border-umber-700 dark:bg-umber-700/60"
          >
            {TABS.map(({ key, labelKey, icon: Icon }) => {
              const active = key === tab;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    // Replace, don't push: flipping a tab is not a step the back
                    // button should have to walk through.
                    setParams(key === "outreach" ? { tab: "outreach" } : {}, { replace: true });
                  }}
                  className={`flex items-center gap-2 rounded-xl px-4 py-1.5 text-sm leading-none transition-colors ${
                    active
                      ? "bg-ink-800 text-paper-100 shadow-soft dark:bg-umber-900 dark:text-paper-50"
                      : "text-ink-600 hover:bg-paper-200 dark:text-umber-200 dark:hover:bg-umber-700"
                  }`}
                >
                  <Icon size={16} aria-hidden="true" />
                  {t(labelKey)}
                </button>
              );
            })}
          </nav>
          {tab === "outreach" ? <OutreachInbox variant="tab" /> : <ThreadList />}
        </>
      )}
    </div>
  );
}
