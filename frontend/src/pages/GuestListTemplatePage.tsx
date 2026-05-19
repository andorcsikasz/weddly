// SEO tool: /eszkozok/vendeglista-sablon — downloadable CSV guest-list
// template. Targets "vendéglista sablon", "esküvő vendéglista excel",
// "wedding guest list template" and similar high-intent download queries.
//
// The CSV ships as a static file in public/ so the download URL is
// deep-linkable and crawlers can index it as a discrete resource.

import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const CSV_HREF = "/weddly-vendeglista-sablon.csv";

export default function GuestListTemplatePage() {
  const { t } = useT();
  useDocumentMeta("tools.guest_list_template.page_h1", "tools.guest_list_template.page_intro");

  const columns = [
    t("tools.guest_list_template.col_last_name"),
    t("tools.guest_list_template.col_first_name"),
    t("tools.guest_list_template.col_email"),
    t("tools.guest_list_template.col_phone"),
    t("tools.guest_list_template.col_household"),
    t("tools.guest_list_template.col_diet"),
    t("tools.guest_list_template.col_plus_one"),
    t("tools.guest_list_template.col_status"),
  ];

  return (
    <PublicShell>
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
            {t("tools.guest_list_template.page_eyebrow")}
          </p>
          <h1 className="mt-4 font-serif text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.guest_list_template.page_h1")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.guest_list_template.page_intro")}
          </p>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.guest_list_template.preview_h2")}
          </h2>
          <p className="mt-2 text-sm italic text-ink-500 dark:text-umber-300">
            {t("tools.guest_list_template.preview_caption")}
          </p>
          <div className="mt-6 overflow-x-auto rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-700">
                  {columns.map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-ink-700 dark:text-paper-100"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-paper-200 dark:border-umber-700">
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">Kovács</td>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">Anna</td>
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">anna@…</td>
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">+36 30 …</td>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">Kovács család</td>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">vegetariánus</td>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">Bence</td>
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">pending</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">Nagy</td>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">Zoltán</td>
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">zoltan@…</td>
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">+36 70 …</td>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">Nagy család</td>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-200">glutén-mentes</td>
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">—</td>
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">pending</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.guest_list_template.download_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.guest_list_template.download_body")}
          </p>
          <a href={CSV_HREF} download className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
            {t("tools.guest_list_template.download_csv_btn")}
          </a>
          <p className="mt-3 text-xs italic text-ink-500 dark:text-umber-300">
            {t("tools.guest_list_template.download_csv_hint")}
          </p>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.guest_list_template.organization_h2")}
          </h2>
          <ul className="mt-8 space-y-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            <li>{t("tools.guest_list_template.organization_li_1")}</li>
            <li>{t("tools.guest_list_template.organization_li_2")}</li>
            <li>{t("tools.guest_list_template.organization_li_3")}</li>
          </ul>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.guest_list_template.cta_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.guest_list_template.cta_body")}
          </p>
          <Link to="/signup" className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
            {t("tools.guest_list_template.cta_button")}
          </Link>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.guest_list_template.faq_h2")}
          </h2>
          <div className="mt-8 space-y-3">
            {[
              {
                q: t("tools.guest_list_template.faq_q1"),
                a: t("tools.guest_list_template.faq_a1"),
              },
              {
                q: t("tools.guest_list_template.faq_q2"),
                a: t("tools.guest_list_template.faq_a2"),
              },
              {
                q: t("tools.guest_list_template.faq_q3"),
                a: t("tools.guest_list_template.faq_a3"),
              },
            ].map((entry) => (
              <details
                key={entry.q}
                className="group rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-5 py-4 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-6 sm:py-5"
              >
                <summary className="cursor-pointer list-none font-serif text-xl text-ink-900 dark:text-paper-50">
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
