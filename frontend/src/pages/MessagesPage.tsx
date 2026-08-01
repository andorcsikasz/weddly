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
import { ArrowLeft, ArrowUpRight, MessageCircle, Send } from "lucide-react";
import type { BookingMessage, CoupleVendorThreadPreview } from "@shared/booking_messages";
import { BookingThreadPanel } from "../components/BookingThreadPanel";
import { OutreachInbox } from "../components/OutreachInbox";
import { Skeleton } from "../components/ui";
import { categoryIcon } from "../lib/category_icons";
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
      {threads.map((thread) => {
        const Glyph = categoryIcon(thread.vendor_category ?? "");
        return (
          <li
            key={thread.booking_id}
            className="relative rounded-2xl border border-paper-300 bg-white transition hover:bg-paper-50 dark:border-umber-600 dark:bg-umber-800 dark:hover:bg-umber-700"
          >
            {/* Two destinations in one row, which is why the row is no longer a
                single <Link>: the card opens the conversation (an overlay link
                covering it, so the whole thing stays one tap on a phone) and the
                vendor's NAME goes to their card instead. Nested anchors are
                invalid HTML, so the content is pointer-transparent and the one
                thing that isn't the thread opts back in. */}
            <Link
              to={`/app/messages/${thread.booking_id}`}
              aria-label={t("messages.open_thread_aria", { name: thread.vendor_name })}
              className="absolute inset-0 rounded-2xl"
            />
            <div className="pointer-events-none flex items-center gap-3 p-4">
              {/* The glyph carries the category visually; the label beside the
                  name is for anyone who doesn't read glyphs.

                  Outlined in ink on the bare surface rather than sitting on a
                  paper tint: a filled plate under a decorative icon reads as a
                  disabled button (the same call the vendor portal made), and
                  the outline matches the vendor rows on the dashboard's
                  Kulcsinfó card, which is where these vendors also appear. */}
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-ink-900 text-ink-900 dark:border-paper-200 dark:text-paper-100">
                <Glyph className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {thread.vendor_category ? (
                    <Link
                      to={`/app/suppliers/${thread.supplier_id}`}
                      title={t("suppliers.open_card")}
                      className="pointer-events-auto relative inline-flex min-w-0 items-center gap-1 font-medium text-ink-900 hover:underline dark:text-paper-50"
                    >
                      <span className="min-w-0 truncate">{thread.vendor_name}</span>
                      <ArrowUpRight
                        className="h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-paper-400"
                        aria-hidden="true"
                      />
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-ink-900 dark:text-paper-50">
                      {thread.vendor_name}
                    </span>
                  )}
                  {thread.vendor_category ? (
                    <span className="shrink-0 rounded-full bg-paper-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-500 dark:bg-umber-700 dark:text-paper-300">
                      {t(`suppliers.cat.${thread.vendor_category}`)}
                    </span>
                  ) : null}
                  {thread.unread_count > 0 ? (
                    <span className="shrink-0 rounded-full bg-blush-500 px-2 py-0.5 text-xs font-semibold text-white">
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Name + category + category glyph, wrapped in a link to the vendor's card
 *  when one resolves. Plain text otherwise — a header that looks tappable and
 *  lands on a 404 is worse than a header. */
function ThreadHeader({
  name,
  vendor,
}: {
  name: string;
  vendor: { supplierId: string; category: string } | null;
}) {
  const { t } = useT();
  const Glyph = categoryIcon(vendor?.category ?? "");
  const inner = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-ink-900 text-ink-900 dark:border-paper-200 dark:text-paper-100">
        <Glyph className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <span className="truncate text-lg font-semibold text-ink-900 dark:text-paper-50">
            {name}
          </span>
          {vendor ? (
            <ArrowUpRight
              className="h-4 w-4 shrink-0 text-ink-400 dark:text-paper-400"
              aria-hidden="true"
            />
          ) : null}
        </span>
        {vendor ? (
          <span className="block truncate text-xs uppercase tracking-wide text-ink-500 dark:text-paper-400">
            {t(`suppliers.cat.${vendor.category}`)}
          </span>
        ) : null}
      </span>
    </>
  );

  if (!vendor) return <h2 className="flex items-center gap-3">{inner}</h2>;
  return (
    <h2>
      <Link
        to={`/app/suppliers/${vendor.supplierId}`}
        title={t("suppliers.open_card")}
        className="-m-1 flex items-center gap-3 rounded-2xl p-1 transition hover:bg-paper-50 dark:hover:bg-umber-700/60"
      >
        {inner}
      </Link>
    </h2>
  );
}

function ThreadView({ bookingId }: { bookingId: number }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<BookingMessage[]>([]);
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState<{ supplierId: string; category: string } | null>(null);
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
        // A category is the server saying the card still resolves, so it is
        // also the only thing that earns the link. See `counterparty_category`.
        setVendor(
          thread.counterparty_category
            ? { supplierId: thread.supplier_id, category: thread.counterparty_category }
            : null,
        );
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
        {/* The header is the profile door: glyph + name + category, the whole
            block a link to the vendor's card when there is still a card. */}
        <ThreadHeader name={name} vendor={vendor} />
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
