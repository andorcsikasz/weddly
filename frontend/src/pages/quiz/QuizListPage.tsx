// /app/games/quiz — the couple's quiz library, one of the two game types
// nested under the /app/games hub (GamesHubPage). Create, rename-in, open
// the builder, jump to the host console, or delete.
//
// Dark "console" chrome (GamesConsole.css), same #0c1019 canvas as the
// hub and the live host screen, so every quiz surface sits on one dark
// product family instead of a light management page bolted onto a dark
// game.

import { ChevronLeft, Gamepad2, Play, Plus, Settings2, Trash2, Users } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Skeleton, useConfirm, useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { quizApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import type { QuizSummary } from "@shared/quiz";
import "../games/GamesConsole.css";

function StatusPill({ status }: { status: QuizSummary["status"] }) {
  const { t } = useT();
  const tone =
    status === "live" ? "gc-pill-live" : status === "ended" ? "gc-pill-ended" : "gc-pill-draft";
  return <span className={`gc-pill ${tone}`}>{t(`quiz.list.status_${status}`)}</span>;
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
    <div className="gc-page min-h-screen px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8 xl:px-10">
      <div className="mx-auto max-w-3xl">
        <Link to="/app/games" className="gc-link mb-3 text-sm">
          <ChevronLeft size={14} aria-hidden /> {t("games_hub.title")}
        </Link>
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 font-space text-3xl text-white">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/85">
                <Gamepad2 size={20} aria-hidden />
              </span>
              {t("quiz.list.title")}
            </h1>
            <p className="mt-2 text-white/70">{t("quiz.list.subtitle")}</p>
          </div>
          {!creating && (
            <button
              type="button"
              className="gc-btn gc-btn-primary shrink-0"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} aria-hidden /> {t("quiz.list.new_button")}
            </button>
          )}
        </header>

        {creating && (
          <form
            onSubmit={handleCreate}
            className="gc-card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5"
          >
            <div className="flex-1">
              <label className="gc-label" htmlFor="quiz-new-title">
                {t("quiz.list.create_prompt_label")}
              </label>
              <input
                id="quiz-new-title"
                className="gc-input"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("quiz.list.create_placeholder")}
                maxLength={120}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="gc-btn gc-btn-primary"
                disabled={busy || !title.trim()}
              >
                {t("quiz.list.create_submit")}
              </button>
              <button
                type="button"
                className="gc-btn gc-btn-outline"
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
            <div className="gc-card p-5">
              <Skeleton variant="block" className="h-16" />
            </div>
            <div className="gc-card p-5">
              <Skeleton variant="block" className="h-16" />
            </div>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="gc-card p-8 text-center">
            <p className="text-lg font-medium text-white">{t("quiz.list.empty_title")}</p>
            <p className="mt-1 text-sm text-white/60">{t("quiz.list.empty_body")}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {quizzes.map((quiz) => (
              <li key={quiz.id} className="gc-card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/app/games/quiz/${quiz.id}`}
                      className="truncate font-space text-lg text-white hover:underline"
                    >
                      {quiz.title}
                    </Link>
                    <StatusPill status={quiz.status} />
                  </div>
                  <p className="gc-meta mt-1">
                    <span>{t("quiz.list.slides_count", { count: quiz.slideCount })}</span>
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} aria-hidden /> {quiz.playerCount}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to={`/app/games/quiz/${quiz.id}`}
                    className="gc-btn gc-btn-outline gc-btn-sm"
                    aria-label={t("quiz.list.edit_button")}
                  >
                    <Settings2 size={15} aria-hidden /> {t("quiz.list.edit_button")}
                  </Link>
                  <Link
                    to={`/app/games/quiz/${quiz.id}/host`}
                    className="gc-btn gc-btn-primary gc-btn-sm"
                  >
                    <Play size={15} aria-hidden /> {t("quiz.list.host_button")}
                  </Link>
                  <button
                    type="button"
                    className="gc-btn gc-btn-ghost gc-btn-sm text-[#f3899a] hover:text-white"
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
    </div>
  );
}
