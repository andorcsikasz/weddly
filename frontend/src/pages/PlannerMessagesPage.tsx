import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PlannerClientView, PlannerMessage, PlannerThreadPreview } from "@shared/types";
import { plannerApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

function formatTs(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

function ThreadSidebar({
  threads,
  clients,
  activeCoupleId,
}: {
  threads: PlannerThreadPreview[];
  clients: PlannerClientView[];
  activeCoupleId: number | null;
}) {
  const { t } = useT();
  const navigate = useNavigate();

  // Build a combined list: existing threads + clients who have no thread yet
  const threadedIds = new Set(threads.map((th) => th.couple_id));
  const unthreaded = clients.filter((c) => !threadedIds.has(c.couple_id));

  return (
    <aside className="flex h-full flex-col border-r border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
      <div className="border-b border-paper-200 px-4 py-3 dark:border-umber-800">
        <h2 className="font-grotesk text-base font-semibold text-umber-900 dark:text-paper-50">
          {t("planner_messages.heading")}
        </h2>
      </div>

      <ul className="flex-1 overflow-y-auto divide-y divide-paper-100 dark:divide-umber-800">
        {threads.map((th) => (
          <li key={th.couple_id}>
            <button
              type="button"
              onClick={() => navigate(`/app/planner/messages/${th.couple_id}`)}
              className={`w-full px-4 py-3 text-left transition-colors hover:bg-paper-50 dark:hover:bg-umber-800 ${
                activeCoupleId === th.couple_id ? "bg-moss-50 dark:bg-moss-900/30" : ""
              }`}
            >
              <p className="truncate text-sm font-medium text-umber-900 dark:text-paper-100">
                {th.display_name}
              </p>
              <p className="mt-0.5 truncate text-xs text-umber-500 dark:text-umber-400">
                {th.last_subject}
              </p>
            </button>
          </li>
        ))}
        {unthreaded.map((c) => (
          <li key={c.couple_id}>
            <button
              type="button"
              onClick={() => navigate(`/app/planner/messages/${c.couple_id}`)}
              className={`w-full px-4 py-3 text-left transition-colors hover:bg-paper-50 dark:hover:bg-umber-800 ${
                activeCoupleId === c.couple_id ? "bg-moss-50 dark:bg-moss-900/30" : ""
              }`}
            >
              <p className="truncate text-sm font-medium text-umber-900 dark:text-paper-100">
                {c.display_name}
              </p>
              <p className="mt-0.5 text-xs italic text-umber-400 dark:text-umber-500">
                {t("planner_messages.no_messages")}
              </p>
            </button>
          </li>
        ))}
        {threads.length === 0 && unthreaded.length === 0 && (
          <li className="flex flex-col items-center gap-3 px-4 py-6 text-center text-sm text-umber-400 dark:text-umber-500">
            {t("planner_messages.inbox_empty")}
            <Link to="/app/planner/clients" className="btn-outline btn-sm">
              {t("planner_messages.empty_add_client_cta")}
            </Link>
          </li>
        )}
      </ul>
    </aside>
  );
}

function ComposeForm({
  coupleId,
  defaultTo,
  onSent,
  focusRef,
}: {
  coupleId: number;
  defaultTo: string;
  onSent: (msg: PlannerMessage) => void;
  focusRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useT();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || !body.trim()) return;
    setStatus("sending");
    try {
      const res = await plannerApi.sendMessage(coupleId, subject.trim(), body.trim(), to.trim());
      onSent(res.message);
      setSubject("");
      setBody("");
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  const inputCls =
    "w-full rounded-lg border border-paper-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-1 focus:ring-moss-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100";

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-3 border-t border-paper-200 pt-4 dark:border-umber-800"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-umber-500 dark:text-umber-400">
        {t("planner_messages.compose_heading")}
      </h3>
      <div className="flex items-center gap-2">
        <label className="w-16 shrink-0 text-xs text-umber-500 dark:text-umber-400">
          {t("planner_messages.field_to")}
        </label>
        <input
          type="email"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={t("planner_messages.to_placeholder")}
          className={inputCls}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-16 shrink-0 text-xs text-umber-500 dark:text-umber-400">
          {t("planner_messages.field_subject")}
        </label>
        <input
          ref={focusRef}
          type="text"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("planner_messages.subject_placeholder")}
          className={inputCls}
        />
      </div>
      <textarea
        required
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("planner_messages.body_placeholder")}
        className={`${inputCls} resize-none`}
      />
      <div className="flex items-center justify-between">
        <div className="text-sm">
          {status === "ok" && (
            <span className="text-moss-600">{t("planner_messages.sent_ok")}</span>
          )}
          {status === "error" && (
            <span className="text-red-500">{t("planner_messages.error_send")}</span>
          )}
        </div>
        <button
          type="submit"
          disabled={status === "sending"}
          className="flex items-center gap-1.5 rounded-lg bg-moss-600 px-4 py-2 text-sm font-medium text-white hover:bg-moss-700 disabled:opacity-50"
        >
          <Send size={14} />
          {status === "sending" ? t("planner_messages.sending") : t("planner_messages.send")}
        </button>
      </div>
    </form>
  );
}

function ThreadPanel({
  coupleId,
  clients,
}: {
  coupleId: number;
  clients: PlannerClientView[];
}) {
  const { t, locale } = useT();
  const [messages, setMessages] = useState<PlannerMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);

  const client = clients.find((c) => c.couple_id === coupleId) ?? null;
  const defaultTo = client?.primary_email ?? "";

  useEffect(() => {
    setLoading(true);
    plannerApi
      .listThread(coupleId)
      .then((res) => setMessages(res.messages))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [coupleId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSent(msg: PlannerMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-paper-200 px-6 py-3 dark:border-umber-800">
        <p className="font-medium text-umber-900 dark:text-paper-100">
          {client?.display_name ?? `#${coupleId}`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading && (
          <p className="text-center text-sm text-umber-400 dark:text-umber-500">
            {t("common.loading")}
          </p>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-ink-400 dark:text-ink-300">
              {t("planner_messages.no_messages")}
            </p>
            <button
              type="button"
              onClick={() => composerRef.current?.focus()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-moss-600 px-4 py-2 text-sm font-medium text-white hover:bg-moss-700"
            >
              <Send size={14} />
              {t("planner_messages.first_message_cta")}
            </button>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.direction === "out" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                msg.direction === "out"
                  ? "bg-moss-600 text-white"
                  : "bg-paper-100 text-ink-800 dark:bg-umber-700 dark:text-paper-100"
              }`}
            >
              <p className="mb-1 text-xs font-medium opacity-70">{msg.subject}</p>
              <p className="whitespace-pre-wrap text-sm">{msg.body_text}</p>
              <p className={`mt-1.5 text-right text-[10px] opacity-60`}>
                {formatTs(msg.created_at, locale)}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-6 pb-6">
        <ComposeForm
          coupleId={coupleId}
          defaultTo={defaultTo}
          onSent={handleSent}
          focusRef={composerRef}
        />
      </div>
    </div>
  );
}

export default function PlannerMessagesPage() {
  const { t } = useT();
  const navigate = useNavigate();
  useDocumentMeta("planner_messages.meta_title", "planner_messages.meta_description");
  const { coupleId: coupleIdParam } = useParams<{ coupleId?: string }>();
  const activeCoupleId = coupleIdParam ? Number(coupleIdParam) : null;

  const [threads, setThreads] = useState<PlannerThreadPreview[]>([]);
  const [clients, setClients] = useState<PlannerClientView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([plannerApi.listInbox(), plannerApi.listClients()])
      .then(([ir, cr]) => {
        setThreads(ir.threads);
        setClients(cr.clients);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Auto-open the only client's thread when nothing is selected, so a single-
  // client planner lands directly in the conversation. Guarded on count === 1
  // and no active selection to avoid redirect loops.
  useEffect(() => {
    if (loading || activeCoupleId) return;
    const threadedIds = new Set(threads.map((th) => th.couple_id));
    const unthreaded = clients.filter((c) => !threadedIds.has(c.couple_id));
    if (threads.length + unthreaded.length !== 1) return;
    const onlyId = threads[0]?.couple_id ?? unthreaded[0]?.couple_id;
    if (onlyId != null) navigate(`/app/planner/messages/${onlyId}`, { replace: true });
  }, [loading, activeCoupleId, threads, clients, navigate]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-umber-400">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-2xl border border-paper-300 bg-white shadow-soft dark:border-umber-700 dark:bg-umber-800 dark:shadow-none">
      {/* Sidebar — 280px on desktop, full-width on mobile when no thread selected */}
      <div
        className={`${
          activeCoupleId ? "hidden sm:flex" : "flex w-full sm:w-72"
        } sm:w-72 flex-col sm:flex-shrink-0`}
      >
        <ThreadSidebar threads={threads} clients={clients} activeCoupleId={activeCoupleId} />
      </div>

      {/* Main thread panel */}
      <main
        className={`${activeCoupleId ? "flex" : "hidden sm:flex"} flex-1 flex-col overflow-hidden`}
      >
        {activeCoupleId ? (
          <ThreadPanel coupleId={activeCoupleId} clients={clients} />
        ) : clients.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="max-w-xs text-sm text-umber-500 dark:text-umber-400">
              {t("planner_messages.empty_no_clients")}
            </p>
            <Link to="/app/planner/clients" className="btn-primary btn-sm">
              {t("planner_messages.empty_add_client_cta")}
            </Link>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-umber-400 dark:text-umber-500">
            {t("planner_messages.select_client")}
          </div>
        )}
      </main>
    </div>
  );
}
