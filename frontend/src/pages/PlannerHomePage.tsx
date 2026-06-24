import { MessageSquare, User, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { PlannerClientView, PlannerInviteView, PlannerTaskRow } from "@shared/types";
import { Wordmark } from "../components/Wordmark";
import { plannerApi } from "../lib/endpoints";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { formatDate } from "../lib/format";

function ClientNotes({
  coupleId,
  initial,
}: {
  coupleId: number;
  initial: string | null;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(initial != null && initial.length > 0);
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleBlur() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void plannerApi.updateNotes(coupleId, value).then(() => {
      setSaved(true);
      saveTimer.current = setTimeout(() => setSaved(false), 1500);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-umber-400 hover:text-umber-600 dark:text-umber-500 dark:hover:text-umber-300"
      >
        + {t("planner_home.notes_add")}
      </button>
    );
  }

  return (
    <div className="mt-2">
      <textarea
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        placeholder={t("planner_home.notes_placeholder")}
        className="w-full resize-none rounded-lg border border-paper-200 px-2 py-1.5 text-xs text-ink-700 focus:outline-none focus:ring-1 focus:ring-sage-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200"
      />
      {saved && (
        <p className="mt-0.5 text-[10px] text-sage-600">{t("planner_home.notes_saved")} ✓</p>
      )}
    </div>
  );
}

function TaskSummaryChip({
  summary,
}: {
  summary: PlannerClientView["task_summary"];
}) {
  const { t } = useT();
  if (summary.total === 0) return null;
  if (summary.overdue > 0) {
    const text = t("planner_home.task_summary")
      .replace("{{total}}", String(summary.total))
      .replace("{{overdue}}", String(summary.overdue));
    const parts = text.split(String(summary.overdue));
    return (
      <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
        {parts[0]}
        <span className="font-medium text-red-500">{summary.overdue}</span>
        {parts[1]}
      </p>
    );
  }
  return (
    <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
      {t("planner_home.task_summary_ok")
        .replace("{{total}}", String(summary.total))
        .replace("{{done}}", String(summary.done))}
    </p>
  );
}

function UpcomingTasks({ tasks }: { tasks: PlannerTaskRow[] }) {
  const { t, locale } = useT();

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-umber-400 dark:text-umber-500">
        {t("planner_home.upcoming_empty")}
      </p>
    );
  }

  // Group by couple_id preserving insertion order
  const grouped = new Map<number, { display_name: string; tasks: PlannerTaskRow[] }>();
  for (const task of tasks) {
    if (!grouped.has(task.couple_id)) {
      grouped.set(task.couple_id, { display_name: task.display_name, tasks: [] });
    }
    grouped.get(task.couple_id)!.tasks.push(task);
  }

  const priorityDot = (p: number) => {
    if (p === 2)
      return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 mt-1.5" />;
    if (p === 1)
      return (
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 mt-1.5" />
      );
    return null;
  };

  return (
    <div className="space-y-6">
      {[...grouped.entries()].map(([coupleId, group]) => (
        <div key={coupleId}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-umber-500 dark:text-umber-400">
            {group.display_name}
          </h3>
          <ul className="space-y-1.5">
            {group.tasks.map((task) => (
              <li key={task.task_id} className="flex items-start gap-2">
                {priorityDot(task.priority)}
                <span className="min-w-0 flex-1 text-sm text-ink-800 dark:text-paper-100">
                  {task.title}
                </span>
                <span className="shrink-0 rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] font-medium text-ink-600 dark:bg-umber-700 dark:text-umber-200">
                  {formatDate(task.due_date, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function PlannerHomePage() {
  const { user, logout } = useAuth();
  const { t } = useT();

  const [clients, setClients] = useState<PlannerClientView[]>([]);
  const [tasks, setTasks] = useState<PlannerTaskRow[]>([]);
  const [invites, setInvites] = useState<PlannerInviteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [addStatus, setAddStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [addError, setAddError] = useState("");
  const [enteringId, setEnteringId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([plannerApi.listClients(), plannerApi.listTasks(), plannerApi.listInvites()])
      .then(([cr, tr, ir]) => {
        setClients(cr.clients);
        setTasks(tr.tasks);
        setInvites(ir.invites);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAddStatus("loading");
    setAddError("");
    try {
      await plannerApi.addClient(email.trim());
      const [cr, tr] = await Promise.all([plannerApi.listClients(), plannerApi.listTasks()]);
      setClients(cr.clients);
      setTasks(tr.tasks);
      setEmail("");
      setAddStatus("ok");
    } catch (err) {
      setAddStatus("error");
      setAddError(err instanceof Error ? err.message : t("planner_home.add_client_error"));
    }
  }

  async function handleAcceptInvite(coupleId: number) {
    try {
      await plannerApi.acceptInvite(coupleId);
      const [cr, ir] = await Promise.all([plannerApi.listClients(), plannerApi.listInvites()]);
      setClients(cr.clients);
      setInvites(ir.invites);
    } catch {}
  }

  async function handleDeclineInvite(coupleId: number) {
    try {
      await plannerApi.declineInvite(coupleId);
      setInvites((prev) => prev.filter((i) => i.couple_id !== coupleId));
    } catch {}
  }

  async function handleEnter(coupleId: number) {
    setEnteringId(coupleId);
    try {
      await plannerApi.enterClient(coupleId);
      window.location.assign("/app");
    } catch {
      setEnteringId(null);
    }
  }

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-950">
      <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link
            to="/app/planner"
            className="inline-flex h-11 items-center text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
          >
            <Wordmark size="sm" />
          </Link>
          <div className="flex items-center gap-1">
            <Link
              to="/app/planner/messages"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-paper-200 dark:hover:bg-umber-800"
              aria-label={t("planner_home.messages_link")}
              title={t("planner_home.messages_link")}
            >
              <MessageSquare size={18} aria-hidden="true" />
            </Link>
            <Link
              to="/app/planner/profile"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-paper-200 dark:hover:bg-umber-800"
              aria-label={t("planner_home.profile_link")}
              title={t("planner_home.profile_link")}
            >
              <User size={18} aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex h-11 items-center rounded-full px-3 text-sm text-ink-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
            >
              {t("planner_home.logout")}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 pt-12">
          <h1 className="font-serif italic text-4xl font-semibold sm:text-5xl text-ink-900 dark:text-paper-50">
            {t("planner_home.welcome").replace("{{name}}", user?.full_name.split(" ")[0] ?? "")}
          </h1>
        </div>

        {/* Pending invites from couples */}
        {!loading && invites.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
              {t("planner_home.invites_heading")}
            </h2>
            <div className="space-y-3">
              {invites.map((inv) => (
                <div
                  key={inv.couple_id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10"
                >
                  <div className="min-w-0">
                    <p className="truncate font-grotesk font-semibold text-umber-900 dark:text-paper-50">
                      {inv.display_name}
                    </p>
                    <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
                      {inv.wedding_date
                        ? formatDate(inv.wedding_date, "hu")
                        : t("planner_home.client_wedding_date_none")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAcceptInvite(inv.couple_id)}
                      className="btn-primary btn-sm"
                    >
                      {t("planner_home.invite_accept")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeclineInvite(inv.couple_id)}
                      className="btn-outline btn-sm"
                    >
                      {t("planner_home.invite_decline")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Client roster */}
        <section className="mb-12">
          <h2 className="mb-4 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
            {t("planner_home.clients_roster_heading")}
          </h2>

          {loading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl border border-paper-200 bg-paper-100 dark:border-umber-800 dark:bg-umber-800"
                />
              ))}
            </div>
          ) : clients.length === 0 ? (
            <div className="rounded-xl border border-paper-200 bg-white px-6 py-10 text-center dark:border-umber-800 dark:bg-umber-900">
              <Users className="mx-auto mb-3 h-8 w-8 text-paper-300 dark:text-umber-700" />
              <p className="text-sm text-umber-400 dark:text-umber-500">
                {t("planner_home.clients_empty")}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {clients.map((c) => (
                <div
                  key={c.couple_id}
                  className="rounded-xl border border-paper-200 bg-white px-5 py-4 dark:border-umber-800 dark:bg-umber-900"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-grotesk font-semibold text-umber-900 dark:text-paper-50">
                        {c.display_name}
                      </p>
                      <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
                        {c.wedding_date
                          ? formatDate(c.wedding_date, "hu")
                          : t("planner_home.client_wedding_date_none")}
                        {" · "}
                        {t("planner_home.client_guests").replace(
                          "{{count}}",
                          String(c.confirmed_guests),
                        )}
                      </p>
                      <TaskSummaryChip summary={c.task_summary} />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleEnter(c.couple_id)}
                      disabled={enteringId !== null}
                      className="btn-outline btn-sm shrink-0"
                    >
                      {enteringId === c.couple_id ? "…" : t("planner_home.enter_workspace")}
                    </button>
                  </div>
                  <ClientNotes coupleId={c.couple_id} initial={c.notes} />
                </div>
              ))}
            </div>
          )}

          {/* Add client form */}
          <div className="mt-6 rounded-xl border border-paper-200 bg-white px-5 py-5 dark:border-umber-800 dark:bg-umber-900">
            <p className="mb-3 font-grotesk text-sm font-semibold text-umber-800 dark:text-paper-200">
              {t("planner_home.add_client_heading")}
            </p>
            <form onSubmit={(e) => void handleAddClient(e)} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (addStatus !== "idle") setAddStatus("idle");
                }}
                placeholder={t("planner_home.add_client_placeholder")}
                className="input flex-1 text-sm"
                disabled={addStatus === "loading"}
              />
              <button
                type="submit"
                disabled={addStatus === "loading" || !email.trim()}
                className="btn-primary btn-sm shrink-0"
              >
                {t("planner_home.add_client_button")}
              </button>
            </form>
            {addStatus === "ok" && (
              <p className="mt-2 text-xs text-sage-600">{t("planner_home.add_client_success")}</p>
            )}
            {addStatus === "error" && <p className="mt-2 text-xs text-red-500">{addError}</p>}
          </div>
        </section>

        {/* Upcoming tasks across clients */}
        {!loading && clients.length > 0 && (
          <section className="pb-12">
            <h2 className="mb-4 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
              {t("planner_home.upcoming_heading")}
            </h2>
            <div className="rounded-xl border border-paper-200 bg-white px-5 py-5 dark:border-umber-800 dark:bg-umber-900">
              <UpcomingTasks tasks={tasks} />
            </div>
          </section>
        )}

      </main>
    </div>
  );
}
