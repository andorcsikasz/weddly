// /app/games/quiz — the couple's quiz library, one of the two game types
// nested under the /app/games hub (GamesHubPage). Create, rename-in, open
// the builder, jump to the host console, or delete.

import { ChevronLeft, Gamepad2, Play, Plus, Settings2, Trash2, Users } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Skeleton, useConfirm, useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { quizApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import type { QuizSummary } from "@shared/quiz";

function StatusPill({ status }: { status: QuizSummary["status"] }) {
  const { t } = useT();
  const styles =
    status === "live"
      ? "bg-sage-100 text-sage-800 dark:bg-sage-900/40 dark:text-sage-200"
      : status === "ended"
        ? "bg-paper-200 text-ink-600 dark:bg-umber-800 dark:text-umber-200"
        : "bg-blush-100 text-blush-800 dark:bg-blush-900/40 dark:text-blush-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles}`}
    >
      {t(`quiz.list.status_${status}`)}
    </span>
  );
}

export default function QuizListPage() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    quizApi
      .list()
      .then((r) => setQuizzes(r.quizzes))
      .catch(() => setQuizzes([]));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const { quiz } = await quizApi.create(title.trim());
      navigate(`/app/games/quiz/${quiz.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(quiz: QuizSummary) {
    const ok = await confirm({
      title: t("quiz.list.delete_confirm_title"),
      body: t("quiz.list.delete_confirm_body", { title: quiz.title }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await quizApi.remove(quiz.id);
      setQuizzes((prev) => prev?.filter((q) => q.id !== quiz.id) ?? null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 xl:px-10">
      <Link
        to="/app/games"
        className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
      >
        <ChevronLeft size={14} aria-hidden /> {t("games_hub.title")}
      </Link>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-grotesk text-3xl text-ink-900 dark:text-paper-50">
            <Gamepad2 size={26} aria-hidden /> {t("quiz.list.title")}
          </h1>
          <p className="mt-2 text-ink-600 dark:text-umber-200">{t("quiz.list.subtitle")}</p>
        </div>
        {!creating && (
          <button type="button" className="btn-primary shrink-0" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden /> {t("quiz.list.new_button")}
          </button>
        )}
      </header>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="card mb-6 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label className="field-label" htmlFor="quiz-new-title">
              {t("quiz.list.create_prompt_label")}
            </label>
            <input
              id="quiz-new-title"
              className="input"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("quiz.list.create_placeholder")}
              maxLength={120}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
              {t("quiz.list.create_submit")}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                setCreating(false);
                setTitle("");
              }}
            >
              {t("quiz.list.create_cancel")}
            </button>
          </div>
        </form>
      )}

      {quizzes === null ? (
        <div className="space-y-3">
          <Skeleton variant="block" className="h-20" />
          <Skeleton variant="block" className="h-20" />
        </div>
      ) : quizzes.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg font-medium text-ink-900 dark:text-paper-50">
            {t("quiz.list.empty_title")}
          </p>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {t("quiz.list.empty_body")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {quizzes.map((quiz) => (
            <li key={quiz.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/app/games/quiz/${quiz.id}`}
                    className="truncate font-grotesk text-lg text-ink-900 hover:underline dark:text-paper-50"
                  >
                    {quiz.title}
                  </Link>
                  <StatusPill status={quiz.status} />
                </div>
                <p className="mt-1 flex items-center gap-3 text-xs text-ink-500 dark:text-umber-300">
                  <span>{t("quiz.list.slides_count", { count: quiz.slideCount })}</span>
                  <span className="flex items-center gap-1">
                    <Users size={12} aria-hidden /> {quiz.playerCount}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  to={`/app/games/quiz/${quiz.id}`}
                  className="btn-outline btn-sm"
                  aria-label={t("quiz.list.edit_button")}
                >
                  <Settings2 size={15} aria-hidden /> {t("quiz.list.edit_button")}
                </Link>
                <Link to={`/app/games/quiz/${quiz.id}/host`} className="btn-primary btn-sm">
                  <Play size={15} aria-hidden /> {t("quiz.list.host_button")}
                </Link>
                <button
                  type="button"
                  className="btn-ghost btn-sm text-blush-700 dark:text-blush-300"
                  onClick={() => handleDelete(quiz)}
                  aria-label={t("common.delete")}
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
