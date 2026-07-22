// SEO tool: /eszkozok/rsvp-szoveg-generator — fill in names + date +
// venue + deadline, get formatted RSVP wording in 3 styles. Targets
// "rsvp minta szöveg", "esküvő meghívó szöveg", "rsvp mit jelent" and
// EN variants.
//
// Pure client state, no backend.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TOOL_FAQ } from "@shared/tool_faq";
import { PublicShell } from "../components/PublicShell";
import { contentLocale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type Style = "formal" | "casual" | "poetic";

function formatHuDate(iso: string): string {
  if (!iso) return "______";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" });
}
function formatEnDate(iso: string): string {
  if (!iso) return "______";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

interface Fields {
  partnerA: string;
  partnerB: string;
  date: string;
  venue: string;
  deadline: string;
}

function huTemplate(style: Style, f: Fields): string {
  const a = f.partnerA || "Anna";
  const b = f.partnerB || "Bence";
  const date = formatHuDate(f.date);
  const venue = f.venue || "______";
  const deadline = formatHuDate(f.deadline);
  if (style === "formal") {
    return `${a} és ${b}\n\nÖrömmel értesítjük, hogy ${date} napján kötünk házasságot.\nHelyszín: ${venue}.\n\nKérjük, kedves visszajelzéseteket legkésőbb ${deadline}-ig küldjétek el.\n\nSzeretettel várunk benneteket.`;
  }
  if (style === "casual") {
    return `Szia!\n\nMi, ${a} és ${b}, ${date}-án összeházasodunk — és nagyon szeretnénk, ha velünk lennétek!\n\nHelyszín: ${venue}.\nKérünk, jelezzétek ${deadline}-ig, hogy számíthatunk-e rátok.\n\nÖlelünk,\n${a} & ${b}`;
  }
  return `Két élet, egy nap, egy kezdő mondat.\n\n${a} és ${b} ${date}-án szövetséget köt egymással\n${venue} oltalmában.\n\nKérünk, ${deadline}-ig osszátok meg velünk, mellettünk lesztek-e azon a napon.\n\n${a} & ${b}`;
}

function enTemplate(style: Style, f: Fields): string {
  const a = f.partnerA || "Anna";
  const b = f.partnerB || "Bence";
  const date = formatEnDate(f.date);
  const venue = f.venue || "______";
  const deadline = formatEnDate(f.deadline);
  if (style === "formal") {
    return `${a} & ${b}\n\nare delighted to invite you to celebrate their wedding on ${date}.\nVenue: ${venue}.\n\nKindly respond by ${deadline}.\n\nWith love.`;
  }
  if (style === "casual") {
    return `Hi!\n\nWe, ${a} and ${b}, are getting married on ${date}, and we'd love for you to be there.\n\nVenue: ${venue}.\nPlease let us know by ${deadline} whether you can make it.\n\nHugs,\n${a} & ${b}`;
  }
  return `Two lives, one day, one beginning.\n\n${a} and ${b} will be married on ${date}\nin the company of ${venue}.\n\nShare the day with us — please reply by ${deadline}.\n\n${a} & ${b}`;
}

export default function RsvpGeneratorPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.rsvp_generator.page_h1", "tools.rsvp_generator.page_intro");

  const [fields, setFields] = useState<Fields>({
    partnerA: "",
    partnerB: "",
    date: "",
    venue: "",
    deadline: "",
  });
  const [style, setStyle] = useState<Style>("formal");
  const [copied, setCopied] = useState(false);

  const output = useMemo(
    () => (locale === "en" ? enTemplate(style, fields) : huTemplate(style, fields)),
    [locale, style, fields],
  );

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
    setCopied(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked (insecure context, permission denied) —
      // the textarea below is selectable as a fallback.
    }
  }

  return (
    <PublicShell>
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
            {t("tools.rsvp_generator.page_eyebrow")}
          </p>
          <h1 className="mt-4 font-grotesk text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.rsvp_generator.page_h1")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.rsvp_generator.page_intro")}
          </p>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-grotesk text-2xl italic leading-tight text-ink-900 dark:text-paper-50">
            {t("tools.rsvp_generator.form_h2")}
          </h2>
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-600 dark:text-paper-200">
                {t("tools.rsvp_generator.form_partner_a_label")}
              </span>
              <input
                type="text"
                value={fields.partnerA}
                onChange={(e) => update("partnerA", e.target.value)}
                placeholder={t("tools.rsvp_generator.form_partner_a_placeholder")}
                className="mt-2 w-full rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 px-4 py-2.5 text-ink-900 dark:text-paper-50 focus:outline-none focus:ring-2 focus:ring-ink-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-600 dark:text-paper-200">
                {t("tools.rsvp_generator.form_partner_b_label")}
              </span>
              <input
                type="text"
                value={fields.partnerB}
                onChange={(e) => update("partnerB", e.target.value)}
                placeholder={t("tools.rsvp_generator.form_partner_b_placeholder")}
                className="mt-2 w-full rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 px-4 py-2.5 text-ink-900 dark:text-paper-50 focus:outline-none focus:ring-2 focus:ring-ink-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-600 dark:text-paper-200">
                {t("tools.rsvp_generator.form_date_label")}
              </span>
              <input
                type="date"
                value={fields.date}
                onChange={(e) => update("date", e.target.value)}
                className="mt-2 w-full rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 px-4 py-2.5 text-ink-900 dark:text-paper-50 focus:outline-none focus:ring-2 focus:ring-ink-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-600 dark:text-paper-200">
                {t("tools.rsvp_generator.form_venue_label")}
              </span>
              <input
                type="text"
                value={fields.venue}
                onChange={(e) => update("venue", e.target.value)}
                placeholder={t("tools.rsvp_generator.form_venue_placeholder")}
                className="mt-2 w-full rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 px-4 py-2.5 text-ink-900 dark:text-paper-50 focus:outline-none focus:ring-2 focus:ring-ink-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-600 dark:text-paper-200">
                {t("tools.rsvp_generator.form_deadline_label")}
              </span>
              <input
                type="date"
                value={fields.deadline}
                onChange={(e) => update("deadline", e.target.value)}
                className="mt-2 w-full rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 px-4 py-2.5 text-ink-900 dark:text-paper-50 focus:outline-none focus:ring-2 focus:ring-ink-400"
              />
            </label>
          </div>

          <h2 className="mt-10 font-grotesk text-2xl italic leading-tight text-ink-900 dark:text-paper-50">
            {t("tools.rsvp_generator.style_h2")}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["formal", "casual", "poetic"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStyle(s)}
                className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                  style === s
                    ? "border-ink-700 bg-ink-700 text-paper-50"
                    : "border-paper-300 dark:border-umber-700 text-ink-700 dark:text-paper-200 hover:bg-paper-100 dark:hover:bg-umber-800"
                }`}
              >
                {t(`tools.rsvp_generator.style_${s}`)}
              </button>
            ))}
          </div>

          <h2 className="mt-10 font-grotesk text-2xl italic leading-tight text-ink-900 dark:text-paper-50">
            {t("tools.rsvp_generator.output_h2")}
          </h2>
          <textarea
            readOnly
            value={output}
            rows={Math.min(14, output.split("\n").length + 2)}
            className="mt-4 w-full rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 px-4 py-3 font-serif text-base leading-relaxed text-ink-900 dark:text-paper-50 focus:outline-none focus:ring-2 focus:ring-ink-400"
          />
          <button type="button" onClick={copy} className="btn-outline btn-md mt-3">
            {copied
              ? t("tools.rsvp_generator.output_copied")
              : t("tools.rsvp_generator.output_copy_btn")}
          </button>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.rsvp_generator.cta_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.rsvp_generator.cta_body")}
          </p>
          <Link to="/signup" className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
            {t("tools.rsvp_generator.cta_button")}
          </Link>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.rsvp_generator.faq_h2")}
          </h2>
          <div className="mt-8 space-y-3">
            {TOOL_FAQ[contentLocale(locale)].rsvp_generator.map((entry) => (
              <details
                key={entry.q}
                className="group rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-5 py-4 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-6 sm:py-5"
              >
                <summary className="cursor-pointer list-none font-grotesk text-xl text-ink-900 dark:text-paper-50">
                  {entry.q}
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-umber-200">
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
