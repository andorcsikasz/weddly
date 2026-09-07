// /app/games/quiz/:quizId — the couple's quiz builder. A slide list (up/down
// + delete, no drag-and-drop dependency) on the left, a kind-specific editor
// on the right. Locked once the quiz goes live — see requireEditable on the
// backend; the same rule is mirrored here so the couple sees why, not just a
// 400 on save.
//
// Dark "console" chrome (GamesConsole.css), same #0c1019 canvas as the hub,
// the quiz library and the live host screen — the couple moves from list to
// builder to host without ever leaving the games product family.

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Grid3x3,
  Hash,
  Play,
  ScrollText,
  ToggleLeft,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useConfirm, useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { quizApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import type {
  QuizBinaryConfig,
  QuizDetail,
  QuizHeatmapConfig,
  QuizMcqConfig,
  QuizNumberConfig,
  QuizSlide,
  QuizSlideKind,
} from "@shared/quiz";
import { HeatmapPad } from "./HeatmapPad";
import "../games/GamesConsole.css";

const KIND_ICON: Record<QuizSlideKind, typeof Grid3x3> = {
  mcq: Grid3x3,
  binary: ToggleLeft,
  number: Hash,
  heatmap: BarChart3,
  section: ChevronRight,
  story: ScrollText,
};

/** A brand-new slide needs SOME non-empty seed content — the backend
 *  rightly rejects blank option/axis-label strings (a slide with truly
 *  nothing in it isn't a slide yet), so "add slide" has to hand it real,
 *  immediately-editable placeholder text rather than empty strings. */
function buildKindDefaults(
  t: (key: string, vars?: Record<string, string | number>) => string,
): Record<QuizSlideKind, () => { prompt: string; config: Record<string, unknown> }> {
  const optionDefaults = (count: number) =>
    Array.from({ length: count }, (_, i) => t("quiz.builder.option_placeholder", { n: i + 1 }));
  return {
    mcq: () => ({ prompt: "", config: { options: optionDefaults(4), correctIndex: null } }),
    binary: () => ({ prompt: "", config: { options: optionDefaults(2), correctIndex: null } }),
    number: () => ({
      prompt: "",
      config: {
        min: 0,
        max: 100,
        step: 1,
        correctValue: null,
        unit: null,
        toleranceFraction: 0.05,
      },
    }),
    heatmap: () => ({
      prompt: "",
      config: {
        xLabel: [t("quiz.builder.axis_default_low"), t("quiz.builder.axis_default_high")],
        yLabel: [t("quiz.builder.axis_default_low"), t("quiz.builder.axis_default_high")],
        target: null,
        toleranceRadius: 0.15,
      },
    }),
    section: () => ({ prompt: "", config: {} }),
    story: () => ({ prompt: "", config: {} }),
  };
}

export default function QuizBuilderPage() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { quizId: quizIdParam } = useParams<{ quizId: string }>();
  const quizId = Number(quizIdParam);

  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const kindDefaults = useMemo(() => buildKindDefaults(t), [t]);

  useEffect(() => {
    if (!Number.isFinite(quizId)) return;
    quizApi
      .get(quizId)
      .then((r) => {
        setQuiz(r.quiz);
        setSelectedId((prev) => prev ?? r.quiz.slides[0]?.id ?? null);
      })
      .catch(() => setQuiz(null));
  }, [quizId]);

  const locked = quiz?.status === "live";
  const selected = quiz?.slides.find((s) => s.id === selectedId) ?? null;

  function applyQuiz(next: QuizDetail) {
    setQuiz(next);
  }

  async function handleRename(title: string) {
    if (!quiz || !title.trim() || title === quiz.title) return;
    try {
      const { quiz: next } = await quizApi.rename(quiz.id, title.trim());
      applyQuiz(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  async function handleAddSlide(kind: QuizSlideKind) {
    if (!quiz) return;
    const defaults = kindDefaults[kind]();
    try {
      const { quiz: next } = await quizApi.addSlide(quiz.id, {
        kind,
        prompt: defaults.prompt || t(`quiz.builder.kind_${kind}`),
        config: defaults.config as never,
      });
      applyQuiz(next);
      const added = next.slides[next.slides.length - 1];
      if (added) setSelectedId(added.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  async function handleMove(slideId: number, direction: "up" | "down") {
    if (!quiz) return;
    try {
      const { quiz: next } = await quizApi.moveSlide(quiz.id, slideId, direction);
      applyQuiz(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  async function handleDeleteSlide(slideId: number) {
    if (!quiz) return;
    const ok = await confirm({
      title: t("quiz.builder.delete_slide_confirm_title"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      const { quiz: next } = await quizApi.removeSlide(quiz.id, slideId);
      applyQuiz(next);
      if (selectedId === slideId) setSelectedId(next.slides[0]?.id ?? null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  async function handleSaveSlide(slideId: number, patch: Record<string, unknown>) {
    if (!quiz) return;
    setBusy(true);
    try {
      const { quiz: next } = await quizApi.updateSlide(quiz.id, slideId, patch as never);
      applyQuiz(next);
      toast.success(t("quiz.builder.saved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoLive() {
    if (!quiz) return;
    const ok = await confirm({
      title: t("quiz.builder.go_live_confirm_title"),
      body: t("quiz.builder.go_live_confirm_body"),
      confirmLabel: t("quiz.builder.go_live_confirm_action"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await quizApi.hostStart(quiz.id);
      navigate(`/app/games/quiz/${quiz.id}/host`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  if (!quiz) {
    return (
      <div className="gc-page min-h-screen px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8 xl:px-10">
        <p className="text-sm text-white/60">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="gc-page min-h-screen px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8 xl:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link to="/app/games/quiz" className="gc-link text-sm">
            <ChevronLeft size={14} aria-hidden /> {t("quiz.list.title")}
          </Link>
          <input
            className="min-w-0 flex-1 border-0 bg-transparent font-space text-2xl font-bold text-white focus:outline-none focus:ring-0"
            defaultValue={quiz.title}
            disabled={locked}
            onBlur={(e) => handleRename(e.target.value)}
          />
          {quiz.status === "draft" && (
            <button
              type="button"
              className="gc-btn gc-btn-primary shrink-0"
              onClick={handleGoLive}
              disabled={quiz.slideCount === 0}
            >
              <Play size={16} aria-hidden /> {t("quiz.builder.go_live")}
            </button>
          )}
          {quiz.status !== "draft" && (
            <Link to={`/app/games/quiz/${quiz.id}/host`} className="gc-btn gc-btn-primary shrink-0">
              <Gamepad2 size={16} aria-hidden /> {t("quiz.builder.open_host")}
            </Link>
          )}
        </header>

        {locked && (
          <div className="mb-4 rounded-xl border border-[#f6bf54]/30 bg-[#f6bf54]/10 px-4 py-3 text-sm text-[#ffd98a]">
            {t("quiz.builder.locked_banner")}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <div>
            <ul className="space-y-1.5">
              {quiz.slides.map((slide, index) => {
                const Icon = KIND_ICON[slide.kind];
                return (
                  <li
                    key={slide.id}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-sm ${
                      selectedId === slide.id
                        ? "border-[#7c5cff]/60 bg-[#7c5cff]/15"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setSelectedId(slide.id)}
                    >
                      <Icon
                        size={15}
                        className={`shrink-0 ${selectedId === slide.id ? "text-white" : "text-white/60"}`}
                        aria-hidden
                      />
                      <span className="truncate text-white">
                        {slide.prompt || t(`quiz.builder.kind_${slide.kind}`)}
                      </span>
                    </button>
                    {!locked && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-30"
                          disabled={index === 0}
                          onClick={() => handleMove(slide.id, "up")}
                          aria-label={t("quiz.builder.move_up")}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-30"
                          disabled={index === quiz.slides.length - 1}
                          onClick={() => handleMove(slide.id, "down")}
                          aria-label={t("quiz.builder.move_down")}
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-[#f3899a] hover:bg-[#db2f42]/20 hover:text-[#ffb3bf]"
                          onClick={() => handleDeleteSlide(slide.id)}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {!locked && (
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {(Object.keys(KIND_ICON) as QuizSlideKind[]).map((kind) => {
                  const Icon = KIND_ICON[kind];
                  return (
                    <button
                      key={kind}
                      type="button"
                      className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-white/20 py-2.5 text-[11px] text-white/60 hover:border-white/40 hover:bg-white/5 hover:text-white"
                      onClick={() => handleAddSlide(kind)}
                    >
                      <Icon size={16} aria-hidden />
                      {t(`quiz.builder.kind_${kind}`)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            {selected ? (
              <SlideEditor
                key={selected.id}
                slide={selected}
                locked={locked}
                busy={busy}
                onSave={(patch) => handleSaveSlide(selected.id, patch)}
              />
            ) : (
              <div className="gc-card p-8 text-center text-sm text-white/60">
                {t("quiz.builder.empty_state")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── slide editor ─────────────────────────────────────────────────────────────

function SlideEditor({
  slide,
  locked,
  busy,
  onSave,
}: {
  slide: QuizSlide;
  locked: boolean;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useT();
  const [prompt, setPrompt] = useState(slide.prompt);
  const [subtitle, setSubtitle] = useState(slide.subtitle ?? "");
  const [timeLimitS, setTimeLimitS] = useState<number | null>(slide.timeLimitS);
  const [pointsBase, setPointsBase] = useState(slide.pointsBase);
  const [config, setConfig] = useState<Record<string, unknown>>(
    slide.config as unknown as Record<string, unknown>,
  );

  const answerable =
    slide.kind === "mcq" ||
    slide.kind === "binary" ||
    slide.kind === "number" ||
    slide.kind === "heatmap";

  function save() {
    onSave({
      prompt,
      subtitle: subtitle || null,
      timeLimitS: answerable ? timeLimitS : null,
      pointsBase,
      config: { kind: slide.kind, ...config },
    });
  }

  return (
    <div className="gc-card space-y-4 p-5">
      <div>
        <label className="gc-label" htmlFor="slide-prompt">
          {slide.kind === "section"
            ? t("quiz.builder.section_title_label")
            : t("quiz.builder.prompt_label")}
        </label>
        <textarea
          id="slide-prompt"
          className="gc-input min-h-[4.5rem]"
          disabled={locked}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={300}
        />
      </div>

      {(slide.kind === "section" || slide.kind === "story") && (
        <div>
          <label className="gc-label" htmlFor="slide-subtitle">
            {t("quiz.builder.subtitle_label")}
          </label>
          <textarea
            id="slide-subtitle"
            className="gc-input min-h-[3rem]"
            disabled={locked}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            maxLength={600}
          />
        </div>
      )}

      {(slide.kind === "mcq" || slide.kind === "binary") && (
        <McqEditor
          config={config as unknown as QuizMcqConfig | QuizBinaryConfig}
          locked={locked}
          onChange={setConfig}
        />
      )}
      {slide.kind === "number" && (
        <NumberEditor
          config={config as unknown as QuizNumberConfig}
          locked={locked}
          onChange={setConfig}
        />
      )}
      {slide.kind === "heatmap" && (
        <HeatmapEditor
          config={config as unknown as QuizHeatmapConfig}
          locked={locked}
          onChange={setConfig}
        />
      )}

      {answerable && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="gc-label" htmlFor="slide-time-limit">
              {t("quiz.builder.time_limit_label")}
            </label>
            <input
              id="slide-time-limit"
              type="number"
              className="gc-input"
              disabled={locked}
              min={5}
              max={300}
              value={timeLimitS ?? ""}
              placeholder={t("quiz.builder.untimed_placeholder")}
              onChange={(e) => setTimeLimitS(e.target.value === "" ? null : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="gc-label" htmlFor="slide-points">
              {t("quiz.builder.points_label")}
            </label>
            <input
              id="slide-points"
              type="number"
              className="gc-input"
              disabled={locked}
              min={100}
              max={5000}
              step={100}
              value={pointsBase}
              onChange={(e) => setPointsBase(Number(e.target.value))}
            />
          </div>
        </div>
      )}

      {!locked && (
        <button type="button" className="gc-btn gc-btn-primary" onClick={save} disabled={busy}>
          <Check size={16} aria-hidden /> {t("quiz.builder.save")}
        </button>
      )}
    </div>
  );
}

function McqEditor({
  config,
  locked,
  onChange,
}: {
  config: QuizMcqConfig | QuizBinaryConfig;
  locked: boolean;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const { t } = useT();
  const options = config.options;

  function setOption(index: number, value: string) {
    const next = [...options];
    next[index] = value;
    onChange({ ...config, options: next });
  }

  return (
    <div>
      <span className="gc-label">{t("quiz.builder.options_label")}</span>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct-index"
              className="accent-[#7c5cff]"
              checked={config.correctIndex === i}
              disabled={locked}
              onChange={() => onChange({ ...config, correctIndex: i })}
              aria-label={t("quiz.builder.mark_correct")}
            />
            <input
              className="gc-input"
              disabled={locked}
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={80}
              placeholder={t("quiz.builder.option_placeholder", { n: i + 1 })}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 text-xs text-white/60 underline hover:text-white"
        disabled={locked}
        onClick={() => onChange({ ...config, correctIndex: null })}
      >
        {t("quiz.builder.no_correct_answer")}
      </button>
    </div>
  );
}

function NumberEditor({
  config,
  locked,
  onChange,
}: {
  config: QuizNumberConfig;
  locked: boolean;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const { t } = useT();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="gc-label">{t("quiz.builder.min_label")}</label>
        <input
          type="number"
          className="gc-input"
          disabled={locked}
          value={config.min}
          onChange={(e) => onChange({ ...config, min: Number(e.target.value) })}
        />
      </div>
      <div>
        <label className="gc-label">{t("quiz.builder.max_label")}</label>
        <input
          type="number"
          className="gc-input"
          disabled={locked}
          value={config.max}
          onChange={(e) => onChange({ ...config, max: Number(e.target.value) })}
        />
      </div>
      <div>
        <label className="gc-label">{t("quiz.builder.step_label")}</label>
        <input
          type="number"
          className="gc-input"
          disabled={locked}
          value={config.step}
          onChange={(e) => onChange({ ...config, step: Number(e.target.value) })}
        />
      </div>
      <div>
        <label className="gc-label">{t("quiz.builder.unit_label")}</label>
        <input
          className="gc-input"
          disabled={locked}
          value={config.unit ?? ""}
          maxLength={20}
          onChange={(e) => onChange({ ...config, unit: e.target.value || null })}
        />
      </div>
      <div className="col-span-2">
        <label className="gc-label">{t("quiz.builder.correct_value_label")}</label>
        <input
          type="number"
          className="gc-input"
          disabled={locked}
          value={config.correctValue ?? ""}
          placeholder={t("quiz.builder.no_correct_answer")}
          onChange={(e) =>
            onChange({
              ...config,
              correctValue: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        />
      </div>
    </div>
  );
}

function HeatmapEditor({
  config,
  locked,
  onChange,
}: {
  config: QuizHeatmapConfig;
  locked: boolean;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          className="gc-input"
          disabled={locked}
          value={config.xLabel[0]}
          placeholder={t("quiz.builder.x_low_placeholder")}
          onChange={(e) => onChange({ ...config, xLabel: [e.target.value, config.xLabel[1]] })}
        />
        <input
          className="gc-input"
          disabled={locked}
          value={config.xLabel[1]}
          placeholder={t("quiz.builder.x_high_placeholder")}
          onChange={(e) => onChange({ ...config, xLabel: [config.xLabel[0], e.target.value] })}
        />
        <input
          className="gc-input"
          disabled={locked}
          value={config.yLabel[0]}
          placeholder={t("quiz.builder.y_low_placeholder")}
          onChange={(e) => onChange({ ...config, yLabel: [e.target.value, config.yLabel[1]] })}
        />
        <input
          className="gc-input"
          disabled={locked}
          value={config.yLabel[1]}
          placeholder={t("quiz.builder.y_high_placeholder")}
          onChange={(e) => onChange({ ...config, yLabel: [config.yLabel[0], e.target.value] })}
        />
      </div>
      <div className="rounded-xl bg-[#0c1019] p-4">
        <HeatmapPad
          xLabel={[config.xLabel[0] || "←", config.xLabel[1] || "→"]}
          yLabel={[config.yLabel[0] || "↓", config.yLabel[1] || "↑"]}
          mine={config.target}
          interactive={!locked}
          onPick={(p) => onChange({ ...config, target: p })}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>{t("quiz.builder.heatmap_target_hint")}</span>
        <button
          type="button"
          className="underline hover:text-white"
          disabled={locked}
          onClick={() => onChange({ ...config, target: null })}
        >
          {t("quiz.builder.no_correct_answer")}
        </button>
      </div>
    </div>
  );
}
