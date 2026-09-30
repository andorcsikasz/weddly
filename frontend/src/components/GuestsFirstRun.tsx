import { Check, Download, FileSpreadsheet, PenLine, Upload, Utensils, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useT } from "../lib/i18n";

export type MealIntent = "yes" | "no";

/**
 * First view of an empty guest list: a two-question flow instead of a blank
 * page. Meals come FIRST because the RSVP form is shaped by the answer, and
 * the list question then offers the spreadsheet route (with our template)
 * before the one-by-one route, since most couples already keep a list
 * somewhere. The third segment (invites) is shown but not a step here: it
 * needs guests to exist, and the page's own check-in guide takes over then.
 *
 * Nothing is written by the meals answer itself. There are no households to
 * flag yet, so the page holds the intent and applies it the moment the first
 * guests land.
 */
export function GuestsFirstRun({
  mealIntent,
  onMealIntent,
  onAddGuest,
  onImport,
  onDownloadTemplate,
  importing,
}: {
  mealIntent: MealIntent | null;
  onMealIntent: (next: MealIntent) => void;
  onAddGuest: () => void;
  onImport: (file: File) => void;
  onDownloadTemplate: () => void;
  importing: boolean;
}) {
  const { t } = useT();
  const [step, setStep] = useState<0 | 1>(0);
  const [source, setSource] = useState<"sheet" | "manual" | null>(null);
  const segments = [
    t("guests.first_run.progress_meals"),
    t("guests.first_run.progress_guests"),
    t("guests.first_run.progress_invites"),
  ];

  return (
    <section className="mx-auto max-w-xl pb-10 pt-2 sm:pt-8">
      <ol className="grid grid-cols-3 gap-1.5" aria-label={t("guests.title")}>
        {segments.map((label, i) => (
          <li key={label} className="min-w-0">
            <span
              aria-hidden
              className={`block h-1.5 rounded-full transition-colors duration-300 ${
                i <= step ? "bg-ink-900 dark:bg-paper-50" : "bg-paper-300 dark:bg-umber-600"
              }`}
            />
            <span
              className={`mt-1.5 block truncate text-[11px] font-medium ${
                i === step ? "text-ink-900 dark:text-paper-50" : "text-ink-400 dark:text-umber-400"
              }`}
              aria-current={i === step ? "step" : undefined}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-10 text-sm font-medium text-ink-500 dark:text-umber-300">
        {t("guests.first_run.step_of", { n: step + 1, total: 2 })}
      </p>

      {step === 0 ? (
        <div key="meals" className="animate-fade-in-up">
          <h2 className="mt-2 font-grotesk text-[1.75rem] font-bold leading-tight tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
            {t("guests.first_run.meals_title")}
          </h2>
          <div role="radiogroup" className="mt-7 space-y-3">
            <Option
              selected={mealIntent === "yes"}
              onSelect={() => onMealIntent("yes")}
              icon={<Utensils size={20} strokeWidth={1.5} aria-hidden />}
              title={t("guests.first_run.meals_yes")}
              body={t("guests.first_run.meals_yes_body")}
            />
            <Option
              selected={mealIntent === "no"}
              onSelect={() => onMealIntent("no")}
              icon={<X size={20} strokeWidth={1.5} aria-hidden />}
              title={t("guests.first_run.meals_no")}
              body={t("guests.first_run.meals_no_body")}
            />
          </div>
          <button
            type="button"
            className="btn-primary mt-8 w-full justify-center py-3.5 text-base"
            disabled={mealIntent === null}
            onClick={() => setStep(1)}
          >
            {t("guests.first_run.continue")}
          </button>
        </div>
      ) : (
        <div key="list" className="animate-fade-in-up">
          <h2 className="mt-2 font-grotesk text-[1.75rem] font-bold leading-tight tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
            {t("guests.first_run.list_title")}
          </h2>
          <div role="radiogroup" className="mt-7 space-y-3">
            <Option
              selected={source === "sheet"}
              onSelect={() => setSource("sheet")}
              icon={<FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden />}
              title={t("guests.first_run.list_sheet")}
              body={t("guests.first_run.list_sheet_body")}
            />
            <Option
              selected={source === "manual"}
              onSelect={() => setSource("manual")}
              icon={<PenLine size={20} strokeWidth={1.5} aria-hidden />}
              title={t("guests.first_run.list_manual")}
              body={t("guests.first_run.list_manual_body")}
            />
          </div>

          {source === "sheet" && (
            // The template is offered BEFORE the upload, not after a failed
            // one: a list with the wrong columns is the usual first import.
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-paper-200/70 px-5 py-3.5 dark:bg-umber-700/60">
              <p className="text-sm text-ink-600 dark:text-umber-200">
                {t("guests.first_run.template_hint")}
              </p>
              <button
                type="button"
                onClick={onDownloadTemplate}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 underline decoration-paper-400 underline-offset-2 hover:decoration-ink-900 dark:text-paper-50 dark:decoration-umber-500 dark:hover:decoration-paper-50"
              >
                <Download size={14} aria-hidden /> {t("guests.first_run.template_cta")}
              </button>
            </div>
          )}

          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              className="btn-outline shrink-0 bg-white py-3.5 text-base dark:bg-umber-800"
              onClick={() => setStep(0)}
            >
              {t("guests.first_run.back")}
            </button>
            {source === "sheet" ? (
              <label
                className={`btn-primary flex-1 cursor-pointer justify-center py-3.5 text-base ${
                  importing ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <Upload size={16} aria-hidden /> {t("guests.first_run.upload_cta")}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onImport(f);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : (
              <button
                type="button"
                className="btn-primary flex-1 justify-center py-3.5 text-base"
                disabled={source === null}
                onClick={onAddGuest}
              >
                {t("guests.first_run.add_cta")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** A full-width choice row. Selection is an outline, not a fill: the chosen
 *  row gets a solid dark border, the rest stay on a hairline. */
function Option({
  selected,
  onSelect,
  icon,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-4 rounded-2xl border-2 bg-white px-5 py-4 text-left transition-colors dark:bg-umber-800 ${
        selected
          ? "border-ink-900 dark:border-paper-50"
          : "border-paper-200 hover:border-paper-400 dark:border-umber-700 dark:hover:border-umber-500"
      }`}
    >
      <span className="shrink-0 text-ink-700 dark:text-paper-200">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink-900 dark:text-paper-50">
          {title}
        </span>
        <span className="mt-0.5 block text-sm leading-snug text-ink-500 dark:text-umber-300">
          {body}
        </span>
      </span>
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          selected
            ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
            : "border-paper-300 dark:border-umber-600"
        }`}
      >
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  );
}
