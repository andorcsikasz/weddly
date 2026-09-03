// Live wedding prediction markets — couple-authenticated board management at
// /app/markets. Sibling feature to the quiz game (frontend/src/pages/quiz/),
// under the same "Wēddly Games" umbrella but its own nav row and its own
// join code, since a pari-mutuel points market has no slide-by-slide host
// console to share. See shared/markets.ts for the payout math.
//
// One board per couple in practice — the API supports several, but the page
// keeps that invisible: it auto-provisions the couple's first board on
// arrival and manages it directly, no board-picker UI to build or explain.

import type { MarketBoardDetail, MarketLeaderboardEntry, MarketQuestion } from "@shared/markets";
import { Check, Copy, Pause, Play, QrCode, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { marketsApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

function playUrl(joinCode: string): string {
  return `${window.location.origin}/play/markets/${joinCode}`;
}

function QuestionCard({
  question,
  onResolve,
  onVoid,
  onDelete,
}: {
  question: MarketQuestion;
  onResolve: (outcome: "yes" | "no") => void;
  onVoid: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const total = question.pool.yes + question.pool.no;

  return (
    <li className="rounded-2xl border border-ink-900/15 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900/40">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-ink-900 dark:text-paper-50">{question.prompt}</p>
        <span className="shrink-0 rounded-full bg-paper-200 px-2.5 py-1 text-[11px] font-medium text-ink-600 dark:bg-umber-700 dark:text-umber-100">
          {t(`markets.question_status_${question.status}`)}
        </span>
      </div>

      {question.status === "resolved" && question.outcome && (
        <p className="mt-1 text-sm font-medium text-sage-600 dark:text-sage-300">
          {t("markets.outcome_label", { outcome: t(`common.${question.outcome}`) })}
        </p>
      )}

      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-800">
          <div
            className="h-full bg-sage-500 dark:bg-sage-400"
            style={{ width: `${total > 0 ? question.probability : 50}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs text-ink-500 dark:text-umber-300">
          <span>
            {t("markets.pool_label", {
              yes: String(question.pool.yes),
              no: String(question.pool.no),
            })}
          </span>
          <span>{t("markets.probability_label", { pct: String(question.probability) })}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {question.status === "closed" && (
          <>
            <button type="button" className="btn-primary btn-sm" onClick={() => onResolve("yes")}>
              {t("markets.resolve_yes")}
            </button>
            <button type="button" className="btn-outline btn-sm" onClick={() => onResolve("no")}>
              {t("markets.resolve_no")}
            </button>
          </>
        )}
        {(question.status === "open" || question.status === "closed") && (
          <button
            type="button"
            className="btn-ghost btn-sm inline-flex items-center gap-1 text-ink-500 dark:text-umber-300"
            onClick={onVoid}
          >
            <X size={14} aria-hidden="true" /> {t("markets.void_button")}
          </button>
        )}
        {question.status === "open" && total === 0 && (
          <button
            type="button"
            className="btn-ghost btn-sm inline-flex items-center gap-1 text-ink-500 dark:text-umber-300"
            onClick={onDelete}
          >
            <Trash2 size={14} aria-hidden="true" /> {t("markets.delete_button")}
          </button>
        )}
      </div>
    </li>
  );
}

export default function MarketsPage() {
  const { t } = useT();
  useDocumentMeta("seo.markets_title", "seo.markets_description");
  const toast = useToast();
  const confirm = useConfirm();

  const [board, setBoard] = useState<MarketBoardDetail | null>(null);
  const [leaderboard, setLeaderboard] = useState<MarketLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function refresh(boardId: number) {
    const [b, lb] = await Promise.all([marketsApi.get(boardId), marketsApi.leaderboard(boardId)]);
    setBoard(b.board);
    setLeaderboard(lb.leaderboard);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { boards } = await marketsApi.list();
        const first = boards[0] ?? (await marketsApi.create(t("markets.page_title"))).board;
        if (!alive) return;
        await refresh(first.id);
      } catch (e) {
        if (alive) toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (qrUrl) URL.revokeObjectURL(qrUrl);
    };
  }, [qrUrl]);

  async function toggleLive() {
    if (!board) return;
    try {
      const res =
        board.status === "live" ? await marketsApi.end(board.id) : await marketsApi.start(board.id);
      setBoard(res.board);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function copyLink() {
    if (!board) return;
    try {
      await navigator.clipboard.writeText(playUrl(board.joinCode));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  async function openQr() {
    if (!board) return;
    try {
      const blob = await marketsApi.qrBlob(board.id);
      const url = URL.createObjectURL(blob);
      setQrUrl(url);
      setQrOpen(true);
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  async function addQuestion() {
    if (!board || !prompt.trim() || !closesAt) return;
    const ms = new Date(closesAt).getTime();
    if (!Number.isFinite(ms)) return;
    setSubmitting(true);
    try {
      const res = await marketsApi.addQuestion(board.id, prompt.trim(), ms);
      setBoard(res.board);
      setPrompt("");
      setClosesAt("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("markets.save_error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveQuestion(questionId: number, outcome: "yes" | "no") {
    if (!board) return;
    try {
      await marketsApi.resolveQuestion(board.id, questionId, outcome);
      await refresh(board.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function voidQuestion(question: MarketQuestion) {
    if (!board) return;
    const ok = await confirm({
      title: t("markets.void_confirm_title"),
      body: t("markets.void_confirm_body"),
      confirmLabel: t("markets.void_button"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await marketsApi.voidQuestion(board.id, question.id);
      await refresh(board.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function deleteQuestion(question: MarketQuestion) {
    if (!board) return;
    const ok = await confirm({
      title: t("markets.delete_confirm_title"),
      body: t("markets.delete_confirm_body"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await marketsApi.removeQuestion(board.id, question.id);
      setBoard(res.board);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  if (loading || !board) {
    return (
      <div>
        <h1 className="text-3xl font-grotesk text-ink-900 sm:text-4xl dark:text-paper-50">
          {t("markets.page_title")}
        </h1>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-3xl font-grotesk text-ink-900 sm:text-4xl dark:text-paper-50">
          {t("markets.page_title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600 dark:text-umber-200">
          {t("markets.page_subtitle")}
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-ink-900/15 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
              {t(`markets.status_${board.status}`)}
            </p>
            <p className="mt-0.5 font-mono text-xs text-ink-500 dark:text-umber-300">
              {t("markets.join_code_label")}: {board.joinCode}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-outline btn-sm inline-flex items-center gap-1.5"
              onClick={copyLink}
            >
              {copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              {t("markets.copy_link")}
            </button>
            <button
              type="button"
              className="btn-outline btn-sm inline-flex items-center gap-1.5"
              onClick={openQr}
            >
              <QrCode size={14} aria-hidden="true" />
              QR
            </button>
            <button
              type="button"
              className="btn-primary btn-sm inline-flex items-center gap-1.5"
              onClick={toggleLive}
            >
              {board.status === "live" ? (
                <>
                  <Pause size={14} aria-hidden="true" /> {t("markets.end_button")}
                </>
              ) : (
                <>
                  <Play size={14} aria-hidden="true" />
                  {board.status === "ended"
                    ? t("markets.resume_button")
                    : t("markets.start_button")}
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {qrOpen && qrUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4"
          role="presentation"
          onMouseDown={() => setQrOpen(false)}
        >
          <div
            className="rounded-2xl bg-paper-50 p-6 text-center dark:bg-umber-900"
            role="dialog"
            aria-modal="true"
            aria-label={t("markets.qr_alt")}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <img src={qrUrl} alt={t("markets.qr_alt")} className="mx-auto h-64 w-64" />
            <button
              type="button"
              className="btn-ghost btn-sm mt-3"
              onClick={() => setQrOpen(false)}
            >
              {t("common.dismiss")}
            </button>
          </div>
        </div>
      )}

      <section className="mb-6">
        {board.questions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink-900/20 p-6 text-center text-sm text-ink-500 dark:border-umber-700 dark:text-umber-300">
            {t("markets.empty_title")} — {t("markets.empty_body")}
          </p>
        ) : (
          <ul className="space-y-3">
            {board.questions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                onResolve={(outcome) => resolveQuestion(q.id, outcome)}
                onVoid={() => voidQuestion(q)}
                onDelete={() => deleteQuestion(q)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-ink-900/15 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900/40">
        <h2 className="font-grotesk text-lg text-ink-900 dark:text-paper-50">
          {t("markets.add_question_title")}
        </h2>
        <div className="mt-3 space-y-3">
          <div>
            <label
              htmlFor="markets-prompt"
              className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200"
            >
              {t("markets.prompt_label")}
            </label>
            <input
              id="markets-prompt"
              className="input w-full"
              placeholder={t("markets.prompt_placeholder")}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <label
              htmlFor="markets-closes-at"
              className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200"
            >
              {t("markets.closes_label")}
            </label>
            <input
              id="markets-closes-at"
              type="datetime-local"
              className="input w-full"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!prompt.trim() || !closesAt || submitting}
            onClick={addQuestion}
          >
            {t("markets.add_button")}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-grotesk text-lg text-ink-900 dark:text-paper-50">
          {t("markets.leaderboard_title")}
        </h2>
        {leaderboard.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
            {t("markets.leaderboard_empty")}
          </p>
        ) : (
          <ol className="mt-2 space-y-1.5">
            {leaderboard.map((entry) => (
              <li
                key={entry.player.id}
                className="flex items-center justify-between rounded-xl border border-ink-900/10 bg-paper-50 px-3 py-2 text-sm dark:border-umber-700 dark:bg-umber-900/40"
              >
                <span className="flex items-center gap-2 text-ink-900 dark:text-paper-50">
                  <span className="text-ink-500 dark:text-umber-300">#{entry.rank}</span>
                  <span aria-hidden="true">{entry.player.avatar}</span>
                  {entry.player.name}
                </span>
                <span className="font-medium text-ink-900 dark:text-paper-50">
                  {t("markets.balance_pts", { balance: String(entry.player.balance) })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
