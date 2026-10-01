// First visit to /app/design/website: one calm card saying what the page is
// for and the three moves it takes, before the full editor opens. Shown only
// while the site is unpublished and the couple has not dismissed it on this
// device (same localStorage idiom as the Decisions onboarding).
import { Globe, Link2, Palette, PenLine } from "lucide-react";
import { useEffect } from "react";
import { useT } from "../../lib/i18n";

export const WEBSITE_INTRO_KEY = "weddly.design.website_intro_seen";

export function readWebsiteIntroSeen(): boolean {
  try {
    return localStorage.getItem(WEBSITE_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export function WebsiteIntro({ onDone }: { onDone: () => void }) {
  const { t } = useT();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === "Escape") onDone();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const steps = [
    { Icon: Palette, label: t("design.intro.step_look") },
    { Icon: PenLine, label: t("design.intro.step_details") },
    { Icon: Link2, label: t("design.intro.step_share") },
  ];

  return (
    <section
      aria-labelledby="website-intro-title"
      className="mx-auto flex max-w-xl animate-fade-in flex-col items-center py-12 text-center sm:py-20"
      data-website-intro
    >
      <Globe
        size={36}
        strokeWidth={1.25}
        className="text-ink-700 dark:text-paper-100"
        aria-hidden
      />
      <h2
        id="website-intro-title"
        className="mt-5 text-balance font-serif text-4xl italic text-ink-900 sm:text-5xl dark:text-paper-50"
      >
        {t("design.intro.title")}
      </h2>
      <p className="mt-2 text-base text-ink-600 dark:text-umber-200">{t("design.intro.sub")}</p>

      <ol className="mt-10 grid w-full grid-cols-3 gap-3">
        {steps.map(({ Icon, label }, i) => (
          <li
            key={label}
            className="flex flex-col items-center gap-2 rounded-xl border border-ink-900/10 bg-paper-50 px-2 py-5 dark:border-paper-50/10 dark:bg-umber-800"
          >
            <Icon
              size={20}
              strokeWidth={1.5}
              className="text-ink-700 dark:text-paper-100"
              aria-hidden
            />
            <span className="font-grotesk text-[11px] font-semibold tabular-nums text-ink-400 dark:text-umber-300">
              {i + 1}
            </span>
            <span className="text-sm font-medium text-ink-900 dark:text-paper-50">{label}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onDone}
        className="mt-10 inline-flex h-12 items-center rounded-full bg-ink-900 px-8 font-grotesk text-sm font-semibold text-paper-50 transition-colors hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 dark:bg-paper-50 dark:text-umber-900 dark:hover:bg-paper-100"
      >
        {t("design.intro.start")}
      </button>
    </section>
  );
}
