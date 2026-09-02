// SEO tool: /eszkozok/vendeglista-sablon — downloadable CSV guest-list
// template. Targets "vendéglista sablon", "esküvő vendéglista excel",
// "wedding guest list template" and similar high-intent download queries.
//
// The CSV ships as a static file in public/ so the download URL is
// deep-linkable and crawlers can index it as a discrete resource. The
// "try it" section below is a second, purely client-side CSV: it lets a
// visitor add a few real rows and download exactly what they typed, no
// signup, so the page teaches the schema by doing rather than only reading.

import { Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { TOOL_FAQ } from "@shared/tool_faq";
import { PublicShell } from "../components/PublicShell";
import { contentLocale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const CSV_HREF = "/weddly-vendeglista-sablon.csv";

type DraftStatus = "pending" | "yes" | "no";

interface DraftGuest {
  id: string;
  firstName: string;
  lastName: string;
  household: string;
  diet: string;
  plusOne: string;
  status: DraftStatus;
}

type DraftForm = Omit<DraftGuest, "id">;

const EMPTY_DRAFT: DraftForm = {
  firstName: "",
  lastName: "",
  household: "",
  diet: "",
  plusOne: "",
  status: "pending",
};

// Locale-flavoured starting rows for the "try it" table — same idea as the
// static preview above, just editable. Folds to hu/en like TOOL_FAQ does;
// the illustrative names don't need five-way translation.
function seedTryGuests(locale: "hu" | "en"): DraftGuest[] {
  if (locale === "hu") {
    return [
      {
        id: "seed-1",
        firstName: "Anna",
        lastName: "Kovács",
        household: "Kovács család",
        diet: "vegetáriánus",
        plusOne: "Bence",
        status: "pending",
      },
      {
        id: "seed-2",
        firstName: "Zoltán",
        lastName: "Nagy",
        household: "Nagy család",
        diet: "gluténmentes",
        plusOne: "",
        status: "pending",
      },
    ];
  }
  return [
    {
      id: "seed-1",
      firstName: "Anna",
      lastName: "Kovács",
      household: "The Kovács family",
      diet: "vegetarian",
      plusOne: "Ben",
      status: "pending",
    },
    {
      id: "seed-2",
      firstName: "Zoltan",
      lastName: "Nagy",
      household: "The Nagy family",
      diet: "gluten-free",
      plusOne: "",
      status: "pending",
    },
  ];
}

let draftIdCounter = 0;
function nextDraftId(): string {
  draftIdCounter += 1;
  return `draft-${draftIdCounter}`;
}

const fieldClass =
  "w-full rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 px-3 py-2 text-sm text-ink-900 dark:text-paper-50 focus:outline-none focus:ring-2 focus:ring-ink-400";

export default function GuestListTemplatePage() {
  const { t, locale } = useT();
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

  const [tryGuests, setTryGuests] = useState<DraftGuest[]>(() =>
    seedTryGuests(contentLocale(locale)),
  );
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);

  function updateDraft<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function addGuest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft.firstName.trim() && !draft.lastName.trim()) return;
    setTryGuests((gs) => [...gs, { id: nextDraftId(), ...draft }]);
    setDraft(EMPTY_DRAFT);
  }

  function removeGuest(id: string) {
    setTryGuests((gs) => gs.filter((g) => g.id !== id));
  }

  function statusLabel(status: DraftStatus) {
    return t(`tools.guest_list_template.try_status_${status}`);
  }

  // Same cell-quoting + BOM pattern as the in-app CSV exports (GuestsPage),
  // scaled down to a client-only download with no backend round trip.
  function downloadTryList() {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [columns.map(cell).join(",")];
    for (const g of tryGuests) {
      rows.push(
        [g.lastName, g.firstName, "", "", g.household, g.diet, g.plusOne, statusLabel(g.status)]
          .map(cell)
          .join(","),
      );
    }
    const blob = new Blob([`﻿${rows.join("\r\n")}\r\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-wedding-guest-list.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PublicShell>
      <section className="relative">
        <div className="mx-auto max-w-5xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
                {t("tools.guest_list_template.page_eyebrow")}
              </p>
              <h1 className="mt-4 font-grotesk text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
                {t("tools.guest_list_template.page_h1")}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
                {t("tools.guest_list_template.page_intro")}
              </p>
            </div>
            {/* Decorative: the heading and intro carry the meaning, so this
                stays out of the accessibility tree. width/height are the real
                pixels so the row reserves its space before the file lands. */}
            <img
              src="/guests-illustration.jpg"
              alt=""
              aria-hidden="true"
              width={1200}
              height={773}
              loading="eager"
              decoding="async"
              className="h-auto w-full rounded-3xl ring-1 ring-paper-300 dark:ring-umber-700"
            />
          </div>
        </div>
      </section>

      <section className="relative stationery-light">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.guest_list_template.preview_h2")}
          </h2>
          <p className="mt-2 text-sm italic text-ink-500 dark:text-umber-300">
            {t("tools.guest_list_template.preview_caption")}
          </p>
          {/* Mobile: render the same two sample rows as stacked label/value
           *  cards. At 393px viewport the 8-column table squeezes headers
           *  down to ~45px each — "HOUSEHOLD" wraps to "HOUS", email and
           *  phone show as ellipses, and the whole table reads as broken
           *  rather than comprehensive. A vertical &lt;dl&gt; per sample
           *  guest keeps every label legible and teaches the template's
           *  schema better than a squeezed table ever could. The desktop
           *  view (sm:+) still gets the spreadsheet metaphor. */}
          <div className="mt-6 grid gap-3 sm:hidden">
            {[
              {
                title: "Kovács Anna",
                muted: ["anna@…", "+36 30 …", "pending"],
                values: [
                  "Kovács",
                  "Anna",
                  "anna@…",
                  "+36 30 …",
                  "Kovács család",
                  "vegetariánus",
                  "Bence",
                  "pending",
                ],
              },
              {
                title: "Nagy Zoltán",
                muted: ["zoltan@…", "+36 70 …", "-", "pending"],
                values: [
                  "Nagy",
                  "Zoltán",
                  "zoltan@…",
                  "+36 70 …",
                  "Nagy család",
                  "glutén-mentes",
                  "-",
                  "pending",
                ],
              },
            ].map((row) => (
              <dl
                key={row.title}
                className="overflow-hidden rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800"
              >
                <div className="border-b border-paper-300 bg-paper-50 px-4 py-2 text-sm font-medium text-ink-900 dark:border-umber-700 dark:bg-umber-700 dark:text-paper-50">
                  {row.title}
                </div>
                <div className="divide-y divide-paper-200 dark:divide-umber-700">
                  {columns.map((label, i) => {
                    const value = row.values[i] ?? "";
                    const muted = row.muted.includes(value);
                    return (
                      <div
                        key={label}
                        className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
                      >
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                          {label}
                        </dt>
                        <dd
                          className={
                            muted
                              ? "text-right text-ink-500 dark:text-umber-300"
                              : "text-right text-ink-700 dark:text-paper-200"
                          }
                        >
                          {value}
                        </dd>
                      </div>
                    );
                  })}
                </div>
              </dl>
            ))}
          </div>
          <div className="mt-6 hidden overflow-x-auto rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 sm:block">
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
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">-</td>
                  <td className="px-3 py-2 text-ink-500 dark:text-umber-300">pending</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Try it — a second, purely client-side CSV. Adding a row here writes
          nowhere but the visitor's own tab, so this stays a teaser: the
          household/diet grouping this page recommends, experienced instead
          of just read. */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.guest_list_template.try_h2")}
          </h2>
          <p className="mt-2 text-sm italic text-ink-500 dark:text-umber-300">
            {t("tools.guest_list_template.try_caption")}
          </p>

          <form
            onSubmit={addGuest}
            className="mt-6 grid gap-3 rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-900 p-4 sm:grid-cols-2 sm:p-5"
          >
            <input
              type="text"
              value={draft.firstName}
              onChange={(e) => updateDraft("firstName", e.target.value)}
              placeholder={t("tools.guest_list_template.try_first_name_placeholder")}
              aria-label={t("tools.guest_list_template.col_first_name")}
              className={fieldClass}
            />
            <input
              type="text"
              value={draft.lastName}
              onChange={(e) => updateDraft("lastName", e.target.value)}
              placeholder={t("tools.guest_list_template.try_last_name_placeholder")}
              aria-label={t("tools.guest_list_template.col_last_name")}
              className={fieldClass}
            />
            <input
              type="text"
              value={draft.household}
              onChange={(e) => updateDraft("household", e.target.value)}
              placeholder={t("tools.guest_list_template.try_household_placeholder")}
              aria-label={t("tools.guest_list_template.col_household")}
              className={fieldClass}
            />
            <input
              type="text"
              value={draft.diet}
              onChange={(e) => updateDraft("diet", e.target.value)}
              placeholder={t("tools.guest_list_template.try_diet_placeholder")}
              aria-label={t("tools.guest_list_template.col_diet")}
              className={fieldClass}
            />
            <input
              type="text"
              value={draft.plusOne}
              onChange={(e) => updateDraft("plusOne", e.target.value)}
              placeholder={t("tools.guest_list_template.try_plus_one_placeholder")}
              aria-label={t("tools.guest_list_template.col_plus_one")}
              className={fieldClass}
            />
            <select
              value={draft.status}
              onChange={(e) => updateDraft("status", e.target.value as DraftStatus)}
              aria-label={t("tools.guest_list_template.col_status")}
              className={fieldClass}
            >
              <option value="pending">{t("tools.guest_list_template.try_status_pending")}</option>
              <option value="yes">{t("tools.guest_list_template.try_status_yes")}</option>
              <option value="no">{t("tools.guest_list_template.try_status_no")}</option>
            </select>
            <button
              type="submit"
              className="btn-primary btn-md inline-flex w-fit items-center gap-1.5 sm:col-span-2"
            >
              <Plus size={16} aria-hidden="true" />
              {t("tools.guest_list_template.try_add_btn")}
            </button>
          </form>

          {tryGuests.length === 0 ? (
            <p className="mt-6 text-sm italic text-ink-500 dark:text-umber-300">
              {t("tools.guest_list_template.try_empty")}
            </p>
          ) : (
            <>
              <div className="mt-6 grid gap-3 sm:hidden">
                {tryGuests.map((g) => (
                  <dl
                    key={g.id}
                    className="overflow-hidden rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800"
                  >
                    <div className="flex items-center justify-between border-b border-paper-300 bg-paper-50 px-4 py-2 dark:border-umber-700 dark:bg-umber-700">
                      <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
                        {[g.firstName, g.lastName].filter(Boolean).join(" ") || "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeGuest(g.id)}
                        aria-label={t("tools.guest_list_template.try_remove_label")}
                        className="rounded-full p-1 text-ink-400 hover:bg-paper-200 hover:text-ink-700 dark:text-umber-400 dark:hover:bg-umber-600 dark:hover:text-paper-100"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="divide-y divide-paper-200 dark:divide-umber-700">
                      {[
                        [columns[4], g.household],
                        [columns[5], g.diet],
                        [columns[6], g.plusOne],
                        [columns[7], statusLabel(g.status)],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
                        >
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                            {label}
                          </dt>
                          <dd className="text-right text-ink-700 dark:text-paper-200">
                            {value || "—"}
                          </dd>
                        </div>
                      ))}
                    </div>
                  </dl>
                ))}
              </div>
              <div className="mt-6 hidden overflow-x-auto rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 sm:block">
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
                      <th className="px-3 py-2">
                        <span className="sr-only">
                          {t("tools.guest_list_template.try_remove_label")}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tryGuests.map((g) => (
                      <tr
                        key={g.id}
                        className="border-b border-paper-200 last:border-0 dark:border-umber-700"
                      >
                        <td className="px-3 py-2 text-ink-700 dark:text-paper-200">{g.lastName}</td>
                        <td className="px-3 py-2 text-ink-700 dark:text-paper-200">
                          {g.firstName}
                        </td>
                        <td className="px-3 py-2 text-ink-400 dark:text-umber-500">—</td>
                        <td className="px-3 py-2 text-ink-400 dark:text-umber-500">—</td>
                        <td className="px-3 py-2 text-ink-700 dark:text-paper-200">
                          {g.household || "—"}
                        </td>
                        <td className="px-3 py-2 text-ink-700 dark:text-paper-200">
                          {g.diet || "—"}
                        </td>
                        <td className="px-3 py-2 text-ink-700 dark:text-paper-200">
                          {g.plusOne || "—"}
                        </td>
                        <td className="px-3 py-2 text-ink-500 dark:text-umber-300">
                          {statusLabel(g.status)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeGuest(g.id)}
                            aria-label={t("tools.guest_list_template.try_remove_label")}
                            className="rounded-full p-1 text-ink-400 hover:bg-paper-100 hover:text-ink-700 dark:text-umber-400 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-paper-50 dark:bg-umber-800 px-4 py-3 ring-1 ring-paper-300 dark:ring-umber-700">
                <p className="font-grotesk text-sm text-ink-700 dark:text-paper-200">
                  <span className="text-xl font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                    {tryGuests.length}
                  </span>{" "}
                  {t("tools.guest_list_template.try_count_label")}
                </p>
                <button type="button" onClick={downloadTryList} className="btn-outline btn-md">
                  {t("tools.guest_list_template.try_download_btn")}
                </button>
              </div>
              <p className="mt-2 text-xs italic text-ink-500 dark:text-umber-300">
                {t("tools.guest_list_template.try_download_hint")}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
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

      <section className="relative stationery-light">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
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
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
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

      <section className="relative stationery-light">
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.guest_list_template.faq_h2")}
          </h2>
          <div className="mt-8 space-y-3">
            {TOOL_FAQ[locale].guest_list_template.map((entry) => (
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
