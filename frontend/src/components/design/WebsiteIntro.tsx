// First visit to /app/design/website: a three-step onboarding that walks a
// couple through creating their site before the full editor opens.
//
//   1. Choose a template: a snap-scrolling row of the four website templates
//      (the KD Studio "choose your style" pattern: edge-faded row, one card
//      in focus, a tap commits the look).
//   2. See what the site still needs: a checklist derived from the couple's
//      real data (cover photo, photos, the day, the schedule). Nothing is
//      gated; the list only shows what is left.
//   3. Publish and share: one calm explanation, then the editor opens.
//
// Shown only while the site is unpublished and the couple has not dismissed it
// on this device (same localStorage idiom as the Decisions onboarding).
import { type StylePresetSlug, getStylePreset } from "@shared/design";
import { Check, Globe, Link2, Palette, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../lib/i18n";

export const WEBSITE_INTRO_KEY = "weddly.design.website_intro_seen";

/** The four website templates, in the order the sample table shows them. */
const TEMPLATE_SLUGS: readonly StylePresetSlug[] = [
  "tuscan_villa",
  "riviera",
  "atelier",
  "bordeaux",
];

export interface OnboardingChecklistItem {
  key: "cover" | "photos" | "day" | "schedule";
  done: boolean;
}

export function readWebsiteIntroSeen(): boolean {
  try {
    return localStorage.getItem(WEBSITE_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export function WebsiteIntro({
  onDone,
  currentStyle,
  onChooseStyle,
  checklist,
}: {
  onDone: () => void;
  currentStyle: StylePresetSlug;
  onChooseStyle: (slug: StylePresetSlug) => void;
  checklist: OnboardingChecklistItem[];
}) {
  const { t } = useT();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  // Direction of the last move, so the next step slides in from where the
  // couple is travelling rather than crossfading.
  const [dir, setDir] = useState<1 | -1>(1);

  function go(next: 0 | 1 | 2) {
    setDir(next > step ? 1 : -1);
    setStep(next);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDone();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const stepLabels = [
    { Icon: Palette, label: t("design.intro.step_look") },
    { Icon: PenLine, label: t("design.intro.step_details") },
    { Icon: Link2, label: t("design.intro.step_share") },
  ];

  const remaining = checklist.filter((c) => !c.done).length;

  return (
    <section
      aria-labelledby="website-intro-title"
      className="mx-auto flex w-full max-w-2xl flex-col items-center py-10 text-center sm:py-16"
      data-website-intro
      data-step={step}
    >
      <Globe
        size={32}
        strokeWidth={1.25}
        className="text-ink-700 dark:text-paper-100"
        aria-hidden
      />
      <h2
        id="website-intro-title"
        className="mt-4 text-balance font-serif text-[clamp(2rem,1rem+4vw,3.25rem)] leading-tight text-ink-900 dark:text-paper-50"
      >
        {t("design.intro.title")}
      </h2>
      <p className="mt-2 text-base text-ink-600 dark:text-umber-200">{t("design.intro.sub")}</p>

      {/* Progress: three numbered steps. The current one is filled. */}
      <ol className="mt-8 grid w-full grid-cols-3 gap-2" aria-label={t("design.intro.title")}>
        {stepLabels.map(({ Icon, label }, i) => {
          const active = i === step;
          const past = i < step;
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => go(i as 0 | 1 | 2)}
                aria-current={active ? "step" : undefined}
                className={`flex w-full flex-col items-center gap-2 rounded-xl border px-2 py-4 transition-colors [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] active:scale-[0.97] ${
                  active
                    ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
                    : "border-ink-900/10 bg-paper-50 text-ink-700 dark:border-paper-50/10 dark:bg-umber-800 dark:text-paper-100"
                }`}
              >
                {past ? (
                  <Check size={18} strokeWidth={1.5} aria-hidden />
                ) : (
                  <Icon size={18} strokeWidth={1.5} aria-hidden />
                )}
                <span className="text-sm font-medium">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Step body. `key` remounts it per step so the entrance animation replays. */}
      <div
        key={step}
        className="mt-8 w-full text-left"
        style={{ animation: `onboard-in-${dir > 0 ? "fwd" : "back"} 320ms ease-out both` }}
      >
        {step === 0 && <TemplateStep currentStyle={currentStyle} onChooseStyle={onChooseStyle} />}
        {step === 1 && <DetailsStep checklist={checklist} remaining={remaining} />}
        {step === 2 && <PublishStep />}
      </div>

      <div className="mt-10 flex w-full items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => go((step - 1) as 0 | 1 | 2)}
          disabled={step === 0}
          className="h-11 rounded-full px-5 font-grotesk text-sm font-semibold text-ink-700 transition-[scale,opacity] duration-150 [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] enabled:active:scale-[0.97] disabled:opacity-40 dark:text-paper-100"
        >
          {t("design.intro.back")}
        </button>
        {step < 2 ? (
          <button
            type="button"
            onClick={() => go((step + 1) as 0 | 1 | 2)}
            className="inline-flex h-12 items-center rounded-full bg-ink-900 px-8 font-grotesk text-sm font-semibold text-paper-50 transition-[scale,background-color] duration-150 [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] hover:bg-ink-800 active:scale-[0.97] dark:bg-paper-50 dark:text-umber-900 dark:hover:bg-paper-100"
          >
            {t("design.intro.next")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onDone}
            className="inline-flex h-12 items-center rounded-full bg-ink-900 px-8 font-grotesk text-sm font-semibold text-paper-50 transition-[scale,background-color] duration-150 [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] hover:bg-ink-800 active:scale-[0.97] dark:bg-paper-50 dark:text-umber-900 dark:hover:bg-paper-100"
          >
            {t("design.intro.start")}
          </button>
        )}
      </div>
    </section>
  );
}

function TemplateStep({
  currentStyle,
  onChooseStyle,
}: {
  currentStyle: StylePresetSlug;
  onChooseStyle: (slug: StylePresetSlug) => void;
}) {
  const { t } = useT();
  return (
    <div>
      <h3 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
        {t("design.intro.template_title")}
      </h3>
      <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
        {t("design.intro.template_sub")}
      </p>
      {/* Snap row with faded edges. Cards are real buttons so keyboard and
          screen readers get the same choice a tap gives. */}
      <div
        className="mt-5 -mx-4 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:-mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
        style={{
          scrollSnapType: "x mandatory",
          overscrollBehaviorX: "contain",
          mask: "linear-gradient(90deg, transparent, black 15% 85%, transparent)",
          WebkitMask: "linear-gradient(90deg, transparent, black 15% 85%, transparent)",
        }}
      >
        <ul className="flex gap-3">
          {TEMPLATE_SLUGS.map((slug) => {
            const selected = slug === currentStyle;
            const preset = getStylePreset(slug);
            return (
              <li
                key={slug}
                style={{ scrollSnapAlign: "start" }}
                className="w-[9.5rem] shrink-0 sm:w-[11rem]"
              >
                <button
                  type="button"
                  onClick={() => onChooseStyle(slug)}
                  aria-pressed={selected}
                  className={`flex w-full flex-col overflow-hidden rounded-2xl border text-left transition-[scale,box-shadow] duration-150 [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] active:scale-[0.97] ${
                    selected
                      ? "border-ink-900 ring-2 ring-ink-900 ring-offset-2 ring-offset-paper-50 dark:border-paper-50 dark:ring-paper-50"
                      : "border-ink-900/12 bg-paper-50 dark:border-paper-50/12 dark:bg-umber-800"
                  }`}
                >
                  <span className="flex aspect-[3/4] items-end bg-paper-100 p-3 dark:bg-umber-700">
                    <span className="font-serif text-lg leading-tight text-ink-900 dark:text-paper-50">
                      {t(preset.nameKey)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-ink-700 dark:text-umber-200">
                    {selected
                      ? t("design.intro.template_selected")
                      : t("design.intro.template_pick")}
                    {selected && <Check size={14} strokeWidth={1.5} aria-hidden />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function DetailsStep({
  checklist,
  remaining,
}: {
  checklist: OnboardingChecklistItem[];
  remaining: number;
}) {
  const { t } = useT();
  return (
    <div>
      <h3 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
        {t("design.intro.details_title")}
      </h3>
      <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
        {remaining === 0 ? t("design.intro.details_done") : t("design.intro.details_sub")}
      </p>
      <ul className="mt-5 divide-y divide-ink-900/10 rounded-2xl border border-ink-900/10 bg-paper-50 dark:divide-paper-50/10 dark:border-paper-50/10 dark:bg-umber-800">
        {checklist.map((item) => (
          <li key={item.key} className="flex items-center gap-3 px-4 py-3">
            <span
              aria-hidden
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                item.done
                  ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
                  : "border-ink-900/25 dark:border-paper-50/30"
              }`}
            >
              {item.done && <Check size={12} strokeWidth={2} />}
            </span>
            <span
              className={`text-sm ${
                item.done
                  ? "text-ink-500 line-through decoration-ink-900/30 dark:text-umber-300"
                  : "text-ink-900 dark:text-paper-50"
              }`}
            >
              {t(`design.intro.check_${item.key}`)}
            </span>
            <span className="sr-only">
              {item.done ? t("design.intro.done_sr") : t("design.intro.todo_sr")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PublishStep() {
  const { t } = useT();
  return (
    <div>
      <h3 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
        {t("design.intro.publish_title")}
      </h3>
      <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
        {t("design.intro.publish_sub")}
      </p>
    </div>
  );
}
