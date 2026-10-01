// SEO tool: /{lang}/tools/rsvp-text-generator. Fill in names, date, venue
// and deadline, get RSVP wording as a full invitation, a short message or a
// reminder, in three tones and any of the five shipped languages. Targets
// "rsvp minta szöveg", "esküvő meghívó szöveg", "rsvp mit jelent" and
// EN variants.
//
// Pure client state, no backend. The wording itself lives in
// lib/rsvp_wording.ts so the output language can differ from the UI's.

import { TOOL_FAQ } from "@shared/tool_faq";
import { UI_LOCALES, type UiLocale } from "@shared/locales";
import { Check, ChevronDown, Copy, Mail, MessageCircle } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { Switch } from "../components/ui/Switch";
import { LOCALE_NAMES, useT } from "../lib/i18n";
import {
  buildRsvpText,
  RSVP_FORMATS,
  RSVP_TONES,
  type RsvpFormat,
  type RsvpInput,
  type RsvpTone,
} from "../lib/rsvp_wording";
import { useDocumentMeta } from "../lib/seo";

const INPUT =
  "mt-1.5 h-12 w-full rounded-xl bg-paper-100 px-4 text-base text-ink-950 placeholder:text-ink-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-ink-950 dark:bg-umber-800 dark:text-paper-50 dark:placeholder:text-umber-400 dark:focus:bg-umber-700 dark:focus:ring-paper-50";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-700 dark:text-paper-200">{label}</span>
      {children}
    </label>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-paper-100 p-1 dark:bg-umber-800"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`h-10 rounded-full px-3 text-sm font-semibold transition-colors ${
              active
                ? "bg-ink-950 text-white dark:bg-paper-50 dark:text-ink-950"
                : "text-ink-700 hover:text-ink-950 dark:text-paper-200 dark:hover:text-paper-50"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function RsvpGeneratorPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.rsvp_generator.page_h1", "tools.rsvp_generator.page_intro");

  const [fields, setFields] = useState<RsvpInput>({
    partnerA: "",
    partnerB: "",
    date: "",
    time: "",
    venue: "",
    deadline: "",
    contact: "",
    plusOne: false,
    dietary: false,
    adultsOnly: false,
  });
  const [tone, setTone] = useState<RsvpTone>("formal");
  const [format, setFormat] = useState<RsvpFormat>("invitation");
  const [lang, setLang] = useState<UiLocale>(locale);
  const [copied, setCopied] = useState(false);

  const output = useMemo(
    () => buildRsvpText(lang, format, tone, fields),
    [lang, format, tone, fields],
  );

  function update<K extends keyof RsvpInput>(key: K, value: RsvpInput[K]) {
    setFields((f) => ({ ...f, [key]: value }));
    setCopied(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked (insecure context, permission denied); the
      // preview text is selectable as a fallback.
    }
  }

  const encoded = encodeURIComponent(output);
  const shareBtn =
    "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-paper-100 px-5 text-sm font-semibold text-ink-950 transition-colors hover:bg-paper-200 dark:bg-umber-800 dark:text-paper-50 dark:hover:bg-umber-700";

  return (
    <PublicShell>
      <section>
        <div className="mx-auto max-w-6xl px-4 pt-12 pb-8 sm:px-6 sm:pt-16 lg:px-8">
          <h1 className="max-w-3xl font-grotesk text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-ink-950 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.rsvp_generator.page_h1")}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-paper-300">
            {t("tools.rsvp_generator.page_intro")}
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14 lg:px-8">
          <div className="space-y-10">
            <div>
              <h2 className="text-xl font-bold tracking-[-0.01em] text-ink-950 dark:text-paper-50">
                {t("tools.rsvp_generator.form_h2")}
              </h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label={t("tools.rsvp_generator.form_partner_a_label")}>
                  <input
                    type="text"
                    value={fields.partnerA}
                    onChange={(e) => update("partnerA", e.target.value)}
                    placeholder={t("tools.rsvp_generator.form_partner_a_placeholder")}
                    className={INPUT}
                  />
                </Field>
                <Field label={t("tools.rsvp_generator.form_partner_b_label")}>
                  <input
                    type="text"
                    value={fields.partnerB}
                    onChange={(e) => update("partnerB", e.target.value)}
                    placeholder={t("tools.rsvp_generator.form_partner_b_placeholder")}
                    className={INPUT}
                  />
                </Field>
                <Field label={t("tools.rsvp_generator.form_date_label")}>
                  <input
                    type="date"
                    value={fields.date}
                    onChange={(e) => update("date", e.target.value)}
                    className={INPUT}
                  />
                </Field>
                <Field label={t("tools.rsvp_generator.form_time_label")}>
                  <input
                    type="time"
                    value={fields.time}
                    onChange={(e) => update("time", e.target.value)}
                    className={INPUT}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t("tools.rsvp_generator.form_venue_label")}>
                    <input
                      type="text"
                      value={fields.venue}
                      onChange={(e) => update("venue", e.target.value)}
                      placeholder={t("tools.rsvp_generator.form_venue_placeholder")}
                      className={INPUT}
                    />
                  </Field>
                </div>
                <Field label={t("tools.rsvp_generator.form_deadline_label")}>
                  <input
                    type="date"
                    value={fields.deadline}
                    onChange={(e) => update("deadline", e.target.value)}
                    className={INPUT}
                  />
                </Field>
                <Field label={t("tools.rsvp_generator.form_contact_label")}>
                  <input
                    type="text"
                    value={fields.contact}
                    onChange={(e) => update("contact", e.target.value)}
                    placeholder={t("tools.rsvp_generator.form_contact_placeholder")}
                    className={INPUT}
                  />
                </Field>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-[-0.01em] text-ink-950 dark:text-paper-50">
                {t("tools.rsvp_generator.options_h2")}
              </h2>
              <div className="mt-3 divide-y divide-paper-200 dark:divide-umber-800">
                {(
                  [
                    ["plusOne", "opt_plus_one"],
                    ["dietary", "opt_dietary"],
                    ["adultsOnly", "opt_adults_only"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-4 py-3.5">
                    <span className="text-base font-medium text-ink-900 dark:text-paper-100">
                      {t(`tools.rsvp_generator.${label}`)}
                    </span>
                    <Switch
                      checked={fields[key]}
                      onChange={(next) => update(key, next)}
                      label={t(`tools.rsvp_generator.${label}`)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-[-0.01em] text-ink-950 dark:text-paper-50">
                {t("tools.rsvp_generator.style_h2")}
              </h2>
              <div className="mt-4">
                <Segmented
                  label={t("tools.rsvp_generator.style_h2")}
                  value={tone}
                  onChange={(v) => {
                    setTone(v);
                    setCopied(false);
                  }}
                  options={RSVP_TONES.map((s) => ({
                    value: s,
                    label: t(`tools.rsvp_generator.style_${s}`),
                  }))}
                />
              </div>
            </div>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-3xl bg-white p-4 shadow-[0_1px_2px_rgba(8,13,28,0.06),0_12px_40px_-12px_rgba(8,13,28,0.18)] ring-1 ring-paper-200 dark:bg-umber-900 dark:ring-umber-800 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Segmented
                    label={t("tools.rsvp_generator.output_h2")}
                    value={format}
                    onChange={(v) => {
                      setFormat(v);
                      setCopied(false);
                    }}
                    options={RSVP_FORMATS.map((f) => ({
                      value: f,
                      label: t(`tools.rsvp_generator.format_${f}`),
                    }))}
                  />
                </div>
                <label className="relative shrink-0">
                  <span className="sr-only">{t("tools.rsvp_generator.output_lang_label")}</span>
                  <select
                    value={lang}
                    onChange={(e) => {
                      setLang(e.target.value as UiLocale);
                      setCopied(false);
                    }}
                    className="h-12 appearance-none rounded-full bg-paper-100 pr-9 pl-4 text-sm font-semibold text-ink-950 focus:outline-none focus:ring-2 focus:ring-ink-950 dark:bg-umber-800 dark:text-paper-50"
                  >
                    {UI_LOCALES.map((l) => (
                      <option key={l} value={l}>
                        {LOCALE_NAMES[l]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden
                    strokeWidth={2}
                    className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-ink-700 dark:text-paper-200"
                  />
                </label>
              </div>

              <p
                aria-live="polite"
                className="mt-5 min-h-[18rem] whitespace-pre-wrap rounded-2xl bg-paper-50 px-5 py-6 text-[17px] leading-relaxed text-ink-950 dark:bg-umber-800 dark:text-paper-50 sm:px-7 sm:py-8"
              >
                {output}
              </p>
              <p className="mt-2 text-right text-xs tabular-nums text-ink-500 dark:text-umber-300">
                {t("tools.rsvp_generator.output_chars", { n: output.length })}
              </p>

              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-800 dark:bg-paper-50 dark:text-ink-950 dark:hover:bg-paper-200"
                >
                  {copied ? (
                    <Check aria-hidden strokeWidth={2} className="h-4 w-4" />
                  ) : (
                    <Copy aria-hidden strokeWidth={2} className="h-4 w-4" />
                  )}
                  {copied
                    ? t("tools.rsvp_generator.output_copied")
                    : t("tools.rsvp_generator.output_copy_btn")}
                </button>
                <a
                  href={`https://wa.me/?text=${encoded}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={shareBtn}
                >
                  <MessageCircle aria-hidden strokeWidth={2} className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {t("tools.rsvp_generator.share_whatsapp")}
                  </span>
                </a>
                <a href={`mailto:?body=${encoded}`} className={shareBtn}>
                  <Mail aria-hidden strokeWidth={2} className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("tools.rsvp_generator.share_email")}</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 rounded-3xl bg-ink-950 px-6 py-10 text-white dark:bg-paper-50 dark:text-ink-950 sm:px-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="font-grotesk text-3xl font-bold leading-tight tracking-[-0.02em]">
                {t("tools.rsvp_generator.cta_h2")}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-white/70 dark:text-ink-700">
                {t("tools.rsvp_generator.cta_body")}
              </p>
            </div>
            <Link
              to="/signup"
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-ink-950 transition-colors hover:bg-paper-200 dark:bg-ink-950 dark:text-white dark:hover:bg-ink-800"
            >
              {t("tools.rsvp_generator.cta_button")}
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
          <h2 className="font-grotesk text-3xl font-bold leading-tight tracking-[-0.02em] text-ink-950 dark:text-paper-50">
            {t("tools.rsvp_generator.faq_h2")}
          </h2>
          <div className="mt-6 divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-800 dark:border-umber-800">
            {TOOL_FAQ[locale].rsvp_generator.map((entry) => (
              <details key={entry.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold text-ink-950 dark:text-paper-50 [&::-webkit-details-marker]:hidden">
                  {entry.q}
                  <ChevronDown
                    aria-hidden
                    strokeWidth={2}
                    className="h-5 w-5 shrink-0 text-ink-500 transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="mt-3 text-base leading-relaxed text-ink-600 dark:text-paper-300">
                  {entry.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
